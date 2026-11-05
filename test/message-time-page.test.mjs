// Run with `npm test`. Message times in a real page, with the real rows and the real styles: where the time sits, that a day change
// draws it again, and that a selection leaves it out. It needs Playwright's Chromium headless shell, and every test skips with a
// reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound, serve } from './browser.mjs';

const PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/app.css">
<script type="importmap">{ "imports": { "preact": "/vendor/preact.mjs", "preact/hooks": "/vendor/hooks.mjs", "htm": "/vendor/htm.mjs" } }</script>
<div id="root"></div>
<div id="box" style="height: 100vh; overflow-y: auto"><ol class="items" id="items"></ol></div>
<script type="module">
import { h, render } from 'preact';
import { sentAt } from '/ui/format.js';
import { Row } from '/ui/rows.js';

window.sentAt = sentAt;
const onImage = () => {};
window.draw = (items, today) => {
  render(items.map((item, n) => h(Row, { key: n, item, onImage, today })), document.getElementById('items'));
  const box = document.getElementById('box');
  box.scrollTop = box.scrollHeight;
};
window.ready = true;
</script>`;

const chromium = findChromium();
const skip = chromium ? false : notFound();
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

const DAY = 86400_000;
const LONG = 'A long reply. '.repeat(600);
const thread = `(now => [
  { kind: 'user', text: 'mine', at: new Date(now - 8 * ${DAY}).toISOString() },
  { kind: 'assistant', msgId: 'old', text: 'old reply', at: new Date(now - 8 * ${DAY}).toISOString() },
  { kind: 'user', text: 'sent today', at: new Date(now).toISOString() },
  { kind: 'assistant', msgId: 'new', text: ${JSON.stringify(LONG)}, at: new Date(now).toISOString() },
])(Date.now())`;
const shown = selector => `getComputedStyle(document.querySelector(${JSON.stringify(selector)}), '::after').content`;

// The bottom edge of the last message and of the view. The time is the last thing in the message, so the first inside the second means it shows.
const fits = `(() => { const box = document.getElementById('box').getBoundingClientRect(); const last = document.querySelector('#items > li:last-child').getBoundingClientRect(); return { tall: last.height > box.height, bottom: last.bottom, end: box.bottom }; })()`;

async function opened(options) {
  const page = await browser.open(`${site.origin}/`, options);
  await page.until('window.ready === true');
  await page.evaluate(`draw(${thread}, 'one')`);
  return page;
}

for (const phone of [false, true]) {
  test(`opening a chat at the end of a long last message shows its time with no scroll, ${phone ? 'at phone width' : 'on a desktop'}`, { skip, timeout }, async () => {
    const page = await opened({ phone });
    try {
      const { tall, bottom, end } = await page.evaluate(fits);
      assert.ok(tall, 'the last message is taller than the view');
      assert.ok(bottom <= end + 1, `its end at ${bottom} is on screen, which ends at ${end}`);
      assert.equal(await page.evaluate(shown('#items > li:last-child')), JSON.stringify(await page.evaluate(`document.querySelector('#items > li:last-child').dataset.time`)));
    } finally { await page.close(); }
  });
}

test('both sides of a chat show the time, and an older message also shows its day', { skip, timeout }, async () => {
  const page = await opened();
  try {
    const times = await page.evaluate(`[...document.querySelectorAll('#items > li')].map(li => li.dataset.time)`);
    assert.equal(times.length, 4);
    assert.match(times[0], /\d, \d{1,2}:\d{2}|\w{3} \d{1,2}, \d{1,2}:\d{2}/, 'eight days back gives the date and the time');
    assert.equal(times[0], times[1]);
    assert.match(times[2], /^\d{1,2}:\d{2}/, 'today gives the time alone');
    assert.equal(times[2], times[3]);
    const side = selector => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}), '::after').display`);
    assert.equal(await side('.msg.user'), 'block');
    assert.equal(await side('.msg.claude'), 'block');
  } finally { await page.close(); }
});

test('a message with no time, such as one still being sent, draws no time', { skip, timeout }, async () => {
  const page = await opened();
  try {
    await page.evaluate(`draw([{ kind: 'user', text: 'on its way', sending: true }, { kind: 'assistant', msgId: 'x', text: 'undated', at: null }], 'one')`);
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#items > li')].map(li => [li.hasAttribute('data-time'), getComputedStyle(li, '::after').content])`), [[false, 'none'], [false, 'none']]);
  } finally { await page.close(); }
});

test('a selection across messages holds their text and not their times', { skip, timeout }, async () => {
  const page = await opened();
  try {
    await page.evaluate(`draw([{ kind: 'user', text: 'mine', at: new Date().toISOString() }, { kind: 'assistant', msgId: 'a', text: 'yours', at: new Date().toISOString() }], 'one')`);
    const copied = await page.evaluate(`(() => { getSelection().selectAllChildren(document.getElementById('items')); return getSelection().toString(); })()`);
    assert.match(copied, /mine/);
    assert.match(copied, /yours/);
    assert.doesNotMatch(copied, /\d:\d{2}/);
  } finally { await page.close(); }
});

test('a row on screen when the day changes draws again with the day added', { skip, timeout }, async () => {
  const page = await opened();
  try {
    // The row was drawn at a time that is a day old by the page's clock, as one left open overnight has been.
    await page.evaluate(`(() => {
      window.item = [{ kind: 'assistant', msgId: 'a', text: 'overnight', at: new Date().toISOString() }];
      draw(window.item, 'one');
      const real = Date;
      window.Date = class extends real { constructor(...a) { super(...(a.length ? a : [real.now() + ${DAY}])); } static now() { return real.now() + ${DAY}; } };
    })()`);
    const time = `document.querySelector('#items > li').dataset.time`;
    await page.evaluate(`draw(window.item, 'one')`);
    assert.match(await page.evaluate(time), /^\d{1,2}:\d{2}/, 'the same day key leaves the row as it was');
    await page.evaluate(`draw(window.item, 'two')`);
    assert.match(await page.evaluate(time), /^Yesterday, /);
  } finally { await page.close(); }
});
