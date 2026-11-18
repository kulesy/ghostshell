// Run with `npm test`. Sign-in is driven by a clock we move by hand, so a year passes in a loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeAuth, overHttps, sessionCookie, writePassword } from '../lib/auth.mjs';
import { deviceLabel } from '../lib/device.mjs';

const DAY = 24 * 3600_000;
const IDLE = 90 * DAY;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-auth-test-'));
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

function rig() {
  const dir = fs.mkdtempSync(path.join(base, 'state-'));
  let t = Date.UTC(2026, 9, 16, 9, 0, 0);
  const auth = makeAuth(dir, { now: () => t });
  return {
    dir, auth,
    file: path.join(dir, 'tokens.json'),
    now: () => t,
    tick: ms => { t += ms; },
    saved: () => JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8')),
  };
}

// The file's key for a token, written out here so a change to the on-disk form shows up as a failing test.
const keyOf = token => `sha256:${crypto.createHash('sha256').update(token).digest('hex')}`;
const withCookie = token => ({ headers: { cookie: `theme=dark; capcom=${token}; other=1` } });

test('the cookie keeps its flags, and lasts as long as the token has left', () => {
  assert.equal(sessionCookie('abc', 60, false), 'capcom=abc; HttpOnly; SameSite=Lax; Max-Age=60');
  assert.equal(sessionCookie('abc', 60, true), 'capcom=abc; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
  assert.equal(sessionCookie('', 0, false), 'capcom=; HttpOnly; SameSite=Lax; Max-Age=0');

  const r = rig();
  const token = r.auth.issue(CHROME);
  assert.equal(r.auth.cookie(token, false), `capcom=${token}; HttpOnly; SameSite=Lax; Max-Age=7776000`);
  assert.equal(r.auth.cookie(token, true), `capcom=${token}; HttpOnly; SameSite=Lax; Max-Age=7776000; Secure`);
  r.tick(30 * DAY + 400);
  assert.equal(r.auth.cookie(token, false), `capcom=${token}; HttpOnly; SameSite=Lax; Max-Age=5184000`);
  assert.equal(r.auth.cookie('f'.repeat(64), false), `capcom=${'f'.repeat(64)}; HttpOnly; SameSite=Lax; Max-Age=0`);
});

test('believes X-Forwarded-Proto only from a loopback peer', () => {
  const req = (remoteAddress, proto) => ({ socket: { remoteAddress }, headers: proto === undefined ? {} : { 'x-forwarded-proto': proto } });
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(overHttps(req(peer, 'https')), true, peer);
  assert.equal(overHttps(req('127.0.0.1', 'HTTPS')), true);
  assert.equal(overHttps(req('127.0.0.1', 'http, https')), true);
  assert.equal(overHttps(req('127.0.0.1', 'https, http')), false);
  assert.equal(overHttps(req('127.0.0.1', 'http')), false);
  assert.equal(overHttps(req('127.0.0.1', undefined)), false);
  assert.equal(overHttps(req('127.0.0.1', '')), false);
  for (const peer of ['192.168.1.20', '100.64.0.7', '2001:db8::1', undefined]) assert.equal(overHttps(req(peer, 'https')), false, String(peer));
});

test('a sign-in gets a token with when it was made, last used, when it ends and which browser', () => {
  const r = rig();
  const token = r.auth.issue(CHROME);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(r.auth.check(withCookie(token)), token);
  const record = r.saved()[keyOf(token)];
  assert.deepEqual(record, {
    created: '2026-10-16T09:00:00.000Z',
    used: '2026-10-16T09:00:00.000Z',
    expires: new Date(r.now() + IDLE).toISOString(),
    device: 'Chrome 141 on macOS',
  });
  assert.equal(fs.statSync(r.file).mode & 0o777, 0o600);
});

test('turns away a cookie that is not a token it issued', () => {
  const r = rig();
  r.auth.issue(CHROME);
  for (const token of ['', 'constructor', '__proto__', 'toString', 'f'.repeat(64), undefined]) assert.equal(r.auth.check(withCookie(token)), null, String(token));
  assert.equal(r.auth.check({ headers: {} }), null);
});

test('stops 90 days after the last use, and a day short of it still works', () => {
  const r = rig();
  const unused = r.auth.issue(CHROME);
  const used = r.auth.issue(CHROME);
  r.tick(80 * DAY);
  r.auth.touch(used, CHROME);
  r.tick(9 * DAY);
  assert.equal(r.auth.check(withCookie(unused)), unused);
  assert.equal(r.auth.check(withCookie(used)), used);
  r.tick(DAY + 1);
  assert.equal(r.auth.check(withCookie(unused)), null);
  assert.equal(r.auth.check(withCookie(used)), used);
  r.tick(80 * DAY - 2);
  assert.equal(r.auth.check(withCookie(used)), used);
  r.tick(2);
  assert.equal(r.auth.check(withCookie(used)), null);
});

test('using a token pushes its end 90 days out, written and re-sent at most once a day', () => {
  const r = rig();
  const token = r.auth.issue(CHROME);
  const written = fs.readFileSync(r.file, 'utf8');
  r.tick(DAY - 1000);
  r.auth.touch(token, CHROME);
  assert.equal(r.auth.cookieDue(token), false);
  assert.equal(fs.readFileSync(r.file, 'utf8'), written);

  r.tick(1000);
  r.auth.touch(token, CHROME);
  assert.equal(r.saved()[keyOf(token)].used, new Date(r.now()).toISOString());
  assert.equal(r.saved()[keyOf(token)].expires, new Date(r.now() + IDLE).toISOString());
  assert.equal(r.saved()[keyOf(token)].created, '2026-10-16T09:00:00.000Z');
  assert.equal(r.auth.cookieDue(token), true);
  assert.equal(r.auth.cookieDue(token), false);

  r.tick(DAY - 1);
  r.auth.touch(token, CHROME);
  assert.equal(r.auth.cookieDue(token), false);
});

test('a token used every few days outlives 90 days, and one left alone does not', () => {
  const r = rig();
  const used = r.auth.issue(CHROME);
  const idle = r.auth.issue(CHROME);
  for (let day = 0; day < 240; day += 3) {
    r.tick(3 * DAY);
    if (r.auth.check(withCookie(used))) r.auth.touch(used, CHROME);
  }
  assert.equal(r.auth.check(withCookie(used)), used);
  assert.equal(r.auth.check(withCookie(idle)), null);
});

test('each use pushes the end 90 days out until 365 days after sign-in comes first, and the cookie lasts what is left', () => {
  const r = rig();
  const made = r.now();
  const token = r.auth.issue(CHROME);
  for (const [day, ends] of [[55, 145], [110, 200], [165, 255], [220, 310], [275, 365], [330, 365]]) {
    r.tick(55 * DAY);
    assert.equal(r.auth.check(withCookie(token)), token, `day ${day}`);
    r.auth.touch(token, CHROME);
    assert.equal(r.saved()[keyOf(token)].expires, new Date(made + ends * DAY).toISOString(), `used on day ${day}`);
    assert.equal(r.auth.cookie(token, false), `capcom=${token}; HttpOnly; SameSite=Lax; Max-Age=${(ends - day) * 86400}`, `cookie on day ${day}`);
  }
});

test('a token used every few days still ends 365 days after it was made, even if it was used the day before', () => {
  const r = rig();
  const token = r.auth.issue(CHROME);
  for (let day = 3; day <= 360; day += 3) {
    r.tick(3 * DAY);
    assert.equal(r.auth.check(withCookie(token)), token, `day ${day}`);
    r.auth.touch(token, CHROME);
  }
  r.tick(4 * DAY);
  assert.equal(r.auth.check(withCookie(token)), token);
  r.auth.touch(token, CHROME);
  r.tick(DAY - 1);
  assert.equal(r.auth.check(withCookie(token)), token);
  r.tick(2);
  assert.equal(r.auth.check(withCookie(token)), null);
});

test('a record with no readable creation time renews on the 90 day rule instead of failing', () => {
  const r = rig();
  const token = r.auth.issue(CHROME);
  const record = r.saved();
  delete record[keyOf(token)].created;
  fs.writeFileSync(r.file, JSON.stringify(record));
  r.tick(2 * DAY);
  r.auth.touch(token, CHROME);
  assert.equal(r.saved()[keyOf(token)].expires, new Date(r.now() + IDLE).toISOString());
});

test('keeps the first browser label, and fills one in where there was none', () => {
  const r = rig();
  const token = r.auth.issue(CHROME);
  r.tick(2 * DAY);
  r.auth.touch(token, SAFARI);
  assert.equal(r.saved()[keyOf(token)].device, 'Chrome 141 on macOS');
  const blank = r.auth.issue(undefined);
  assert.equal(r.saved()[keyOf(blank)].device, 'Unknown browser');
});

test('signs out no one when it reads the old token file, and moves them to the new shape on use', () => {
  const dir = fs.mkdtempSync(path.join(base, 'old-'));
  const now = Date.UTC(2026, 9, 16, 9, 0, 0);
  const live = 'a'.repeat(64);
  const lapsed = 'b'.repeat(64);
  fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ [live]: now + 20 * DAY, [lapsed]: now - DAY }));
  let t = now;
  const auth = makeAuth(dir, { now: () => t });
  assert.equal(auth.check(withCookie(live)), live);
  assert.equal(auth.check(withCookie(lapsed)), null);
  assert.equal(makeAuth(dir, { now: () => now + 20 * DAY - 1 }).check(withCookie(live)), live);
  assert.equal(makeAuth(dir, { now: () => now + 20 * DAY }).check(withCookie(live)), null);

  auth.touch(live, SAFARI);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8'));
  assert.deepEqual(saved[keyOf(live)], { created: new Date(now - 10 * DAY).toISOString(), used: new Date(now).toISOString(), expires: new Date(now + IDLE).toISOString(), device: 'Safari 18 on iPhone' });
  assert.equal(auth.cookieDue(live), true);

  t += 80 * DAY;
  assert.equal(makeAuth(dir, { now: () => t }).check(withCookie(live)), live);
  t += 10 * DAY;
  assert.equal(makeAuth(dir, { now: () => t }).check(withCookie(live)), null);
});

test('the token file holds nothing that works as a cookie', () => {
  const r = rig();
  const tokens = [r.auth.issue(CHROME), r.auth.issue(SAFARI)];
  const text = fs.readFileSync(r.file, 'utf8');
  for (const token of tokens) assert.ok(!text.includes(token), 'the raw token is not on disk');
  const values = [];
  const walk = v => { if (typeof v === 'string') values.push(v, v.replace(/^sha256:/, '')); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { values.push(k, k.replace(/^sha256:/, '')); walk(x); } };
  walk(r.saved());
  for (const value of values) assert.equal(r.auth.check(withCookie(value)), null, value);
  for (const token of tokens) assert.equal(r.auth.check(withCookie(token)), token);
});

test('hashes the raw tokens of a file saved before hashing on first load, and keeps everyone signed in', () => {
  const dir = fs.mkdtempSync(path.join(base, 'raw-'));
  const file = path.join(dir, 'tokens.json');
  const now = Date.UTC(2026, 9, 16, 9, 0, 0);
  const current = 'c'.repeat(64);
  const older = 'd'.repeat(64);
  const record = { created: new Date(now - DAY).toISOString(), used: new Date(now - DAY).toISOString(), expires: new Date(now + 89 * DAY).toISOString(), device: 'Chrome 141 on macOS' };
  fs.writeFileSync(file, JSON.stringify({ [current]: record, [older]: now + 20 * DAY }));
  const auth = makeAuth(dir, { now: () => now });

  assert.equal(auth.check(withCookie(current)), current);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes(current) && !text.includes(older), 'the first load rewrote the file');
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), [keyOf(current), keyOf(older)].sort());
  assert.deepEqual(JSON.parse(text)[keyOf(current)], record);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(auth.check(withCookie(older)), older);
  assert.equal(makeAuth(dir, { now: () => now }).check(withCookie(current)), current, 'a restart reads the hashed file');
  assert.equal(auth.check(withCookie(keyOf(current))), null, 'the hashed key copied as a cookie');

  writePassword(dir, 'a different long password');
  assert.equal(auth.check(withCookie(current)), null, 'set-password still signs everyone out');
});

test('forgets a token that is revoked', () => {
  const r = rig();
  const token = r.auth.issue(CHROME);
  const other = r.auth.issue(CHROME);
  r.auth.revoke(token);
  r.auth.revoke('not-a-token');
  assert.equal(r.auth.check(withCookie(token)), null);
  assert.equal(r.auth.check(withCookie(other)), other);
  assert.deepEqual(Object.keys(r.saved()), [keyOf(other)]);
});

test('drops expired tokens from the file the next time one is issued', () => {
  const r = rig();
  const old = r.auth.issue(CHROME);
  r.tick(IDLE + DAY);
  const fresh = r.auth.issue(CHROME);
  assert.deepEqual(Object.keys(r.saved()), [keyOf(fresh)]);
  assert.equal(r.auth.check(withCookie(old)), null);
});

test('a new password signs every browser out, even while the server is running', () => {
  const r = rig();
  const token = r.auth.issue(CHROME);
  assert.equal(r.auth.check(withCookie(token)), token);
  writePassword(r.dir, 'a different long password');
  assert.equal(r.auth.check(withCookie(token)), null);
  assert.equal(r.auth.issue(CHROME).length, 64);
});

test('a new password also removes every passkey but keeps the install handle, and leaves a file that only the owner can read', () => {
  const r = rig();
  const file = path.join(r.dir, 'passkeys.json');
  writePassword(r.dir, 'a different long password');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { passkeys: [] });

  fs.writeFileSync(file, JSON.stringify({ user: 'a-handle', passkeys: [{ id: 'abc' }, { id: 'def' }] }));
  writePassword(r.dir, 'yet another long password');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { user: 'a-handle', passkeys: [] });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(r.dir).filter(name => name.endsWith('.tmp')), []);

  fs.writeFileSync(file, '{"user": "a-handle", "passkeys": [{"id": "abc"}');
  writePassword(r.dir, 'one more long password');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { passkeys: [] });
});

test('checks the password, and locks after ten failures from any mix of password and passkey', () => {
  const r = rig();
  writePassword(r.dir, 'correct horse battery');
  assert.equal(r.auth.hasPassword(), true);
  assert.deepEqual(r.auth.verify('correct horse battery'), { ok: true });
  assert.deepEqual(r.auth.verify('wrong'), { ok: false });
  assert.deepEqual(r.auth.verify(undefined), { ok: false });
  for (let i = 0; i < 8; i++) r.auth.fail();
  assert.equal(r.auth.locked(), false);
  assert.deepEqual(r.auth.verify('wrong again'), { ok: false });
  assert.equal(r.auth.locked(), true);
  assert.deepEqual(r.auth.verify('correct horse battery'), { ok: false, locked: true });
  r.tick(15 * 60_000 + 1);
  assert.equal(r.auth.locked(), false);
  assert.deepEqual(r.auth.verify('correct horse battery'), { ok: true });
});

test('keeps each instance own failures', () => {
  const a = rig();
  const b = rig();
  for (let i = 0; i < 10; i++) a.auth.fail();
  assert.equal(a.auth.locked(), true);
  assert.equal(b.auth.locked(), false);
});

test('names a browser from its User-Agent', () => {
  const cases = [
    [CHROME, 'Chrome 141 on macOS'],
    [SAFARI, 'Safari 18 on iPhone'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'Safari 18 on macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1', 'Chrome 141 on iPhone'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15', 'Firefox 132 on iPhone'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox 132 on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'Edge 141 on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/115.0.0.0', 'Opera 115 on Windows'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', 'Chrome 141 on Android'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'Chrome 141 on Linux'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36', 'Chrome 141 on macOS'],
    ['Dalvik/2.1.0 (Linux; U; Android 14)', 'Browser on Android'],
    ['curl/8.4.0', 'Unknown browser'],
    ['', 'Unknown browser'],
    [undefined, 'Unknown browser'],
  ];
  for (const [agent, label] of cases) assert.equal(deviceLabel(agent), label, String(agent));
  assert.ok(deviceLabel('x'.repeat(100_000) + ' Chrome/141.0.0.0').length < 40);
});
