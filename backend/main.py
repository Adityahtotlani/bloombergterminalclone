import asyncio
import time
from typing import Optional
from datetime import datetime, timedelta
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from cachetools import TTLCache

API_KEY = "iQvdjdDI6r6tbFj_TqI_cv496Ibf59TJ"
BASE_URL = "https://api.polygon.io"

app = FastAPI(title="Bloomberg Terminal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "https://bloomberg.adityatotlani.ch"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 60s TTL cache, max 256 entries
cache = TTLCache(maxsize=256, ttl=60)

# Simple rate limiter: 5 requests per 60s for free tier
_request_times: list[float] = []
_request_lock = asyncio.Lock()


async def rate_limited_get(url: str, params: dict = None) -> dict:
    global _request_times

    cache_key = url + str(sorted((params or {}).items()))
    if cache_key in cache:
        return cache[cache_key]

    # compute wait outside the lock so other requests aren't blocked
    while True:
        async with _request_lock:
            now = time.time()
            _request_times = [t for t in _request_times if now - t < 60]
            if len(_request_times) < 5:
                _request_times.append(time.time())
                break
            wait = 60 - (now - _request_times[0]) + 0.1
        await asyncio.sleep(wait)

    full_params = {"apiKey": API_KEY}
    if params:
        full_params.update(params)

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, params=full_params)
        if resp.status_code == 429:
            raise HTTPException(status_code=429, detail="Rate limit exceeded, retry after 60s")
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        data = resp.json()

    cache[cache_key] = data
    return data


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.get("/api/search")
async def search_tickers(q: str = Query(..., min_length=1)):
    data = await rate_limited_get(
        f"{BASE_URL}/v3/reference/tickers",
        {"search": q, "active": "true", "limit": 10, "market": "stocks"}
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


@app.get("/api/quote/{ticker}")
async def get_quote(ticker: str):
    ticker = ticker.upper()
    data = await rate_limited_get(
        f"{BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}"
    )
    snap = data.get("ticker", {})
    day = snap.get("day", {})
    prev = snap.get("prevDay", {})
    last_trade = snap.get("lastTrade", {})
    last_quote = snap.get("lastQuote", {})
    min_data = snap.get("min", {})

    price = last_trade.get("p") or day.get("c") or prev.get("c") or 0
    prev_close = prev.get("c") or 0
    change = round(price - prev_close, 4) if prev_close else 0
    change_pct = round((change / prev_close) * 100, 4) if prev_close else 0

    return {
        "ticker": ticker,
        "price": price,
        "change": change,
        "change_pct": change_pct,
        "open": day.get("o") or prev.get("o"),
        "high": day.get("h") or prev.get("h"),
        "low": day.get("l") or prev.get("l"),
        "close": day.get("c") or prev.get("c"),
        "volume": day.get("v") or prev.get("v"),
        "vwap": day.get("vw") or prev.get("vw"),
        "bid": last_quote.get("P"),
        "ask": last_quote.get("a"),
        "bid_size": last_quote.get("S"),
        "ask_size": last_quote.get("s"),
        "prev_close": prev_close,
        "min_open": min_data.get("o"),
        "min_close": min_data.get("c"),
        "updated": snap.get("updated"),
    }


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
        {"adjusted": "true", "sort": "asc", "limit": 5000}
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
    limit: int = Query(20),
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
            params
        )
    except HTTPException as e:
        if e.status_code in (401, 403):
            return {"ticker": ticker, "options": [], "error": "Options data requires a paid Polygon plan"}
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
        {"ticker": ticker, "limit": limit, "order": "desc", "sort": "published_utc"}
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
    data = await rate_limited_get(
        f"{BASE_URL}/vX/reference/financials",
        {"ticker": ticker, "limit": 4, "sort": "filing_date", "order": "desc"}
    )
    results = data.get("results", [])
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


@app.get("/api/ticker-details/{ticker}")
async def get_ticker_details(ticker: str):
    ticker = ticker.upper()
    data = await rate_limited_get(
        f"{BASE_URL}/v3/reference/tickers/{ticker}"
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
