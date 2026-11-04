// Run with `npm test`. Ghost as the look on every device, in a real page: first public/index.html with no app script, where the root attribute and the theme colours are
// Ghost's as the head ends whatever the browser has stored, then the real app signed in to the real server.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChromium, launch, notFound, serve } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const INDEX = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const APP = '<script type="module" src="app.js"></script>';
const GHOST = ['#f6f6f6', '#181818'];

// Read as the head ends, before the body is parsed and before any module can set them.
const BOOTED = `<script>window.booted = { look: document.documentElement.dataset.look ?? null, colours: [...document.querySelectorAll('meta[name="theme-color"]')].map(meta => meta.content) }</script>`;
// Without the app script the list in #boot stays as the HTML has it.
const PAGE = INDEX.replace('</head>', () => `${BOOTED}</head>`).replace(APP, () => '');

const chromium = findChromium();
const skip = chromium ? false : notFound();
// A DevTools call has no deadline of its own, so without one a page that hangs would hold up the whole run.
const timeout = 20_000;
let site;
let app;
let browser;

before(async () => {
  if (skip) return;
  site = await serve({ '/': PAGE, '/storage': '<!doctype html>' });
  app = await start();
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

// The script that leaves `stored` in capcom.look as it is written to storage, or none for null.
const store = stored => stored === null ? `localStorage.removeItem('capcom.look')` : `localStorage.setItem('capcom.look', ${JSON.stringify(stored)})`;

// A new page with `stored` in capcom.look. Every page shares the browser's storage, so each test sets it first.
async function lookPage(t, stored) {
  const setter = await browser.open(`${site.origin}/storage`);
  await setter.until(`document.readyState === 'complete'`);
  await setter.evaluate(store(stored));
  await setter.close();
  const page = await browser.open(`${site.origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete'`);
  return page;
}

const LOGIN = `!!document.querySelector('#password')`;
// The list the app draws, which has taken the place of the static copy of it in #boot.
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

// A page on the real server, signed in through its login page with the passkey offer sent away by its Not now button. The browser keeps the cookie and the
// answer to the offer, so only the first page has either to do.
async function appPage(t) {
  const page = await browser.open(`${app.origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (!(await page.evaluate(LOGIN))) return page;
  await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
  await page.click('.gate-actions button[type=submit]');
  await page.until(LIST, 10_000);
  // The offer comes a moment after the sign-in lands, and only where passkeys work, so a browser that cannot use them is not offered one.
  if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
    await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
    await page.until(`!document.querySelector('.offer')`);
  }
  return page;
}

// A page on the real server that loads with `stored` in capcom.look: one page sets it and the next, opened after, is the one that has it at load.
async function storedAppPage(t, stored) {
  const setter = await appPage(t);
  await setter.evaluate(store(stored));
  return appPage(t);
}

const booted = page => page.evaluate('window.booted');
const shown = page => page.evaluate(`({
  look: document.documentElement.dataset.look ?? null,
  colours: [...document.querySelectorAll('meta[name="theme-color"]')].map(meta => meta.content),
})`);
// The width and height the brand mark and the emblem take in the page, which are zero while the standard look hides them.
const sizes = page => page.evaluate(`['.brand-mark', '.emblem'].map(selector => (r => [r.width, r.height])(document.querySelector(selector).getBoundingClientRect()))`);
const takeSpace = async page => {
  for (const [width, height] of await sizes(page)) assert.ok(width > 0 && height > 0, `a shell drawing is ${width} by ${height}`);
};

test('the test page is index.html with a snapshot at the end of its head and no app script', () => {
  assert.ok(INDEX.includes(APP) && INDEX.includes('</head>'));
  assert.ok(PAGE.includes(BOOTED) && !PAGE.includes(APP));
});

for (const stored of [null, '"ghost"', '"standard"', '"neon"', '{']) {
  test(`the root is Ghost and both theme colours are Ghost's as the head ends, with ${stored === null ? 'no look' : stored} stored`, { skip, timeout }, async t => {
    const page = await lookPage(t, stored);
    assert.deepEqual(await booted(page), { look: 'ghost', colours: GHOST });
    assert.deepEqual(await shown(page), { look: 'ghost', colours: GHOST });
    assert.deepEqual(page.problems, []);
  });
}

test('the boot list holds the brand mark first in the brand and only Routines and a held Account button in the footer', { skip, timeout }, async t => {
  const page = await lookPage(t, null);
  assert.deepEqual(await page.evaluate(`[...document.querySelector('#boot .brand').children].map(el => el.className || el.tagName)`), ['brand-mark', 'H1']);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#boot .list-foot .btn')].map(el => [el.getAttribute('aria-label') ?? el.textContent, !!el.disabled])`), [['Routines', false], ['Account', true]]);
  assert.deepEqual(page.problems, []);
});

test('the boot list holds a brand mark and an emblem that take space', { skip, timeout }, async t => {
  const page = await lookPage(t, null);
  await takeSpace(page);
  assert.deepEqual(page.problems, []);
});

for (const stored of [null, '"standard"']) {
  test(`the real app's root is Ghost and its theme colours are Ghost's once it is up, with ${stored === null ? 'no look' : stored} stored`, { skip, timeout }, async t => {
    const page = await storedAppPage(t, stored);
    assert.deepEqual(await shown(page), { look: 'ghost', colours: GHOST });
    assert.deepEqual(page.problems, []);
  });
}

test('the real list draws the shell as the brand mark first in the brand and only Routines and the Account menu in the footer', { skip, timeout }, async t => {
  const page = await appPage(t);
  assert.deepEqual(await page.evaluate(`[...document.querySelector('.brand').children].map(el => el.getAttribute('class') ?? el.localName)`), ['shell brand-mark', 'h1']);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.list-foot .btn')].map(el => [el.getAttribute('aria-label') ?? el.textContent, !!el.disabled])`), [['Routines', false], ['Account', false]]);
  assert.deepEqual(page.problems, []);
});

test('in the real app the brand mark and the emblem take space', { skip, timeout }, async t => {
  const page = await appPage(t);
  await takeSpace(page);
  assert.deepEqual(page.problems, []);
});
