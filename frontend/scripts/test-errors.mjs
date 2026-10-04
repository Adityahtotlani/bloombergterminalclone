// Checks for src/lib/errors.js using Node's built-in test runner (no dependency).
// Run: npm test   (or: node --test scripts/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorText } from '../src/lib/errors.js';

const err = (detail) => ({ response: { data: { detail } } });

test('shows short backend messages as-is', () => {
  assert.equal(errorText(err('Data provider timed out — retry shortly')), 'Data provider timed out — retry shortly');
  assert.equal(errorText(err('Data provider error (HTTP 404)')), 'Data provider error (HTTP 404)');
  assert.equal(
    errorText(err('Data provider: not included in the current data plan (HTTP 403)')),
    'Data provider: not included in the current data plan (HTTP 403)',
  );
  assert.equal(
    errorText(err('Data provider endpoint deprecated or temporarily unavailable (HTTP 410)')),
    'Data provider endpoint deprecated or temporarily unavailable (HTTP 410)',
  );
  assert.equal(
    errorText(err('Data provider error (HTTP 500) — retry shortly')),
    'Data provider error (HTTP 500) — retry shortly',
  );
  const keyMsg = 'Data provider rejected the API key — check POLYGON_API_KEY in backend/.env and restart the backend';
  assert.equal(errorText(err(keyMsg)), keyMsg);
});

test('hides HTML/markup details', () => {
  assert.equal(errorText(err('<html><body><h1>403 Forbidden</h1></body></html>')), 'REQUEST FAILED');
  assert.equal(errorText(err('<!DOCTYPE html><html></html>')), 'REQUEST FAILED');
  assert.equal(errorText(err('\n  <html>gone</html>')), 'REQUEST FAILED');
});

test('hides implausibly long and whitespace-only details', () => {
  assert.equal(errorText(err('x'.repeat(200))), 'x'.repeat(200));
  assert.equal(errorText(err('x'.repeat(201))), 'REQUEST FAILED');
  assert.equal(errorText(err(`Forbidden: ${'plan details '.repeat(30)}`)), 'REQUEST FAILED');
  assert.equal(errorText(err('   ')), 'REQUEST FAILED');
});

test('hides raw JSON, non-string and missing details', () => {
  assert.equal(errorText(err('{"status":"ERROR","request_id":"abc","error":"Internal"}')), 'REQUEST FAILED');
  assert.equal(errorText(err('  {"status":"ERROR"}')), 'REQUEST FAILED');
  assert.equal(errorText(err([{ type: 'missing', loc: ['query', 'q'] }])), 'REQUEST FAILED');
  assert.equal(errorText(err('')), 'REQUEST FAILED');
  assert.equal(errorText({ response: { data: '<html>502</html>' } }), 'REQUEST FAILED');
  assert.equal(errorText(new Error('Network Error')), 'REQUEST FAILED');
  assert.equal(errorText(undefined), 'REQUEST FAILED');
});
