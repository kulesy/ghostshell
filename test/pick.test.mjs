// Run with `npm test`. The rules of the sidebar's multi-select that need no page: how Shift-click, Cmd-click and Shift+Arrow grow and
// shrink a selection round its anchor, which rows are dropped when they stop being drawn, where the focus goes once a batch leaves, and
// what the notes and the question say, and the title and the places a new parent for the picked rows starts with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorAt, archiveNote, extend, inOrder, NO_PICK, only, parentNote, parentTitle, parentUndoNote, placeOptions, prune, sessions, step, stayAfter, stopDetail, supportsNewParent, toggle, unarchiveNote } from '../public/ui/pick.js';

const ORDER = ['a', 'b', 'c', 'd', 'e', 'f'];
const sorted = state => inOrder(state, ORDER);

test('a plain click makes the row the anchor and picks nothing, and a second click on it changes nothing', () => {
  const picked = toggle(toggle(NO_PICK, 'b'), 'c');
  assert.deepEqual(anchorAt(picked, 'd'), { ids: [], base: [], anchor: 'd' });
  const clicked = anchorAt(NO_PICK, 'd');
  assert.equal(anchorAt(clicked, 'd'), clicked);
});

test('Shift-click picks the rows from the anchor down to the clicked row, the anchor included', () => {
  const state = extend(anchorAt(NO_PICK, 'b'), ORDER, 'e');
  assert.deepEqual(sorted(state), ['b', 'c', 'd', 'e']);
  assert.equal(state.anchor, 'b');
});

test('Shift-click picks the rows from the anchor up to the clicked row, the anchor included', () => {
  const state = extend(anchorAt(NO_PICK, 'e'), ORDER, 'b');
  assert.deepEqual(sorted(state), ['b', 'c', 'd', 'e']);
  assert.equal(state.anchor, 'e');
});

test('Shift-click on the anchor picks that row alone', () => {
  assert.deepEqual(sorted(extend(anchorAt(NO_PICK, 'c'), ORDER, 'c')), ['c']);
});

test('repeated Shift-clicks pivot round the anchor, growing the range, shrinking it and flipping it to the other side', () => {
  let state = anchorAt(NO_PICK, 'c');
  state = extend(state, ORDER, 'f');
  assert.deepEqual(sorted(state), ['c', 'd', 'e', 'f']);
  state = extend(state, ORDER, 'd');
  assert.deepEqual(sorted(state), ['c', 'd']);
  state = extend(state, ORDER, 'a');
  assert.deepEqual(sorted(state), ['a', 'b', 'c']);
  assert.equal(state.anchor, 'c');
});

test('rows picked with Cmd before the anchor was set stay through every Shift-click, and rows picked after it do not', () => {
  let state = toggle(toggle(NO_PICK, 'a'), 'd');
  state = extend(state, ORDER, 'f');
  assert.deepEqual(sorted(state), ['a', 'd', 'e', 'f']);
  state = extend(state, ORDER, 'c');
  assert.deepEqual(sorted(state), ['a', 'c', 'd']);
  state = extend(state, ORDER, 'd');
  assert.deepEqual(sorted(state), ['a', 'd']);
});

test('a Shift range after a plain click leaves out rows picked before that click, because the click cleared them', () => {
  const state = extend(anchorAt(toggle(NO_PICK, 'a'), 'c'), ORDER, 'd');
  assert.deepEqual(sorted(state), ['c', 'd']);
});

test('Cmd-click picks a row and moves the anchor to it, and Cmd-click on a picked row lets it go and still moves the anchor', () => {
  const on = toggle(toggle(NO_PICK, 'b'), 'd');
  assert.deepEqual(sorted(on), ['b', 'd']);
  assert.equal(on.anchor, 'd');
  const off = toggle(on, 'b');
  assert.deepEqual(sorted(off), ['d']);
  assert.equal(off.anchor, 'b');
  assert.deepEqual(off.base, off.ids);
});

test('the row Cmd-click let go is not in the next Shift range unless the range reaches it', () => {
  const off = toggle(toggle(toggle(NO_PICK, 'b'), 'd'), 'b');
  assert.deepEqual(sorted(extend(off, ORDER, 'c')), ['b', 'c', 'd']);
  assert.deepEqual(sorted(extend(off, ORDER, 'b')), ['b', 'd']);
});

test('Shift-click with no anchor picks just the clicked row and makes it the anchor', () => {
  const state = extend(NO_PICK, ORDER, 'c');
  assert.deepEqual(state, { ids: ['c'], base: ['c'], anchor: 'c' });
  assert.deepEqual(sorted(extend(state, ORDER, 'e')), ['c', 'd', 'e']);
});

test('Shift-click with an anchor that is not drawn picks just the clicked row, whatever else was picked', () => {
  const state = { ids: ['a', 'x'], base: ['a'], anchor: 'x' };
  assert.deepEqual(extend(state, ORDER, 'd'), { ids: ['d'], base: ['d'], anchor: 'd' });
});

test('Shift-click on a row that is not drawn changes nothing', () => {
  const state = anchorAt(NO_PICK, 'b');
  assert.equal(extend(state, ORDER, 'gone'), state);
});

test('the row menu\'s Select picks that row alone and anchors on it', () => {
  assert.deepEqual(only('c'), { ids: ['c'], base: ['c'], anchor: 'c' });
});

test('Shift+Down moves the focus to the next row and picks from the anchor to it, and Shift+Up goes back', () => {
  let go = step(anchorAt(NO_PICK, 'b'), ORDER, 'b', 'ArrowDown');
  assert.equal(go.to, 'c');
  assert.deepEqual(sorted(go.state), ['b', 'c']);
  go = step(go.state, ORDER, 'c', 'ArrowDown');
  assert.equal(go.to, 'd');
  assert.deepEqual(sorted(go.state), ['b', 'c', 'd']);
  go = step(go.state, ORDER, 'd', 'ArrowUp');
  assert.equal(go.to, 'c');
  assert.deepEqual(sorted(go.state), ['b', 'c']);
  go = step(go.state, ORDER, 'c', 'ArrowUp');
  go = step(go.state, ORDER, go.to, 'ArrowUp');
  assert.equal(go.to, 'a');
  assert.deepEqual(sorted(go.state), ['a', 'b']);
});

test('Shift+Arrow with no anchor makes the focused row the anchor', () => {
  const go = step(NO_PICK, ORDER, 'c', 'ArrowDown');
  assert.equal(go.to, 'd');
  assert.deepEqual(sorted(go.state), ['c', 'd']);
  assert.equal(go.state.anchor, 'c');
  assert.deepEqual(sorted(step(NO_PICK, ORDER, 'c', 'ArrowUp').state), ['b', 'c']);
});

test('Shift+Arrow keeps the rows picked with Cmd before the anchor was set', () => {
  const go = step(toggle(toggle(NO_PICK, 'a'), 'c'), ORDER, 'c', 'ArrowDown');
  assert.deepEqual(sorted(go.state), ['a', 'c', 'd']);
});

test('Shift+Arrow from a row that plain arrows moved the focus to takes that row as the anchor, not the row clicked before', () => {
  const clicked = anchorAt(NO_PICK, 'a');
  const go = step(clicked, ORDER, 'd', 'ArrowDown');
  assert.deepEqual(sorted(go.state), ['d', 'e']);
  assert.equal(go.state.anchor, 'd');
  assert.deepEqual(sorted(step(go.state, ORDER, 'e', 'ArrowDown').state), ['d', 'e', 'f']);
});

test('Shift+Arrow from a row off the range keeps the rows picked with Cmd and ranges from the focused row', () => {
  const go = step(toggle(NO_PICK, 'a'), ORDER, 'd', 'ArrowDown');
  assert.deepEqual(sorted(go.state), ['a', 'd', 'e']);
  assert.equal(go.state.anchor, 'd');
  assert.deepEqual(sorted(step(go.state, ORDER, 'e', 'ArrowUp').state), ['a', 'd']);
});

test('Shift+Arrow with an anchor that is no longer drawn keeps the rows still picked and anchors on the focused row', () => {
  const stale = { ids: ['a', 'c'], base: ['a'], anchor: 'gone' };
  const go = step(stale, ORDER, 'e', 'ArrowUp');
  assert.deepEqual(sorted(go.state), ['a', 'c', 'd', 'e']);
  assert.equal(go.state.anchor, 'e');
});

test('Shift+Arrow from a row inside the range keeps the anchor, so the range shrinks back to it', () => {
  const range = extend(anchorAt(NO_PICK, 'b'), ORDER, 'e');
  const go = step(range, ORDER, 'd', 'ArrowUp');
  assert.deepEqual(sorted(go.state), ['b', 'c']);
  assert.equal(go.state.anchor, 'b');
});

test('Shift+Arrow stops at the ends of the list, and does nothing from a row that is not drawn or for another key', () => {
  assert.equal(step(NO_PICK, ORDER, 'f', 'ArrowDown'), null);
  assert.equal(step(NO_PICK, ORDER, 'a', 'ArrowUp'), null);
  assert.equal(step(NO_PICK, ORDER, 'gone', 'ArrowDown'), null);
  assert.equal(step(NO_PICK, ORDER, 'c', 'ArrowLeft'), null);
  assert.equal(step(NO_PICK, [], 'c', 'ArrowDown'), null);
});

test('pruning drops the picked rows that are not drawn, and the anchor if it is not', () => {
  const state = { ids: ['a', 'c', 'x'], base: ['a', 'x'], anchor: 'x' };
  assert.deepEqual(prune(state, ORDER), { ids: ['a', 'c'], base: ['a'], anchor: null });
});

test('pruning keeps the anchor when it is drawn, even with nothing picked', () => {
  assert.deepEqual(prune({ ids: ['x'], base: [], anchor: 'b' }, ORDER), { ids: [], base: [], anchor: 'b' });
});

test('pruning hands back the same object when every row is drawn, so the page sets no state', () => {
  const state = extend(toggle(NO_PICK, 'a'), ORDER, 'd');
  assert.equal(prune(state, ORDER), state);
  assert.equal(prune(NO_PICK, ORDER), NO_PICK);
  assert.equal(prune(NO_PICK, []), NO_PICK);
});

test('pruning a selection whose rows are all hidden leaves nothing picked', () => {
  const state = extend(anchorAt(NO_PICK, 'b'), ORDER, 'd');
  const pruned = prune(state, ['a', 'e', 'f']);
  assert.deepEqual(pruned.ids, []);
  assert.equal(pruned.anchor, null);
});

test('the picked rows come in screen order, whatever order they were picked in', () => {
  assert.deepEqual(inOrder(toggle(toggle(toggle(NO_PICK, 'e'), 'b'), 'x'), ORDER), ['b', 'e']);
});

test('after a batch the focus goes to the row after the last one that left, else the one before the first, else the last one left', () => {
  assert.equal(stayAfter(ORDER, ['b', 'd']), 'e');
  assert.equal(stayAfter(ORDER, ['b', 'c']), 'd');
  assert.equal(stayAfter(ORDER, ['e', 'f']), 'd');
  assert.equal(stayAfter(ORDER, ['c', 'f']), 'b');
  assert.equal(stayAfter(ORDER, ['a', 'f']), 'e');
  assert.equal(stayAfter(ORDER, ['a', 'b', 'f']), 'e');
});

test('after a batch the focus has nowhere to go when every row leaves or none of them is drawn', () => {
  assert.equal(stayAfter(ORDER, ORDER), null);
  assert.equal(stayAfter(ORDER, ['x']), null);
  assert.equal(stayAfter([], ['a']), null);
});

test('sessions counts in words that read right for one', () => {
  assert.equal(sessions(1), '1 session');
  assert.equal(sessions(4), '4 sessions');
});

test('the question says how many are running and what archiving does to them, in the singular for one', () => {
  assert.equal(stopDetail(2), "2 of them are running. Archiving stops Claude's turn in each and denies any approval it is waiting for. Undo brings the sessions back, but not the turns.");
  assert.equal(stopDetail(1), "1 of them is running. Archiving stops Claude's turn in it and denies any approval it is waiting for. Undo brings the sessions back, but not the turn.");
});

test('the archive note counts the sessions and the ones stopped, and names how many went and the first reason when some did not', () => {
  assert.equal(archiveNote({ archived: 4, total: 4 }), 'Archived 4 sessions.');
  assert.equal(archiveNote({ archived: 4, total: 4, stopped: 2 }), 'Archived 4 sessions and stopped 2.');
  assert.equal(archiveNote({ archived: 3, total: 5, reason: 'No session with that id on this Mac.' }), 'Archived 3 of 5 sessions. Not archived: No session with that id on this Mac.');
  assert.equal(archiveNote({ archived: 3, total: 5, stopped: 1, reason: 'Failed to fetch' }), 'Archived 3 of 5 sessions and stopped 1. Not archived: Failed to fetch.');
  assert.equal(archiveNote({ archived: 0, total: 5, reason: 'HTTP 500' }), 'Not archived: HTTP 500.');
});

test('the unarchive note counts the sessions brought back, and names how many came and the first reason when some did not', () => {
  assert.equal(unarchiveNote({ restored: 3, total: 3 }), 'Unarchived 3 sessions.');
  assert.equal(unarchiveNote({ restored: 2, total: 4, reason: 'Signed out' }), 'Unarchived 2 of 4 sessions. Not unarchived: Signed out.');
  assert.equal(unarchiveNote({ restored: 0, total: 4, reason: 'HTTP 500' }), 'Not unarchived: HTTP 500.');
});

test('no note or question uses an em dash or an en dash', () => {
  const text = [stopDetail(1), stopDetail(3), archiveNote({ archived: 1, total: 2, stopped: 1, reason: 'x' }), unarchiveNote({ restored: 1, total: 2, reason: 'x' }), parentNote('Login', 3), parentUndoNote('Login', { removed: true }), parentUndoNote('Login', { removed: false })].join(' ');
  assert.doesNotMatch(text, /[\u2013\u2014]/);
});

test('a new parent\'s title is the words the titles begin with, compared without case and spelled as the first title spells them', () => {
  assert.equal(parentTitle(['Fix login bug', 'fix LOGIN flow', 'Fix login redirect']), 'Fix login');
  assert.equal(parentTitle(['Refactoring the parser', 'refactoring tests']), 'Refactoring');
  assert.equal(parentTitle(['Review Tina PR 12', 'Review Tina PR 13']), 'Review Tina PR');
});

test('a new parent\'s title drops the spaces, hyphens, colons and dashes the common words end in', () => {
  assert.equal(parentTitle(['Fix login - part 1', 'Fix login - part 2']), 'Fix login - part');
  assert.equal(parentTitle(['Fix login - a', 'Fix login - b']), 'Fix login');
  assert.equal(parentTitle(['Fix login: a', 'Fix login: b']), 'Fix login');
  assert.equal(parentTitle(['Fix login \u2013 a', 'Fix login \u2014 b', 'Fix login \u2015 c']), 'Fix login');
});

test('a common start of one word under eight characters is not used, and one word of eight is', () => {
  assert.equal(parentTitle(['Refactor a', 'Refactor b']), 'Refactor');
  assert.equal(parentTitle(['Fix: a', 'Fix: b']), 'Fix: a and 1 more');
  assert.equal(parentTitle(['Alpha', 'Beta', 'Gamma']), 'Alpha and 2 more');
  assert.equal(parentTitle(['Fix it now', 'Fix this']), 'Fix it now and 1 more');
  assert.equal(parentTitle(['Same words', 'Same words', 'same WORDS']), 'Same words');
});

test('a title that has to be cut to fit leaves the room for "and N more" and ends on a word boundary', () => {
  const long = 'word '.repeat(40).trim();
  const title = parentTitle([long, 'other'], 120);
  assert.ok([...title].length <= 120, `${[...title].length}`);
  assert.match(title, /^(word )+word and 1 more$/);
  const unbroken = parentTitle(['x'.repeat(130), 'y'], 120);
  assert.equal([...unbroken].length, 120);
  assert.ok(unbroken.endsWith(' and 1 more'));
  assert.equal(parentTitle(['one', 'two'], 20), 'one and 1 more');
  assert.equal(parentTitle(['y'.repeat(130), 'y'.repeat(130)], 120), 'y'.repeat(120), 'a common start is cut to the limit too');
});

test('a new parent\'s title counts characters, so an emoji is one', () => {
  const title = parentTitle(['\u{1F600}'.repeat(60), 'z'], 50);
  assert.equal([...title].length, 50);
});

test('the places among the picked rows are listed once each in screen order, with a group by its name, Pinned, and Started here for the loose ones', () => {
  const groups = [{ id: 'cg-a', name: 'Reviewing' }, { id: 'cg-b', name: 'Backlog' }];
  const rows = [{ id: 'a', group: 'cg-b', pinned: false }, { id: 'b', group: null, pinned: true }, { id: 'c', group: 'cg-b', pinned: false }, { id: 'd', group: null, pinned: false }, { id: 'e', group: null, pinned: false, routine: 'nightly' }];
  assert.deepEqual(placeOptions(rows, groups), [
    { key: 'cg-b', label: 'Backlog', place: { group: 'cg-b', pinned: false } },
    { key: 'pinned', label: 'Pinned', place: { group: null, pinned: true } },
    { key: 'loose', label: 'Started here', place: { group: null, pinned: false } },
  ]);
  assert.equal(placeOptions([rows[0], rows[2]], groups).length, 1, 'rows in one place need no choice');
});

test('the page shows the new parent only when the server says it can make one', () => {
  assert.equal(supportsNewParent({ features: { newParent: true } }), true);
  assert.equal(supportsNewParent({ features: {} }), false);
  assert.equal(supportsNewParent(null), false);
  assert.equal(parentNote('Login', 3), 'Made \u201cLogin\u201d the parent of 3 sessions.');
});
