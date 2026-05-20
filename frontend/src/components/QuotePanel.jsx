const fmt = (n, dec = 2) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '---';
const fmtK = (n) => {
  if (n == null) return '---';
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  return Number(n).toLocaleString();
};

function Row({ label, value, valueClass }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '3px 8px', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{label}</span>
      <span className={`num ${valueClass || ''}`} style={{ fontSize: '12px' }}>{value}</span>
    </div>
  );
}

function Divider({ label }) {
  return (
    <div style={{
      padding: '3px 8px', background: 'var(--bg3)',
      color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '1px',
      borderBottom: '1px solid var(--border)',
    }}>
      {label}
    </div>
  );
}

export default function QuotePanel({ quote, details, loading }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
      LOADING...
    </div>
  );

  if (!quote) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '24px', color: 'var(--border-bright)' }}>BBG</div>
      <div>ENTER TICKER TO BEGIN</div>
    </div>
  );

  const changeClass = quote.change > 0 ? 'up' : quote.change < 0 ? 'down' : 'neutral';
  const changeSign = quote.change > 0 ? '+' : '';

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '8px', borderBottom: '2px solid var(--border-bright)', background: 'var(--bg2)' }}>
        <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--amber)', letterSpacing: '2px' }}>
          {quote.ticker}
        </div>
        {details?.name && (
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {details.name}
          </div>
        )}
        {details?.primary_exchange && (
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{details.primary_exchange}</div>
        )}
      </div>

      {/* Price block */}
      <div style={{ padding: '8px', borderBottom: '2px solid var(--border-bright)', background: 'var(--bg1)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: '28px', fontWeight: 'bold', color: quote.change >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmt(quote.price, 2)}
          </span>
        </div>
        <div style={{ textAlign: 'right', marginTop: '2px' }}>
          <span className={changeClass} style={{ fontSize: '14px' }}>
            {changeSign}{fmt(quote.change, 2)} ({changeSign}{fmt(quote.change_pct, 2)}%)
          </span>
        </div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
          PREV CLOSE {fmt(quote.prev_close)}
        </div>
      </div>

      <Divider label="QUOTE" />
      <Row label="BID" value={fmt(quote.bid)} valueClass="up" />
      <Row label="ASK" value={fmt(quote.ask)} valueClass="down" />
      <Row label="BID SIZE" value={fmtK(quote.bid_size)} />
      <Row label="ASK SIZE" value={fmtK(quote.ask_size)} />

      <Divider label="SESSION" />
      <Row label="OPEN" value={fmt(quote.open)} />
      <Row label="HIGH" value={fmt(quote.high)} valueClass="up" />
      <Row label="LOW" value={fmt(quote.low)} valueClass="down" />
      <Row label="CLOSE" value={fmt(quote.close)} />
      <Row label="VWAP" value={fmt(quote.vwap)} />
      <Row label="VOLUME" value={fmtK(quote.volume)} />

      <Divider label="COMPANY" />
      <Row label="MKT CAP" value={fmtK(details?.market_cap)} />
      <Row label="SHARES OUT" value={fmtK(details?.weighted_shares_outstanding)} />
      <Row label="SECTOR" value={details?.sic_description?.slice(0, 20) || '---'} />
      <Row label="LISTED" value={details?.list_date || '---'} />
    </div>
  );
}
