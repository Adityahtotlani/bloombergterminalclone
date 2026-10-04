/**
 * Panel-friendly text for a failed API request. Shows the backend's `detail` when it is a
 * short message (e.g. "Data provider timed out — retry shortly"), but never a raw JSON blob
 * passed through from the data provider, a validation array, or an empty value.
 */
export const errorText = (e) => {
  const detail = e?.response?.data?.detail;
  return typeof detail === 'string' && detail && !detail.trimStart().startsWith('{') ? detail : 'REQUEST FAILED';
};
