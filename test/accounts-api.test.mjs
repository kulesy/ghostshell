// Run with `npm test`. The Claude account routes over HTTP against the real server, with the stub keychain tool and the stub CLIs of test/harness.mjs, so nothing
// here reads the real keychain, signs in for real or runs the real claude. A second account is a folder in the server's state with a sign-in of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serviceFor } from '../lib/accounts.mjs';
import { OPEN_FAILED } from '../lib/chrome-check.mjs';
import { as, authCalls, chromeCalls, cliCalls, listen, openCalls, request, restart, signIn, start, until } from './harness.mjs';

const DAY = 86_400_000;
const SECRETS = /fake-access-secret|fake-refresh-secret|org-hidden|mcp-api-key/;
const texts = [];
const row = (over = {}) => ({ kind: 'weekly_all', group: 'weekly', percent: 71, severity: 'normal', resets_at: new Date(Date.now() + 3 * DAY).toISOString(), scope: null, is_active: true, ...over });

// A server with a second account, "Second" (id `second`), set up in its state before the server starts: signed in with its own email and plan unless `signedOut`.
async function open({ signedOut = false, main = null, second = {}, auto = false, claude = true, chrome = false, surveyed = false, setUp = true, sessions = [{ id: 'live', title: 'Runs', source: 'cli', ago: 1 }, { id: 'other', title: 'Another', source: 'cli', ago: 2 }, { id: 'cold', title: 'Cold', source: 'cli', ago: 3 }] } = {}) {
  const first = await start({ claude, sessions, ...(surveyed && { env: { CAPCOM_SURVEY_DELAY_MS: '100' } }) });
  const dir = path.join(first.state, 'accounts', 'second');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(first.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: auto, accounts: [{ id: 'main', name: 'Main' }, { id: 'second', name: 'Second', dir }] }));
  if (main) fs.writeFileSync(path.join(first.home, 'auth-state.json'), JSON.stringify(main));
  if (surveyed) fs.writeFileSync(path.join(first.home, 'chrome-state.json'), JSON.stringify({ browsers: [{ deviceId: 'd1', name: 'Secret Device', osPlatform: 'darwin', connectedAt: 1, isLocal: true, inUse: false }] }));
  if (chrome || (surveyed && setUp)) fs.writeFileSync(path.join(first.home, '.claude.json'), JSON.stringify({ cachedChromeExtensionInstalled: true }));
  if (!signedOut) {
    fs.writeFileSync(path.join(dir, 'auth-state.json'), JSON.stringify({ loggedIn: true, email: 'second@example.com', orgId: 'org-hidden-2', subscriptionType: 'pro', ...second }));
    fs.writeFileSync(path.join(first.home, `keychain-expiry-${serviceFor(dir)}`), String(Date.now() + 20 * DAY));
  }
  const s = await restart(first);
  const { token } = await signIn(s);
  const c = { s, token, dir };
  await until(async () => (await get(c, '/api/banners')).body().login.endsAt !== null);
  await until(async () => by(await accountsOf(c), 'second').signedOut === signedOut);
  await until(async () => (await accountsOf(c)).accounts.every(a => a.signedOut || a.email));
  return c;
}

const get = async (c, url) => {
  const res = await request(c.s, 'GET', url, { headers: as(c.token) });
  texts.push(res.text);
  return res;
};
const post = async (c, url, json = {}, headers = { origin: c.s.origin }) => {
  const res = await request(c.s, 'POST', url, { headers: { connection: 'close', ...as(c.token), ...headers }, json });
  texts.push(res.text);
  return res;
};
const accountsOf = async c => (await get(c, '/api/accounts')).body();
const by = (list, id) => list.accounts.find(a => a.id === id);
const activeOf = async c => (await accountsOf(c)).accounts.find(a => a.active).id;
const calls = c => cliCalls(c.s);
const startsOn = (c, dir) => calls(c).filter(x => x.started && x.configDir === dir).length;
const closes = c => calls(c).filter(x => x.closed).length;
// A message to a chat, answered by the fake CLI by its words.
const say = (c, id, text) => post(c, `/api/sessions/${id}/send`, { text });

test('the list gives each account its name, email, plan type and sign-in, the first account first, and the page is told the server has accounts', async () => {
  const c = await open();
  const list = await accountsOf(c);
  assert.deepEqual(list.accounts.map(a => [a.id, a.name, a.active, a.first]), [['main', 'Main', true, true], ['second', 'Second', false, false]]);
  const [main, second] = list.accounts;
  assert.deepEqual([main.email, main.planType, main.signedOut, main.stage], ['main@example.com', 'max', false, 'idle']);
  assert.deepEqual([second.email, second.planType, second.signedOut], ['second@example.com', 'pro', false]);
  assert.ok(second.endsAt > Date.now() + 19 * DAY);
  assert.deepEqual([main.out, main.plan, main.chats, main.sameAs], [null, null, [], null]);
  assert.deepEqual([list.autoSwitch, list.auto, list.waiting], [false, null, false]);
  assert.equal((await get(c, '/api/sessions')).body().features.accounts, true);
  assert.equal((await request(c.s, 'GET', '/api/accounts')).status, 401);
});

test('adding an account makes its folder, signs it in under that folder with the clean environment, one sign-in at a time, and a name can be changed', async () => {
  const c = await open();
  fs.writeFileSync(path.join(c.s.home, 'auth-state-next.json'), JSON.stringify({ hold: true, signInAs: { email: 'third@example.com', orgId: 'org-hidden-3', subscriptionType: 'pro' } }));
  assert.equal((await post(c, '/api/accounts', { name: 'Third' }, {})).status, 403, 'a request with no Origin is refused');
  assert.equal((await post(c, '/api/accounts', { name: 'Third' }, { origin: 'http://elsewhere.test' })).status, 403);
  assert.equal((await post(c, '/api/accounts', { name: '  ' })).status, 400);
  assert.equal((await post(c, '/api/accounts', { name: 'main' })).status, 400, 'a name is not shared');

  const added = await post(c, '/api/accounts', { name: 'Third' });
  assert.equal(added.status, 200);
  const id = added.body().added;
  assert.equal(by(added.body(), id).stage, 'waiting');
  assert.equal(added.body().waiting, true);
  const dir = path.join(c.s.state, 'accounts', id);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  await until(() => authCalls(c.s).some(x => x.args[0] === 'login'));
  const login = authCalls(c.s).find(x => x.args[0] === 'login');
  assert.deepEqual([login.args, login.dir, login.leaked], [['login', '--claudeai'], dir, []]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(c.s.state, 'accounts.json'), 'utf8')).accounts.map(a => a.id), ['main', 'second', id]);

  assert.equal((await post(c, '/api/accounts', { name: 'Fourth' })).status, 409, 'one at a time');
  assert.equal((await post(c, '/api/accounts/second/sign-in')).status, 409);
  assert.equal((await post(c, '/api/banners/sign-in')).status, 409, 'the sidebar banner is held back as well');
  assert.equal((await accountsOf(c)).accounts.length, 3);
  assert.equal((await post(c, `/api/accounts/${id}/sign-in`)).status, 200, 'asking again for the one that waits is fine');

  fs.writeFileSync(path.join(c.s.home, 'auth-release'), '');
  await until(async () => by(await accountsOf(c), id).stage === 'done');
  const third = by(await accountsOf(c), id);
  assert.deepEqual([third.signedOut, third.email, third.planType, third.problem], [false, 'third@example.com', 'pro', '']);
  assert.ok(third.endsAt > Date.now() + 27 * DAY);

  assert.equal((await post(c, `/api/accounts/${id}/rename`, { name: 'Work' })).status, 200);
  assert.equal(by(await accountsOf(c), id).name, 'Work');
  assert.equal((await post(c, `/api/accounts/${id}/rename`, { name: 'second' })).status, 400);
  assert.equal((await post(c, '/api/accounts/main/rename', { name: 'Personal' })).status, 200);
  assert.equal((await post(c, '/api/accounts/nope/rename', { name: 'X' })).status, 404);
  assert.equal((await post(c, '/api/accounts/main/rename', { name: 'Y' }, {})).status, 403);
});

test('a sign-in the CLI ends with an error leaves the account signed out with a fixed message', async () => {
  const c = await open({ signedOut: true });
  assert.equal(by(await accountsOf(c), 'second').signedOut, true);
  fs.writeFileSync(path.join(c.dir, 'auth-state.json'), JSON.stringify({ loginExit: 2 }));
  assert.equal((await post(c, '/api/accounts/second/sign-in')).status, 200);
  await until(async () => by(await accountsOf(c), 'second').stage === 'failed');
  const second = by(await accountsOf(c), 'second');
  assert.deepEqual([second.signedOut, second.problem], [true, 'The sign-in ended with exit code 2, and Claude is still signed out.']);
});

test('a switch to a signed out account is refused with a reason, and a switch to a signed in one moves the active account and the sidebar sign-in banner', async () => {
  const c = await open({ signedOut: true });
  const refused = await post(c, '/api/accounts/second/use');
  assert.deepEqual([refused.status, refused.body().error], [409, 'Second is signed out. Sign it in first.']);
  assert.equal(await activeOf(c), 'main');
  assert.equal((await post(c, '/api/accounts/second/use', {}, {})).status, 403);
  assert.equal((await post(c, '/api/accounts/nope/use')).status, 404);

  assert.equal((await post(c, '/api/accounts/second/sign-in')).status, 200);
  await until(async () => by(await accountsOf(c), 'second').stage === 'done');
  assert.equal((await get(c, '/api/banners')).body().login.account, 'Main', 'with more than one account the banner names the active one');
  const used = await post(c, '/api/accounts/second/use');
  assert.equal(used.status, 200);
  assert.equal(await activeOf(c), 'second');
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.s.state, 'accounts.json'), 'utf8')).active, 'second');
  assert.equal((await get(c, '/api/banners')).body().login.account, 'Second');
  assert.equal((await post(c, '/api/accounts/main/use')).status, 200);
});

test('a switch links the shared folder into the account and copies only its listed settings', async () => {
  const c = await open();
  fs.mkdirSync(path.join(c.s.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(c.s.home, '.claude', 'CLAUDE.md'), 'notes');
  fs.writeFileSync(path.join(c.s.home, '.claude.json'), JSON.stringify({ mcpServers: { x: { env: { KEY: 'mcp-api-key' } } }, oauthAccount: { emailAddress: 'org-hidden@example.com' } }));
  assert.equal((await post(c, '/api/accounts/second/use')).status, 200);
  assert.equal(fs.readlinkSync(path.join(c.dir, 'CLAUDE.md')), path.join(c.s.home, '.claude', 'CLAUDE.md'));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(c.dir, '.claude.json'), 'utf8'))), ['mcpServers']);
  assert.equal(c.s.errors().includes('mcp-api-key'), false, 'the settings are not logged');
});

test('two accounts that the CLI reports as one email and organisation are marked as the same Claude account', async () => {
  const c = await open({ main: { email: 'same@example.com', orgId: 'org-hidden-same' }, second: { email: 'same@example.com', orgId: 'org-hidden-same' } });
  const list = await accountsOf(c);
  assert.deepEqual([by(list, 'main').sameAs, by(list, 'second').sameAs], ['second', 'main']);
  const other = await open({ main: { email: 'same@example.com', orgId: 'org-hidden-a' }, second: { email: 'same@example.com', orgId: 'org-hidden-b' } });
  assert.deepEqual((await accountsOf(other)).accounts.map(a => a.sameAs), [null, null]);
});

test('the switch by itself is a setting that takes a boolean, and it is kept across a restart', async () => {
  const c = await open();
  assert.equal((await post(c, '/api/accounts/auto', { on: 'yes' })).status, 400);
  assert.equal((await post(c, '/api/accounts/auto', { on: true }, {})).status, 403);
  assert.equal((await post(c, '/api/accounts/auto', { on: true })).body().autoSwitch, true);
  const again = await restart(c.s);
  const { token } = await signIn(again);
  assert.equal((await accountsOf({ s: again, token })).autoSwitch, true);
});

test('a switch stops the idle chat of the old account, and the next message starts a process under the new account\'s folder', async () => {
  const c = await open();
  assert.equal((await say(c, 'live', 'finish the turn')).status, 200);
  await until(() => startsOn(c, null) === 1);
  await until(async () => by(await accountsOf(c), 'main').chats.some(x => x.id === 'live' && x.state === 'idle'));
  assert.deepEqual(by(await accountsOf(c), 'main').chats, [{ id: 'live', title: 'Runs', state: 'idle' }]);

  await post(c, '/api/accounts/second/use');
  await until(() => closes(c) === 1);
  assert.deepEqual(by(await accountsOf(c), 'main').chats, []);
  assert.equal((await say(c, 'live', 'finish the turn')).status, 200);
  await until(() => startsOn(c, c.dir) === 1);
  assert.equal((await say(c, 'live', 'finish the turn')).status, 200);
  assert.deepEqual(by(await accountsOf(c), 'second').chats.map(x => x.id), ['live']);
  assert.equal(startsOn(c, null), 1);
});

test('a chat that waits on an approval finishes on its old account and stops once it is answered and idle', async () => {
  const c = await open();
  await say(c, 'live', 'ask for approval');
  await until(async () => by(await accountsOf(c), 'main').chats[0]?.state === 'waiting');
  await post(c, '/api/accounts/second/use');
  await new Promise(done => setTimeout(done, 300));
  assert.equal(closes(c), 0, 'it keeps its process');
  assert.equal(by(await accountsOf(c), 'main').chats.length, 1);
  assert.equal((await post(c, '/api/sessions/live/approve', { requestId: 'perm-1', decision: 'allow' })).status, 200);
  await say(c, 'live', 'finish the turn');
  await until(() => closes(c) === 1);
});

test('only the CLI\'s limit words mark the active account out, with the page told in the turn end and the sidebar offered the switch, until a turn ends well', async () => {
  const c = await open();
  await say(c, 'live', 'finish the turn');
  const heard = listen(c.s, c.token, 'live');
  try {
    await say(c, 'live', 'hit a busy limit');
    await until(() => heard.events.some(e => e.type === 'turn-end'));
    assert.equal(heard.events.find(e => e.type === 'turn-end').data.usageOut, undefined);
    assert.equal(by(await accountsOf(c), 'main').out, null);
    assert.equal((await get(c, '/api/banners')).body().accounts.out, null);

    await say(c, 'live', 'hit the usage limit');
    await until(() => heard.events.some(e => e.type === 'turn-end' && e.data.usageOut));
    assert.equal(heard.events.findLast(e => e.type === 'turn-end').data.usageOut, true);
    const main = by(await accountsOf(c), 'main');
    assert.equal(main.out.text, "You've hit your limit, resets at 3pm");
    assert.ok(Math.abs(main.out.at - Date.now()) < 10_000);
    assert.deepEqual((await get(c, '/api/banners')).body().accounts.out.to, { id: 'second', name: 'Second' });
    assert.equal(await activeOf(c), 'main', 'the setting is off');

    await say(c, 'live', 'finish the turn');
    await until(async () => by(await accountsOf(c), 'main').out === null);
    assert.equal((await get(c, '/api/banners')).body().accounts.out, null);
  } finally {
    heard.close();
  }
});

test('the sidebar offers no switch when no other account is signed in', async () => {
  const c = await open({ signedOut: true });
  await say(c, 'live', 'hit the usage limit');
  await until(async () => by(await accountsOf(c), 'main').out);
  assert.equal((await get(c, '/api/banners')).body().accounts.out, null);
});

test('the switch and continue sends "Continue." to the chat under the new account, and refuses a session that is not there without switching', async () => {
  const c = await open();
  await say(c, 'live', 'hit the usage limit');
  await until(async () => by(await accountsOf(c), 'main').out);
  assert.equal((await post(c, '/api/accounts/second/use', { continue: 'nope' })).status, 404);
  assert.equal((await post(c, '/api/accounts/second/use', { continue: '../x' })).status, 404);
  assert.equal(await activeOf(c), 'main');

  assert.equal((await post(c, '/api/accounts/second/use', { continue: 'live' })).status, 200);
  assert.equal(await activeOf(c), 'second');
  await until(() => calls(c).some(x => x.user === 'Continue.'));
  const started = calls(c).filter(x => x.started);
  assert.equal(started.at(-1).configDir, c.dir, 'sent to a process on the new account');
});

test('the switch and continue sends nothing to a chat whose background job keeps it on the old account', async () => {
  const c = await open();
  await say(c, 'live', 'hit the usage limit with a job running');
  await until(async () => by(await accountsOf(c), 'main').out);
  const r = await post(c, '/api/accounts/second/use', { continue: 'live' });
  assert.equal(r.status, 409);
  assert.match(r.body().error, /still running a job on Main/);
  assert.equal(await activeOf(c), 'second');
  assert.ok(!calls(c).some(x => x.user === 'Continue.'));
});

test('a chat that is mid-turn or waiting on an approval is told apart from one with a job when the switch cannot move it', async () => {
  const c = await open();
  await say(c, 'live', 'ask for approval');
  await say(c, 'other', 'keep working');
  await until(async () => by(await accountsOf(c), 'main').chats.map(x => x.state).sort().join() === 'waiting,working');
  const waiting = await post(c, '/api/accounts/second/use', { continue: 'live' });
  assert.equal(waiting.status, 409);
  assert.equal(waiting.body().error, 'That chat is waiting on an approval on Main. It moves to Second once it is answered.');
  const working = await post(c, '/api/accounts/second/use', { continue: 'other' });
  assert.equal(working.body().error, 'That chat is still in a turn on Main. It moves to Second once the turn ends.');
  assert.ok(!calls(c).some(x => x.user === 'Continue.'));
});

test('with the setting on the first out-of-usage mark switches once to an account that is not out, shows a dismissible notice, and never switches to an account that is out', async () => {
  const c = await open({ auto: true });
  await say(c, 'live', 'hit the usage limit');
  await until(async () => (await activeOf(c)) === 'second');
  const banner = (await get(c, '/api/banners')).body().accounts;
  assert.deepEqual([banner.auto.from, banner.auto.to], [{ id: 'main', name: 'Main' }, { id: 'second', name: 'Second' }]);
  assert.equal(banner.out, null, 'the new active account is not out');
  assert.deepEqual((await accountsOf(c)).auto.to, { id: 'second', name: 'Second' });

  await say(c, 'live', 'hit the usage limit');
  await until(async () => by(await accountsOf(c), 'second').out);
  await new Promise(done => setTimeout(done, 300));
  assert.equal(await activeOf(c), 'second', 'main is out as well, so it does not flip back');
  assert.equal((await get(c, '/api/banners')).body().accounts.out, null, 'and no switch is offered');

  assert.equal((await post(c, '/api/accounts/seen', {}, {})).status, 403);
  assert.equal((await post(c, '/api/accounts/seen')).status, 200);
  assert.equal((await get(c, '/api/banners')).body().accounts.auto, null);
});

test('plan usage is asked of chats on the same account as the chat, kept for each account with its time, and refreshed for all of them', async () => {
  const c = await open();
  fs.writeFileSync(path.join(c.s.home, 'plan-usage.json'), JSON.stringify([row({ percent: 71 })]));
  fs.writeFileSync(path.join(c.dir, 'plan-usage.json'), JSON.stringify([row({ percent: 12 })]));
  await say(c, 'live', 'ask for approval');
  await until(async () => by(await accountsOf(c), 'main').chats[0]?.state === 'waiting');
  await post(c, '/api/accounts/second/use');
  await say(c, 'other', 'finish the turn');
  await until(async () => by(await accountsOf(c), 'second').chats.length === 1);

  const percent = async id => (await post(c, `/api/sessions/${id}/plan`)).body().limits?.[0].percent;
  assert.equal(await percent('live'), 71, 'the chat on main answers for main');
  assert.equal(await percent('other'), 12);
  assert.equal(await percent('cold'), 12, 'a chat with no process is the active account\'s');

  const refreshed = await post(c, '/api/accounts/plan');
  assert.deepEqual(refreshed.body().accounts.map(a => a.plan.limits[0].percent), [71, 12]);
  assert.ok(refreshed.body().accounts.every(a => Math.abs(a.plan.at - Date.now()) < 15_000));
  assert.equal((await post(c, '/api/accounts/plan', {}, {})).status, 403);
  fs.rmSync(path.join(c.s.home, 'plan-usage.json'));
  const later = await post(c, '/api/accounts/plan');
  assert.equal(later.body().accounts[0].plan.limits[0].percent, 71, 'an account whose chats cannot answer keeps its last answer');
});

test('no response from the account routes or the banners holds a token, an organisation or a setting, and the CLI is never given Desktop\'s variables', async () => {
  const c = await open({ claude: false });
  await accountsOf(c);
  await get(c, '/api/banners');
  assert.ok(texts.length > 10);
  for (const text of texts) assert.doesNotMatch(text, SECRETS);
  for (const call of authCalls(c.s)) assert.deepEqual(call.leaked, []);
});

// A browser on this Mac, as the fake `claude --claude-in-chrome-mcp` lists it for the folder: the home is main's, and `c.dir` is second's.
const browser = { deviceId: 'd1', name: 'Fake', osPlatform: 'darwin', connectedAt: 1, isLocal: true, inUse: false };
const seesChrome = folder => fs.writeFileSync(path.join(folder, 'chrome-state.json'), JSON.stringify({ browsers: [browser] }));

test('a switch with Chrome set up reports it checking at once, then names the account Chrome is still on, and a read never asks again', async () => {
  const c = await open({ chrome: true });
  seesChrome(c.s.home);
  assert.equal((await accountsOf(c)).chrome, null);
  const used = await post(c, '/api/accounts/second/use');
  assert.deepEqual(used.body().chrome, { checking: true });
  await until(async () => (await accountsOf(c)).chrome?.state === 'elsewhere');
  const expected = { state: 'elsewhere', to: { id: 'second', name: 'Second' }, on: { id: 'main', name: 'Main' }, email: 'second@example.com', opened: false };
  assert.deepEqual((await accountsOf(c)).chrome, expected);
  assert.deepEqual((await get(c, '/api/banners')).body().chrome, expected);
  assert.deepEqual(chromeCalls(c.s).map(x => x.dir).sort(), [c.dir, null]);
  for (let i = 0; i < 3; i++) { await accountsOf(c); await get(c, '/api/banners'); }
  assert.equal(chromeCalls(c.s).length, 2);
});

test('the account list says which account Chrome is on once the start-up survey has proved it, holds no device name, and a read never asks again', async () => {
  const c = await open({ surveyed: true });
  await until(async () => by(await accountsOf(c), 'second').chromeOn === 'main');
  const list = await accountsOf(c);
  assert.equal(by(list, 'main').chromeOn, undefined, 'the account with the browser has no such key');
  assert.deepEqual(chromeCalls(c.s).map(x => x.dir).sort(), [c.dir, null], 'one probe for each account');
  assert.doesNotMatch(JSON.stringify(list), /Secret Device|d1/);
  assert.equal(list.chrome, null, 'a survey shows no banner');
  for (let i = 0; i < 3; i++) { await accountsOf(c); await get(c, '/api/banners'); }
  assert.equal(chromeCalls(c.s).length, 2);
});

test('a start-up survey with Chrome not set up probes nothing and adds no chromeOn', async () => {
  const none = await open({ surveyed: true, setUp: false });
  await new Promise(done => setTimeout(done, 500));
  assert.deepEqual([chromeCalls(none.s).length, (await accountsOf(none)).accounts.some(a => a.chromeOn)], [0, false]);
});

test('a switch where Chrome is on the new account, or where Chrome is not set up, shows no banner', async () => {
  const set = await open({ chrome: true });
  seesChrome(set.dir);
  await post(set, '/api/accounts/second/use');
  await until(() => chromeCalls(set.s).length === 2);
  await new Promise(done => setTimeout(done, 200));
  assert.equal((await accountsOf(set)).chrome, null);

  const none = await open();
  seesChrome(none.s.home);
  await post(none, '/api/accounts/second/use');
  assert.equal((await accountsOf(none)).chrome, null);
  await new Promise(done => setTimeout(done, 300));
  assert.deepEqual([chromeCalls(none.s).length, openCalls(none.s).length], [0, 0], 'nothing probed, nothing opened');
});

test('chrome-open refuses a cross-site request, opens the extension settings through the open tool, and says so when it fails', async () => {
  const c = await open({ chrome: true });
  seesChrome(c.s.home);
  await post(c, '/api/accounts/second/use');
  await until(async () => (await accountsOf(c)).chrome?.state === 'elsewhere');
  assert.equal((await post(c, '/api/accounts/chrome-open', {}, {})).status, 403);
  assert.equal((await post(c, '/api/accounts/chrome-open', {}, { origin: 'http://elsewhere.test' })).status, 403);
  assert.deepEqual(openCalls(c.s), []);

  fs.writeFileSync(path.join(c.s.home, 'open-fails'), '');
  const failed = await post(c, '/api/accounts/chrome-open');
  assert.deepEqual([failed.status, failed.body()], [409, { error: OPEN_FAILED }]);
  assert.equal((await accountsOf(c)).chrome.opened, false);

  fs.rmSync(path.join(c.s.home, 'open-fails'));
  const opened = await post(c, '/api/accounts/chrome-open');
  assert.equal(opened.status, 200);
  assert.equal(opened.body().chrome.opened, true);
  assert.deepEqual(openCalls(c.s).at(-1), ['-a', 'Google Chrome', 'https://clau.de/chrome/permissions']);
});

test('chrome-seen clears the banner, and refuses a cross-site request', async () => {
  const c = await open({ chrome: true });
  seesChrome(c.s.home);
  await post(c, '/api/accounts/second/use');
  await until(async () => (await accountsOf(c)).chrome?.state === 'elsewhere');
  assert.equal((await post(c, '/api/accounts/chrome-seen', {}, {})).status, 403);
  assert.equal((await accountsOf(c)).chrome.state, 'elsewhere');
  const seen = await post(c, '/api/accounts/chrome-seen');
  assert.equal(seen.status, 200);
  assert.equal(seen.body().chrome, null);
  assert.equal((await get(c, '/api/banners')).body().chrome, null);
});
