// Run with `npm test`. Dragging a group's header, as rules that need no page: the place among the groups of the view that a pointer
// names, where a group can go to in another view, which headers are handles, and the note after a drop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canGrab, orderNote, parseTarget, slotFor, slotTarget, viewTargets } from '../public/ui/group-drag-rules.js';

const ORDER = ['a', 'b', 'c', 'd'];
const AREA = { left: 0, right: 300, top: 100, bottom: 500 };
const MIDS = { a: 120, b: 220, c: 320, d: 420 };

const slot = (carried, y, { order = ORDER, mids = MIDS, area = AREA, x = 100 } = {}) => slotTarget(slotFor({ order, carried, mids, area, at: { x, y } }));

test('a group dropped with its header middle below others lands after as many of them as are above the pointer', () => {
  assert.equal(slot('a', 330), 'before:d');
  assert.equal(slot('a', 250), 'before:c');
  assert.equal(slot('d', 150), 'before:b');
});

test('a group carried to the very top lands before the first of the others, and to the very bottom after the last', () => {
  assert.equal(slot('c', 101), 'before:a');
  assert.equal(slot('a', 499), 'after:d');
  assert.equal(slot('b', 499), 'after:d');
});

test('the carried group does not count in the others, so its own header never moves the place', () => {
  assert.equal(slot('b', 200), null);
  assert.equal(slot('b', 230), null);
  assert.equal(slot('b', 110), 'before:a');
  assert.equal(slot('b', 330), 'before:d');
});

test('a place where the group already is has no target', () => {
  assert.equal(slot('a', 101), null);
  assert.equal(slot('a', 200), null);
  assert.equal(slot('d', 499), null);
  assert.equal(slot('c', 330), null);
});

test('every pointer height between the headers of two groups names the place between them, so an open group has no dead zone', () => {
  const tall = { ...MIDS, c: 700, d: 800 };
  const area = { ...AREA, bottom: 1000 };
  assert.deepEqual([230, 400, 690].map(y => slot('a', y, { mids: tall, area })), ['before:c', 'before:c', 'before:c']);
  assert.equal(slot('a', 710, { mids: tall, area }), 'before:d');
});

test('a pointer outside the groups has no target: above the first, below the last, left of the list or right of it', () => {
  assert.equal(slot('c', 99), null);
  assert.equal(slot('c', 501), null);
  assert.equal(slot('c', 110, { x: -1 }), null);
  assert.equal(slot('c', 110, { x: 301 }), null);
  assert.equal(slot('c', 110, { x: 0 }), 'before:a');
  assert.equal(slot('c', 110, { x: 300 }), 'before:a');
});

test('over the fixed sections above or below the groups there is no target', () => {
  const area = { left: 0, right: 300, top: 200, bottom: 400 };
  const mids = { a: 220, b: 280, c: 340 };
  const order = ['a', 'b', 'c'];
  assert.equal(slot('c', 150, { area, mids, order }), null);
  assert.equal(slot('a', 450, { area, mids, order }), null);
  assert.equal(slot('c', 210, { area, mids, order }), 'before:a');
});

test('a view with no groups, or only the carried one, has no place', () => {
  assert.equal(slot('a', 150, { order: [], mids: {} }), null);
  assert.equal(slot('a', 150, { order: ['a'], mids: { a: 120 } }), null);
  assert.equal(slotFor({ order: ORDER, carried: 'a', mids: MIDS, area: null, at: { x: 1, y: 1 } }), null);
});

test('a group whose header is level with the pointer is below it, not above', () => {
  assert.equal(slot('d', 120), 'before:a');
  assert.equal(slot('d', 121), 'before:b');
});

test('Home and every project but the view a group is in are where it can move to', () => {
  const projects = [{ id: 'cp-one', name: 'Project One' }, { id: 'cp-two', name: 'Project Two' }];
  assert.deepEqual(viewTargets(projects, null), [
    { id: 'to:cp-one', project: 'cp-one', label: 'Project One' },
    { id: 'to:cp-two', project: 'cp-two', label: 'Project Two' },
  ]);
  assert.deepEqual(viewTargets(projects, 'cp-one'), [
    { id: 'to:', project: null, label: 'Home' },
    { id: 'to:cp-two', project: 'cp-two', label: 'Project Two' },
  ]);
});

test('with no projects, Home has nowhere to move a group to, and a project that is gone leaves Home', () => {
  assert.deepEqual(viewTargets([], null), []);
  assert.deepEqual(viewTargets([{ id: 'cp-one', name: 'Project One' }], 'cp-one'), [{ id: 'to:', project: null, label: 'Home' }]);
});

test('a header is a handle when its group can be ordered among others or moved to another view', () => {
  assert.equal(canGrab({ edits: true, count: 2, targets: 0 }), true);
  assert.equal(canGrab({ edits: true, count: 1, targets: 1 }), true);
  assert.equal(canGrab({ edits: false, count: 3, targets: 1 }), true);
  assert.equal(canGrab({ edits: true, count: 1, targets: 0 }), false);
  assert.equal(canGrab({ edits: false, count: 3, targets: 0 }), false);
});

test('a target names a move to a project or Home, or a place beside a group, and anything else names nothing', () => {
  assert.deepEqual(parseTarget('to:cp-one'), { move: 'cp-one' });
  assert.deepEqual(parseTarget('to:'), { move: null });
  assert.deepEqual(parseTarget('before:cg-a'), { side: 'before', beside: 'cg-a' });
  assert.deepEqual(parseTarget('after:cg-a'), { side: 'after', beside: 'cg-a' });
  for (const other of [null, undefined, '', 'pinned', 'nest:r1', 'before:']) assert.equal(parseTarget(other), null);
  assert.equal(slotTarget(null), null);
});

test('the note says the group went above or below the one it landed beside', () => {
  assert.equal(orderNote('Alpha', 'Bravo', 'before'), 'Moved “Alpha” above “Bravo”.');
  assert.equal(orderNote('Alpha', 'Bravo', 'after'), 'Moved “Alpha” below “Bravo”.');
});
