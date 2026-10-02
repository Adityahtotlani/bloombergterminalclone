import { useState } from 'react';

const fmtDate = (d) => {
  if (!d) return '---';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};

const fmtNum = (n, suffix = '') => {
  if (n == null) return '---';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B' + suffix;
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M' + suffix;
  return Number(n).toFixed(2) + suffix;
};

const today = new Date().toISOString().slice(0, 10);

const catColor = {
  FED: 'var(--amber)',
  ECON: 'var(--cyan)',
  EARN: 'var(--green)',
};

const impColor = {
  HIGH: 'var(--red)',
  MED: 'var(--amber)',
  LOW: 'var(--text-muted)',
};

function EarningsTab({ earnings, ticker, loading, error }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)', fontSize: '11px' }}>
      LOADING EARNINGS...
    </div>
  );
  if (!ticker) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '11px' }}>
      ENTER A TICKER
    </div>
  );
  if (!earnings || earnings.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '11px' }}>
      {error ? <span style={{ color: 'var(--amber-dim)', textAlign: 'center', padding: '0 12px', textTransform: 'uppercase' }}>{error}</span> : 'NO EARNINGS DATA'}
    </div>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1 }}>
          <tr>
            {['PERIOD', 'FILED', 'EPS', 'REVENUE'].map(h => (
              <th key={h} style={{
                padding: '3px 6px', textAlign: h === 'PERIOD' ? 'left' : 'right',
                color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '0.5px',
                fontWeight: 'normal', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {earnings.map((e, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg1)' }}>
              <td style={{ padding: '4px 6px', fontSize: '11px', color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                {e.fiscal_period} {e.fiscal_year}
              </td>
              <td style={{ padding: '4px 6px', fontSize: '11px', color: 'var(--text-dim)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {fmtDate(e.filing_date)}
              </td>
              <td style={{
                padding: '4px 6px', fontSize: '11px', textAlign: 'right', whiteSpace: 'nowrap',
                color: e.eps == null ? 'var(--text-muted)' : e.eps >= 0 ? 'var(--green)' : 'var(--red)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {e.eps != null ? `$${Number(e.eps).toFixed(2)}` : '---'}
              </td>
              <td style={{ padding: '4px 6px', fontSize: '11px', color: 'var(--text)', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {fmtNum(e.revenues)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MacroTab({ events, loading }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)', fontSize: '11px' }}>
      LOADING...
    </div>
  );
  if (!events || events.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '11px' }}>
      NO EVENTS
    </div>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {events.map((e, i) => {
        const isPast = e.date < today;
        const isToday = e.date === today;
        return (
          <div key={i} style={{
            padding: '5px 8px', borderBottom: '1px solid var(--border)',
            opacity: isPast ? 0.5 : 1,
            background: isToday ? 'rgba(255,176,0,0.07)' : 'transparent',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                <span style={{
                  fontSize: '9px', padding: '1px 4px', background: 'var(--bg3)',
                  color: catColor[e.category] || 'var(--text-muted)',
                  flexShrink: 0, letterSpacing: '0.5px',
                }}>
                  {e.category}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.event}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <span style={{ fontSize: '9px', color: impColor[e.importance], letterSpacing: '0.5px' }}>
                  {e.importance}
                </span>
                <span style={{ fontSize: '10px', color: isToday ? 'var(--amber)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {isToday ? 'TODAY' : fmtDate(e.date)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CalendarPanel({ earnings, macroEvents, ticker, loadingEarnings, loadingMacro, earningsError }) {
  const [tab, setTab] = useState('macro');

  const tabStyle = (active) => ({
    padding: '3px 10px', fontSize: '10px', letterSpacing: '0.8px',
    cursor: 'pointer', border: 'none', background: 'transparent',
    color: active ? 'var(--amber)' : 'var(--text-muted)',
    borderBottom: active ? '1px solid var(--amber)' : '1px solid transparent',
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }}>
        <button style={tabStyle(tab === 'macro')} onClick={() => setTab('macro')}>MACRO</button>
        <button style={tabStyle(tab === 'earnings')} onClick={() => setTab('earnings')}>EARNINGS</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'macro'
          ? <MacroTab events={macroEvents} loading={loadingMacro} />
          : <EarningsTab earnings={earnings} ticker={ticker} loading={loadingEarnings} error={earningsError} />
        }
      </div>
    </div>
  );
}
