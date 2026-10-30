// Run with `npm test`. Nesting a session under another: the links Desktop records and the chips that started sessions, Capcom's own choice over
// them, the route that nests and takes a session out, and what moving, pinning and archiving do to a family. Over HTTP against the real server, with a fake Mac under a
// temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { everyRow } from '../public/ui/tree.js';
import { as, cliCalls, request, restart, signIn, start, until } from './harness.mjs';

const GROUPS = [{ id: 'cg-work', name: 'Work' }, { id: 'cg-home', name: 'Home' }];
const SESSIONS = [
  { id: 'boss', title: 'Boss', group: 'cg-work', ago: 5 },
  { id: 'kid', title: 'Kid', parent: 'boss', group: 'cg-home', ago: 1 },
  { id: 'kid2', title: 'Kid two', parent: 'boss', ago: 2 },
  { id: 'peer', title: 'Peer', group: 'cg-work', ago: 6 },
  { id: 'loner', title: 'Loner', ago: 7 },
  { id: 'pin', title: 'Pinned one', pinned: true, ago: 8 },
  { id: 'pk', title: 'Pinned kid', parent: 'pin', ago: 3 },
  { id: 'run', title: 'Nightly', routine: 'nightly', ago: 9 },
  { id: 'gone', title: 'Archived one', archived: true, ago: 10 },
];

const titles = list => list.map(r => r.title);
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const index = async (s, token, query = '') => (await request(s, 'GET', `/api/sessions${query}`, { headers: as(token) })).body();
const archivedList = async (s, token) => (await request(s, 'GET', '/api/archived', { headers: as(token) })).body().archived;
const call = (s, token, route, json, headers) => request(s, 'POST', `/api/layout/${route}`, { headers: { ...as(token), ...headers }, json });
const rowOf = (ix, id) => everyRow(ix).find(r => r.id === id);
const snapshot = dir => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).map(name => path.join(dir, name)).filter(file => fs.statSync(file).isFile()).sort().map(file => [file, fs.readFileSync(file, 'utf8')]));

// A list as titles, each session with its children after it in brackets.
const shape = list => list.map(r => (r.children ? `${r.title} [${titles(r.children).join(', ')}]` : r.title));
const places = ix => ({ pinned: shape(ix.pinned), groups: Object.fromEntries(ix.groups.map(g => [g.id, shape(g.sessions)])), routines: ix.routines.map(g => g.latest.title), ungrouped: shape(ix.ungrouped) });

async function ready(mine) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, ...mine });
  return { s, ...(await signIn(s)) };
}

test('sessions Desktop links as side chats show under their parent in the parent\'s place, and nothing is written to layout.json', async () => {
  const { s, token } = await ready();
  const ix = await index(s, token);
  assert.deepEqual(places(ix), {
    pinned: ['Pinned one [Pinned kid]'],
    groups: { 'cg-work': ['Boss [Kid, Kid two]', 'Peer'], 'cg-home': [] },
    routines: ['Nightly'],
    ungrouped: ['Loner'],
  });
  assert.deepEqual(rowOf(ix, 'boss').children.map(r => [r.id, r.parent, r.group, r.pinned]), [['kid', 'boss', 'cg-work', false], ['kid2', 'boss', 'cg-work', false]], 'the group a child was put in is not used');
  assert.deepEqual(rowOf(ix, 'pin').children.map(r => [r.id, r.parent, r.group, r.pinned]), [['pk', 'pin', null, true]]);
  assert.deepEqual(['boss', 'peer', 'loner', 'pin', 'run'].map(id => rowOf(ix, id).parent), [null, null, null, null, null]);
  assert.equal(Object.hasOwn(onDisk(s), 'parents'), false);
});

test('Desktop links a side chat, a fork and a suggested task it has not detached, and a record that is anything else, or names no parent Capcom can find, is no link', async () => {
  const { s, token } = await ready({
    sessions: [
      { id: 'boss', title: 'Boss', ago: 1 },
      { id: 'real', title: 'Side chat', parent: 'boss', ago: 2 },
      { id: 'kept', title: 'Never detached', parent: 'boss', lineageDetached: false, ago: 3 },
      { id: 'plain', title: 'Suggested task', spawnedFrom: { sessionId: 'local_boss', sideSession: false }, ago: 4 },
      { id: 'older', title: 'Older record', spawnedFrom: { sessionId: 'local_boss' }, ago: 5 },
      { id: 'forked', title: 'Forked here', forkedFrom: 'boss', ago: 6 },
      { id: 'cut', title: 'Taken out in Desktop', parent: 'boss', lineageDetached: true, ago: 7 },
      { id: 'mine', title: 'Forked by the user', spawnedFrom: { sessionId: 'local_boss', userFork: true }, ago: 8 },
      { id: 'lost', title: 'Parent has no record', parent: 'nobody', ago: 9 },
      { id: 'odd', title: 'Odd record', spawnedFrom: { sessionId: 5, sideSession: true }, ago: 10 },
    ],
  });
  assert.deepEqual(shape((await index(s, token)).ungrouped), ['Boss [Side chat, Never detached, Suggested task, Older record, Forked here]', 'Taken out in Desktop', 'Forked by the user', 'Parent has no record', 'Odd record']);
});

test('Capcom\'s own choice beats Desktop\'s link in both directions: a null takes a session out, and a parent nests one that Desktop does not link', async () => {
  const { s, token } = await ready({ layout: { parents: { kid: null, peer: 'boss' } } });
  assert.deepEqual(places(await index(s, token)).groups, { 'cg-work': ['Boss [Kid two, Peer]'], 'cg-home': ['Kid'] });
});

test('links that lead back to each other show their sessions at the top level, and a chain of links shows one level deep with each session after the one it nests under', async () => {
  const { s, token } = await ready({
    sessions: [{ id: 'a', title: 'A', ago: 1 }, { id: 'b', title: 'B', ago: 2 }, { id: 'c', title: 'C', ago: 3 }, { id: 'x', title: 'X', ago: 4 }, { id: 'y', title: 'Y', ago: 5 }, { id: 'z', title: 'Z', ago: 6 }],
    layout: { parents: { a: 'b', b: 'a', x: 'y', y: 'z' } },
  });
  assert.deepEqual(shape((await index(s, token)).ungrouped), ['A', 'B', 'C', 'Z [Y, X]']);
});

test('the nest route refuses what cannot be nested with a short sentence, and a refusal writes nothing', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  const SELF = 'A session cannot nest under itself or its own child.';
  for (const [json, status, error] of [
    [{ id: 'nobody', parent: 'boss' }, 404, 'No session with that id on this Mac.'],
    [{ id: 5, parent: 'boss' }, 400, 'Which session?'],
    [{ id: 'loner' }, 400, 'Nest it under which session?'],
    [{ id: 'loner', parent: 5 }, 400, 'Nest it under which session?'],
    [{ id: 'loner', parent: ['boss'] }, 400, 'Nest it under which session?'],
    [{ id: 'loner', parent: 'nobody' }, 404, 'No session with that id on this Mac.'],
    [{ id: 'loner', parent: 'gone' }, 400, 'That session is archived.'],
    [{ id: 'loner', parent: 'run' }, 400, 'A routine run cannot hold sessions.'],
    [{ id: 'peer', parent: 'peer' }, 400, SELF],
    [{ id: 'kid', parent: 'kid' }, 400, SELF],
    [{ id: 'boss', parent: 'kid' }, 400, SELF],
    [{ id: 'boss', parent: 'kid2' }, 400, SELF],
  ]) {
    const res = await call(s, token, 'nest', json);
    assert.deepEqual([res.status, res.body()], [status, { error }], JSON.stringify(json));
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.equal((await request(s, 'POST', '/api/layout/nest', { json: { id: 'loner', parent: 'boss' } })).status, 401, 'signed out');
  assert.equal((await call(s, token, 'nest', { id: 'loner', parent: 'boss' }, { origin: 'http://evil.example' })).status, 403, 'from another site');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('nesting a session writes its parent and drops its own place, and the answer names the parent the list shows', async () => {
  const { s, token } = await ready();
  const was = snapshot(path.join(s.home, 'Library'));
  const res = await call(s, token, 'nest', { id: 'peer', parent: 'boss' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body(), { id: 'peer', group: null, pinned: false, parent: 'boss' });
  assert.deepEqual(onDisk(s).parents, { peer: 'boss' });
  assert.deepEqual(onDisk(s).assignments, { boss: 'cg-work', kid: 'cg-home' }, 'its own group went');
  assert.deepEqual(places(await index(s, token)).groups, { 'cg-work': ['Boss [Kid, Kid two, Peer]'], 'cg-home': [] });

  const pinned = await call(s, token, 'nest', { id: 'loner', parent: 'pin' });
  assert.deepEqual(pinned.body(), { id: 'loner', group: null, pinned: false, parent: 'pin' });
  assert.deepEqual(places(await index(s, token)).pinned, ['Pinned one [Pinned kid, Loner]'], 'a pinned parent lists its children newest first');
  assert.deepEqual(places(await index(s, token)).ungrouped, []);
  assert.deepEqual(snapshot(path.join(s.home, 'Library')), was, "Desktop's records are never written");
});

test('a drop on a child nests under that child\'s parent, and a session moves from one parent to another', async () => {
  const { s, token } = await ready();
  const onChild = await call(s, token, 'nest', { id: 'loner', parent: 'kid' });
  assert.equal(onChild.body().parent, 'boss');
  assert.deepEqual(onDisk(s).parents, { loner: 'boss' });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Boss [Kid, Kid two, Loner]', 'Peer']);

  const moved = await call(s, token, 'nest', { id: 'loner', parent: 'peer' });
  assert.equal(moved.body().parent, 'peer');
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Boss [Kid, Kid two]', 'Peer [Loner]']);
  assert.deepEqual(onDisk(s).parents, { loner: 'peer' });
});

test('a parent dropped on another session nests there with its children, which stay one level deep', async () => {
  const { s, token } = await ready();
  const res = await call(s, token, 'nest', { id: 'boss', parent: 'peer' });
  assert.equal(res.body().parent, 'peer');
  assert.deepEqual(onDisk(s).parents, { boss: 'peer' }, "only the parent is written, the children's links to it stay Desktop's");
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Peer [Boss, Kid, Kid two]']);
  assert.deepEqual((await index(s, token)).groups[0].sessions[0].children.map(r => r.parent), ['peer', 'peer', 'peer']);
});

test('taking a session out of its parent keeps it in the section its family is in, for a link Desktop records and for one Capcom made', async () => {
  const { s, token } = await ready();
  const out = await call(s, token, 'nest', { id: 'kid', parent: null });
  assert.deepEqual(out.body(), { id: 'kid', group: 'cg-work', pinned: false, parent: null });
  assert.deepEqual(onDisk(s).parents, { kid: null });
  assert.deepEqual(places(await index(s, token)).groups, { 'cg-work': ['Kid', 'Boss [Kid two]', 'Peer'], 'cg-home': [] });

  await call(s, token, 'nest', { id: 'pk', parent: null });
  assert.deepEqual(onDisk(s).pinned, ['pin', 'pk']);
  assert.deepEqual(places(await index(s, token)).pinned, ['Pinned kid', 'Pinned one']);

  await call(s, token, 'nest', { id: 'loner', parent: 'peer' });
  const back = await call(s, token, 'nest', { id: 'loner', parent: null });
  assert.deepEqual(back.body(), { id: 'loner', group: 'cg-work', pinned: false, parent: null });
  assert.deepEqual(onDisk(s).parents, { kid: null, pk: null, loner: null });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Kid', 'Boss [Kid two]', 'Peer', 'Loner']);
});

test('taking out a session that has no link, or whose Desktop parent Capcom cannot find, writes nothing, so a link Desktop makes later is not hidden', async () => {
  const { s, token } = await ready({ sessions: [...SESSIONS, { id: 'lost', title: 'Parent has no record', parent: 'nobody', ago: 11 }] });
  const before = fs.readFileSync(s.layout, 'utf8');
  for (const id of ['loner', 'lost']) {
    const res = await call(s, token, 'nest', { id, parent: null });
    assert.deepEqual(res.body(), { id, group: null, pinned: false, parent: null }, id);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('moving or pinning a nested session takes it out of its family and puts it where it was sent, and a session with no link gets no entry', async () => {
  const { s, token } = await ready();
  await call(s, token, 'nest', { id: 'peer', parent: 'boss' });
  assert.equal((await call(s, token, 'move', { id: 'kid', group: 'cg-home' })).status, 200);
  assert.equal((await call(s, token, 'move', { id: 'peer', group: null })).status, 200);
  assert.equal((await call(s, token, 'pin', { id: 'kid2', pinned: true })).status, 200);
  assert.deepEqual(onDisk(s).parents, { peer: null, kid: null, kid2: null });
  assert.deepEqual(places(await index(s, token)), {
    pinned: ['Kid two', 'Pinned one [Pinned kid]'],
    groups: { 'cg-work': ['Boss'], 'cg-home': ['Kid'] },
    routines: ['Nightly'],
    ungrouped: ['Peer', 'Loner'],
  });
  await call(s, token, 'move', { id: 'loner', group: 'cg-work' });
  await call(s, token, 'pin', { id: 'peer', pinned: true });
  assert.deepEqual(Object.keys(onDisk(s).parents).sort(), ['kid', 'kid2', 'peer'], 'loner had no link, so it has no entry');
});

test('moving or pinning a parent moves its children with it, and writes no link', async () => {
  const { s, token } = await ready();
  await call(s, token, 'move', { id: 'boss', group: 'cg-home' });
  assert.deepEqual(places(await index(s, token)).groups, { 'cg-work': ['Peer'], 'cg-home': ['Boss [Kid, Kid two]'] });
  await call(s, token, 'pin', { id: 'boss', pinned: true });
  const ix = await index(s, token);
  assert.deepEqual(titles(ix.pinned), ['Boss', 'Pinned one']);
  assert.deepEqual(rowOf(ix, 'boss').children.map(r => [r.group, r.pinned]), [[null, true], [null, true]]);
  await call(s, token, 'pin', { id: 'boss', pinned: false });
  await call(s, token, 'move', { id: 'boss', group: null });
  assert.deepEqual(places(await index(s, token)).ungrouped, ['Boss [Kid, Kid two]', 'Loner']);
  assert.deepEqual(onDisk(s).parents, {});
});

test('archiving a parent archives its children with it, and bringing it back nests them again', async () => {
  const { s, token } = await ready();
  assert.equal((await call(s, token, 'archive', { id: 'boss', archived: true })).status, 200);
  const ix = await index(s, token);
  assert.deepEqual(places(ix).groups, { 'cg-work': ['Peer'], 'cg-home': [] });
  assert.deepEqual(titles(await archivedList(s, token)).sort(), ['Archived one', 'Boss', 'Kid', 'Kid two']);

  assert.equal((await call(s, token, 'archive', { id: 'pin', archived: true })).status, 200);
  assert.deepEqual(places(await index(s, token)).pinned, []);

  await call(s, token, 'archive', { id: 'boss', archived: false });
  await call(s, token, 'archive', { id: 'pin', archived: false });
  assert.deepEqual(places(await index(s, token)), {
    pinned: ['Pinned one [Pinned kid]'],
    groups: { 'cg-work': ['Boss [Kid, Kid two]', 'Peer'], 'cg-home': [] },
    routines: ['Nightly'],
    ungrouped: ['Loner'],
  });
  assert.deepEqual(onDisk(s).parents, {}, 'no link was written for the children');
});

test('a child brought back alone from an archived parent moves up to its place, and comes back under the parent with it', async () => {
  const { s, token } = await ready();
  await call(s, token, 'archive', { id: 'boss', archived: true });
  await call(s, token, 'archive', { id: 'kid', archived: false });
  const ix = await index(s, token);
  assert.deepEqual(places(ix).groups['cg-work'], ['Kid', 'Peer']);
  assert.equal(rowOf(ix, 'kid').parent, null);
  await call(s, token, 'archive', { id: 'boss', archived: false });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Boss [Kid, Kid two]', 'Peer']);
  assert.deepEqual(onDisk(s).parents, {});
});

test('archiving a child archives it with the sessions below it and no more, and the archive view of the list still shows an archived parent with its children', async () => {
  const { s, token } = await ready();
  await call(s, token, 'archive', { id: 'kid', archived: true });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Boss [Kid two]', 'Peer']);
  assert.deepEqual(titles(await archivedList(s, token)).sort(), ['Archived one', 'Kid']);

  await call(s, token, 'archive', { id: 'kid', archived: false });
  await call(s, token, 'archive', { id: 'boss', archived: true });
  assert.deepEqual(places(await index(s, token, '?archived=1')).groups['cg-work'], ['Boss [Kid, Kid two]', 'Peer']);
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Peer']);
});

// Peer holds Boss and Pal, and Kid and Kid two link to Boss, so they show under Peer with no link to it of their own. Pal links to Peer.
const HIDDEN = [
  { id: 'peer', title: 'Peer', group: 'cg-work', ago: 6 },
  { id: 'boss', title: 'Boss', parent: 'peer', ago: 5 },
  { id: 'kid', title: 'Kid', parent: 'boss', ago: 1 },
  { id: 'kid2', title: 'Kid two', parent: 'boss', ago: 2 },
  { id: 'pal', title: 'Pal', parent: 'peer', ago: 3 },
  { id: 'other', title: 'Other', group: 'cg-work', ago: 7 },
];
const WAYS = ['Desktop links Boss to Peer', 'Capcom nests Boss under Peer'];

// Boss under Peer either way. `linked` is what layout.json holds once it is.
async function underPeer(way) {
  const byCapcom = way === WAYS[1];
  const made = await ready({ sessions: byCapcom ? HIDDEN.map(({ id, parent, ...rest }) => ({ id, ...rest, ...(id !== 'boss' && parent && { parent }) })) : HIDDEN });
  if (byCapcom) await call(made.s, made.token, 'nest', { id: 'boss', parent: 'peer' });
  assert.deepEqual(places(await index(made.s, made.token)).groups['cg-work'], ['Peer [Pal, Boss, Kid, Kid two]', 'Other'], way);
  return { ...made, linked: byCapcom ? { boss: 'peer' } : {} };
}

for (const way of WAYS) {
  test(`${way}: taking Boss out of Peer leaves Kid and Kid two under Peer, and Pal, linked to Peer already, gets no new link`, async () => {
    const { s, token, linked } = await underPeer(way);
    const res = await call(s, token, 'nest', { id: 'boss', parent: null });
    assert.deepEqual(res.body(), { id: 'boss', group: 'cg-work', pinned: false, parent: null });
    assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Peer [Kid, Kid two, Pal]', 'Boss', 'Other']);
    assert.deepEqual(onDisk(s).parents, { ...linked, kid: 'peer', kid2: 'peer', boss: null });
  });

  test(`${way}: nesting Boss under Other leaves Kid and Kid two under Peer`, async () => {
    const { s, token, linked } = await underPeer(way);
    const res = await call(s, token, 'nest', { id: 'boss', parent: 'other' });
    assert.equal(res.body().parent, 'other');
    assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Peer [Kid, Kid two, Pal]', 'Other [Boss]']);
    assert.deepEqual(onDisk(s).parents, { ...linked, kid: 'peer', kid2: 'peer', boss: 'other' });
  });

  test(`${way}: moving or pinning Boss takes only Boss out of Peer`, async () => {
    for (const [route, json] of [['move', { id: 'boss', group: 'cg-home' }], ['pin', { id: 'boss', pinned: true }]]) {
      const { s, token, linked } = await underPeer(way);
      assert.equal((await call(s, token, route, json)).status, 200);
      const now = places(await index(s, token));
      assert.deepEqual(now.groups['cg-work'], ['Peer [Kid, Kid two, Pal]', 'Other'], route);
      assert.deepEqual(route === 'move' ? now.groups['cg-home'] : now.pinned, ['Boss'], route);
      assert.deepEqual(onDisk(s).parents, { ...linked, kid: 'peer', kid2: 'peer', boss: null }, route);
    }
  });

  test(`${way}: archiving Peer archives Boss, Pal, Kid and Kid two with it, writes no link, and they nest under it again when it returns`, async () => {
    const { s, token, linked } = await underPeer(way);
    assert.equal((await call(s, token, 'archive', { id: 'peer', archived: true })).body().subs, 4);
    assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Other']);
    assert.deepEqual(onDisk(s).parents, linked);
    await call(s, token, 'archive', { id: 'peer', archived: false });
    assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Peer [Pal, Boss, Kid, Kid two]', 'Other']);
  });

  test(`${way}: Boss brought back alone from an archived Peer moves up to its place with Kid and Kid two still under it`, async () => {
    const { s, token, linked } = await underPeer(way);
    await call(s, token, 'archive', { id: 'peer', archived: true });
    assert.equal((await call(s, token, 'archive', { id: 'boss', archived: false })).body().subs, 2);
    assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Boss [Kid, Kid two]', 'Other']);
    assert.deepEqual(onDisk(s).parents, linked);
  });
}

// Head holds Alpha and Charlie, Bravo links to Alpha and Delta to Bravo, so the family shows Charlie, then Alpha, Bravo and Delta.
const LINE = [
  { id: 'head', title: 'Head', group: 'cg-work', ago: 50 },
  { id: 'a', title: 'Alpha', parent: 'head', ago: 40 },
  { id: 'b', title: 'Bravo', parent: 'a', ago: 30 },
  { id: 'd', title: 'Delta', parent: 'b', ago: 25 },
  { id: 'c', title: 'Charlie', parent: 'head', ago: 20 },
  { id: 'other', title: 'Other', group: 'cg-work', ago: 60 },
];

test('a session with nothing under it that leaves its family, by any route, leaves the rest depth first and writes no link for them', async () => {
  for (const [route, json, own] of [
    ['archive', { id: 'c', archived: true }, {}],
    ['nest', { id: 'c', parent: null }, { c: null }],
    ['nest', { id: 'c', parent: 'other' }, { c: 'other' }],
    ['move', { id: 'c', group: 'cg-home' }, { c: null }],
    ['pin', { id: 'c', pinned: true }, { c: null }],
  ]) {
    const { s, token } = await ready({ sessions: LINE });
    assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Head [Charlie, Alpha, Bravo, Delta]', 'Other']);
    assert.equal((await call(s, token, route, json)).status, 200, route);
    assert.deepEqual(titles(rowOf(await index(s, token), 'head').children), ['Alpha', 'Bravo', 'Delta'], route);
    assert.deepEqual(onDisk(s).parents, own, route);
  }
});

test('a session that leaves its family hands the ones straight under it to the session it showed under, and those further down keep their links', async () => {
  for (const [route, json, own] of [
    ['nest', { id: 'a', parent: null }, { a: null }],
    ['nest', { id: 'a', parent: 'other' }, { a: 'other' }],
    ['move', { id: 'a', group: 'cg-home' }, { a: null }],
    ['pin', { id: 'a', pinned: true }, { a: null }],
  ]) {
    const { s, token } = await ready({ sessions: LINE });
    assert.equal((await call(s, token, route, json)).status, 200, route);
    const ix = await index(s, token);
    assert.deepEqual(titles(rowOf(ix, 'head').children), ['Charlie', 'Bravo', 'Delta'], route);
    assert.equal(rowOf(ix, 'd').via, 'b', route);
    assert.deepEqual(onDisk(s).parents, { ...own, b: 'head' }, route);
  }
});

test('archiving a session in a family writes no link, as the ones under it go with it and come back under it when it returns', async () => {
  const { s, token } = await ready({ sessions: LINE });
  await call(s, token, 'archive', { id: 'a', archived: true });
  assert.deepEqual(titles(rowOf(await index(s, token), 'head').children), ['Charlie']);
  await call(s, token, 'archive', { id: 'a', archived: false });
  assert.deepEqual(titles(rowOf(await index(s, token), 'head').children), ['Charlie', 'Alpha', 'Bravo', 'Delta']);
  assert.deepEqual(onDisk(s).parents, {});
});

test('a head nested under another session takes its family along in the same order, and only the head is written', async () => {
  const { s, token } = await ready({ sessions: LINE });
  assert.equal((await call(s, token, 'nest', { id: 'head', parent: 'other' })).body().parent, 'other');
  assert.deepEqual(titles(rowOf(await index(s, token), 'other').children), ['Head', 'Charlie', 'Alpha', 'Bravo', 'Delta']);
  assert.deepEqual(onDisk(s).parents, { head: 'other' });
});

test('an archived session in a family gets no link of its own when another leaves, and shows under the session it is linked to when it comes back', async () => {
  const { s, token } = await ready({ sessions: HIDDEN.map(r => (r.id === 'kid2' ? { ...r, archived: true } : r)) });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Peer [Pal, Boss, Kid]', 'Other']);
  assert.equal((await call(s, token, 'nest', { id: 'boss', parent: null })).status, 200);
  assert.deepEqual(onDisk(s).parents, { kid: 'peer', boss: null });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Peer [Kid, Pal]', 'Boss', 'Other']);
  await call(s, token, 'archive', { id: 'kid2', archived: false });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Peer [Kid, Pal]', 'Boss [Kid two]', 'Other']);
});

test('a refusal to nest, move, pin or archive a session writes nothing, links for the rest of its family included', async () => {
  const { s, token } = await underPeer(WAYS[0]);
  const before = fs.readFileSync(s.layout, 'utf8');
  for (const [route, json, status] of [
    ['nest', { id: 'boss', parent: 'nobody' }, 404],
    ['nest', { id: 'boss', parent: 'boss' }, 400],
    ['nest', { id: 'boss', parent: 'kid' }, 400],
    ['move', { id: 'boss', group: 'nowhere' }, 400],
    ['pin', { id: 'boss', pinned: 'yes' }, 400],
    ['archive', { id: 'boss', archived: 'yes' }, 400],
  ]) {
    assert.equal((await call(s, token, route, json)).status, status, `${route} ${JSON.stringify(json)}`);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('a session cannot nest under its own child when the link between them is hidden by an archived session, and a refusal writes nothing', async () => {
  const SELF = 'A session cannot nest under itself or its own child.';
  const { s, token } = await ready({
    sessions: [
      { id: 'a', title: 'A', group: 'cg-work', archived: true, ago: 5 },
      { id: 'b', title: 'B', parent: 'a', ago: 1 },
      { id: 'c', title: 'C', parent: 'b', ago: 2 },
    ],
  });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['B [C]'], 'B is top level, since A is archived, and C shows under B');
  const before = fs.readFileSync(s.layout, 'utf8');
  for (const parent of ['b', 'c']) {
    const res = await call(s, token, 'nest', { id: 'a', parent });
    assert.deepEqual([res.status, res.body()], [400, { error: SELF }], `A under ${parent}`);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('a session archived here cannot be nested under its own child either, and still has its child under it when it comes back', async () => {
  const { s, token } = await ready({ sessions: [{ id: 'a', title: 'A', group: 'cg-work', ago: 5 }, { id: 'b', title: 'B', parent: 'a', ago: 1 }] });
  await call(s, token, 'archive', { id: 'a', archived: true });
  assert.equal((await call(s, token, 'nest', { id: 'a', parent: 'b' })).body().error, 'That session is archived.', 'B went with A, so it is archived too');
  await call(s, token, 'archive', { id: 'b', archived: false });
  const before = fs.readFileSync(s.layout, 'utf8');
  const res = await call(s, token, 'nest', { id: 'a', parent: 'b' });
  assert.deepEqual([res.status, res.body()], [400, { error: 'A session cannot nest under itself or its own child.' }]);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  await call(s, token, 'archive', { id: 'a', archived: false });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['A [B]']);
});

test('nesting a session under the parent it shows under already answers with that parent and writes nothing', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  for (const [json, parent] of [[{ id: 'kid', parent: 'boss' }, 'boss'], [{ id: 'kid', parent: 'kid2' }, 'boss'], [{ id: 'kid2', parent: 'boss' }, 'boss'], [{ id: 'pk', parent: 'pin' }, 'pin']]) {
    const res = await call(s, token, 'nest', json);
    assert.deepEqual([res.status, res.body().parent], [200, parent], JSON.stringify(json));
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, "Kid keeps its own group, and no link is written for a link Desktop makes");

  await call(s, token, 'nest', { id: 'loner', parent: 'peer' });
  const nested = fs.readFileSync(s.layout, 'utf8');
  assert.equal((await call(s, token, 'nest', { id: 'loner', parent: 'peer' })).body().parent, 'peer');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), nested);
});

test('a family sits where its newest member does in a list that goes by recency, and where its head does in a list that goes by title', async () => {
  const { s, token } = await ready({
    sections: [{ id: 'cg-work', kind: 'manual', sortBy: 'alpha', ascending: false }],
    sessions: [
      { id: 'old', title: 'Old parent', ago: 50 },
      { id: 'fresh', title: 'Fresh child', parent: 'old', ago: 1 },
      { id: 'mid', title: 'Middle', ago: 10 },
      { id: 'g1', title: 'Zulu parent', group: 'cg-work', ago: 50 },
      { id: 'g2', title: 'Fresh in a group', parent: 'g1', ago: 1 },
      { id: 'g3', title: 'Alpha', group: 'cg-work', ago: 20 },
      { id: 'h1', title: 'Old in home', group: 'cg-home', ago: 40 },
      { id: 'h2', title: 'Fresh in home', parent: 'h1', ago: 2 },
      { id: 'h3', title: 'Home middle', group: 'cg-home', ago: 15 },
    ],
  });
  const ix = await index(s, token);
  assert.deepEqual(shape(ix.ungrouped), ['Old parent [Fresh child]', 'Middle']);
  assert.deepEqual(shape(ix.groups[0].sessions), ['Alpha', 'Zulu parent [Fresh in a group]'], 'a group that goes by title');
  assert.deepEqual(shape(ix.groups[1].sessions), ['Old in home [Fresh in home]', 'Home middle'], 'a group Desktop has no sort for goes newest first');
});

// A list stops at its newest 60. A family counts as one of them, and it stays whole when any member was brought back from the archive.
const loners = count => Array.from({ length: count }, (_, i) => ({ id: `l${i + 1}`, title: `Loner ${i + 1}`, ago: i + 1 }));
const FAMILY = (ago, parent = 'fam') => [{ id: parent, title: 'Family', ago }, ...[1, 2, 3, 4].map(n => ({ id: `${parent}-${n}`, title: `Member ${n}`, parent, ago: ago + n }))];

test('the list cut at the newest 60 counts a family as one session', async () => {
  const fit = await ready({ sessions: [...loners(59), ...FAMILY(0.5)] });
  const kept = (await index(fit.s, fit.token)).ungrouped;
  assert.equal(kept.length, 60, 'the 59 sessions and the family, which has five members');
  assert.equal(kept[0].title, 'Family');
  assert.equal(kept[0].children.length, 4);

  const over = await ready({ sessions: [...loners(60), ...FAMILY(0.5)] });
  const cut = (await index(over.s, over.token)).ungrouped;
  assert.deepEqual([cut.length, titles(cut).includes('Loner 60'), titles(cut).includes('Loner 59')], [60, false, true]);
});

test('a family past the newest 60 is cut, and stays whole when any member was brought back from the archive', async () => {
  const sessions = [...loners(61), ...FAMILY(200)];
  const { s, token } = await ready({ sessions });
  assert.equal(titles((await index(s, token)).ungrouped).includes('Family'), false);
  const layout = onDisk(s);
  fs.writeFileSync(s.layout, JSON.stringify({ ...layout, unarchived: ['fam-3'] }));
  const kept = (await index(s, token)).ungrouped;
  assert.equal(kept.length, 61);
  assert.deepEqual(shape(kept).at(-1), 'Family [Member 1, Member 2, Member 3, Member 4]');
});

// Maker made a chip, and Made is the session that chip started, so Capcom started it and Desktop has no record of it.
const MAKER = [
  { id: 'maker', title: 'Maker', group: 'cg-work', ago: 5 },
  { id: 'made', title: 'Made', source: 'capcom', ago: 1 },
  { id: 'other', title: 'Other', group: 'cg-work', ago: 6 },
];
const STARTED = [{ sessionId: 'maker', startedId: 'made', status: 'started' }];

test('a session started from a chip shows under the session that made the chip, in its place, and not in Started here', async () => {
  const { s, token } = await ready({ sessions: MAKER, chips: STARTED });
  const ix = await index(s, token);
  assert.deepEqual(places(ix).groups, { 'cg-work': ['Maker [Made]', 'Other'], 'cg-home': [] });
  assert.deepEqual(ix.started, []);
  assert.deepEqual([rowOf(ix, 'made').parent, rowOf(ix, 'made').group], ['maker', 'cg-work']);
  assert.equal(Object.hasOwn(onDisk(s), 'parents'), false, 'the link is read from chips.json, so nothing is written');
});

test('a chip started from the page nests its new session under the session that made the chip at once and after a restart', async () => {
  const sessions = MAKER.filter(r => r.id !== 'made');
  const s = await start({ sessions, groups: GROUPS, claude: true });
  const { token } = await signIn(s);
  const res = await request(s, 'POST', '/api/chips/start', { headers: as(token), json: { sessionId: 'maker', toolUseId: 'toolu_page', title: 'Follow up', prompt: 'begin a session', cwd: s.home } });
  assert.equal(res.status, 200);
  const { id } = res.body();
  const nested = async (server, cookie) => {
    const ix = await index(server, cookie);
    return [rowOf(ix, id).parent, ix.started, shape(ix.groups[0].sessions)];
  };
  assert.deepEqual(await nested(s, token), ['maker', [], ['Maker [Follow up]', 'Other']]);
  assert.equal(Object.hasOwn(onDisk(s), 'parents'), false);
  const again = await restart(s);
  assert.deepEqual(await nested(again, (await signIn(again)).token), ['maker', [], ['Maker [Follow up]', 'Other']]);
});

test('the chip link beats the link Desktop records for the session the chip started, and Desktop\'s link stands for a session no chip started', async () => {
  const { s, token } = await ready({
    sessions: [...MAKER.filter(r => r.id !== 'made'), { id: 'both', title: 'Both', parent: 'other', ago: 1 }, { id: 'plain', title: 'Plain', parent: 'other', ago: 2 }],
    chips: [{ sessionId: 'maker', startedId: 'both', status: 'started' }],
  });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Maker [Both]', 'Other [Plain]']);
});

test('Capcom\'s own choice beats the chip link in both directions: a null keeps the session at the top level, and a parent nests it there instead', async () => {
  const out = await ready({ sessions: MAKER, chips: STARTED, layout: { parents: { made: null } } });
  const kept = await index(out.s, out.token);
  assert.deepEqual(places(kept).groups['cg-work'], ['Maker', 'Other']);
  assert.deepEqual(shape(kept.started), ['Made']);

  const under = await ready({ sessions: MAKER, chips: STARTED, layout: { parents: { made: 'other' } } });
  const moved = await index(under.s, under.token);
  assert.deepEqual(places(moved).groups['cg-work'], ['Other [Made]', 'Maker']);
  assert.deepEqual(moved.started, []);
});

test('moving, pinning or taking out a session started from a chip leaves its starter and writes a null for it', async () => {
  for (const [route, json, where] of [
    ['move', { id: 'made', group: 'cg-home' }, { pinned: [], groups: { 'cg-work': ['Maker', 'Other'], 'cg-home': ['Made'] } }],
    ['pin', { id: 'made', pinned: true }, { pinned: ['Made'], groups: { 'cg-work': ['Maker', 'Other'], 'cg-home': [] } }],
    ['nest', { id: 'made', parent: null }, { pinned: [], groups: { 'cg-work': ['Made', 'Maker', 'Other'], 'cg-home': [] } }],
  ]) {
    const { s, token } = await ready({ sessions: MAKER, chips: STARTED });
    assert.equal((await call(s, token, route, json)).status, 200, route);
    assert.deepEqual(onDisk(s).parents, { made: null }, route);
    const ix = await index(s, token);
    assert.deepEqual({ pinned: shape(ix.pinned), groups: places(ix).groups }, where, route);
    assert.deepEqual(ix.started, [], `${route}: it is in its place, not in Started here`);
  }
});

test('a session started from a chip that leaves its starter hands the sessions started from it to the starter', async () => {
  const { s, token } = await ready({
    sessions: [...MAKER, { id: 'deeper', title: 'Deeper', source: 'capcom', ago: 2 }],
    chips: [...STARTED, { sessionId: 'made', startedId: 'deeper', status: 'started' }],
  });
  assert.deepEqual(places(await index(s, token)).groups['cg-work'], ['Maker [Made, Deeper]', 'Other']);
  assert.equal((await call(s, token, 'move', { id: 'made', group: 'cg-home' })).status, 200);
  assert.deepEqual(onDisk(s).parents, { made: null, deeper: 'maker' });
  assert.deepEqual(places(await index(s, token)).groups, { 'cg-work': ['Maker [Deeper]', 'Other'], 'cg-home': ['Made'] });
});

test('a chip that is open, dismissed or has no started session, or no session that made it, makes no link', async () => {
  const { s, token } = await ready({
    sessions: [
      { id: 'maker', title: 'Maker', group: 'cg-work', ago: 5 },
      { id: 'a', title: 'A', source: 'capcom', ago: 1 },
      { id: 'b', title: 'B', source: 'capcom', ago: 2 },
      { id: 'd', title: 'D', source: 'capcom', ago: 3 },
    ],
    chips: [
      { sessionId: 'maker', startedId: 'a', status: 'open' },
      { sessionId: 'maker', startedId: 'b', status: 'dismissed' },
      { sessionId: 'maker', status: 'started' },
      { startedId: 'd', status: 'started' },
    ],
  });
  const ix = await index(s, token);
  assert.deepEqual(places(ix).groups['cg-work'], ['Maker']);
  assert.deepEqual(shape(ix.started), ['A', 'B', 'D']);
});

test('a session started from a chip by a session that is nested itself shows under the topmost parent, after its starter', async () => {
  const { s, token } = await ready({
    sessions: [{ id: 'top', title: 'Top', group: 'cg-work', ago: 8 }, { id: 'maker', title: 'Maker', parent: 'top', ago: 5 }, { id: 'made', title: 'Made', source: 'capcom', ago: 1 }],
    chips: STARTED,
  });
  const ix = await index(s, token);
  assert.deepEqual(places(ix).groups['cg-work'], ['Top [Maker, Made]']);
  assert.deepEqual([rowOf(ix, 'made').parent, rowOf(ix, 'made').via], ['top', 'maker']);
  assert.equal(Object.hasOwn(onDisk(s), 'parents'), false);
});

test('a session cannot nest under a session started from a chip it made, and a refusal writes nothing', async () => {
  const { s, token } = await ready({
    sessions: [...MAKER, { id: 'deeper', title: 'Deeper', source: 'capcom', ago: 2 }],
    chips: [...STARTED, { sessionId: 'made', startedId: 'deeper', status: 'started' }],
  });
  const before = fs.readFileSync(s.layout, 'utf8');
  for (const parent of ['made', 'deeper']) {
    const res = await call(s, token, 'nest', { id: 'maker', parent });
    assert.deepEqual([res.status, res.body()], [400, { error: 'A session cannot nest under itself or its own child.' }], `Maker under ${parent}`);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

// An open chip that Maker made, which the page of another session (a fork of Maker, say) starts or dismisses.
const OPEN = [{ sessionId: 'maker', toolUseId: 'toolu_open', status: 'open', prompt: 'begin a session' }];
const chipsOf = async (s, token, id) => (await request(s, 'GET', `/api/sessions/${id}/chips`, { headers: as(token) })).body().chips;

test('a chip started from the page of another session still nests under the session that made it', async () => {
  const sessions = MAKER.filter(r => r.id !== 'made');
  const s = await start({ sessions, groups: GROUPS, claude: true, chips: OPEN });
  const { token } = await signIn(s);
  const res = await request(s, 'POST', '/api/chips/start', { headers: as(token), json: { sessionId: 'other', toolUseId: 'toolu_open' } });
  assert.equal(res.status, 200);
  const { id, chip } = res.body();
  assert.deepEqual([chip.sessionId, chip.startedId], ['maker', id]);
  const ix = await index(s, token);
  assert.equal(rowOf(ix, id).parent, 'maker');
  assert.deepEqual([(await chipsOf(s, token, 'maker')).length, (await chipsOf(s, token, 'other')).length], [1, 0]);
});

test('a chip dismissed from the page of another session stays with the session that made it', async () => {
  const s = await start({ sessions: MAKER, groups: GROUPS, chips: OPEN });
  const { token } = await signIn(s);
  const res = await request(s, 'POST', '/api/chips/dismiss', { headers: as(token), json: { sessionId: 'other', toolUseId: 'toolu_open', title: 'A chip' } });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body().chip.sessionId, res.body().chip.status], ['maker', 'dismissed']);
  assert.deepEqual((await chipsOf(s, token, 'maker')).map(c => c.status), ['dismissed']);
  assert.deepEqual(await chipsOf(s, token, 'other'), []);
});

// Chips that name a group: Home is where Maker's chip says the session opens, though Maker is in Work.
const NAMED = [
  { sessionId: 'maker', toolUseId: 'toolu_home', status: 'open', prompt: 'begin a session', group: 'cg-home' },
  { sessionId: 'maker', toolUseId: 'toolu_gone', status: 'open', prompt: 'begin a session', group: 'cg-deleted' },
  { sessionId: 'maker', toolUseId: 'toolu_plain', status: 'open', prompt: 'begin a session' },
];
const startChip = (s, token, toolUseId, json) => request(s, 'POST', '/api/chips/start', { headers: as(token), json: { sessionId: 'maker', toolUseId, ...json } });

test('a chip that names a group starts its session in that group on its own, unlinked from the session that made it, and a restart keeps it', async () => {
  const sessions = MAKER.filter(r => r.id !== 'made');
  const s = await start({ sessions, groups: GROUPS, claude: true, chips: NAMED });
  const { token } = await signIn(s);
  const res = await startChip(s, token, 'toolu_home');
  assert.equal(res.status, 200, res.text);
  const { id } = res.body();
  assert.deepEqual([onDisk(s).parents[id], onDisk(s).assignments[id]], [null, 'cg-home']);
  const shows = async (server, cookie) => {
    const ix = await index(server, cookie);
    return [rowOf(ix, id).parent, shape(ix.groups.find(g => g.id === 'cg-home').sessions), shape(ix.groups.find(g => g.id === 'cg-work').sessions)];
  };
  assert.deepEqual(await shows(s, token), [null, ['A chip'], ['Maker', 'Other']]);
  const again = await restart(s);
  assert.deepEqual(await shows(again, (await signIn(again)).token), [null, ['A chip'], ['Maker', 'Other']]);
});

test('a chip that names a group which was deleted refuses to start and starts nothing, and a chip with no group still nests under the session that made it', async () => {
  const sessions = MAKER.filter(r => r.id !== 'made');
  const s = await start({ sessions, groups: GROUPS, claude: true, chips: NAMED });
  const { token } = await signIn(s);
  const before = fs.readFileSync(s.layout, 'utf8');
  const refused = await startChip(s, token, 'toolu_gone');
  assert.deepEqual([refused.status, refused.body()], [400, { error: 'The group this chip names has been deleted. Ask the session to suggest the task again.' }]);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.equal(cliCalls(s).some(c => c.started), false, 'no session was started');
  assert.deepEqual((await chipsOf(s, token, 'maker')).find(c => c.toolUseId === 'toolu_gone').status, 'open');

  const plain = await startChip(s, token, 'toolu_plain');
  assert.equal(plain.status, 200, plain.text);
  const { id } = plain.body();
  const layout = onDisk(s);
  assert.deepEqual([layout.assignments?.[id], layout.parents?.[id]], [undefined, undefined], 'it writes no group and no link of its own');
  assert.deepEqual([rowOf(await index(s, token), id).parent, rowOf(await index(s, token), id).group], ['maker', 'cg-work']);
});

// Sub is a sub session of Maker, so a chip it makes opens beside it, under Maker.
const SUB = [...MAKER.filter(r => r.id !== 'made'), { id: 'sub', title: 'Sub', parent: 'maker', ago: 2 }];
const SUB_CHIPS = [
  { sessionId: 'sub', toolUseId: 'toolu_sub', status: 'open', prompt: 'begin a session' },
  { sessionId: 'sub', toolUseId: 'toolu_sub_home', status: 'open', prompt: 'begin a session', group: 'cg-home' },
  { sessionId: 'maker', toolUseId: 'toolu_top', status: 'open', prompt: 'begin a session' },
];
const startFrom = (s, token, sessionId, toolUseId) => request(s, 'POST', '/api/chips/start', { headers: as(token), json: { sessionId, toolUseId } });

test('a chip made by a sub session starts its session beside it under the sub session\'s parent, and one made by a top level session still nests under it', async () => {
  const s = await start({ sessions: SUB, groups: GROUPS, claude: true, chips: SUB_CHIPS });
  const { token } = await signIn(s);
  const beside = await startFrom(s, token, 'sub', 'toolu_sub');
  assert.equal(beside.status, 200, beside.text);
  assert.equal(beside.body().chip.nestUnder, 'maker');
  const top = await startFrom(s, token, 'maker', 'toolu_top');
  assert.equal(top.status, 200, top.text);
  assert.equal(Object.hasOwn(top.body().chip, 'nestUnder'), false, 'a top level maker is the parent already');
  const ix = await index(s, token);
  const [next, sub] = [beside.body().id, 'sub'].map(id => rowOf(ix, id));
  assert.deepEqual([next.parent, next.via, sub.parent, sub.via], ['maker', 'maker', 'maker', 'maker'], 'the new session is a sibling of its maker');
  assert.deepEqual([rowOf(ix, top.body().id).parent, rowOf(ix, top.body().id).via], ['maker', 'maker']);
  const again = await restart(s);
  assert.equal(rowOf(await index(again, (await signIn(again)).token), beside.body().id).via, 'maker', 'a restart reads it from chips.json');
});

test('a chip from a sub session that names a group writes no nestUnder, and the chips route words where each one opens', async () => {
  const s = await start({ sessions: SUB, groups: GROUPS, claude: true, chips: SUB_CHIPS });
  const { token } = await signIn(s);
  const opens = async id => Object.fromEntries((await chipsOf(s, token, id)).map(c => [c.toolUseId, c.opensIn]));
  assert.deepEqual(await opens('sub'), { toolu_sub: 'Opens beside this session, under “Maker”, in Work', toolu_sub_home: 'Opens in Home' });
  assert.equal((await opens('maker')).toolu_top, 'Opens under this session, in Work');
  const named = await startFrom(s, token, 'sub', 'toolu_sub_home');
  assert.equal(named.status, 200, named.text);
  assert.equal(Object.hasOwn(named.body().chip, 'nestUnder'), false);
  const started = await startFrom(s, token, 'sub', 'toolu_sub');
  assert.equal(started.body().chip.opensIn, 'Opens beside this session, under “Maker”, in Work');
  assert.equal((await opens('sub')).toolu_sub, 'Opens beside this session, under “Maker”, in Work', 'a started chip keeps the line');
});

test('a group posted with the card places nothing: only the chip the server stored counts', async () => {
  const sessions = MAKER.filter(r => r.id !== 'made');
  const s = await start({ sessions, groups: GROUPS, claude: true, chips: NAMED });
  const { token } = await signIn(s);
  const res = await startChip(s, token, 'toolu_plain', { group: 'cg-home' });
  assert.equal(res.status, 200, res.text);
  const { id } = res.body();
  assert.deepEqual([onDisk(s).assignments?.[id], rowOf(await index(s, token), id).parent], [undefined, 'maker']);
});

test('the chips route says where each chip opens, by the group\'s name now, and the start reply keeps saying it', async () => {
  const sessions = MAKER.filter(r => r.id !== 'made');
  const s = await start({ sessions, groups: GROUPS, claude: true, chips: NAMED });
  const { token } = await signIn(s);
  const opens = async () => Object.fromEntries((await chipsOf(s, token, 'maker')).map(c => [c.toolUseId, c.opensIn]));
  assert.deepEqual(await opens(), { toolu_home: 'Opens in Home', toolu_gone: 'Its group has been deleted', toolu_plain: 'Opens under this session, in Work' });
  assert.equal((await request(s, 'POST', '/api/layout/group/rename', { headers: as(token), json: { id: 'cg-home', name: 'Reviewing' } })).status, 200);
  assert.equal((await opens()).toolu_home, 'Opens in Reviewing', 'a rename shows');
  const started = await startChip(s, token, 'toolu_home');
  assert.equal(started.body().chip.opensIn, 'Opens in Reviewing');
  assert.equal((await opens()).toolu_home, 'Opens in Reviewing', 'a started chip keeps the line');
  assert.equal(Object.hasOwn(onDisk(s), 'opensIn'), false);
});

test('a chip with no group in a session that shows in no group has no group line, and one in a loose session says it opens under it', async () => {
  const s = await start({ sessions: [{ id: 'loose', title: 'Loose', ago: 1 }], groups: GROUPS, chips: [{ sessionId: 'loose', toolUseId: 'toolu_l', status: 'open', prompt: 'x' }] });
  const { token } = await signIn(s);
  assert.deepEqual((await chipsOf(s, token, 'loose')).map(c => c.opensIn), ['Opens under this session']);
});

test('a chip raised by a routine run has no group line, one raised by an archived session opens in its group, and a dismissed chip keeps its line', async () => {
  const sessions = [
    { id: 'run', title: 'Nightly', routine: 'nightly', group: 'cg-work', ago: 1 },
    { id: 'old', title: 'Old', archived: true, group: 'cg-work', ago: 2 },
    ...MAKER.filter(r => r.id !== 'made'),
  ];
  const chips = [
    { sessionId: 'run', toolUseId: 'toolu_run', status: 'open', prompt: 'x' },
    { sessionId: 'old', toolUseId: 'toolu_old', status: 'open', prompt: 'x' },
    ...NAMED,
  ];
  const s = await start({ sessions, groups: GROUPS, claude: true, chips });
  const { token } = await signIn(s);
  assert.deepEqual((await chipsOf(s, token, 'run')).map(c => c.opensIn), [undefined]);
  assert.deepEqual((await chipsOf(s, token, 'old')).map(c => c.opensIn), ['Opens in Work']);
  const dismissed = await request(s, 'POST', '/api/chips/dismiss', { headers: as(token), json: { sessionId: 'maker', toolUseId: 'toolu_home' } });
  assert.equal(dismissed.body().chip.opensIn, 'Opens in Home');
  const again = await startChip(s, token, 'toolu_home');
  assert.equal(again.status, 409);
  assert.equal(again.body().chip.opensIn, 'Opens in Home');
});

test('spawn_task called in a chat resolves the group name to its id when the chip is made, and refuses a name that is not a group', async () => {
  const sessions = MAKER.filter(r => r.id !== 'made');
  const s = await start({ sessions, groups: GROUPS, claude: true, chips: [] });
  const { token } = await signIn(s);
  const replies = () => cliCalls(s).filter(c => c.mcp).map(c => c.mcp.result.content[0].text);
  const spawn = async group => {
    const before = replies().length;
    await request(s, 'POST', '/api/sessions/maker/send', { headers: as(token), json: { text: `call spawn_task ${JSON.stringify({ title: 'Review', prompt: 'begin a session', cwd: s.home, group })}` } });
    await until(() => replies().length > before);
    return replies()[before];
  };
  assert.match(await spawn('home'), /^Chip created \(task_id: task_\w+\), to open in the group "Home"\./);
  assert.match(await spawn('Nowhere'), /no group called "Nowhere"\. The groups are "Work", "Home"\./);
  assert.deepEqual((await chipsOf(s, token, 'maker')).map(c => c.group), ['cg-home']);
});
