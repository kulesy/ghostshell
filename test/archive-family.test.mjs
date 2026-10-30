// Run with `npm test`. Archiving a session archives every session below it in one layout write, a chat running anywhere in the family is refused or stopped,
// and unarchiving brings back only the batch. Over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { as, cliCalls, request, signIn, start, until } from './harness.mjs';

// Boss holds Kid, Kid holds Grand, and Side is a second child of Boss. Old is a third child of Boss, which some tests archive on its own first.
const SESSIONS = [
  { id: 'boss', title: 'Boss', ago: 5 },
  { id: 'kid', title: 'Kid', parent: 'boss', ago: 4 },
  { id: 'grand', title: 'Grand', parent: 'kid', ago: 3 },
  { id: 'side', title: 'Side', parent: 'boss', ago: 2 },
  { id: 'old', title: 'Old', parent: 'boss', ago: 6 },
  { id: 'alone', title: 'Alone', ago: 7 },
];

const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const archived = async (s, token) => (await request(s, 'GET', '/api/archived', { headers: as(token) })).body().archived.map(r => r.id).sort();
const post = (s, token, json) => request(s, 'POST', '/api/layout/archive', { headers: as(token), json });
const send = (s, token, id, text) => request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text } });
const said = (s, text) => cliCalls(s).some(c => c.user === text);
const flat = ix => [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.started, ...ix.ungrouped, ...ix.other].flatMap(r => [r, ...(r.children ?? [])]);
const stateOf = async (s, token, id) => flat((await request(s, 'GET', '/api/sessions', { headers: as(token) })).body()).find(r => r.id === id)?.state;
const touched = s => cliCalls(s).filter(c => c.closed || c.control === 'interrupt' || c.response === 'deny');

async function ready(mine) {
  const s = await start({ sessions: SESSIONS, ...mine });
  return { s, ...(await signIn(s)) };
}

test('archiving a parent archives every session below it at any depth, answers how many, and records the batch in one write', async () => {
  const { s, token } = await ready({ layout: { archived: { old: new Date(Date.now() - 60_000).toISOString() } } });
  const res = await post(s, token, { id: 'boss', archived: true });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body(), { id: 'boss', group: null, pinned: false, archived: true, subs: 3 });
  assert.deepEqual(await archived(s, token), ['boss', 'grand', 'kid', 'old', 'side']);
  const disk = onDisk(s);
  assert.deepEqual(disk.archivedWith, { kid: 'boss', grand: 'boss', side: 'boss' });
  assert.equal(disk.archived.kid, disk.archived.boss, 'one time for the batch');
  assert.notEqual(disk.archived.old, disk.archived.boss, 'a session archived before keeps its time');
});

test('archiving a middle session takes the sessions under it and leaves its parent and siblings', async () => {
  const { s, token } = await ready();
  assert.equal((await post(s, token, { id: 'kid', archived: true })).body().subs, 1);
  assert.deepEqual(await archived(s, token), ['grand', 'kid']);
  assert.deepEqual(onDisk(s).archivedWith, { grand: 'kid' });
});

test('archiving a session with nothing below it answers no sub sessions', async () => {
  const { s, token } = await ready();
  assert.deepEqual((await post(s, token, { id: 'alone', archived: true })).body(), { id: 'alone', group: null, pinned: false, archived: true });
  assert.deepEqual(onDisk(s).archivedWith, {});
});

test('unarchiving the root brings back its batch and leaves a session that was archived on its own', async () => {
  const { s, token } = await ready({ layout: { archived: { old: new Date(Date.now() - 60_000).toISOString() } } });
  await post(s, token, { id: 'boss', archived: true });
  const res = await post(s, token, { id: 'boss', archived: false });
  assert.deepEqual(res.body(), { id: 'boss', group: null, pinned: false, archived: false, subs: 3 });
  assert.deepEqual(await archived(s, token), ['old']);
  assert.deepEqual(onDisk(s).archivedWith, {});
});

test('unarchiving a middle session brings back what is under it from the batch, and a child alone only itself', async () => {
  const { s, token } = await ready();
  await post(s, token, { id: 'boss', archived: true });
  assert.equal((await post(s, token, { id: 'kid', archived: false })).body().subs, 1);
  assert.deepEqual(await archived(s, token), ['boss', 'old', 'side']);
  assert.deepEqual((await post(s, token, { id: 'side', archived: false })).body().subs, undefined);
  assert.deepEqual(await archived(s, token), ['boss', 'old']);
  assert.deepEqual(onDisk(s).archivedWith, { old: 'boss' });
});

test('a message to an archived parent brings its batch back with it', async () => {
  const { s, token } = await ready({ claude: true });
  await post(s, token, { id: 'boss', archived: true });
  assert.equal((await send(s, token, 'boss', 'back again')).status, 200);
  await until(() => said(s, 'back again'));
  assert.deepEqual(await archived(s, token), []);
});

test('a chat running below the parent is refused with a 409 and a count when stop is false, and nothing is written', async () => {
  const { s, token } = await ready({ claude: true });
  await send(s, token, 'grand', 'keep going');
  await until(() => said(s, 'keep going'));
  assert.equal(await stateOf(s, token, 'grand'), 'working');
  const before = fs.readFileSync(s.layout, 'utf8');

  const refused = await post(s, token, { id: 'boss', archived: true, stop: false });
  assert.equal(refused.status, 409);
  assert.equal(refused.body().count, 1);
  assert.match(refused.body().error, /1 sessions? in that family/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.deepEqual(touched(s), []);
  assert.deepEqual(await archived(s, token), []);
});

test('the same request with stop true archives the whole family and stops every chat in it', async () => {
  const { s, token } = await ready({ claude: true });
  await send(s, token, 'grand', 'keep going');
  await until(() => said(s, 'keep going'));
  await send(s, token, 'side', 'also going');
  await until(() => said(s, 'also going'));

  const refused = await post(s, token, { id: 'boss', archived: true, stop: false });
  assert.equal(refused.body().count, 2);
  const res = await post(s, token, { id: 'boss', archived: true, stop: true });
  assert.deepEqual(res.body(), { id: 'boss', group: null, pinned: false, archived: true, stopped: true, stoppedCount: 2, subs: 4 });
  await until(() => cliCalls(s).filter(c => c.closed).length === 2);
  assert.equal(touched(s).filter(c => c.control === 'interrupt').length, 2);
  assert.deepEqual(await archived(s, token), ['boss', 'grand', 'kid', 'old', 'side']);
});
