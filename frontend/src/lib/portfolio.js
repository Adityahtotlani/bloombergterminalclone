/**
 * Portfolio P&L math — pure functions, no React, no I/O.
 *
 * Money representation: fixed-point BigInt, never binary floats.
 *   - quantity        : integer micro-shares   (QTY_DP   = 6 decimals)
 *   - per-share price : integer micro-dollars  (PRICE_DP = 6 decimals)
 *   - amounts         : qty × price            (AMOUNT_DP = 12 decimals)
 * Addition and multiplication at these scales are exact, so cost basis,
 * market value and P&L totals accumulate with no rounding at all. The only
 * divisions are average cost (basis / qty) and ratios, which are display
 * values. Amounts are rounded to cents with banker's rounding (half-even)
 * only when formatted for display.
 *
 * A holding stores its TOTAL cost basis rather than its average cost, so
 * merging a second lot of the same ticker is an exact sum (basis1 + basis2)
 * and the average cost is derived as weighted basis / total quantity.
 *
 * Prices arrive from the API as JS numbers; they are converted to
 * micro-dollars once, at the boundary (toPriceUnits). Percentages and weights
 * are returned as plain Numbers — they are statistics, not money.
 *
 * USD only: every quote served by /api/watchlist is a US-listed equity in USD.
 */

export const QTY_DP = 6;
export const PRICE_DP = 6;
export const AMOUNT_DP = QTY_DP + PRICE_DP;
export const MAX_HOLDINGS = 50; // /api/watchlist prices at most 50 tickers per request
export const TICKER_RE = /^[A-Z0-9.-]{1,10}$/;

const pow10 = (n) => 10n ** BigInt(n);
const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;
// Guard against absurd inputs: 1e12 shares / $1e12 per share.
const MAX_INT_DIGITS = 12;

/** Integer division of BigInts rounded half-to-even. `d` must be > 0. */
export function divRoundHalfEven(n, d) {
  if (d <= 0n) throw new RangeError('divisor must be positive');
  let q = n / d; // truncates toward zero
  const r = n % d;
  if (r === 0n) return q;
  const twiceR = (r < 0n ? -r : r) * 2n;
  if (twiceR > d || (twiceR === d && q % 2n !== 0n)) q += n < 0n ? -1n : 1n;
  return q;
}

/**
 * Parse a non-negative decimal string into a BigInt scaled by 10^dp.
 * Returns null for anything malformed or with more than `dp` decimals
 * (we reject rather than silently round user input).
 */
export function parseDecimal(raw, dp) {
  const s = String(raw ?? '').trim();
  const m = DECIMAL_RE.exec(s);
  if (!m) return null;
  const [, int, frac = ''] = m;
  if (frac.length > dp) return null;
  if (int.replace(/^0+/, '').length > MAX_INT_DIGITS) return null;
  return BigInt(int) * pow10(dp) + BigInt(frac.padEnd(dp, '0') || '0');
}

/** Exact decimal string of a scaled BigInt, trailing zeros trimmed (for storage). */
export function toDecimalString(n, dp) {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const int = abs / pow10(dp);
  const frac = (abs % pow10(dp)).toString().padStart(dp, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? '.' + frac : ''}`;
}

/**
 * Convert an API price (JS number) to micro-dollars. Returns null when the
 * price is missing, non-finite or not positive (the backend emits 0 when it
 * has no trade data, which must not be valued as $0).
 */
export function toPriceUnits(price) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return BigInt(Math.round(price * 10 ** PRICE_DP));
}

/**
 * Format a scaled BigInt with half-even rounding to `outDp` decimals and
 * thousands separators. `sign: true` prefixes '+' on positive values.
 */
export function formatScaled(n, fromDp, outDp = 2, { sign = false } = {}) {
  if (n == null) return '---';
  const v = fromDp > outDp ? divRoundHalfEven(n, pow10(fromDp - outDp)) : n * pow10(outDp - fromDp);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const int = (abs / pow10(outDp)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = outDp > 0 ? '.' + (abs % pow10(outDp)).toString().padStart(outDp, '0') : '';
  const prefix = neg ? '-' : sign && v > 0n ? '+' : '';
  return `${prefix}${int}${frac}`;
}

export const formatAmount = (n, opts) => formatScaled(n, AMOUNT_DP, 2, opts);
export const formatPrice = (n) => formatScaled(n, PRICE_DP, 2);

/** Quantity for display: exact, trailing zeros trimmed, thousands-grouped. */
export function formatQty(n) {
  const [int, frac] = toDecimalString(n, QTY_DP).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '');
}

/** num/den as a percentage Number (statistic); null when den is 0. */
export function ratioPct(num, den) {
  if (num == null || den == null || den === 0n) return null;
  return Number((num * pow10(10)) / den) / 1e8;
}

/** Average cost per share in micro-dollars (half-even). */
export function avgCost(h) {
  return h.qty > 0n ? divRoundHalfEven(h.basis, h.qty) : 0n;
}

/**
 * Validate user input and build a holding { ticker, qty, basis }.
 * Returns { holding } or { error } with a terminal-style message.
 */
export function makeHolding(rawTicker, rawQty, rawCost) {
  const ticker = String(rawTicker ?? '').trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return { error: 'INVALID TICKER' };
  const qty = parseDecimal(rawQty, QTY_DP);
  if (qty == null || qty <= 0n) return { error: `QTY MUST BE > 0 (MAX ${QTY_DP} DP)` };
  const cost = parseDecimal(rawCost, PRICE_DP);
  if (cost == null) return { error: `COST MUST BE >= 0 (MAX ${PRICE_DP} DP)` };
  return { holding: { ticker, qty, basis: qty * cost } };
}

/**
 * Add a lot to the portfolio. A lot for a ticker already held is merged:
 * quantities and cost bases are summed, so the average cost becomes the
 * quantity-weighted average of the two lots.
 */
export function addLot(holdings, lot) {
  const i = holdings.findIndex(h => h.ticker === lot.ticker);
  if (i === -1) return [...holdings, lot];
  const next = holdings.slice();
  next[i] = { ticker: lot.ticker, qty: holdings[i].qty + lot.qty, basis: holdings[i].basis + lot.basis };
  return next;
}

/** Replace a ticker's position outright (edit), keeping its position in the list. */
export function setHolding(holdings, h) {
  const i = holdings.findIndex(x => x.ticker === h.ticker);
  if (i === -1) return [...holdings, h];
  const next = holdings.slice();
  next[i] = h;
  return next;
}

export const removeHolding = (holdings, ticker) => holdings.filter(h => h.ticker !== ticker);

/** Serialize for localStorage: exact decimal strings (BigInt is not JSON-serializable). */
export function serializeHoldings(holdings) {
  return JSON.stringify(holdings.map(h => ({
    ticker: h.ticker,
    qty: toDecimalString(h.qty, QTY_DP),
    basis: toDecimalString(h.basis, AMOUNT_DP),
  })));
}

/**
 * Parse stored holdings, dropping anything malformed. Duplicate tickers are
 * merged like lots. Never throws.
 */
export function deserializeHoldings(json) {
  let raw;
  try { raw = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  let out = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || typeof r.ticker !== 'string') continue;
    if (!TICKER_RE.test(r.ticker)) continue;
    const qty = typeof r.qty === 'string' ? parseDecimal(r.qty, QTY_DP) : null;
    const basis = typeof r.basis === 'string' ? parseDecimal(r.basis, AMOUNT_DP) : null;
    if (qty == null || qty <= 0n || basis == null) continue;
    if (out.length >= MAX_HOLDINGS && !out.some(h => h.ticker === r.ticker)) continue;
    out = addLot(out, { ticker: r.ticker, qty, basis });
  }
  return out;
}

/**
 * Value the portfolio against quotes from /api/watchlist.
 *
 * Per row: price, market value, unrealized P&L ($, %), day P&L ($, %) and
 * weight. A holding without a usable price is `priced: false` and excluded
 * from every total; `totals.partial` flags that. Day P&L additionally needs
 * prev_close; holdings without it are excluded from day totals
 * (`totals.dayPartial`).
 *
 * Totals (market value, cost basis, P&L) cover PRICED holdings only, so the
 * unrealized % is always computed over a matching cost basis.
 * `totals.basisAll` is the cost basis of every holding, priced or not.
 */
export function valuePortfolio(holdings, quotesByTicker = {}) {
  let mv = 0n, basis = 0n, basisAll = 0n, day = 0n, dayBase = 0n;
  let pricedCount = 0, dayCount = 0;

  const rows = holdings.map(h => {
    basisAll += h.basis;
    const q = quotesByTicker[h.ticker];
    const price = toPriceUnits(q?.price);
    const prev = toPriceUnits(q?.prev_close);
    const row = {
      ticker: h.ticker, qty: h.qty, basis: h.basis, avgCost: avgCost(h),
      price, priced: price != null, source: q?.source ?? null,
      mv: null, unrl: null, unrlPct: null, day: null, dayPct: null, weight: null,
    };
    if (price == null) return row;

    row.mv = h.qty * price;
    row.unrl = row.mv - h.basis;
    row.unrlPct = ratioPct(row.unrl, h.basis);
    mv += row.mv; basis += h.basis; pricedCount += 1;

    if (prev != null) {
      row.day = (price - prev) * h.qty;
      row.dayPct = ratioPct(price - prev, prev);
      day += row.day; dayBase += prev * h.qty; dayCount += 1;
    }
    return row;
  });

  for (const r of rows) if (r.mv != null) r.weight = ratioPct(r.mv, mv);

  const unrl = mv - basis;
  return {
    rows,
    totals: {
      mv, basis, basisAll, unrl,
      unrlPct: ratioPct(unrl, basis),
      day: dayCount ? day : null,
      dayPct: dayCount ? ratioPct(day, dayBase) : null,
      count: holdings.length, pricedCount, dayCount,
      partial: pricedCount < holdings.length,
      dayPartial: dayCount < pricedCount,
    },
  };
}
