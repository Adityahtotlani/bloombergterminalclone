# API Reference

The backend is a FastAPI app (`backend/main.py`). Every data endpoint lives under `/api` and returns JSON.

| Environment | Base URL |
|---|---|
| Local dev | `http://localhost:8000` |
| Production | `https://bloomberg-api.adityatotlani.ch` |
| From the browser app | relative `/api/...`, proxied by Vite (see [ARCHITECTURE.md](ARCHITECTURE.md)) |

FastAPI also serves interactive docs at `/docs` (Swagger UI) and the OpenAPI schema at `/openapi.json`. `GET /` returns a `307` redirect to `/docs`.

There is no authentication. The Polygon API key stays on the server.

> The examples below are real responses from the production API, captured on 2026-10-02 on the free plan, so quotes are `"source": "eod"`. They're trimmed: long arrays are cut to one or two items, marked `…`. They are point-in-time samples, not reference data.

## Contents

- [Conventions](#conventions)
- [Errors](#errors)
- [Caching and quota cost](#caching-and-quota-cost)
- Endpoints: [health](#get-apihealth) · [search](#get-apisearch) · [quote](#get-apiquoteticker) · [watchlist](#get-apiwatchlist) · [movers](#get-apimoversdirection) · [aggs](#get-apiaggsticker) · [options](#get-apioptionsticker) · [news](#get-apinewsticker) · [financials](#get-apifinancialsticker) · [earnings](#get-apiearningsticker) · [economic-events](#get-apieconomic-events) · [ticker-details](#get-apiticker-detailsticker)

## Conventions

- **Tickers** in the path are case-insensitive and are upper-cased by the server. Only `/api/watchlist` validates their format, against `^[A-Z0-9.\-]{1,10}$`.
- **Prices and amounts** are JSON numbers in USD, as Polygon returns them. Missing values are `null`.
- **Timestamps:** bar and EOD `t`/`updated` values are Unix epoch **milliseconds** (UTC). News `published_utc` is an ISO-8601 UTC string. `/api/health` `time` is a naive ISO string in UTC.
- **Volumes** from Polygon's aggregates can be fractional (for example `36306346.557309`).
- **`source`** on quote objects is `"live"` (Polygon snapshot) or `"eod"` (built from end-of-day daily bars). See [DATA-SOURCES.md](DATA-SOURCES.md).

## Errors

FastAPI errors have the shape `{"detail": ...}`.

| Status | When | Example `detail` |
|---|---|---|
| `401` | Polygon rejected the API key (invalid, revoked or missing). Returned by **every** data endpoint, with no EOD fallback or plan notice, because those would fail the same way. Also detected when Polygon answers another status with an `"Unknown API Key"` body (the `vX` financials endpoint answers 404). It is not cached or memoised, and `/api/health` reports `"data": "auth_error"` until an upstream call succeeds. Not retryable: fix the key and restart the backend | `"Data provider rejected the API key — check POLYGON_API_KEY in backend/.env and restart the backend"` |
| `400` | Bad `direction` on `/api/movers`, or no valid symbols on `/api/watchlist` | `"direction must be 'gainers' or 'losers'"` / `"No valid tickers supplied"` |
| `422` | A required query parameter is missing or has the wrong type (FastAPI validation), for example `/api/search` without `q` | `[{"type": "missing", "loc": ["query","q"], "msg": "Field required", ...}]` |
| `403` / `410` *(degraded, usually not seen)* | The plan isn't entitled (403), or the endpoint is in a deprecation brownout (410). For the `snapshot`, `options` and `financials` families the backend **catches** this and degrades instead of failing. Quotes, watchlist and movers fall back to EOD. Options, financials and earnings return **200** with an `error` string and an empty list. Endpoints outside those families (search, aggs, news, ticker-details, and the EOD fallback's own daily-bars / grouped-daily calls) return the status with a short fixed message. Polygon's body (JSON, plain text or HTML) is never sent to the client or logged, and the denial memo replays the same short message. Not retried by the frontend | `"Data provider: not included in the current data plan (HTTP 403)"` / `"Data provider endpoint deprecated or temporarily unavailable (HTTP 410)"` |
| Other upstream `4xx`, e.g. `404` | Polygon answered a 4xx not covered by another row (for example 404 for an unknown symbol on ticker-details). The status is passed through. Polygon's body is **replaced** with a short message and logged only as status + path. Not cached or memoised, and not retried by the frontend | `"Data provider error (HTTP 404)"` |
| Upstream `5xx` → `502` | Polygon answered any 5xx (500–599), or a non-error status such as an unfollowed 3xx. Returned as **502** so clients retry it; the original status is kept in the message. Body replaced and logged as status + path, as above. Not cached or memoised. This is Polygon's 503, not our own rate-limit 503 below | `"Data provider error (HTTP 500) — retry shortly"` / `"Data provider error (HTTP 503) — retry shortly"` |
| `404` | EOD quote fallback found no daily bars for the ticker | `"No data for XYZ"` |
| `499` | The request was waiting in the rate-limit queue and every client waiting on it disconnected. This is non-standard. Clients never actually receive it, but it shows in the logs as `Dropped queued upstream call ...`. | `"Client disconnected"` |
| `502` | Polygon answered a 5xx (row above), or couldn't be reached (connection refused, DNS or TLS failure, dropped connection, or another `httpx` request error), or it answered 200 with a body that isn't valid JSON | `"Data provider unreachable — retry shortly"` / `"Data provider sent an invalid response — retry shortly"` |
| `503` | No upstream slot within 75 s (`MAX_QUEUE_WAIT`), Polygon answered 429 twice, or the EOD table couldn't find two recent sessions | `"Data provider rate limit busy — retry shortly"` |
| `504` | Polygon didn't answer within the 15 s `httpx` timeout | `"Data provider timed out — retry shortly"` |

A 502 or 504 is never cached, and every request coalesced onto the failed upstream call gets the same error. The failed attempt still counts against the per-minute quota. Any other unhandled failure would still be a plain `500`.

**Clients should retry 502, 503 and 504.** The frontend retries them up to 4 attempts in total, 3 s apart. It never retries a 401, 403, 404 or 410.

## Caching and quota cost

All upstream calls share one budget of `POLYGON_RATE_LIMIT` requests per minute (free tier: 5). Responses are cached in memory by URL and parameters, and identical concurrent requests are coalesced into one upstream call. A cached response costs no quota. A denied family (403 for 30 min, 410 for 5 min) also costs none while the denial is remembered.

| Endpoint | Cache TTL | Upstream requests on a miss | Denial family |
|---|---|---|---|
| `/api/health` | — | 0 | — |
| `/api/economic-events` | — (computed) | 0 | — |
| `/api/search` | 1 h | 1 | — |
| `/api/quote/{t}` | 10 s live; EOD 10 min | live: 1. EOD: 0 if the market table is warm, else 1 | `snapshot` |
| `/api/watchlist` | 10 s live; EOD 10 min | live: 1 for the whole batch. EOD: 0 if warm, else 3 to build the market table | `snapshot` |
| `/api/movers/{d}` | 10 s live; EOD 10 min | live: 1. EOD: as watchlist | `snapshot` |
| `/api/aggs/{t}` | 60 s for 1D/5D (minute bars); 10 min otherwise | 1 | — |
| `/api/options/{t}` | 60 s | 1 | `options` |
| `/api/news/{t}` | 5 min | 1 | — |
| `/api/financials/{t}` | 1 h | 1, **shared with `/api/earnings`** (identical upstream parameters) | `financials` |
| `/api/earnings/{t}` | 1 h | shared with `/api/financials` | `financials` |
| `/api/ticker-details/{t}` | 1 h | 1 | — |

---

## `GET /api/health`

Liveness check, plus the backend's last-known quote freshness. It never calls Polygon and only reads memory, so it is fast and costs no quota. The UI's top-bar indicator polls it every 10 s.

```json
{"status": "ok", "time": "2026-10-04T13:27:02.130861", "data": "eod", "data_as_of": "2026-10-04T13:23:07.332259"}
```

| Field | Meaning |
|---|---|
| `status` | Always `"ok"` when the backend answers |
| `time` | Server time, naive ISO string in UTC |
| `data` | One of the values below. `auth_error` takes precedence over the others |
| `data_as_of` | When the `live`/`eod` evidence was last observed (naive ISO, UTC). It can predate the latest restart. `null` when there is no evidence |

| `data` | Meaning |
|---|---|
| `"auth_error"` | The last upstream response was Polygon rejecting the API key (401, or an `"Unknown API Key"` body). Nothing works, including the EOD fallback. Cleared by the next successful (200) upstream response, and never persisted |
| `"live"` | The latest evidence is a successful `snapshot`-family call (quote, watchlist or movers): live snapshot quotes work on this key |
| `"eod"` | The latest evidence is a `snapshot`-family 403/410: quotes, watchlist and movers are end-of-day |
| `"unknown"` | No evidence: no snapshot call has reached Polygon since startup, and there was no usable state file |

`live`/`eod` is **last-known evidence** and changes only when a snapshot call reaches Polygon. The 30-minute snapshot denial memo expiring doesn't reset it: it only means the next snapshot request re-probes. A key error with no live/eod evidence behind it still reports `auth_error`; once that clears, `data` falls back to the last live/eod evidence.

**Persistence.** The live/eod evidence is written to `backend/.state.json` (path overridable with the `BBG_STATE_FILE` environment variable) as `{"data_mode": "eod", "observed_at": <epoch seconds>}`. It is written atomically (temp file + rename) when the mode changes, and at most once an hour while it stays the same, so `observed_at` tracks the last confirmation. At startup the file is loaded, so the indicator is correct straight after a restart. The file is ignored (falling back to `"unknown"`) if it's missing, unreadable, malformed, or older than **48 hours**, because the Polygon plan may have changed in the meantime. It holds no secrets and is gitignored. `auth_error` is never written to it, so restarting with a fixed key starts clean.

## `GET /api/search`

Ticker autocomplete, backed by Polygon `/v3/reference/tickers` (active US stocks, at most 10 results).

| Query | Type | Required | Notes |
|---|---|---|---|
| `q` | string | yes | Minimum length 1. Matches ticker or company name |

`GET /api/search?q=apple`

```json
{
  "results": [
    {"ticker": "AAPL", "name": "Apple Inc.", "market": "stocks", "type": "CS"},
    {"ticker": "AAPX", "name": "T-Rex 2X Long Apple Daily Target ETF", "market": "stocks", "type": "ETF"}
    …
  ]
}
```

## `GET /api/quote/{ticker}`

A single quote. It tries Polygon's live snapshot first. If the plan isn't entitled (403/410), it falls back to EOD (`_eod_single_quote`). A rejected key (401) is returned as a 401, with no fallback.

| Field | Meaning |
|---|---|
| `price` | Live: last trade, else last minute-bar close, else day close, else previous close. EOD: the last session's close |
| `change`, `change_pct` | `price − prev_close` and that as a % of `prev_close`, rounded to 4 dp. Both are `0` if `prev_close` is unknown |
| `open`, `high`, `low`, `close`, `volume`, `vwap` | Live: today's session, falling back to the previous day's values. EOD: the last session |
| `bid`, `ask`, `bid_size`, `ask_size` | Live NBBO from the snapshot. Always `null` in EOD mode |
| `prev_close` | Close of the session before |
| `min_open`, `min_close` | Live only: the latest minute bar |
| `updated` | Live: Polygon's snapshot `updated` value. EOD: the bar timestamp (epoch ms) |
| `source` | `"live"` or `"eod"` |

`GET /api/quote/AAPL` (EOD)

```json
{
  "ticker": "AAPL", "price": 330.32, "change": -2.7, "change_pct": -0.8108,
  "open": 330, "high": 332.4816, "low": 325.81, "close": 330.32,
  "volume": 36306346.557309, "vwap": 329.6008,
  "bid": null, "ask": null, "bid_size": null, "ask_size": null,
  "prev_close": 333.02, "updated": 1790884800000, "source": "eod"
}
```

## `GET /api/watchlist`

Quotes for many tickers in a single upstream request. The monitor's WATCH and PORT tabs use it.

| Query | Type | Required | Notes |
|---|---|---|---|
| `tickers` | comma-separated string | yes | Symbols are upper-cased and de-duplicated. Symbols that don't match `^[A-Z0-9.\-]{1,10}$` are **silently dropped**. Capped at the first **50**. `400` if none are valid |

The response keeps the caller's order. A symbol with no data comes back as `{"ticker": X, "price": null}`. Each quote has the same shape as `/api/quote`.

`GET /api/watchlist?tickers=SPY,AAPL,ZZZZQ`

```json
{
  "quotes": [
    {"ticker": "SPY", "price": 763.99, "change": 1.36, "change_pct": 0.1783, "prev_close": 762.63, "source": "eod", …},
    {"ticker": "AAPL", "price": 330.32, "change": -2.7, "change_pct": -0.8108, "prev_close": 333.02, "source": "eod", …},
    {"ticker": "ZZZZQ", "price": null}
  ]
}
```

## `GET /api/movers/{direction}`

The day's top 20 gainers or losers.

| Path | Values |
|---|---|
| `direction` | `gainers` or `losers` (case-insensitive). Anything else returns `400` |

- **Live** (`source: "live"`): Polygon's snapshot gainers or losers list, first 20, unfiltered.
- **EOD** (`source: "eod"`): ranks the whole-market EOD table by `change_pct`, keeping only stocks with price ≥ $5, volume ≥ 1,000,000 and a known previous close.

`GET /api/movers/gainers`

```json
{
  "direction": "gainers",
  "source": "eod",
  "movers": [
    {"ticker": "NXL", "price": 7.55, "change": 3.27, "change_pct": 76.4019, "prev_close": 4.28,
     "volume": 62336586.517206, "source": "eod", …}
    …
  ]
}
```

## `GET /api/aggs/{ticker}`

OHLCV bars for the chart, from Polygon `/v2/aggs/ticker/{t}/range/...` (adjusted, ascending, at most 5000 bars).

| Query | Default | Notes |
|---|---|---|
| `timeframe` | `1D` | Selects bar size and range (table below). Unknown values fall back to daily bars over 30 days |
| `from`, `to` | derived | `YYYY-MM-DD`. Override the range start and end |
| `multiplier`, `timespan` | `1`, `day` | **Accepted but ignored.** The bar size always comes from `timeframe` |

| `timeframe` | Bar size | Range (UTC dates) | Cache |
|---|---|---|---|
| `1D` | 1 minute | yesterday → today | 60 s |
| `5D` | 5 minutes | 5 days ago → today | 60 s |
| `1M` | 1 day | 30 days ago → today | 10 min |
| `3M` | 1 day | 90 days ago → today | 10 min |
| `1Y` | 1 week | 365 days ago → today | 10 min |

Bar fields: `t` (bar start, epoch ms UTC), `o`, `h`, `l`, `c`, `v`, `vw` (VWAP).

`GET /api/aggs/AAPL?timeframe=1M`

```json
{
  "ticker": "AAPL",
  "timeframe": "1M",
  "bars": [
    {"t": 1788321600000, "o": 326.865, "h": 328.4, "l": 323.53, "c": 324.96, "v": 33776370.489241, "vw": 325.2771},
    {"t": 1788408000000, "o": 324.87, "h": 330.81, "l": 324.11, "c": 328.21, "v": 37225838.643891, "vw": 328.1567}
    …
  ]
}
```

## `GET /api/options/{ticker}`

The options chain snapshot from Polygon `/v3/snapshot/options/{t}`, sorted by strike. **It requires the Polygon Options add-on.**

| Query | Default | Notes |
|---|---|---|
| `limit` | `40` | Contracts to fetch |
| `strike_price_gte`, `strike_price_lte` | — | Optional strike bounds. A value of `0` is ignored |

Contract fields: `contract_type` (`call`/`put`), `strike_price`, `expiration_date`, `bid`, `ask`, `mid`, `iv` (decimal, so 0.25 means 25%), `delta`, `gamma`, `theta`, `vega`, `open_interest`, `volume`.

Without the add-on (the current production response), the status is still `200`:

```json
{"ticker": "AAPL", "options": [], "error": "Options data requires Polygon Options Add-on"}
```

## `GET /api/news/{ticker}`

Recent news tagged with the ticker, newest first, from Polygon `/v2/reference/news`.

| Query | Default |
|---|---|
| `limit` | `10` |

`GET /api/news/AAPL?limit=3`

```json
{
  "ticker": "AAPL",
  "news": [
    {
      "id": "c5577f836e19cffd48604622dfbc66983afec2507c2616021b91a1cd31b13237",
      "title": "Tesla Is the Only Magnificent Seven Stock in the Red for 2026",
      "author": "Daniel Sparks",
      "published_utc": "2026-10-02T02:37:01Z",
      "article_url": "https://www.fool.com/investing/2026/10/01/tesla-is-the-only-magnificent-seven-stock-in-the-red-for-2026/?source=iedfolrf0000001",
      "publisher": "The Motley Fool",
      "description": "Tesla is the only Magnificent Seven stock declining in 2026, …",
      "tickers": ["TSLA", "AAPL", "NVDA", "MSFT", "GOOG", "GOOGL", …]
    }
    …
  ]
}
```

## `GET /api/financials/{ticker}`

The last 4 reported periods (newest first) from Polygon's **experimental, deprecated** `/vX/reference/financials`. The backend fetches 8 filings, sorted by `filing_date` descending, so that it shares the upstream call with `/api/earnings`, and returns the first 4.

| Field | Polygon source |
|---|---|
| `fiscal_period`, `fiscal_year`, `filing_date` | filing metadata (`fiscal_period` is e.g. `Q3`, `FY`) |
| `revenues`, `net_income`, `eps`, `diluted_eps`, `gross_profit`, `operating_income` | income statement (`revenues`, `net_income_loss`, `basic_earnings_per_share`, `diluted_earnings_per_share`, `gross_profit`, `operating_income_loss`) |
| `total_assets`, `total_liabilities`, `equity`, `long_term_debt` | balance sheet |
| `operating_cash_flow` | cash flow statement, `net_cash_flow_from_operating_activities` |

`GET /api/financials/AAPL`

```json
{
  "ticker": "AAPL",
  "financials": [
    {
      "fiscal_period": "Q3", "fiscal_year": "2026", "filing_date": "2026-07-31",
      "revenues": 109417000000.0, "net_income": 29789000000.0,
      "eps": 2.03, "diluted_eps": 2.02,
      "gross_profit": 54770000000.0, "operating_income": 35695000000.0,
      "total_assets": 383266000000.0, "total_liabilities": 275746000000.0,
      "equity": 107520000000.0, "long_term_debt": 82300000000.0,
      "operating_cash_flow": 34369000000.0
    }
    …
  ]
}
```

When the endpoint is denied or in a brownout, the status is still `200`:

```json
{"ticker": "AAPL", "financials": [], "error": "Financials unavailable on current Polygon plan"}
```

## `GET /api/earnings/{ticker}`

Up to 8 recent filings with EPS and revenue. It uses the same upstream call and cache entry as `/api/financials`.

Fields: `fiscal_period`, `fiscal_year`, `filing_date`, `start_date`, `end_date`, `eps` (basic), `revenues`.

```json
{
  "ticker": "AAPL",
  "earnings": [
    {"fiscal_period": "Q3", "fiscal_year": "2026", "filing_date": "2026-07-31",
     "start_date": "2026-03-29", "end_date": "2026-06-27", "eps": 2.03, "revenues": 109417000000.0}
    …
  ]
}
```

These are *reported* results by filing date. There are no consensus estimates and no upcoming earnings dates. When denied, the response is `{"ticker": ..., "earnings": [], "error": "Earnings data unavailable on current Polygon plan"}`.

## `GET /api/economic-events`

The macro calendar, generated in the backend (`_macro_events`). It makes no upstream request. It covers events from **90 days ago to 180 days ahead** (UTC dates), sorted by date.

| Field | Values |
|---|---|
| `date` | `YYYY-MM-DD` |
| `event` | e.g. `FOMC Rate Decision`, `FOMC Rate Decision + SEP`, `CPI Inflation Report`, `Non-Farm Payrolls`, `GDP Advance Estimate Q3 2026`. Estimated dates end in ` (est.)` |
| `category` | `FED` or `ECON` |
| `importance` | `HIGH`, or `MED` for GDP second and third estimates |
| `estimated` | `true` only on rule-based estimates. The field is absent otherwise |

```json
{
  "events": [
    {"date": "2026-10-02", "event": "Non-Farm Payrolls", "category": "ECON", "importance": "HIGH"},
    {"date": "2026-10-14", "event": "CPI Inflation Report", "category": "ECON", "importance": "HIGH"},
    {"date": "2026-10-28", "event": "FOMC Rate Decision", "category": "FED", "importance": "HIGH"},
    {"date": "2026-10-29", "event": "GDP Advance Estimate Q3 2026", "category": "ECON", "importance": "HIGH"},
    …
    {"date": "2027-01-08", "event": "Non-Farm Payrolls (est.)", "category": "ECON", "importance": "HIGH", "estimated": true},
    {"date": "2027-01-27", "event": "FOMC Rate Decision", "category": "FED", "importance": "HIGH"},
    …
  ]
}
```

Sources and estimation rules are in [DATA-SOURCES.md](DATA-SOURCES.md#economic-calendar).

## `GET /api/ticker-details/{ticker}`

Company reference data from Polygon `/v3/reference/tickers/{t}`.

`GET /api/ticker-details/AAPL`

```json
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "description": "Apple is among the largest companies in the world, …",
  "market_cap": 4820749537600.0,
  "share_class_shares_outstanding": 14594180000,
  "weighted_shares_outstanding": 14594180000,
  "primary_exchange": "XNAS",
  "type": "CS",
  "currency_name": "usd",
  "homepage_url": "https://www.apple.com",
  "list_date": "1980-12-12",
  "sic_description": "ELECTRONIC COMPUTERS"
}
```

An unknown ticker passes Polygon's error status through (usually 404, with `detail` `"Data provider error (HTTP 404)"`), since this endpoint has no fallback.
