// Run with `npm test`. Several accounts in use at once, over HTTP against the real server, with the stub keychain tool and the stub CLIs of test/harness.mjs, so nothing
// here reads the real keychain, signs in for real or runs the real claude: the sign-in banner and its route, the plan usage reply, and the switch and continue of a pinned
// session. See docs/adr/20261104-pin-work-to-an-account.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serviceFor } from '../lib/accounts.mjs';
import { as, authCalls, cliCalls, request, restart, signIn, start, until as waitFor } from './harness.mjs';

const DAY = 86_400_000;
const GROUPS = [{ id: 'cg-a', name: 'Work', project: 'cp-a' }, { id: 'cg-b', name: 'Loose' }];
const SESSIONS = [
  { id: 'live', title: 'Runs', source: 'cli', ago: 1 },
  { id: 'other', title: 'Another', source: 'cli', ago: 2 },
  { id: 'loosely', title: 'In the loose group', source: 'cli', ago: 3, group: 'cg-b' },
];
const NEW_ROUTINE = { title: 'Morning check', cron: '30 7 * * 1-5', jitterSeconds: 0, prompt: 'Look at the board.', enabled: false };
const row = (over = {}) => ({ kind: 'weekly_all', group: 'weekly', percent: 71, severity: 'normal', resets_at: new Date(Date.now() + 3 * DAY).toISOString(), scope: null, is_active: true, ...over });

// A server with one account, or with "Second" (id `second`) as well, signed in with a folder of its own. `holdSecond` makes its sign-in wait on the Mac.
async function open({ one = false, holdSecond = false } = {}) {
  const first = await start({ claude: true, sessions: SESSIONS, groups: GROUPS, layout: { projects: [{ id: 'cp-a', name: 'Proj' }] } });
  const dir = path.join(first.state, 'accounts', 'second');
  fs.mkdirSync(dir, { recursive: true });
  if (!one) fs.writeFileSync(path.join(first.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }, { id: 'second', name: 'Second', dir }] }));
  const c = { s: first, dir };
  signedIn(c, true, holdSecond);
  c.s = await restart(first);
  c.token = (await signIn(c.s)).token;
  await until(async () => (await accountsOf(c)).accounts.every(a => a.signedOut || a.email));
  return c;
}

function signedIn(c, on, hold = false) {
  fs.writeFileSync(path.join(c.dir, 'auth-state.json'), JSON.stringify(on ? { loggedIn: true, email: 'second@example.com', orgId: 'org-hidden-2', subscriptionType: 'pro' } : { loggedIn: false, ...(hold && { hold: true }) }));
  fs.writeFileSync(path.join(c.s.home, `keychain-expiry-${serviceFor(c.dir)}`), String(on ? Date.now() + 20 * DAY : Date.now() - DAY));
}

const get = (c, url) => request(c.s, 'GET', url, { headers: as(c.token) });
const post = (c, url, json = {}, headers = { origin: c.s.origin }) => request(c.s, 'POST', url, { headers: { connection: 'close', ...as(c.token), ...headers }, json });
const accountsOf = async c => (await get(c, '/api/accounts')).body();
const until = (check, ms = 20_000) => waitFor(check, ms);
const pin = (c, kind, id, account) => post(c, '/api/layout/account', { kind, id, account });
const login = async c => (await get(c, '/api/banners')).body().login;
const activeOf = async c => (await accountsOf(c)).accounts.find(a => a.active).id;
const say = (c, id, text = 'finish the turn') => post(c, `/api/sessions/${id}/send`, { text });
const calls = c => cliCalls(c.s);
// The second account's sign-in is read when something asks for it, and a refused switch to it asks.
const secondOut = async c => {
  signedIn(c, false);
  assert.equal((await post(c, '/api/accounts/second/use')).status, 409);
};
const shown = ({ account, accountId, visible, signedOut }) => [accountId, account, visible, signedOut];

test('the sign-in banner covers an account in use through a pin on a session, a group, a project or a routine, and drops it when the pin goes', async () => {
  const c = await open();
  await secondOut(c);
  assert.deepEqual(shown(await login(c)), ['main', 'Main', false, false], 'a signed out account nobody uses shows no banner');

  const kinds = [['session', 'live'], ['group', 'cg-b'], ['project', 'cp-a']];
  for (const [kind, id] of kinds) {
    signedIn(c, true);
    assert.equal((await pin(c, kind, id, 'second')).status, 200, kind);
    assert.deepEqual(shown(await login(c)), ['main', 'Main', false, false], `${kind}: signed in, nothing to show yet`);
    await secondOut(c);
    assert.deepEqual(shown(await login(c)), ['second', 'Second', true, true], `${kind}: in use only through its pin`);
    assert.equal((await pin(c, kind, id, null)).status, 200);
    assert.deepEqual(shown(await login(c)), ['main', 'Main', false, false], `${kind}: no pin, no banner`);
  }

  signedIn(c, true);
  assert.equal((await pin(c, 'session', 'live', 'second')).status, 200, 'a pin asks the CLI again');
  assert.equal((await pin(c, 'session', 'live', null)).status, 200);
  const added = await post(c, '/api/routines', { ...NEW_ROUTINE, cwd: c.s.home, account: 'second' });
  assert.equal(added.status, 200, added.text);
  await secondOut(c);
  assert.deepEqual(shown(await login(c)), ['second', 'Second', true, true], 'routine: in use only through its pin');
  assert.equal((await request(c.s, 'DELETE', `/api/routines/${added.body().routine.id}`, { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) } })).status, 200);
  assert.deepEqual(shown(await login(c)), ['main', 'Main', false, false]);
});

test('an account with a running chat and no pin is in use, and stops being once the chat is gone', async () => {
  const c = await open();
  assert.equal((await post(c, '/api/accounts/second/use')).status, 200);
  await say(c, 'live', 'ask for approval');
  await until(async () => (await accountsOf(c)).accounts.find(a => a.id === 'second').chats[0]?.state === 'waiting');
  assert.equal((await post(c, '/api/accounts/main/use')).status, 200);
  assert.equal((await accountsOf(c)).accounts.find(a => a.id === 'second').chats.length, 1, 'the chat waits on its approval, so it stays on Second');
  await secondOut(c);
  assert.deepEqual(shown(await login(c)), ['second', 'Second', true, true]);
});

test('the sign-in route checks the origin first, takes no body or no field as the active account, refuses a non-string 400 and an unknown account 404, and signs in the account it names', async () => {
  const c = await open({ holdSecond: true });
  await secondOut(c);
  const logins = dir => authCalls(c.s).filter(x => x.args[0] === 'login' && x.dir === dir).length;

  assert.equal((await post(c, '/api/banners/sign-in', { account: 7 }, {})).status, 403, 'no Origin, even with a bad body');
  assert.equal((await post(c, '/api/banners/sign-in', { account: 'gone' }, { origin: 'http://elsewhere.test' })).status, 403);
  for (const account of [7, null, true, ['second'], { id: 'second' }]) {
    const bad = await post(c, '/api/banners/sign-in', { account });
    assert.equal(bad.status, 400, JSON.stringify(account));
  }
  assert.equal((await post(c, '/api/banners/sign-in', { account: 'gone' })).status, 404);
  assert.equal((await post(c, '/api/banners/sign-in', { account: '' })).status, 404);
  assert.deepEqual([logins(null), logins(c.dir)], [0, 0], 'a refused request starts nothing');

  fs.writeFileSync(path.join(c.s.home, 'auth-state.json'), JSON.stringify({ hold: true }));
  const none = await request(c.s, 'POST', '/api/banners/sign-in', { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) } });
  assert.equal(none.status, 200, 'no body at all');
  await until(() => logins(null) === 1);
  assert.equal(logins(c.dir), 0, 'the active account was signed in');
  assert.equal((await post(c, '/api/banners/sign-in', {})).status, 200, 'a body with no field');
  assert.equal(logins(null), 1, 'the same sign-in, not a second one');

  const named = await post(c, '/api/banners/sign-in', { account: 'second' });
  assert.equal(named.status, 409, 'Main is still waiting on the Mac, and only one runs at a time');
  assert.equal(logins(c.dir), 0);
  fs.writeFileSync(path.join(c.s.home, 'auth-release'), '');
  await until(async () => (await accountsOf(c)).accounts[0].stage === 'done');
  assert.equal((await post(c, '/api/banners/sign-in', { account: 'second' })).status, 200);
  await until(() => logins(c.dir) === 1);
  await until(async () => (await accountsOf(c)).accounts.find(a => a.id === 'second').stage === 'done');
  assert.equal((await accountsOf(c)).accounts.find(a => a.id === 'second').signedOut, false, 'the account it named is the one signed in');
});

test('the plan reply names the session\'s own account when more than one is listed, and not with one', async () => {
  const c = await open();
  fs.writeFileSync(path.join(c.s.home, 'plan-usage.json'), JSON.stringify([row()]));
  fs.writeFileSync(path.join(c.dir, 'plan-usage.json'), JSON.stringify([row({ percent: 12 })]));
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 200);
  await say(c, 'live', 'ask for approval');
  await until(async () => (await accountsOf(c)).accounts[0].chats[0]?.state === 'waiting');
  const live = (await post(c, '/api/sessions/live/plan')).body();
  assert.deepEqual([live.account, live.limits[0].percent], ['Main', 71], 'a chat with a process');
  const other = (await post(c, '/api/sessions/other/plan')).body();
  assert.equal(other.account, 'Second', 'a session with no process, on the account its pin names');
  assert.equal((await post(c, '/api/sessions/loosely/plan')).body().account, 'Main', 'an unpinned one follows the active account');

  const one = await open({ one: true });
  fs.writeFileSync(path.join(one.s.home, 'plan-usage.json'), JSON.stringify([row()]));
  await say(one, 'live', 'ask for approval');
  await until(async () => (await accountsOf(one)).accounts[0].chats[0]?.state === 'waiting');
  const reply = (await post(one, '/api/sessions/live/plan')).body();
  assert.deepEqual(Object.keys(reply), ['limits'], 'with one account the reply is as it was');
});

test('a switch and continue for a pinned session is refused with a 409 before anything moves, unless the switch is to the pinned account itself', async () => {
  const c = await open();
  const refused = words => assert.match(words, /^This session stays on Main because of its pin, so a switch won't move it\. Change the pin to move it\.$/);

  assert.equal((await pin(c, 'session', 'live', 'main')).status, 200);
  const bySession = await post(c, '/api/accounts/second/use', { continue: 'live' });
  assert.equal(bySession.status, 409);
  refused(bySession.body().error);
  assert.equal(await activeOf(c), 'main', 'the active account did not move');
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.s.state, 'accounts.json'), 'utf8')).active, 'main');

  assert.equal((await pin(c, 'session', 'live', null)).status, 200);
  assert.equal((await pin(c, 'group', 'cg-b', 'main')).status, 200);
  const byGroup = await post(c, '/api/accounts/second/use', { continue: 'loosely' });
  assert.equal(byGroup.status, 409, 'a pin reached through the group counts too');
  assert.equal(await activeOf(c), 'main');
  assert.ok(!calls(c).some(x => x.user === 'Continue.'), 'nothing was sent');

  assert.equal((await post(c, '/api/accounts/second/use', { continue: 'other' })).status, 200, 'a session nothing pins is moved by the switch');
  assert.equal(await activeOf(c), 'second');
  assert.equal((await pin(c, 'session', 'live', 'second')).status, 200);
  assert.equal((await post(c, '/api/accounts/second/use', { continue: 'live' })).status, 200, 'pinned to the account being switched to');
});
