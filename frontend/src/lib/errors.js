// Longest `detail` shown verbatim. Our own messages are well under this (the longest, the
// API-key message, is ~100 chars); anything longer is assumed to be a passed-through body.
const MAX_DETAIL_LENGTH = 200;

/**
 * Panel-friendly text for a failed API request. Shows the backend's `detail` when it is a
 * short message (e.g. "Data provider timed out — retry shortly"), but never a raw JSON blob
 * or HTML/markup page passed through from the data provider, an implausibly long string,
 * a validation array, or an empty value.
 */
export const errorText = (e) => {
  const detail = e?.response?.data?.detail;
  if (typeof detail !== 'string') return 'REQUEST FAILED';
  const trimmed = detail.trim();
  if (!trimmed || trimmed.length > MAX_DETAIL_LENGTH || trimmed.startsWith('{') || trimmed.startsWith('<')) {
    return 'REQUEST FAILED';
  }
  return detail;
};
