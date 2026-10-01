import axios from 'axios';

const client = axios.create({ baseURL: '' });

export const searchTickers = (q) => client.get('/api/search', { params: { q } });
export const getQuote = (ticker) => client.get(`/api/quote/${ticker}`);
export const getAggs = (ticker, timeframe) => client.get(`/api/aggs/${ticker}`, { params: { timeframe } });
export const getOptions = (ticker) => client.get(`/api/options/${ticker}`);
export const getNews = (ticker) => client.get(`/api/news/${ticker}`);
export const getFinancials = (ticker) => client.get(`/api/financials/${ticker}`);
export const getTickerDetails = (ticker) => client.get(`/api/ticker-details/${ticker}`);
export const getEarnings = (ticker) => client.get(`/api/earnings/${ticker}`);
export const getEconomicEvents = () => client.get('/api/economic-events');
export const getWatchlist = (tickers) => client.get('/api/watchlist', { params: { tickers: tickers.join(',') } });
export const getMovers = (direction) => client.get(`/api/movers/${direction}`);
