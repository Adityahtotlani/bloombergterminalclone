const fmt = (n, d = 2) => n != null ? Number(n).toFixed(d) : '---';
const fmtK = (n) => {
  if (n == null) return '---';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toLocaleString();
};

function TH({ children, align = 'right' }) {
  return (
    <th style={{
      padding: '3px 6px', textAlign: align, color: 'var(--text-muted)',
      fontSize: '10px', letterSpacing: '0.5px', fontWeight: 'normal',
      borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

function TD({ children, color, align = 'right' }) {
  return (
    <td style={{
      padding: '3px 6px', textAlign: align, color: color || 'var(--text)',
      fontSize: '11px', borderBottom: '1px solid var(--border)',
      whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </td>
  );
}

export default function OptionsPanel({ options, loading }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
      LOADING OPTIONS...
    </div>
  );

  if (!options || options.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
      NO OPTIONS DATA
    </div>
  );

  const calls = options.filter(o => o.contract_type === 'call');
  const puts = options.filter(o => o.contract_type === 'put');

  const half = Math.min(calls.length, puts.length, 8);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1 }}>
          <tr>
            <TH align="left">EXPIRY</TH>
            <TH>BID</TH>
            <TH>ASK</TH>
            <TH>IV%</TH>
            <TH>Δ</TH>
            <TH>OI</TH>
            <TH>VOL</TH>
            <th style={{ padding: '3px 8px', textAlign: 'center', color: 'var(--amber)', fontSize: '10px', borderBottom: '1px solid var(--border)', borderLeft: '2px solid var(--border-bright)', borderRight: '2px solid var(--border-bright)' }}>STRIKE</th>
            <TH>VOL</TH>
            <TH>OI</TH>
            <TH>Δ</TH>
            <TH>IV%</TH>
            <TH>ASK</TH>
            <TH>BID</TH>
            <TH align="right">EXPIRY</TH>
          </tr>
          <tr>
            <td colSpan={7} style={{ padding: '2px 6px', fontSize: '10px', color: 'var(--green)', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>─── CALLS ───</td>
            <td style={{ borderLeft: '2px solid var(--border-bright)', borderRight: '2px solid var(--border-bright)' }} />
            <td colSpan={7} style={{ padding: '2px 6px', fontSize: '10px', color: 'var(--red)', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>─── PUTS ───</td>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: half }, (_, i) => {
            const c = calls[i];
            const p = puts[i];
            const strike = c?.strike_price || p?.strike_price;
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg1)' }}>
                <TD align="left" color="var(--text-dim)">{c?.expiration_date?.slice(5) || '---'}</TD>
                <TD color="var(--green)">{fmt(c?.bid)}</TD>
                <TD color="var(--red)">{fmt(c?.ask)}</TD>
                <TD>{c?.iv != null ? (c.iv * 100).toFixed(1) : '---'}</TD>
                <TD color="var(--cyan)">{fmt(c?.delta, 3)}</TD>
                <TD>{fmtK(c?.open_interest)}</TD>
                <TD>{fmtK(c?.volume)}</TD>
                <td style={{
                  padding: '3px 8px', textAlign: 'center', fontWeight: 'bold',
                  color: 'var(--amber)', fontSize: '12px',
                  borderLeft: '2px solid var(--border-bright)', borderRight: '2px solid var(--border-bright)',
                  background: 'var(--bg2)',
                }}>
                  {fmt(strike)}
                </td>
                <TD>{fmtK(p?.volume)}</TD>
                <TD>{fmtK(p?.open_interest)}</TD>
                <TD color="var(--cyan)">{fmt(p?.delta, 3)}</TD>
                <TD>{p?.iv != null ? (p.iv * 100).toFixed(1) : '---'}</TD>
                <TD color="var(--red)">{fmt(p?.ask)}</TD>
                <TD color="var(--green)">{fmt(p?.bid)}</TD>
                <TD align="right" color="var(--text-dim)">{p?.expiration_date?.slice(5) || '---'}</TD>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
