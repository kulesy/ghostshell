// Run with `npm test`. A session opened inside a folded family opens the family in a real page, once for each time the session is opened, so
// a session started from a chip into a folded family is in view and a family folded afterwards stays folded. It needs Playwright's Chromium
// headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
// A DevTools call has no deadline of its own, so without one a page that hangs would hold up the whole run.
const timeout = 30_000;
let app;
let browser;

// Maker made a chip that started Made, so Made shows under Maker, and Loner is a session on its own. The list goes A to Z, so Loner comes first.
const SESSIONS = [{ id: 'maker', title: 'Maker', ago: 5 }, { id: 'made', title: 'Made', source: 'capcom', ago: 1 }, { id: 'loner', title: 'Loner', ago: 9 }];
const FAMILY = '#family-maker';

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, chips: [{ sessionId: 'maker', startedId: 'made', status: 'started' }] });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

// The page at `hash`, signed in through the login page, with Maker's family folded the way this browser remembers it.
async function listPage(t, hash) {
  const first = await browser.open(`${app.origin}/`);
  await first.until(`document.readyState === 'complete' && !!document.querySelector('#password, .list-foot')`);
  if (await first.evaluate(`!!document.querySelector('#password')`)) {
    await first.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await first.click('.gate-actions button[type=submit]');
    await first.until(`!!document.querySelector('.list-foot')`, 10_000);
  }
  await first.evaluate(`localStorage.setItem('capcom.folded', ${JSON.stringify(JSON.stringify({ maker: true }))})`);
  await first.close();
  const page = await browser.open(`${app.origin}/${hash}`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && !!document.querySelector('.list-foot')`);
  return page;
}

const rowsIn = page => page.evaluate(`[...document.querySelectorAll('#sections a.row')].map(a => a.dataset.id)`);

// Loads the list again as a visible tab does every 15 seconds, and resolves once the answer has been drawn.
async function refresh(page) {
  await page.evaluate(`(() => {
    window.loaded = 0;
    const fetched = window.fetch;
    window.fetch = (...args) => fetched(...args).finally(() => setTimeout(() => { window.loaded++; }, 100));
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  await page.until(`window.loaded > 0`);
}

test('a session opened inside a folded family opens the family, and the family folded again while it is open stays folded after a refresh', { skip, timeout }, async t => {
  const page = await listPage(t, '#/s/made');
  await page.until(`!!document.querySelector('${FAMILY}')`);
  assert.deepEqual(await rowsIn(page), ['loner', 'maker', 'made']);

  await page.click('.has-fold > .fold');
  await page.until(`!document.querySelector('${FAMILY}')`);
  await refresh(page);
  assert.equal(await page.evaluate(`!!document.querySelector('${FAMILY}')`), false, 'a refresh does not open it again');
  assert.deepEqual(page.problems, []);
});

test('a family stays folded while a session outside it is open, and opens when a session in it is opened', { skip, timeout }, async t => {
  const page = await listPage(t, '#/s/loner');
  await page.until(`!!document.querySelector('#sections a.row[data-id="loner"]')`);
  assert.deepEqual(await rowsIn(page), ['loner', 'maker']);

  await page.evaluate(`location.hash = '#/s/made'`);
  await page.until(`!!document.querySelector('${FAMILY}')`);
  assert.deepEqual(await rowsIn(page), ['loner', 'maker', 'made']);
  assert.deepEqual(page.problems, []);
});
