// Run with `npm test`. The model menu in a real page, which is how every menu in Capcom runs: opening from its button by key
// and by click, where the arrow keys, Home, End and an item's own key put the focus, a sub-menu opening and closing, where Esc
// leaves the focus, and the roles and checked state that assistive technology reads. It needs Playwright's Chromium headless
// shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound, serve } from './browser.mjs';

// The CLI's model list has not arrived, so More models ends in the disabled Loading models row.
const LISTED = null;
const ORDER = ['Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 5.5', 'Effort', 'More models', 'Enable fast mode'];
const MAIN = '.menu:not([data-sub])';
const SUB = '.menu[data-sub]';
const FOCUSED = `(el => (el.matches('[role^=menuitem]') ? el.querySelector('.menu-text').textContent : el.getAttribute('role') || el.id || el.tagName))(document.activeElement)`;
const EFFORT = `[...document.querySelectorAll('${MAIN} .menu-item')].find(el => el.querySelector('.menu-text').textContent === 'Effort')`;

// composer.js's model menu: popModel and pickSetting as it writes them, over the items from modelMenu, with each pick kept in window.picked.
const PAGE = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/app.css">
<script type="importmap">{ "imports": { "preact": "/vendor/preact.mjs", "preact/hooks": "/vendor/hooks.mjs", "htm": "/vendor/htm.mjs" } }</script>
<div id="root"></div>
<script type="module">
import { Fragment, h, render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Menu, opener } from '/ui/menu.js';
import { modelMenu } from '/ui/model-rules.js';

window.picked = [];
function Page() {
  const opened = useRef(0);
  const [shown, setShown] = useState(null);
  const [now, setNow] = useState({ model: 'claude-opus-5-5', effort: 'high', fast: false });
  const popModel = (button, entry) => setShown(open => (open && !entry ? null : { id: 'composer-' + ++opened.current, anchor: button, entry }));
  const pickSetting = (kind, value) => {
    shown.anchor.focus({ preventScroll: true });
    window.picked.push([kind, value]);
    setNow(was => ({ ...was, [kind]: value }));
  };
  const items = shown ? modelMenu({ ...now, listed: ${JSON.stringify(LISTED)}, pick: pickSetting }) : null;
  return h(Fragment, null,
    h('button', { id: 'open', type: 'button', style: 'position: fixed; right: 24px; bottom: 24px', ...opener(popModel) }, 'Model'),
    h(Menu, { menu: shown && { ...shown, label: 'Model and effort', items }, onClose: () => setShown(null) }));
}
render(h(Page), document.getElementById('root'));
</script>`;

const chromium = findChromium();
const skip = chromium ? false : notFound();
// A DevTools call has no deadline of its own, so without one a page that hangs would hold up the whole run.
const timeout = 20_000;
let site;
let browser;

before(async () => {
  if (skip) return;
  site = await serve({ '/': PAGE });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

// A new page with the focus on the button, as the composer leaves it.
async function menuPage(t) {
  const page = await browser.open(`${site.origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && !!document.getElementById('open')`);
  await page.evaluate(`document.getElementById('open').focus()`);
  return page;
}

// Waits for the focus to reach `label`, then asserts it, so a miss shows where the focus is and not only a timeout.
async function focusIs(page, label) {
  await page.until(`${FOCUSED} === ${JSON.stringify(label)}`).catch(() => {});
  assert.equal(await page.evaluate(FOCUSED), label);
}

// A key pressed before the menu's listener is attached is lost on a slow machine, so Esc is pressed again until the focus is back on the button.
async function escape(page) {
  for (let tries = 0; tries < 3; tries++) {
    await page.press('Escape');
    if (await page.until(`${FOCUSED} === 'open'`, 1500).then(() => true, () => false)) return;
  }
}

// Moves the focus down from the first item to `label`.
async function reach(page, label) {
  for (let step = ORDER.indexOf(label); step > 0; step--) await page.press('ArrowDown');
  await focusIs(page, label);
}

const gone = page => page.until(`!document.querySelector('.menu')`);
const picked = page => page.evaluate('window.picked');
const menuAttrs = page => page.evaluate(`(menu => menu && [menu.getAttribute('role'), menu.dataset.state, menu.getAttribute('aria-label')])(document.querySelector('${MAIN}'))`);
const subMenu = page => page.evaluate(`(menu => menu && { role: menu.getAttribute('role'), state: menu.dataset.state, labelledBy: menu.getAttribute('aria-labelledby') })(document.querySelector('${SUB}'))`);
const effortRow = page => page.evaluate(`(row => ({ id: row.id, expanded: row.getAttribute('aria-expanded'), state: row.dataset.state }))(${EFFORT})`);
const rows = (page, menu) => page.evaluate(`[...document.querySelectorAll('${menu} .menu-item')].map(el => ({
  label: el.querySelector('.menu-text').textContent, role: el.getAttribute('role'), checked: el.getAttribute('aria-checked'), popup: el.getAttribute('aria-haspopup') }))`);
const radio = (label, checked) => ({ label, role: 'menuitemradio', checked, popup: null });
const disabled = (page, menu) => page.evaluate(`[...document.querySelectorAll('${menu} .menu-item[aria-disabled=true]')].map(el => el.querySelector('.menu-text').textContent)`);

test('the down arrow on the button opens the menu, labelled Model and effort, with the focus on its first item', { skip, timeout }, async t => {
  const page = await menuPage(t);
  assert.equal(await menuAttrs(page), null);
  await page.press('ArrowDown');
  await focusIs(page, 'Opus 5.5');
  assert.deepEqual(await menuAttrs(page), ['menu', 'open', 'Model and effort']);
  assert.deepEqual(page.problems, []);
});

test('a click on the button opens the menu with the focus on the menu itself and no item lit, and the down arrow then lights the first item', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.click('#open');
  await focusIs(page, 'menu');
  assert.deepEqual(await menuAttrs(page), ['menu', 'open', 'Model and effort']);
  await page.press('ArrowDown');
  await focusIs(page, 'Opus 5.5');
  assert.deepEqual(page.problems, []);
});

test('the up arrow on the button opens the menu with the focus on its last item', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('ArrowUp');
  await focusIs(page, 'Enable fast mode');
  assert.deepEqual(page.problems, []);
});

test('Enter on the button opens the menu with the focus on its first item, as a menu opened by a key does', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('Enter');
  await focusIs(page, 'Opus 5.5');
  assert.deepEqual(page.problems, []);
});

test('the arrows move the focus through the items in order and stop at either end, and Home and End go to the first and last', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('ArrowDown');
  await focusIs(page, ORDER[0]);
  for (const label of ORDER.slice(1)) {
    await page.press('ArrowDown');
    await focusIs(page, label);
  }
  await page.press('ArrowDown');
  await focusIs(page, ORDER.at(-1));
  for (const label of ORDER.slice(0, -1).reverse()) {
    await page.press('ArrowUp');
    await focusIs(page, label);
  }
  await page.press('ArrowUp');
  await focusIs(page, ORDER[0]);
  await page.press('End');
  await focusIs(page, ORDER.at(-1));
  await page.press('Home');
  await focusIs(page, ORDER[0]);
  assert.deepEqual(page.problems, []);
});

test('More models ends in a disabled Loading models row until the CLI\'s list arrives, and the arrows and End pass over it', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('ArrowDown');
  await reach(page, 'More models');
  await page.press('ArrowRight');
  await focusIs(page, 'Opus 5.5 (1M)');
  assert.deepEqual((await rows(page, SUB)).map(r => r.label), ['Opus 5.5 (1M)', 'Loading models']);
  assert.deepEqual(await disabled(page, SUB), ['Loading models']);
  await page.press('ArrowDown');
  await focusIs(page, 'Opus 5.5 (1M)');
  await page.press('End');
  await focusIs(page, 'Opus 5.5 (1M)');
  assert.deepEqual(page.problems, []);
});

test('the models are radio items with only Opus 5.5 checked, Enable fast mode is a checkbox item that is off, Effort and More models open menus and are not checked, and High is the one effort checked', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('ArrowDown');
  await focusIs(page, 'Opus 5.5');
  assert.deepEqual(await rows(page, MAIN), [
    radio('Opus 5.5', 'true'), radio('Fable 5.1', 'false'), radio('Sonnet 5.5', 'false'), radio('Haiku 5.5', 'false'),
    { label: 'Effort', role: 'menuitem', checked: null, popup: 'menu' },
    { label: 'More models', role: 'menuitem', checked: null, popup: 'menu' },
    { label: 'Enable fast mode', role: 'menuitemcheckbox', checked: 'false', popup: null },
  ]);
  await reach(page, 'Effort');
  await page.press('ArrowRight');
  await focusIs(page, 'Low');
  assert.deepEqual(await rows(page, SUB), [radio('Low', 'false'), radio('Medium', 'false'), radio('High', 'true'), radio('Extra', 'false'), radio('Max', 'false')]);
  assert.deepEqual(page.problems, []);
});

test('the 4 key picks Haiku 5.5 and closes the menu, the next opening shows it checked, and the checked row\'s key records nothing, closes the menu and returns the focus to the button', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('ArrowDown');
  await focusIs(page, 'Opus 5.5');
  await page.press('4');
  await page.until('window.picked.length === 1');
  assert.deepEqual(await picked(page), [['model', 'claude-haiku-5-5']]);
  await focusIs(page, 'open');
  await gone(page);

  await page.press('ArrowDown');
  await focusIs(page, 'Opus 5.5');
  const models = (await rows(page, MAIN)).slice(0, 4);
  assert.deepEqual(models.map(r => [r.label, r.checked]), [['Opus 5.5', 'false'], ['Fable 5.1', 'false'], ['Sonnet 5.5', 'false'], ['Haiku 5.5', 'true']]);
  await page.press('4');
  await gone(page);
  await focusIs(page, 'open');
  assert.deepEqual(await picked(page), [['model', 'claude-haiku-5-5']]);
  assert.deepEqual(page.problems, []);
});

test('the right arrow on Effort opens its sub-menu with Low lit, the down arrow moves within it, the left arrow closes it and lights Effort again, and Enter opens it again', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('ArrowDown');
  await reach(page, 'Effort');
  const shut = await effortRow(page);
  assert.deepEqual([shut.expanded, shut.state, await subMenu(page)], ['false', 'closed', null]);

  await page.press('ArrowRight');
  await focusIs(page, 'Low');
  const open = await effortRow(page);
  assert.deepEqual([open.expanded, open.state], ['true', 'open']);
  assert.deepEqual(await subMenu(page), { role: 'menu', state: 'open', labelledBy: open.id });

  await page.press('ArrowDown');
  await focusIs(page, 'Medium');
  await page.press('ArrowLeft');
  await focusIs(page, 'Effort');
  await page.until(`!document.querySelector('${SUB}')`);
  const back = await effortRow(page);
  assert.deepEqual([back.expanded, back.state], ['false', 'closed']);

  await page.press('Enter');
  await focusIs(page, 'Low');
  assert.equal((await effortRow(page)).expanded, 'true');
  assert.deepEqual(page.problems, []);
});

test('Esc closes the menu and returns the focus to the button, and the menu leaves the page once it has faded out', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('ArrowDown');
  await focusIs(page, 'Opus 5.5');
  await escape(page);
  await focusIs(page, 'open');
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('Esc in an open sub-menu closes the whole menu and returns the focus to the button', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('ArrowDown');
  await reach(page, 'Effort');
  await page.press('ArrowRight');
  await focusIs(page, 'Low');
  await escape(page);
  await focusIs(page, 'open');
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('Enter on Enable fast mode records that fast mode is on and closes the menu, and the next opening shows the switch checked', { skip, timeout }, async t => {
  const page = await menuPage(t);
  await page.press('ArrowDown');
  await focusIs(page, 'Opus 5.5');
  await page.press('End');
  await focusIs(page, 'Enable fast mode');
  await page.press('Enter');
  await page.until('window.picked.length === 1');
  assert.deepEqual(await picked(page), [['fast', true]]);
  await focusIs(page, 'open');
  await gone(page);

  await page.press('ArrowDown');
  await focusIs(page, 'Opus 5.5');
  assert.deepEqual((await rows(page, MAIN)).at(-1), { label: 'Enable fast mode', role: 'menuitemcheckbox', checked: 'true', popup: null });
  assert.deepEqual(page.problems, []);
});
