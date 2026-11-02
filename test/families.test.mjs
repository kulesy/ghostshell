// Run with `npm test`. Which sessions show under which: the walk up a session's links, and what an archived, missing or routine session
// on the way changes. Each result is [holder, parent] by session id, and `near`, the nearest session a row shows under, is checked beside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainOf, familiesOf } from '../lib/families.mjs';

// `links` maps a session to the one it links to. The rows are the sessions that appear in it unless `ids` lists them.
const rowsOf = (links, { ids = [...new Set(Object.entries(links).flat())], archived = [], routines = [] } = {}) =>
  new Map(ids.map(id => [id, { id, archived: archived.includes(id), routine: routines.includes(id) ? 'Daily' : null }]));

const familiesIn = (links, { seeArchived = false, ...rest } = {}) => familiesOf(rowsOf(links, rest), id => links[id] ?? null, { archived: seeArchived });

function walk(links, options) {
  return Object.fromEntries([...familiesIn(links, options)].map(([id, { holder, parent }]) => [id, [holder, parent]]));
}

// The nearest session each row shows under, by session id.
const nearest = (links, options) => Object.fromEntries([...familiesIn(links, options)].map(([id, { near }]) => [id, near]));

// The session each row nests under, by session id.
const nests = (links, options) => Object.fromEntries([...familiesIn(links, options)].map(([id, { via }]) => [id, via]));

// The ids of the sessions a session's links lead through, nearest first.
const chain = (links, from, options) => {
  const rows = rowsOf(links, options);
  return chainOf(rows, id => links[id] ?? null, rows.get(from)).map(r => r.id);
};

test('a session with no link is its own holder with no parent, and a session that links to it shows under it', () => {
  assert.deepEqual(walk({ b: 'a' }), { a: ['a', null], b: ['a', 'a'] });
  assert.deepEqual(walk({}, { ids: ['a'] }), { a: ['a', null] });
});

test('a chain of links shows every member under the topmost session, one level deep, whatever order the rows come in', () => {
  const links = { d: 'c', c: 'b', b: 'a' };
  const expected = { a: ['a', null], b: ['a', 'a'], c: ['a', 'a'], d: ['a', 'a'] };
  assert.deepEqual(walk(links, { ids: ['a', 'b', 'c', 'd'] }), expected);
  assert.deepEqual(walk(links, { ids: ['d', 'c', 'b', 'a'] }), expected);
});

test('several sessions under one parent, and two families side by side, stay apart', () => {
  assert.deepEqual(walk({ b: 'a', c: 'a', y: 'x' }), { a: ['a', null], b: ['a', 'a'], c: ['a', 'a'], x: ['x', null], y: ['x', 'x'] });
});

test('near is the nearest session a session\'s links lead through, and the parent is the topmost of them', () => {
  assert.deepEqual(nearest({ b: 'a' }), { a: null, b: 'a' });
  assert.deepEqual(nearest({ d: 'c', c: 'b', b: 'a' }), { a: null, b: 'a', c: 'b', d: 'c' });
  assert.deepEqual(walk({ d: 'c', c: 'b', b: 'a' }), { a: ['a', null], b: ['a', 'a'], c: ['a', 'a'], d: ['a', 'a'] });
  assert.deepEqual(nearest({ b: 'a', c: 'a', y: 'x' }), { a: null, b: 'a', c: 'a', x: null, y: 'x' });
});

test('an archived session on the way is skipped as the near of a session, unless the archive is listed', () => {
  const links = { d: 'c', c: 'b', b: 'a' };
  assert.deepEqual(nearest(links, { archived: ['c'] }), { a: null, b: 'a', c: 'b', d: 'b' }, 'an archived middle: its child has the next one up as its near');
  assert.deepEqual(nearest(links, { archived: ['b', 'c'] }), { a: null, b: 'a', c: 'a', d: 'a' }, 'two archived in a row');
  assert.deepEqual(nearest(links, { archived: ['a'] }), { a: null, b: null, c: 'b', d: 'c' }, 'an archived top: its child is top level');
  assert.deepEqual(nearest(links, { archived: ['a', 'b', 'c'] }), { a: null, b: null, c: null, d: null }, 'all archived');
  assert.deepEqual(nearest(links, { archived: ['b', 'c'], seeArchived: true }), { a: null, b: 'a', c: 'b', d: 'c' }, 'the archive lists them');
});

test('a session whose links run into a cycle has the first session of it that the chain reaches as its near, and one in the cycle has none', () => {
  assert.deepEqual(nearest({ a: 'b', b: 'a' }), { a: null, b: null });
  assert.deepEqual(nearest({ a: 'a' }), { a: null });
  assert.deepEqual(nearest({ c: 'a', a: 'b', b: 'a' }), { a: null, b: null, c: 'a' });
  assert.deepEqual(nearest({ d: 'c', c: 'a', a: 'b', b: 'a' }), { a: null, b: null, c: 'a', d: 'c' });
});

test('via is the head the list shows, not the nearest session, so a chain of links nests every member one level deep', () => {
  const chainOfThree = { kid: 'boss', boss: 'peer' };
  const found = familiesIn(chainOfThree);
  assert.deepEqual(found.get('kid'), { holder: 'peer', parent: 'peer', via: 'peer', near: 'boss' });
  assert.deepEqual(found.get('boss'), { holder: 'peer', parent: 'peer', via: 'peer', near: 'peer' });
  assert.deepEqual(found.get('peer'), { holder: 'peer', parent: null, via: null, near: null });
  assert.deepEqual(nests(chainOfThree, { archived: ['peer'] }), { peer: null, boss: null, kid: 'boss' }, 'an archived top: the middle is top level and the kid nests under it');
  assert.deepEqual(nests(chainOfThree, { archived: ['peer'], seeArchived: true }), { peer: null, boss: 'peer', kid: 'boss' }, 'the archive lists the top above the middle, which the list shows as the head');
});

test('a link to a routine run or to a session that is not listed gives no session to nest under', () => {
  assert.deepEqual(nearest({ x: 'r' }, { routines: ['r'] }), { r: null, x: null });
  assert.deepEqual(nearest({ x: 'y', y: 'r' }, { routines: ['r'] }), { r: null, y: null, x: 'y' });
  assert.deepEqual(nearest({ x: 'gone' }, { ids: ['x'] }), { x: null });
});

test('an archived session on the way is skipped as a parent, and the sessions under it move up to the topmost one that is not archived', () => {
  const links = { c: 'b', b: 'a' };
  assert.deepEqual(walk(links, { archived: ['b'] }), { a: ['a', null], b: ['a', 'a'], c: ['a', 'a'] }, 'an archived middle');
  assert.deepEqual(walk(links, { archived: ['a'] }), { a: ['a', null], b: ['a', null], c: ['a', 'b'] }, 'an archived top: its child is top level and holds the next');
  assert.deepEqual(walk(links, { archived: ['a', 'b'] }), { a: ['a', null], b: ['a', null], c: ['a', null] }, 'all archived');
});

test('the holder stays the topmost session even when it is archived, so a family keeps the place of the session that anchors it', () => {
  assert.deepEqual(walk({ b: 'a' }, { archived: ['a'] }), { a: ['a', null], b: ['a', null] });
});

test('the archive lists archived sessions too, so an archived parent counts there', () => {
  const links = { c: 'b', b: 'a' };
  assert.deepEqual(walk(links, { archived: ['a', 'b'], seeArchived: true }), { a: ['a', null], b: ['a', 'a'], c: ['a', 'a'] });
  assert.deepEqual(walk(links, { archived: ['a'] }), { a: ['a', null], b: ['a', null], c: ['a', 'b'] }, 'the list does not');
});

test('a session whose links lead back to itself has no ancestors, and a chain that runs into a cycle shows under the first session of it that the chain reaches', () => {
  assert.deepEqual(walk({ a: 'b', b: 'a' }), { a: ['a', null], b: ['b', null] });
  assert.deepEqual(walk({ a: 'a' }), { a: ['a', null] });
  assert.deepEqual(walk({ c: 'a', a: 'b', b: 'a' }), { a: ['a', null], b: ['b', null], c: ['a', 'a'] });
  assert.deepEqual(walk({ d: 'c', c: 'a', a: 'b', b: 'a' }), { a: ['a', null], b: ['b', null], c: ['a', 'a'], d: ['a', 'a'] });
});

test('an archived session in a cycle the chain runs into does not give the family the place of the far side of the cycle', () => {
  assert.deepEqual(walk({ r: 'a1', a1: 'a2', a2: 'a1' }, { archived: ['a2'] }), { r: ['a1', 'a1'], a1: ['a1', null], a2: ['a2', null] });
  assert.deepEqual(walk({ r: 'a1', a1: 'a2', a2: 'a3', a3: 'a1' }, { archived: ['a3'] }), { r: ['a1', 'a1'], a1: ['a1', null], a2: ['a2', null], a3: ['a3', null] });
  assert.deepEqual(walk({ r: 'a1', a1: 'a2', a2: 'a1' }, { archived: ['a1'] }), { r: ['a1', null], a1: ['a1', null], a2: ['a2', null] }, 'the first session of the cycle is archived, so the family has no parent');
});

// Every way four sessions can link, with any of them archived, to see that whatever the links, a child has the holder of its parent,
// and its parent has no parent. A family is then one level deep and sits in one place.
test('whatever the links, a child has the same holder as its parent, a holder is its own holder, and no parent has a parent', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const choices = [null, ...ids];
  let checked = 0;
  for (const targets of choices.flatMap(a => choices.flatMap(b => choices.flatMap(c => choices.map(d => [a, b, c, d]))))) {
    const links = Object.fromEntries(ids.map((id, i) => [id, targets[i]]));
    for (let mask = 0; mask < 16; mask++) {
      const archived = ids.filter((_, i) => mask & (1 << i));
      for (const seeArchived of [false, true]) {
        const found = walk(links, { ids, archived, seeArchived });
        const vias = nearest(links, { ids, archived, seeArchived });
        const flat = nests(links, { ids, archived, seeArchived });
        const where = JSON.stringify({ links, archived, seeArchived });
        for (const [id, [holder, parent]] of Object.entries(found)) {
          assert.equal(found[holder][0], holder, `holder of ${id}: ${where}`);
          if (seeArchived && flat[id] !== parent) {
            assert.ok(archived.includes(parent) && !archived.includes(flat[id]) && flat[flat[id]] === parent, `${id} nests under the head the list shows, below its archived parent: ${where}`);
          } else assert.equal(flat[id], parent, `${id} nests under its parent, whatever its nearest is: ${where}`);
          assert.equal(vias[id] === null, parent === null, `${id} nests under a session exactly when it has a parent: ${where}`);
          if (!parent) continue;
          assert.equal(found[parent][0], holder, `${id} and its parent ${parent} are in one place: ${where}`);
          assert.equal(found[parent][1], null, `${parent} is top level: ${where}`);
          assert.ok(vias[id] === parent || found[vias[id]][1] === parent, `${id} nests under ${vias[id]}, which is in the family of ${parent}: ${where}`);
        }
        checked++;
      }
    }
  }
  assert.equal(checked, 5 ** 4 * 16 * 2);
});

test('the chain of a session is every session its links lead through, archived ones too, nearest first', () => {
  assert.deepEqual(chain({ c: 'b', b: 'a' }, 'c'), ['b', 'a']);
  assert.deepEqual(chain({ c: 'b', b: 'a' }, 'c', { archived: ['a', 'b'] }), ['b', 'a']);
  assert.deepEqual(chain({ c: 'b', b: 'a' }, 'a'), []);
  assert.deepEqual(chain({ c: 'b', b: 'a' }, 'b'), ['a']);
});

test('a chain ends at a routine run, a link to a session that is not in the listing and a link back to a session it has met, and holds each session once', () => {
  assert.deepEqual(chain({ x: 'y', y: 'r', r: 'z' }, 'x', { routines: ['r'] }), ['y']);
  assert.deepEqual(chain({ x: 'y', y: 'gone' }, 'x', { ids: ['x', 'y'] }), ['y']);
  assert.deepEqual(chain({ r: 'a1', a1: 'a2', a2: 'a1' }, 'r'), ['a1', 'a2'], 'every session of the cycle it reaches');
  assert.deepEqual(chain({ a1: 'a2', a2: 'a1' }, 'a1'), ['a2'], 'not the session itself');
  assert.deepEqual(chain({ a: 'a' }, 'a'), []);
});

test('a routine run never holds children, so a link to one is ignored and a chain stops at it', () => {
  assert.deepEqual(walk({ x: 'r' }, { routines: ['r'] }), { r: ['r', null], x: ['x', null] });
  assert.deepEqual(walk({ x: 'y', y: 'r' }, { routines: ['r'] }), { r: ['r', null], y: ['y', null], x: ['y', 'y'] });
});

test('a link to a session that is not in the listing is ignored, and a chain stops at it', () => {
  assert.deepEqual(walk({ x: 'gone' }, { ids: ['x'] }), { x: ['x', null] });
  assert.deepEqual(walk({ x: 'y', y: 'gone' }, { ids: ['x', 'y'] }), { x: ['y', 'y'], y: ['y', null] });
});

test('every parent is top level, so the holder of a holder is itself and no parent has a parent', () => {
  const links = { b: 'a', c: 'b', d: 'c', f: 'e', e: 'd' };
  for (const archived of [[], ['a'], ['b'], ['c'], ['a', 'c'], ['b', 'd']]) {
    const found = walk(links, { archived });
    for (const [holder, parent] of Object.values(found)) {
      assert.deepEqual(found[holder][0], holder, `${archived}: holder of ${holder}`);
      if (parent) assert.equal(found[parent][1], null, `${archived}: ${parent} is top level`);
    }
  }
});
