// Run with `npm test`. How the sessions below a session add up: the lines of its tree, the order they come in, and the roll-up over every level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECENT_MS } from '../public/ui/group-rules.js';
import { descendantsOf, familyDot, orderLines, rankOf, rollupLine, rollupOf, subsOf, tally, treeOf } from '../public/ui/sub-rules.js';
import { withKids } from '../public/ui/tree.js';

const NOW = Date.parse('2026-10-23T06:00:00.000Z');
const MINUTE = 60_000;
const row = (id, parent, state, ago, extra) => ({ id, parent, state, dot: null, archived: false, lastActivityAt: NOW - ago, ...extra });
const ids = list => list.map(r => r.id);
const shape = nodes => nodes.map(n => (n.subs.length ? [n.row.id, shape(n.subs)] : n.row.id));

// Three levels under `top`: two children, one with two children of its own, one of those with a child.
//   top
//     a (idle, busy below)    a1 (working)      a2 (waiting)   a2x (idle)
//     b (idle, nothing below)
const ROWS = [
  row('top', null, 'idle', 5 * MINUTE),
  row('a', 'top', 'idle', 30 * MINUTE),
  row('a1', 'a', 'working', 2 * MINUTE, { dot: 'running' }),
  row('a2', 'a', 'waiting', 40 * MINUTE, { dot: 'awaiting' }),
  row('a2x', 'a2', 'idle', 3 * RECENT_MS),
  row('b', 'top', 'idle', MINUTE),
  row('elsewhere', 'other', 'waiting', MINUTE),
];

test('the sessions straight under a session are the rows whose parent names it', () => {
  assert.deepEqual(ids(subsOf(ROWS, 'top')), ['a', 'b']);
  assert.deepEqual(ids(subsOf(ROWS, 'a2')), ['a2x']);
  assert.deepEqual(subsOf(ROWS, 'b'), []);
  assert.deepEqual(subsOf(ROWS, 'nobody'), []);
});

test('the tree has a line for every session at every level, and a line holds the lines under it', () => {
  assert.deepEqual(shape(treeOf(ROWS, 'top', NOW)), [['a', [['a2', ['a2x']], 'a1']], 'b']);
  assert.deepEqual(ids(descendantsOf(ROWS, 'top')).sort(), ['a', 'a1', 'a2', 'a2x', 'b']);
  assert.deepEqual(treeOf(ROWS, 'b', NOW), []);
  assert.deepEqual(treeOf(ROWS, 'elsewhere', NOW), []);
});

test('lines that need you come first, then those working, recent and idle, judged by the most urgent session in the line and under it', () => {
  const line = (id, state, ago, subs = []) => ({ row: row(id, null, state, ago), subs });
  const out = ids(orderLines([
    line('idle-new', 'idle', 3 * RECENT_MS),
    line('recent', 'idle', 10 * MINUTE),
    line('working', 'working', 50 * MINUTE),
    line('idle-over-waiting', 'idle', 3 * RECENT_MS, [line('deep', 'idle', 3 * RECENT_MS, [line('deeper', 'waiting', 2 * MINUTE)])]),
    line('waiting', 'waiting', 9 * MINUTE),
    line('idle-over-working', 'idle', 3 * RECENT_MS, [line('kid', 'working', MINUTE)]),
  ], NOW).map(n => n.row));
  assert.deepEqual(out, ['waiting', 'idle-over-waiting', 'working', 'idle-over-working', 'recent', 'idle-new']);
});

test('in each part the newest line comes first, a tie goes by id, and the list handed in is left as it was', () => {
  const line = (id, ago) => ({ row: row(id, null, 'idle', ago), subs: [] });
  const given = [line('c', 4 * MINUTE), line('b', 2 * MINUTE), line('a', 2 * MINUTE), line('d', 3 * MINUTE)];
  assert.deepEqual(ids(orderLines(given, NOW).map(n => n.row)), ['a', 'b', 'd', 'c']);
  assert.deepEqual(ids(given.map(n => n.row)), ['c', 'b', 'a', 'd']);
  assert.deepEqual(orderLines([], NOW), []);
});

test('the tree puts its lines in that order at every level', () => {
  assert.deepEqual(shape(treeOf(ROWS, 'a', NOW)), [['a2', ['a2x']], 'a1']);
  const flipped = [...ROWS].reverse();
  assert.deepEqual(shape(treeOf(flipped, 'top', NOW)), shape(treeOf(ROWS, 'top', NOW)));
});

test('a loop in the links ends the walk, and a session never appears twice', () => {
  const loop = [row('x', 'z', 'idle', MINUTE), row('y', 'x', 'idle', MINUTE), row('z', 'y', 'idle', MINUTE), row('self', 'self', 'idle', MINUTE), row('r', 'self', 'working', MINUTE)];
  assert.deepEqual(shape(treeOf(loop, 'x', NOW)), [['y', ['z']]]);
  assert.deepEqual(ids(descendantsOf(loop, 'x')).sort(), ['y', 'z']);
  assert.deepEqual(shape(treeOf(loop, 'self', NOW)), ['r']);
  assert.equal(rollupOf(loop, 'x', NOW).total, 2);
  const twice = [row('p', null, 'idle', MINUTE), row('c', 'p', 'idle', MINUTE), row('c', 'p', 'idle', MINUTE)];
  assert.equal(treeOf(twice, 'p', NOW).length, 1);
});

test('a row ranks by its mark, or by its state when it has no mark, and an archived row does not rank', () => {
  const ranks = [{ dot: 'awaiting' }, { dot: 'error' }, { dot: 'running' }, { dot: 'ready' }, { dot: null }].map(rankOf);
  assert.deepEqual([...ranks].sort((a, b) => b - a), ranks, 'awaiting, error, running, ready, then none');
  assert.equal(new Set(ranks).size, 5);
  assert.equal(rankOf({ state: 'waiting' }), rankOf({ dot: 'awaiting' }));
  assert.equal(rankOf({ state: 'working' }), rankOf({ dot: 'running' }));
  assert.equal(rankOf({ state: 'idle' }), rankOf({ dot: null }));
  assert.equal(rankOf({ state: 'working', dot: 'error' }), rankOf({ dot: 'error' }), 'the more urgent of the two');
  assert.equal(rankOf({ state: 'waiting', dot: 'ready' }), rankOf({ dot: 'awaiting' }));
  assert.equal(rankOf({ state: 'waiting', dot: 'awaiting', archived: true }), 0);
  assert.equal(rankOf({ dot: 'not-a-mark' }), 0);
});

test('the roll-up counts every session below at every level by part, and carries the most urgent mark among them', () => {
  assert.deepEqual(rollupOf(ROWS, 'top', NOW), { total: 5, needs: 1, working: 1, recent: 2, idle: 1, dot: 'awaiting' });
  assert.deepEqual(rollupOf(ROWS, 'a', NOW), { total: 3, needs: 1, working: 1, recent: 0, idle: 1, dot: 'awaiting' });
  assert.deepEqual(rollupOf(ROWS, 'a2', NOW), { total: 1, needs: 0, working: 0, recent: 0, idle: 1, dot: null });
  assert.deepEqual(rollupOf(ROWS, 'b', NOW), { total: 0, needs: 0, working: 0, recent: 0, idle: 0, dot: null });
  assert.deepEqual(rollupOf(ROWS, 'nobody', NOW), { total: 0, needs: 0, working: 0, recent: 0, idle: 0, dot: null });
});

test('a session needs you when its state is waiting or its mark is awaiting, so a question asked in Desktop counts', () => {
  const asked = [row('p', null, 'idle', MINUTE), row('q', 'p', 'idle', MINUTE, { dot: 'awaiting' }), row('w', 'p', 'waiting', MINUTE, { dot: 'awaiting' }), row('r', 'p', 'idle', MINUTE, { dot: 'ready' })];
  assert.deepEqual(rollupOf(asked, 'p', NOW), { total: 3, needs: 2, working: 0, recent: 1, idle: 0, dot: 'awaiting' });
  assert.equal(rollupLine(rollupOf(asked, 'p', NOW)), '3 sub sessions, 2 waiting on you');
  assert.deepEqual(shape(treeOf(asked, 'p', NOW)), ['q', 'w', 'r'], 'both come before the one that is only unread');
  assert.equal(rollupOf([...asked.slice(0, 2), row('gone', 'p', 'idle', MINUTE, { dot: 'awaiting', archived: true })], 'p', NOW).needs, 1, 'an archived one needs nothing');
});

test('a list of sessions adds up as the sessions below one do, and a roll-up line can count them as sessions', () => {
  const some = [row('a', null, 'waiting', MINUTE), row('b', null, 'working', MINUTE), row('c', 'b', 'idle', 3 * RECENT_MS), row('d', null, 'idle', MINUTE, { archived: true })];
  assert.deepEqual(tally(some, NOW), { total: 3, needs: 1, working: 1, recent: 0, idle: 1, dot: 'awaiting' });
  assert.deepEqual(tally([], NOW), { total: 0, needs: 0, working: 0, recent: 0, idle: 0, dot: null });
  assert.equal(rollupLine(tally(some, NOW), 'session'), '3 sessions, 1 waiting on you, 1 working');
  assert.equal(rollupLine(tally(some.slice(2, 3), NOW), 'session'), '1 session');
  assert.equal(rollupLine(tally(some.slice(2, 3), NOW)), '1 sub session');
  assert.equal(rollupLine(tally([], NOW), 'session'), '');
});

test('the roll-up takes its mark from the most urgent session wherever it sits, from the state when the row has no mark, and leaves out archived sessions', () => {
  const deep = [row('p', null, 'idle', MINUTE), row('c', 'p', 'idle', MINUTE, { dot: 'ready' }), row('g', 'c', 'idle', MINUTE, { dot: 'error' }), row('h', 'g', 'idle', MINUTE, { dot: 'running' })];
  assert.equal(rollupOf(deep, 'p', NOW).dot, 'error');
  assert.equal(rollupOf(deep.slice(0, 2), 'p', NOW).dot, 'ready');
  const bare = [row('p', null, 'idle', MINUTE), row('c', 'p', 'waiting', MINUTE, { dot: undefined })];
  assert.equal(rollupOf(bare, 'p', NOW).dot, 'awaiting');
  const withArchived = [row('p', null, 'idle', MINUTE), row('c', 'p', 'idle', MINUTE), row('old', 'c', 'waiting', MINUTE, { archived: true }), row('live', 'old', 'working', MINUTE)];
  assert.deepEqual(rollupOf(withArchived, 'p', NOW), { total: 2, needs: 0, working: 1, recent: 1, idle: 0, dot: 'running' }, 'the archived one is passed through and not counted');
});

test('the roll-up line says how many, then those waiting on you, then those working, and nothing for none', () => {
  const line = (total, needs = 0, working = 0) => rollupLine({ total, needs, working, recent: 0, idle: 0, dot: null });
  assert.equal(line(0), '');
  assert.equal(line(1), '1 sub session');
  assert.equal(line(3), '3 sub sessions');
  assert.equal(line(3, 1), '3 sub sessions, 1 waiting on you');
  assert.equal(line(3, 2, 1), '3 sub sessions, 2 waiting on you, 1 working');
  assert.equal(line(4, 0, 4), '4 sub sessions, 4 working');
  assert.equal(rollupLine(rollupOf(ROWS, 'top', NOW)), '5 sub sessions, 1 waiting on you, 1 working');
  assert.equal(rollupLine(rollupOf(ROWS, 'b', NOW)), '');
  for (const text of [line(1), line(3, 2, 1), line(12, 12, 12)]) assert.doesNotMatch(text, /[-\u2013\u2014]/, 'no hyphen, en dash or em dash');
});

test('a folded family shows the most urgent mark among its head and the sessions nested under it', () => {
  const head = (dot, kids) => ({ ...row('h', null, 'idle', MINUTE, { dot }), ...(kids && { children: kids }) });
  assert.equal(familyDot(head(null)), null);
  assert.equal(familyDot(head('ready')), 'ready');
  assert.equal(familyDot(head(null, [row('k1', 'h', 'idle', 1, { dot: 'running' })])), 'running');
  assert.equal(familyDot(head('running', [row('k1', 'h', 'idle', 1, { dot: 'ready' }), row('k2', 'k1', 'idle', 1, { dot: 'awaiting' })])), 'awaiting');
  assert.equal(familyDot(head('error', [row('k1', 'h', 'idle', 1, { dot: 'running' })])), 'error');
  assert.equal(familyDot(head('awaiting', [row('k1', 'h', 'idle', 1, { dot: 'ready' })])), 'awaiting');
  assert.equal(familyDot(head(null, [row('k1', 'h', 'working', 1, { dot: undefined })])), 'running', 'a child with no mark yet ranks by its state');
});

test('the rows of an index list flatten with their nested sessions, and the roll-up reads them as a flat list', () => {
  const top = { ...ROWS[0], children: [ROWS[1], ROWS[2], ROWS[3], ROWS[4], ROWS[5]] };
  const flat = withKids([top]);
  assert.equal(flat.length, 6);
  assert.deepEqual(rollupOf(flat, 'top', NOW), rollupOf(ROWS, 'top', NOW));
  assert.deepEqual(shape(treeOf(flat, 'top', NOW)), shape(treeOf(ROWS, 'top', NOW)));
});
