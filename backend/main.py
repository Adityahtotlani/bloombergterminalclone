import asyncio
import contextvars
import logging
import os
import re
import time
from typing import Optional
from datetime import datetime, timedelta
import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from cachetools import TTLCache
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

logger = logging.getLogger("bbg")

API_KEY = os.getenv("POLYGON_API_KEY", "")
if not API_KEY:
    logger.warning("POLYGON_API_KEY is not set — copy backend/.env.example to backend/.env")
BASE_URL = "https://api.polygon.io"

# The current HTTP request, so the rate limiter can drop queued work whose client went away.
_current_request: contextvars.ContextVar[Optional[Request]] = contextvars.ContextVar(
    "current_request", default=None
)


async def _track_request(request: Request):
    _current_request.set(request)


app = FastAPI(title="Bloomberg Terminal API", dependencies=[Depends(_track_request)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "https://bloomberg.adityatotlani.ch"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cache = TTLCache(maxsize=512, ttl=10)  # 10s TTL for near-real-time data
# Longer-lived caches for data that changes slowly; keyed by TTL in seconds.
_ttl_caches: dict[int, TTLCache] = {10: cache}


def _cache_for(ttl: int) -> TTLCache:
    if ttl not in _ttl_caches:
        _ttl_caches[ttl] = TTLCache(maxsize=512, ttl=ttl)
    return _ttl_caches[ttl]


# Give up (503) rather than leave a panel spinning when the rate-limit queue is long.
MAX_QUEUE_WAIT = 75
# End-of-day data only changes once per session, so hold it much longer.
eod_cache = TTLCache(maxsize=1024, ttl=600)

# Requests per minute allowed by the Polygon plan (free: 5, Starter+: effectively unlimited).
RATE_LIMIT = int(os.getenv("POLYGON_RATE_LIMIT", "5"))
_request_times: list[float] = []

# Endpoint families the current key isn't entitled to (403) or that are gone (410).
# Remembered so we don't burn scarce rate-limit slots re-discovering the denial.
# 403 = plan entitlement (stable); 410 = deprecation brownout (intermittent, retry sooner).
DENIAL_TTL = {403: 30 * 60, 410: 5 * 60}
_denied: dict[str, tuple[float, int, str]] = {}


# FIFO ticket queue: requests get upstream slots in arrival order, and a request whose
# client disconnected (e.g. the user switched tickers) gives up its place.
_slot_cond = asyncio.Condition()
_ticket_next = 0
_ticket_serving = 0
_abandoned: set[int] = set()


def _advance_queue() -> None:
    global _ticket_serving
    _ticket_serving += 1
    while _ticket_serving in _abandoned:
        _abandoned.discard(_ticket_serving)
        _ticket_serving += 1
    _slot_cond.notify_all()


async def _acquire_slot(should_abandon=None, label: str = "") -> None:
    """Wait (FIFO) for an upstream slot. `should_abandon` is an async predicate polled while queued."""
    global _ticket_next, _request_times
    deadline = time.time() + MAX_QUEUE_WAIT
    async with _slot_cond:
        ticket = _ticket_next
        _ticket_next += 1
        try:
            while True:
                now = time.time()
                head = ticket == _ticket_serving
                wait = 1.0
                if head:
                    _request_times = [t for t in _request_times if now - t < 60]
                    if len(_request_times) < RATE_LIMIT:
                        _request_times.append(now)
                        _advance_queue()
                        return
                    wait = 60 - (now - _request_times[0]) + 0.05
                if (now + wait if head else now) > deadline:
                    raise HTTPException(status_code=503, detail="Data provider rate limit busy — retry shortly")
                if should_abandon is not None and await should_abandon():
                    logger.warning("Dropped queued upstream call %s: all clients disconnected", label)
                    raise HTTPException(status_code=499, detail="Client disconnected")
                try:
                    await asyncio.wait_for(_slot_cond.wait(), timeout=min(wait, 1.0))
                except asyncio.TimeoutError:
                    pass
        except BaseException:
            if ticket == _ticket_serving:
                _advance_queue()
            else:
                _abandoned.add(ticket)
            raise


class _Inflight:
    """One shared upstream call plus the HTTP requests waiting on it."""

    def __init__(self) -> None:
        self.requests: list[Optional[Request]] = []
        self.task: Optional[asyncio.Task] = None

    async def all_clients_gone(self) -> bool:
        if not self.requests or any(r is None for r in self.requests):
            return False  # internal callers (no HTTP request) always want the result
        for r in self.requests:
            if not await r.is_disconnected():
                return False
        return True


# Identical upstream calls in flight are coalesced, so e.g. 2s quote polls can't flood the queue.
_inflight: dict[str, _Inflight] = {}


async def rate_limited_get(
    url: str, params: dict = None, family: Optional[str] = None, ttl: int = 10
) -> dict:
    store = _cache_for(ttl)
    cache_key = url + str(sorted((params or {}).items()))
    if cache_key in store:
        return store[cache_key]

    if family and family in _denied:
        until, status, detail = _denied[family]
        if time.time() < until:
            raise HTTPException(status_code=status, detail=detail)
        del _denied[family]

    flight = _inflight.get(cache_key)
    if flight is None:
        flight = _Inflight()
        _inflight[cache_key] = flight
        # Fresh context: the shared task must not belong to whichever request started it.
        flight.task = asyncio.create_task(
            _fetch_upstream(url, params, family, store, cache_key, flight),
            context=contextvars.Context(),
        )
        flight.task.add_done_callback(
            lambda _t, k=cache_key, f=flight: _inflight.pop(k) if _inflight.get(k) is f else None
        )
    flight.requests.append(_current_request.get())
    return await asyncio.shield(flight.task)


async def _fetch_upstream(
    url: str, params: Optional[dict], family: Optional[str],
    store: TTLCache, cache_key: str, flight: _Inflight,
) -> dict:
    global _request_times
    full_params = {"apiKey": API_KEY, **(params or {})}
    label = url.replace(BASE_URL, "")

    for attempt in range(2):
        await _acquire_slot(flight.all_clients_gone, label)
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=full_params)
        if resp.status_code == 429 and attempt == 0:
            # Polygon's window is fuller than our count (e.g. after a restart): treat it as full.
            logger.warning("Polygon returned 429 for %s; backing off", label)
            _request_times = [time.time()] * RATE_LIMIT
            continue
        break

    if resp.status_code == 429:
        raise HTTPException(status_code=503, detail="Data provider rate limit busy — retry shortly")
    if resp.status_code != 200:
        if family and resp.status_code in (403, 410):
            denial_ttl = DENIAL_TTL[resp.status_code]
            _denied[family] = (time.time() + denial_ttl, resp.status_code, resp.text)
            logger.warning("Polygon denied %s (%s); skipping for %ss", family, resp.status_code, denial_ttl)
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    store[cache_key] = data
    return data


@app.get("/", include_in_schema=False)
async def root():
    """Send visitors of the bare API domain to the interactive docs."""
    return RedirectResponse(url="/docs")


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.get("/api/search")
async def search_tickers(q: str = Query(..., min_length=1)):
    data = await rate_limited_get(
        f"{BASE_URL}/v3/reference/tickers",
        {"search": q, "active": "true", "limit": 10, "market": "stocks"},
        ttl=3600,
    )
    results = [
        {
            "ticker": t.get("ticker"),
            "name": t.get("name"),
            "market": t.get("market"),
            "type": t.get("type"),
        }
        for t in data.get("results", [])
    ]
    return {"results": results}


def _normalize_snapshot(snap: dict) -> dict:
    """Flatten a Polygon ticker snapshot into the shape the frontend expects."""
    day = snap.get("day") or {}
    prev = snap.get("prevDay") or {}
    last_trade = snap.get("lastTrade") or {}
    last_quote = snap.get("lastQuote") or {}
    min_data = snap.get("min") or {}

    price = last_trade.get("p") or min_data.get("c") or day.get("c") or prev.get("c") or 0
    prev_close = prev.get("c") or 0
    change = round(price - prev_close, 4) if prev_close else 0
    change_pct = round((change / prev_close) * 100, 4) if prev_close else 0

    return {
        "ticker": snap.get("ticker"),
        "price": price,
        "change": change,
        "change_pct": change_pct,
        "open": day.get("o") or prev.get("o"),
        "high": day.get("h") or prev.get("h"),
        "low": day.get("l") or prev.get("l"),
        "close": day.get("c") or prev.get("c"),
        "volume": day.get("v") or prev.get("v"),
        "vwap": day.get("vw") or prev.get("vw"),
        "bid": last_quote.get("p"),
        "ask": last_quote.get("P"),
        "bid_size": last_quote.get("s"),
        "ask_size": last_quote.get("S"),
        "prev_close": prev_close,
        "min_open": min_data.get("o"),
        "min_close": min_data.get("c"),
        "updated": snap.get("updated"),
    }


def _is_denied(e: HTTPException) -> bool:
    return e.status_code in (401, 403, 410)


def _eod_quote(ticker: str, bar: dict, prev_close: Optional[float]) -> dict:
    """Build a quote from end-of-day aggregate bars (free-tier fallback)."""
    price = bar.get("c") or 0
    change = round(price - prev_close, 4) if prev_close else 0
    change_pct = round((change / prev_close) * 100, 4) if prev_close else 0
    return {
        "ticker": ticker,
        "price": price,
        "change": change,
        "change_pct": change_pct,
        "open": bar.get("o"),
        "high": bar.get("h"),
        "low": bar.get("l"),
        "close": bar.get("c"),
        "volume": bar.get("v"),
        "vwap": bar.get("vw"),
        "bid": None, "ask": None, "bid_size": None, "ask_size": None,
        "prev_close": prev_close,
        "updated": bar.get("t"),
        "source": "eod",
    }


async def _recent_daily_bars(ticker: str) -> list[dict]:
    today = datetime.utcnow()
    data = await rate_limited_get(
        f"{BASE_URL}/v2/aggs/ticker/{ticker}/range/1/day/"
        f"{(today - timedelta(days=10)).strftime('%Y-%m-%d')}/{today.strftime('%Y-%m-%d')}",
        {"adjusted": "true", "sort": "asc", "limit": 50},
        ttl=600,
    )
    return data.get("results") or []


async def _eod_single_quote(ticker: str) -> dict:
    # The whole-market table (built for the watchlist) already has this ticker — free lookup.
    market = eod_cache.get("market")
    if market and ticker in market:
        return market[ticker]
    key = ("quote", ticker)
    if key in eod_cache:
        return eod_cache[key]
    bars = await _recent_daily_bars(ticker)
    if not bars:
        raise HTTPException(status_code=404, detail=f"No data for {ticker}")
    prev_close = bars[-2].get("c") if len(bars) > 1 else None
    quote = _eod_quote(ticker, bars[-1], prev_close)
    eod_cache[key] = quote
    return quote


async def _eod_market() -> dict[str, dict]:
    """Whole-market EOD table from the last two grouped-daily sessions (3 requests, cached)."""
    if "market" in eod_cache:
        return eod_cache["market"]
    # SPY trades every session, so its bars tell us the last two trading dates.
    spy = await _recent_daily_bars("SPY")
    if len(spy) < 2:
        raise HTTPException(status_code=503, detail="Could not determine recent trading sessions")
    last_day, prev_day = (
        datetime.utcfromtimestamp(b["t"] / 1000).strftime("%Y-%m-%d") for b in (spy[-1], spy[-2])
    )

    async def grouped(day: str) -> list[dict]:
        data = await rate_limited_get(
            f"{BASE_URL}/v2/aggs/grouped/locale/us/market/stocks/{day}", {"adjusted": "true"}, ttl=600
        )
        return data.get("results") or []

    prev_rows = {r["T"]: r.get("c") for r in await grouped(prev_day)}
    market = {
        r["T"]: _eod_quote(r["T"], r, prev_rows.get(r["T"])) for r in await grouped(last_day)
    }
    eod_cache["market"] = market
    return market


@app.get("/api/quote/{ticker}")
async def get_quote(ticker: str):
    ticker = ticker.upper()
    try:
        data = await rate_limited_get(
            f"{BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}",
            family="snapshot",
        )
    except HTTPException as e:
        if not _is_denied(e):
            raise
        return await _eod_single_quote(ticker)
    quote = _normalize_snapshot(data.get("ticker", {}))
    quote["ticker"] = ticker
    quote["source"] = "live"
    return quote


TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")
MAX_WATCHLIST = 50
# Movers filters: skip illiquid penny names that dominate raw % rankings.
MOVERS_MIN_PRICE = 5.0
MOVERS_MIN_VOLUME = 1_000_000


@app.get("/api/watchlist")
async def get_watchlist(tickers: str = Query(..., min_length=1)):
    """Batch quotes for many tickers in a single upstream request."""
    symbols = []
    for raw in tickers.split(","):
        t = raw.strip().upper()
        if t and TICKER_RE.match(t) and t not in symbols:
            symbols.append(t)
    if not symbols:
        raise HTTPException(status_code=400, detail="No valid tickers supplied")
    symbols = symbols[:MAX_WATCHLIST]

    try:
        data = await rate_limited_get(
            f"{BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers",
            {"tickers": ",".join(symbols)},
            family="snapshot",
        )
        by_ticker = {}
        for snap in data.get("tickers") or []:
            q = _normalize_snapshot(snap)
            q["source"] = "live"
            by_ticker[q["ticker"]] = q
    except HTTPException as e:
        if not _is_denied(e):
            raise
        by_ticker = await _eod_market()

    # Preserve the caller's ordering; unknown symbols come back as empty rows.
    quotes = [by_ticker.get(t) or {"ticker": t, "price": None} for t in symbols]
    return {"quotes": quotes}


@app.get("/api/movers/{direction}")
async def get_movers(direction: str):
    direction = direction.lower()
    if direction not in ("gainers", "losers"):
        raise HTTPException(status_code=400, detail="direction must be 'gainers' or 'losers'")
    try:
        data = await rate_limited_get(
            f"{BASE_URL}/v2/snapshot/locale/us/markets/stocks/{direction}",
            family="snapshot",
        )
        movers = [_normalize_snapshot(s) for s in (data.get("tickers") or [])[:20]]
        return {"direction": direction, "source": "live", "movers": movers}
    except HTTPException as e:
        if not _is_denied(e):
            raise

    candidates = [
        q for q in (await _eod_market()).values()
        if q["prev_close"] and (q["price"] or 0) >= MOVERS_MIN_PRICE
        and (q["volume"] or 0) >= MOVERS_MIN_VOLUME
    ]
    candidates.sort(key=lambda q: q["change_pct"], reverse=(direction == "gainers"))
    return {"direction": direction, "source": "eod", "movers": candidates[:20]}


@app.get("/api/aggs/{ticker}")
async def get_aggs(
    ticker: str,
    timeframe: str = Query("1D"),
    multiplier: int = Query(1),
    timespan: str = Query("day"),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
):
    ticker = ticker.upper()
    today = datetime.utcnow()

    timeframe_map = {
        "1D": (1, "minute", today - timedelta(days=1), today),
        "5D": (5, "minute", today - timedelta(days=5), today),
        "1M": (1, "day", today - timedelta(days=30), today),
        "3M": (1, "day", today - timedelta(days=90), today),
        "1Y": (1, "week", today - timedelta(days=365), today),
    }

    mult, tspan, from_dt, to_dt = timeframe_map.get(timeframe, (1, "day", today - timedelta(days=30), today))

    from_str = from_date or from_dt.strftime("%Y-%m-%d")
    to_str = to_date or to_dt.strftime("%Y-%m-%d")

    data = await rate_limited_get(
        f"{BASE_URL}/v2/aggs/ticker/{ticker}/range/{mult}/{tspan}/{from_str}/{to_str}",
        {"adjusted": "true", "sort": "asc", "limit": 5000},
        ttl=60 if tspan == "minute" else 600,
    )

    bars = [
        {
            "t": r.get("t"),
            "o": r.get("o"),
            "h": r.get("h"),
            "l": r.get("l"),
            "c": r.get("c"),
            "v": r.get("v"),
            "vw": r.get("vw"),
        }
        for r in data.get("results", [])
    ]
    return {"ticker": ticker, "timeframe": timeframe, "bars": bars}


@app.get("/api/options/{ticker}")
async def get_options(
    ticker: str,
    limit: int = Query(40),
    strike_price_gte: Optional[float] = None,
    strike_price_lte: Optional[float] = None,
):
    ticker = ticker.upper()
    params: dict = {"limit": limit, "order": "asc", "sort": "strike_price"}
    if strike_price_gte:
        params["strike_price.gte"] = strike_price_gte
    if strike_price_lte:
        params["strike_price.lte"] = strike_price_lte

    try:
        data = await rate_limited_get(
            f"{BASE_URL}/v3/snapshot/options/{ticker}",
            params,
            family="options",
            ttl=60,
        )
    except HTTPException as e:
        if _is_denied(e):
            return {"ticker": ticker, "options": [], "error": "Options data requires Polygon Options Add-on"}
        raise

    results = data.get("results", [])
    options = []
    for r in results:
        detail = r.get("details", {})
        greeks = r.get("greeks", {})
        day = r.get("day", {})
        last_quote = r.get("last_quote", {})
        options.append({
            "contract_type": detail.get("contract_type"),
            "strike_price": detail.get("strike_price"),
            "expiration_date": detail.get("expiration_date"),
            "bid": last_quote.get("bid"),
            "ask": last_quote.get("ask"),
            "mid": last_quote.get("midpoint"),
            "iv": r.get("implied_volatility"),
            "delta": greeks.get("delta"),
            "gamma": greeks.get("gamma"),
            "theta": greeks.get("theta"),
            "vega": greeks.get("vega"),
            "open_interest": r.get("open_interest"),
            "volume": day.get("volume"),
        })
    return {"ticker": ticker, "options": options}


@app.get("/api/news/{ticker}")
async def get_news(ticker: str, limit: int = Query(10)):
    ticker = ticker.upper()
    data = await rate_limited_get(
        f"{BASE_URL}/v2/reference/news",
        {"ticker": ticker, "limit": limit, "order": "desc", "sort": "published_utc"},
        ttl=300,
    )
    news = [
        {
            "id": n.get("id"),
            "title": n.get("title"),
            "author": n.get("author"),
            "published_utc": n.get("published_utc"),
            "article_url": n.get("article_url"),
            "publisher": n.get("publisher", {}).get("name"),
            "description": n.get("description"),
            "tickers": n.get("tickers", []),
        }
        for n in data.get("results", [])
    ]
    return {"ticker": ticker, "news": news}


@app.get("/api/financials/{ticker}")
async def get_financials(ticker: str):
    ticker = ticker.upper()
    try:
        data = await rate_limited_get(
            f"{BASE_URL}/vX/reference/financials",
            # Same params as /api/earnings so both panels share one upstream request.
            {"ticker": ticker, "limit": 8, "sort": "filing_date", "order": "desc"},
            family="financials",
            ttl=3600,
        )
    except HTTPException as e:
        if _is_denied(e):
            return {"ticker": ticker, "financials": [], "error": "Financials unavailable on current Polygon plan"}
        raise
    results = data.get("results", [])[:4]
    if not results:
        return {"ticker": ticker, "financials": []}

    financials = []
    for r in results:
        financials_data = r.get("financials", {})
        income = financials_data.get("income_statement", {})
        balance = financials_data.get("balance_sheet", {})
        cash = financials_data.get("cash_flow_statement", {})

        def val(d, key):
            return d.get(key, {}).get("value")

        financials.append({
            "fiscal_period": r.get("fiscal_period"),
            "fiscal_year": r.get("fiscal_year"),
            "filing_date": r.get("filing_date"),
            "revenues": val(income, "revenues"),
            "net_income": val(income, "net_income_loss"),
            "eps": val(income, "basic_earnings_per_share"),
            "diluted_eps": val(income, "diluted_earnings_per_share"),
            "gross_profit": val(income, "gross_profit"),
            "operating_income": val(income, "operating_income_loss"),
            "total_assets": val(balance, "assets"),
            "total_liabilities": val(balance, "liabilities"),
            "equity": val(balance, "equity"),
            "long_term_debt": val(balance, "long_term_debt"),
            "operating_cash_flow": val(cash, "net_cash_flow_from_operating_activities"),
        })

    return {"ticker": ticker, "financials": financials}


@app.get("/api/earnings/{ticker}")
async def get_earnings(ticker: str):
    ticker = ticker.upper()
    try:
        data = await rate_limited_get(
            f"{BASE_URL}/vX/reference/financials",
            {"ticker": ticker, "limit": 8, "sort": "filing_date", "order": "desc"},
            family="financials",
            ttl=3600,
        )
    except HTTPException as e:
        if _is_denied(e):
            return {"ticker": ticker, "earnings": [], "error": "Earnings data unavailable on current Polygon plan"}
        raise

    results = data.get("results", [])
    earnings = []
    for r in results:
        income = r.get("financials", {}).get("income_statement", {})
        eps = income.get("basic_earnings_per_share", {}).get("value")
        rev = income.get("revenues", {}).get("value")
        earnings.append({
            "fiscal_period": r.get("fiscal_period"),
            "fiscal_year": r.get("fiscal_year"),
            "filing_date": r.get("filing_date"),
            "start_date": r.get("start_date"),
            "end_date": r.get("end_date"),
            "eps": eps,
            "revenues": rev,
        })
    return {"ticker": ticker, "earnings": earnings}


def _macro_events():
    """Generate known macro events for the next 12 months from today."""
    today = datetime.utcnow().date()
    events = []

    # FOMC rate decisions (second day of each meeting), from
    # https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm — True = meeting includes
    # the Summary of Economic Projections (SEP). Dates are tentative until the prior meeting
    # confirms them; refresh this list when the Fed publishes the next year's schedule.
    fomc_dates = {
        "2025-01-29": False, "2025-03-19": True, "2025-05-07": False, "2025-06-18": True,
        "2025-07-30": False, "2025-09-17": True, "2025-10-29": False, "2025-12-10": True,
        "2026-01-28": False, "2026-03-18": True, "2026-04-29": False, "2026-06-17": True,
        "2026-07-29": False, "2026-09-16": True, "2026-10-28": False, "2026-12-09": True,
        "2027-01-27": False, "2027-03-17": True, "2027-04-28": False, "2027-06-09": True,
        "2027-07-28": False, "2027-09-15": True, "2027-10-27": False, "2027-12-08": True,
    }
    for d, has_sep in fomc_dates.items():
        dt = datetime.strptime(d, "%Y-%m-%d").date()
        if abs((dt - today).days) <= 180:
            events.append({
                "date": d,
                "event": "FOMC Rate Decision + SEP" if has_sep else "FOMC Rate Decision",
                "category": "FED",
                "importance": "HIGH",
            })

    # CPI releases — official BLS schedule (https://www.bls.gov/schedule/news_release/cpi.htm),
    # 8:30 AM ET. Months past the last published date get a clearly-labelled estimate.
    # Add the next year's dates when BLS publishes them (usually late in the year).
    cpi_dates = [
        "2025-12-18",
        "2026-01-13", "2026-02-13", "2026-03-11", "2026-04-10", "2026-05-12", "2026-06-10",
        "2026-07-14", "2026-08-12", "2026-09-11", "2026-10-14", "2026-11-10", "2026-12-10",
    ]
    for d in cpi_dates:
        events.append({"date": d, "event": "CPI Inflation Report", "category": "ECON", "importance": "HIGH"})

    last_cpi = datetime.strptime(cpi_dates[-1], "%Y-%m-%d").date()
    for month_offset in range(1, 13):
        month_index = last_cpi.month - 1 + month_offset
        year, month = last_cpi.year + month_index // 12, month_index % 12 + 1
        est = datetime(year, month, 13).date()
        while est.weekday() in (0, 5, 6):  # BLS releases Tue-Fri (Mondays are often holidays)
            est += timedelta(days=1)
        events.append({"date": str(est), "event": "CPI Inflation Report (est.)", "category": "ECON",
                       "importance": "HIGH", "estimated": True})

    # NFP — first Friday of each month
    for month_offset in range(-3, 9):
        ref = today.replace(day=1)
        year = ref.year
        month = ref.month + month_offset
        while month > 12:
            month -= 12
            year += 1
        while month < 1:
            month += 12
            year -= 1
        try:
            first = datetime(year, month, 1).date()
            # Find first Friday
            days_ahead = 4 - first.weekday()
            if days_ahead < 0:
                days_ahead += 7
            nfp_date = first + timedelta(days=days_ahead)
            events.append({"date": str(nfp_date), "event": "Non-Farm Payrolls", "category": "ECON", "importance": "HIGH"})
        except ValueError:
            pass

    # GDP releases (approx end of Jan, Apr, Jul, Oct)
    gdp_months = [1, 4, 7, 10]
    for year in [today.year, today.year + 1]:
        for m in gdp_months:
            try:
                dt = datetime(year, m, 30).date()
                events.append({"date": str(dt), "event": "GDP Growth Rate", "category": "ECON", "importance": "MED"})
            except ValueError:
                pass

    events.sort(key=lambda x: x["date"])
    # Keep events within ±6 months
    cutoff_past = str(today - timedelta(days=90))
    cutoff_future = str(today + timedelta(days=180))
    return [e for e in events if cutoff_past <= e["date"] <= cutoff_future]


@app.get("/api/economic-events")
async def get_economic_events():
    return {"events": _macro_events()}


@app.get("/api/ticker-details/{ticker}")
async def get_ticker_details(ticker: str):
    ticker = ticker.upper()
    data = await rate_limited_get(
        f"{BASE_URL}/v3/reference/tickers/{ticker}", ttl=3600
    )
    r = data.get("results", {})
    return {
        "ticker": ticker,
        "name": r.get("name"),
        "description": r.get("description"),
        "market_cap": r.get("market_cap"),
        "share_class_shares_outstanding": r.get("share_class_shares_outstanding"),
        "weighted_shares_outstanding": r.get("weighted_shares_outstanding"),
        "primary_exchange": r.get("primary_exchange"),
        "type": r.get("type"),
        "currency_name": r.get("currency_name"),
        "homepage_url": r.get("homepage_url"),
        "list_date": r.get("list_date"),
        "sic_description": r.get("sic_description"),
    }
