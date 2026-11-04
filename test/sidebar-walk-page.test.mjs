// Run with `npm test`. Walking the sessions in the sidebar with the arrow keys in the real page: the plain up and down arrows open the session they
// land on and keep the focus in the list, a held key opens two sessions and not every one between, Option or Alt with up or down walks from anywhere
// including the prompt box without losing a draft, and a selection, a narrow window, a dialog or a name box turn the opening off. It needs
// Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const ALT = 1;
const CTRL = 2;
const SHIFT = 8;
const SESSIONS = [
  { id: 'pin', title: 'Pinned one', pinned: true, ago: 1 },
  { id: 'work', title: 'Work one', group: 'cg-work', ago: 2 },
  { id: 'boss', title: 'Boss', ago: 3 },
  { id: 'kid', title: 'Kid', parent: 'boss', ago: 4 },
  { id: 'kid2', title: 'Kid two', parent: 'boss', ago: 5 },
  { id: 'loose', title: 'Loose', ago: 6 },
  { id: 'inside', title: 'Inside the project', group: 'cg-p', ago: 7 },
];
const GROUPS = [{ id: 'cg-work', name: 'Work' }, { id: 'cg-p', name: 'Inside', project: 'cp-x' }];
const LAYOUT = { projects: [{ id: 'cp-x', name: 'Capcom' }] };

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let browser;

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, groups: GROUPS, layout: LAYOUT, claude: true });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const ROW = id => `a.row[data-id="${id}"]`;
const ROWS = `[...document.querySelectorAll('a.row[data-id]')].map(a => a.dataset.id)`;
const FOCUSED = `document.activeElement.dataset?.id ?? document.activeElement.id ?? document.activeElement.className`;
const OPEN = `location.hash.replace('#/s/', '')`;

async function appPage(t, hash = '', { phone = false, scope = null, width } = {}) {
  const setter = await browser.open(`${app.origin}/healthz`);
  await setter.evaluate(`['collapsed', 'folded', 'drafts'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', ${JSON.stringify(JSON.stringify(scope))})`);
  await setter.close();
  const page = await browser.open(`${app.origin}/${hash}`, { phone });
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (await page.evaluate(LOGIN)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
    if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
      await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
      await page.until(`!document.querySelector('.offer')`);
    }
  }
  if (hash && (await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.until(`document.querySelectorAll('a.row[data-id]').length >= ${scope ? 2 : 6}`);
  if (width) await page.resize(width, 860);
  return page;
}

const focus = (page, id) => page.evaluate(`document.querySelector('${ROW(id)}').focus()`);
const pause = (page, ms = 300) => page.evaluate(`new Promise(done => setTimeout(done, ${ms}))`);
const keys = (page, key, times, init = '{}') => page.evaluate(`(() => { for (let i = 0; i < ${times}; i++) document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${init} })); })()`);
// Opens a chat and waits for its box, which must be a new one: the old box is gone first.
async function openChat(page, id) {
  await page.evaluate(`document.querySelector('#text')?.setAttribute('data-old', '')`);
  await page.evaluate(`location.hash = '#/s/${id}'`);
  await page.until(`!!document.querySelector('#text:not([data-old])') && !!document.querySelector('.chat-head')`);
}

test('down and up in the list open the session they land on and the focus stays on its row, while a header only takes the focus', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.press('ArrowDown');
  await page.until(`document.activeElement.matches('.group-head')`);
  assert.equal(await page.evaluate('location.hash'), '');
  await page.press('ArrowDown');
  await page.until(`${OPEN} === 'pin'`);
  await pause(page);
  assert.equal(await page.evaluate(FOCUSED), 'pin', 'the row keeps the focus once the chat has drawn');
  assert.equal(await page.evaluate(`document.activeElement.getAttribute('aria-current')`), 'page');
  await page.press('ArrowDown');
  await page.until(`document.activeElement.matches('.group-head')`);
  assert.equal(await page.evaluate(OPEN), 'pin', 'Work\'s header opens nothing');
  await page.press('ArrowDown');
  await page.until(`${OPEN} === 'work'`);
  await pause(page);
  assert.equal(await page.evaluate(FOCUSED), 'work');
  await page.press('ArrowUp');
  await page.until(`document.activeElement.matches('.group-head')`);
  assert.equal(await page.evaluate(OPEN), 'work');
  assert.deepEqual(page.problems, []);
});

test('Home and End and Left and Right move the focus or fold and open nothing', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/loose');
  await focus(page, 'boss');
  await page.press('ArrowLeft');
  await page.until(`!document.querySelector('${ROW('kid')}')`);
  await page.press('ArrowRight');
  await page.until(`!!document.querySelector('${ROW('kid')}')`);
  await page.press('ArrowRight');
  await page.until(`${FOCUSED} === 'kid'`);
  await page.press('End');
  await page.press('Home');
  await pause(page);
  assert.equal(await page.evaluate(OPEN), 'loose');
  assert.deepEqual(page.problems, []);
});

test('a held key opens the first session at once and the last after the pause, and none between', { skip, timeout }, async t => {
  const page = await appPage(t);
  await focus(page, 'pin');
  await page.evaluate(`window.opened = []; addEventListener('hashchange', () => opened.push(location.hash))`);
  await keys(page, 'ArrowDown', 6);
  await pause(page, 600);
  const rows = await page.evaluate(`[...document.querySelectorAll('.group-head, a.row[data-id]')].map(a => a.dataset.id ?? 'head')`);
  const landed = rows[rows.indexOf('pin') + 6];
  const opened = await page.evaluate('opened');
  assert.equal(opened.length <= 2, true, `${opened}`);
  assert.equal(opened.at(-1), `#/s/${landed}`);
  assert.equal(await page.evaluate(FOCUSED), landed);
  assert.deepEqual(page.problems, []);
});

test('a selection or a narrow window turns the opening off and the arrows only move the focus', { skip, timeout }, async t => {
  const page = await appPage(t);
  await focus(page, 'pin');
  await page.press('ArrowDown', SHIFT);
  await page.until(`!!document.querySelector('.pick-count')`);
  await page.press('ArrowDown');
  await page.press('ArrowDown');
  await pause(page, 400);
  assert.equal(await page.evaluate('location.hash'), '', 'nothing opens while rows are picked');
  assert.equal(await page.evaluate(`document.querySelectorAll('a.row[data-picked]').length`), 2, 'and the picks stay');

  const narrow = await appPage(t, '', { width: 800 });
  await narrow.press('ArrowDown');
  await narrow.press('ArrowDown');
  await pause(narrow, 400);
  assert.equal(await narrow.evaluate(FOCUSED), 'pin');
  assert.equal(await narrow.evaluate('location.hash'), '', 'a list that an open chat would hide keeps the focus');
  assert.deepEqual(page.problems, []);
});

test('Alt with down and up walks the sessions from the prompt box, keeps the focus there and keeps each draft', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/boss');
  await page.until(`!!document.querySelector('#text')`);
  await page.evaluate(`document.querySelector('#text').focus()`);
  await page.insert('draft for boss');
  const order = await page.evaluate(ROWS);
  const next = order[order.indexOf('boss') + 1];
  await page.press('ArrowUp');
  await page.press('ArrowDown');
  assert.equal(await page.evaluate(OPEN), 'boss', 'plain arrows in the box still belong to the box');
  await page.evaluate(`document.querySelector('#text').setAttribute('data-old', '')`);
  await page.press('ArrowDown', ALT);
  await page.until(`${OPEN} === '${next}' && !!document.querySelector('#text:not([data-old])')`);
  assert.equal(await page.evaluate(`document.activeElement.id`), 'text');
  assert.equal(await page.evaluate(`document.querySelector('#text').value`), '');
  await page.insert('draft for next');
  await page.evaluate(`document.querySelector('#text').setAttribute('data-old', '')`);
  await page.press('ArrowUp', ALT);
  await page.until(`${OPEN} === 'boss' && !!document.querySelector('#text:not([data-old])')`);
  assert.equal(await page.evaluate(`document.activeElement.id`), 'text');
  assert.equal(await page.evaluate(`document.querySelector('#text').value`), 'draft for boss');
  assert.deepEqual(page.problems, []);
});

test('Alt with down opens the first session when none is open and stops at the ends with no wrap', { skip, timeout }, async t => {
  const page = await appPage(t);
  const order = await page.evaluate(ROWS);
  await page.press('ArrowDown', ALT);
  await page.until(`${OPEN} === '${order[0]}'`);
  assert.equal(await page.evaluate(`document.activeElement === document.body || !document.activeElement.closest('#sections')`), true, 'the focus was not in the list, so it stays out');
  await page.press('ArrowUp', ALT);
  await pause(page);
  assert.equal(await page.evaluate(OPEN), order[0]);
  await page.evaluate(`location.hash = '#/s/${order.at(-1)}'`);
  await page.until(`document.querySelector('${ROW(order.at(-1))}')?.getAttribute('aria-current') === 'page'`);
  await page.press('ArrowDown', ALT);
  await pause(page);
  assert.equal(await page.evaluate(OPEN), order.at(-1));
  assert.deepEqual(page.problems, []);
});

test('Alt walks the sessions in the sidebar\'s order, a folded family\'s nested ones skipped, and the place is kept after a parent opens', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/boss');
  const order = await page.evaluate(ROWS);
  assert.deepEqual(order.slice(order.indexOf('boss'), order.indexOf('boss') + 3), ['boss', 'kid', 'kid2']);
  await focus(page, 'boss');
  await page.press('ArrowDown', ALT);
  await page.until(`${OPEN} === 'kid'`);
  await pause(page);
  assert.equal(await page.evaluate(FOCUSED), 'kid', 'the focus follows in the list, and a nested row keeps it after the chat opens');
  await page.press('ArrowUp', ALT);
  await page.until(`${OPEN} === 'boss'`);
  await pause(page);
  assert.equal(await page.evaluate(FOCUSED), 'boss');
  await page.press('ArrowLeft');
  await page.until(`!document.querySelector('${ROW('kid')}')`);
  await page.press('ArrowDown', ALT);
  await page.until(`${OPEN} !== 'boss'`);
  assert.equal(await page.evaluate(OPEN), order[order.indexOf('kid2') + 1], 'the folded ones are skipped');
  assert.deepEqual(page.problems, []);
});

test('plain down onto a parent keeps the place among its nested rows', { skip, timeout }, async t => {
  const page = await appPage(t);
  await focus(page, 'work');
  await page.press('ArrowDown');
  await page.press('ArrowDown');
  const order = await page.evaluate(`[...document.querySelectorAll('.group-head, a.row[data-id]')].map(a => a.dataset.id ?? 'head')`);
  await page.until(`${OPEN} === 'boss'`);
  await pause(page);
  assert.equal(await page.evaluate(FOCUSED), 'boss', JSON.stringify(order));
  await page.press('ArrowDown');
  await page.until(`${OPEN} === 'kid'`);
  await pause(page);
  assert.equal(await page.evaluate(FOCUSED), 'kid');
  assert.deepEqual(page.problems, []);
});

test('Alt with the arrows does nothing while the search is open, which keeps them for its groups', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/boss');
  await page.press('k', CTRL);
  await page.until(`!!document.querySelector('[cmdk-input]')`);
  await page.press('ArrowDown', ALT);
  await pause(page);
  assert.equal(await page.evaluate(OPEN), 'boss');
  await page.press('Escape');
  await page.until(`!document.querySelector('[cmdk-input]')`);
  await page.press('ArrowDown', ALT);
  await page.until(`${OPEN} !== 'boss'`);
  assert.deepEqual(page.problems, []);
});

test('Alt with the arrows does nothing in a name box in the list', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/boss');
  await page.evaluate(`document.querySelector('${ROW('loose')}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`);
  await page.until(`!!document.querySelector('#sections input')`);
  assert.equal(await page.evaluate(`document.activeElement.matches('input')`), true);
  await page.press('ArrowDown', ALT);
  await pause(page);
  assert.equal(await page.evaluate(OPEN), 'boss');
  assert.deepEqual(page.problems, []);
});

test('Alt walks onto a pinned row from another project\'s view without changing the view or losing the focus', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/inside', { scope: 'cp-x' });
  assert.deepEqual(await page.evaluate(ROWS), ['pin', 'inside']);
  await focus(page, 'inside');
  await page.evaluate(`document.querySelector('#sections').scrollTop = 40`);
  await page.press('ArrowUp', ALT);
  await page.until(`${OPEN} === 'pin'`);
  await pause(page, 500);
  assert.equal(await page.evaluate(`localStorage.getItem('capcom.scope')`), '"cp-x"');
  assert.deepEqual(await page.evaluate(ROWS), ['pin', 'inside'], 'the view is still the project');
  assert.equal(await page.evaluate(FOCUSED), 'pin');
  await page.press('ArrowDown');
  await page.press('ArrowDown');
  await page.until(`${OPEN} === 'inside'`);
  assert.equal(await page.evaluate(FOCUSED), 'inside');
  assert.deepEqual(page.problems, []);
});

test('a click on a row focuses it with no ring and no tooltip, so the arrows work from it, and a Cmd-click still picks without opening', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.click(ROW('loose'));
  await page.until(`${OPEN} === 'loose'`);
  assert.equal(await page.evaluate(FOCUSED), 'loose');
  assert.equal(await page.evaluate(`document.activeElement.matches(':focus-visible')`), false);
  assert.equal(await page.evaluate(`document.querySelectorAll('[role=tooltip]').length`), 0);
  await page.press('ArrowUp');
  await page.until(`${OPEN} !== 'loose'`);
  const mac = await page.evaluate(`navigator.platform.startsWith('Mac')`);
  const was = await page.evaluate(OPEN);
  await page.evaluate(`document.querySelector('${ROW('pin')}').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: ${mac}, ctrlKey: ${!mac} }))`);
  await page.until(`!!document.querySelector('a.row[data-picked]')`);
  assert.equal(await page.evaluate(OPEN), was);
  assert.deepEqual(page.problems, []);
});

test('a tap on a phone opens the row as before, with no ring and no tooltip', { skip, timeout }, async t => {
  const page = await appPage(t, '', { phone: true });
  await page.tap(ROW('loose'));
  await page.until(`${OPEN} === 'loose'`);
  assert.equal(await page.evaluate(`document.activeElement?.matches?.(':focus-visible')`), false);
  assert.equal(await page.evaluate(`document.querySelectorAll('[role=tooltip]').length`), 0);
  assert.deepEqual(page.problems, []);
});
