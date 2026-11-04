// Run with `npm test`. The permission mode of a message sent before the page knows the session's status, in the real page against the real server and a
// fake CLI: the picker says Mode until it knows, the message names no mode so the session runs in its own, and a mode picked by hand still wins.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { cliCalls, PASSWORD, start, until } from './harness.mjs';

const SESSIONS = [{ id: 'plans', title: 'Runs in plan mode', ago: 1, fields: { permissionMode: 'plan' } }];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let browser;

before(async () => {
  if (skip) return;
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const SHOWN = `document.querySelector('#mode').parentElement.querySelector('[aria-hidden]').textContent`;
const MODEL = `document.querySelector('#model').textContent`;
const flagOf = (argv, name) => argv[argv.indexOf(name) + 1];
const startsOf = s => cliCalls(s).filter(c => c.started);

async function login(page) {
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (!(await page.evaluate(LOGIN))) return;
  await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
  await page.click('.gate-actions button[type=submit]');
  await page.until(LIST, 10_000);
  if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
    await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
    await page.until(`!document.querySelector('.offer')`);
  }
}

// Opens the page with what it asks for the status held back: a session's messages, which the live stream waits for, or a new session's defaults.
// `window.__posts` lists what the page posts as [url, body], and `window.__release()` lets the held answers through.
async function held(t, s, hash) {
  const page = await browser.open(`${s.origin}/`, {});
  t.after(() => page.close());
  await login(page);
  await page.evaluate(`(() => {
    const real = window.fetch;
    const gate = new Promise(resolve => { window.__release = resolve; });
    window.__posts = [];
    window.fetch = async (url, init) => {
      const address = String(url);
      if (init?.method === 'POST') window.__posts.push([address, JSON.parse(init.body)]);
      if (/\\/messages(\\?|$)|^api\\/defaults/.test(address)) await gate;
      return real(url, init);
    };
  })()`);
  await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.until(`!!document.querySelector('#text') && !!document.querySelector('#mode')`);
  return page;
}

async function say(page, text) {
  await page.click('#text');
  await page.insert(text);
  await page.until(`!document.querySelector('#send').disabled`);
  await page.click('#send');
}

const userSettings = (s, settings) => {
  fs.mkdirSync(path.join(s.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(s.home, '.claude', 'settings.json'), JSON.stringify(settings));
};

test('a message sent before an existing session\'s status loads names no mode and runs in the session\'s own, and the picker says Mode until then', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, claude: true });
  const page = await held(t, s, '#/s/plans');
  assert.equal(await page.evaluate(SHOWN), 'Mode');
  assert.equal(await page.evaluate(`document.querySelector('#mode').disabled`), true);
  await say(page, 'hello early');
  await until(() => startsOf(s).length === 1, 15_000);
  assert.equal(flagOf(startsOf(s)[0].started, '--permission-mode'), 'plan');
  const [, body] = await page.evaluate('window.__posts').then(posts => posts.find(([url]) => url.endsWith('/send')));
  assert.equal('mode' in body, false);
  await page.evaluate('window.__release()');
  await page.until(`${SHOWN} === 'Plan'`);
  assert.equal(await page.evaluate(`document.querySelector('#mode').disabled`), false);
  assert.equal(await page.evaluate(`document.querySelector('#mode').value`), 'plan', 'the picker itself rests on it too');
  assert.deepEqual(page.problems, []);
});

test('a message sent before a new session\'s defaults land names no mode and starts in the mode a new session gets, with the picker saying Mode and open', { skip, timeout }, async t => {
  const s = await start({ claude: true });
  userSettings(s, { permissions: { defaultMode: 'acceptEdits' }, model: 'claude-opus-5-5' });
  const page = await held(t, s, '#/new');
  assert.equal(await page.evaluate(SHOWN), 'Mode');
  assert.equal(await page.evaluate(`document.querySelector('#mode').disabled`), false, 'a pick is possible while the defaults load');
  await say(page, 'hello early');
  await until(() => startsOf(s).length === 1, 15_000);
  assert.equal(flagOf(startsOf(s)[0].started, '--permission-mode'), 'acceptEdits');
  const [, body] = await page.evaluate('window.__posts').then(posts => posts.find(([url]) => url === 'api/new'));
  assert.equal('mode' in body, false);
  await page.evaluate('window.__release()');
  assert.deepEqual(page.problems, []);
});

test('a new session shows the mode of its defaults once they land and sends it', { skip, timeout }, async t => {
  const s = await start({ claude: true });
  userSettings(s, { permissions: { defaultMode: 'acceptEdits' }, model: 'claude-opus-5-5' });
  const page = await held(t, s, '#/new');
  await page.evaluate('window.__release()');
  await page.until(`${SHOWN} === 'Accept edits'`);
  await say(page, 'hello late');
  await until(() => startsOf(s).length === 1, 15_000);
  assert.equal(flagOf(startsOf(s)[0].started, '--permission-mode'), 'acceptEdits');
  assert.deepEqual(page.problems, []);
});

test('a mode picked in a new session before the defaults land wins over them, Manual included, and is the mode the session starts in', { skip, timeout }, async t => {
  for (const picked of [['manual', 'Manual'], ['plan', 'Plan']]) {
    const s = await start({ claude: true });
    userSettings(s, { permissions: { defaultMode: 'acceptEdits' }, model: 'claude-opus-5-5' });
    const page = await held(t, s, '#/new');
    assert.equal(await page.evaluate(`document.querySelector('#mode').selectedIndex`), -1, 'the box rests on nothing, so choosing the first option is a change');
    await page.evaluate(`(el => { el.value = ${JSON.stringify(picked[0])}; el.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#mode'))`);
    assert.equal(await page.evaluate(SHOWN), picked[1]);
    await page.evaluate('window.__release()');
    await page.until(`${MODEL} !== 'Model'`);
    assert.equal(await page.evaluate(SHOWN), picked[1], 'the defaults leave the pick alone');
    assert.equal(await page.evaluate(`document.querySelector('#mode').value`), picked[0]);
    await say(page, 'hello');
    await until(() => startsOf(s).length === 1, 15_000);
    assert.equal(flagOf(startsOf(s)[0].started, '--permission-mode'), picked[0]);
    assert.deepEqual(page.problems, []);
  }
});
