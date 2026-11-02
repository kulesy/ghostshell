// Run with `npm test`. The Claude accounts file and folders in temporary folders: the keychain service name, the links to the shared folder, the settings
// copied into an added account, and the names. Nothing here reads the real home, the real keychain or the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeAccounts, MAIN, SETTING_KEYS, serviceFor } from '../lib/accounts.mjs';

const fresh = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-accounts-test-'));
  const home = path.join(root, 'home');
  const state = path.join(root, 'state');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(state);
  return { root, home, state, shared: path.join(home, '.claude'), json: path.join(home, '.claude.json'), make: (env = {}) => makeAccounts(state, { env, home: () => home }) };
};

test('the keychain service is the first 8 hex digits of the folder as given', () => {
  assert.equal(serviceFor('/private/tmp/claude-501/cfgprobe-1'), 'Claude Code-credentials-96c3c1f3');
  assert.equal(serviceFor('/private/tmp/claude-501/cfgprobe-1/'), 'Claude Code-credentials-26d29f4c');
  assert.equal(serviceFor(''), 'Claude Code-credentials');
  assert.equal(serviceFor(undefined), 'Claude Code-credentials');
  assert.equal(serviceFor('/tmp/é'), serviceFor('/tmp/é'), 'normalised to NFC');
});

test('the first account is the environment as found, an added account adds its folder, and both are kept in accounts.json', () => {
  const f = fresh();
  const a = f.make({ PATH: '/bin' });
  assert.deepEqual(a.list(), [{ id: MAIN, name: 'Main' }]);
  assert.equal(a.active.id, MAIN);
  assert.deepEqual(a.envFor(a.active), { PATH: '/bin' });
  assert.deepEqual(a.loginEnvOf(a.active), {});
  assert.equal(a.serviceOf(a.active), 'Claude Code-credentials');

  const { account } = a.add('  Second  ');
  assert.equal(account.name, 'Second');
  assert.equal(account.dir, path.join(f.state, 'accounts', account.id));
  assert.deepEqual(a.envFor(account), { PATH: '/bin', CLAUDE_CONFIG_DIR: account.dir });
  assert.deepEqual(a.loginEnvOf(account), { CLAUDE_CONFIG_DIR: account.dir });
  assert.equal(a.serviceOf(account), serviceFor(account.dir));
  a.setActive(account.id);
  a.setAuto(true);

  const again = f.make();
  assert.equal(again.active.id, account.id);
  assert.equal(again.autoSwitch, true);
  assert.deepEqual(again.list().map(x => [x.id, x.name, x.dir]), [[MAIN, 'Main', undefined], [account.id, 'Second', account.dir]]);
  assert.equal(fs.statSync(path.join(f.state, 'accounts.json')).mode & 0o777, 0o600);
});

test('a first account found with a folder of its own keeps that folder for its service and its login', () => {
  const f = fresh();
  const a = f.make({ CLAUDE_CONFIG_DIR: '/somewhere/else' });
  assert.equal(a.serviceOf(a.active), serviceFor('/somewhere/else'));
  assert.deepEqual(a.loginEnvOf(a.active), { CLAUDE_CONFIG_DIR: '/somewhere/else' });
  assert.deepEqual(a.envFor(a.active), { CLAUDE_CONFIG_DIR: '/somewhere/else' });
});

test('names are trimmed, kept to size, and not shared by two accounts, and the first account can be renamed', () => {
  const f = fresh();
  const a = f.make();
  assert.match(a.add('   ').problem, /name of 1 to 40/);
  assert.match(a.add('x'.repeat(41)).problem, /name of 1 to 40/);
  assert.match(a.add('bad\u0000name').problem, /name of 1 to 40/);
  assert.match(a.add('main').problem, /already has that name/);
  const { account } = a.add('Work');
  assert.match(a.rename(account.id, 'MAIN').problem, /already has that name/);
  assert.equal(a.rename(account.id, 'Work').account.name, 'Work', 'its own name is not taken');
  assert.equal(a.rename(MAIN, 'Personal').account.name, 'Personal');
  assert.match(a.rename('nope', 'X').problem, /No such account/);
  assert.equal(f.make().find(MAIN).name, 'Personal');
});

test('an added account links every shared entry but the ones of one login and every dot-name, and leaves a real file alone', () => {
  const f = fresh();
  for (const name of ['projects', 'settings.json', 'skills', 'CLAUDE.md', 'plans', 'sessions', 'session-env', 'cache', 'history.jsonl', 'teams', 'stats-cache.json', 'policy-limits.json', '.credentials.json', '.claude.json', '.hidden', 'later']) {
    fs.writeFileSync(path.join(f.shared, name), name);
  }
  const a = f.make();
  const { account } = a.add('Second');
  fs.mkdirSync(account.dir, { recursive: true });
  fs.writeFileSync(path.join(account.dir, 'CLAUDE.md'), 'mine');
  a.prepare(account);
  const linked = fs.readdirSync(account.dir).filter(n => fs.lstatSync(path.join(account.dir, n)).isSymbolicLink()).sort();
  assert.deepEqual(linked, ['later', 'plans', 'projects', 'settings.json', 'skills']);
  assert.equal(fs.readlinkSync(path.join(account.dir, 'projects')), path.join(f.shared, 'projects'));
  assert.equal(fs.readFileSync(path.join(account.dir, 'CLAUDE.md'), 'utf8'), 'mine', 'a real file stays');
  assert.equal(fs.statSync(account.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.dirname(account.dir)).mode & 0o777, 0o700);

  fs.writeFileSync(path.join(f.shared, 'agents'), 'new');
  fs.rmSync(path.join(account.dir, 'later'));
  fs.rmSync(path.join(account.dir, 'plans'));
  fs.symlinkSync('/elsewhere', path.join(account.dir, 'plans'));
  a.prepare(account);
  assert.equal(fs.readlinkSync(path.join(account.dir, 'agents')), path.join(f.shared, 'agents'), 'an entry added later is linked at the next switch');
  assert.equal(fs.readlinkSync(path.join(account.dir, 'later')), path.join(f.shared, 'later'));
  assert.equal(fs.readlinkSync(path.join(account.dir, 'plans')), path.join(f.shared, 'plans'), 'a link that points elsewhere is pointed back');
});

test('the shared folder is the one CLAUDE_CONFIG_DIR names when the first account has one', () => {
  const f = fresh();
  const other = path.join(f.root, 'other');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'settings.json'), '{}');
  fs.writeFileSync(path.join(f.shared, 'settings.json'), '{}');
  fs.writeFileSync(path.join(other, '.claude.json'), JSON.stringify({ mcpServers: { a: {} } }));
  const a = f.make({ CLAUDE_CONFIG_DIR: other });
  const { account } = a.add('Second');
  a.prepare(account);
  assert.equal(fs.readlinkSync(path.join(account.dir, 'settings.json')), path.join(other, 'settings.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(account.dir, '.claude.json'), 'utf8')), { mcpServers: { a: {} } });
});

test('the listed user settings are copied into the account and nothing else, without disturbing what the account holds', () => {
  const f = fresh();
  const secret = { mcpServers: { x: { env: { KEY: 'secret-api-key' } } }, projects: { '/a': {} }, hasCompletedOnboarding: true, githubRepoPaths: { r: ['/r'] }, claudeInChromeDefaultEnabled: true, oauthAccount: { emailAddress: 'main@example.com' }, userID: 'abc', numStartups: 9 };
  fs.writeFileSync(f.json, JSON.stringify(secret));
  const a = f.make();
  const { account } = a.add('Second');
  fs.mkdirSync(account.dir, { recursive: true });
  fs.writeFileSync(path.join(account.dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'second@example.com' }, mcpServers: { old: {} } }));
  const said = [];
  const quiet = makeAccounts(f.state, { env: {}, home: () => f.home, warn: m => said.push(m) });
  quiet.prepare(account);
  const got = JSON.parse(fs.readFileSync(path.join(account.dir, '.claude.json'), 'utf8'));
  assert.deepEqual(Object.keys(got).sort(), ['claudeInChromeDefaultEnabled', 'githubRepoPaths', 'hasCompletedOnboarding', 'mcpServers', 'oauthAccount', 'projects']);
  assert.deepEqual(got.mcpServers, secret.mcpServers);
  assert.deepEqual(got.oauthAccount, { emailAddress: 'second@example.com' }, 'the account keeps its own login');
  assert.equal(fs.statSync(path.join(account.dir, '.claude.json')).mode & 0o777, 0o600);
  assert.ok(SETTING_KEYS.every(k => !['oauthAccount', 'userID'].includes(k)));
  assert.deepEqual(said, []);
  assert.ok(!fs.existsSync(path.join(account.dir, '.claude.json.lock')), 'the lock is let go');
  assert.deepEqual(fs.readdirSync(account.dir).filter(n => n.includes('tmp')), []);
});

test('a lock the CLI holds on the account\'s .claude.json skips the copy, and an unreadable file is left as it is', () => {
  const f = fresh();
  fs.writeFileSync(f.json, JSON.stringify({ mcpServers: { a: {} } }));
  const a = f.make();
  const { account } = a.add('Second');
  fs.mkdirSync(path.join(account.dir, '.claude.json.lock'), { recursive: true });
  a.prepare(account);
  assert.ok(!fs.existsSync(path.join(account.dir, '.claude.json')), 'held: nothing written');
  assert.ok(fs.existsSync(path.join(account.dir, '.claude.json.lock')), 'and the holder\'s lock is not removed');
  fs.rmdirSync(path.join(account.dir, '.claude.json.lock'));

  fs.writeFileSync(path.join(account.dir, '.claude.json'), '{ not json');
  a.prepare(account);
  assert.equal(fs.readFileSync(path.join(account.dir, '.claude.json'), 'utf8'), '{ not json');
  assert.ok(!fs.existsSync(path.join(account.dir, '.claude.json.lock')));

  fs.rmSync(path.join(account.dir, '.claude.json'));
  fs.rmSync(f.json);
  a.prepare(account);
  assert.ok(!fs.existsSync(path.join(account.dir, '.claude.json')), 'no settings to copy');
});

test('a lock a killed CLI left over a minute ago is taken over, and a fresh one is not', () => {
  const f = fresh();
  fs.writeFileSync(f.json, JSON.stringify({ mcpServers: { a: {} } }));
  const a = f.make();
  const { account } = a.add('Second');
  const lock = path.join(account.dir, '.claude.json.lock');
  fs.mkdirSync(lock, { recursive: true });
  const old = new Date(Date.now() - 61_000);
  fs.utimesSync(lock, old, old);
  a.prepare(account);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(account.dir, '.claude.json'), 'utf8')), { mcpServers: { a: {} } });
  assert.ok(!fs.existsSync(lock), 'taken, used and let go');

  fs.rmSync(path.join(account.dir, '.claude.json'));
  const recent = new Date(Date.now() - 30_000);
  fs.mkdirSync(lock);
  fs.utimesSync(lock, recent, recent);
  a.prepare(account);
  assert.ok(!fs.existsSync(path.join(account.dir, '.claude.json')), 'a lock under a minute old is still held');
  assert.ok(fs.existsSync(lock));
});

test('a corrupt accounts.json is moved aside without being quoted, and the first account carries on', () => {
  const f = fresh();
  fs.writeFileSync(path.join(f.state, 'accounts.json'), '{ "accounts": [ secret-token-text');
  const said = [];
  const a = makeAccounts(f.state, { env: {}, home: () => f.home, warn: m => said.push(m) });
  assert.deepEqual(a.list(), [{ id: MAIN, name: 'Main' }]);
  const aside = fs.readdirSync(f.state).filter(n => n.startsWith('accounts.json.bad-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(f.state, aside[0]), 'utf8'), '{ "accounts": [ secret-token-text');
  assert.ok(!fs.existsSync(path.join(f.state, 'accounts.json')));
  assert.equal(said.length, 1);
  assert.ok(!said[0].includes('secret-token-text'));

  a.add('Second');
  assert.equal(fs.readdirSync(f.state).filter(n => n.startsWith('accounts.json.bad-')).length, 1, 'the next save leaves the moved file alone');
});

test('the first account has no folder to prepare', () => {
  const f = fresh();
  const a = f.make();
  a.prepare(a.active);
  assert.deepEqual(fs.readdirSync(f.state), []);
});
