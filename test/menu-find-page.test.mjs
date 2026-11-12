// Run with `npm test`. A sub-menu with a search box in a real page, as Move to and Nest under have: the box takes the focus when a key
// opens the sub-menu, typing filters and lights the first result, the arrows light the others while the focus stays in the box, Enter
// picks, and Esc and the left arrow leave as they do from any menu. It needs Playwright's Chromium headless shell, and every test
// skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound, serve } from './browser.mjs';

const MAIN = '.menu:not([data-sub])';
const SUB = '.menu[data-sub]';
const SEARCH = `${SUB} .menu-search-input`;
const FOCUSED = `(el => (el.matches('[role^=menuitem]') ? el.querySelector('.menu-text').textContent : el.getAttribute('role') || el.id || el.tagName))(document.activeElement)`;
const ROWS = `${SUB} [role=option]`;
const PLACES = ['Pinned', 'Checkout', 'Release notes', 'Store', 'Website ideas'];

// The places Move to offers, as sessionTargets gives them, with Checkout keyed to c so a typed c shows whether keys reach the items.
const PAGE = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/app.css">
<script type="importmap">{ "imports": { "preact": "/vendor/preact.mjs", "preact/hooks": "/vendor/hooks.mjs", "htm": "/vendor/htm.mjs" } }</script>
<div id="root"></div>
<script type="module">
import { Fragment, h, render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Menu, opener } from '/ui/menu.js';
import { findPlaces } from '/ui/search-rules.js';

const TARGETS = [
  { label: 'Pinned', section: 'pinned' },
  { group: 'Website', items: [{ label: 'Checkout', section: 'cg-checkout', key: 'c' }, { label: 'Release notes', section: 'cg-release' }] },
  { group: 'Mobile app', items: [{ label: 'Store', section: 'cg-store' }] },
  { label: 'Website ideas', section: 'cg-ideas' },
];

window.TARGETS = TARGETS;
window.picked = [];
const pick = section => () => {
  document.getElementById('open').focus();
  window.picked.push(section);
};
const listed = i => ({ label: i.label, key: i.key, run: pick(i.section) });
const items = [
  { label: 'Rename', run: pick('rename') },
  {
    label: 'Move to',
    items: TARGETS.map(t => (t.group ? { group: t.group, items: t.items.map(listed) } : listed(t))),
    find: query => findPlaces(TARGETS, query).map(p => ({ label: p.label, value: p.value, run: pick(p.section) })),
    findLabel: 'Search places',
  },
  { label: 'Archive', run: pick('archive') },
];

function Page() {
  const opened = useRef(0);
  const [shown, setShown] = useState(null);
  const pop = (button, entry) => setShown(open => (open && !entry ? null : { id: 'find-' + ++opened.current, anchor: button, entry }));
  return h(Fragment, null,
    h('button', { id: 'open', type: 'button', style: 'position: fixed; left: 24px; top: 24px', ...opener(pop) }, 'Session'),
    h(Menu, { menu: shown && { ...shown, label: 'Session', items }, onClose: () => setShown(null) }));
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

async function findPage(t, options) {
  const page = await browser.open(`${site.origin}/`, options);
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

// The key opens the menu on Rename, one more reaches Move to, and the right arrow opens its sub-menu with the focus in the box.
async function openMoveTo(page) {
  await page.press('ArrowDown');
  await focusIs(page, 'Rename');
  await page.press('ArrowDown');
  await focusIs(page, 'Move to');
  await page.press('ArrowRight');
  await focusIs(page, 'combobox');
}

async function type(page, text) {
  for (const letter of text) await page.press(letter);
}

// Two frames, which is when the effects that follow a render have run and a menu's listeners are on the page.
const frames = page => page.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done))))');
const gone = page => page.until(`!document.querySelector('.menu')`);
const calm = page => page.until(`document.getAnimations().every(a => a.playState !== 'running')`);
const picked = page => page.evaluate('window.picked');
const labels = page => page.evaluate(`[...document.querySelectorAll('${ROWS}')].map(el => el.querySelector('.menu-text').textContent)`);
const lit = page => page.evaluate(`(el => el && el.querySelector('.menu-text').textContent)(document.querySelector('${SUB} [data-highlighted]'))`);
const litCount = page => page.evaluate(`document.querySelectorAll('${SUB} [data-highlighted]').length`);
const active = page => page.evaluate(`document.querySelector('${SEARCH}').getAttribute('aria-activedescendant')`);
const litId = page => page.evaluate(`document.querySelector('${SUB} [data-highlighted]')?.id ?? null`);

// Waits for the results to be exactly `want`, then asserts them.
async function shows(page, want) {
  await page.until(`JSON.stringify([...document.querySelectorAll('${ROWS}')].map(el => el.querySelector('.menu-text').textContent)) === ${JSON.stringify(JSON.stringify(want))}`).catch(() => {});
  assert.deepEqual(await labels(page), want);
}

// The box, the list and the status row, as assistive technology reads them.
test('a key opens Move to with the focus in a labelled search box over every place, with none lit and a listbox of options that the box and Move to both name', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  const found = await page.evaluate(`(box => {
    const input = box.querySelector('.menu-search-input');
    const list = box.querySelector('.menu-list');
    return {
      role: box.getAttribute('role'),
      input: [input.getAttribute('role'), input.getAttribute('aria-label'), input.placeholder, input.value, input.getAttribute('aria-activedescendant')],
      controls: input.getAttribute('aria-controls') === list.id,
      list: [list.getAttribute('role'), list.getAttribute('aria-labelledby') === document.querySelector('${MAIN} [data-at="1"]').id],
      parent: [document.querySelector('${MAIN} [data-at="1"]').getAttribute('aria-controls') === list.id, document.querySelector('${MAIN} [data-at="1"]').getAttribute('aria-haspopup')],
      options: [...new Set([...list.querySelectorAll('.menu-item')].map(el => [el.getAttribute('role'), el.getAttribute('aria-selected')].join()))],
      headings: [...list.querySelectorAll('.menu-label')].map(el => el.textContent),
      status: [box.querySelector('.menu-empty').getAttribute('role'), box.querySelector('.menu-empty').textContent],
    };
  })(document.querySelector('${SUB}'))`);
  assert.deepEqual(found, {
    role: null,
    input: ['combobox', 'Search places', 'Search places', '', null],
    controls: true,
    list: ['listbox', true],
    parent: [true, 'listbox'],
    options: ['option,false'],
    headings: ['Website', 'Mobile app'],
    status: ['status', ''],
  });
  assert.deepEqual(await labels(page), PLACES);
  assert.equal(await litCount(page), 0);
  assert.deepEqual(page.problems, []);
});

test('typing finds the places the words match, a project\'s name ahead of a name that only a place has, and lights the first with the focus staying in the box', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'web');
  await shows(page, ['Checkout', 'Release notes', 'Website ideas']);
  assert.equal(await lit(page), 'Checkout');
  assert.equal(await litCount(page), 1);
  assert.equal(await active(page), await litId(page));
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('${ROWS}')].map(el => el.getAttribute('aria-selected'))`), ['true', 'false', 'false']);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('${SUB} .menu-value')].map(el => el.textContent)`), ['Website', 'Website', 'Home']);
  assert.equal(await page.evaluate(`document.querySelectorAll('${SUB} .menu-label').length`), 0);
  await focusIs(page, 'combobox');
  assert.equal(await page.evaluate(`document.querySelector('${SEARCH}').value`), 'web');
  assert.deepEqual(page.problems, []);
});

test('a letter typed in the box is not an item\'s key and does not move the focus by typeahead', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'ch');
  await shows(page, ['Checkout']);
  assert.deepEqual(await picked(page), []);
  assert.equal(await page.evaluate(`!!document.querySelector('${SUB}')`), true);
  await focusIs(page, 'combobox');
  await page.press('Escape');
  await gone(page);
  assert.deepEqual(await picked(page), []);
  assert.deepEqual(page.problems, []);
});

test('the arrows light the next and the previous result, Home and End the first and the last, and the focus stays in the box', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'web');
  await shows(page, ['Checkout', 'Release notes', 'Website ideas']);
  const step = async (key, want) => {
    await page.press(key);
    await page.until(`(el => el && el.querySelector('.menu-text').textContent)(document.querySelector('${SUB} [data-highlighted]')) === ${JSON.stringify(want)}`).catch(() => {});
    assert.equal(await lit(page), want, key);
    assert.equal(await litCount(page), 1);
    assert.equal(await active(page), await litId(page));
    await focusIs(page, 'combobox');
  };
  await step('ArrowDown', 'Release notes');
  await step('ArrowDown', 'Website ideas');
  await step('ArrowDown', 'Website ideas');
  await step('ArrowUp', 'Release notes');
  await step('End', 'Website ideas');
  await step('Home', 'Checkout');
  await step('ArrowUp', 'Checkout');
  assert.deepEqual(page.problems, []);
});

test('the lit result looks as a focused item does, with the same fill as the Move to row that opened the sub-menu', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'web');
  await shows(page, ['Checkout', 'Release notes', 'Website ideas']);
  const fills = await page.evaluate(`({
    lit: getComputedStyle(document.querySelector('${SUB} [data-highlighted]')).backgroundColor,
    parent: getComputedStyle(document.querySelector('${MAIN} [data-at="1"]')).backgroundColor,
    plain: getComputedStyle(document.querySelector('${SUB} [role=option]:not([data-highlighted])')).backgroundColor,
  })`);
  assert.notEqual(fills.lit, fills.plain);
  assert.equal(fills.lit, fills.parent);
  assert.deepEqual(page.problems, []);
});

test('Enter picks the first result, which is lit as it is typed, closes the menu and returns the focus to the button', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'store');
  await shows(page, ['Store']);
  await page.press('Enter');
  await page.until('window.picked.length === 1');
  assert.deepEqual(await picked(page), ['cg-store']);
  await focusIs(page, 'open');
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('Enter picks the result the arrows lit and not the first', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'web');
  await shows(page, ['Checkout', 'Release notes', 'Website ideas']);
  await page.press('ArrowDown');
  await page.until(`(el => el && el.textContent.includes('Release notes'))(document.querySelector('${SUB} [data-highlighted]'))`);
  await page.press('Enter');
  await page.until('window.picked.length === 1');
  assert.deepEqual(await picked(page), ['cg-release']);
  await focusIs(page, 'open');
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('Enter with nothing typed picks nothing, because no result is lit', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await page.press('Enter');
  assert.deepEqual(await picked(page), []);
  assert.equal(await page.evaluate(`!!document.querySelector('${SUB}')`), true);
  await focusIs(page, 'combobox');
  assert.deepEqual(page.problems, []);
});

test('words that match nothing show Nothing matches in a status row with no result lit, and Enter then picks nothing', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'zzz');
  await shows(page, []);
  await page.until(`document.querySelector('${SUB} .menu-empty').textContent === 'Nothing matches.'`);
  assert.equal(await litCount(page), 0);
  assert.equal(await active(page), null);
  await page.press('ArrowDown');
  await page.press('Enter');
  assert.deepEqual(await picked(page), []);
  assert.equal(await page.evaluate(`!!document.querySelector('${SUB}')`), true);
  await focusIs(page, 'combobox');
  assert.deepEqual(page.problems, []);
});

test('Esc in the box closes the whole menu and returns the focus to the button', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'web');
  await page.press('Escape');
  await focusIs(page, 'open');
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('the left arrow goes back to Move to only with the caret at the start of an empty selection, and otherwise belongs to the box', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'w');
  await shows(page, ['Checkout', 'Release notes', 'Website ideas']);
  const caret = (from, to) => page.evaluate(`document.querySelector('${SEARCH}').setSelectionRange(${from}, ${to})`);
  const stays = async () => {
    await page.press('ArrowLeft');
    await focusIs(page, 'combobox');
    assert.equal(await page.evaluate(`!!document.querySelector('${SUB}')`), true);
  };
  await caret(1, 1);
  await stays();
  await caret(0, 1);
  await stays();
  await caret(0, 0);
  await page.press('ArrowLeft');
  await focusIs(page, 'Move to');
  await page.until(`!document.querySelector('${SUB}')`);
  assert.equal(await page.evaluate(`!!document.querySelector('${MAIN}')`), true);
  assert.deepEqual(page.problems, []);
});

test('Tab does nothing in the box, a space is typed, and Ctrl+K closes the menu as it does from an item', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  const sent = init => page.evaluate(`!document.querySelector('${SEARCH}').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`);
  assert.equal(await sent({ key: 'Tab' }), true);
  assert.equal(await sent({ key: ' ' }), false);
  await focusIs(page, 'combobox');
  assert.equal(await page.evaluate(`!!document.querySelector('${SUB}')`), true);
  await sent({ key: 'k', ctrlKey: true });
  await focusIs(page, 'open');
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('a click on Move to opens its sub-menu with the focus left on the item and the box empty, and a click on a result picks it', { skip, timeout }, async t => {
  const page = await findPage(t);
  await page.press('ArrowDown');
  await focusIs(page, 'Rename');
  await page.click(`${MAIN} [data-at="1"]`);
  await page.until(`!!document.querySelector('${SUB}[data-state=open] .menu-search-input')`);
  await focusIs(page, 'Move to');
  assert.equal(await page.evaluate(`document.querySelector('${SEARCH}').value`), '');
  await page.click(`${SUB} [data-at="1"]`);
  await page.until('window.picked.length === 1');
  assert.deepEqual(await picked(page), ['cg-checkout']);
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('the mouse opens the sub-menu with the focus on Move to, moving onto the sub-menu gives the box the focus, and hover then lights results and does not focus them', { skip, timeout }, async t => {
  const page = await findPage(t);
  await page.press('ArrowDown');
  await focusIs(page, 'Rename');
  await page.hover(`${MAIN} [data-at="1"]`);
  await page.until(`!!document.querySelector('${SUB}[data-state=open]')`);
  await focusIs(page, 'Move to');
  await page.hover(`${SUB} [data-at="0"]`);
  await focusIs(page, 'combobox');
  // The grace area that lets the pointer cross to the sub-menu lights nothing until it has run out.
  await page.evaluate('new Promise(done => setTimeout(done, 400))');
  await page.hover(`${SUB} [data-at="2"]`);
  await page.until(`!!document.querySelector('${SUB} [data-at="2"][data-highlighted]')`);
  assert.equal(await litCount(page), 1);
  await focusIs(page, 'combobox');
  assert.equal(await active(page), await litId(page));
  assert.deepEqual(page.problems, []);
});

test('a resize while the box has the focus places the menu again and keeps it open, and with the focus on an item it closes the menu', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'web');
  await shows(page, ['Checkout', 'Release notes', 'Website ideas']);
  await page.evaluate(`window.dispatchEvent(new Event('resize'))`);
  await frames(page);
  assert.equal(await page.evaluate(`!!document.querySelector('${SUB}')`), true);
  await focusIs(page, 'combobox');
  const beside = await page.evaluate(`(parent => (sub => sub.left >= parent.right - 8 && sub.top < parent.bottom && sub.bottom > parent.top)(document.querySelector('${SUB}').getBoundingClientRect()))(document.querySelector('${MAIN} [data-at="1"]').getBoundingClientRect())`);
  assert.equal(beside, true);

  await page.press('Escape');
  await gone(page);
  await page.evaluate(`document.getElementById('open').focus()`);
  await page.press('ArrowDown');
  await focusIs(page, 'Rename');
  await frames(page);
  await page.evaluate(`window.dispatchEvent(new Event('resize'))`);
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('on a phone the box types at 16px or more, so the browser does not zoom the page when it takes the focus', { skip, timeout }, async t => {
  const page = await findPage(t, { phone: true });
  const coarse = await page.evaluate(`matchMedia('(pointer: coarse)').matches`);
  if (!coarse) { t.skip('the emulated phone does not report a coarse pointer, so the rule it tests does not apply'); return; }
  await openMoveTo(page);
  const size = await page.evaluate(`parseFloat(getComputedStyle(document.querySelector('${SEARCH}')).fontSize)`);
  assert.ok(size >= 16, `the box types at ${size}px`);
  assert.deepEqual(page.problems, []);
});

test('with a fine pointer the box keeps the menu\'s own small type', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  const size = await page.evaluate(`parseFloat(getComputedStyle(document.querySelector('${SEARCH}')).fontSize)`);
  assert.ok(size > 0 && size < 16, `the box types at ${size}px`);
  assert.deepEqual(page.problems, []);
});

const rectOf = (page, selector) => page.evaluate(`(el => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: el.offsetWidth, height: el.offsetHeight, side: el.dataset.side }))(document.querySelector(${JSON.stringify(selector)}))`);
const near = (a, b, why) => { for (const key of ['left', 'top', 'width']) assert.ok(Math.abs(a[key] - b[key]) < 0.5, `${why}: ${key} was ${a[key]}, now ${b[key]}`); assert.equal(a.side, b.side, `${why}: the side`); };
const setBox = (page, text) => page.evaluate(`(box => { box.value = ${JSON.stringify(text)}; box.dispatchEvent(new Event('input', { bubbles: true })); })(document.querySelector('${SEARCH}'))`);

test('a search that shortens and lengthens the list leaves the sub-menu where it opened, on the side it opened on', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await calm(page);
  const opened = await rectOf(page, SUB);
  await type(page, 'store');
  await shows(page, ['Store']);
  await frames(page);
  const shorter = await rectOf(page, SUB);
  assert.ok(shorter.height < opened.height);
  near(opened, shorter, 'after a search that finds one place');
  await setBox(page, 'zzz');
  await frames(page);
  near(opened, await rectOf(page, SUB), 'after a search that finds none');
  await setBox(page, '');
  await shows(page, PLACES);
  await frames(page);
  near(opened, await rectOf(page, SUB), 'after the box is cleared');
  assert.deepEqual(page.problems, []);
});

test('a sub-menu that opened pulled up into view stays there when the list shortens, and one that opened on the left stays on the left', { skip, timeout }, async t => {
  const page = await findPage(t);
  await page.evaluate(`document.getElementById('open').style.cssText = 'position: fixed; right: 24px; top: 600px'`);
  await openMoveTo(page);
  await calm(page);
  const opened = await rectOf(page, SUB);
  assert.equal(opened.side, 'left');
  assert.ok(opened.top + opened.height > 700, 'the sub-menu is low enough to have been pulled up');
  const parent = await page.evaluate(`document.querySelector('${MAIN} [data-at="1"]').getBoundingClientRect().top`);
  assert.ok(opened.top < parent - 20, `the sub-menu was pulled up above its item: ${JSON.stringify(opened)} parent ${parent}`);
  await type(page, 'store');
  await shows(page, ['Store']);
  await frames(page);
  near(opened, await rectOf(page, SUB), 'after a search that finds one place');
  assert.deepEqual(page.problems, []);
});

test('a result too wide for the sub-menu is cut with an ellipsis, and the sub-menu keeps its width', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await calm(page);
  const opened = await rectOf(page, SUB);
  await page.evaluate(`window.TARGETS.push({ group: 'The longest project name anyone has ever given a project', items: [{ label: 'Docs', section: 'cg-docs' }] })`);
  await type(page, 'long');
  await shows(page, ['Docs']);
  await frames(page);
  near(opened, await rectOf(page, SUB), 'after a result wider than the menu');
  const cut = await page.evaluate(`(box => { const value = box.querySelector('.menu-value'); return [value.scrollWidth > value.clientWidth, getComputedStyle(value).textOverflow, box.scrollWidth <= box.clientWidth]; })(document.querySelector('${SUB}'))`);
  assert.deepEqual(cut, [true, 'ellipsis', true]);
  assert.deepEqual(page.problems, []);
});

test('the keyboard of a phone closing, which takes the focus from the box, does not close the menu when the button then moves, and the menu follows it', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'web');
  await shows(page, ['Checkout', 'Release notes', 'Website ideas']);
  await page.evaluate(`document.activeElement.blur()`);
  assert.equal(await page.evaluate(`document.activeElement === document.querySelector('${SEARCH}')`), false);
  await calm(page);
  const before = await rectOf(page, SUB);
  await page.evaluate(`(button => { button.style.top = '60px'; window.dispatchEvent(new Event('scroll')); })(document.getElementById('open'))`);
  await frames(page);
  assert.equal(await page.evaluate(`!!document.querySelector('${SUB}')`), true);
  const after = await rectOf(page, SUB);
  assert.ok(Math.abs(after.top - before.top - 36) < 1, `the sub-menu moved down with the button: ${JSON.stringify(before)} ${JSON.stringify(after)}`);
  assert.deepEqual(page.problems, []);
});

test('a scroll that moves the button closes a sub-menu whose box never had the focus', { skip, timeout }, async t => {
  const page = await findPage(t);
  await page.press('ArrowDown');
  await focusIs(page, 'Rename');
  await page.click(`${MAIN} [data-at="1"]`);
  await page.until(`!!document.querySelector('${SUB}[data-state=open] .menu-search-input')`);
  await focusIs(page, 'Move to');
  await frames(page);
  await page.evaluate(`(button => { button.style.top = '60px'; window.dispatchEvent(new Event('scroll')); })(document.getElementById('open'))`);
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('a press on the icon of the box keeps the focus in it, and a press on a result lights nothing and does not take the focus until the click picks it', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await page.down(`${SUB} .menu-search > svg`);
  await focusIs(page, 'combobox');
  await page.up();
  await focusIs(page, 'combobox');
  await type(page, 'web');
  await shows(page, ['Checkout', 'Release notes', 'Website ideas']);
  await page.down(`${SUB} [data-at="1"]`);
  await focusIs(page, 'combobox');
  assert.equal(await page.evaluate(`document.activeElement.closest('.menu')?.dataset.path`), '1');
  await page.up();
  await page.until('window.picked.length === 1');
  assert.deepEqual(await picked(page), ['cg-release']);
  await gone(page);
  assert.deepEqual(page.problems, []);
});

test('a press on the empty part of the sub-menu leaves the focus in the box and not on the menu', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'zzz');
  await shows(page, []);
  await page.down(`${SUB} .menu-empty`);
  await focusIs(page, 'combobox');
  await page.up();
  assert.deepEqual(page.problems, []);
});

test('the pointer moving off a lit result onto the box leaves it lit, and Enter then picks it', { skip, timeout }, async t => {
  const page = await findPage(t);
  await page.press('ArrowDown');
  await focusIs(page, 'Rename');
  await page.hover(`${MAIN} [data-at="1"]`);
  await page.until(`!!document.querySelector('${SUB}[data-state=open]')`);
  await page.hover(`${SUB} [data-at="0"]`);
  await page.evaluate('new Promise(done => setTimeout(done, 400))');
  await page.hover(`${SUB} [data-at="2"]`);
  await page.until(`!!document.querySelector('${SUB} [data-at="2"][data-highlighted]')`);
  await page.hover(SEARCH);
  await frames(page);
  assert.equal(await litCount(page), 1);
  assert.equal(await lit(page), 'Release notes');
  await focusIs(page, 'combobox');
  await page.press('Enter');
  await page.until('window.picked.length === 1');
  assert.deepEqual(await picked(page), ['cg-release']);
  assert.deepEqual(page.problems, []);
});

test('a sub-menu opened again while it fades out has an empty box and no lit result, in the element that was fading', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  await type(page, 'web');
  await shows(page, ['Checkout', 'Release notes', 'Website ideas']);
  await page.evaluate(`window.fading = document.querySelector('${SEARCH}'); window.fading.setSelectionRange(0, 0)`);
  await page.press('ArrowLeft');
  await page.press('ArrowRight');
  await focusIs(page, 'combobox');
  assert.equal(await page.evaluate(`document.querySelector('${SEARCH}') === window.fading`), true, 'the sub-menu was reused, so the test reached the fade-out');
  assert.equal(await page.evaluate(`document.querySelector('${SEARCH}').value`), '');
  assert.equal(await litCount(page), 0);
  assert.deepEqual(await labels(page), PLACES);
  assert.deepEqual(page.problems, []);
});

test('the status row stays in the accessibility tree, visually hidden while it is empty, and shows its words in the flow when nothing matches', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  const empty = await page.evaluate(`(el => [getComputedStyle(el).display !== 'none', el.offsetWidth, el.offsetHeight])(document.querySelector('${SUB} .menu-empty'))`);
  assert.deepEqual(empty, [true, 1, 1]);
  await type(page, 'zzz');
  await shows(page, []);
  const shown = await page.evaluate(`(el => [el.textContent, el.offsetWidth > 100, el.offsetHeight > 20])(document.querySelector('${SUB} .menu-empty'))`);
  assert.deepEqual(shown, ['Nothing matches.', true, true]);
  assert.deepEqual(page.problems, []);
});

test('the search box sits flush with the top of the sub-menu, so it covers the menu\'s own top edge and leaves no strip above it for the list to scroll through', { skip, timeout }, async t => {
  const page = await findPage(t);
  await openMoveTo(page);
  assert.equal(await page.evaluate(`document.querySelector('${SUB} .menu-search').offsetTop`), 0);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${SUB}')).paddingTop`), '0px');
  assert.deepEqual(page.problems, []);
});
