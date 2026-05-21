import { useState, useEffect, useCallback, useRef } from 'react';
import TopBar from './components/TopBar';
import QuotePanel from './components/QuotePanel';
import ChartPanel from './components/ChartPanel';
import OptionsPanel from './components/OptionsPanel';
import NewsPanel from './components/NewsPanel';
import FinancialsPanel from './components/FinancialsPanel';
import { getQuote, getAggs, getOptions, getNews, getFinancials, getTickerDetails } from './api';
import './App.css';

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
  const [connected, setConnected] = useState(false);

  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingFinancials, setLoadingFinancials] = useState(false);

  const intervalRef = useRef(null);
  const currentTicker = useRef('');

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        setConnected(res.ok);
      } catch {
        setConnected(false);
      }
    };
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
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

  const loadChart = useCallback(async (t, tf) => {
    setLoadingChart(true);
    try {
      const res = await getAggs(t, tf);
      setBars(res.data.bars);
    } catch (e) {
      console.error('Chart error:', e);
    } finally {
      setLoadingChart(false);
    }
  }, []);

  const loadStaticData = useCallback(async (t) => {
    setLoadingOptions(true);
    setLoadingNews(true);
    setLoadingFinancials(true);

    try {
      const r = await getTickerDetails(t);
      setDetails(r.data);
    } catch (e) { console.error('Details error:', e); }

    await new Promise(r => setTimeout(r, 600));

    try {
      const r = await getNews(t);
      setNews(r.data.news);
    } catch (e) { console.error('News error:', e); }
    finally { setLoadingNews(false); }

    await new Promise(r => setTimeout(r, 600));

    try {
      const r = await getFinancials(t);
      setFinancials(r.data.financials);
    } catch (e) { console.error('Financials error:', e); }
    finally { setLoadingFinancials(false); }

    await new Promise(r => setTimeout(r, 600));

    try {
      const r = await getOptions(t);
      setOptions(r.data.options);
    } catch (e) { console.error('Options error:', e); }
    finally { setLoadingOptions(false); }
  }, []);

  const handleTickerSelect = useCallback(async (t) => {
    if (!t) return;
    t = t.toUpperCase().trim();
    setTicker(t);
    currentTicker.current = t;

    setQuote(null); setDetails(null); setBars(null);
    setOptions(null); setNews(null); setFinancials(null);

    setLoadingQuote(true);
    try {
      await loadQuote(t);
    } finally {
      setLoadingQuote(false);
    }

    loadChart(t, timeframe);
    loadStaticData(t);

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (currentTicker.current) loadQuote(currentTicker.current);
    }, 5000);
  }, [loadQuote, loadChart, loadStaticData, timeframe]);

  const handleTimeframeChange = useCallback((tf) => {
    setTimeframe(tf);
    if (ticker) loadChart(ticker, tf);
  }, [ticker, loadChart]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      <TopBar onTickerSelect={handleTickerSelect} connected={connected} />

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
            <Panel style={{ flex: '0 0 38%' }}>
              <PanelHeader label="OPTIONS CHAIN" />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <OptionsPanel options={options} loading={loadingOptions} />
              </div>
            </Panel>

            <Panel style={{ flex: '0 0 32%' }}>
              <PanelHeader label="NEWS FEED" />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <NewsPanel news={news} loading={loadingNews} />
              </div>
            </Panel>

            <Panel style={{ flex: 1 }}>
              <PanelHeader label="FUNDAMENTALS" />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <FinancialsPanel financials={financials} loading={loadingFinancials} />
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
