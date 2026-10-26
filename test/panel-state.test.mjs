// Run with `npm test`. Which tabs a chat's panel can be saved on, and what the buttons that open and close it do to what is saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOSED, closeQuietly, hidePanel, openQuietly, panelNow, panelOf, panels, restorePanel, selectTab, showPanel, takeWant, toggleTab, valid } from '../public/ui/panel-state.js';

const now = id => panelOf(panels.get(), id);

test('a saved panel is kept on the sub sessions, subagents, terminal or file tab and on no other', () => {
  const kept = valid({
    h: { open: true, tab: 'agents' }, a: { open: true, tab: 'subs' }, b: { open: false, tab: 'terminal' }, c: { open: true, tab: 'file' },
    d: { open: true, tab: 'map' }, e: { open: 'yes', tab: 'subs' }, f: null, g: { tab: 'subs' },
  });
  assert.deepEqual(kept, { h: { open: true, tab: 'agents' }, a: { open: true, tab: 'subs' }, b: { open: false, tab: 'terminal' }, c: { open: true, tab: 'file' } });
  assert.deepEqual(valid(null), {});
  assert.deepEqual(valid('subs'), {});
});

test('a panel that opens by itself is open on its tab, asks for no focus and is not saved, and one opened by a button is saved and asks for the focus', t => {
  const written = [];
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: (key, value) => written.push([key, value]) } });
  t.after(() => (had ? Object.defineProperty(globalThis, 'localStorage', had) : delete globalThis.localStorage));
  openQuietly('quiet', 'subs');
  assert.deepEqual(now('quiet'), { open: true, tab: 'subs' });
  assert.equal(takeWant('quiet'), null);
  assert.equal('quiet' in panels.get().byId, false, 'it is not the owner\'s choice');
  assert.deepEqual(written, [], 'and nothing is written for the next visit');
  toggleTab('asked', 'subs', null, null);
  assert.deepEqual(now('asked'), { open: true, tab: 'subs' });
  assert.equal(takeWant('asked')?.tab, 'subs');
  assert.deepEqual(Object.keys(JSON.parse(written.at(-1)[1])), ['asked']);
});

test('a panel that opened by itself goes when the chat has no room for it, comes back when it has, and leaves a chat the owner has chosen for alone', () => {
  openQuietly('roomy', 'subs');
  let heard = 0;
  const stop = panels.subscribe(() => { heard++; });
  openQuietly('roomy', 'subs');
  assert.equal(heard, 0, 'opening it again is nothing to tell');
  closeQuietly('roomy');
  assert.deepEqual(now('roomy'), CLOSED);
  assert.equal(heard, 1);
  closeQuietly('roomy');
  assert.equal(heard, 1, 'closing what is not open is nothing to tell');
  stop();
  openQuietly('roomy', 'subs');
  assert.deepEqual(now('roomy'), { open: true, tab: 'subs' });
  hidePanel('shut');
  openQuietly('shut', 'subs');
  assert.deepEqual(now('shut'), { open: false, tab: 'terminal' }, 'a panel the owner closed stays closed');
  closeQuietly('shut');
  assert.deepEqual(now('shut'), { open: false, tab: 'terminal' });
});

test('the owner opening or closing a panel that opened by itself is saved as their choice, and picking a tab on it is not', () => {
  openQuietly('picked', 'subs');
  selectTab('picked', 'file');
  assert.deepEqual(now('picked'), { open: true, tab: 'file' });
  assert.equal('picked' in panels.get().byId, false, 'a tab picked on a panel that is not the owner\'s stays that way');
  closeQuietly('picked');
  assert.deepEqual(now('picked'), CLOSED);

  openQuietly('closed', 'subs');
  toggleTab('closed', 'subs', null, 'subs');
  assert.deepEqual(panels.get().byId.closed, { open: false, tab: 'subs' });
  assert.equal('closed' in panels.get().auto, false);
  closeQuietly('closed');
  openQuietly('closed', 'subs');
  assert.deepEqual(now('closed'), { open: false, tab: 'subs' }, 'it does not open by itself again');

  openQuietly('opened', 'subs');
  toggleTab('opened', 'terminal', null, 'subs');
  assert.deepEqual(panels.get().byId.opened, { open: true, tab: 'terminal' });
  assert.equal('opened' in panels.get().auto, false);
  assert.deepEqual(valid(panels.get().byId).opened, { open: true, tab: 'terminal' });
});

test('a panel opened for a moment goes back to how it was, saved or not, open or not', () => {
  openQuietly('was-auto', 'subs');
  const auto = panelNow('was-auto');
  showPanel('was-auto', 'file', null);
  assert.deepEqual(now('was-auto'), { open: true, tab: 'file' });
  restorePanel('was-auto', auto);
  assert.deepEqual(now('was-auto'), { open: true, tab: 'subs' });
  assert.equal('was-auto' in panels.get().byId, false, 'it is not saved as the owner\'s choice');

  const none = panelNow('was-none');
  showPanel('was-none', 'file', null);
  restorePanel('was-none', none);
  assert.deepEqual(now('was-none'), CLOSED);
  assert.equal('was-none' in panels.get().byId, false);

  toggleTab('was-saved', 'terminal', null, null);
  const saved = panelNow('was-saved');
  showPanel('was-saved', 'file', null);
  restorePanel('was-saved', saved);
  assert.deepEqual(now('was-saved'), { open: true, tab: 'terminal' });
});

test('the button for a tab opens the panel on it, switches to it from another tab, and closes the panel from it', () => {
  toggleTab('toggled', 'subs', null, null);
  assert.deepEqual(now('toggled'), { open: true, tab: 'subs' });
  toggleTab('toggled', 'terminal', null, 'subs');
  assert.deepEqual(now('toggled'), { open: true, tab: 'terminal' });
  toggleTab('toggled', 'terminal', null, 'terminal');
  assert.deepEqual(now('toggled'), { open: false, tab: 'terminal' });
  toggleTab('toggled', 'subs', null, null);
  assert.deepEqual(now('toggled'), { open: true, tab: 'subs' });
  hidePanel('toggled');
  selectTab('toggled', 'file');
  assert.deepEqual(now('toggled'), { open: false, tab: 'file' });
});
