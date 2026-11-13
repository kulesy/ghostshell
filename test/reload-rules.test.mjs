// Run with `npm test`. When an open page decides to reload after a restart: only from one commit to a different one, at once when nothing
// would be lost and behind a bar when words are unsent or an approval is open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachments, clearAttached, hasUnsent, NEW, quoted, setAttached, setDraftText, whileSending } from '../public/ui/draft.js';
import { noticeCommit, reloadStep } from '../public/ui/reload-rules.js';

test('the first commit a page sees is remembered and never counts as a change', () => {
  assert.deepEqual(noticeCommit(null, { commit: 'a1' }), { seen: 'a1', changed: false });
  assert.deepEqual(noticeCommit('a1', { commit: 'a1' }), { seen: 'a1', changed: false });
});

test('a different commit after the first is a change', () => {
  assert.deepEqual(noticeCommit('a1', { commit: 'b2' }), { seen: 'a1', changed: true });
});

test('a server that sends no commit, or an empty one, never triggers anything', () => {
  for (const ix of [null, {}, { commit: null }, { commit: '' }]) {
    assert.deepEqual(noticeCommit('a1', ix), { seen: 'a1', changed: false });
    assert.deepEqual(noticeCommit(null, ix), { seen: null, changed: false });
  }
});

test('an older server that sent nothing first does not trigger when a later one sends a commit', () => {
  assert.deepEqual(noticeCommit(null, { commit: 'b2' }), { seen: 'b2', changed: false });
});

test('a changed page reloads at once, unless words are unsent or an approval is open', () => {
  assert.equal(reloadStep({ changed: false, unsent: true, approving: true }), 'none');
  assert.equal(reloadStep({ changed: true, unsent: false, approving: false }), 'now');
  assert.equal(reloadStep({ changed: true, unsent: true, approving: false }), 'bar');
  assert.equal(reloadStep({ changed: true, unsent: false, approving: true }), 'bar');
});

test('typed text counts only for the box on screen, and images, files and quotes count wherever they are', () => {
  assert.equal(hasUnsent('a'), false);
  setDraftText('b', 'a stale draft in another session');
  assert.equal(hasUnsent('a'), false, 'a draft that localStorage keeps does not hold a reload');
  assert.equal(hasUnsent('b'), true);
  assert.equal(hasUnsent(null), false, 'no box on screen');
  setDraftText('b', '');
  setDraftText(NEW, '   ');
  assert.equal(hasUnsent(NEW), false, 'blank text is not a message');
  setDraftText(NEW, 'hello');
  assert.equal(hasUnsent(NEW), true);
  setDraftText(NEW, '');
  setAttached('b', { preparing: 1 });
  assert.equal(hasUnsent('a'), true, 'an image on its way in dies with the page');
  clearAttached('b');
  assert.equal(hasUnsent('a'), false);
  quoted.set({ quotes: [{ key: 'q', text: 'x', from: { id: 'b', title: 'B' } }] });
  assert.equal(hasUnsent('a'), true);
  quoted.set({ quotes: [] });
  assert.equal(hasUnsent('a'), false);
  assert.equal(Object.values(attachments.get()).filter(Boolean).length, 0);
});

test('a message whose send has not answered yet holds a reload, since its box is already cleared', async () => {
  let answer;
  const sent = whileSending(() => new Promise(resolve => { answer = resolve; }));
  assert.equal(hasUnsent(null), true);
  answer(true);
  assert.equal(await sent, true);
  assert.equal(hasUnsent(null), false);
});
