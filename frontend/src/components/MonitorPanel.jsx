import { useState, useEffect, useRef, useCallback } from 'react';
import { getWatchlist, getMovers } from '../api';
import {
  makeHolding, addLot, setHolding, removeHolding, valuePortfolio,
  serializeHoldings, deserializeHoldings, toDecimalString,
  formatAmount, formatPrice, formatQty, MAX_HOLDINGS, QTY_DP, PRICE_DP,
} from '../lib/portfolio';

const STORAGE_KEY = 'bbg.watchlist';
const PORTFOLIO_KEY = 'bbg.portfolio';
const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];
const TICKER_RE = /^[A-Z0-9.-]{1,10}$/;
const WATCH_REFRESH_MS = 15000;
const MOVERS_REFRESH_MS = 60000;

const fmt = (n) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '---';
const fmtPct = (n) => n != null ? `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%` : '---';
const fmtVol = (n) => {
  if (n == null) return '---';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
};

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.every(t => typeof t === 'string')) return saved;
  } catch { /* storage unavailable or corrupt — fall back to defaults */ }
  return DEFAULT_WATCHLIST;
}

function saveWatchlist(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

/** Polls `fetcher` every `ms` while `enabled`, exposing data/loading/error. */
function usePolling(fetcher, ms, enabled) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const run = async (initial) => {
      if (initial) setLoading(true);
      try {
        const result = await fetcher();
        if (!cancelled) { setData(result); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.detail || 'REQUEST FAILED');
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    };
    run(true);
    const id = setInterval(() => run(false), ms);
    return () => { cancelled = true; clearInterval(id); };
  }, [fetcher, ms, enabled]);

  return { data, loading, error };
}

function EodFooter() {
  return (
    <div
      title="Live snapshots aren't included in the current Polygon plan"
      style={{ padding: '2px 8px', fontSize: '9px', color: 'var(--amber-dim)', letterSpacing: '1px', borderTop: '1px solid var(--border)', flexShrink: 0 }}
    >
      END-OF-DAY DATA
    </div>
  );
}

function Message({ children, color = 'var(--text-muted)' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color, fontSize: '11px', textAlign: 'center', padding: '8px' }}>
      {children}
    </div>
  );
}

function QuoteRow({ q, active, onSelect, onRemove }) {
  const [flash, setFlash] = useState(null);
  const prevPrice = useRef(q.price);

  // Briefly tint the row green/red when the price ticks.
  useEffect(() => {
    const prev = prevPrice.current;
    prevPrice.current = q.price;
    if (prev == null || q.price == null || prev === q.price) return undefined;
    const dir = q.price > prev ? 'up' : 'down';
    const on = setTimeout(() => setFlash(dir), 0);
    const off = setTimeout(() => setFlash(null), 700);
    return () => { clearTimeout(on); clearTimeout(off); };
  }, [q.price]);

  const cls = q.change_pct > 0 ? 'up' : q.change_pct < 0 ? 'down' : 'neutral';
  const flashBg = flash === 'up' ? 'rgba(0,208,132,0.18)' : flash === 'down' ? 'rgba(255,68,68,0.18)' : null;

  return (
    <div
      onClick={() => onSelect(q.ticker)}
      className="monitor-row"
      style={{
        display: 'grid', gridTemplateColumns: onRemove ? '1fr auto auto 14px' : '1fr auto auto',
        gap: '6px', alignItems: 'center', padding: '3px 8px', cursor: 'pointer',
        borderBottom: '1px solid var(--border)',
        borderLeft: active ? '2px solid var(--amber)' : '2px solid transparent',
        background: flashBg || (active ? 'var(--bg2)' : 'transparent'),
        transition: 'background 0.3s',
      }}
    >
      <span style={{ color: 'var(--amber)', fontWeight: 'bold', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {q.ticker}
      </span>
      <span className="num" style={{ fontSize: '11px' }}>{fmt(q.price)}</span>
      <span className={`num ${cls}`} style={{ fontSize: '11px', minWidth: '54px' }}>{fmtPct(q.change_pct)}</span>
      {onRemove && (
        <button
          title={`Remove ${q.ticker}`}
          onClick={(e) => { e.stopPropagation(); onRemove(q.ticker); }}
          className="monitor-remove"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px', padding: 0 }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function WatchTab({ activeTicker, onSelect }) {
  const [list, setList] = useState(loadWatchlist);
  const [input, setInput] = useState('');

  useEffect(() => { saveWatchlist(list); }, [list]);

  const listKey = list.join(',');
  const fetcher = useCallback(
    () => getWatchlist(listKey.split(',')).then(r => r.data.quotes),
    [listKey],
  );
  const { data: quotes, loading, error } = usePolling(fetcher, WATCH_REFRESH_MS, list.length > 0);

  const add = (raw) => {
    const t = (raw || '').trim().toUpperCase();
    if (!TICKER_RE.test(t) || list.includes(t)) return;
    setList(l => [...l, t]);
    setInput('');
  };
  const remove = (t) => setList(l => l.filter(x => x !== t));

  const byTicker = Object.fromEntries((quotes || []).map(q => [q.ticker, q]));
  const isEod = (quotes || []).some(q => q.source === 'eod');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: '4px', padding: '4px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') add(input); }}
          placeholder="ADD SYMBOL"
          aria-label="Add symbol to watchlist"
          style={{
            flex: 1, minWidth: 0, background: 'var(--bg3)', border: '1px solid var(--border-bright)',
            color: 'var(--amber)', padding: '2px 6px', fontFamily: 'var(--font)', fontSize: '11px', outline: 'none',
          }}
        />
        <button
          onClick={() => add(activeTicker)}
          disabled={!activeTicker || list.includes(activeTicker)}
          title="Add the loaded ticker"
          style={{
            background: 'var(--bg3)', border: '1px solid var(--border-bright)', color: 'var(--amber)',
            fontFamily: 'var(--font)', fontSize: '10px', padding: '2px 6px', cursor: 'pointer',
            opacity: !activeTicker || list.includes(activeTicker) ? 0.4 : 1,
          }}
        >
          +CUR
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {list.length === 0 && <Message>WATCHLIST EMPTY</Message>}
        {list.length > 0 && loading && !quotes && <Message color="var(--text-dim)">LOADING...</Message>}
        {list.length > 0 && error && !quotes && <Message color="var(--red)">{error}</Message>}
        {quotes && list.map(t => (
          <QuoteRow
            key={t}
            q={byTicker[t] || { ticker: t, price: null }}
            active={t === activeTicker}
            onSelect={onSelect}
            onRemove={remove}
          />
        ))}
      </div>
      {isEod && <EodFooter />}
    </div>
  );
}

function MoversTab({ direction, activeTicker, onSelect }) {
  const fetcher = useCallback(() => getMovers(direction).then(r => r.data), [direction]);
  const { data, loading, error } = usePolling(fetcher, MOVERS_REFRESH_MS, true);
  const movers = data?.movers;

  if (loading && !movers) return <Message color="var(--text-dim)">LOADING...</Message>;
  if (error && !movers) return <Message color="var(--red)">{error}</Message>;
  if (!movers || movers.length === 0) return <Message>NO DATA — MARKET MAY BE CLOSED</Message>;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {movers.map(q => (
          <div key={q.ticker} title={`Vol ${fmtVol(q.volume)}`}>
            <QuoteRow q={q} active={q.ticker === activeTicker} onSelect={onSelect} />
          </div>
        ))}
      </div>
      {data.source === 'eod' && <EodFooter />}
    </div>
  );
}

function loadPortfolio() {
  try { return deserializeHoldings(localStorage.getItem(PORTFOLIO_KEY)); } catch { return []; }
}

function savePortfolio(holdings) {
  try { localStorage.setItem(PORTFOLIO_KEY, serializeHoldings(holdings)); } catch { /* ignore */ }
}

const pnlCls = (n) => (n == null ? 'neutral' : n > 0n ? 'up' : n < 0n ? 'down' : 'neutral');
const inputStyle = {
  minWidth: 0, background: 'var(--bg3)', border: '1px solid var(--border-bright)',
  color: 'var(--amber)', padding: '2px 4px', fontFamily: 'var(--font)', fontSize: '11px', outline: 'none',
};
const btnStyle = {
  background: 'var(--bg3)', border: '1px solid var(--border-bright)', color: 'var(--amber)',
  fontFamily: 'var(--font)', fontSize: '10px', padding: '2px 5px', cursor: 'pointer',
};
const iconBtn = {
  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
  fontFamily: 'var(--font)', fontSize: '10px', padding: 0,
};

function SummaryLine({ label, value, pct, cls }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', fontSize: '11px', lineHeight: '15px' }}>
      <span style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.5px' }}>{label}</span>
      <span className={`num ${cls || ''}`}>
        {value}{pct !== undefined && <span style={{ marginLeft: '6px' }}>{fmtPct(pct)}</span>}
      </span>
    </div>
  );
}

function HoldingRow({ r, active, editing, onSelect, onEdit, onRemove }) {
  const dim = { color: 'var(--text-dim)', fontSize: '10px' };
  return (
    <div
      onClick={() => onSelect(r.ticker)}
      className="monitor-row"
      title={r.priced ? `${r.ticker} · avg cost ${formatPrice(r.avgCost)} · cost basis ${formatAmount(r.basis)}` : `${r.ticker} · no price data`}
      style={{
        padding: '3px 8px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
        borderLeft: editing ? '2px solid var(--cyan)' : active ? '2px solid var(--amber)' : '2px solid transparent',
        background: active ? 'var(--bg2)' : 'transparent', fontSize: '11px', lineHeight: '14px',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto 10px 10px', gap: '5px', alignItems: 'center' }}>
        <span style={{ color: 'var(--amber)', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ticker}</span>
        <span className="num" style={{ ...dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {formatQty(r.qty)} @ {formatPrice(r.avgCost)}
        </span>
        <span className="num" style={{ ...dim, minWidth: '38px' }}>{r.weight != null ? `${r.weight.toFixed(1)}%` : '---'}</span>
        <button title={`Edit ${r.ticker}`} className="monitor-remove" style={iconBtn}
          onClick={(e) => { e.stopPropagation(); onEdit(r); }}>✎</button>
        <button title={`Remove ${r.ticker}`} className="monitor-remove" style={{ ...iconBtn, fontSize: '11px' }}
          onClick={(e) => { e.stopPropagation(); onRemove(r.ticker); }}>×</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
        <span><span style={dim}>LAST </span><span className="num">{r.price != null ? formatPrice(r.price) : '---'}</span></span>
        <span><span style={dim}>MV </span><span className="num">{r.mv != null ? formatAmount(r.mv) : '---'}</span></span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
        <span className={`num ${pnlCls(r.unrl)}`}>
          {r.unrl != null ? formatAmount(r.unrl, { sign: true }) : '---'}
          <span style={{ marginLeft: '4px', fontSize: '10px' }}>{r.unrl != null ? fmtPct(r.unrlPct) : ''}</span>
        </span>
        <span><span style={dim}>DAY </span><span className={`num ${pnlCls(r.day)}`}>{r.day != null ? formatAmount(r.day, { sign: true }) : '---'}</span></span>
      </div>
    </div>
  );
}

function PortfolioTab({ activeTicker, onSelect }) {
  const [holdings, setHoldings] = useState(loadPortfolio);
  const [form, setForm] = useState({ ticker: '', qty: '', cost: '' });
  const [editing, setEditing] = useState(null); // ticker being edited (SET replaces instead of merging)
  const [formError, setFormError] = useState(null);

  useEffect(() => { savePortfolio(holdings); }, [holdings]);

  const listKey = holdings.map(h => h.ticker).join(',');
  const fetcher = useCallback(
    () => getWatchlist(listKey.split(',')).then(r => r.data.quotes),
    [listKey],
  );
  const { data: quotes, loading, error } = usePolling(fetcher, WATCH_REFRESH_MS, holdings.length > 0);

  const byTicker = Object.fromEntries((quotes || []).map(q => [q.ticker, q]));
  const { rows, totals } = valuePortfolio(holdings, byTicker);
  const isEod = (quotes || []).some(q => q.source === 'eod');

  const resetForm = () => { setForm({ ticker: '', qty: '', cost: '' }); setEditing(null); setFormError(null); };

  const submit = () => {
    // An empty ticker field means the currently loaded ticker (shown as the placeholder).
    const { holding, error: err } = makeHolding(editing || form.ticker.trim() || activeTicker, form.qty, form.cost);
    if (err) { setFormError(err); return; }
    const exists = holdings.some(h => h.ticker === holding.ticker);
    if (!editing && !exists && holdings.length >= MAX_HOLDINGS) { setFormError(`MAX ${MAX_HOLDINGS} HOLDINGS`); return; }
    setHoldings(hs => (editing ? setHolding(hs, holding) : addLot(hs, holding)));
    resetForm();
  };

  const startEdit = (r) => {
    setEditing(r.ticker);
    setForm({ ticker: r.ticker, qty: toDecimalString(r.qty, QTY_DP), cost: toDecimalString(r.avgCost, PRICE_DP) });
    setFormError(null);
  };

  const remove = (t) => {
    setHoldings(hs => removeHolding(hs, t));
    if (editing === t) resetForm();
  };

  const onKey = (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') resetForm(); };
  const upperTicker = (form.ticker.trim() || activeTicker || '').toUpperCase();
  const willMerge = !editing && holdings.some(h => h.ticker === upperTicker);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {holdings.length > 0 && (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', background: 'var(--bg1)', flexShrink: 0 }}>
          <SummaryLine label="MKT VAL" value={quotes ? formatAmount(totals.mv) : '---'} />
          <SummaryLine label="COST" value={quotes ? formatAmount(totals.basis) : '---'} />
          <SummaryLine label="UNRL P&L" value={quotes ? formatAmount(totals.unrl, { sign: true }) : '---'}
            pct={quotes ? totals.unrlPct : null} cls={quotes ? pnlCls(totals.unrl) : ''} />
          <SummaryLine label="DAY P&L" value={quotes && totals.day != null ? formatAmount(totals.day, { sign: true }) : '---'}
            pct={quotes ? totals.dayPct : null} cls={quotes ? pnlCls(totals.day) : ''} />
          {quotes && (totals.partial || totals.dayPartial) && (
            <div
              title="Holdings without a price are excluded from market value, cost, P&L and weights"
              style={{ fontSize: '9px', color: 'var(--amber-dim)', letterSpacing: '0.5px', marginTop: '1px' }}
            >
              PARTIAL · {totals.pricedCount}/{totals.count} PRICED
              {totals.dayPartial && ` · DAY ${totals.dayCount}/${totals.pricedCount}`}
            </div>
          )}
        </div>
      )}
      <div style={{ padding: '4px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto', gap: '3px' }}>
          <input
            value={editing || form.ticker}
            disabled={!!editing}
            onChange={(e) => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
            onKeyDown={onKey}
            placeholder={activeTicker || 'SYM'}
            aria-label="Portfolio ticker"
            style={{ ...inputStyle, opacity: editing ? 0.6 : 1 }}
          />
          <input
            value={form.qty}
            onChange={(e) => setForm(f => ({ ...f, qty: e.target.value }))}
            onKeyDown={onKey}
            placeholder="QTY"
            inputMode="decimal"
            aria-label="Quantity"
            style={inputStyle}
          />
          <input
            value={form.cost}
            onChange={(e) => setForm(f => ({ ...f, cost: e.target.value }))}
            onKeyDown={onKey}
            placeholder="COST"
            inputMode="decimal"
            aria-label="Average cost per share"
            style={inputStyle}
          />
          <button onClick={submit} style={btnStyle} title={editing ? 'Replace this position' : 'Add lot'}>
            {editing ? 'SET' : 'ADD'}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginTop: '2px', letterSpacing: '0.3px' }}>
          {formError
            ? <span style={{ color: 'var(--red)' }}>{formError}</span>
            : editing
              ? <span style={{ color: 'var(--cyan)' }}>EDIT {editing}: REPLACES QTY/AVG COST</span>
              : <span style={{ color: willMerge ? 'var(--amber-dim)' : 'var(--text-muted)' }}>
                  {willMerge ? `MERGE INTO ${upperTicker} · WEIGHTED AVG COST` : 'SAME TICKER MERGES · WEIGHTED AVG'}
                </span>}
          {editing && <button onClick={resetForm} style={{ ...iconBtn, fontSize: '9px' }}>CANCEL</button>}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {holdings.length === 0 && <Message>NO HOLDINGS — ENTER SYMBOL, QTY, AVG COST</Message>}
        {holdings.length > 0 && loading && !quotes && <Message color="var(--text-dim)">LOADING...</Message>}
        {holdings.length > 0 && error && !quotes && <Message color="var(--red)">{error}</Message>}
        {quotes && rows.map(r => (
          <HoldingRow
            key={r.ticker}
            r={r}
            active={r.ticker === activeTicker}
            editing={r.ticker === editing}
            onSelect={onSelect}
            onEdit={startEdit}
            onRemove={remove}
          />
        ))}
      </div>
      {isEod && <EodFooter />}
    </div>
  );
}

export default function MonitorPanel({ activeTicker, onSelect }) {
  const [tab, setTab] = useState('watch');

  const tabStyle = (active) => ({
    flex: 1, padding: '3px 6px', fontSize: '10px', letterSpacing: '0.8px',
    cursor: 'pointer', border: 'none', background: 'transparent', fontFamily: 'var(--font)',
    color: active ? 'var(--amber)' : 'var(--text-muted)',
    borderBottom: active ? '1px solid var(--amber)' : '1px solid transparent',
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }}>
        <button style={tabStyle(tab === 'watch')} onClick={() => setTab('watch')}>WATCH</button>
        <button style={tabStyle(tab === 'gainers')} onClick={() => setTab('gainers')}>GAINERS</button>
        <button style={tabStyle(tab === 'losers')} onClick={() => setTab('losers')}>LOSERS</button>
        <button style={tabStyle(tab === 'port')} onClick={() => setTab('port')}>PORT</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'watch' && <WatchTab activeTicker={activeTicker} onSelect={onSelect} />}
        {tab === 'port' && <PortfolioTab activeTicker={activeTicker} onSelect={onSelect} />}
        {(tab === 'gainers' || tab === 'losers') && (
          <MoversTab key={tab} direction={tab} activeTicker={activeTicker} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}
