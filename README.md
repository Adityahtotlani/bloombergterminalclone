# Bloomberg Terminal Clone

A Bloomberg-style market terminal that runs in the browser. It has a dark, amber-on-black, keyboard-first layout. You pick a US stock ticker and see its quote, a candlestick chart, news, fundamentals, an options chain, an economic calendar, a watchlist and the day's top movers on one screen.

- **Frontend:** React 19 + Vite, charts from [lightweight-charts](https://github.com/tradingview/lightweight-charts) (`frontend/`)
- **Backend:** a FastAPI proxy in front of the [Polygon.io](https://polygon.io) market-data API (Polygon has rebranded as *Massive*) (`backend/main.py`)
- **Live instance:** <https://bloomberg.adityatotlani.ch> (app) and <https://bloomberg-api.adityatotlani.ch> (API, which redirects to its interactive `/docs`)

> **Informational only.** This is a personal or educational project. It is not affiliated with Bloomberg L.P. Data may be delayed, end-of-day, estimated or incomplete. Nothing shown is investment advice or a recommendation to buy or sell any security. Don't use it to make trading decisions.

## Features

| Area | What it shows |
|---|---|
| Top bar | Ticker search with autocomplete (press **F1**, or just start typing), clocks for New York, London and Tokyo, and a backend connection indicator |
| QUOTE | Last price, change, bid and ask, session OHLC, VWAP, volume, market cap, shares outstanding, sector and listing date |
| Chart | Candlesticks with volume. Timeframes are 1D, 5D, 1M, 3M and 1Y, and an OHLC readout follows the crosshair |
| OPTIONS CHAIN | Calls and puts by strike, with bid, ask, IV, delta, OI and volume (needs the Polygon Options add-on) |
| NEWS FEED | The latest articles tagged with the ticker. Click one to open it |
| FUNDAMENTALS | The last 4 reported periods: income statement, balance sheet, operating cash flow and debt/equity |
| ECONOMIC CALENDAR | MACRO tab with FOMC, CPI, jobs report and GDP dates from the official sources. EARNINGS tab with the ticker's recent filings, EPS and revenue |
| MONITOR | A watchlist saved in your browser, plus top gainers and losers |
| PORT (portfolio) | Holdings with market value, unrealized and day P&L, and weights. Uses exact decimal math and is stored only in your browser. See the [methodology](docs/DATA-SOURCES.md#portfolio-pl-methodology) |

The backend is built to make the most of a small API quota. Upstream calls wait in a fair (FIFO) queue, identical calls share one request, and responses are cached. When the plan doesn't include live snapshots, quotes fall back to end-of-day (EOD) data. The UI labels that data **EOD · DELAYED**.

## Quick start (local)

Requirements: Python 3.11+ and Node.js 20.19+ or 22.12+ (required by Vite 8). You also need a Polygon.io (Massive) API key. The free tier works, with the limits described under [Data and plan caveats](#data-and-plan-caveats).

```bash
./start.sh
```

On the first run, `start.sh` creates `backend/.venv`, installs the Python requirements, copies `backend/.env.example` to `backend/.env`, and then **exits** so you can add your key:

```bash
# backend/.env
POLYGON_API_KEY=your_key_here
POLYGON_RATE_LIMIT=5
```

Run `./start.sh` again. It installs `frontend/node_modules` if needed and starts both servers:

| Service | URL |
|---|---|
| Frontend (Vite dev server) | <http://localhost:5173> |
| Backend (uvicorn, `--reload`) | <http://localhost:8000> |
| API docs (Swagger UI) | <http://localhost:8000/docs> |

Press Ctrl+C to stop both.

To run the two halves by hand:

```bash
# backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload

# frontend (in a second shell)
cd frontend
npm install
npm run dev          # proxies /api to $API_PROXY_TARGET (default http://localhost:8000)
```

## Configuration

| Setting | Where | Default | Meaning |
|---|---|---|---|
| `POLYGON_API_KEY` | `backend/.env` | *(empty)* | Your Polygon.io/Massive API key. The backend logs a warning at startup if it's missing. Never commit it, because `backend/.env` is git-ignored. |
| `POLYGON_RATE_LIMIT` | `backend/.env` | `5` | Upstream requests per minute that the backend allows itself. Free tier is 5. Raise it after you upgrade the plan. |
| `API_PROXY_TARGET` | environment of the Vite process | `http://localhost:8000` | Where the frontend's `/api` requests are proxied (`frontend/vite.config.js`). |

The CORS allow-list and the Vite `allowedHosts` are hard-coded in `backend/main.py` and `frontend/vite.config.js`. Edit them there if you serve the app from another hostname.

## Data and plan caveats

The deployed key is on Polygon's **free tier**:

- **5 requests per minute** for the whole app. Every user and every panel shares this budget, so after a ticker switch the panels can take up to about a minute to fill.
- **No live snapshots.** Quotes, the watchlist and movers fall back to the last two completed sessions' daily bars and are labelled EOD. There is no bid or ask.
- **Options need a paid add-on.** On the free tier the OPTIONS CHAIN panel says so instead of showing data.
- **Financials come from Polygon's experimental `vX` endpoint**, which is deprecated and sometimes returns HTTP 410 during brownouts. When it does, FUNDAMENTALS and EARNINGS show an "unavailable" message for a few minutes.
- **Economic calendar dates** are hard-coded from the Fed, BLS and BEA schedules. Dates past the published schedules are rule-based estimates marked "(est.)". The lists need updating once a year.

Details are in [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

## Documentation

| Doc | For |
|---|---|
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | Using the terminal: panels, shortcuts, indicators and messages |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit: request flow, rate limiter, caching, coalescing and EOD fallback |
| [docs/API.md](docs/API.md) | Every backend endpoint with parameters, response shapes, examples, errors and cache lifetimes |
| [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) | Provider, plan entitlements, live vs EOD data, calendar sources, the yearly update procedure and estimation rules |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Production runbook: services, deploys, logs, key rotation, plan upgrades and troubleshooting |
| [frontend/README.md](frontend/README.md) | Frontend layout and scripts |

## Repository layout

```text
backend/
  main.py            FastAPI app: endpoints, rate limiter, caches, EOD fallback, macro calendar
  requirements.txt
  .env.example       copy to .env and add your key
frontend/
  src/App.jsx        layout and per-ticker data loading
  src/api.js         axios wrappers for /api/*
  src/components/    one component per panel
  src/lib/portfolio.js  portfolio P&L math (fixed-point BigInt)
  scripts/           node:test checks for the portfolio math (npm test)
  vite.config.js     dev/preview server and /api proxy
docs/                detailed documentation
start.sh             local dev launcher
```

This project is kept identical in two places: as the `bloombergterminalclone/` folder of [Adityahtotlani/projects](https://github.com/Adityahtotlani/projects), and as the standalone repo [Adityahtotlani/bloombergterminalclone](https://github.com/Adityahtotlani/bloombergterminalclone). All paths in these docs are relative to the project root, so they work in both.
