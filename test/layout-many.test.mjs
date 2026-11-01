// Run with `npm test`. Moving or nesting several sessions in one write: the places a drop or a menu can send them, the sessions that ride along
// with a picked one, what is refused and writes nothing, and the Undo. Over HTTP against the real server with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { everyRow } from '../public/ui/tree.js';
import { as, request, restart, signIn, start } from './harness.mjs';

const GROUP_CHAT = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const GROUPS = [{ id: 'cg-work', name: 'Work' }, { id: 'cg-home', name: 'Home', session: GROUP_CHAT }, { id: 'cg-spare', name: 'Spare' }];
const SESSIONS = [
  { id: 'boss', title: 'Boss', group: 'cg-work', ago: 5 },
  { id: 'mid', title: 'Mid', parent: 'boss', ago: 4 },
  { id: 'leaf', title: 'Leaf', parent: 'mid', ago: 3 },
  { id: 'kid', title: 'Kid', parent: 'boss', ago: 2 },
  { id: 'peer', title: 'Peer', group: 'cg-work', ago: 6 },
  { id: 'loner', title: 'Loner', ago: 7 },
  { id: 'other', title: 'Other loner', ago: 8 },
  { id: 'pin', title: 'Pinned one', pinned: true, ago: 9 },
  { id: 'run', title: 'Nightly', routine: 'nightly', ago: 10 },
  { id: 'gone', title: 'Archived one', archived: true, ago: 11 },
];

const post = (s, token, route, json, headers) => request(s, 'POST', route, { headers: { ...as(token), ...headers }, json });
const many = (s, token, json, headers) => post(s, token, '/api/layout/many', json, headers);
const undo = (s, token, json) => post(s, token, '/api/layout/many/undo', json);
const read = file => fs.readFileSync(file, 'utf8');
const onDisk = s => JSON.parse(read(s.layout));
const index = async (s, token) => (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
const rowOf = (ix, id) => everyRow(ix).find(r => r.id === id);
const ids = list => list.map(r => r.id).sort();

async function ready(mine) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, ...mine });
  return { s, ...(await signIn(s)) };
}

const snapshot = s => read(s.layout);

test('sessions move to a group in one write, and the answer carries a count and an Undo token', async () => {
  const { s, token } = await ready();
  const before = fs.statSync(s.layout).mtimeMs;
  const res = await many(s, token, { ids: ['loner', 'other', 'pin'], to: { group: 'cg-spare' } });
  assert.equal(res.status, 200, res.text);
  const { undo: tokenOf, count } = res.body();
  assert.match(tokenOf, /^[0-9a-f-]{36}$/);
  assert.equal(count, 3);
  assert.notEqual(fs.statSync(s.layout).mtimeMs, before);
  assert.deepEqual(onDisk(s).assignments, { boss: 'cg-work', peer: 'cg-work', loner: 'cg-spare', other: 'cg-spare', pin: 'cg-spare' });
  assert.deepEqual(onDisk(s).pinned, []);
  const ix = await index(s, token);
  assert.deepEqual(ids(ix.groups.find(g => g.id === 'cg-spare').sessions), ['loner', 'other', 'pin']);
});

test('a group of null sends each session to its own loose list, which also unpins a pinned one', async () => {
  const { s, token } = await ready();
  const res = await many(s, token, { ids: ['peer', 'pin'], to: { group: null } });
  assert.equal(res.body().count, 2);
  const ix = await index(s, token);
  assert.deepEqual(ids(ix.pinned), []);
  assert.ok(rowOf(ix, 'peer') && ix.ungrouped.some(r => r.id === 'peer') && ix.ungrouped.some(r => r.id === 'pin'));
});

test('pinned: true pins them all, and a session already in the place is left out of the count', async () => {
  const { s, token } = await ready();
  const res = await many(s, token, { ids: ['loner', 'pin', 'peer'], to: { pinned: true } });
  assert.equal(res.body().count, 2);
  assert.deepEqual(ids((await index(s, token)).pinned), ['loner', 'peer', 'pin']);
  const again = await many(s, token, { ids: ['loner', 'pin'], to: { pinned: true } });
  assert.deepEqual([again.status, again.body()], [200, { count: 0 }], 'nothing changed, so nothing is written and there is nothing to undo');
});

test('sessions nest under a session in one write, and a drop on a nested session nests under its parent', async () => {
  const { s, token } = await ready();
  const res = await many(s, token, { ids: ['loner', 'other'], to: { parent: 'kid' } });
  assert.deepEqual([res.status, res.body().count], [200, 2]);
  assert.deepEqual(onDisk(s).parents, { loner: 'boss', other: 'boss' });
  const ix = await index(s, token);
  assert.deepEqual(rowOf(ix, 'boss').children.map(r => r.id).sort(), ['kid', 'leaf', 'loner', 'mid', 'other']);
  assert.equal(rowOf(ix, 'loner').parent, 'boss');
});

test('sessions already under the target are no-ops, and the others still nest', async () => {
  const { s, token } = await ready();
  const res = await many(s, token, { ids: ['kid', 'loner'], to: { parent: 'boss' } });
  assert.equal(res.body().count, 1);
  assert.deepEqual(onDisk(s).parents, { loner: 'boss' });
  const none = await many(s, token, { ids: ['kid', 'mid'], to: { parent: 'boss' } });
  assert.deepEqual(none.body(), { count: 0 });
});

test('parent: null takes nested sessions out to where their family showed them, and leaves one with no link alone', async () => {
  const { s, token } = await ready();
  const res = await many(s, token, { ids: ['kid', 'leaf', 'loner'], to: { parent: null } });
  assert.equal(res.body().count, 2);
  const ix = await index(s, token);
  assert.deepEqual(ids(ix.groups.find(g => g.id === 'cg-work').sessions), ['boss', 'kid', 'leaf', 'peer']);
  assert.deepEqual(rowOf(ix, 'boss').children.map(r => r.id), ['mid']);
  assert.equal(onDisk(s).parents.loner, undefined, 'a write of null would hide a link Desktop makes later');
});

test('a picked session whose nearest shown parent is picked rides along with its family and is not changed on its own', async () => {
  const { s, token } = await ready();
  const res = await many(s, token, { ids: ['boss', 'kid', 'loner'], to: { group: 'cg-spare' } });
  assert.equal(res.body().count, 3, 'the one that rides along is counted');
  assert.deepEqual(onDisk(s).assignments, { peer: 'cg-work', boss: 'cg-spare', loner: 'cg-spare' });
  assert.equal(onDisk(s).parents.kid, undefined);
  const ix = await index(s, token);
  assert.deepEqual(ids(rowOf(ix, 'boss').children), ['kid', 'leaf', 'mid']);
  assert.equal(rowOf(ix, 'kid').group, 'cg-spare');
});

test('a nested session that moves leaves the sessions under it where they were, unless they are picked too', async () => {
  const { s, token } = await ready();
  await many(s, token, { ids: ['mid'], to: { group: 'cg-spare' } });
  assert.deepEqual([onDisk(s).parents.mid, onDisk(s).parents.leaf], [null, 'boss'], 'leaf showed under mid and now shows under boss');
  const both = await ready();
  await many(both.s, both.token, { ids: ['mid', 'leaf'], to: { group: 'cg-spare' } });
  assert.deepEqual([onDisk(both.s).parents.mid, onDisk(both.s).parents.leaf], [null, undefined], 'leaf rides along and keeps its link');
});

test('nesting under a session takes the whole family of a picked top level session along', async () => {
  const { s, token } = await ready();
  const res = await many(s, token, { ids: ['boss'], to: { parent: 'loner' } });
  assert.equal(res.body().count, 1);
  const ix = await index(s, token);
  assert.deepEqual(ids(rowOf(ix, 'loner').children), ['boss', 'kid', 'leaf', 'mid']);
});

test('a drop on a session picked, even a nested one, or on one nested under a picked session, is refused and writes nothing', async () => {
  const { s, token } = await ready();
  const before = snapshot(s);
  for (const [picked, target] of [[['boss', 'loner'], 'boss'], [['boss', 'loner'], 'kid'], [['loner'], 'loner'], [['boss'], 'leaf'], [['kid', 'loner'], 'kid']]) {
    const res = await many(s, token, { ids: picked, to: { parent: target } });
    assert.deepEqual([res.status, res.body().error], [400, 'A session cannot nest under itself or a session nested under it.'], `${picked} under ${target}`);
  }
  assert.equal(snapshot(s), before);
});

test('a refusal for any one session refuses all of them, with the reason, and writes nothing', async () => {
  const { s, token } = await ready();
  const before = snapshot(s);
  const cases = [
    [{ ids: [], to: { group: null } }, 400, 'Pick at least one session.'],
    [{ to: { group: null } }, 400, 'Pick at least one session.'],
    [{ ids: 'loner', to: { group: null } }, 400, 'Pick at least one session.'],
    [{ ids: ['loner', '../etc'], to: { group: null } }, 400, 'Which sessions?'],
    [{ ids: ['loner', 5], to: { group: null } }, 400, 'Which sessions?'],
    [{ ids: ['loner', 'loner'], to: { group: null } }, 400, 'Each session can be picked once.'],
    [{ ids: ['loner', 'nobody'], to: { group: 'cg-spare' } }, 404, 'No session with that id on this Mac.'],
    [{ ids: ['loner', GROUP_CHAT], to: { group: 'cg-spare' } }, 400, 'A group\'s session stays with its group.'],
    [{ ids: ['loner', 'gone'], to: { group: 'cg-spare' } }, 400, 'An archived session cannot be moved.'],
    [{ ids: ['loner', 'gone'], to: { parent: 'peer' } }, 400, 'An archived session cannot be nested.'],
    [{ ids: ['loner', 'other'], to: { group: 'cg-gone' } }, 400, 'Unknown group.'],
    [{ ids: ['loner', 'other'], to: { parent: 'gone' } }, 400, 'That session is archived.'],
    [{ ids: ['loner', 'other'], to: { parent: 'run' } }, 400, 'A routine run cannot hold sessions.'],
    [{ ids: ['loner', 'other'], to: { parent: GROUP_CHAT } }, 400, 'A group\'s session cannot hold sessions.'],
    [{ ids: ['loner', 'other'], to: { parent: 'nobody' } }, 404, 'No session with that id on this Mac.'],
    [{ ids: ['loner', 'other'] }, 400, 'Where should they go?'],
    [{ ids: ['loner', 'other'], to: {} }, 400, 'Where should they go?'],
    [{ ids: ['loner', 'other'], to: { group: 5 } }, 400, 'Where should they go?'],
    [{ ids: ['loner', 'other'], to: { pinned: false } }, 400, 'Where should they go?'],
    [{ ids: ['loner', 'other'], to: { group: null, pinned: true } }, 400, 'Where should they go?'],
    [{ ids: ['loner', 'other'], to: 'cg-work' }, 400, 'Where should they go?'],
  ];
  for (const [json, status, error] of cases) {
    const res = await many(s, token, json);
    assert.deepEqual([res.status, res.body().error], [status, error], JSON.stringify(json));
  }
  const tooMany = await many(s, token, { ids: Array.from({ length: 101 }, (_, n) => `s${n}`), to: { group: null } });
  assert.deepEqual([tooMany.status, tooMany.body().error], [400, 'Pick at most 100 sessions.']);
  assert.equal(snapshot(s), before);
});

test('Undo puts every entry back exactly in one write, then is spent', async () => {
  const { s, token } = await ready({ layout: { parents: { other: null } } });
  const places = () => { const { parents, assignments, pinned } = onDisk(s); return { parents, assignments, pinned }; };
  const before = places();
  const { undo: first } = (await many(s, token, { ids: ['mid', 'pin', 'peer', 'other'], to: { group: 'cg-spare' } })).body();
  assert.notDeepEqual(places(), before);
  const res = await undo(s, token, { undo: first });
  assert.deepEqual([res.status, res.body()], [200, { count: 4 }]);
  assert.deepEqual(places(), before);
  const spent = await undo(s, token, { undo: first });
  assert.deepEqual([spent.status, spent.body().error], [404, 'There is nothing to undo.']);
});

test('Undo leaves what changed to other sessions since, and a nest is undone with the links it moved', async () => {
  const { s, token } = await ready();
  const { undo: nested } = (await many(s, token, { ids: ['mid'], to: { parent: 'loner' } })).body();
  assert.deepEqual([onDisk(s).parents.mid, onDisk(s).parents.leaf], ['loner', 'boss']);
  await many(s, token, { ids: ['other'], to: { pinned: true } });
  await undo(s, token, { undo: nested });
  assert.deepEqual([onDisk(s).parents.mid, onDisk(s).parents.leaf], [undefined, undefined]);
  assert.deepEqual(onDisk(s).pinned, ['pin', 'other']);
  assert.equal((await index(s, token)).pinned.some(r => r.id === 'other'), true);
});

test('an unknown, missing or odd Undo is a 404 and writes nothing', async () => {
  const { s, token } = await ready();
  const before = snapshot(s);
  for (const json of [{ undo: 'nope' }, {}, { undo: 5 }, { undo: null }]) {
    const res = await undo(s, token, json);
    assert.deepEqual([res.status, res.body().error], [404, 'There is nothing to undo.'], JSON.stringify(json));
  }
  assert.equal(snapshot(s), before);
});

test('Undo works for ten minutes and is refused after, with the sentence, nothing changed and the token spent', async () => {
  const skew = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'capcom-skew-')), 'ms');
  const { s, token } = await ready({ env: { NODE_OPTIONS: `--import=${pathToFileURL(path.join(import.meta.dirname, 'clock-skew.mjs'))}`, CAPCOM_SKEW_FILE: skew } });
  const late = (await many(s, token, { ids: ['loner'], to: { pinned: true } })).body().undo;
  const inTime = (await many(s, token, { ids: ['other'], to: { pinned: true } })).body().undo;
  fs.writeFileSync(skew, String(9 * 60_000));
  assert.equal((await undo(s, token, { undo: inTime })).status, 200);
  fs.writeFileSync(skew, String(11 * 60_000));
  const after = snapshot(s);
  const res = await undo(s, token, { undo: late });
  assert.deepEqual([res.status, res.body().error], [409, 'It is too late to undo that. Move the sessions back by hand.']);
  assert.equal(snapshot(s), after);
  assert.equal((await undo(s, token, { undo: late })).status, 404);
});

test('a restart drops the pending Undos', async () => {
  const { s, token } = await ready();
  const { undo: pending } = (await many(s, token, { ids: ['loner'], to: { pinned: true } })).body();
  const again = await restart(s);
  const fresh = await signIn(again);
  const res = await undo(again, fresh.token, { undo: pending });
  assert.equal(res.status, 404);
});

test('the routes need a sign-in, the same origin and a JSON body, and a GET to them is a 404', async () => {
  const { s, token } = await ready();
  const before = snapshot(s);
  const body = { ids: ['loner'], to: { pinned: true } };
  assert.equal((await request(s, 'POST', '/api/layout/many', { json: body })).status, 401);
  assert.equal((await request(s, 'POST', '/api/layout/many/undo', { json: { undo: 'x' } })).status, 401);
  assert.equal((await many(s, token, body, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(s, 'POST', '/api/layout/many', { headers: as(token), form: { ids: 'loner' } })).status, 400);
  assert.equal((await request(s, 'GET', '/api/layout/many', { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'GET', '/api/layout/many/undo', { headers: as(token) })).status, 404);
  assert.equal(snapshot(s), before);
});
