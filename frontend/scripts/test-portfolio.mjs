// Checks for src/lib/portfolio.js using Node's built-in test runner (no dependency).
// Run: npm test   (or: node --test scripts/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  divRoundHalfEven, parseDecimal, toPriceUnits, formatAmount, formatPrice, formatQty,
  makeHolding, addLot, setHolding, removeHolding, avgCost, valuePortfolio,
  serializeHoldings, deserializeHoldings, QTY_DP,
} from '../src/lib/portfolio.js';

const lot = (t, q, c) => {
  const r = makeHolding(t, q, c);
  assert.ok(r.holding, `expected valid lot ${t} ${q} @ ${c}: ${r.error}`);
  return r.holding;
};

test('half-even rounding', () => {
  assert.equal(divRoundHalfEven(25n, 10n), 2n);   // 2.5 -> 2
  assert.equal(divRoundHalfEven(35n, 10n), 4n);   // 3.5 -> 4
  assert.equal(divRoundHalfEven(-25n, 10n), -2n);
  assert.equal(divRoundHalfEven(-35n, 10n), -4n);
  assert.equal(divRoundHalfEven(26n, 10n), 3n);
  assert.equal(divRoundHalfEven(-26n, 10n), -3n);
  assert.equal(divRoundHalfEven(24n, 10n), 2n);
});

test('parseDecimal accepts plain decimals and rejects junk / excess precision', () => {
  assert.equal(parseDecimal('5.5', QTY_DP), 5_500_000n);
  assert.equal(parseDecimal('0.000001', QTY_DP), 1n);
  assert.equal(parseDecimal('10', QTY_DP), 10_000_000n);
  assert.equal(parseDecimal(' 7 ', QTY_DP), 7_000_000n);
  for (const bad of ['', '-1', '1e3', 'abc', '1.', '.5', '1,000', '0.0000001', 'NaN', '1234567890123'])
    assert.equal(parseDecimal(bad, QTY_DP), null, bad);
});

test('float prices convert exactly at the boundary', () => {
  assert.equal(toPriceUnits(254.63), 254_630_000n);
  assert.equal(toPriceUnits(0.1 + 0.2), 300_000n);
  assert.equal(toPriceUnits(0), null);
  assert.equal(toPriceUnits(null), null);
  assert.equal(toPriceUnits(NaN), null);
  assert.equal(toPriceUnits(-1), null);
});

test('no float drift: 0.10 x 10 lots sums to exactly 1.00', () => {
  let h = [];
  for (let i = 0; i < 10; i++) h = addLot(h, lot('X', '1', '0.1'));
  assert.equal(formatAmount(h[0].basis), '1.00');
  assert.equal(h[0].basis, 1n * 10n ** 12n);
});

test('input validation', () => {
  assert.equal(makeHolding('bad ticker!', '1', '1').error, 'INVALID TICKER');
  assert.match(makeHolding('AAPL', '0', '1').error, /QTY/);
  assert.match(makeHolding('AAPL', '-2', '1').error, /QTY/);
  assert.match(makeHolding('AAPL', '1', '-1').error, /COST/);
  assert.ok(makeHolding('aapl', '1', '0').holding, 'cost 0 allowed, ticker upper-cased');
  assert.equal(makeHolding('brk.b', '1', '1').holding.ticker, 'BRK.B');
});

test('merging lots gives a quantity-weighted average cost', () => {
  // 10 @ 100 + 30 @ 200 -> 40 @ 175
  let h = addLot([], lot('AAPL', '10', '100'));
  h = addLot(h, lot('AAPL', '30', '200'));
  assert.equal(h.length, 1);
  assert.equal(formatQty(h[0].qty), '40');
  assert.equal(formatPrice(avgCost(h[0])), '175.00');
  // 3 @ 10 + 1 @ 11 -> 4 @ 10.25 (basis stays exact at 41.00)
  let g = addLot([], lot('T', '3', '10'));
  g = addLot(g, lot('T', '1', '11'));
  assert.equal(formatAmount(g[0].basis), '41.00');
  assert.equal(formatPrice(avgCost(g[0])), '10.25');
});

test('setHolding replaces, removeHolding removes', () => {
  let h = addLot([], lot('A', '1', '1'));
  h = addLot(h, lot('B', '2', '2'));
  h = setHolding(h, lot('A', '5', '3'));
  assert.deepEqual(h.map(x => x.ticker), ['A', 'B']);
  assert.equal(formatQty(h[0].qty), '5');
  assert.equal(formatAmount(h[0].basis), '15.00');
  assert.deepEqual(removeHolding(h, 'A').map(x => x.ticker), ['B']);
});

test('valuation: hand-computed reference portfolio with a missing price', () => {
  const holdings = [lot('AAPL', '10', '250'), lot('MSFT', '5.5', '480'), lot('ZZZZ', '1', '10')];
  const quotes = {
    AAPL: { ticker: 'AAPL', price: 255.46, prev_close: 252.29, source: 'eod' },
    MSFT: { ticker: 'MSFT', price: 517.35, prev_close: 519.71, source: 'eod' },
    ZZZZ: { ticker: 'ZZZZ', price: null },
  };
  const { rows, totals } = valuePortfolio(holdings, quotes);

  // AAPL: MV 2554.60, cost 2500, unrl +54.60 (+2.184%), day (255.46-252.29)*10 = +31.70
  assert.equal(formatAmount(rows[0].mv), '2,554.60');
  assert.equal(formatAmount(rows[0].unrl, { sign: true }), '+54.60');
  assert.equal(rows[0].unrlPct.toFixed(3), '2.184');
  assert.equal(formatAmount(rows[0].day, { sign: true }), '+31.70');
  // MSFT: MV 5.5*517.35 = 2845.425 -> 2,845.42 (half-even), cost 2640, unrl +205.425 -> +205.42
  //        day (517.35-519.71)*5.5 = -12.98
  assert.equal(formatAmount(rows[1].mv), '2,845.42');
  assert.equal(formatAmount(rows[1].unrl, { sign: true }), '+205.42');
  assert.equal(formatAmount(rows[1].day, { sign: true }), '-12.98');
  // Unpriced
  assert.equal(rows[2].priced, false);
  assert.equal(rows[2].mv, null);

  // Totals over priced holdings only: exact sum 5400.025 -> 5,400.02; basis 5140.00
  assert.equal(formatAmount(totals.mv), '5,400.02');
  assert.equal(formatAmount(totals.basis), '5,140.00');
  assert.equal(formatAmount(totals.basisAll), '5,150.00');
  assert.equal(formatAmount(totals.unrl, { sign: true }), '+260.02');
  assert.equal(totals.unrlPct.toFixed(4), (260.025 / 5140 * 100).toFixed(4));
  assert.equal(formatAmount(totals.day, { sign: true }), '+18.72');
  // day % = 18.72 / (252.29*10 + 519.71*5.5) = 18.72 / 5381.305
  assert.equal(totals.dayPct.toFixed(4), (18.72 / 5381.305 * 100).toFixed(4));
  assert.equal(totals.partial, true);
  assert.equal(totals.pricedCount, 2);
  // Weights of priced holdings sum to 100
  assert.equal(rows[0].weight.toFixed(2), (2554.6 / 5400.025 * 100).toFixed(2));
  assert.ok(Math.abs(rows[0].weight + rows[1].weight - 100) < 1e-6);
  assert.equal(rows[2].weight, null);
});

test('missing prev_close excludes holding from day totals only', () => {
  const { totals } = valuePortfolio([lot('A', '2', '10'), lot('B', '1', '10')], {
    A: { price: 11, prev_close: 10 }, B: { price: 12, prev_close: null },
  });
  assert.equal(formatAmount(totals.mv), '34.00');
  assert.equal(formatAmount(totals.day), '2.00');
  assert.equal(totals.dayPartial, true);
  assert.equal(totals.partial, false);
});

test('empty portfolio / no quotes', () => {
  const { totals } = valuePortfolio([], {});
  assert.equal(totals.mv, 0n);
  assert.equal(totals.unrlPct, null);
  assert.equal(totals.day, null);
  const t2 = valuePortfolio([lot('A', '1', '1')], {}).totals;
  assert.equal(t2.partial, true);
  assert.equal(t2.pricedCount, 0);
});

test('zero cost basis gives no unrealized %', () => {
  const { rows } = valuePortfolio([lot('GIFT', '1', '0')], { GIFT: { price: 5, prev_close: 5 } });
  assert.equal(rows[0].unrlPct, null);
  assert.equal(formatAmount(rows[0].unrl, { sign: true }), '+5.00');
});

test('serialize / deserialize round-trip and rejects corrupt storage', () => {
  let h = addLot([], lot('MSFT', '5.5', '480.123456'));
  h = addLot(h, lot('AAPL', '0.000001', '250'));
  const back = deserializeHoldings(serializeHoldings(h));
  assert.deepEqual(back, h);
  assert.deepEqual(deserializeHoldings('not json'), []);
  assert.deepEqual(deserializeHoldings('{"a":1}'), []);
  assert.deepEqual(deserializeHoldings(null), []);
  const mixed = JSON.stringify([
    { ticker: 'OK', qty: '1', basis: '5' },
    { ticker: 'bad!', qty: '1', basis: '5' },
    { ticker: 'NEG', qty: '-1', basis: '5' },
    { ticker: 'NUM', qty: 1, basis: 5 },
    null,
    { ticker: 'OK', qty: '1', basis: '7' }, // duplicate -> merged
  ]);
  const got = deserializeHoldings(mixed);
  assert.equal(got.length, 1);
  assert.equal(formatQty(got[0].qty), '2');
  assert.equal(formatAmount(got[0].basis), '12.00');
});
