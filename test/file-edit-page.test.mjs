// Run with `npm test`. Editing a file that a reply links to, in the real page against the real server: the pencil, the text box that typing does not
// redraw, Save writing the file on disk, a file that changed meanwhile keeping the text and overwriting nothing, Cancel showing the file as it is
// now, Escape keeping the text, a read only file saying why with no pencil, edits kept as a draft when the file is left and given back when it
// is opened again, closing the panel on a half edited file, the panel pinned above an on-screen keyboard (stood in for by a fake visual viewport),
// sign-out and a full browser store, and the buttons within reach on a phone 390 and 320 px wide. It needs Playwright's Chromium
// headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let browser;
let said = 0;

const says = (id, text) => {
  const file = path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}-${++said}`, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })}\n`);
  const old = (Date.now() - 600_000) / 1000;
  fs.utimesSync(file, old, old);
};

// A file in the test home that the chat links to.
const NAMES = ['saves', 'races', 'draft', 'phone', 'long', 'fits', 'locked', 'gone'];
const LINES = { long: 300, fits: 20 };
const files = {};

before(async () => {
  if (skip) return;
  app = await start({ sessions: [{ id: 'chat', title: 'Chat', ago: 10 }], claude: true });
  const dir = path.join(app.home, 'work');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of NAMES) {
    files[name] = path.join(dir, `${name}.txt`);
    fs.writeFileSync(files[name], LINES[name] ? Array.from({ length: LINES[name] }, (_, i) => `line ${i + 1}\n`).join('') : `first line of ${name}\nsecond line\n`);
  }
  files.locked = path.join(app.home, '.zshrc');
  fs.writeFileSync(files.locked, 'export A=1\n');
  says('chat', NAMES.map(name => `[${name}](<${files[name]}>)`).join('\n\n'));
  browser = await launch(chromium);
});

after(async () => { await browser?.close(); });

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

async function appPage(t, { phone = false } = {}) {
  const page = await browser.open(`${app.origin}/`, { phone });
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
  // Which panel was open and which drafts were kept is remembered by the browser, and the earlier test's would cover the chat or fill the box.
  if (await page.evaluate(`localStorage.getItem('capcom.panels') !== null || !['{}', null].includes(localStorage.getItem('capcom.fileDrafts'))`)) {
    await page.evaluate(`window.stale = true; localStorage.removeItem('capcom.panels'); localStorage.removeItem('capcom.fileDrafts'); location.reload()`);
    await page.until(`!window.stale && document.readyState === 'complete' && ${LIST}`, 10_000);
  }
  // A reload keeps the hash, and setting the same hash again opens nothing.
  await page.evaluate(`location.hash = '#/'`);
  await new Promise(resolve => setTimeout(resolve, 100));
  await page.evaluate(`location.hash = '#/s/chat'`);
  await page.until(`!!document.querySelector('.msg.claude a[data-file]')`, 15_000);
  return page;
}

const link = name => `a[data-file="${files[name]}"]`;
const button = label => `.file-view button[aria-label="${label}"]`;
const named = label => `[...document.querySelectorAll('.file-view button')].find(b => b.textContent === ${JSON.stringify(label)})`;

async function open(page, name, { phone = false } = {}) {
  await (phone ? page.tap(link(name)) : page.click(link(name)));
  await page.until(`!!document.querySelector('.file-view .file-lines, .file-view .file-editor, .file-view .file-note')`, 10_000);
}

// Replaces everything in the text box with `text`, typed as one insertion.
async function typeOver(page, text) {
  await page.until(`!!document.querySelector('.file-editor')`);
  await new Promise(resolve => setTimeout(resolve, 150));
  await page.evaluate(`(box => { box.focus(); box.select(); })(document.querySelector('.file-editor'))`);
  await page.insert(text);
}

const toasts = page => page.evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent)`);
const boxValue = page => page.evaluate(`document.querySelector('.file-editor').value`);
const discard = async page => {
  await page.evaluate(`${named('Cancel')}.click()`);
  await page.until(`!!document.querySelector('[data-slot="alert-dialog-action"]')`);
  await page.evaluate(`document.querySelector('[data-slot="alert-dialog-action"]').click()`);
  await page.until(`!document.querySelector('[data-slot="alert-dialog-overlay"], [data-slot="alert-dialog-content"]')`);
};

test('the pencil opens the file in a text box, typing redraws nothing, and Save writes it on disk and shows it', { skip, timeout }, async t => {
  const page = await appPage(t);
  await open(page, 'saves');
  await page.click(button('Edit file'));
  await page.until(`document.activeElement === document.querySelector('.file-editor')`);
  assert.equal(await boxValue(page), 'first line of saves\nsecond line\n');
  assert.equal(await page.evaluate(`${named('Save')}.disabled`), true, 'nothing to save yet');
  assert.equal(await page.evaluate(`!!document.querySelector(${JSON.stringify(button('Close file'))})`), false, 'the head holds Cancel and Save only');
  assert.equal(await page.evaluate(`document.querySelector('.file-editor').getAttribute('autocorrect')`), 'off');
  assert.equal(await page.evaluate(`document.querySelector('.file-editor').selectionStart`), 0, 'the caret starts where the view does');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.file-editor')).boxShadow`), 'none', 'no focus ring');
  assert.equal(await page.evaluate(`document.querySelector('.panel').hasAttribute('data-keyboard')`), false, 'no keyboard, so nothing is pinned');
  await typeOver(page, 'changed in the box\nsecond line\n');
  await page.until(`!${named('Save')}.disabled`);
  await page.evaluate(`window.redrawn = 0; new MutationObserver(list => { window.redrawn += list.length; }).observe(document.querySelector('.file-view'), { subtree: true, childList: true, attributes: true, characterData: true })`);
  await page.insert(' and more');
  await page.insert(' and more');
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await page.evaluate(`window.redrawn`), 0, 'typing changed nothing on the page');
  await typeOver(page, 'changed in the box\nsecond line\n');
  await page.evaluate(`${named('Save')}.click()`);
  await page.until(`!document.querySelector('.file-editor') && document.querySelector('.file-text')?.textContent === 'changed in the box'`);
  assert.equal(fs.readFileSync(files.saves, 'utf8'), 'changed in the box\nsecond line\n');
  assert.ok((await toasts(page)).some(text => text.startsWith('Saved')));
  assert.equal(await page.evaluate(`!!document.querySelector(${JSON.stringify(button('Edit file'))})`), true, 'the pencil is back');
  assert.equal(await page.evaluate(`document.activeElement === document.querySelector('.file-body')`), true, 'the focus is on the file');
  assert.deepEqual(page.problems, []);
});

test('Escape in the text box keeps the text and stays in the editor', { skip, timeout }, async t => {
  const page = await appPage(t);
  await open(page, 'saves');
  await page.click(button('Edit file'));
  await typeOver(page, 'kept on Escape\n');
  await page.press('Escape');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await boxValue(page), 'kept on Escape\n');
  assert.equal(await page.evaluate(`!!document.querySelector('[data-slot="alert-dialog-action"]')`), false, 'no question');
  assert.equal(await page.evaluate(`!!document.querySelector('.file-view')`), true, 'the file is still open');
  assert.deepEqual(page.problems, []);
});

test('a file that changed on disk keeps the text, writes nothing and offers no way to overwrite, and Cancel shows the new version so a second try works', { skip, timeout }, async t => {
  const page = await appPage(t);
  await open(page, 'races');
  await page.click(button('Edit file'));
  await typeOver(page, 'my edit\n');
  fs.writeFileSync(files.races, 'their change\n');
  await page.evaluate(`${named('Save')}.click()`);
  await page.until(`!!document.querySelector('.file-alert')`);
  const note = await page.evaluate(`(a => ({ role: a.getAttribute('role'), words: a.querySelector('p').textContent, buttons: [...a.querySelectorAll('.btn')].map(b => b.textContent), href: a.querySelector('a').getAttribute('href'), target: a.querySelector('a').target, rel: a.querySelector('a').rel }))(document.querySelector('.file-alert'))`);
  assert.deepEqual(note, {
    role: 'alert', words: 'This file changed on disk after you opened it, so nothing was saved. Your text is still here.', buttons: ['Copy text', 'Open the new version'],
    href: `api/sessions/chat/file?path=${encodeURIComponent(files.races)}`, target: '_blank', rel: 'noopener',
  });
  assert.equal(fs.readFileSync(files.races, 'utf8'), 'their change\n', 'nothing was written');
  assert.equal(await boxValue(page), 'my edit\n', 'the text is still in the box');
  assert.equal(await page.evaluate(`${named('Save')}.disabled`), false, 'Save stays on');
  await page.evaluate(`${named('Save')}.click()`);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(fs.readFileSync(files.races, 'utf8'), 'their change\n', 'a second Save is checked against the same version');
  assert.equal(await page.evaluate(`!!document.querySelector('.file-alert')`), true);
  await discard(page);
  await page.until(`!document.querySelector('.file-editor') && document.querySelector('.file-text')?.textContent === 'their change'`);
  await page.until(`!!document.querySelector(${JSON.stringify(button('Edit file'))})`);
  await page.click(button('Edit file'));
  await typeOver(page, 'my edit on theirs\n');
  await page.evaluate(`${named('Save')}.click()`);
  await page.until(`!document.querySelector('.file-editor')`);
  assert.equal(fs.readFileSync(files.races, 'utf8'), 'my edit on theirs\n');
  assert.deepEqual(page.problems, []);
});

test('Cancel on a file that can no longer be read says so and shows no old copy', { skip, timeout }, async t => {
  const page = await appPage(t);
  await open(page, 'gone');
  await page.click(button('Edit file'));
  fs.unlinkSync(files.gone);
  await page.evaluate(`${named('Cancel')}.click()`);
  await page.until(`!!document.querySelector('.file-note[role="alert"]')`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.file-lines, .file-editor').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('a read only file says why and has no pencil', { skip, timeout }, async t => {
  const page = await appPage(t);
  await open(page, 'locked');
  await page.until(`!!document.querySelector('.file-readonly')`);
  assert.match(await page.evaluate(`document.querySelector('.file-readonly').textContent`), /Hidden files/);
  assert.equal(await page.evaluate(`!!document.querySelector(${JSON.stringify(button('Edit file'))})`), false);
  assert.deepEqual(page.problems, []);
});

test('leaving a file with unsaved changes keeps them as a draft, says so, and gives them back with a line that says where they came from', { skip, timeout }, async t => {
  const page = await appPage(t);
  await open(page, 'draft');
  await page.click(button('Edit file'));
  assert.equal(await page.evaluate(`!!document.querySelector('.file-hint')`), false, 'a fresh edit has no restored line');
  await typeOver(page, 'half done\n');
  await open(page, 'locked');
  await page.until(`!document.querySelector('.file-editor')`);
  assert.ok((await toasts(page)).includes('Unsaved changes to draft.txt are kept. Open the file again to finish.'), JSON.stringify(await toasts(page)));
  assert.equal(fs.readFileSync(files.draft, 'utf8'), 'first line of draft\nsecond line\n', 'the file is unchanged');
  await open(page, 'draft');
  await page.until(`document.querySelector('.file-editor')?.value === 'half done\\n'`);
  const hint = await page.evaluate(`(h => ({ text: h.textContent, role: h.getAttribute('role') }))(document.querySelector('.file-hint'))`);
  assert.deepEqual(hint, { text: 'These are your unsaved edits from earlier. Nothing is saved yet.', role: 'status' });
  await page.evaluate(`document.querySelector('.file-editor').focus()`);
  await page.insert('x');
  await page.until(`!document.querySelector('.file-hint')`);
  await discard(page);
  await page.until(`!document.querySelector('.file-editor')`);
  assert.equal(await page.evaluate(`localStorage.getItem('capcom.fileDrafts')`), '{}', 'discarding drops the draft');
  assert.deepEqual(page.problems, []);
});

test('sign-out empties the drafts, and the page leaving afterwards writes none back', { skip, timeout }, async t => {
  const page = await appPage(t);
  await open(page, 'draft');
  await page.click(button('Edit file'));
  await typeOver(page, 'secret draft\n');
  await page.until(`(localStorage.getItem('capcom.fileDrafts') || '').includes('secret draft')`);
  await page.evaluate(`import('./ui/draft.js').then(m => m.forgetDrafts())`);
  assert.equal(await page.evaluate(`localStorage.getItem('capcom.fileDrafts')`), '{}');
  await page.insert(' and more');
  await page.evaluate(`dispatchEvent(new Event('pagehide'))`);
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await page.evaluate(`localStorage.getItem('capcom.fileDrafts')`), '{}');
  assert.deepEqual(page.problems, []);
});

test('a browser that will not store the draft says so beside the text', { skip, timeout }, async t => {
  const page = await appPage(t);
  await open(page, 'draft');
  await page.click(button('Edit file'));
  await page.evaluate(`Storage.prototype.setItem = () => { throw new Error('full'); }`);
  await typeOver(page, 'no room\n');
  await page.until(`document.querySelector('.file-hint')?.textContent === 'This browser would not keep a draft of your text, so save or copy it before you leave.'`);
  assert.equal(await page.evaluate(`document.querySelector('.file-hint').getAttribute('role')`), 'status');
  assert.deepEqual(page.problems, []);
});

test('closing the panel with its own X while a file is half edited says the edit is kept, and the file gives it back', { skip, timeout }, async t => {
  const page = await appPage(t);
  await open(page, 'draft');
  await page.click(button('Edit file'));
  await typeOver(page, 'closed with the X\n');
  await page.click('.panel-head button[aria-label="Close panel"]');
  await page.until(`!document.querySelector('#panel')`);
  await page.until(`!!document.querySelector('[data-sonner-toast]')`);
  assert.ok((await toasts(page)).includes('Unsaved changes to draft.txt are kept. Open the file again to finish.'), JSON.stringify(await toasts(page)));
  assert.match(await page.evaluate(`localStorage.getItem('capcom.fileDrafts')`), /closed with the X/);
  await open(page, 'draft');
  await page.until(`document.querySelector('.file-editor')?.value === 'closed with the X\\n'`);
  assert.deepEqual(page.problems, []);
});

test('on a phone with the keyboard up, the panel is pinned to what the visual viewport shows so Save and Cancel stay on screen, and it lets go when the keyboard goes', { skip, timeout }, async t => {
  const page = await appPage(t, { phone: true });
  await open(page, 'draft', { phone: true });
  await page.evaluate(`(() => {
    const view = Object.assign(new EventTarget(), { height: 300, width: innerWidth, offsetTop: 40, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: view, configurable: true });
    window.keyboard = view;
  })()`);
  await page.tap(button('Edit file'));
  await page.until(`document.querySelector('.panel').hasAttribute('data-keyboard')`);
  const where = () => page.evaluate(`(() => {
    const r = document.querySelector('.panel').getBoundingClientRect();
    const head = [...document.querySelectorAll('.file-actions button')].map(b => b.getBoundingClientRect());
    return { top: r.top, height: r.height, heads: head.every(b => b.top >= r.top && b.bottom <= r.bottom) };
  })()`);
  assert.deepEqual(await where(), { top: 40, height: 300, heads: true });
  await page.evaluate(`keyboard.offsetTop = 90; keyboard.height = 250; keyboard.dispatchEvent(new Event('scroll'))`);
  await page.until(`document.querySelector('.panel').getBoundingClientRect().top === 90`);
  assert.deepEqual(await where(), { top: 90, height: 250, heads: true });
  await page.evaluate(`document.querySelector('.file-editor').blur()`);
  assert.equal(await page.evaluate(`document.querySelector('.panel').hasAttribute('data-keyboard')`), true, 'still pinned while the keyboard is on its way out');
  await page.evaluate(`keyboard.offsetTop = 0; keyboard.height = innerHeight; keyboard.dispatchEvent(new Event('resize'))`);
  await page.until(`!document.querySelector('.panel').hasAttribute('data-keyboard')`);
  assert.equal(await page.evaluate(`document.querySelector('.panel').style.cssText`), '');
  assert.deepEqual(page.problems, []);
});

test('on a phone, the pan iOS makes to reach the caret scrolls the text box by the same amount once, and a rotation neither repeats it nor leaves the panel wider than the screen', { skip, timeout }, async t => {
  const page = await appPage(t, { phone: true });
  await open(page, 'long', { phone: true });
  await page.evaluate(`(() => {
    const view = Object.assign(new EventTarget(), { height: 300, width: innerWidth, offsetTop: 40, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: view, configurable: true });
    window.keyboard = view;
  })()`);
  await page.tap(button('Edit file'));
  await page.until(`document.querySelector('.panel').hasAttribute('data-keyboard')`);
  await new Promise(resolve => setTimeout(resolve, 150));
  const scrolled = () => page.evaluate(`document.querySelector('.file-editor').scrollTop`);
  const wide = () => page.evaluate(`document.querySelector('.panel').getBoundingClientRect().width`);
  const screen = await page.evaluate(`innerWidth`);
  assert.equal(await wide(), screen);
  await page.evaluate(`document.querySelector('.file-editor').scrollTop = 0`);
  await page.evaluate(`keyboard.offsetTop = 140; keyboard.dispatchEvent(new Event('scroll'))`);
  assert.equal(await scrolled(), 100, 'a pan of 100 moves the box by 100');
  await page.evaluate(`keyboard.dispatchEvent(new Event('scroll'))`);
  assert.equal(await scrolled(), 100, 'another scroll event at the same offset adds nothing');
  await page.evaluate(`window.dispatchEvent(new Event('resize'))`);
  assert.equal(await scrolled(), 100, 'a rotation adds nothing');
  await page.evaluate(`keyboard.width = 200; keyboard.dispatchEvent(new Event('resize'))`);
  assert.equal(await wide(), 200, 'the panel is no wider than the viewport, even when the viewport changes after the width was measured');
  await page.evaluate(`keyboard.width = innerWidth; keyboard.dispatchEvent(new Event('resize'))`);
  assert.equal(await wide(), screen);
  assert.equal(await scrolled(), 100);
  assert.deepEqual(page.problems, []);
});

test('on a phone, a file that only overflows once the keyboard is up still scrolls to the caret', { skip, timeout }, async t => {
  const page = await appPage(t, { phone: true });
  await open(page, 'fits', { phone: true });
  await page.evaluate(`(() => {
    const view = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: view, configurable: true });
    window.keyboard = view;
  })()`);
  await page.tap(button('Edit file'));
  await page.until(`document.activeElement === document.querySelector('.file-editor')`);
  const box = `document.querySelector('.file-editor')`;
  assert.equal(await page.evaluate(`${box}.scrollHeight <= ${box}.clientHeight`), true, 'the text fits before the keyboard opens');
  await page.evaluate(`keyboard.offsetTop = 100; keyboard.height = 300; keyboard.dispatchEvent(new Event('resize'))`);
  assert.equal(await page.evaluate(`${box}.scrollTop`), 100);
  assert.deepEqual(page.problems, []);
});

test('on a phone, 390 and 320 px wide, the buttons are on screen and the text box does not zoom the page', { skip, timeout }, async t => {
  const page = await appPage(t, { phone: true });
  await open(page, 'phone', { phone: true });
  await page.tap(button('Edit file'));
  await page.until(`!!document.querySelector('.file-editor')`);
  const measure = () => page.evaluate(`(() => {
    const within = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; };
    const buttons = [...document.querySelectorAll('.file-actions button')];
    return { all: buttons.map(b => [b.textContent || b.getAttribute('aria-label'), within(b)]), font: getComputedStyle(document.querySelector('.file-editor')).fontSize, scroll: document.documentElement.scrollWidth <= innerWidth };
  })()`);
  for (const width of [390, 320]) {
    await page.resize(width, 700);
    const box = await measure();
    assert.deepEqual(box.all.map(([, shown]) => shown), box.all.map(() => true), `${width}: ${JSON.stringify(box.all)}`);
    assert.ok(box.all.some(([name]) => name === 'Save'));
    assert.equal(box.font, '16px');
    assert.equal(box.scroll, true, `${width}: the page does not scroll sideways`);
  }
  await typeOver(page, 'typed on a phone\n');
  await page.until(`!${named('Save')}.disabled`);
  await page.tap('.file-actions .btn:not([data-variant])');
  await page.until(`!document.querySelector('.file-editor')`);
  assert.equal(fs.readFileSync(files.phone, 'utf8'), 'typed on a phone\n');
  assert.deepEqual(page.problems, []);
});
