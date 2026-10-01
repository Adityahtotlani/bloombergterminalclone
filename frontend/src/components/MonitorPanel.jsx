import { useState, useEffect, useRef, useCallback } from 'react';
import { getWatchlist, getMovers } from '../api';

const STORAGE_KEY = 'bbg.watchlist';
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
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'watch'
          ? <WatchTab activeTicker={activeTicker} onSelect={onSelect} />
          : <MoversTab key={tab} direction={tab} activeTicker={activeTicker} onSelect={onSelect} />}
      </div>
    </div>
  );
}
