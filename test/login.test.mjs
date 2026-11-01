// Run with `npm test`. When Claude's sign-in ends and signing in again: the 5 day threshold, the signals that say Claude is signed out, the
// stages of a sign-in, and that the keychain's secrets never leave the reader. Every part that touches the machine is a fake or a stub script.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authStatus, AUTH_GAP_MS, cleanEnv, makeLogin, readLoginEnd, SOON_MS, startSignIn, TIMED_OUT } from '../lib/login.mjs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-02T00:00:00Z');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-login-test-'));
const script = (name, body) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
};

function rig({ end = NOW + 20 * DAY, loggedIn = true, sign, limit = 5000 } = {}) {
  const r = { end, loggedIn, at: NOW, reads: 0, asks: 0, begun: 0 };
  r.login = makeLogin({
    readEnd: async () => { r.reads++; return r.end; },
    authStatus: async () => { r.asks++; return r.loggedIn; },
    startSignIn: () => { r.begun++; return sign(r); },
    now: () => r.at,
    limitMs: limit,
  });
  return r;
}

// A sign-in that ends when `finish(code)` is called, or when it is stopped.
function pending() {
  let finish;
  const exited = new Promise(resolve => { finish = resolve; });
  return { exited, finish, stop: () => finish(null) };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test('the banner shows from 5 days before the end, and not before', async () => {
  const r = rig({ end: NOW + 5 * DAY + 1 });
  await r.login.refresh();
  assert.equal(r.login.state().visible, false);
  r.at = NOW + 2;
  assert.equal(r.login.state().visible, true);
  r.end = NOW + 1 * DAY;
  r.at = NOW;
  await r.login.refresh();
  assert.deepEqual(r.login.state(), { visible: true, signedOut: false, endsAt: NOW + DAY, stage: 'idle', problem: '' });
  assert.equal(SOON_MS, 5 * DAY);
});

test('a date in the past means signed out, and the CLI is asked only when the date is missing or past', async () => {
  const r = rig({ end: NOW - 1000, loggedIn: null });
  await r.login.refresh();
  assert.equal(r.login.state().signedOut, true);
  assert.equal(r.asks, 1);
  r.end = NOW + 20 * DAY;
  await r.login.refresh();
  assert.deepEqual([r.login.state().signedOut, r.login.state().visible, r.asks], [false, false, 1], 'a good date does not ask');
});

test('with no date, the CLI says whether Claude is signed out, and an unclear answer shows nothing', async () => {
  const r = rig({ end: null, loggedIn: false });
  await r.login.refresh();
  assert.deepEqual([r.login.state().signedOut, r.login.state().visible, r.login.state().endsAt], [true, true, null]);
  r.loggedIn = true;
  await r.login.refresh();
  assert.equal(r.login.state().visible, false);
  r.loggedIn = null;
  await r.login.refresh();
  assert.equal(r.login.state().visible, false);
});

test('a chat that reports authentication_failed makes the server ask the CLI and read the date again, at most once a minute', async () => {
  const r = rig();
  await r.login.refresh();
  assert.deepEqual([r.reads, r.asks], [1, 0]);
  r.loggedIn = false;
  await r.login.authFailed();
  assert.deepEqual([r.reads, r.asks, r.login.state().signedOut], [2, 1, true]);
  await r.login.authFailed();
  r.at += AUTH_GAP_MS - 1;
  await r.login.authFailed();
  assert.deepEqual([r.reads, r.asks], [2, 1], 'inside the minute');
  r.at += 1;
  r.loggedIn = true;
  await r.login.authFailed();
  assert.deepEqual([r.reads, r.asks, r.login.state().signedOut], [3, 2, false]);
});

test('a sign-in waits on the page, runs one at a time, and ends done when the CLI says Claude is signed in', async () => {
  let run;
  const r = rig({ end: NOW + DAY, sign: () => (run = pending()) });
  await r.login.refresh();
  r.login.signIn();
  r.login.signIn();
  assert.deepEqual([r.begun, r.login.state().stage], [1, 'waiting']);
  r.end = NOW + 28 * DAY;
  r.loggedIn = true;
  run.finish(0);
  await settle();
  assert.deepEqual([r.login.state().stage, r.login.state().visible, r.login.state().endsAt, r.login.state().problem], ['done', false, NOW + 28 * DAY, '']);
  r.login.signIn();
  assert.equal(r.begun, 2, 'a new one can start once the last has ended');
  run.finish(0);
});

test('a sign-in that ends while Claude is still signed out fails with its exit code, and one that never starts fails too', async () => {
  let run;
  const r = rig({ end: null, loggedIn: false, sign: () => (run = pending()) });
  await r.login.refresh();
  r.login.signIn();
  run.finish(7);
  await settle();
  assert.deepEqual([r.login.state().stage, r.login.state().problem], ['failed', 'The sign-in ended with exit code 7, and Claude is still signed out.']);
  r.login.signIn();
  run.finish(null);
  await settle();
  assert.equal(r.login.state().problem, 'The sign-in did not finish, and Claude is still signed out.');
});

test('a sign-in nobody approves is stopped after the limit', async () => {
  let run;
  const r = rig({ end: null, loggedIn: false, limit: 50, sign: () => (run = pending()) });
  r.login.signIn();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.deepEqual([r.login.state().stage, r.login.state().problem], ['failed', TIMED_OUT]);
});

test('stopping the server stops a sign-in that is waiting', async () => {
  let stopped = 0;
  const r = rig({ sign: () => ({ exited: new Promise(() => {}), stop: () => { stopped++; } }) });
  r.login.signIn();
  r.login.stop();
  r.login.stop();
  assert.equal(stopped, 2, 'stop is safe to repeat');
});

test('the CLI is given only the variables it needs to find its login', () => {
  assert.deepEqual(cleanEnv({ HOME: '/h', USER: 'u', PATH: '/p', TERM: 'x', CLAUDE_CODE_ENTRYPOINT: 'desktop', ANTHROPIC_BASE_URL: 'http://x', SECRET: 's' }), { HOME: '/h', USER: 'u', PATH: '/p', TERM: 'x' });
  assert.deepEqual(cleanEnv({ HOME: '/h' }), { HOME: '/h' });
});

test('the reader returns the end date alone and drops everything else the keychain entry holds', async t => {
  const said = [];
  for (const name of ['log', 'error', 'warn']) t.mock.method(console, name, (...a) => said.push(a.join(' ')));
  const entry = { claudeAiOauth: { accessToken: 'sk-ant-secret-access', refreshToken: 'sk-ant-secret-refresh', refreshTokenExpiresAt: 1_795_000_000_000, scopes: ['x'] } };
  const good = script('security-good', `console.log(${JSON.stringify(JSON.stringify(entry))});`);
  assert.equal(await readLoginEnd({ security: good, user: 'someone' }), 1_795_000_000_000);
  const asked = script('security-args', `require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'args.json'))}, JSON.stringify(process.argv.slice(2))); console.log('{}');`);
  assert.equal(await readLoginEnd({ security: asked, user: 'someone' }), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8')), ['find-generic-password', '-s', 'Claude Code-credentials', '-a', 'someone', '-w']);
  assert.deepEqual(said, [], 'nothing is logged');
});

test('a missing entry, garbage, a date that is not a number and a tool that is not there all read as no date, and say nothing of the input', async t => {
  const said = [];
  for (const name of ['log', 'error', 'warn']) t.mock.method(console, name, (...a) => said.push(a.join(' ')));
  const missing = script('security-missing', "process.stderr.write('sk-ant-secret not found\\n'); process.exit(44);");
  const garbage = script('security-garbage', "console.log('sk-ant-secret-garbage {');");
  const text = script('security-text', `console.log(${JSON.stringify(JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: 'soon', accessToken: 'sk-ant-secret' } }))});`);
  for (const security of [missing, garbage, text, path.join(dir, 'no-such-tool')]) assert.equal(await readLoginEnd({ security, user: 'u' }), null, security);
  assert.deepEqual(said, []);
});

test('the status call keeps only loggedIn, reads the answer of a signed out CLI that exits 1, and runs with the clean environment', async () => {
  process.env.CLAUDE_CODE_ENTRYPOINT = 'desktop-test';
  const out = path.join(dir, 'status-env.json');
  const cli = (loggedIn, code) => script(`claude-${loggedIn}-${code}`, `require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(Object.keys(process.env).sort()));
console.log(JSON.stringify({ loggedIn: ${loggedIn}, email: 'someone@example.com', token: 'sk-ant-secret' })); process.exit(${code});`);
  try {
    assert.equal(await authStatus({ claude: cli(true, 0) }), true);
    assert.equal(await authStatus({ claude: cli(false, 1) }), false);
    assert.ok(!JSON.parse(fs.readFileSync(out, 'utf8')).includes('CLAUDE_CODE_ENTRYPOINT'));
    assert.equal(await authStatus({ claude: script('claude-garbage', "console.log('nope');") }), null);
    assert.equal(await authStatus({ claude: script('claude-string', "console.log('{\"loggedIn\":\"yes\"}');") }), null);
    assert.equal(await authStatus({ claude: path.join(dir, 'no-such-claude') }), null);
  } finally {
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
  }
});

test('the sign-in runs `claude auth login --claudeai` with the clean environment, reads none of its output, and reports how it ended', async () => {
  process.env.ANTHROPIC_BASE_URL = 'http://example.test';
  const seen = path.join(dir, 'login-seen.json');
  try {
    const cli = script('claude-login', `require('node:fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ args: process.argv.slice(2), keys: Object.keys(process.env).sort() }));
console.log('https://claude.ai/oauth?code=sk-ant-secret'); process.exit(3);`);
    assert.equal(await startSignIn({ claude: cli }).exited, 3);
    const { args, keys } = JSON.parse(fs.readFileSync(seen, 'utf8'));
    assert.deepEqual(args, ['auth', 'login', '--claudeai']);
    assert.ok(!keys.includes('ANTHROPIC_BASE_URL'));
    const slow = startSignIn({ claude: script('claude-slow', 'setInterval(() => {}, 1000);') });
    slow.stop();
    assert.equal(await slow.exited, null);
    assert.equal(await startSignIn({ claude: path.join(dir, 'no-such-claude') }).exited, null);
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
  }
});

test('nothing a sign-in or the keychain gave ends up in the state', async () => {
  const r = rig({ end: NOW + DAY, sign: () => pending() });
  await r.login.refresh();
  r.login.signIn();
  assert.doesNotMatch(JSON.stringify(r.login.state()), /secret|token|sk-ant/i);
  assert.deepEqual(Object.keys(r.login.state()).sort(), ['endsAt', 'problem', 'signedOut', 'stage', 'visible']);
  r.login.stop();
});
