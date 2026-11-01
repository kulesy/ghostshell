// Run with `npm test`. Each session's unsent message in the real page: it stays in the session it was typed in when another chat opens, comes back
// after a reload, and goes once the session is archived. It needs Playwright's Chromium headless shell, and every test skips with a reason that
// names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const SESSIONS = [
  { id: 's1', title: 'First', ago: 1 },
  { id: 's2', title: 'Second', ago: 2 },
];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let browser;

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const BOX = `document.querySelector('#text')?.value`;
const SAVED = `JSON.parse(localStorage.getItem('capcom.drafts') ?? '{}')`;

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

// Opens a chat and waits for its box, which must be a new one: the old box is gone first.
async function openChat(page, hash) {
  await page.evaluate(`document.querySelector('#text')?.setAttribute('data-old', '')`);
  await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.until(`!!document.querySelector('#text:not([data-old])') && !!document.querySelector('.chat-head')`);
}

// Reloads after the evaluate has answered, so the navigation cannot cut it off, and signs in again if the page asks.
async function reload(page) {
  await page.evaluate('setTimeout(() => location.reload(), 50), true');
  await new Promise(resolve => setTimeout(resolve, 500));
  await login(page);
}

const type = async (page, text) => {
  await page.click('#text');
  await page.insert(text);
};

test('a message stays in the session it was typed in, each session and the new session page keep their own, and a reload brings them back', { skip, timeout }, async t => {
  const page = await browser.open(`${app.origin}/`, {});
  t.after(() => page.close());
  await login(page);
  await openChat(page, '#/s/s1');
  await type(page, 'for the first');
  await openChat(page, '#/s/s2');
  assert.equal(await page.evaluate(BOX), '', 'the second session opens empty');
  await type(page, 'for the second');
  await openChat(page, '#/new');
  assert.equal(await page.evaluate(BOX), '');
  await type(page, 'for a new one');
  await openChat(page, '#/s/s1');
  assert.equal(await page.evaluate(BOX), 'for the first');
  await reload(page);
  await page.until(`${BOX} === 'for the first'`);
  await openChat(page, '#/s/s2');
  assert.equal(await page.evaluate(BOX), 'for the second');
  await openChat(page, '#/new');
  assert.equal(await page.evaluate(BOX), 'for a new one');
  assert.deepEqual(page.problems, []);
});

test('an archived session\'s message is dropped once another chat is open', { skip, timeout }, async t => {
  const page = await browser.open(`${app.origin}/`, {});
  t.after(() => page.close());
  await login(page);
  await page.evaluate(`localStorage.removeItem('capcom.drafts')`);
  await reload(page);
  await openChat(page, '#/s/s2');
  await type(page, 'about to go');
  await page.until(`${SAVED}.s2 === 'about to go'`);
  await page.click('#archiveButton');
  await page.until(`document.querySelector('#archiveButton')?.getAttribute('aria-label') === 'Unarchive'`);
  assert.equal(await page.evaluate(`${SAVED}.s2`), 'about to go', 'the open chat keeps its draft');
  await openChat(page, '#/s/s1');
  await page.until(`!('s2' in ${SAVED})`);
  assert.deepEqual(page.problems, []);
});
