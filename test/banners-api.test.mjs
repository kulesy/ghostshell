// Run with `npm test`. The banner routes over HTTP against the real server, with a stub keychain tool, a stub `claude auth` and a scratch folder
// for the checkout it would update, so nothing here reads the real keychain, signs in for real or touches a repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, authCalls, request, restart, signIn, start, until } from './harness.mjs';

const DAY = 86_400_000;
const mine = { CLAUDE_CODE_ENTRYPOINT: 'desktop', ANTHROPIC_BASE_URL: 'http://example.test' };

// A signed-in server started again after `files` were written in its home.
async function open(files = {}) {
  const first = await start({ env: mine });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(first.home, name), text);
  const s = await restart(first);
  const { token } = await signIn(s);
  return { s, token };
}
const read = c => request(c.s, 'GET', '/api/banners', { headers: as(c.token) });
// The first read of the date finishes just after the server starts listening.
const known = async c => { await until(async () => (await read(c)).body().login.endsAt !== null); return read(c); };
const post = (c, step, headers = { origin: c.s.origin }) => request(c.s, 'POST', `/api/banners/${step}`, { headers: { connection: 'close', ...as(c.token), ...headers }, json: {} });

test('a sign-in with weeks left shows no banner, answers with the date alone, and costs no call to the CLI', async () => {
  const end = Date.now() + 20 * DAY;
  const c = await open({ 'keychain-expiry': String(end) });
  const got = await known(c);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body(), { login: { visible: false, signedOut: false, endsAt: end, stage: 'idle', problem: '' }, update: { show: false }, accounts: { count: 1, out: null, auto: null }, chrome: null });
  assert.doesNotMatch(got.text, /secret/);
  assert.deepEqual(authCalls(c.s), []);
  const index = (await request(c.s, 'GET', '/api/sessions', { headers: as(c.token) })).body();
  assert.equal(index.features.banners, true);
});

test('a sign-in ending in four days shows the banner with the date', async () => {
  const end = Date.now() + 4 * DAY;
  const c = await open({ 'keychain-expiry': String(end) });
  assert.deepEqual((await known(c)).body().login, { visible: true, signedOut: false, endsAt: end, stage: 'idle', problem: '' });
});

test('with no keychain entry and a CLI that says it is signed out, the banner says signed out, and signing in runs the CLI with the clean environment', async () => {
  const c = await open({ 'keychain-expiry': 'missing', 'auth-state.json': JSON.stringify({ loggedIn: false, hold: true }) });
  await until(async () => (await read(c)).body().login.signedOut);
  assert.deepEqual((await read(c)).body().login, { visible: true, signedOut: true, endsAt: null, stage: 'idle', problem: '' });

  assert.equal((await post(c, 'sign-in', {})).status, 403, 'a request with no Origin is refused');
  assert.equal((await post(c, 'sign-in', { origin: 'http://elsewhere.test' })).status, 403);
  assert.equal((await post(c, 'sign-in')).status, 200);
  await until(async () => (await read(c)).body().login.stage === 'waiting');
  const logins = () => authCalls(c.s).filter(call => call.args[0] === 'login').length;
  await until(() => logins() === 1);
  await post(c, 'sign-in');
  assert.equal(logins(), 1, 'one at a time');

  fs.writeFileSync(path.join(c.s.home, 'auth-release'), '');
  await until(async () => (await read(c)).body().login.stage === 'done');
  const done = (await read(c)).body().login;
  assert.deepEqual([done.visible, done.signedOut, done.problem], [false, false, '']);
  for (const call of authCalls(c.s)) assert.deepEqual(call.leaked, [], `claude auth ${call.args.join(' ')} got Desktop's variables`);
  assert.deepEqual(authCalls(c.s).find(call => call.args[0] === 'login').args, ['login', '--claudeai']);
});

test('a sign-in the CLI ends with an error fails with a fixed message', async () => {
  const c = await open({ 'keychain-expiry': 'missing', 'auth-state.json': JSON.stringify({ loggedIn: false, loginExit: 2 }) });
  await until(async () => (await read(c)).body().login.signedOut);
  await post(c, 'sign-in');
  await until(async () => (await read(c)).body().login.stage === 'failed');
  const { login } = (await read(c)).body();
  assert.deepEqual([login.visible, login.problem], [true, 'The sign-in ended with exit code 2, and Claude is still signed out.']);
});

test('an update is refused when the checkout is not a repository, and the update route takes the stricter origin check', async () => {
  const c = await open();
  const refused = await post(c, 'update');
  assert.deepEqual([refused.status, refused.body()], [409, { error: 'There is nothing to update.' }]);
  assert.equal((await post(c, 'update', {})).status, 403);
  assert.equal((await post(c, 'nothing')).status, 404);
  assert.equal((await request(c.s, 'GET', '/api/banners/update', { headers: as(c.token) })).status, 404);
});

test('the banner routes need a signed-in session', async () => {
  const c = await open();
  assert.equal((await request(c.s, 'GET', '/api/banners')).status, 401);
});
