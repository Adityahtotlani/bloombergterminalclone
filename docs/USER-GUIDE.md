# User Guide

How to use the terminal at <https://bloomberg.adityatotlani.ch>, or at <http://localhost:5173> when running locally.

> **Informational only.** Prices may be end-of-day or delayed, calendar dates may be estimates, and nothing on screen is investment advice.

## Screen layout

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ BBG TERMINAL  [TICKER SEARCH]   NY hh:mm:ss  LON …  TKY …        ● EOD DATA    │
├──────────┬─────────────────────────────────────────────────────────┬──────────┤
│          │ CHART  [1D][5D][1M][3M][1Y]   O H L C                    │ MONITOR  │
│  QUOTE   │                                                         │ WATCH    │
│          │                                                         │ GAINERS  │
│          ├──────────────┬────────────┬──────────────┬──────────────┤ LOSERS   │
│          │ OPTIONS CHAIN│ NEWS FEED  │ FUNDAMENTALS │ ECONOMIC CAL.│ PORT     │
└──────────┴──────────────┴────────────┴──────────────┴──────────────┴──────────┘
```

The layout is fixed-size and designed for a desktop browser window.

## Getting started

1. Press **F1**, or just start typing letters or digits anywhere outside a text box. Either one focuses the ticker search.
2. Type a symbol or company name. After a short pause (about 0.5 s), up to 10 matching US stocks appear.
3. Click a suggestion, or press **Enter** to load exactly what you typed.

Every panel then loads that ticker at once. On the current free data plan the whole app shares 5 data requests per minute, so panels fill in one by one and the last can take up to about a minute. A panel stays on **LOADING…** while it waits its turn, and it retries on its own if the data provider is busy.

Switching tickers cancels the previous ticker's pending requests, so you don't wait behind data you no longer need.

## Keyboard shortcuts

| Key | Where | Action |
|---|---|---|
| **F1** | anywhere | Focus the ticker search and select its text |
| any letter or digit | anywhere outside a text box | Focus the ticker search |
| **Enter** | ticker search | Load the typed ticker |
| **Esc** | ticker search | Close the suggestion list |
| **Enter** | WATCH "ADD SYMBOL" box | Add the symbol to the watchlist |
| **Enter** | PORT inputs | ADD the lot (or SET when editing) |
| **Esc** | PORT inputs | Clear the form and cancel editing |

## Top bar

- **Ticker search**, described above. Search results are remembered for the session, so retyping a query is instant.
- **World clocks:** New York, London and Tokyo, 24-hour, updated every second.
- **Connection and data indicator** (top right), checked against `/api/health` every 10 s:

  | Indicator | Meaning |
  |---|---|
  | **LIVE** (green) | Backend reachable and quotes come from live snapshots |
  | **EOD DATA** (amber) | Backend reachable, but the data plan has no live quotes, so prices are end-of-day. This is the normal state on the free plan |
  | **API KEY ERROR** (red) | Backend reachable, but the data provider rejected its API key, so no data loads (not even end-of-day). Panels show "Data provider rejected the API key…". The server operator needs to fix the key. See [OPERATIONS.md](OPERATIONS.md#api-key-error-in-the-top-bar) |
  | **CONNECTED** (grey) | Backend reachable, but it has no record of data freshness yet: a fresh install, or the last check is more than 48 hours old. It changes after the next quote loads |
  | **DISCONNECTED** (red) | The browser can't reach the backend |

  LIVE and EOD DATA show the most recent result the backend has seen, and it remembers that result across restarts, so the indicator is correct as soon as the page loads. Hover the indicator for an explanation.

  Individual panels also show **EOD · DELAYED** / **END-OF-DAY DATA**, described below.

## QUOTE panel (left)

| Section | Fields |
|---|---|
| Header | Ticker, company name, primary exchange (e.g. `XNAS`) |
| Price | Last price (green if up on the day, red if down), change and % change, previous close |
| QUOTE | Bid, ask, bid size, ask size |
| SESSION | Open, high, low, close, VWAP, volume |
| COMPANY | Market cap, shares outstanding, sector (SIC description), listing date |

The quote refreshes every 2 seconds. Large numbers use K/M/B/T suffixes. `---` means the value isn't available.

### EOD · DELAYED

When **EOD · DELAYED** appears under the price, the current data plan doesn't include live quotes. The panel then shows the **close of the last completed trading session**, and the change is measured against the session before it. Bid and ask show `---` in this mode. Hover the label for the explanation.

## Chart

- Candlesticks (green up, red down) with volume bars underneath.
- **Timeframes:** 1D (1-minute bars), 5D (5-minute bars), 1M and 3M (daily bars), 1Y (weekly bars). The default is 1M.
- Move the mouse over the chart for that bar's **O H L C** in the toolbar.
- Scroll to zoom and drag to pan. These are standard lightweight-charts controls.
- The time axis is in **UTC**.
- On weekends and early Monday, the 1D chart can be empty because it only covers yesterday and today (UTC). Use 5D instead.

## OPTIONS CHAIN

A calls | strike | puts table. Each side shows expiry (MM-DD), bid, ask, IV %, delta (Δ), open interest and volume. It shows up to 8 rows: the first 8 calls and the first 8 puts, by strike, are placed side by side.

On the current plan this panel shows **"OPTIONS DATA REQUIRES POLYGON OPTIONS ADD-ON"**, because options need a paid data add-on.

## NEWS FEED

The 10 most recent articles tagged with the ticker. Each shows the publisher, the time (in your local time zone), the headline, a two-line summary, and up to 5 related tickers when the article covers several. **Click an article** to open it in a new tab.

## FUNDAMENTALS

The last 4 reported periods side by side (e.g. `Q3 2026`, `FY 2025`):

- **Income statement:** revenue, gross profit, operating income, net income, EPS (basic and diluted)
- **Balance sheet:** total assets, total liabilities, equity, long-term debt, Debt/Equity (= LT debt ÷ equity)
- **Cash flow:** operating cash flow

Profit lines are green when positive and red when negative. The data comes from company filings via the provider and is cached for an hour. If the provider's financials service is temporarily withdrawn, the panel shows **"FINANCIALS UNAVAILABLE ON CURRENT POLYGON PLAN"** for a few minutes and then recovers.

## ECONOMIC CALENDAR

Two tabs:

- **MACRO** (default): FOMC rate decisions (category `FED`; `+ SEP` means new economic projections are published), and CPI, Non-Farm Payrolls and GDP releases (category `ECON`). It covers about 3 months back to 6 months ahead. Each event shows its importance (`HIGH` red, `MED` amber) and date. Past events are dimmed, and today's are highlighted and labelled **TODAY**. Events ending in **(est.)** are estimates made by rule because the agency hasn't published that date yet. See [DATA-SOURCES.md](DATA-SOURCES.md#economic-calendar).
- **EARNINGS:** the loaded ticker's recent reported periods with filing date, basic EPS and revenue. These are past results, not upcoming report dates or analyst estimates. If the financials service is unavailable, the tab shows the reason, for example **EARNINGS DATA UNAVAILABLE ON CURRENT POLYGON PLAN**.

## MONITOR column (right)

Four tabs. Click any row to load that ticker. The row for the currently loaded ticker has an amber left border.

If a refresh fails, the tab keeps showing the last data it had and tries again at the next refresh. An error message (in red) appears only when the tab has no data yet; see [Panel messages](#panel-messages).

### WATCH

- A watchlist that refreshes every 15 seconds. It starts as SPY, QQQ, AAPL, MSFT, NVDA, AMZN, GOOGL, META and TSLA.
- **Add:** type a symbol in **ADD SYMBOL** and press Enter, or click **+CUR** to add the ticker currently loaded.
- **Remove:** hover a row and click **×**.
- Rows flash green or red briefly when the price ticks up or down.
- The list is saved in this browser (`localStorage`). It isn't synced between devices or browsers, and clearing site data resets it to the defaults.
- **At most 50 symbols**, the most the server prices in one request. At 50, the add box and **+CUR** are disabled and **WATCHLIST FULL (50)** appears. Remove a symbol to add another. A saved list longer than 50 (from before the cap existed) is cut to its first 50 when the page loads.

### GAINERS / LOSERS

The top 20 stocks by % change, refreshed every minute while the tab is open. Hover a row to see its volume. On the current plan they're computed from the last two sessions' closes and limited to stocks priced at $5 or more with at least 1M shares of volume, so illiquid penny stocks don't flood the list.

### Portfolio (PORT tab)

Track holdings and their profit and loss. All the math runs in your browser.

**Adding a position**

1. Open the **PORT** tab.
2. Fill in **SYM** (ticker), **QTY** (shares) and **COST** (average cost per share, in USD). If SYM is left empty, the currently loaded ticker is used, and the box shows it as a placeholder.
3. Click **ADD** or press Enter.

If you add a ticker you already hold, the new lot is **merged**: quantities add up and the average cost becomes the quantity-weighted average. For example, 10 @ 100 plus 30 @ 200 gives 40 @ 175. The hint under the form says `MERGE INTO <TICKER> · WEIGHTED AVG COST` when this will happen.

**Editing and removing.** Hover a row:

- **✎** loads the position into the form (the ticker is locked). Change QTY and COST and click **SET**. This **replaces** the position instead of merging. **CANCEL** or Esc abandons the edit.
- **×** removes the position.

**Input rules.** Errors show in red under the form:

| Field | Rule | Error |
|---|---|---|
| Ticker | 1–10 characters: letters, digits, `.` or `-` | `INVALID TICKER` |
| Quantity | Greater than 0, at most 6 decimal places | `QTY MUST BE > 0 (MAX 6 DP)` |
| Cost | 0 or more, at most 6 decimal places | `COST MUST BE >= 0 (MAX 6 DP)` |
| Count | At most 50 different tickers | `MAX 50 HOLDINGS` |

Numbers must be plain decimals such as `12`, `0.5` or `1234.56`. No commas, no exponent notation, no leading `.`. Values with more than 6 decimals are **rejected, not rounded**.

**What each row shows**

- Line 1: ticker, `quantity @ average cost`, and weight (% of priced market value)
- Line 2: **LAST** price and **MV** (market value)
- Line 3: unrealized P&L in $ and %, and **DAY** P&L in $
- Hover the row for the exact average cost and total cost basis.

**Summary header**

| Line | Meaning |
|---|---|
| MKT VAL | Total market value of holdings that have a price |
| COST | Total cost basis of those same holdings |
| UNRL P&L | MKT VAL − COST, in $ and % |
| DAY P&L | Change since the previous close, in $ and % |
| PARTIAL · n/m PRICED | Only *n* of your *m* holdings have a price. The rest are left out of all totals and weights (and `· DAY k/n` if some lack a previous close) |

An **END-OF-DAY DATA** footer means the prices are last-session closes, so **DAY P&L is the last session's move, not today's**.

**Good to know**

- Prices refresh every 15 seconds and use the same data feed as WATCH. Using PORT adds no load on the data quota.
- Holdings are saved **only in this browser** (`localStorage` key `bbg.portfolio`). They're not shared, synced or backed up. Clearing site data deletes them.
- Cost bases aren't adjusted for stock splits, but prices are. After a split, edit the position.
- US stocks in USD only. There's no cash, dividends, fees or realized P&L.
- Totals are exact to the cent: amounts are computed with exact decimal arithmetic and rounded only for display. Methodology and a worked example are in [DATA-SOURCES.md](DATA-SOURCES.md#portfolio-pl-methodology).

## Panel messages

| Message | Meaning | What to do |
|---|---|---|
| `LOADING…` | Waiting for data. On the free plan, requests queue for the shared 5/min quota | Wait. Panels retry on their own (up to 4 tries, 3 s apart) when the provider is busy, unreachable or slow |
| `ENTER TICKER TO BEGIN` / `SELECT A TICKER TO VIEW CHART` / `ENTER A TICKER` | No ticker loaded yet | Search for one |
| `EOD · DELAYED` / `END-OF-DAY DATA` | Last completed session's data, not live | Expected on the free plan |
| `OPTIONS DATA REQUIRES POLYGON OPTIONS ADD-ON` | The plan doesn't include options | Needs a plan upgrade |
| `FINANCIALS UNAVAILABLE ON CURRENT POLYGON PLAN` / `EARNINGS DATA UNAVAILABLE ON CURRENT POLYGON PLAN` | Plan or deprecation issue with the financials service (often a temporary 410 brownout) | Try again in about 5 minutes |
| `DATA PROVIDER RATE LIMIT BUSY — RETRY SHORTLY` | The panel waited 75 s and still had no quota slot, even after retries | Re-select the ticker in a minute. Avoid rapid ticker switching |
| `DATA PROVIDER TIMED OUT — RETRY SHORTLY` / `DATA PROVIDER UNREACHABLE — RETRY SHORTLY` | The data provider didn't answer in 15 s, or couldn't be reached, even after retries | Re-select the ticker in a minute. If it persists, see [OPERATIONS.md](OPERATIONS.md#troubleshooting) |
| `NO NEWS DATA` / `NO FINANCIAL DATA` / `NO OPTIONS DATA` / `NO EARNINGS DATA` | The provider returned nothing for this ticker | Try another ticker, e.g. ETFs have no fundamentals |
| `WATCHLIST FULL (50)` | The watchlist has reached its 50-symbol limit | Remove a symbol to add another |
| `NO DATA — MARKET MAY BE CLOSED` | The movers list is empty | Check again later |
| `Data provider error (HTTP 500) — retry shortly` / `Data provider error (HTTP 404)` (capitalised in some panels) | The data provider answered with an unexpected error. A 404 usually means it doesn't know the symbol | For 5xx, retry in a minute. For 404, check the symbol |
| `REQUEST FAILED` | An unexpected error with no readable reason | Retry. If it persists, see [OPERATIONS.md](OPERATIONS.md#troubleshooting) |
| `DISCONNECTED` (top right, red) | The backend is unreachable | The server or tunnel is down. See OPERATIONS |
| `API KEY ERROR` (top right, red) / `Data provider rejected the API key — check POLYGON_API_KEY…` in panels | The data provider rejected the server's API key. Retrying won't help | Tell the operator. See [OPERATIONS.md](OPERATIONS.md#api-key-error-in-the-top-bar) |
| `---` | That individual value isn't available | — |

## Time zones at a glance

- Clocks: New York, London and Tokyo
- Chart axis: UTC
- News times: your browser's local time zone
- Calendar: calendar dates only. US releases are usually at 8:30 AM ET. "TODAY" is based on the UTC date when the page loaded
