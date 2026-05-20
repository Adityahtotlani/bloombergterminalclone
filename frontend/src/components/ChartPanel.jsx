import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts';

const TIMEFRAMES = ['1D', '5D', '1M', '3M', '1Y'];

export default function ChartPanel({ bars, timeframe, onTimeframeChange, loading, ticker }) {
  const chartRef = useRef(null);
  const containerRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volSeriesRef = useRef(null);
  const [crosshairData, setCrosshairData] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0a0a0a' },
        textColor: '#666666',
        fontSize: 11,
        fontFamily: "'Courier New', Courier, monospace",
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      crosshair: {
        vertLine: { color: '#3a3a3a', labelBackgroundColor: '#1c1c1c' },
        horzLine: { color: '#3a3a3a', labelBackgroundColor: '#1c1c1c' },
      },
      rightPriceScale: {
        borderColor: '#2a2a2a',
        textColor: '#666666',
      },
      timeScale: {
        borderColor: '#2a2a2a',
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.offsetWidth,
      height: containerRef.current.offsetHeight - 60,
    });

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#00d084',
      downColor: '#ff4444',
      borderUpColor: '#00d084',
      borderDownColor: '#ff4444',
      wickUpColor: '#00a066',
      wickDownColor: '#cc2222',
    });

    volSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: '#2a2a2a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });

    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    chart.subscribeCrosshairMove((param) => {
      if (param.seriesData && candleSeriesRef.current) {
        const d = param.seriesData.get(candleSeriesRef.current);
        if (d) setCrosshairData(d);
      }
    });

    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.resize(containerRef.current.offsetWidth, containerRef.current.offsetHeight - 60);
      }
    });
    ro.observe(containerRef.current);

    return () => { chart.remove(); ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (!bars || !candleSeriesRef.current || !volSeriesRef.current) return;

    const candleData = bars
      .filter(b => b.o != null && b.h != null && b.l != null && b.c != null)
      .map(b => ({
        time: Math.floor(b.t / 1000),
        open: b.o, high: b.h, low: b.l, close: b.c,
      }));

    const volData = bars
      .filter(b => b.v != null)
      .map(b => ({
        time: Math.floor(b.t / 1000),
        value: b.v,
        color: b.c >= b.o ? '#1a3a2a' : '#3a1a1a',
      }));

    try {
      candleSeriesRef.current.setData(candleData);
      volSeriesRef.current.setData(volData);
      chartRef.current?.timeScale().fitContent();
    } catch (e) {
      console.warn('Chart data error:', e);
    }
  }, [bars]);

  const fmt = (n, d = 2) => n != null ? Number(n).toFixed(d) : '---';
  const fmtVol = (n) => {
    if (n == null) return '---';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0,
      }}>
        <span style={{ color: 'var(--amber)', fontWeight: 'bold', marginRight: '8px' }}>
          {ticker || 'CHART'}
        </span>
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            style={{
              background: tf === timeframe ? 'var(--amber)' : 'var(--bg3)',
              color: tf === timeframe ? '#000' : 'var(--text-dim)',
              border: '1px solid ' + (tf === timeframe ? 'var(--amber)' : 'var(--border)'),
              padding: '2px 8px', cursor: 'pointer',
              fontFamily: 'var(--font)', fontSize: '11px', letterSpacing: '0.5px',
            }}
          >
            {tf}
          </button>
        ))}

        {crosshairData && (
          <div style={{ marginLeft: '16px', display: 'flex', gap: '12px', fontSize: '11px' }}>
            <span>O <span style={{ color: 'var(--text)' }}>{fmt(crosshairData.open)}</span></span>
            <span>H <span style={{ color: 'var(--green)' }}>{fmt(crosshairData.high)}</span></span>
            <span>L <span style={{ color: 'var(--red)' }}>{fmt(crosshairData.low)}</span></span>
            <span>C <span style={{ color: crosshairData.close >= crosshairData.open ? 'var(--green)' : 'var(--red)' }}>{fmt(crosshairData.close)}</span></span>
          </div>
        )}

        {loading && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: '10px' }}>LOADING...</span>
        )}
      </div>

      {/* Chart container */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {!bars && !loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)',
          }}>
            SELECT A TICKER TO VIEW CHART
          </div>
        )}
      </div>
    </div>
  );
}
