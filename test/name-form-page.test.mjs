// Run with `npm test`. The name box in a real page: a bare input named by its aria-label, what Enter, Esc and the focus leaving each
// ask of the caller, the names that cancel without asking the server, and a save that is still pending or was refused. It needs
// Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound, serve } from './browser.mjs';

// NameForm as the list mounts it, with each call the stubs get kept in window.calls and `answer` giving what onSubmit resolves.
const PAGE = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/app.css">
<script type="importmap">{ "imports": { "preact": "/vendor/preact.mjs", "preact/hooks": "/vendor/hooks.mjs", "htm": "/vendor/htm.mjs" } }</script>
<div id="root"></div>
<button id="other" type="button">Elsewhere</button>
<script type="module">
import { h, render } from 'preact';
import { NameForm } from '/ui/forms.js';

window.calls = [];
window.answer = () => true;
window.unmount = () => render(null, document.getElementById('root'));
window.mount = props => render(h(NameForm, {
  label: 'Rename session',
  onSubmit: (text, away) => { window.calls.push(['submit', text, away]); return window.answer(); },
  onCancel: away => { window.calls.push(['cancel', away]); },
  ...props,
}), document.getElementById('root'));
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

const INPUT = `document.querySelector('#root input')`;

// A new page with the box mounted from `props` and, as the list leaves it, the focus in the box.
async function boxPage(t, props = {}) {
  const page = await browser.open(`${site.origin}/`);
  t.after(() => page.close());
  await page.until(`typeof window.mount === 'function'`);
  await page.evaluate(`mount(${JSON.stringify(props)})`);
  await page.until(`document.activeElement === ${INPUT}`);
  return page;
}

const calls = page => page.evaluate('window.calls');
// Nothing is asked of the caller until the page has had a moment to, so a call that should not come is looked for after one.
const idle = page => page.evaluate('new Promise(done => setTimeout(done, 50))');
const leave = page => page.evaluate(`document.getElementById('other').focus()`);
// A blur with no element taking the focus, as the macOS emoji picker or a click on a Safari button gives.
const blurToNothing = page => page.evaluate(`${INPUT}.blur()`);
const press = (page, selector) => page.evaluate(`document.querySelector('${selector}').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
const wait = (page, ms) => page.evaluate(`new Promise(done => setTimeout(done, ${ms}))`);

test('the box has its label as aria-label and no visible label or buttons', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  assert.deepEqual(await page.evaluate(`({
    label: ${INPUT}.getAttribute('aria-label'),
    text: document.getElementById('root').textContent,
    extras: document.querySelectorAll('#root :is(button, label, [type=submit])').length,
  })`), { label: 'Rename session', text: '', extras: 0 });
  assert.deepEqual(page.problems, []);
});

test('the text is selected when the box opens', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  assert.deepEqual(await page.evaluate(`[${INPUT}.value, ${INPUT}.selectionStart, ${INPUT}.selectionEnd]`), ['Old name', 0, 8]);
});

test('Enter saves once, with away false', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  await page.press('a');
  await page.press('Enter');
  await page.until('window.calls.length > 0');
  await idle(page);
  assert.deepEqual(await calls(page), [['submit', 'a', false]]);
  assert.deepEqual(page.problems, []);
});

test('Esc cancels with away false and saves nothing', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  await page.press('a');
  await page.press('Escape');
  await page.until('window.calls.length > 0');
  await idle(page);
  assert.deepEqual(await calls(page), [['cancel', false]]);
});

test('the focus leaving the box saves with away true, and once', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  await page.press('a');
  await leave(page);
  await idle(page);
  assert.deepEqual(await calls(page), [['submit', 'a', true]]);
});

// What the box cancels on, as [what it says, the value it opens with, the name it is renaming (`was`)].
const CANCELS = [
  ['an empty name', '', ''],
  ['a name of spaces', '   ', 'Old name'],
  ['a name no different from the one it renames', 'Old name', 'Old name'],
  ['a name that differs only in spacing', '  Old   name ', 'Old name'],
];

for (const [what, value, was] of CANCELS) {
  test(`${what} cancels without asking the server, by Enter and by the focus leaving`, { skip, timeout }, async t => {
    const byEnter = await boxPage(t, { value, was });
    await byEnter.press('Enter');
    await byEnter.until('window.calls.length > 0');
    await idle(byEnter);
    assert.deepEqual(await calls(byEnter), [['cancel', false]]);
    const byLeaving = await boxPage(t, { value, was });
    await leave(byLeaving);
    await idle(byLeaving);
    assert.deepEqual(await calls(byLeaving), [['cancel', true]]);
  });
}

test('a name that differs from `was` saves',{ skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name sent', was: 'Old name' });
  await page.press('Enter');
  await page.until('window.calls.length > 0');
  assert.deepEqual(await calls(page), [['submit', 'Old name sent', false]]);
});

test('the focus leaving while a save is pending does not save again', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  await page.evaluate('window.answer = () => new Promise(done => { window.settle = done; })');
  await page.press('a');
  await page.press('Enter');
  await page.until('window.calls.length > 0');
  await leave(page);
  await idle(page);
  assert.deepEqual(await calls(page), [['submit', 'a', false]]);
  await page.evaluate('window.settle(true)');
  await idle(page);
  assert.deepEqual(await calls(page), [['submit', 'a', false]]);
  assert.deepEqual(page.problems, []);
});

test('Esc still cancels while a save is pending', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  await page.evaluate('window.answer = () => new Promise(() => {})');
  await page.press('a');
  await page.press('Enter');
  await page.until('window.calls.length > 0');
  await page.press('Escape');
  await page.until('window.calls.length > 1');
  assert.deepEqual(await calls(page), [['submit', 'a', false], ['cancel', false]]);
});

test('a refused save leaves the box open with the text and the focus in it, and Enter tries again', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  await page.evaluate('window.answer = () => false');
  await page.press('a');
  await page.press('Enter');
  await page.until('window.calls.length > 0');
  await idle(page);
  assert.deepEqual(await page.evaluate(`[${INPUT}?.value, document.activeElement === ${INPUT}]`), ['a', true]);
  await page.press('Enter');
  await page.until('window.calls.length > 1');
  assert.deepEqual(await calls(page), [['submit', 'a', false], ['submit', 'a', false]]);
  assert.deepEqual(page.problems, []);
});

// Four emoji take 8 UTF-16 units but 4 characters, which is how the server counts them against the limit.
test('emoji count as one character each against the limit, as the server counts them', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: '', max: 120 });
  await page.insert('a'.repeat(100));
  await page.insert('\u{1F600}'.repeat(15));
  assert.equal(await page.evaluate(`[...${INPUT}.value].length`), 115);
  await page.insert('b'.repeat(5));
  assert.equal(await page.evaluate(`[...${INPUT}.value].length`), 120);
  await page.insert('c');
  assert.equal(await page.evaluate(`[...${INPUT}.value].length`), 120);
  assert.deepEqual(page.problems, []);
});

test('an emoji pasted into a box and saved reaches the caller whole', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
  await page.insert(`${family} \u{1F1E6}\u{1F1FA} \u{1F6E2}️ \u{1F44D}\u{1F3FD}`);
  await page.press('Enter');
  await page.until('window.calls.length > 0');
  assert.deepEqual(await calls(page), [['submit', `${family} \u{1F1E6}\u{1F1FA} \u{1F6E2}️ \u{1F44D}\u{1F3FD}`, false]]);
});

test('an edit past the limit in the middle is undone and keeps the end of the name', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: `a${'b'.repeat(78)}Z`, max: 80 });
  await page.evaluate(`${INPUT}.setSelectionRange(1, 1)`);
  await page.insert('Q');
  assert.equal(await page.evaluate(`${INPUT}.value.endsWith('Z') && ${INPUT}.value.length`), 80);
  assert.equal(await page.evaluate(`${INPUT}.selectionStart`), 1);
});

test('the emoji picker taking the focus does not close the box, and the emoji it types is saved', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  assert.equal(await page.evaluate('document.hasFocus()'), true);
  await blurToNothing(page);
  await idle(page);
  await page.evaluate(`${INPUT}.value = 'Old name \u2705'; ${INPUT}.dispatchEvent(new Event('input', { bubbles: true })); ${INPUT}.focus()`);
  await idle(page);
  assert.deepEqual(await page.evaluate(`[!!${INPUT}, document.activeElement === ${INPUT}]`), [true, true]);
  assert.deepEqual(await calls(page), []);
  await page.press('Enter');
  await page.until('window.calls.length > 0');
  assert.deepEqual(await calls(page), [['submit', 'Old name \u2705', false]]);
});

test('a blur to nothing that nothing follows saves once the grace is over', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name', grace: 600 });
  await page.press('a');
  await blurToNothing(page);
  await wait(page, 300);
  assert.deepEqual(await calls(page), []);
  await page.until('window.calls.length > 0');
  await idle(page);
  assert.deepEqual(await calls(page), [['submit', 'a', true]]);
});

// A click is a pointerdown and then a blur with no element named, as Safari gives for a link, a button or bare page.
test('a click elsewhere saves at once, not after the grace', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name', grace: 5000 });
  await page.press('a');
  await press(page, '#other');
  await blurToNothing(page);
  await idle(page);
  assert.deepEqual(await calls(page), [['submit', 'a', true]]);
});

test('a press inside the box and then a blur to nothing does not save at once', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name', grace: 600 });
  await page.press('a');
  await press(page, '#root input');
  await blurToNothing(page);
  await wait(page, 300);
  assert.deepEqual(await calls(page), []);
});

test('the window losing the focus during the grace keeps the box, and it is refocused when the window returns', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name', grace: 300 });
  await page.press('a');
  await blurToNothing(page);
  await page.evaluate('document.hasFocus = () => false');
  await wait(page, 500);
  assert.deepEqual(await page.evaluate(`[!!${INPUT}, window.calls.length]`), [true, 0]);
  await page.evaluate(`delete document.hasFocus; window.dispatchEvent(new Event('focus'))`);
  await page.until(`document.activeElement === ${INPUT}`);
  await page.press('Enter');
  await page.until('window.calls.length > 0');
  assert.deepEqual(await calls(page), [['submit', 'a', false]]);
});

test('the focus going to an element saves at once', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name' });
  await page.press('a');
  await leave(page);
  await page.until('window.calls.length > 0');
  assert.deepEqual(await calls(page), [['submit', 'a', true]]);
});

test('a box unmounted during the grace asks nothing of the caller', { skip, timeout }, async t => {
  const page = await boxPage(t, { value: 'Old name', grace: 600 });
  await page.press('a');
  await blurToNothing(page);
  await page.evaluate('unmount()');
  await wait(page, 800);
  await press(page, '#other');
  await idle(page);
  assert.deepEqual(await calls(page), []);
  assert.deepEqual(page.problems, []);
});
