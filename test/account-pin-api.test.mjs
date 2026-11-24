// Run with `npm test`. Pinning work to a Claude account over HTTP against the real server, with the stub keychain tool and the stub CLIs of test/harness.mjs,
// so nothing here reads the real keychain, signs in for real or runs the real claude. See docs/adr/20261104-pin-work-to-an-account.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serviceFor } from '../lib/accounts.mjs';
import { localIso } from '../lib/routines.mjs';
import { as, cliCalls, listen, request, restart, signIn, start, until as waitFor } from './harness.mjs';

const DAY = 86_400_000;
const GROUPS = [{ id: 'cg-a', name: 'Work', project: 'cp-a' }, { id: 'cg-b', name: 'Loose' }];
const SESSIONS = [
  { id: 'live', title: 'Runs', source: 'cli', ago: 1 },
  { id: 'other', title: 'Another', source: 'cli', ago: 2 },
  { id: 'grouped', title: 'In a group', source: 'cli', ago: 3, group: 'cg-a' },
  { id: 'loosely', title: 'In the loose group', source: 'cli', ago: 4, group: 'cg-b' },
];

// A server with a second account, "Second" (id `second`), signed in with a folder of its own, a group inside a project, and sessions to pin.
async function open({ layout = {}, sessions = [], groups = GROUPS, chips } = {}) {
  const first = await start({ claude: true, sessions: [...SESSIONS, ...sessions], groups, chips, layout: { projects: [{ id: 'cp-a', name: 'Proj' }], ...layout } });
  const dir = path.join(first.state, 'accounts', 'second');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(first.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }, { id: 'second', name: 'Second', dir }] }));
  signedIn(first, dir);
  const s = await restart(first);
  const { token } = await signIn(s);
  const c = { s, token, dir };
  await until(async () => (await accountsOf(c)).accounts.every(a => a.signedOut || a.email));
  return c;
}

function signedIn(s, dir, on = true) {
  fs.writeFileSync(path.join(dir, 'auth-state.json'), JSON.stringify(on ? { loggedIn: true, email: 'second@example.com', orgId: 'org-hidden-2', subscriptionType: 'pro' } : { loggedIn: false }));
  fs.writeFileSync(path.join(s.home, `keychain-expiry-${serviceFor(dir)}`), String(on ? Date.now() + 20 * DAY : Date.now() - DAY));
}

const get = (c, url) => request(c.s, 'GET', url, { headers: as(c.token) });
const post = (c, url, json = {}, headers = { origin: c.s.origin }) => request(c.s, 'POST', url, { headers: Object.fromEntries(Object.entries({ connection: 'close', ...as(c.token), ...headers }).filter(([, v]) => v !== undefined)), json });
const accountsOf = async c => (await get(c, '/api/accounts')).body();
const pin = (c, kind, id, account) => post(c, '/api/layout/account', { kind, id, account });
const until = (check, ms = 20_000) => waitFor(check, ms);
const say = (c, id, text = 'finish the turn') => post(c, `/api/sessions/${id}/send`, { text });
const calls = c => cliCalls(c.s);
const startsOn = (c, dir) => calls(c).filter(x => x.started && x.configDir === dir).length;
const index = async c => (await get(c, '/api/sessions')).body();
const rowOf = async (c, id) => {
  const ix = await index(c);
  const all = [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.started, ...ix.ungrouped, ...ix.other, ...ix.routines.flatMap(r => [r.latest, ...r.earlier])];
  const find = list => list.flatMap(r => [r, ...(r.children ?? [])]).find(r => r.id === id);
  return find(all);
};
// The second account's sign-in is read when something asks for it, and a pin to it asks.
const signOutSecond = async c => {
  signedIn(c.s, c.dir, false);
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 409);
};

test('a session, a group and a project each take a pin and lose it on null, and the index and the accounts list show them', async () => {
  const c = await open();
  assert.equal((await index(c)).features.accountPins, true);
  assert.deepEqual((await pin(c, 'session', 'live', 'second')).body(), { kind: 'session', id: 'live', account: 'second' });
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  assert.equal((await pin(c, 'project', 'cp-a', 'second')).status, 200);
  const ix = await index(c);
  assert.equal(ix.groups.find(g => g.id === 'cg-b').account, 'second');
  assert.equal(ix.projects.find(p => p.id === 'cp-a').account, 'second');
  const live = await rowOf(c, 'live');
  assert.deepEqual([live.account, live.accountFrom, live.accountPin], ['second', 'session', 'second']);
  const grouped = await rowOf(c, 'grouped');
  assert.deepEqual([grouped.account, grouped.accountFrom, grouped.accountPin], ['second', 'project', undefined], 'a group with no pin of its own falls to its project');
  assert.equal((await rowOf(c, 'other')).account, 'main');
  const second = (await accountsOf(c)).accounts.find(a => a.id === 'second');
  assert.deepEqual(second.pinned, { sessions: 1, groups: 1, projects: 1, routines: 0 });

  for (const [kind, id] of [['session', 'live'], ['group', 'cg-b'], ['project', 'cp-a']]) assert.equal((await pin(c, kind, id, null)).status, 200);
  const cleared = await index(c);
  assert.equal(cleared.groups.find(g => g.id === 'cg-b').account, undefined);
  assert.equal(cleared.projects.find(p => p.id === 'cp-a').account, undefined);
  assert.equal(JSON.parse(fs.readFileSync(c.s.layout, 'utf8')).accounts && Object.keys(JSON.parse(fs.readFileSync(c.s.layout, 'utf8')).accounts).length, 0);
});

test('the pin route checks the origin, the sign-in, the kind, the id, the account and that the account is signed in, and writes nothing when it refuses', async () => {
  const c = await open();
  const body = { kind: 'session', id: 'live', account: 'second' };
  assert.equal((await post(c, '/api/layout/account', body, {})).status, 403, 'no Origin');
  assert.equal((await post(c, '/api/layout/account', body, { origin: 'http://elsewhere.test' })).status, 403);
  assert.equal((await request(c.s, 'POST', '/api/layout/account', { headers: { origin: c.s.origin }, json: body })).status, 401);
  assert.equal((await pin(c, 'routine', 'live', 'second')).status, 400);
  assert.equal((await pin(c, 'session', '../x', 'second')).status, 400);
  assert.equal((await pin(c, 'session', 'live', 7)).status, 400);
  assert.equal((await pin(c, 'session', 'nope', 'second')).status, 404, 'a session that is not there');
  assert.equal((await pin(c, 'group', 'cg-none', 'second')).status, 404);
  assert.equal((await pin(c, 'project', 'cp-none', 'second')).status, 404);
  assert.equal((await pin(c, 'session', 'live', 'gone')).status, 404, 'an account nobody lists');
  assert.deepEqual(JSON.parse(fs.readFileSync(c.s.layout, 'utf8')).accounts ?? {}, {});

  await signOutSecond(c);
  const refused = await pin(c, 'session', 'live', 'second');
  assert.deepEqual([refused.status, refused.body().error], [409, 'Second is signed out. Sign it in first.']);
  assert.deepEqual(JSON.parse(fs.readFileSync(c.s.layout, 'utf8')).accounts ?? {}, {});
});

test('a pinned session starts its process on the pinned account, the active account does not move it, and a clear moves it back', async () => {
  const c = await open();
  assert.equal((await pin(c, 'session', 'live', 'second')).status, 200);
  assert.equal((await say(c, 'live')).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal(startsOn(c, null), 0, 'the active account ran nothing');

  assert.equal((await post(c, '/api/accounts/second/use')).status, 200);
  assert.equal((await post(c, '/api/accounts/main/use')).status, 200);
  await new Promise(done => setTimeout(done, 700));
  assert.equal(calls(c).filter(x => x.closed).length, 0, 'switching accounts left the pinned chat running');

  assert.equal((await pin(c, 'session', 'live', null)).status, 200);
  await until(() => calls(c).filter(x => x.closed).length === 1);
  assert.equal((await say(c, 'live')).status, 200);
  await until(() => startsOn(c, null) === 1);
});

test('a session in a pinned group, and one in a group of a pinned project, start on that account, and the nearest pin wins', async () => {
  const c = await open();
  await pin(c, 'project', 'cp-a', 'second');
  assert.equal((await say(c, 'grouped')).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal((await rowOf(c, 'grouped')).accountFrom, 'project');

  await pin(c, 'group', 'cg-b', 'main');
  assert.equal((await say(c, 'loosely')).status, 200);
  await until(() => startsOn(c, null) === 1);
  assert.equal((await rowOf(c, 'loosely')).accountFrom, 'group');
});

// The fake CLI names every new session `begun-by-the-fake`, so a test starts one new session per server.
test('a new session takes the account it is started with and keeps it as its own pin, and an unknown account is refused', async () => {
  const c = await open();
  assert.equal((await post(c, '/api/new', { cwd: c.s.home, text: 'begin a session', account: 'gone' })).status, 400);
  assert.equal((await post(c, '/api/new', { cwd: c.s.home, text: 'begin a session', group: 'cg-none' })).status, 400);
  const made = await post(c, '/api/new', { cwd: c.s.home, text: 'begin a session', account: 'second' });
  assert.equal(made.status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal(startsOn(c, null), 0);
  assert.equal(JSON.parse(fs.readFileSync(c.s.layout, 'utf8')).accounts[made.body().id], 'second');
});

test('a session started in a pinned group runs on the group\'s account', async () => {
  const c = await open();
  await pin(c, 'group', 'cg-b', 'second');
  const made = await post(c, '/api/new', { cwd: c.s.home, text: 'begin a session', group: 'cg-b' });
  assert.equal(made.status, 200, made.text);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal(startsOn(c, null), 0);
});

test('a pinned account that signs out refuses the message with a 409 and the data, starts nothing, keeps the text out of the chat, and clearing the pin lets it run', async () => {
  const c = await open();
  await pin(c, 'session', 'live', 'second');
  await signOutSecond(c);
  const before = calls(c).length;
  const refused = await say(c, 'live', 'finish the turn');
  assert.equal(refused.status, 409);
  assert.match(refused.body().error, /is pinned to Second, which is signed out/);
  assert.deepEqual([refused.body().blocked.reason, refused.body().blocked.account, refused.body().blocked.from], ['signed-out', { id: 'second', name: 'Second' }, 'session']);
  assert.equal(calls(c).length, before, 'no process started and nothing was sent');
  const row = await rowOf(c, 'live');
  assert.equal(row.blocked.reason, 'signed-out');

  assert.equal((await pin(c, 'session', 'live', null)).status, 200, 'a pin clears while the account is signed out');
  assert.equal((await say(c, 'live')).status, 200);
  await until(() => calls(c).some(x => x.user === 'finish the turn'));
});

test('a group pinned to a signed out account refuses a new session started in it with a 409', async () => {
  const c = await open();
  await pin(c, 'group', 'cg-b', 'second');
  await signOutSecond(c);
  const before = calls(c).length;
  const refused = await post(c, '/api/new', { cwd: c.s.home, text: 'begin a session', group: 'cg-b' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body().blocked.from, 'group');
  assert.equal(calls(c).length, before);
});

test('a pin to an account that is removed blocks as removed and a clear still works', async () => {
  const c = await open({ layout: { accounts: { live: 'vanished' } } });
  const refused = await say(c, 'live');
  assert.equal(refused.status, 409);
  assert.deepEqual([refused.body().blocked.reason, refused.body().blocked.account], ['removed', null]);
  assert.equal((await pin(c, 'session', 'live', null)).status, 200);
});

const NEW_ROUTINE = { title: 'Morning check', cron: '30 7 * * 1-5', jitterSeconds: 0, prompt: 'Look at the board.', enabled: false };
const routineOf = async (c, id) => (await get(c, '/api/routines')).body().routines.find(r => r.id === id);

test('a routine pinned to an account runs on it, its account is checked on add and edit, and it shows in the list', async () => {
  const c = await open();
  const cwd = c.s.home;
  assert.equal((await post(c, '/api/routines', { ...NEW_ROUTINE, cwd, account: 'gone' })).status, 400);
  const bad = await post(c, '/api/routines', { ...NEW_ROUTINE, cwd, account: 'gone' });
  assert.deepEqual(Object.keys(bad.body().problems), ['account']);
  const added = await post(c, '/api/routines', { ...NEW_ROUTINE, cwd, account: 'second' });
  assert.equal(added.status, 200, added.text);
  const id = added.body().routine.id;
  assert.equal(added.body().routine.account, 'second');
  assert.equal((await post(c, `/api/routines/${id}/run`)).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal(startsOn(c, null), 0, 'the active account ran nothing');
  assert.equal((await routineOf(c, id)).lastError, null);
  assert.equal((await accountsOf(c)).accounts.find(a => a.id === 'second').pinned.routines, 1);
});

test('a routine whose account is signed out records the refusal, starts nothing, is not retried, cannot be switched on, and runs again once the account is back', async () => {
  const c = await open();
  const added = await post(c, '/api/routines', { ...NEW_ROUTINE, cwd: c.s.home, account: 'second' });
  const id = added.body().routine.id;
  await signOutSecond(c);
  const before = calls(c).length;
  const run = await post(c, `/api/routines/${id}/run`);
  assert.equal(run.status, 400, run.text);
  assert.match(run.body().error, /pinned to Second, which is signed out/);
  assert.equal(calls(c).length, before, 'nothing started');
  const routine = await routineOf(c, id);
  assert.match(routine.lastError, /pinned to Second, which is signed out/);
  assert.equal(routine.retry, null);
  assert.match(routine.problem, /Second/);
  const on = await post(c, `/api/routines/${id}/enabled`, { enabled: true });
  assert.equal(on.status, 400);
  assert.match(on.body().error, /Second/);

  signedIn(c.s, c.dir);
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 200);
  assert.equal((await post(c, `/api/routines/${id}/run`)).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
});

const WORK_CHAT = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const tool = async (c, id, name, args = {}) => {
  const before = calls(c).filter(x => x.mcp).length;
  assert.equal((await say(c, id, `call ${name} ${JSON.stringify(args)}`)).status, 200);
  await until(() => calls(c).filter(x => x.mcp).length > before);
  return calls(c).filter(x => x.mcp)[before].mcp.result.content[0].text;
};
const resumes = (c, id) => calls(c).filter(x => x.started?.includes('--resume') && x.started[x.started.indexOf('--resume') + 1] === id);

test('a group chat starts on its group\'s account, and a chip made by a pinned session starts its session beside it on that account', async () => {
  const c = await open({
    groups: [{ id: 'cg-a', name: 'Work', project: 'cp-a', session: WORK_CHAT }, GROUPS[1]],
    sessions: [{ id: 'maker', title: 'Maker', source: 'cli', ago: 5 }],
  });
  assert.equal((await pin(c, 'group', 'cg-a', 'second')).status, 200);
  assert.equal((await pin(c, 'session', 'maker', 'second')).status, 200);
  assert.equal((await say(c, WORK_CHAT, 'hello')).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal(startsOn(c, null), 0, 'nothing on the main account');

  const chip = await post(c, '/api/chips/start', { sessionId: 'maker', toolUseId: 'toolu_pin', title: 'Follow up', prompt: 'begin a session', cwd: c.s.home, confirmCwd: c.s.home });
  assert.equal(chip.status, 200, chip.text);
  await until(() => startsOn(c, c.dir) === 2);
  assert.equal(startsOn(c, null), 0);
  const made = await rowOf(c, chip.body().id);
  assert.deepEqual([made.account, made.accountFrom, made.accountPin], ['second', 'parent', undefined], 'it follows its maker and holds no pin of its own');
});

test('a sub session woken by its parent resumes on its own pinned account, and one pinned to a signed out account is refused in words and not started', async () => {
  const c = await open({
    sessions: [{ id: 'top', title: 'Top', source: 'cli', ago: 5 }, { id: 'kid', title: 'Kid', source: 'cli', ago: 6, parent: 'top' }, { id: 'kid2', title: 'Kid two', source: 'cli', ago: 7, parent: 'top' }],
  });
  assert.equal((await pin(c, 'session', 'kid', 'second')).status, 200);
  assert.equal((await pin(c, 'session', 'kid2', 'second')).status, 200);
  assert.match(await tool(c, 'top', 'send_session', { session_id: 'kid', message: 'Please rebase.' }), /^Delivered to /);
  await until(() => resumes(c, 'kid').length === 1);
  assert.equal(resumes(c, 'kid')[0].configDir, c.dir);

  signedIn(c.s, c.dir, false);
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 409, 'the refused pin refreshes the account\'s sign-in');
  assert.match(await tool(c, 'top', 'send_session', { session_id: 'kid2', message: 'And you.' }), /^Refused: that session's account is signed out or no longer listed\. Ask the owner to sort it out on the Accounts page\.$/);
  assert.equal(resumes(c, 'kid2').length, 0, 'nothing started for it');
});

const entry = c => ({ title: 'Look at the doc', at: localIso(Date.now() + DAY), cwd: c.s.home, prompt: 'Read the doc.', model: 'haiku', effort: 'high', mode: 'plan', group: 'cg-b' });

test('a scheduled session put in a pinned group starts on that group\'s account, and one whose group is pinned to a signed out account is refused and starts nothing', async () => {
  const c = await open();
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  const made = await post(c, '/api/scheduled', entry(c));
  assert.equal(made.status, 200, made.text);
  assert.equal((await post(c, `/api/scheduled/${made.body().scheduled.id}/start`)).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal(startsOn(c, null), 0);

  signedIn(c.s, c.dir, false);
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 409);
  const waiting = await post(c, '/api/scheduled', entry(c));
  assert.match(waiting.body().scheduled.problem, /Its group \(Loose\) is pinned to Second, which is signed out/);
  const refused = await post(c, `/api/scheduled/${waiting.body().scheduled.id}/start`);
  assert.equal(refused.status, 400, refused.text);
  assert.match(refused.body().error, /signed out/);
  assert.equal(startsOn(c, c.dir), 1, 'nothing more started');
});

const MOVE = 'move_session_to_group';
// What happened to a move a chat asked for: the card's words, or 'allowed' when the CLI was answered with no card.
async function moveAsk(c, caller, input, tool = MOVE) {
  const viewer = listen(c.s, c.token, caller);
  const answered = () => calls(c).filter(x => x.requestId === `perm-${tool}`).length;
  try {
    await until(() => viewer.events.length);
    const had = answered();
    assert.equal((await say(c, caller, `ask to use ${tool} ${JSON.stringify(input)}`)).status, 200);
    await until(() => viewer.events.some(e => e.type === 'approval') || answered() > had);
    return viewer.events.find(e => e.type === 'approval')?.data.summary ?? 'allowed';
  } finally {
    viewer.close();
  }
}

test('the card for moving a group into a project names the account its sessions will run on when the projects differ, and says nothing when the account stays the same', async () => {
  const c = await open({ sessions: [{ id: 'top', title: 'Top', ago: 5 }] });
  const ask = input => moveAsk(c, 'top', input, 'move_group_to_project');
  assert.equal(await ask({ group: 'Loose', project: 'Proj' }), 'move the group "Loose" [cg-b] to the project "Proj" [cp-a]', 'nothing is pinned');
  assert.equal((await pin(c, 'project', 'cp-a', 'second')).status, 200);
  assert.equal(await ask({ group: 'Loose', project: 'Proj' }), 'move the group "Loose" [cg-b] to the project "Proj" [cp-a], which runs its sessions on Second', 'into a pinned project');
  assert.equal(await ask({ group: 'Work' }), 'move the group "Work" [cg-a] to Home, which runs its sessions on the active account, now Main', 'out of a pinned project');
  assert.equal(await ask({ group: 'Work', project: 'Proj' }), 'move the group "Work" [cg-a] to the project "Proj" [cp-a]', 'already there, so the account is the same');
  assert.equal((await pin(c, 'group', 'cg-a', 'main')).status, 200);
  assert.equal(await ask({ group: 'Work' }), 'move the group "Work" [cg-a] to Home', 'a pin on the group itself holds');
});

test('a move inside the caller\'s tree that would change the session\'s account asks the owner and names the account, and one that leaves it the same goes with no card', async () => {
  const c = await open({ sessions: [{ id: 'top', title: 'Top', ago: 5 }, { id: 'kid', title: 'Kid', ago: 6, parent: 'top', group: 'cg-b' }, { id: 'solo', title: 'Solo', ago: 7 }] });
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  assert.equal(await moveAsk(c, 'top', { session_id: 'top', group: 'Work' }), 'move "Top" [top] to "Work" [cg-a], which runs it on the active account, now Main, and the 1 session under it can change account too', 'the session under it can follow');
  assert.equal(await moveAsk(c, 'solo', { session_id: 'solo', group: 'Work' }), 'move "Solo" [solo] to "Work" [cg-a]', 'main to main with nothing under it, so no account to name, but Work is in a project and Solo is on Home, so it asks');
  assert.equal(await moveAsk(c, 'top', { session_id: 'kid', group: 'Work' }), 'move "Kid" [kid] to "Work" [cg-a], which runs it on the active account, now Main', 'out of a pinned group');
  assert.equal(await moveAsk(c, 'kid', { session_id: 'kid', group: 'Loose' }), 'allowed', 'second to second');
  assert.equal(await moveAsk(c, 'solo', { session_id: 'solo', group: 'Loose' }), 'move "Solo" [solo] to "Loose" [cg-b], which runs it on Second', 'into a pinned group');
  assert.equal(await moveAsk(c, 'solo', { session_id: 'solo', group: 'Nowhere' }), 'move "Solo" [solo] to "Nowhere"', 'a group that is not there still asks, with no account to name');
});

test('a move that drops a pin on the active account\'s own id asks the owner, since a later switch would part them', async () => {
  const c = await open({ sessions: [{ id: 'held', title: 'Held', ago: 5, group: 'cg-b' }] });
  assert.equal((await pin(c, 'group', 'cg-b', 'main')).status, 200);
  assert.equal(await moveAsk(c, 'held', { session_id: 'held', group: 'Work' }), 'move "Held" [held] to "Work" [cg-a], which runs it on the active account, now Main');
});

test('a move of a nested session asks the owner when it relinks a session off that session\'s pin', async () => {
  const c = await open({ sessions: [{ id: 'head', title: 'Head', ago: 5 }, { id: 'mid', title: 'Mid', ago: 6, parent: 'head' }, { id: 'low', title: 'Low', ago: 7, parent: 'mid' }] });
  assert.equal((await pin(c, 'session', 'mid', 'second')).status, 200);
  assert.equal(await moveAsk(c, 'head', { session_id: 'mid', group: 'Work' }), 'move "Mid" [mid] to "Work" [cg-a], which runs it on Second, and the 1 session under it can change account too');
});

test('a row says the account its process runs on when its parent has dropped out of the list for age', async () => {
  const c = await open({
    sessions: [{ id: 'old', title: 'Old parent', source: 'cli', ago: 60 * 1440 }, { id: 'kid', title: 'Kid', ago: 5, parent: 'old' }],
    layout: { accounts: { old: 'second' } },
    chips: [{ sessionId: 'old', startedId: 'kid', status: 'started', title: 'Follow up' }],
  });
  assert.equal(await rowOf(c, 'old'), undefined, 'the parent is past otherDays and out of the list');
  const kid = await rowOf(c, 'kid');
  assert.deepEqual([kid.account, kid.accountFrom], ['second', 'parent']);
  assert.equal((await say(c, 'kid')).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal(startsOn(c, null), 0, 'the process runs where the row says');
});

test('a first message worded like a routine\'s does not hand a session Capcom started that routine\'s pin', async () => {
  const c = await open();
  const added = await post(c, '/api/routines', { ...NEW_ROUTINE, cwd: c.s.home, account: 'second' });
  const id = added.body().routine.id;
  const folder = path.join(c.s.home, '.claude', 'projects', '-test-folder');
  fs.writeFileSync(path.join(folder, 'trap.jsonl'), `${JSON.stringify({ type: 'user', cwd: c.s.home, message: { role: 'user', content: `<scheduled-task name="${id}">\nDo it.` } })}\n`);
  await until(async () => !!(await rowOf(c, 'trap')));
  fs.writeFileSync(path.join(c.s.state, 'started.json'), JSON.stringify([{ id: 'trap', cwd: c.s.home, at: Date.now(), title: 'Trap' }]));
  await until(async () => (await rowOf(c, 'trap')).source === 'capcom');
  assert.deepEqual([(await rowOf(c, 'trap')).account, (await rowOf(c, 'trap')).accountFrom], ['main', 'active']);
  assert.equal((await say(c, 'trap')).status, 200);
  await until(() => startsOn(c, null) === 1);
  assert.equal(startsOn(c, c.dir), 0);
});

test('a layout that cannot be read keeps the pins last read, so pinned work stays on its account', async () => {
  const c = await open();
  assert.equal((await pin(c, 'session', 'live', 'second')).status, 200);
  assert.equal((await rowOf(c, 'live')).account, 'second');
  fs.writeFileSync(c.s.layout, '{ not json');
  assert.equal((await say(c, 'live')).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal(startsOn(c, null), 0, 'the active account ran nothing');
});

test('a new session that names an account or a group needs an Origin header', async () => {
  const c = await open();
  for (const extra of [{ account: 'second' }, { group: 'cg-b' }]) {
    const refused = await post(c, '/api/new', { cwd: c.s.home, text: 'begin a session', ...extra }, {});
    assert.equal(refused.status, 403, refused.text);
  }
  assert.equal(calls(c).filter(x => x.started).length, 0, 'nothing started');
});

test('changing a routine\'s account stops its idle run on the old account', async () => {
  const c = await open();
  const added = await post(c, '/api/routines', { ...NEW_ROUTINE, cwd: c.s.home, account: 'second' });
  const id = added.body().routine.id;
  assert.equal((await post(c, `/api/routines/${id}/run`)).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  const run = (await routineOf(c, id)).lastSessionId;
  assert.equal((await say(c, run)).status, 200);
  const edited = await request(c.s, 'PATCH', `/api/routines/${id}`, { headers: { connection: 'close', ...as(c.token), origin: c.s.origin }, json: { account: null } });
  assert.equal(edited.status, 200, edited.text);
  await until(() => calls(c).filter(x => x.closed).length === 1);
});

test('a blocked row and a refused send carry the words the page shows', async () => {
  const c = await open();
  await pin(c, 'session', 'live', 'second');
  await signOutSecond(c);
  const refused = await say(c, 'live');
  assert.equal(refused.status, 409);
  const { blocked } = refused.body();
  assert.match(blocked.message, /Second/);
  assert.match((await rowOf(c, 'live')).blocked.message, /pinned to Second, which is signed out/);
});

test('a session the pin names keeps its accountPin when only one account is listed', async () => {
  const c = await open();
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 200);
  fs.writeFileSync(path.join(c.s.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }] }));
  const lone = { ...c, s: await restart(c.s) };
  lone.token = (await signIn(lone.s)).token;
  assert.equal((await accountsOf(lone)).accounts.length, 1);
  assert.equal((await rowOf(lone, 'other')).accountPin, 'second');
});

test('a blocked row names the session, group or project that holds the pin, also for a session nested under it', async () => {
  const c = await open({ sessions: [{ id: 'top', title: 'Top', source: 'cli', ago: 5 }, { id: 'kid', title: 'Kid', source: 'cli', ago: 6 }], chips: [{ sessionId: 'top', startedId: 'kid', status: 'started', title: 'Follow up' }] });
  await pin(c, 'session', 'top', 'second');
  await pin(c, 'project', 'cp-a', 'second');
  await signOutSecond(c);
  assert.deepEqual((await rowOf(c, 'top')).blocked.pin, { kind: 'session', id: 'top' });
  const kid = (await rowOf(c, 'kid')).blocked;
  assert.deepEqual([kid.from, kid.pin], ['parent', { kind: 'session', id: 'top' }]);
  assert.deepEqual((await rowOf(c, 'grouped')).blocked.pin, { kind: 'project', id: 'cp-a' });
  const refused = await say(c, 'kid');
  assert.deepEqual(refused.body().blocked.pin, { kind: 'session', id: 'top' });
});

test('a group\'s own chat carries its account and block on the index, and a session nested under a group pin names the group', async () => {
  const c = await open({
    groups: [{ id: 'cg-a', name: 'Work', project: 'cp-a', session: WORK_CHAT }, GROUPS[1]],
    chips: [{ sessionId: 'grouped', startedId: 'nested', status: 'started', title: 'Follow up' }],
    sessions: [{ id: 'nested', title: 'Nested', source: 'cli', ago: 5 }],
  });
  await pin(c, 'group', 'cg-a', 'second');
  await signOutSecond(c);
  const chat = (await index(c)).groups.find(g => g.id === 'cg-a').session;
  assert.deepEqual([chat.account, chat.accountFrom, chat.blocked.reason, chat.blocked.pin], ['second', 'group', 'signed-out', { kind: 'group', id: 'cg-a' }]);
  assert.match(chat.blocked.message, /^Its group \(Work\) is pinned to Second/);
  const nested = (await rowOf(c, 'nested')).blocked;
  assert.deepEqual([nested.from, nested.pin, nested.fromName], ['parent', { kind: 'group', id: 'cg-a' }, 'Work']);
  assert.match(nested.message, /^The group of the session it sits under \(Work\) is pinned to Second/);
});

const layoutOf = c => JSON.parse(fs.readFileSync(c.s.layout, 'utf8'));
const weeklyFull = () => ({ kind: 'weekly_all', group: 'weekly', percent: 100, severity: 'critical', resets_at: new Date(Date.now() + 3 * DAY).toISOString(), scope: null, is_active: true });
const pinTo = (c, kind, id, account, overflow) => post(c, '/api/layout/account', { kind, id, account, overflow });
const continues = c => calls(c).filter(x => x.user === 'Continue.').length;
const settled = ms => new Promise(done => setTimeout(done, ms));

test('the pin route sets, keeps, replaces and clears an overflow, and refuses one equal to the pin, unknown or signed out', async () => {
  const c = await open();
  assert.deepEqual((await pinTo(c, 'session', 'live', 'main', 'second')).body(), { kind: 'session', id: 'live', account: 'main', overflow: 'second' });
  assert.equal((await pinTo(c, 'group', 'cg-b', 'main', 'second')).status, 200);
  assert.equal((await pinTo(c, 'project', 'cp-a', 'main', 'second')).status, 200);
  assert.deepEqual(layoutOf(c).overflow, { live: 'second' });
  const ix = await index(c);
  assert.equal(ix.groups.find(g => g.id === 'cg-b').overflow, 'second');
  assert.equal(ix.projects.find(p => p.id === 'cp-a').overflow, 'second');
  assert.deepEqual((await rowOf(c, 'live')).accountOverflow, 'second');

  assert.equal((await pin(c, 'session', 'live', 'main')).status, 200);
  assert.equal(layoutOf(c).overflow.live, 'second', 'a body without overflow keeps it');
  assert.equal((await pinTo(c, 'session', 'live', 'main', 'main')).status, 400, 'equal to the pin');
  assert.equal((await pinTo(c, 'session', 'live', 'main', 7)).status, 400);
  assert.equal((await pinTo(c, 'session', 'live', 'main', 'gone')).status, 404);
  assert.equal(layoutOf(c).overflow.live, 'second', 'nothing was written');

  assert.equal((await pinTo(c, 'session', 'live', 'main', null)).status, 200);
  assert.equal(layoutOf(c).overflow?.live, undefined);
  assert.equal((await rowOf(c, 'live')).accountOverflow, undefined);

  await pinTo(c, 'session', 'live', 'main', 'second');
  assert.equal((await pinTo(c, 'session', 'live', 'second')).status, 200);
  assert.equal(layoutOf(c).overflow?.live, undefined, 'a pin changed to the overflow drops it');
  await pinTo(c, 'session', 'live', 'main', 'second');
  assert.equal((await pinTo(c, 'session', 'live', null, 'second')).status, 200);
  assert.equal(layoutOf(c).overflow?.live, undefined, 'clearing the pin clears it');
  assert.equal(layoutOf(c).accounts.live, undefined);

  await signOutSecond(c);
  const refused = await pinTo(c, 'session', 'other', 'main', 'second');
  assert.deepEqual([refused.status, refused.body().error], [409, 'Second is signed out. Sign it in first.']);
  assert.equal(layoutOf(c).overflow?.other, undefined);
});

test('a pin with no overflow, and a single pinned row, gain no fields', async () => {
  const c = await open();
  await pin(c, 'session', 'live', 'main');
  const live = await rowOf(c, 'live');
  assert.deepEqual([live.accountSpill, live.accountOverflow], [undefined, undefined]);
  assert.ok(!('overflow' in (await index(c)).groups.find(g => g.id === 'cg-b')));
  const f = layoutOf(c);
  assert.ok(!('overflow' in f));
});

test('a turn that runs out on the pinned account carries on by itself on the overflow, with the mark lasting to the reset, and a session that finds the overflow out too stays put', async () => {
  const c = await open();
  fs.writeFileSync(path.join(c.s.home, 'plan-usage.json'), JSON.stringify([weeklyFull()]));
  const reset = Date.parse(weeklyFull().resets_at);
  await pinTo(c, 'session', 'live', 'main', 'second');
  await say(c, 'live', 'finish the turn');
  await until(() => startsOn(c, null) === 1);

  await say(c, 'live', 'hit the usage limit');
  await until(() => continues(c) === 1);
  await until(() => startsOn(c, c.dir) === 1);
  const main = (await accountsOf(c)).accounts.find(a => a.id === 'main');
  assert.ok(Math.abs(main.out.until - reset) < 2000, 'the mark runs to the reset the plan gave');
  assert.ok(calls(c).some(x => x.control === 'get_usage'), 'the chat that ran out was asked');
  const live = await rowOf(c, 'live');
  assert.deepEqual([live.account, live.accountSpill, live.accountFrom, live.accountPin, live.accountOverflow], ['second', 'main', 'session', 'main', 'second']);
  assert.equal(live.blocked, undefined);

  // Second runs out as well: the session resolves back to its pin, which is out too, and nothing is sent.
  await say(c, 'live', 'hit the usage limit');
  await until(async () => (await accountsOf(c)).accounts.find(a => a.id === 'second').out);
  await settled(700);
  assert.equal(continues(c), 1, 'no second spill message reached the CLI');
  assert.equal(startsOn(c, null), 1, 'no ping-pong back to the pinned account');
  const stuck = await rowOf(c, 'live');
  assert.deepEqual([stuck.account, stuck.accountSpill], ['main', undefined]);
});

test('a message sent while the plan figures are awaited moves the chat itself, so no Continue. follows when its turn ends', async () => {
  const c = await open();
  fs.writeFileSync(path.join(c.s.home, 'plan-usage.json'), JSON.stringify([weeklyFull()]));
  await pinTo(c, 'session', 'live', 'main', 'second');
  await say(c, 'live', 'finish the turn');
  await until(() => startsOn(c, null) === 1);

  fs.writeFileSync(path.join(c.s.home, 'plan-usage-wait'), '60000');
  await say(c, 'live', 'hit the usage limit');
  await until(() => calls(c).some(x => x.control === 'get_usage'));
  await say(c, 'live', 'finish the turn');
  await until(() => startsOn(c, c.dir) === 1);
  // The old process is stopped by the send and never answers, so the wait ends at the 10 second limit on the request.
  await settled(10_500);
  assert.equal(continues(c), 0, 'the wait ended on a chat that had moved already');
});

test('a session in a pinned group spills with its group\'s overflow, a chat that is waiting on an approval is left running, and a session with no overflow stays where it is', async () => {
  const c = await open({ sessions: [{ id: 'busy', title: 'Busy', source: 'cli', ago: 5, group: 'cg-b' }, { id: 'plain', title: 'Plain', source: 'cli', ago: 6 }] });
  await pinTo(c, 'group', 'cg-b', 'main', 'second');
  await say(c, 'busy', 'ask for approval');
  await until(async () => (await rowOf(c, 'busy')).state === 'waiting');
  await say(c, 'loosely', 'finish the turn');
  await until(() => startsOn(c, null) === 2);

  await say(c, 'loosely', 'hit the usage limit');
  await until(() => continues(c) === 1);
  await until(() => startsOn(c, c.dir) === 1);
  const loosely = await rowOf(c, 'loosely');
  assert.deepEqual([loosely.account, loosely.accountSpill, loosely.accountFrom, loosely.accountPin, loosely.accountOverflow], ['second', 'main', 'group', undefined, undefined]);
  assert.equal(calls(c).filter(x => x.closed).length, 1, 'only the chat that ran out was stopped, and the one waiting on an approval ran on');
  assert.equal((await rowOf(c, 'busy')).state, 'waiting');

  await say(c, 'plain', 'finish the turn');
  await say(c, 'plain', 'hit the usage limit');
  await until(async () => (await accountsOf(c)).accounts.find(a => a.id === 'main').out);
  const before = continues(c);
  await settled(500);
  assert.equal(continues(c), before);
  const plain = await rowOf(c, 'plain');
  assert.deepEqual([plain.account, plain.accountSpill], ['main', undefined]);
});

test('a pin to a signed out account still blocks when it has an overflow, and does not spill', async () => {
  const c = await open();
  await pinTo(c, 'session', 'live', 'second', 'main');
  await say(c, 'live', 'finish the turn');
  await until(() => startsOn(c, c.dir) === 1);
  await say(c, 'live', 'hit the usage limit');
  await until(() => continues(c) === 1);
  await until(() => startsOn(c, null) === 1);
  assert.deepEqual([(await rowOf(c, 'live')).account, (await rowOf(c, 'live')).accountSpill], ['main', 'second']);
  await say(c, 'live', 'finish the turn');
  await until(async () => (await rowOf(c, 'live')).state === 'idle');

  signedIn(c.s, c.dir, false);
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 409, 'the check of Second finds it signed out');
  const blocked = await rowOf(c, 'live');
  assert.equal(blocked.blocked?.reason, 'signed-out');
  assert.deepEqual([blocked.account, blocked.accountSpill], ['second', undefined], 'a signed out pin blocks and does not spill');
  const refused = await say(c, 'live', 'finish the turn');
  assert.equal(refused.status, 409);
  assert.match(refused.body().error, /is pinned to Second, which is signed out/);
});

test('a move that gains or drops an overflow asks the owner and names it', async () => {
  const c = await open({ sessions: [{ id: 'solo', title: 'Solo', ago: 7, group: 'cg-b' }, { id: 'plain', title: 'Plain', ago: 8, group: 'cg-a' }] });
  await pinTo(c, 'group', 'cg-b', 'second', 'main');
  await pin(c, 'group', 'cg-a', 'second');
  assert.equal(await moveAsk(c, 'plain', { session_id: 'plain', group: 'Loose' }), 'move "Plain" [plain] to "Loose" [cg-b], which runs it on Second, with Main taking over while that account is out of usage', 'a move that gains one');
  assert.equal(await moveAsk(c, 'solo', { session_id: 'solo', group: 'Work' }), 'move "Solo" [solo] to "Work" [cg-a], which runs it on Second, with no overflow account', 'a move that drops one');
  await pin(c, 'session', 'solo', 'second');
  assert.equal(await moveAsk(c, 'solo', { session_id: 'solo', group: 'Work' }), 'move "Solo" [solo] to "Work" [cg-a]', 'its own pin decides the account, so none is named, but the move changes project, so it asks');
});

// ---- a chip's account --------------------------------------------------------------------------------------------------

const SECTION_CHAT = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c2';
const MAKER = { id: 'maker', title: 'Maker', source: 'cli', ago: 5, group: 'cg-b' };
const OPEN = { sessionId: 'maker', prompt: 'begin a session', title: 'Follow up' };
const startChip = (c, toolUseId, json = {}, headers) => post(c, '/api/chips/start', { sessionId: 'maker', toolUseId, title: 'Follow up', prompt: 'begin a session', cwd: c.s.home, confirmCwd: c.s.home, ...json }, headers);
const chipsOf = async (c, id = 'maker') => (await get(c, `/api/sessions/${id}/chips`)).body();
const cardOf = async (c, toolUseId, id) => (await chipsOf(c, id)).chips.find(x => x.toolUseId === toolUseId);
const chipOpen = async (c, toolUseId) => (await cardOf(c, toolUseId))?.status === 'open';

test('an open chip\'s card names the account its place gives and who holds the pin, with ids and names only, and a station with one account sends none', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a' }] });
  assert.deepEqual((await cardOf(c, 'toolu_a')).accountCard.account, 'main');
  assert.equal((await cardOf(c, 'toolu_a')).accountCard.from, 'active');
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  const card = (await cardOf(c, 'toolu_a')).accountCard;
  assert.deepEqual([card.account, card.from, card.fromName], ['second', 'group', 'Loose']);
  assert.deepEqual(card.choices, { main: { account: 'main' }, second: { account: 'second' } });
  const body = JSON.stringify(await chipsOf(c));
  assert.doesNotMatch(body, /second@example|org-hidden|token|email/i, 'no email, org or token');
  const none = await chipsOf(c, 'loosely');
  assert.deepEqual(none.chips, []);
  assert.deepEqual(none.accountDefault.account, 'second', 'a card with no stored chip gets the default for the session it was made in');
  assert.equal((await chipsOf(c, 'live')).accountDefault.account, 'main');

  fs.writeFileSync(path.join(c.s.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }] }));
  const lone = await restart(c.s);
  const one = { s: lone, ...(await signIn(lone)) };
  const single = await chipsOf(one);
  assert.equal(JSON.stringify(single).includes('accountCard'), false);
  assert.equal(JSON.stringify(single).includes('accountDefault'), false);
});

test('a chip with no account follows the pins and is not pinned itself, so it keeps what its place gives it later', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a' }, { ...OPEN, toolUseId: 'toolu_b' }] });
  assert.equal((await pinTo(c, 'group', 'cg-b', 'second', 'main')).status, 200);
  const res = await startChip(c, 'toolu_a', { account: null, confirmAccount: 'second' });
  assert.equal(res.status, 200, res.text);
  await until(() => startsOn(c, c.dir) === 1);
  const made = await rowOf(c, res.body().id);
  assert.deepEqual([made.account, made.accountPin, made.accountOverflow], ['second', undefined, undefined], 'on the group\'s account, holding no pin of its own');
  assert.equal(layoutOf(c).accounts?.[res.body().id], undefined);
  assert.equal((await pin(c, 'group', 'cg-b', 'main')).status, 200);
  assert.equal((await rowOf(c, res.body().id)).account, 'main', 'it follows the group when the pin moves');

  assert.equal((await pin(c, 'group', 'cg-b', null)).status, 200);
  const plain = await startChip(c, 'toolu_b', { account: null, confirmAccount: 'main' });
  assert.equal(plain.status, 200, plain.text);
  await until(() => startsOn(c, null) === 1);
});

test('a chip that names an account starts its session pinned to the one the card posted, and only that one', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a', account: 'second' }, { ...OPEN, toolUseId: 'toolu_b', account: 'second' }] });
  const card = await cardOf(c, 'toolu_a');
  assert.equal(card.account, 'second', 'the stored account reaches the card');
  const res = await startChip(c, 'toolu_a', { account: 'second', confirmAccount: 'second' });
  assert.equal(res.status, 200, res.text);
  await until(() => startsOn(c, c.dir) === 1);
  const made = await rowOf(c, res.body().id);
  assert.deepEqual([made.account, made.accountPin, made.accountFrom], ['second', 'second', 'session']);
  assert.equal(JSON.stringify(res.body()).includes('"account"'), true, 'the owner\'s own reply keeps the chip as stored');

  // The owner chose to follow the pins on the card, so the chip's own account is not used.
  const followed = await startChip(c, 'toolu_b', { account: null, confirmAccount: 'main' });
  assert.equal(followed.status, 200, followed.text);
  await until(() => startsOn(c, null) === 1);
  assert.equal(startsOn(c, c.dir), 1, 'the second start did not use the chip\'s account');
});

test('a chip that names an account is refused when the page posts no account, and a chip the owner picked an account for needs it confirmed', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a', account: 'second' }, { ...OPEN, toolUseId: 'toolu_b' }] });
  const before = calls(c).length;
  const old = await startChip(c, 'toolu_a');
  assert.equal(old.status, 400, old.text);
  assert.match(old.body().error, /Check it on the card/);
  assert.equal(old.body().chip.status, 'open');
  assert.equal(calls(c).length, before, 'nothing started');
  assert.equal(await chipOpen(c, 'toolu_a'), true);

  for (const json of [{ account: 'second' }, { account: 'second', confirmAccount: 5 }, { account: 5, confirmAccount: 'second' }, { account: 'nobody', confirmAccount: 'nobody' }, { account: ['second'], confirmAccount: 'second' }]) {
    const res = await startChip(c, 'toolu_b', json);
    assert.equal(res.status, 400, JSON.stringify(json));
  }
  assert.equal(calls(c).length, before, 'nothing started');
  const unknown = await startChip(c, 'toolu_b', { account: 'nobody', confirmAccount: 'nobody' });
  assert.doesNotMatch(unknown.body().error, /Main|Second|main|second/, 'a refusal names no account');
});

test('a confirmation that does not match where the session would start is refused with the fresh card, and nothing starts', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a' }] });
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  const before = calls(c).length;
  const stale = await startChip(c, 'toolu_a', { account: null, confirmAccount: 'main' });
  assert.equal(stale.status, 409, stale.text);
  assert.match(stale.body().error, /has changed since the card was drawn/);
  assert.equal(stale.body().chip.accountCard.account, 'second', 'the reply carries the card as it is now');
  assert.equal(calls(c).length, before);
  const other = await startChip(c, 'toolu_a', { account: 'main', confirmAccount: 'second' });
  assert.equal(other.status, 409, 'a pick the card did not confirm');
  assert.equal(calls(c).length, before);
  assert.equal(await chipOpen(c, 'toolu_a'), true);
});

test('a chip is refused and starts nothing when its account is signed out, active or not, or no longer listed', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a', account: 'second' }] });
  signedIn(c.s, c.dir, false);
  const before = calls(c).length;
  const out = await startChip(c, 'toolu_a', { account: 'second', confirmAccount: 'second' });
  assert.equal(out.status, 409, out.text);
  assert.match(out.body().error, /Second.*signed out/);
  assert.equal(calls(c).length, before);

  signedIn(c.s, c.dir);
  assert.equal((await post(c, '/api/accounts/second/use')).status, 200);
  signedIn(c.s, c.dir, false);
  const active = await startChip(c, 'toolu_a', { account: null, confirmAccount: 'second' });
  assert.equal(active.status, 409, 'the active account is held to the same check');
  assert.match(active.body().error, /signed out/);
  assert.equal(calls(c).length, before);

  signedIn(c.s, c.dir);
  fs.writeFileSync(path.join(c.s.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }, { id: 'third', name: 'Third', dir: path.join(c.s.state, 'accounts', 'third') }] }));
  const gone = await restart(c.s);
  const d = { s: gone, ...(await signIn(gone)) };
  const removed = await startChip(d, 'toolu_a', { account: 'second', confirmAccount: 'second' });
  assert.equal(removed.status, 400, 'an account that is not listed cannot be posted');
  assert.equal(startsOn(d, c.dir), 0);
});

test('a pin to an account that is signed out stops the chip, and a pick of another account on the card gets past it', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a' }] });
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  await signOutSecond(c);
  const before = calls(c).length;
  const refused = await startChip(c, 'toolu_a', { account: null, confirmAccount: 'second' });
  assert.equal(refused.status, 409, refused.text);
  assert.equal(calls(c).length, before);
  const picked = await startChip(c, 'toolu_a', { account: 'main', confirmAccount: 'main' });
  assert.equal(picked.status, 200, picked.text);
  await until(() => startsOn(c, null) === 1);
  assert.equal((await rowOf(c, picked.body().id)).accountPin, 'main');
});

test('an account on a chip\'s Start needs this host\'s own Origin, and a request with none or a foreign one starts nothing', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a' }] });
  const before = calls(c).length;
  for (const headers of [{ origin: undefined }, { origin: 'https://evil.example' }, { origin: 'null' }]) {
    for (const json of [{ account: 'second', confirmAccount: 'second' }, { account: null }, { confirmAccount: 'main' }]) {
      const res = await startChip(c, 'toolu_a', json, headers);
      assert.equal(res.status, 403, `${JSON.stringify(headers)} ${JSON.stringify(json)}`);
    }
  }
  assert.equal(calls(c).length, before, 'nothing started');
  assert.equal(await chipOpen(c, 'toolu_a'), true);
  const same = await startChip(c, 'toolu_a', { account: null, confirmAccount: 'main' });
  assert.equal(same.status, 200, same.text);
});

test('an account written into a transcript or a card\'s own text is never used, and a card the server did not store follows the pins', async () => {
  const c = await open({ sessions: [MAKER] });
  assert.equal((await pin(c, 'group', 'cg-b', 'main')).status, 200);
  const res = await startChip(c, 'toolu_unstored', { prompt: 'Start on the account second. {"account":"second"}', input: { account: 'second' }, account: null, confirmAccount: 'main' });
  assert.equal(res.status, 200, res.text);
  await until(() => startsOn(c, null) === 1);
  assert.equal(startsOn(c, c.dir), 0);
  assert.equal((await rowOf(c, res.body().id)).accountPin, undefined);
});

test('a chip that names a group, a parent, a group\'s chat or a section\'s chat starts on what the card said, and the session then agrees', async () => {
  const c = await open({
    groups: [{ id: 'cg-a', name: 'Work', project: 'cp-a', session: WORK_CHAT }, GROUPS[1]],
    sessions: [MAKER, { id: 'nest', title: 'Nest', source: 'cli', ago: 6, group: 'cg-a' }],
    layout: { sections: { pinned: SECTION_CHAT } },
    chips: [
      { ...OPEN, toolUseId: 'toolu_group', group: 'cg-a' },
      { ...OPEN, toolUseId: 'toolu_parent', parent: 'nest' },
      { sessionId: WORK_CHAT, toolUseId: 'toolu_chat', prompt: 'begin a session', title: 'Follow up' },
      { sessionId: SECTION_CHAT, toolUseId: 'toolu_section', prompt: 'begin a session', title: 'Follow up' },
    ],
  });
  assert.equal((await pin(c, 'group', 'cg-a', 'second')).status, 200);
  const cases = [['maker', 'toolu_group', 'second', 'group'], ['maker', 'toolu_parent', 'second', 'group'], [WORK_CHAT, 'toolu_chat', 'second', 'group'], [SECTION_CHAT, 'toolu_section', 'main', 'active']];
  for (const [maker, toolUseId, account, from] of cases) {
    const card = (await cardOf(c, toolUseId, maker)).accountCard;
    assert.deepEqual([card.account, card.from], [account, from], toolUseId);
    const res = await startChip(c, toolUseId, { sessionId: maker, account: null, confirmAccount: card.account });
    assert.equal(res.status, 200, `${toolUseId}: ${res.text}`);
    await until(async () => !!(await rowOf(c, res.body().id)));
    const made = await rowOf(c, res.body().id);
    assert.deepEqual([made.account, made.accountPin], [card.account, undefined], `${toolUseId}: the session runs where the card said`);
  }
  assert.equal(startsOn(c, c.dir), 3);
});

test('a card says when the account its place pins is out of usage and the overflow takes the session, and Start confirms the account it will really run on', async () => {
  const c = await open({ sessions: [MAKER, { id: 'busy', title: 'Busy', source: 'cli', ago: 7, group: 'cg-b' }], chips: [{ ...OPEN, toolUseId: 'toolu_a' }, { ...OPEN, toolUseId: 'toolu_b', account: 'main' }] });
  fs.writeFileSync(path.join(c.s.home, 'plan-usage.json'), JSON.stringify([weeklyFull()]));
  assert.equal((await pinTo(c, 'group', 'cg-b', 'main', 'second')).status, 200);
  await say(c, 'loosely', 'finish the turn');
  await until(() => startsOn(c, null) === 1);
  await say(c, 'loosely', 'hit the usage limit');
  await until(() => continues(c) === 1);
  const card = (await cardOf(c, 'toolu_a')).accountCard;
  assert.deepEqual([card.account, card.spill, card.overflow], ['second', 'main', 'second']);
  assert.equal(card.choices.main.account, 'second', 'a chip that names the pinned account spills too');
  assert.equal(card.choices.main.spill, 'main');

  const wrong = await startChip(c, 'toolu_b', { account: 'main', confirmAccount: 'main' });
  assert.equal(wrong.status, 409, 'confirming the pinned account that the session would leave');
  const res = await startChip(c, 'toolu_a', { account: null, confirmAccount: 'second' });
  assert.equal(res.status, 200, res.text);
  await until(() => startsOn(c, c.dir) >= 1);
});

test('a chip that names an account other than its place\'s pin replaces the pin on the card, and Start pins only the new session', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a', account: 'main' }] });
  assert.equal((await pinTo(c, 'group', 'cg-b', 'second', 'main')).status, 200);
  const card = (await cardOf(c, 'toolu_a')).accountCard;
  assert.deepEqual([card.account, card.from, card.overflow], ['second', 'group', 'main']);
  const res = await startChip(c, 'toolu_a', { account: 'main', confirmAccount: 'main' });
  assert.equal(res.status, 200, res.text);
  await until(() => startsOn(c, null) === 1);
  const made = await rowOf(c, res.body().id);
  assert.deepEqual([made.account, made.accountPin, made.accountOverflow], ['main', 'main', undefined], 'no overflow carries over');
  assert.equal(layoutOf(c).groups?.find?.(g => g.id === 'cg-b')?.account ?? layoutOf(c).accounts?.['cg-b'] ?? 'second', 'second', 'the group\'s own pin stays');
  assert.equal((await index(c)).groups.find(g => g.id === 'cg-b').account, 'second');
});

test('a started or dismissed chip carries no account words, and list_chips and the other tools never show a chip\'s account', async () => {
  const c = await open({ sessions: [MAKER], chips: [{ ...OPEN, toolUseId: 'toolu_a', account: 'second' }, { ...OPEN, toolUseId: 'toolu_b', account: 'second' }] });
  const started = await startChip(c, 'toolu_a', { account: 'second', confirmAccount: 'second' });
  assert.equal(started.status, 200, started.text);
  assert.equal(started.body().chip.accountCard, undefined);
  const dismissed = await post(c, '/api/chips/dismiss', { sessionId: 'maker', toolUseId: 'toolu_b', title: 'Follow up' });
  assert.equal(dismissed.body().chip.accountCard, undefined);
  assert.equal((await cardOf(c, 'toolu_a')).accountCard, undefined);
  assert.equal((await cardOf(c, 'toolu_b')).accountCard, undefined);
  const again = await startChip(c, 'toolu_a', { account: 'second', confirmAccount: 'second' });
  assert.equal(again.status, 409);
  assert.equal(again.body().chip.accountCard, undefined);

  await until(() => startsOn(c, c.dir) === 1);
  for (const [name, args] of [['list_chips', {}], ['find_sessions', { query: 'Maker' }], ['list_sub_sessions', {}]]) {
    const shown = await tool(c, 'live', name, args);
    assert.doesNotMatch(shown, /Second|second|Main|account/i, `${name} says nothing about an account`);
  }
});

test('send_session to a session whose pin is signed out words the refusal with no account and no holder, and every tool call that reports a refusal says the same', async () => {
  const c = await open({
    sessions: [{ id: 'top', title: 'Top', source: 'cli', ago: 5 }, { id: 'kid', title: 'Kid', source: 'cli', ago: 6, parent: 'top' }],
    layout: { accounts: { kid: 'second' } },
  });
  await signOutSecond(c);
  const refusal = await tool(c, 'top', 'send_session', { session_id: 'kid', message: 'Hello.' });
  assert.equal(refusal, "Refused: that session's account is signed out or no longer listed. Ask the owner to sort it out on the Accounts page.");
  assert.equal(resumes(c, 'kid').length, 0);
});
