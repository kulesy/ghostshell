// Run with `npm test`. A session whose handoff is saved shows a quiet mark in the list and a line by the prompt box, and the next message moves the page to the fresh
// session, whose own page links back. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start, until } from './harness.mjs';

const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 60_000;
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

async function appPage(t, origin, hash) {
  const page = await browser.open(`${origin}/${hash}`, {});
  t.after(() => page.close());
  await login(page);
  if ((await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.until(`!!document.querySelector('.chat-head')`);
  return page;
}

const type = (page, text) => page.evaluate(`(el => { el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); })(document.querySelector('#text'))`);
const events = s => {
  const f = path.join(s.state, 'cache-handoffs.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).event) : [];
};

test('a saved handoff shows a mark on the row and a line by the prompt box, and the next message moves the page to the fresh session', { skip, timeout }, async t => {
  const s = await start({
    sessions: [{ id: ID, title: 'Fix it', ago: 52, reply: { ago: 52 } }], claude: true, handoffs: { [ID]: 52 },
    env: { CAPCOM_CACHE_HANDOFF_SCALE: '600' },
  });
  await until(() => events(s).includes('written'), 20_000);
  const page = await appPage(t, s.origin, `#/s/${ID}`);

  await page.until(`!!document.querySelector('#handoffNotice')`);
  const notice = await page.evaluate(`document.querySelector('#handoffNotice').textContent`);
  assert.match(notice, /Handoff saved at/);
  assert.match(notice, /fresh session/);
  await page.until(`!!document.querySelector('.row-dot[data-dot="cold"]')`);
  assert.match(await page.evaluate(`document.querySelector('.row-dot[data-dot="cold"]').closest('[title], [aria-label]')?.outerHTML ?? ''`), /Handoff saved/);

  await type(page, 'Carry on');
  await page.click('#send');
  await page.until(`location.hash === '#/s/begun-by-the-fake'`, 20_000);
  await page.until(`!!document.querySelector('#handoffNotice')`);
  assert.match(await page.evaluate(`document.querySelector('#handoffNotice').textContent`), /carries on from an earlier one/);

  await page.evaluate(`location.hash = '#/s/${ID}'`);
  await page.until(`/carries on in a fresh session/.test(document.querySelector('#handoffNotice')?.textContent ?? '')`);
  await page.evaluate(`[...document.querySelectorAll('#handoffNotice a')].find(a => a.textContent === 'Open it').click()`);
  await page.until(`location.hash === '#/s/begun-by-the-fake'`);
  assert.deepEqual(page.problems, []);
});
