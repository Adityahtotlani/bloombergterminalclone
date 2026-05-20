const fmtM = (n) => {
  if (n == null) return '---';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
  return sign + abs.toFixed(2);
};

const fmt2 = (n) => n != null ? Number(n).toFixed(2) : '---';

function MetricRow({ label, values, format = fmtM, colorFn }) {
  return (
    <tr>
      <td style={{ padding: '3px 8px', color: 'var(--text-dim)', fontSize: '11px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
        {label}
      </td>
      {values.map((v, i) => {
        const color = colorFn ? colorFn(v) : 'var(--text)';
        return (
          <td key={i} style={{
            padding: '3px 8px', textAlign: 'right', fontSize: '11px',
            color, borderBottom: '1px solid var(--border)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {format(v)}
          </td>
        );
      })}
    </tr>
  );
}

const posNegColor = (v) => v == null ? 'var(--text-dim)' : v >= 0 ? 'var(--green)' : 'var(--red)';

export default function FinancialsPanel({ financials, loading }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
      LOADING FINANCIALS...
    </div>
  );

  if (!financials || financials.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
      NO FINANCIAL DATA
    </div>
  );

  const periods = financials.slice(0, 4);

  const get = (key) => periods.map(p => p[key]);

  const debtEquity = periods.map(p => {
    if (p.long_term_debt != null && p.equity != null && p.equity !== 0)
      return p.long_term_debt / p.equity;
    return null;
  });

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1 }}>
          <tr>
            <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--amber)', fontSize: '10px', letterSpacing: '1px', borderBottom: '1px solid var(--border)', fontWeight: 'normal' }}>
              FINANCIALS
            </th>
            {periods.map((p, i) => (
              <th key={i} style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-dim)', fontSize: '10px', borderBottom: '1px solid var(--border)', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                {p.fiscal_period} {p.fiscal_year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan={5} style={{ padding: '3px 8px', background: 'var(--bg3)', color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '1px', borderBottom: '1px solid var(--border)' }}>INCOME STATEMENT</td></tr>
          <MetricRow label="Revenue" values={get('revenues')} />
          <MetricRow label="Gross Profit" values={get('gross_profit')} colorFn={posNegColor} />
          <MetricRow label="Operating Inc." values={get('operating_income')} colorFn={posNegColor} />
          <MetricRow label="Net Income" values={get('net_income')} colorFn={posNegColor} />
          <MetricRow label="EPS (Basic)" values={get('eps')} format={fmt2} colorFn={posNegColor} />
          <MetricRow label="EPS (Diluted)" values={get('diluted_eps')} format={fmt2} colorFn={posNegColor} />

          <tr><td colSpan={5} style={{ padding: '3px 8px', background: 'var(--bg3)', color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '1px', borderBottom: '1px solid var(--border)' }}>BALANCE SHEET</td></tr>
          <MetricRow label="Total Assets" values={get('total_assets')} />
          <MetricRow label="Total Liabilities" values={get('total_liabilities')} />
          <MetricRow label="Equity" values={get('equity')} colorFn={posNegColor} />
          <MetricRow label="LT Debt" values={get('long_term_debt')} />
          <MetricRow label="Debt/Equity" values={debtEquity} format={fmt2} />

          <tr><td colSpan={5} style={{ padding: '3px 8px', background: 'var(--bg3)', color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '1px', borderBottom: '1px solid var(--border)' }}>CASH FLOW</td></tr>
          <MetricRow label="Op. Cash Flow" values={get('operating_cash_flow')} colorFn={posNegColor} />
        </tbody>
      </table>
    </div>
  );
}
