import { useState, useEffect, useRef } from 'react';
import { searchTickers } from '../api';

const CLOCKS = [
  { label: 'NY', tz: 'America/New_York' },
  { label: 'LON', tz: 'Europe/London' },
  { label: 'TKY', tz: 'Asia/Tokyo' },
];

function Clock() {
  const [times, setTimes] = useState({});

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const t = {};
      CLOCKS.forEach(({ label, tz }) => {
        t[label] = now.toLocaleTimeString('en-US', {
          timeZone: tz, hour12: false,
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      });
      setTimes(t);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: 'flex', gap: '16px' }}>
      {CLOCKS.map(({ label }) => (
        <div key={label} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>{label}</span>
          <span style={{ color: 'var(--amber)', letterSpacing: '1px' }}>{times[label]}</span>
        </div>
      ))}
    </div>
  );
}

// Backend reachability plus the quote freshness /api/health reports.
const STATUS = {
  live: { label: 'LIVE', color: 'var(--green)', glow: true, title: 'Real-time snapshot quotes' },
  eod: { label: 'EOD DATA', color: 'var(--amber)', glow: true, title: 'Connected — quotes are end-of-day (live snapshots not in the current Polygon plan)' },
  auth_error: { label: 'API KEY ERROR', color: 'var(--red)', glow: true, title: 'Polygon rejected the API key — check POLYGON_API_KEY in backend/.env and restart bbg-api' },
  unknown: { label: 'CONNECTED', color: 'var(--text-dim)', glow: false, title: 'Connected — data freshness not known yet' },
  down: { label: 'DISCONNECTED', color: 'var(--red)', glow: true, title: 'Backend unreachable' },
};

export default function TopBar({ onTickerSelect, connected, dataMode }) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  // Search results rarely change; caching them saves scarce API requests.
  const searchCache = useRef(new Map());
  const inputRef = useRef(null);
  const status = !connected ? STATUS.down : STATUS[dataMode] || STATUS.unknown;

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'F1') {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleChange = (val) => {
    setInput(val);
    clearTimeout(debounceRef.current);
    if (val.length < 1) { setSuggestions([]); setOpen(false); return; }
    if (searchCache.current.has(val)) {
      setSuggestions(searchCache.current.get(val));
      setOpen(true);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchTickers(val);
        const results = res.data.results || [];
        searchCache.current.set(val, results);
        setSuggestions(results);
        setOpen(true);
      } catch { setSuggestions([]); }
    }, 500);
  };

  const select = (ticker) => {
    clearTimeout(debounceRef.current); // don't fire a stale search after choosing
    setInput(ticker);
    setOpen(false);
    setSuggestions([]);
    onTickerSelect(ticker);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && input.trim()) {
      select(input.trim().toUpperCase());
    }
    if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '16px',
      padding: '6px 12px', borderBottom: '1px solid var(--border)',
      background: 'var(--bg1)', height: '40px', flexShrink: 0,
    }}>
      <div style={{ color: 'var(--amber)', fontWeight: 'bold', fontSize: '14px', letterSpacing: '2px', whiteSpace: 'nowrap' }}>
        BBG TERMINAL
      </div>

      <div style={{ position: 'relative', flex: '0 0 280px' }}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => handleChange(e.target.value.toUpperCase())}
          onKeyDown={handleKey}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder="TICKER SEARCH  [ENTER]"
          style={{
            width: '100%', background: 'var(--bg3)', border: '1px solid var(--border-bright)',
            color: 'var(--amber)', padding: '4px 8px', fontFamily: 'var(--font)',
            fontSize: '12px', outline: 'none', letterSpacing: '1px',
          }}
        />
        {open && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, width: '320px',
            background: 'var(--bg2)', border: '1px solid var(--border-bright)',
            zIndex: 100, maxHeight: '200px', overflowY: 'auto',
          }}>
            {suggestions.map((s) => (
              <div
                key={s.ticker}
                onMouseDown={() => select(s.ticker)}
                style={{
                  padding: '5px 8px', cursor: 'pointer', display: 'flex',
                  justifyContent: 'space-between', borderBottom: '1px solid var(--border)',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: 'var(--amber)', fontWeight: 'bold' }}>{s.ticker}</span>
                <span style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{s.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Clock />

      <div
        title={status.title}
        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        <div style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: status.color,
          boxShadow: status.glow ? `0 0 6px ${status.color}` : 'none',
        }} />
        <span style={{ color: status.color, fontSize: '10px' }}>
          {status.label}
        </span>
      </div>
    </div>
  );
}
