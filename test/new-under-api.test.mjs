// Run with `npm test`. Starting a session under a parent over HTTP against the real server, the stub keychain tool and the stub CLIs of test/harness.mjs:
// the parent's folder and account, the nesting, and the refusals that start nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serviceFor } from '../lib/accounts.mjs';
import { everyRow } from '../public/ui/tree.js';
import { as, cliCalls, request, restart, signIn, start, until } from './harness.mjs';

const CHAT = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const SESSIONS = [
  { id: 'boss', title: 'Boss', folder: 'work', ago: 3 },
  { id: 'kid', title: 'Kid', parent: 'boss', folder: 'work', ago: 2 },
  { id: 'gone', title: 'Archived', archived: true, ago: 5 },
  { id: 'run', title: 'Nightly', routine: 'nightly', ago: 6 },
  { id: CHAT, title: 'Talk about the work', source: 'cli', group: 'cg-work', ago: 1 },
  { id: 'held', title: 'In a pinned group', group: 'cg-pinned', folder: 'work', ago: 4 },
];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: CHAT }, { id: 'cg-pinned', name: 'Pinned' }];

async function open(layout = {}) {
  const first = await start({ claude: true, sessions: SESSIONS, groups: GROUPS, layout });
  const dir = path.join(first.state, 'accounts', 'second');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(first.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }, { id: 'second', name: 'Second', dir }] }));
  fs.writeFileSync(path.join(dir, 'auth-state.json'), JSON.stringify({ loggedIn: true, email: 'second@example.com', orgId: 'org-hidden-2', subscriptionType: 'pro' }));
  fs.writeFileSync(path.join(first.home, `keychain-expiry-${serviceFor(dir)}`), String(Date.now() + 20 * 86_400_000));
  const s = await restart(first);
  return { s, dir, ...(await signIn(s)) };
}

const post = (c, json, headers = { origin: c.s.origin }) => request(c.s, 'POST', '/api/new', { headers: { connection: 'close', ...as(c.token), ...headers }, json });
const started = c => cliCalls(c.s).filter(x => x.started);
const rowOf = async (c, id) => everyRow((await request(c.s, 'GET', '/api/sessions', { headers: as(c.token) })).body()).find(r => r.id === id);
const onDisk = c => JSON.parse(fs.readFileSync(c.s.layout, 'utf8'));

test('a session started under a parent works in the parent\'s folder whatever folder is sent, nests under it and runs on its pinned account from the first turn', async () => {
  const c = await open({ accounts: { boss: 'second' } });
  const made = await post(c, { cwd: c.s.home, text: 'begin a session', parent: 'boss' });
  assert.equal(made.status, 200, made.text);
  assert.deepEqual(Object.keys(made.body()), ['id']);
  await until(() => started(c).length === 1, 20_000);
  assert.deepEqual([started(c)[0].cwd, started(c)[0].configDir], [fs.realpathSync(path.join(c.s.home, 'work')), c.dir]);
  assert.equal(onDisk(c).parents[made.body().id], 'boss');
  assert.equal((await rowOf(c, made.body().id)).parent, 'boss');
});

test('a session started under a parent whose group is pinned runs on that account and stays out of the group', async () => {
  const c = await open();
  const pinned = await request(c.s, 'POST', '/api/layout/account', { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) }, json: { kind: 'group', id: 'cg-pinned', account: 'second' } });
  assert.equal(pinned.status, 200, pinned.text);
  const made = await post(c, { cwd: c.s.home, text: 'begin a session', parent: 'held' });
  assert.equal(made.status, 200, made.text);
  await until(() => started(c).length === 1, 20_000);
  assert.equal(started(c)[0].configDir, c.dir);
  assert.equal(onDisk(c).parents[made.body().id], 'held');
  assert.equal(onDisk(c).assignments?.[made.body().id], undefined);
});

test('a sub session named as the parent stands for its parent', async () => {
  const c = await open();
  const made = await post(c, { cwd: c.s.home, text: 'begin a session', parent: 'kid' });
  assert.equal(made.status, 200, made.text);
  assert.equal(onDisk(c).parents[made.body().id], 'boss');
});

test('an archived session, a routine run, a group\'s session, an unknown id and a parent that is not an id start nothing', async () => {
  const c = await open();
  const cases = [['gone', 400, /archived/], ['run', 400, /routine/], [CHAT, 400, /group's session cannot hold/], ['nobody', 404, /No session/], [5, 400, /which session/i], [{ id: 'boss' }, 400, /which session/i]];
  for (const [parent, status, error] of cases) {
    const res = await post(c, { cwd: c.s.home, text: 'begin a session', parent });
    assert.deepEqual([res.status, error.test(res.body().error)], [status, true], `${JSON.stringify(parent)}: ${res.text}`);
  }
  assert.equal(started(c).length, 0, 'no session started');
  assert.equal(Object.hasOwn(onDisk(c), 'parents') && Object.keys(onDisk(c).parents).length, false);
});

test('a parent that names an account needs an Origin header', async () => {
  const c = await open();
  assert.equal((await post(c, { cwd: c.s.home, text: 'begin a session', parent: 'boss' }, {})).status, 403);
  assert.equal(started(c).length, 0);
});

test('a layout that cannot be written still starts the session, and says it is not nested', async () => {
  const c = await open();
  fs.writeFileSync(c.s.layout, '{ not json');
  const made = await post(c, { cwd: c.s.home, text: 'begin a session', parent: 'boss' });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.body().notNested, true);
  await until(() => started(c).length === 1, 20_000);
});
