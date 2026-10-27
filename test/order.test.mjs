// Run with `npm test`. The order a list puts its sessions in, which the server and the page share: Desktop's three sorts both ways, a
// family placed in its list, and a family's children in depth-first order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { comparator, DEFAULT_SORT, TITLE_SORT, sortFamily, sortRows, UNTITLED } from '../public/ui/order.js';

const row = (id, sortAt, extra = {}) => ({ id, title: id, sortAt, ...extra });
const ids = rows => rows.map(r => r.id);
const sorted = (rows, sort) => ids([...rows].sort(comparator(sort)));
const recency = ascending => ({ by: 'recency', ascending });
const created = ascending => ({ by: 'created', ascending });
const alpha = ascending => ({ by: 'alpha', ascending });

test('a list with no sort of its own goes newest first', () => {
  assert.deepEqual(DEFAULT_SORT, { by: 'recency', ascending: false });
  const rows = [row('old', 1), row('new', 3), row('mid', 2)];
  assert.deepEqual(sorted(rows), ['new', 'mid', 'old']);
  assert.deepEqual(ids(sortRows(rows)), ['new', 'mid', 'old']);
});

test('recency goes newest first, and ascending turns it around', () => {
  const rows = [row('old', 1), row('new', 3), row('mid', 2)];
  assert.deepEqual(sorted(rows, recency(false)), ['new', 'mid', 'old']);
  assert.deepEqual(sorted(rows, recency(true)), ['old', 'mid', 'new']);
});

test('a sort that is none of recency, created and alpha goes by recency, in the direction it asks for', () => {
  const rows = [row('old', 1), row('new', 3), row('mid', 2)];
  assert.deepEqual(sorted(rows, { by: 'size', ascending: false }), ['new', 'mid', 'old']);
  assert.deepEqual(sorted(rows, { by: 'size', ascending: true }), ['old', 'mid', 'new']);
  assert.deepEqual(sorted(rows, {}), ['new', 'mid', 'old']);
});

test('created goes by when a session was made, newest first, and ascending turns it around', () => {
  const rows = [row('a', 90, { createdAt: 10 }), row('b', 50, { createdAt: 40 }), row('c', 70, { createdAt: 25 })];
  assert.deepEqual(sorted(rows, created(false)), ['b', 'c', 'a']);
  assert.deepEqual(sorted(rows, created(true)), ['a', 'c', 'b']);
});

test('a created time that is missing, zero, not a number or later than the last turn falls back to the last turn', () => {
  const rows = [
    row('none', 30),
    row('zero', 20, { createdAt: 0 }),
    row('nan', 10, { createdAt: Number.NaN }),
    row('later', 5, { createdAt: 900 }),
    row('text', 4, { createdAt: '1' }),
    row('real', 100, { createdAt: 25 }),
  ];
  assert.deepEqual(sorted(rows, created(false)), ['none', 'real', 'zero', 'nan', 'later', 'text']);
  assert.deepEqual(sorted(rows, created(true)), ['text', 'later', 'nan', 'zero', 'real', 'none']);
});

test('alpha goes A to Z by title, and ascending turns it around', () => {
  const rows = [row('1', 1, { title: 'Mango' }), row('2', 2, { title: 'apple' }), row('3', 3, { title: 'Zebra' }), row('4', 4, { title: 'banana' })];
  assert.deepEqual(sorted(rows, alpha(false)), ['2', '4', '1', '3']);
  assert.deepEqual(sorted(rows, alpha(true)), ['3', '1', '4', '2']);
});

test('the group sort is A to Z by title, with the rows that have no title last', () => {
  assert.deepEqual(TITLE_SORT, { by: 'alpha', ascending: false });
  const rows = [row('1', 1, { title: 'Mango' }), row('2', 2, { title: UNTITLED }), row('3', 3, { title: 'apple' }), row('4', 4, { title: '' }), row('5', 5, { title: 'Zebra' })];
  assert.deepEqual(sorted(rows, TITLE_SORT), ['3', '1', '5', '2', '4']);
});

test('alpha compares titles as localeCompare does, so numbers run as text', () => {
  const rows = [row('two', 1, { title: '2 items' }), row('ten', 2, { title: '10 items' }), row('alpha', 3, { title: 'Alpha' })];
  assert.deepEqual(sorted(rows, alpha(false)), ['ten', 'two', 'alpha']);
});

test('a session with no title of its own goes last under alpha, in both directions, and the Untitled session it is shown as counts as none', () => {
  const rows = [row('blank', 1, { title: '' }), row('b', 2, { title: 'Bravo' }), row('shown', 3, { title: UNTITLED }), row('a', 4, { title: 'Alpha' }), row('none', 5, { title: undefined })];
  assert.deepEqual(sorted(rows, alpha(false)), ['a', 'b', 'blank', 'none', 'shown']);
  assert.deepEqual(sorted(rows, alpha(true)), ['b', 'a', 'blank', 'none', 'shown']);
});

test('a title that merely starts with Untitled is a title', () => {
  const rows = [row('x', 1, { title: 'Untitled notes' }), row('y', 2, { title: 'Zed' }), row('z', 3, { title: UNTITLED })];
  assert.deepEqual(sorted(rows, alpha(false)), ['x', 'y', 'z']);
});

test('rows that sort the same go by id, so the same rows come out in the same order whatever order they came in', () => {
  const rows = [row('c', 5), row('a', 5), row('b', 5)];
  for (const sort of [recency(false), recency(true), created(false), created(true)]) {
    assert.deepEqual(sorted(rows, sort), ['a', 'b', 'c'], JSON.stringify(sort));
    assert.deepEqual(sorted([...rows].reverse(), sort), ['a', 'b', 'c'], `${JSON.stringify(sort)} reversed`);
  }
  const same = [row('2', 1, { title: 'Notes' }), row('1', 2, { title: 'Notes' }), row('3', 3, { title: 'Notes' })];
  assert.deepEqual(sorted(same, alpha(false)), ['1', '2', '3']);
  assert.deepEqual(sorted(same, alpha(true)), ['1', '2', '3']);
  const none = [row('b', 1, { title: '' }), row('a', 2, { title: '' })];
  assert.deepEqual(sorted(none, alpha(false)), ['a', 'b']);
});

test('sorting leaves the list it was given as it was', () => {
  const rows = [row('b', 1), row('a', 2)];
  const copy = JSON.stringify(rows);
  sortRows(rows, recency(true));
  assert.equal(JSON.stringify(rows), copy);
});

test('under recency a family sits where its best member does, so a busy child is not lost under an old parent', () => {
  const rows = [
    row('lone', 50),
    row('head', 10, { children: [row('quiet', 5), row('busy', 80)] }),
    row('other', 60),
  ];
  assert.deepEqual(ids(sortRows(rows, recency(false))), ['head', 'other', 'lone']);
});

test('under ascending recency the best member is the one that sorts first, which is the oldest', () => {
  const rows = [
    row('lone', 20),
    row('head', 90, { children: [row('old', 5)] }),
    row('other', 10),
  ];
  assert.deepEqual(ids(sortRows(rows, recency(true))), ['head', 'other', 'lone']);
});

test('under alpha and created a family sits where its head does, whatever its children are', () => {
  const rows = [
    row('lone', 50, { title: 'Mid', createdAt: 30 }),
    row('head', 10, { title: 'Zulu', createdAt: 5, children: [row('kid', 90, { title: 'Alpha', createdAt: 80 })] }),
    row('other', 60, { title: 'Bravo', createdAt: 55 }),
  ];
  assert.deepEqual(ids(sortRows(rows, alpha(false))), ['other', 'lone', 'head']);
  assert.deepEqual(ids(sortRows(rows, alpha(true))), ['head', 'lone', 'other']);
  assert.deepEqual(ids(sortRows(rows, created(false))), ['other', 'lone', 'head']);
  assert.deepEqual(ids(sortRows(rows, created(true))), ['head', 'lone', 'other']);
});

test('placing a family does not reorder its children', () => {
  const kids = [row('x', 3), row('y', 9)];
  const [placed] = sortRows([row('head', 1, { children: kids })], recency(false));
  assert.deepEqual(ids(placed.children), ['x', 'y']);
});

// A family is a head with children. A child's `via` names the session it nests under, and one with none nests under the head.
const head = row('H', 100);

test('a family goes depth first: each child of the head in the list\'s order, then at once the children that nest under it', () => {
  const kids = [
    row('a', 50),
    row('b', 40),
    row('a1', 30, { via: 'a' }),
    row('a2', 45, { via: 'a' }),
    row('b1', 60, { via: 'b' }),
    row('a2x', 10, { via: 'a2' }),
  ];
  assert.deepEqual(ids(sortFamily(head, kids, recency(false))), ['a', 'a2', 'a2x', 'a1', 'b', 'b1']);
  assert.deepEqual(ids(sortFamily(head, kids, recency(true))), ['b', 'b1', 'a', 'a1', 'a2', 'a2x']);
});

test('the siblings of each level go by the list\'s own sort, alpha included', () => {
  const kids = [
    row('k1', 1, { title: 'Delta' }),
    row('k2', 2, { title: 'Alpha' }),
    row('k3', 3, { title: 'Charlie', via: 'k1' }),
    row('k4', 4, { title: 'Bravo', via: 'k1' }),
  ];
  assert.deepEqual(ids(sortFamily(head, kids, alpha(false))), ['k2', 'k1', 'k4', 'k3']);
  assert.deepEqual(ids(sortFamily(head, kids, alpha(true))), ['k1', 'k3', 'k4', 'k2']);
});

test('a child with no via nests under the head, and the order of the rows given does not matter', () => {
  const kids = [row('b', 20, { via: 'a' }), row('a', 30), row('c', 10)];
  const want = ['a', 'b', 'c'];
  assert.deepEqual(ids(sortFamily(head, kids, recency(false))), want);
  assert.deepEqual(ids(sortFamily(head, [...kids].reverse(), recency(false))), want);
  assert.deepEqual(ids(sortFamily(head, kids.map(c => ({ ...c, via: c.via ?? 'H' })), recency(false))), want, 'a via naming the head is the same');
});

test('a child whose via names no session in the family follows the rest, in the list\'s order, and none is lost', () => {
  const kids = [row('a', 50), row('lost1', 20, { via: 'gone' }), row('a1', 10, { via: 'a' }), row('lost2', 70, { via: 'gone' })];
  assert.deepEqual(ids(sortFamily(head, kids, recency(false))), ['a', 'a1', 'lost2', 'lost1']);
});

test('links that lead back to each other cannot loop, and the sessions in them follow the rest', () => {
  const kids = [row('a', 50, { via: 'b' }), row('b', 40, { via: 'a' }), row('c', 60)];
  assert.deepEqual(ids(sortFamily(head, kids, recency(false))), ['c', 'a', 'b']);
});

test('the walk stops 32 levels down, and the sessions below follow the rest in the list\'s order', () => {
  const chain = Array.from({ length: 40 }, (_, i) => row(`c${i + 1}`, 1000 + i, { via: i ? `c${i}` : undefined }));
  const out = ids(sortFamily(head, chain, recency(false)));
  assert.deepEqual(out.slice(0, 32), chain.slice(0, 32).map(r => r.id), 'the first 32 levels run down the chain');
  assert.deepEqual(out.slice(32), chain.slice(32).map(r => r.id).reverse(), 'the rest are newest first');
  assert.equal(new Set(out).size, 40);
});

test('a family of one level, or with no children, comes back as it is sorted', () => {
  assert.deepEqual(sortFamily(head, [], recency(false)), []);
  assert.deepEqual(ids(sortFamily(head, [row('a', 1), row('b', 2)])), ['b', 'a']);
});
