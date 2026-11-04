// Run with `npm test`. The order the session list comes in: the time each row sorts by, the sort Desktop holds for each of its lists, how a
// family is placed and walked, and where a list is cut. Over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { everyRow } from '../public/ui/tree.js';
import { as, request, signIn, start } from './harness.mjs';

const GROUPS = [{ id: 'cg-a', name: 'Alpha' }, { id: 'cg-b', name: 'Bravo' }];
const RECENT = { by: 'recency', ascending: false };
const section = (id, kind, sortBy, ascending = false) => ({ id, kind, sortBy, ascending });

const titles = list => list.map(r => r.title);
// A list as titles, each session with its children after it in brackets.
const shape = list => list.map(r => (r.children ? `${r.title} [${titles(r.children).join(', ')}]` : r.title));
const index = async (s, token, query = '') => (await request(s, 'GET', `/api/sessions${query}`, { headers: as(token) })).body();
const rowOf = (ix, id) => everyRow(ix).find(r => r.id === id);
// How many minutes before now a time was, to the minute.
const minutesSince = time => Math.round((Date.now() - time) / 60_000);

async function ready(mac) {
  const s = await start(mac);
  return { s, ...(await signIn(s)) };
}

test('a Desktop row sorts by its last turn, else its last activity, else when it was made, and not by when its transcript was written', async () => {
  const { s, token } = await ready({
    sessions: [
      { id: 'edge', title: 'Edge', ago: 600, edgeAgo: 30, fileAgo: 1 },
      { id: 'activity', title: 'Activity', ago: 10, fileAgo: 0.5 },
      { id: 'made', title: 'Made', createdAgo: 45, fields: { lastActivityAt: undefined }, fileAgo: 0.2 },
    ],
  });
  const ix = await index(s, token);
  assert.deepEqual(titles(ix.ungrouped), ['Activity', 'Edge', 'Made']);
  assert.deepEqual(['edge', 'activity', 'made'].map(id => minutesSince(rowOf(ix, id).sortAt)), [30, 10, 45]);
  assert.equal(minutesSince(rowOf(ix, 'made').createdAt), 45, 'and the row says when it was made');
});

test('a turn Capcom ran lifts a row when it is later than the row\'s own time, for a Desktop row and a terminal row, and an older one lowers nothing', async () => {
  const { s, token } = await ready({
    sessions: [
      { id: 'old', title: 'Old', ago: 120 },
      { id: 'new', title: 'New', ago: 20 },
      { id: 'stays', title: 'Stays', ago: 5 },
      { id: 'term', title: 'Terminal', source: 'cli', ago: 50 },
      { id: 'quiet', title: 'Quiet terminal', source: 'cli', ago: 40 },
    ],
    marks: { edges: { old: 10, stays: 100, term: 3 } },
  });
  const ix = await index(s, token);
  assert.deepEqual(titles(ix.ungrouped), ['Stays', 'Old', 'New']);
  assert.deepEqual(titles(ix.other), ['Terminal', 'Quiet terminal']);
  assert.deepEqual(['old', 'stays', 'term'].map(id => minutesSince(rowOf(ix, id).sortAt)), [10, 5, 3]);
});

test('each list goes by the sort of the Desktop section it comes from, and the index says what it is', async () => {
  const { s, token } = await ready({
    groups: GROUPS,
    sections: [
      section('pinned', 'pinned', 'alpha', true),
      section('cg-a', 'manual', 'alpha', false),
      section('cg-b', 'manual', 'created', false),
      section('routines', 'routines', 'recency', true),
      section('loose', 'sessions', 'recency', true),
    ],
    sessions: [
      { id: 'p1', title: 'Pin b', pinned: true, ago: 1 },
      { id: 'p2', title: 'Pin a', pinned: true, ago: 2 },
      { id: 'p3', title: 'Pin c', pinned: true, ago: 3 },
      { id: 'a1', title: 'Mango', group: 'cg-a', ago: 1 },
      { id: 'a2', title: 'apple', group: 'cg-a', ago: 2 },
      { id: 'a3', title: 'Zebra', group: 'cg-a', ago: 3 },
      { id: 'a4', title: 'banana', group: 'cg-a', ago: 4 },
      { id: 'b1', title: 'Born first', group: 'cg-b', createdAgo: 300, ago: 1 },
      { id: 'b2', title: 'Born middle', group: 'cg-b', createdAgo: 100, ago: 10 },
      { id: 'b3', title: 'Born last', group: 'cg-b', createdAgo: 60, ago: 50 },
      { id: 'n1', title: 'Nightly latest', routine: 'nightly', ago: 5 },
      { id: 'n2', title: 'Nightly second', routine: 'nightly', ago: 65 },
      { id: 'n3', title: 'Nightly third', routine: 'nightly', ago: 125 },
      { id: 'w1', title: 'Weekly only', routine: 'weekly', ago: 30 },
      { id: 'm1', title: 'Monthly only', routine: 'monthly', ago: 90 },
      { id: 'l1', title: 'Loose 1', ago: 8 },
      { id: 'l2', title: 'Loose 2', ago: 18 },
      { id: 'l3', title: 'Loose 3', ago: 28 },
      { id: 'c1', title: 'Started a', source: 'capcom', ago: 4 },
      { id: 'c2', title: 'Started b', source: 'capcom', ago: 14 },
      { id: 't1', title: 'Term a', source: 'cli', ago: 6 },
      { id: 't2', title: 'Term b', source: 'cli', ago: 16 },
    ],
  });
  const ix = await index(s, token);
  assert.deepEqual(titles(ix.pinned), ['Pin c', 'Pin b', 'Pin a'], 'alpha ascending');
  assert.deepEqual(titles(ix.groups[0].sessions), ['apple', 'banana', 'Mango', 'Zebra'], 'alpha');
  assert.deepEqual(titles(ix.groups[1].sessions), ['Born last', 'Born middle', 'Born first'], 'created, newest made first');
  assert.deepEqual(ix.routines.map(r => r.name), ['monthly', 'weekly', 'nightly'], 'by each routine\'s latest run, oldest first');
  assert.deepEqual(titles(ix.routines[2].earlier), ['Nightly second', 'Nightly third'], 'the runs of a routine go newest first');
  assert.deepEqual(titles(ix.ungrouped), ['Loose 3', 'Loose 2', 'Loose 1'], 'recency ascending');
  assert.deepEqual(titles(ix.started), ['Started b', 'Started a'], 'Started here goes by the loose list\'s sort');
  assert.deepEqual(titles(ix.other), ['Term b', 'Term a'], 'and so does Terminal and other');
  assert.deepEqual(ix.sorts, { pinned: { by: 'alpha', ascending: true }, routines: { by: 'recency', ascending: true }, sessions: { by: 'recency', ascending: true } });
  assert.deepEqual(ix.groups.map(g => [g.id, g.sort]), [['cg-a', { by: 'alpha', ascending: false }], ['cg-b', { by: 'created', ascending: false }]]);
});

test('with no section sorts Desktop holds, every list goes newest first, and so does a group Desktop holds none for', async () => {
  const mac = {
    groups: GROUPS,
    sessions: [
      { id: 'g1', title: 'Zulu', group: 'cg-a', ago: 1 },
      { id: 'g2', title: 'Alpha', group: 'cg-a', ago: 2 },
      { id: 'h1', title: 'Yankee', group: 'cg-b', ago: 3 },
      { id: 'h2', title: 'Bravo', group: 'cg-b', ago: 4 },
    ],
  };
  const none = await ready(mac);
  const plain = await index(none.s, none.token);
  assert.deepEqual(plain.sorts, { pinned: RECENT, routines: RECENT, sessions: RECENT });
  assert.deepEqual(plain.groups.map(g => g.sort), [RECENT, RECENT]);
  assert.deepEqual(plain.groups.map(g => titles(g.sessions)), [['Zulu', 'Alpha'], ['Yankee', 'Bravo']]);

  const some = await ready({ ...mac, sections: [section('cg-a', 'manual', 'alpha', false)] });
  const mixed = await index(some.s, some.token);
  assert.deepEqual(mixed.groups.map(g => titles(g.sessions)), [['Alpha', 'Zulu'], ['Yankee', 'Bravo']], 'only the group with a section goes by title');
  assert.deepEqual(mixed.sorts, { pinned: RECENT, routines: RECENT, sessions: RECENT });
});

test('the sections of the scope that holds the groups are used, and otherwise those of the first scope that has any', async () => {
  const sessions = [{ id: 'g1', title: 'Zulu', group: 'cg-a', ago: 1 }, { id: 'g2', title: 'Alpha', group: 'cg-a', ago: 2 }];
  const sortOf = async mac => {
    const { s, token } = await ready({ groups: GROUPS, sessions, ...mac });
    return (await index(s, token)).groups[0];
  };
  const alone = await sortOf({ sections: { elsewhere: [section('cg-a', 'manual', 'alpha', false)] } });
  assert.deepEqual([alone.sort, titles(alone.sessions)], [{ by: 'alpha', ascending: false }, ['Alpha', 'Zulu']], 'the only scope with sections');
  const both = await sortOf({ sections: { elsewhere: [section('cg-a', 'manual', 'alpha', false)], scope: [section('cg-a', 'manual', 'recency', false)] } });
  assert.deepEqual([both.sort, titles(both.sessions)], [RECENT, ['Zulu', 'Alpha']], 'the groups\' own scope wins though it comes second');
});

test('a family is one level deep in the list\'s sort, however deep its links go', async () => {
  const sessions = [
    { id: 'head', title: 'Head', ago: 50 },
    { id: 'a', title: 'Alpha', parent: 'head', ago: 40 },
    { id: 'b', title: 'Bravo', parent: 'a', ago: 30 },
    { id: 'd', title: 'Delta', parent: 'b', ago: 10 },
    { id: 'c', title: 'Charlie', parent: 'head', ago: 20 },
  ];
  const newest = await ready({ sessions });
  const recent = await index(newest.s, newest.token);
  assert.deepEqual(shape(recent.ungrouped), ['Head [Delta, Charlie, Bravo, Alpha]']);
  assert.deepEqual(recent.ungrouped[0].children.map(r => [r.id, r.parent]), [['d', 'head'], ['c', 'head'], ['b', 'head'], ['a', 'head']]);
  assert.equal(rowOf(recent, 'head').parent, null);

  const byTitle = await ready({ sessions, sections: [section('loose', 'sessions', 'alpha', false)] });
  assert.deepEqual(shape((await index(byTitle.s, byTitle.token)).ungrouped), ['Head [Alpha, Bravo, Charlie, Delta]']);
});

test('a session linked to an archived one shows under the next one up, and beside it in the archive', async () => {
  const { s, token } = await ready({
    sessions: [
      { id: 'head', title: 'Head', ago: 10 },
      { id: 'x', title: 'Archived middle', parent: 'head', archived: true, ago: 20 },
      { id: 'y', title: 'Under the archived one', parent: 'x', ago: 5 },
      { id: 'z', title: 'Direct', parent: 'head', ago: 1 },
    ],
  });
  const listed = await index(s, token);
  assert.deepEqual(shape(listed.ungrouped), ['Head [Direct, Under the archived one]']);
  assert.deepEqual(['y', 'z'].map(id => rowOf(listed, id).parent), ['head', 'head']);

  const archive = await index(s, token, '?archived=1');
  assert.deepEqual(shape(archive.ungrouped), ['Head [Direct, Under the archived one, Archived middle]']);
  assert.deepEqual(['x', 'y', 'z'].map(id => rowOf(archive, id).parent), ['head', 'head', 'head']);
});

// R is an archived root, M an archived session under it, Y a live one under M with X under Y and an archived A under X, and Z is under R.
test('the archive lists an archived root with every session under it, each live head followed at once by its own members', async () => {
  const { s, token } = await ready({
    sessions: [
      { id: 'r', title: 'R', archived: true, ago: 100 },
      { id: 'm', title: 'M', parent: 'r', archived: true, ago: 90 },
      { id: 'y', title: 'Y', parent: 'm', ago: 80 },
      { id: 'z', title: 'Z', parent: 'r', ago: 5 },
      { id: 'x', title: 'X', parent: 'y', ago: 70 },
      { id: 'a', title: 'A', parent: 'x', archived: true, ago: 60 },
    ],
  });
  const archive = await index(s, token, '?archived=1');
  assert.deepEqual(shape(archive.ungrouped), ['R [Z, Y, A, X, M]']);
  assert.deepEqual(['r', 'm', 'y', 'z', 'x', 'a'].map(id => rowOf(archive, id).parent), [null, 'r', 'r', 'r', 'y', 'y']);
  const listed = await index(s, token);
  assert.deepEqual(shape(listed.ungrouped), ['Z', 'Y [X]']);
  assert.deepEqual(['y', 'z', 'x'].map(id => rowOf(listed, id).parent), [null, null, 'y']);
});

test('the nearest session a row shows under stays in the server, with the archived rows listed or not', async () => {
  const { s, token } = await ready({
    sessions: [
      { id: 'head', title: 'Head', ago: 10 },
      { id: 'x', title: 'Archived middle', parent: 'head', archived: true, ago: 20 },
      { id: 'y', title: 'Under the archived one', parent: 'x', ago: 5 },
    ],
  });
  for (const query of ['', '?archived=1']) {
    const ix = await index(s, token, query);
    assert.equal(everyRow(ix).length, query ? 3 : 2);
    assert.ok(everyRow(ix).every(r => !('near' in r)), `no near on a row ${query}`);
    assert.equal('families' in ix, false, `nor on the index ${query}`);
  }
});

// Desktop's own rule for a link: a side session, a fork or a suggested task nests under the session it came from, unless it is detached.
// A is nobody's child. B is a suggested task from A. C was spawned from A and detached, so it stands alone. D and E are suggested tasks from C.
test('a session detached from its parent keeps the sessions that came from it, which show under it', async () => {
  const { s, token } = await ready({
    sessions: [
      { id: 'a', title: 'A', ago: 5 },
      { id: 'b', title: 'B', spawnedFrom: { sessionId: 'local_a' }, ago: 4 },
      { id: 'c', title: 'C', spawnedFrom: { sessionId: 'local_a' }, lineageDetached: true, ago: 3 },
      { id: 'd', title: 'D', spawnedFrom: { sessionId: 'local_c' }, ago: 2 },
      { id: 'e', title: 'E', spawnedFrom: { sessionId: 'local_c' }, ago: 1 },
    ],
  });
  const ix = await index(s, token);
  assert.deepEqual(shape(ix.ungrouped), ['C [E, D]', 'A [B]']);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(id => rowOf(ix, id).parent), [null, 'a', null, 'c', 'c']);
});

test('a list is cut at its first 60 as it is sorted, so a list that goes by title keeps the first names and not the newest', async () => {
  const rows = Array.from({ length: 62 }, (_, i) => ({ id: `r${i + 1}`, title: `Row ${String(i + 1).padStart(2, '0')}`, ago: 63 - i }));
  const recent = await ready({ sessions: rows });
  const newest = titles((await index(recent.s, recent.token)).ungrouped);
  assert.deepEqual([newest.length, newest[0], newest.at(-1)], [60, 'Row 62', 'Row 03'], 'newest first drops the oldest');

  const named = await ready({ sessions: rows, sections: [section('loose', 'sessions', 'alpha', false)] });
  const first = titles((await index(named.s, named.token)).ungrouped);
  assert.deepEqual([first.length, first[0], first.at(-1)], [60, 'Row 01', 'Row 60'], 'by title drops the last names, though they are the newest');
});
