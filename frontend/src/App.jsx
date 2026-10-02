import { useState, useEffect, useCallback, useRef } from 'react';
import TopBar from './components/TopBar';
import QuotePanel from './components/QuotePanel';
import ChartPanel from './components/ChartPanel';
import OptionsPanel from './components/OptionsPanel';
import NewsPanel from './components/NewsPanel';
import FinancialsPanel from './components/FinancialsPanel';
import CalendarPanel from './components/CalendarPanel';
import MonitorPanel from './components/MonitorPanel';
import { getQuote, getAggs, getOptions, getNews, getFinancials, getTickerDetails, getEarnings, getEconomicEvents } from './api';
import './App.css';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Transient backend answers worth retrying: rate-limit queue full (503), provider
// unreachable (502) or timed out (504).
const RETRY_STATUSES = new Set([502, 503, 504]);

/** Retry transient failures a bounded number of times — the panel stays in LOADING. */
async function withBusyRetry(fn, signal, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted || !RETRY_STATUSES.has(e?.response?.status) || i >= attempts - 1) throw e;
      await sleep(3000);
      if (signal?.aborted) throw e;
    }
  }
}

function PanelHeader({ label }) {
  return (
    <div style={{
      padding: '4px 8px', background: 'var(--bg3)',
      borderBottom: '1px solid var(--border)',
      color: 'var(--amber)', fontSize: '10px', letterSpacing: '1.5px',
      flexShrink: 0,
    }}>
      {label}
    </div>
  );
}

function Panel({ children, style }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      background: 'var(--bg1)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      ...style,
    }}>
      {children}
    </div>
  );
}

export default function App() {
  const [ticker, setTicker] = useState('');
  const [quote, setQuote] = useState(null);
  const [details, setDetails] = useState(null);
  const [bars, setBars] = useState(null);
  const [options, setOptions] = useState(null);
  const [news, setNews] = useState(null);
  const [financials, setFinancials] = useState(null);
  const [timeframe, setTimeframe] = useState('1M');
  const timeframeRef = useRef('1M');
  const [connected, setConnected] = useState(false);
  // Quote freshness reported by /api/health: 'live' | 'eod' | 'unknown'.
  const [dataMode, setDataMode] = useState('unknown');

  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingFinancials, setLoadingFinancials] = useState(false);
  const [earnings, setEarnings] = useState(null);
  const [macroEvents, setMacroEvents] = useState(null);
  const [loadingEarnings, setLoadingEarnings] = useState(false);
  const [loadingMacro, setLoadingMacro] = useState(false);
  // Per-panel error/notice text shown instead of an empty panel.
  const [panelErrors, setPanelErrors] = useState({});

  const intervalRef = useRef(null);
  const currentTicker = useRef('');
  // Aborts the previous ticker's in-flight requests so they stop holding rate-limit slots.
  const tickerAbort = useRef(null);
  // Aborts the previous chart request when the timeframe (or ticker) changes.
  const chartAbort = useRef(null);
  const quotePending = useRef(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        setConnected(res.ok);
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        setDataMode(body?.data === 'live' || body?.data === 'eod' ? body.data : 'unknown');
      } catch {
        setConnected(false);
      }
    };
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const loadMacro = async () => {
      setLoadingMacro(true);
      try {
        const r = await getEconomicEvents();
        setMacroEvents(r.data.events);
      } catch (e) { console.error('Macro events error:', e); }
      finally { setLoadingMacro(false); }
    };
    loadMacro();
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key.length === 1 && /[A-Za-z0-9]/.test(e.key)) {
        const input = document.querySelector('input[placeholder*="TICKER"]');
        if (input) { input.focus(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const loadQuote = useCallback(async (t) => {
    try {
      const res = await getQuote(t);
      setQuote(res.data);
      setConnected(true);
    } catch (e) {
      console.error('Quote error:', e);
    }
  }, []);

  // `tickerSignal` (the ticker's AbortController) also cancels this load on a ticker switch.
  const loadChart = useCallback(async (t, tf, tickerSignal) => {
    chartAbort.current?.abort();
    const controller = new AbortController();
    chartAbort.current = controller;
    const { signal } = controller;
    const onTickerAbort = () => controller.abort();
    if (tickerSignal?.aborted) controller.abort();
    else tickerSignal?.addEventListener('abort', onTickerAbort, { once: true });
    // Only the newest load may write bars, and only for the ticker and timeframe on screen.
    const isCurrent = () => chartAbort.current === controller
      && currentTicker.current === t && timeframeRef.current === tf;

    setLoadingChart(true);
    try {
      const res = await withBusyRetry(() => getAggs(t, tf, { signal }), signal);
      if (isCurrent() && !signal.aborted) setBars(res.data.bars);
    } catch (e) {
      if (!signal.aborted) console.error('Chart error:', e);
    } finally {
      tickerSignal?.removeEventListener('abort', onTickerAbort);
      if (chartAbort.current === controller) setLoadingChart(false);
    }
  }, []);

  const loadStaticData = useCallback((t, signal) => {
    setPanelErrors({});
    // Fire everything at once — the backend's rate limiter does the pacing. News first so
    // it gets the earliest slot. Results for a ticker the user has moved away from are dropped.
    const load = (name, fetcher, onData, setLoading) => {
      if (setLoading) setLoading(true);
      withBusyRetry(() => fetcher(t, { signal }), signal)
        .then((r) => {
          if (currentTicker.current !== t) return;
          onData(r.data);
          if (r.data?.error) setPanelErrors(p => ({ ...p, [name]: r.data.error }));
        })
        .catch((e) => {
          if (signal.aborted || currentTicker.current !== t) return;
          console.error(`${name} error:`, e);
          setPanelErrors(p => ({ ...p, [name]: e?.response?.data?.detail || 'REQUEST FAILED' }));
        })
        .finally(() => {
          if (setLoading && currentTicker.current === t) setLoading(false);
        });
    };
    load('news', getNews, d => setNews(d.news), setLoadingNews);
    loadChart(t, timeframeRef.current, signal);
    load('details', getTickerDetails, d => setDetails(d));
    load('financials', getFinancials, d => setFinancials(d.financials), setLoadingFinancials);
    load('options', getOptions, d => setOptions(d.options), setLoadingOptions);
    load('earnings', getEarnings, d => setEarnings(d.earnings), setLoadingEarnings);
  }, [loadChart]);

  const handleTickerSelect = useCallback(async (t) => {
    if (!t) return;
    t = t.toUpperCase().trim();
    setTicker(t);
    currentTicker.current = t;

    setQuote(null); setDetails(null); setBars(null);
    setOptions(null); setNews(null); setFinancials(null); setEarnings(null);

    tickerAbort.current?.abort();
    const controller = new AbortController();
    tickerAbort.current = controller;

    // Kick off the slower panels immediately rather than after the quote arrives.
    loadStaticData(t, controller.signal);

    setLoadingQuote(true);
    try {
      await loadQuote(t);
    } finally {
      if (currentTicker.current === t) setLoadingQuote(false);
    }

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(async () => {
      // Skip this tick if the previous poll is still pending, so slow responses can't pile up.
      if (!currentTicker.current || quotePending.current) return;
      quotePending.current = true;
      try { await loadQuote(currentTicker.current); } finally { quotePending.current = false; }
    }, 2000);
  }, [loadQuote, loadStaticData]);

  const handleTimeframeChange = useCallback((tf) => {
    setTimeframe(tf);
    timeframeRef.current = tf;
    if (ticker) loadChart(ticker, tf, tickerAbort.current?.signal);
  }, [ticker, loadChart]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      <TopBar onTickerSelect={handleTickerSelect} connected={connected} dataMode={dataMode} />

      <div style={{ flex: 1, display: 'flex', gap: '2px', padding: '2px', minHeight: 0, overflow: 'hidden' }}>
        {/* Left: quote panel */}
        <Panel style={{ width: '220px', flexShrink: 0 }}>
          <PanelHeader label="QUOTE" />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <QuotePanel quote={quote} details={details} loading={loadingQuote} />
          </div>
        </Panel>

        {/* Right: chart + bottom row */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <Panel style={{ flex: '0 0 55%' }}>
            <ChartPanel
              bars={bars}
              timeframe={timeframe}
              onTimeframeChange={handleTimeframeChange}
              loading={loadingChart}
              ticker={ticker}
            />
          </Panel>

          <div style={{ flex: 1, display: 'flex', gap: '2px', minHeight: 0 }}>
            <Panel style={{ flex: '0 0 28%' }}>
              <PanelHeader label="OPTIONS CHAIN" />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <OptionsPanel options={options} loading={loadingOptions} error={panelErrors.options} />
              </div>
            </Panel>

            <Panel style={{ flex: '0 0 24%' }}>
              <PanelHeader label="NEWS FEED" />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <NewsPanel news={news} loading={loadingNews} error={panelErrors.news} />
              </div>
            </Panel>

            <Panel style={{ flex: '0 0 24%' }}>
              <PanelHeader label="FUNDAMENTALS" />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <FinancialsPanel financials={financials} loading={loadingFinancials} error={panelErrors.financials} />
              </div>
            </Panel>

            <Panel style={{ flex: 1 }}>
              <PanelHeader label="ECONOMIC CALENDAR" />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <CalendarPanel
                  earnings={earnings}
                  macroEvents={macroEvents}
                  ticker={ticker}
                  loadingEarnings={loadingEarnings}
                  earningsError={panelErrors.earnings}
                  loadingMacro={loadingMacro}
                />
              </div>
            </Panel>
          </div>
        </div>

        {/* Far right: watchlist + market movers */}
        <Panel style={{ width: '230px', flexShrink: 0 }}>
          <PanelHeader label="MONITOR" />
          <div style={{ flex: 1, minHeight: 0 }}>
            <MonitorPanel activeTicker={ticker} onSelect={handleTickerSelect} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
