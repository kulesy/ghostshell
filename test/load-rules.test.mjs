// Run with `npm test`. What the chat body shows while a session's history loads: a spinner, the failure, or nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadingView } from '../public/ui/load-rules.js';

const view = (extra = {}) => loadingView({ draft: false, loaded: false, failed: false, sending: false, ...extra });

test('a new session never spins', () => {
  assert.equal(view({ draft: true }), null);
  assert.equal(view({ draft: true, failed: true }), null);
});

test('the first load spins', () => {
  assert.equal(view(), 'loading');
});

test('a failed load says so instead of spinning', () => {
  assert.equal(view({ failed: true }), 'failed');
});

test('a loaded session shows its messages', () => {
  assert.equal(view({ loaded: true }), null);
});

test('a loaded session with no messages shows nothing extra', () => {
  assert.equal(view({ loaded: true, failed: false }), null);
});

test('a message being sent before the load fills the body', () => {
  assert.equal(view({ sending: true }), null);
});

test('a failed load shows the failure even with a message being sent', () => {
  assert.equal(loadingView({ draft: false, loaded: false, failed: true, sending: true }), 'failed');
});
