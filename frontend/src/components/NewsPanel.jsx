export default function NewsPanel({ news, loading }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
      LOADING NEWS...
    </div>
  );

  if (!news || news.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
      NO NEWS DATA
    </div>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {news.map((item, i) => {
        const date = item.published_utc
          ? new Date(item.published_utc).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';

        return (
          <div
            key={item.id || i}
            style={{
              padding: '6px 8px', borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            onClick={() => item.article_url && window.open(item.article_url, '_blank')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span style={{ color: 'var(--amber)', fontSize: '10px' }}>{item.publisher || 'UNKNOWN'}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{date}</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text)', lineHeight: '1.4', marginBottom: '2px' }}>
              {item.title}
            </div>
            {item.description && (
              <div style={{
                fontSize: '10px', color: 'var(--text-dim)',
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                {item.description}
              </div>
            )}
            {item.tickers?.length > 1 && (
              <div style={{ marginTop: '2px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {item.tickers.slice(0, 5).map(t => (
                  <span key={t} style={{ fontSize: '9px', color: 'var(--cyan)', background: 'var(--bg3)', padding: '1px 4px' }}>{t}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
