// Run with `npm test`. A group's own session: kept out of every list, family, count and search, found by id, refused every edit, and
// listed with its group. Over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { everyRow } from '../public/ui/tree.js';
import { as, listen, request, restart, signIn, start, until } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const HOME = '7e49a2d1-5c36-4b80-a1f9-0d83c6e24b57';
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }, { id: 'cg-home', name: 'Home' }];
const SESSIONS = [
  { id: WORK, title: 'Talk about the work', source: 'cli', ago: 1, group: 'cg-work' },
  { id: 'a', title: 'Member A', group: 'cg-work', ago: 5 },
  { id: 'b', title: 'Member B', group: 'cg-work', ago: 6 },
  { id: 'old', title: 'Archived member', group: 'cg-work', archived: true, ago: 20 },
  { id: 'kid', title: 'Archived child', parent: 'a', archived: true, ago: 21 },
  { id: 'away', title: 'Archived at home', group: 'cg-home', archived: true, ago: 22 },
  { id: 'loose', title: 'Loose', ago: 7 },
];

const get = async (s, token, route) => (await request(s, 'GET', route, { headers: as(token) })).body();
const post = (s, token, route, json) => request(s, 'POST', route, { headers: as(token), json });
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));

async function ready(mine) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, ...mine });
  return { s, ...(await signIn(s)) };
}

test('a group\'s session is in no list, family, count, search or folder, even when the layout also puts it in the group, pins it or archives it', async () => {
  const { s, token } = await ready({ layout: { pinned: [WORK], archived: { [WORK]: '2026-10-01T00:00:00.000Z' }, parents: { [WORK]: 'a', b: WORK } } });
  const ix = await get(s, token, '/api/sessions?archived=1');
  assert.equal(everyRow(ix).some(r => r.id === WORK), false);
  assert.deepEqual(everyRow(ix).map(r => r.id).sort(), ['a', 'b', 'kid', 'loose', 'old', 'away'].sort());
  assert.deepEqual(ix.groups.find(g => g.id === 'cg-work').sessions.map(r => r.id), ['a', 'b', 'old'], 'a session linked to it is a member like any other');
  assert.equal((await get(s, token, '/api/archived')).archived.some(r => r.id === WORK), false);
  assert.equal(JSON.stringify(await get(s, token, '/api/folders')).includes(WORK), false);
  assert.equal(Object.hasOwn(ix, 'groupSessions'), false, 'the map the server keeps is not sent');
});

// The layout after its group was deleted: the chat is in `retired`, and the group is gone from `groups`.
const RETIRED = { id: 'cg-work', name: 'Work', session: WORK };
const afterDelete = mine => ready({ groups: [GROUPS[1]], layout: { retired: [RETIRED] }, ...mine });

test('a deleted group\'s session is in no list, family, count, search, archive or folder, however old its transcript is, and is found by id, and a restart changes none of it', async () => {
  const check = async ({ s, token }, ago) => {
    const ix = await get(s, token, '/api/sessions?archived=1');
    assert.deepEqual(everyRow(ix).map(r => r.id).sort(), ['a', 'b', 'kid', 'loose', 'old', 'away'].sort(), `${ago} minutes old`);
    assert.equal(JSON.stringify(ix).includes(WORK), false, 'it is in no group, count or search');
    assert.equal(JSON.stringify(await get(s, token, '/api/archived')).includes(WORK), false);
    const folders = JSON.stringify(await get(s, token, '/api/folders'));
    assert.deepEqual([folders.includes(WORK), folders.includes(path.join(s.state, 'groups'))], [false, false]);
    const talk = await get(s, token, `/api/sessions/${WORK}/messages`);
    assert.equal(talk.items.length, 1, 'its transcript is kept');
    assert.deepEqual([talk.session.title, talk.session.cwd], ['Work', path.join(s.state, 'groups', 'cg-work')]);
  };
  for (const ago of [1, 40 * 24 * 60]) {
    const first = await afterDelete({ sessions: SESSIONS.map(r => (r.id === WORK ? { ...r, ago } : r)) });
    await check(first, ago);
    const second = await restart(first.s);
    await check({ s: second, ...(await signIn(second)) }, ago);
  }
});

test('moving, pinning, renaming, archiving or nesting a deleted group\'s session, or nesting one under it, is refused and writes nothing', async () => {
  const { s, token } = await afterDelete();
  const before = fs.readFileSync(s.layout, 'utf8');
  const STAYS = 'A group\'s session stays with its group.';
  for (const [route, json, error] of [
    ['move', { id: WORK, group: 'cg-home' }, STAYS],
    ['pin', { id: WORK, pinned: true }, STAYS],
    ['rename', { id: WORK, title: 'Mine' }, STAYS],
    ['archive', { id: WORK, archived: true }, STAYS],
    ['archive', { id: WORK, archived: false }, STAYS],
    ['nest', { id: WORK, parent: 'loose' }, STAYS],
    ['nest', { id: 'loose', parent: WORK }, 'A group\'s session cannot hold sessions.'],
  ]) {
    const res = await post(s, token, `/api/layout/${route}`, json);
    assert.deepEqual([res.status, res.body()], [400, { error }], `${route} ${JSON.stringify(json)}`);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('the index tells each group its session and how many of its members are archived, and tells the page this server knows group sessions, sessions for the built-in sections, how to edit groups, how to edit routines, routines that run a prompt file, sub session status and pull request status', async () => {
  const { s, token } = await ready();
  const ix = await get(s, token, '/api/sessions');
  assert.deepEqual(ix.features, { groupSessions: true, sectionSessions: true, groupEdits: true, groupRename: true, routineEdits: true, routineFiles: true, subStatus: true, pullStatus: true });
  assert.deepEqual(ix.groups.map(g => [g.id, g.session, g.archived]), [['cg-work', { id: WORK, state: 'active' }, 2], ['cg-home', null, 1]]);
  assert.deepEqual((await get(s, token, '/api/sessions?archived=1')).groups.map(g => g.archived), [2, 1], 'the count is the same with the archive listed');
});

test('a group\'s session with no transcript yet is a row from the layout, in the group\'s own folder, and a layout with no sessions at all works as before', async () => {
  const { s, token } = await ready({ sessions: SESSIONS.slice(1) });
  const ix = await get(s, token, '/api/sessions');
  assert.deepEqual(ix.groups[0].session, { id: WORK, state: 'idle' });
  const reply = await get(s, token, `/api/sessions/${WORK}/messages`);
  assert.deepEqual(reply.items, []);
  assert.deepEqual(reply.session, { id: WORK, title: 'Work', cwd: path.join(s.state, 'groups', 'cg-work'), branch: '', source: 'capcom', routine: null, connectors: {} });
  assert.equal(fs.existsSync(path.join(s.state, 'groups')), false, 'looking at it makes no folder');

  const plain = await ready({ groups: GROUPS.map(({ session, ...g }) => g) });
  const bare = await get(plain.s, plain.token, '/api/sessions');
  assert.deepEqual(bare.groups.map(g => [g.id, g.session]), [['cg-work', null], ['cg-home', null]]);
  assert.deepEqual(bare.groups[0].sessions.map(r => r.id).sort(), ['a', 'b', WORK].sort(), 'without the link it is an ordinary member');
});

test('a group\'s session is found by id however old its transcript is, and an ordinary session that old is not', async () => {
  const old = 40 * 24 * 60;
  const { s, token } = await ready({ sessions: [{ id: WORK, title: 'Old talk', source: 'cli', ago: old }, { id: 'stale', title: 'Stale', source: 'cli', ago: old }] });
  const talk = await get(s, token, `/api/sessions/${WORK}/messages`);
  assert.equal(talk.items.length, 1);
  assert.equal(talk.session.title, 'Work');
  assert.equal((await get(s, token, '/api/sessions/stale/messages')).session, null);
});

test('moving, pinning, renaming, archiving or nesting a group\'s session, or nesting one under it, is refused and writes nothing', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  const STAYS = 'A group\'s session stays with its group.';
  for (const [route, json, status, error] of [
    ['move', { id: WORK, group: 'cg-home' }, 400, STAYS],
    ['move', { id: WORK, group: null }, 400, STAYS],
    ['pin', { id: WORK, pinned: true }, 400, STAYS],
    ['rename', { id: WORK, title: 'Mine' }, 400, STAYS],
    ['archive', { id: WORK, archived: true }, 400, STAYS],
    ['archive', { id: WORK, archived: false }, 400, STAYS],
    ['nest', { id: WORK, parent: 'loose' }, 400, STAYS],
    ['nest', { id: 'loose', parent: WORK }, 400, 'A group\'s session cannot hold sessions.'],
    ['move', { id: 'nobody', group: 'cg-home' }, 404, 'No session with that id on this Mac.'],
  ]) {
    const res = await post(s, token, `/api/layout/${route}`, json);
    assert.deepEqual([res.status, res.body()], [status, { error }], `${route} ${JSON.stringify(json)}`);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('a group\'s archived members are listed by the group, with its own session and other groups\' members left out', async () => {
  const { s, token } = await ready();
  const ids = async query => (await get(s, token, `/api/archived${query}`)).archived.map(r => r.id).sort();
  assert.deepEqual(await ids(''), ['away', 'kid', 'old']);
  assert.deepEqual(await ids('?group=cg-work'), ['kid', 'old'], 'an archived child counts with its holder\'s group');
  assert.deepEqual(await ids('?group=cg-home'), ['away']);
  assert.deepEqual(await ids('?group=cg-none'), []);
  assert.deepEqual(await ids('?group='), []);
});

test('a group that was deleted by hand leaves its session as an ordinary session in Terminal and other', async () => {
  const { s, token } = await ready({ groups: [{ id: 'cg-home', name: 'Home' }] });
  const ix = await get(s, token, '/api/sessions');
  assert.deepEqual(ix.other.map(r => r.id), [WORK]);
  assert.equal(ix.other[0].title, 'Talk about the work');
});

// Another viewer's look for transcripts fills the shared cache, so each of these runs alone on its own server.
async function transcriptAppears(id, mine) {
  const { s, token } = await ready({ sessions: [], ...mine });
  const viewer = listen(s, token, id);
  try {
    await until(() => viewer.events.length);
    const line = JSON.stringify({ type: 'user', cwd: s.home, message: { role: 'user', content: 'hello' } });
    fs.writeFileSync(path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`), `${line}\n`);
    await new Promise(done => setTimeout(done, 5500));
    return viewer.events.some(e => e.type === 'changed');
  } finally {
    viewer.close();
  }
}

test('a transcript that appears for a group\'s session is not looked for until a chat of ours exists', async () => {
  assert.equal(await transcriptAppears(WORK), false);
});

test('a transcript that appears for any other session is found by the page\'s stream', async () => {
  assert.equal(await transcriptAppears('late'), true);
});
