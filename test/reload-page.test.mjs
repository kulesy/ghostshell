// Run with `npm test`. A page left open across a restart onto a new commit: an idle one reloads itself, one with a message typed shows the
// reload bar and its button reloads, and a page opened after the restart shows none. It needs Playwright's Chromium headless shell, and every
// test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, PASSWORD, restart, signIn, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 60_000;
let browser;

before(async () => {
  if (!skip) browser = await launch(chromium);
});
after(async () => {
  await browser?.close();
});

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();

const freePort = () => new Promise(resolve => {
  const probe = net.createServer().listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

// A server on a checkout at commit A, on a port a restart keeps, and a way to move the checkout to commit B and start the server again.
async function onCommits() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-reload-page-'));
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'server.mjs'), '');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'A');
  const port = await freePort();
  const s = await start({ env: { CAPCOM_UPDATE_ROOT: root, PORT: String(port) } });
  const { token } = await signIn(s);
  const toB = async () => {
    git(root, 'commit', '-q', '--allow-empty', '-m', 'B');
    return restart(s);
  };
  return { origin: s.origin, token, toB, a: git(root, 'rev-parse', 'HEAD') };
}

async function open(t, origin) {
  const page = await browser.open(origin);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || !!document.querySelector('.list-foot'))`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
  }
  await page.until(`!document.querySelector('#boot') && !!document.querySelector('.list-foot')`, 10_000);
  // A page nobody touches runs its effects a moment late, and the first one is where the page notes its commit.
  await page.evaluate(`new Promise(done => { requestAnimationFrame(() => setTimeout(done, 50)); setTimeout(done, 500); })`);
  return page;
}

// The page reads the list again when it comes back into view, which is what a person returning to the tab does.
const comeBack = page => page.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);

const stamp = page => page.evaluate(`window.__stamp ??= Math.random()`);

test('GET api/sessions carries the commit the server started on', { skip, timeout }, async () => {
  const { origin, token, a } = await onCommits();
  const body = await (await fetch(`${origin}/api/sessions`, { headers: as(token) })).json();
  assert.equal(body.commit, a);
});

test('an idle page reloads itself once the server is on a new commit, whatever stale draft another session holds', { skip, timeout }, async t => {
  const { origin, toB } = await onCommits();
  const page = await open(t, origin);
  await page.evaluate(`import('/ui/draft.js').then(d => d.setDraftText('some-other-session', 'an old draft'))`);
  const before = await stamp(page);
  await toB();
  await comeBack(page);
  await page.until(`window.__stamp === undefined && !!document.querySelector('.list-foot')`, 20_000);
  assert.notEqual(await stamp(page), before);
  assert.equal(await page.evaluate(`!!document.querySelector('.reload-bar')`), false);
});

test('a page with a message typed shows the reload bar, and Reload reloads it', { skip, timeout }, async t => {
  const { origin, toB } = await onCommits();
  const page = await open(t, origin);
  await page.evaluate(`location.hash = '#/new'`);
  await page.until(`!!document.querySelector('#text')`, 10_000);
  await page.click('#text');
  await page.insert('half a message');
  const before = await stamp(page);
  await toB();
  await comeBack(page);
  await page.until(`!!document.querySelector('.reload-bar')`, 20_000);
  const bar = await page.evaluate(`({ title: document.querySelector('.reload-bar h2').textContent, buttons: [...document.querySelectorAll('.reload-bar button')].map(b => b.textContent) })`);
  assert.deepEqual(bar, { title: 'GhostShell was updated', buttons: ['Reload'] });
  assert.equal(await stamp(page), before, 'the page was not reloaded');
  await page.click('.reload-bar button');
  await page.until(`window.__stamp === undefined && !!document.querySelector('#text')`, 20_000);
  assert.equal(await page.evaluate(`!!document.querySelector('.reload-bar')`), false);
});

test('a page opened after the restart shows no bar', { skip, timeout }, async t => {
  const { origin, toB } = await onCommits();
  await toB();
  const page = await open(t, origin);
  await comeBack(page);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(await page.evaluate(`!!document.querySelector('.reload-bar')`), false);
});
