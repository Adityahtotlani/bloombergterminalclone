# Data Sources and Methodology

This document covers where every number in the terminal comes from, how fresh it is, what the current plan does and doesn't include, and how the calculated figures (portfolio P&L, calendar estimates) are produced.

> **Informational only.** Data may be delayed, end-of-day, estimated, incomplete or wrong. Nothing here is investment advice. Check against an authoritative source before relying on any figure.

## Market-data provider

All market data comes from **[Polygon.io](https://polygon.io)**, which has rebranded as **Massive**. The backend calls `https://api.polygon.io` (`BASE_URL` in `backend/main.py`) with the key from `backend/.env` (`POLYGON_API_KEY`). The key is added on the server and never sent to the browser.

### Current plan: free tier

| Capability | Free tier (current key) | What the app does |
|---|---|---|
| Request quota | **5 requests/minute** | A FIFO queue paces every upstream call app-wide. Requests that wait longer than 75 s get a 503, and the UI retries them (and 502/504 provider errors) (see [ARCHITECTURE.md](ARCHITECTURE.md)) |
| Live snapshots (`/v2/snapshot/...`), which supply last trade, NBBO, today's bar and movers | **Not entitled (403)** | Falls back to **end-of-day** data built from daily bars, labelled EOD |
| Daily and intraday aggregates (`/v2/aggs/...`) | Available | Charts. The grouped-daily bars also feed the EOD fallback |
| Reference data (ticker search, ticker details) | Available | Search box and the company section of the QUOTE panel |
| News (`/v2/reference/news`) | Available | NEWS FEED |
| Financials (`/vX/reference/financials`) | Available, but the endpoint is **experimental and deprecated**. Polygon runs brownouts that return **410** at times | FUNDAMENTALS and EARNINGS. During a 410 the panels show "unavailable" for 5 minutes, then retry |
| Options snapshot (`/v3/snapshot/options/...`) | **Not entitled (403)**. Needs an options add-on or plan | OPTIONS CHAIN shows "Options data requires Polygon Options Add-on" |

Entitlement failures are remembered so they don't waste quota: 403 for 30 minutes, 410 for 5 minutes (`DENIAL_TTL`). After that the backend probes again once, so an upgraded key is picked up within 30 minutes even without a restart. A restart picks it up at once.

### Live vs end-of-day

| Data | With a snapshot-entitled plan | On the free tier |
|---|---|---|
| Quote price | Last trade, else last minute bar, else today's close, else previous close | Close of the **last completed session** |
| Change / % | vs previous session close | Last session close vs the session before it |
| Bid / ask | Live NBBO | Not available (`---`) |
| Watchlist, PORT prices | Live snapshot, batched | The last session's grouped-daily bars |
| Gainers / losers | Polygon's live movers list (unfiltered top 20) | Computed from the last two sessions, filtered to price ≥ $5 and volume ≥ 1M |
| Charts | Aggregates (adjusted for splits) | Same |

**How the UI labels it:** a quote with `source: "eod"` shows **EOD · DELAYED** under the price. The WATCH, GAINERS, LOSERS and PORT tabs show an **END-OF-DAY DATA** footer.

**How the EOD table is built** (`_eod_market`): SPY's last two daily bars identify the last two trading sessions. The grouped-daily bars for both sessions give, for every US stock, the last close and the previous close. The table is cached for 10 minutes and holds whatever session Polygon reports as complete.

### Refresh cadence and caching

| Data | UI refresh | Backend cache |
|---|---|---|
| Active quote | every 2 s | 10 s (live) / 10 min (EOD) |
| Watchlist / PORT | every 15 s, visible tab only | 10 s (live) / 10 min (EOD) |
| Gainers / losers | every 60 s, while visible | 10 s (live) / 10 min (EOD) |
| Chart | on ticker or timeframe change | 60 s for 1D/5D, 10 min otherwise |
| News | on ticker change | 5 min |
| Options | on ticker change | 60 s |
| Fundamentals / earnings / ticker details / search | on ticker change or typing | 1 h |
| Economic calendar | once per page load | computed locally, no upstream |

Refreshing faster than the backend cache only re-reads the cache. It doesn't fetch newer data.

### Other data caveats

- **Corporate actions:** charts and EOD bars are split- and dividend-adjusted (`adjusted=true`). Portfolio cost bases you enter are *not* adjusted (see below).
- **Fundamentals** are as-reported figures from XBRL filings via Polygon. Coverage and field availability vary by company, and missing fields show `---`. Debt/Equity in the UI is `long_term_debt / equity`.
- **Earnings** are past filings (EPS, revenue, filing date), not consensus estimates or upcoming report dates.
- **Universe:** US-listed stocks and ETFs, priced in USD.

## Economic calendar

The MACRO tab comes from `_macro_events()` in `backend/main.py`. It uses **no external API**. Official release dates are hard-coded from each agency's published schedule. Past the end of a published schedule, the code adds **rule-based estimates** marked `(est.)` with `"estimated": true`. The endpoint returns events dated from **90 days ago to 180 days ahead** (UTC).

### Sources

| Event | Agency and schedule | Code | Release time |
|---|---|---|---|
| FOMC rate decision (second day of each meeting; `+ SEP` when a Summary of Economic Projections is published) | Federal Reserve: <https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm> | `fomc_dates` dict (`date → has_SEP`) | Not shown (the statement is normally at 2:00 PM ET) |
| CPI | BLS: <https://www.bls.gov/schedule/news_release/cpi.htm> | `cpi_dates` list | 8:30 AM ET |
| Non-Farm Payrolls (Employment Situation) | BLS: <https://www.bls.gov/schedule/news_release/empsit.htm> | `nfp_dates` list | 8:30 AM ET |
| GDP (advance, second and third estimates) | BEA: <https://www.bea.gov/news/schedule/full> | `gdp_releases` list of `(date, stage, quarter)` | 8:30 AM ET |

Release times aren't displayed in the UI. Dates are plain calendar dates.

### Current coverage

| Series | Official dates through | Then |
|---|---|---|
| FOMC | 2027-12-08 | **No estimates.** Meetings past the last listed date simply don't appear |
| CPI | 2026-12-10 | 12 months of estimates (2027) |
| NFP | 2026-12-04 | 12 months of estimates (2027) |
| GDP | 2026-12-23 | Advance-estimate estimates for Jan/Apr/Jul/Oct 2027 |

### Estimation rules

Each series is estimated for the 12 months after its last official date:

| Series | Rule | Function |
|---|---|---|
| CPI | The 13th of the month, moved forward to the next Tuesday–Friday if it falls on Saturday, Sunday or Monday (Mondays are skipped because they're often holidays). Other holidays aren't modelled | inline in `_macro_events` |
| NFP | BLS rule: the **third Friday after the survey week**, the Sunday–Saturday week containing the 12th of the previous month. Moved a week later if it lands on 1–2 January, and a day earlier if it lands on 3–4 July. The comment in the code notes this reproduces 11 of the 13 official 2026 dates. The misses were one-off reschedulings | `_nfp_release_estimate` |
| GDP | Only the **advance** estimate, on the **last Thursday** of January, April, July and October, for the prior quarter (January means Q4 of the previous year). Second and third estimates aren't estimated | `_last_weekday` |
| FOMC | Not estimated, since the Fed publishes its calendar well ahead | — |

Estimated dates can be wrong by days, especially around holidays or government shutdowns. Always check the agency's page.

### Yearly update procedure

Do this when the agencies publish the next year's schedules. The Fed usually publishes the following year's tentative FOMC calendar in the summer. BLS and BEA usually publish theirs late in the year. At the latest, do it before the 180-day look-ahead runs past the last official date.

1. **FOMC:** open the Fed calendar page. For each meeting of the new year, add the **second (decision) day** to `fomc_dates` in `backend/main.py` as `"YYYY-MM-DD": True` if the meeting is marked with a Summary of Economic Projections (usually March, June, September and December), otherwise `False`. Fix any existing dates the Fed has moved.
2. **CPI:** open the BLS CPI schedule and append the new year's release dates to `cpi_dates`. Keep the list sorted, because the estimates start from the last item.
3. **NFP:** open the BLS Employment Situation schedule and append the dates to `nfp_dates`, again sorted.
4. **GDP:** open the BEA schedule, filter to "GDP" releases, and append `("YYYY-MM-DD", "Advance"|"Second"|"Third", "Qn YYYY")` tuples to `gdp_releases`, sorted by date. Advance releases are shown as HIGH importance and the others as MED.
5. Optionally, drop entries older than about 90 days. They fall outside the window anyway.
6. Check locally that the new dates appear and `(est.)` entries only start after them:

   ```bash
   cd backend && python3 -c "import main, json; print(json.dumps(main._macro_events(), indent=1))"
   ```

7. Commit, deploy (`sudo systemctl restart bbg-api`, see [OPERATIONS.md](OPERATIONS.md)), and check `https://bloomberg-api.adityatotlani.ch/api/economic-events`.

If an agency reschedules a release, edit the hard-coded date. The estimate rules only apply after the last official entry.

## Portfolio P&L methodology

The PORT tab (see [USER-GUIDE.md](USER-GUIDE.md#portfolio-port-tab)) values your holdings in the browser. The source of truth is `frontend/src/lib/portfolio.js`, with tests in `frontend/scripts/test-portfolio.mjs` (`npm test` in `frontend/`).

### Money representation

- Calculations use **exact fixed-point integers** (JavaScript `BigInt`), never binary floating point.
  - Quantity is in **micro-shares** (6 decimals, `QTY_DP`).
  - Per-share price is in **micro-dollars** (6 decimals, `PRICE_DP`).
  - Amounts (quantity × price) have 12 decimals (`AMOUNT_DP`).
- Each holding stores its **total cost basis** (Σ qty × cost of each lot), not an average cost, so merging lots is an exact sum.
- API prices arrive as JSON numbers and are converted to micro-dollars once (`toPriceUnits`). A missing, zero or negative price counts as **unpriced**, never as $0.
- Amounts are rounded to cents with **banker's rounding** (round half to even) **only for display** (`formatAmount`). For example, $0.005 shows as 0.00, $0.015 as 0.02 and $0.025 as 0.02.
- Percentages and weights are ordinary floating-point numbers. They're statistics, not money.

### Formulas

For a holding with quantity *q*, total cost basis *B*, last price *P* and previous close *P₀*:

| Figure | Formula |
|---|---|
| Average cost | *B* / *q* (half-even, to micro-dollars) |
| Market value (MV) | *q* × *P* |
| Unrealized P&L | MV − *B* |
| Unrealized % | (MV − *B*) / *B* × 100 |
| Day P&L | (*P* − *P₀*) × *q* |
| Weight | MV / Σ MV of priced holdings × 100 |

Portfolio totals:

| Figure | Formula |
|---|---|
| MKT VAL | Σ MV over **priced** holdings |
| COST | Σ *B* over **priced** holdings, so that the unrealized % compares like with like |
| UNRL P&L | MKT VAL − COST, and % = UNRL / COST |
| DAY P&L | Σ day P&L over holdings that have both *P* and *P₀*, and % = DAY / Σ(*P₀* × *q*) over the same holdings |

Holdings with no price are left out of every total and of the weights. The header then shows `PARTIAL · n/m PRICED`, plus `· DAY k/n` when some priced holdings have no previous close.

**Merging lots:** adding 10 @ 100 and then 30 @ 200 gives one position of 40 shares with basis 1,000 + 6,000 = 7,000, so the average cost is 175.00.

### Worked example

Holdings: **AAPL 10 @ 250.00** and **MSFT 5.5 @ 480.00**. EOD prices: AAPL 330.32 (previous close 333.02) and MSFT 512.80 (previous close 512.90).

| | AAPL | MSFT | Total |
|---|---|---|---|
| Cost basis | 10 × 250 = 2,500.00 | 5.5 × 480 = 2,640.00 | **5,140.00** |
| Market value | 10 × 330.32 = 3,303.20 | 5.5 × 512.80 = 2,820.40 | **6,123.60** |
| Unrealized P&L | +803.20 (+32.13%) | +180.40 (+6.83%) | **+983.60 (+19.14%)** |
| Day P&L | (330.32 − 333.02) × 10 = −27.00 | (512.80 − 512.90) × 5.5 = −0.55 | **−27.55** |
| Previous-close value | 3,330.20 | 2,820.95 | 6,151.15 → day % = −27.55 / 6,151.15 = **−0.45%** |
| Weight | 53.9% | 46.1% | 100% |

These figures were checked by running `valuePortfolio` from `frontend/src/lib/portfolio.js`.

### Prices and caveats

- Prices come from the same `/api/watchlist` batch endpoint as the WATCH tab, polled every 15 s while the PORT tab is visible. Only the visible monitor tab polls, and in EOD mode the whole-market table is already cached, so PORT adds no extra upstream requests.
- **On the free tier, "day P&L" is the last completed session vs the session before it**, not intraday movement. During a trading day it shows yesterday's move.
- **Cost bases aren't split-adjusted, but prices are.** After a split, edit the position (new quantity, new average cost) or the P&L will be wrong.
- **USD and US-listed equities only.** There is no FX conversion.
- No realized P&L, dividends, fees, taxes or cash. Positions are long-only (quantity must be > 0).
- Holdings live only in your browser's `localStorage` (`bbg.portfolio`). They're per browser and device, and are never sent to the server except as ticker symbols in the price request.
