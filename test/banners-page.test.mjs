// Run with `npm test`. The sign-in and update banners in the real page against the real server: stacked in the order sign-in, update, with the roles
// and labels a screen reader reads, and a sign-in that waits on the Mac and clears when it is approved. The update button is never pressed here, since
// pressing it would ask the restart helper to run. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, restart, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 60_000;
const DAY = 86_400_000;
let browser;

before(async () => {
  if (!skip) browser = await launch(chromium);
});
after(async () => {
  await browser?.close();
});

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });

// A clone of a bare origin that holds one commit the clone lacks: a change to lib/, so the update needs a restart.
function checkout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-banners-page-'));
  const origin = path.join(dir, 'origin.git');
  const author = path.join(dir, 'author');
  const live = path.join(dir, 'live');
  git(dir, 'init', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '--quiet', origin, author);
  git(author, 'checkout', '-q', '-b', 'main');
  fs.mkdirSync(path.join(author, 'lib'));
  fs.writeFileSync(path.join(author, 'server.mjs'), '');
  fs.writeFileSync(path.join(author, 'lib/a.mjs'), 'export const a = 1;\n');
  git(author, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'add', '-A');
  git(author, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-q', '-m', 'First (#1)');
  git(author, 'push', '-q', 'origin', 'main');
  git(dir, 'clone', '--quiet', origin, live);
  fs.writeFileSync(path.join(author, 'lib/a.mjs'), 'export const a = 2;\n');
  git(author, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-q', '-am', 'Change the server (#2)');
  git(author, 'push', '-q', 'origin', 'main');
  return live;
}

// A server started again after its home was given `files`, with the checkout `root` to update.
async function open(files, root = path.join(os.tmpdir(), 'capcom-banners-page-none')) {
  const first = await start({ env: { CAPCOM_UPDATE_ROOT: root, CAPCOM_UPDATE_DELAY_MS: '50' } });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(first.home, name), text);
  return restart(first);
}

async function listPage(t, s) {
  const page = await browser.open(s.origin);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || !!document.querySelector('.list-foot'))`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
  }
  await page.until(`!document.querySelector('#boot') && !!document.querySelector('.list-foot')`, 10_000);
  return page;
}

const banners = `[...document.querySelectorAll('aside.offer')].map(a => ({
  label: document.getElementById(a.getAttribute('aria-labelledby'))?.textContent.trim(),
  labelledby: a.getAttribute('aria-labelledby'),
  tone: a.dataset.tone ?? null,
  icon: !!a.querySelector('h2 svg'),
  alert: a.querySelector('[role=alert]') !== null,
  status: a.querySelector('[role=status]') !== null,
  items: [...a.querySelectorAll('li')].map(li => li.textContent.trim()),
  buttons: [...a.querySelectorAll('button')].map(b => ({ name: b.textContent.trim(), disabled: b.disabled })),
}))`;

test('a sign-in ending in three days and a waiting change are stacked sign-in first, each labelled by its title', { skip, timeout }, async t => {
  const s = await open({ 'keychain-expiry': String(Date.now() + 3 * DAY) }, checkout());
  const page = await listPage(t, s);
  await page.until(`document.querySelectorAll('aside.offer').length >= 2`, 15_000);
  const [login, update] = await page.evaluate(banners);
  assert.match(login.label, /^Claude's sign-in ends in [23] days$/);
  assert.deepEqual([login.labelledby, login.tone, login.icon, login.alert, login.status, login.buttons], ['banner-login-title', null, false, true, true, [{ name: 'Sign in on the Mac', disabled: false }]]);
  assert.deepEqual([update.label, update.labelledby, update.alert, update.status, update.items, update.buttons], [
    '1 merged change is waiting', 'banner-update-title', true, true, ['Change the server'], [{ name: 'Update and restart', disabled: false }],
  ]);
  const text = await page.evaluate(`document.querySelector('aside.offer .offer-text').textContent`);
  assert.match(text, /^It ends on \w{3} \d{1,2} \w{3}, \d\d:\d\d\. Chats and routines stop until you sign in again\. Signing in now starts a fresh four weeks\.$/);
  const order = await page.evaluate(`[...document.querySelectorAll('.offer')].map(a => a.getAttribute('aria-labelledby'))`);
  assert.deepEqual(order.slice(0, 2), ['banner-login-title', 'banner-update-title']);
  if (order.length > 2) assert.equal(order[2], 'offer-title', 'the passkey offer comes last');
});

test('a signed out Claude is a warning with an icon, and signing in waits on the Mac and clears once it is approved', { skip, timeout }, async t => {
  const s = await open({ 'keychain-expiry': 'missing', 'auth-state.json': JSON.stringify({ loggedIn: false, hold: true }) });
  const page = await listPage(t, s);
  await page.until(`!!document.querySelector('aside.offer[data-tone=warning]')`, 15_000);
  const [login] = await page.evaluate(banners);
  assert.deepEqual([login.label, login.tone, login.icon, login.buttons], ['Claude is signed out', 'warning', true, [{ name: 'Sign in on the Mac', disabled: false }]]);
  assert.equal(await page.evaluate(`document.querySelector('aside.offer .offer-text').textContent`), 'Every chat and routine fails until you sign in again.');

  await page.click('aside.offer .btn');
  await page.until(`document.querySelector('aside.offer .offer-progress')?.textContent === 'Approve the sign-in page in the browser on the Mac.'`);
  assert.deepEqual((await page.evaluate(banners))[0].buttons, [{ name: 'Waiting for the Mac', disabled: true }]);
  assert.equal(await page.evaluate(`document.querySelector('aside.offer .offer-progress').getAttribute('role')`), 'status');

  fs.writeFileSync(path.join(s.home, 'auth-release'), '');
  await page.until(`!document.querySelector('aside.offer[data-tone=warning]')`, 15_000);
});
