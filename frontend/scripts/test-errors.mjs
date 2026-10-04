// Checks for src/lib/errors.js using Node's built-in test runner (no dependency).
// Run: npm test   (or: node --test scripts/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorText } from '../src/lib/errors.js';

const err = (detail) => ({ response: { data: { detail } } });

test('shows short backend messages as-is', () => {
  assert.equal(errorText(err('Data provider timed out — retry shortly')), 'Data provider timed out — retry shortly');
  assert.equal(errorText(err('Data provider error (HTTP 404)')), 'Data provider error (HTTP 404)');
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
