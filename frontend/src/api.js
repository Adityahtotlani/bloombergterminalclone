import axios from 'axios';

const client = axios.create({ baseURL: '' });

export const searchTickers = (q) => client.get('/api/search', { params: { q } });
export const getQuote = (ticker) => client.get(`/api/quote/${ticker}`);
export const getAggs = (ticker, timeframe, opts) => client.get(`/api/aggs/${ticker}`, { params: { timeframe }, ...opts });
export const getOptions = (ticker, opts) => client.get(`/api/options/${ticker}`, opts);
export const getNews = (ticker, opts) => client.get(`/api/news/${ticker}`, opts);
export const getFinancials = (ticker, opts) => client.get(`/api/financials/${ticker}`, opts);
export const getTickerDetails = (ticker, opts) => client.get(`/api/ticker-details/${ticker}`, opts);
export const getEarnings = (ticker, opts) => client.get(`/api/earnings/${ticker}`, opts);
export const getEconomicEvents = () => client.get('/api/economic-events');
export const getWatchlist = (tickers) => client.get('/api/watchlist', { params: { tickers: tickers.join(',') } });
export const getMovers = (direction) => client.get(`/api/movers/${direction}`);
