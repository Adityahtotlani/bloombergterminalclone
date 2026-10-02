# Frontend

The React 19 + Vite UI for the Bloomberg Terminal clone. Project-level docs are in the root [README](../README.md) and [`docs/`](../docs/). Start with the [User Guide](../docs/USER-GUIDE.md) and [Architecture](../docs/ARCHITECTURE.md).

## Scripts

Requires Node.js 20.19+ or 22.12+ (the Vite 8 requirement).

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Dev server on port 5173 with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve `dist/` (how production runs, via the `bbg-web` systemd unit) |
| `npm run lint` | ESLint |
| `npm test` | Node's built-in test runner over `scripts/` (portfolio math checks) |

The app calls relative `/api/...` URLs. Vite proxies them to `API_PROXY_TARGET`, which defaults to `http://localhost:8000`, so the backend must be running:

```bash
API_PROXY_TARGET=http://127.0.0.1:8010 npm run dev   # point at a backend on another port
```

From the project root, `./start.sh` starts the backend and this dev server together.

## Layout

| Path | Contents |
|---|---|
| `src/App.jsx` | Page layout, per-ticker loading (parallel requests, abort on ticker or timeframe switch, 502/503/504 retry), 2 s quote polling, health check and data mode |
| `src/api.js` | axios wrappers for every `/api/*` endpoint ([API reference](../docs/API.md)) |
| `src/components/TopBar.jsx` | Ticker search (F1), world clocks, LIVE / EOD DATA / CONNECTED / DISCONNECTED indicator |
| `src/components/QuotePanel.jsx` | Quote, session stats, company info, EOD label |
| `src/components/ChartPanel.jsx` | lightweight-charts candlestick and volume chart with timeframe buttons |
| `src/components/OptionsPanel.jsx`, `NewsPanel.jsx`, `FinancialsPanel.jsx`, `CalendarPanel.jsx` | Bottom-row panels |
| `src/components/MonitorPanel.jsx` | WATCH / GAINERS / LOSERS / PORT tabs |
| `src/lib/portfolio.js` | Pure portfolio P&L math, using fixed-point BigInt ([methodology](../docs/DATA-SOURCES.md#portfolio-pl-methodology)) |
| `src/lib/limits.js` | Limits mirrored from `backend/main.py` (`MAX_WATCHLIST` = 50, used by WATCH and PORT) |
| `scripts/test-portfolio.mjs` | `node:test` checks for `portfolio.js` |
| `vite.config.js` | Dev and preview server, `/api` proxy, allowed hosts |

Browser storage: `localStorage` keys `bbg.watchlist` and `bbg.portfolio`.
