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
const post = (c, url, json = {}, headers = { origin: c.s.origin }) => request(c.s, 'POST', url, { headers: { connection: 'close', ...as(c.token), ...headers }, json });
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
  assert.match(await tool(c, 'top', 'send_session', { session_id: 'kid2', message: 'And you.' }), /^Refused: .*pinned to Second, which is signed out/);
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
async function moveAsk(c, caller, input) {
  const viewer = listen(c.s, c.token, caller);
  const answered = () => calls(c).filter(x => x.requestId === `perm-${MOVE}`).length;
  try {
    await until(() => viewer.events.length);
    const had = answered();
    assert.equal((await say(c, caller, `ask to use ${MOVE} ${JSON.stringify(input)}`)).status, 200);
    await until(() => viewer.events.some(e => e.type === 'approval') || answered() > had);
    return viewer.events.find(e => e.type === 'approval')?.data.summary ?? 'allowed';
  } finally {
    viewer.close();
  }
}

test('a move inside the caller\'s tree that would change the session\'s account asks the owner and names the account, and one that leaves it the same goes with no card', async () => {
  const c = await open({ sessions: [{ id: 'top', title: 'Top', ago: 5 }, { id: 'kid', title: 'Kid', ago: 6, parent: 'top', group: 'cg-b' }, { id: 'solo', title: 'Solo', ago: 7 }] });
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  assert.equal(await moveAsk(c, 'top', { session_id: 'top', group: 'Work' }), 'move "Top" [top] to "Work", which runs it on the active account, now Main, and the 1 session under it can change account too', 'the session under it can follow');
  assert.equal(await moveAsk(c, 'solo', { session_id: 'solo', group: 'Work' }), 'allowed', 'main to main with nothing under it');
  assert.equal(await moveAsk(c, 'top', { session_id: 'kid', group: 'Work' }), 'move "Kid" [kid] to "Work", which runs it on the active account, now Main', 'out of a pinned group');
  assert.equal(await moveAsk(c, 'kid', { session_id: 'kid', group: 'Loose' }), 'allowed', 'second to second');
  assert.equal(await moveAsk(c, 'solo', { session_id: 'solo', group: 'Loose' }), 'move "Solo" [solo] to "Loose", which runs it on Second', 'into a pinned group');
  assert.equal(await moveAsk(c, 'solo', { session_id: 'solo', group: 'Nowhere' }), 'move "Solo" [solo] to "Nowhere"', 'a group that is not there still asks, with no account to name');
});

test('a move that drops a pin on the active account\'s own id asks the owner, since a later switch would part them', async () => {
  const c = await open({ sessions: [{ id: 'held', title: 'Held', ago: 5, group: 'cg-b' }] });
  assert.equal((await pin(c, 'group', 'cg-b', 'main')).status, 200);
  assert.equal(await moveAsk(c, 'held', { session_id: 'held', group: 'Work' }), 'move "Held" [held] to "Work", which runs it on the active account, now Main');
});

test('a move of a nested session asks the owner when it relinks a session off that session\'s pin', async () => {
  const c = await open({ sessions: [{ id: 'head', title: 'Head', ago: 5 }, { id: 'mid', title: 'Mid', ago: 6, parent: 'head' }, { id: 'low', title: 'Low', ago: 7, parent: 'mid' }] });
  assert.equal((await pin(c, 'session', 'mid', 'second')).status, 200);
  assert.equal(await moveAsk(c, 'head', { session_id: 'mid', group: 'Work' }), 'move "Mid" [mid] to "Work", which runs it on Second, and the 1 session under it can change account too');
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
