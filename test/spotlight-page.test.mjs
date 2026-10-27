// Run with `npm test`. A session's row in the search, in a real page against the real server: the title alone with its state mark,
// the time only while the whole title fits, the full title in a tooltip, and an archived row opened by Enter and unarchived by
// Shift+Enter. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
const LONG = 'Give a GhostShell session a way to message its idle sub sessions through the tool that lists them, and name each by the title of its chip';
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const minutesAgo = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
const rowOf = title => `[...document.querySelectorAll('[data-slot="command-item"]')].find(el => el.querySelector('[data-part="hit-title"]')?.textContent === ${JSON.stringify(title)})`;

let app;
let browser;

before(async () => {
  if (skip) return;
  app = await start({
    sessions: [
      { id: 'long', title: LONG, ago: 1 },
      { id: 'short', title: 'Tidy the list', ago: 2 },
      { id: 'gone', title: 'Old work', ago: 30 },
      { id: 'older', title: 'Older work', ago: 40 },
    ],
    layout: { archived: { gone: minutesAgo(5), older: minutesAgo(10) } },
  });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

async function searchPage(t, chip) {
  const page = await browser.open(`${app.origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || ${LIST})`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
  }
  await page.evaluate(`document.querySelector('.offer .btn:last-child')?.click()`);
  await page.click('button.find');
  await page.until(`!!document.querySelector('.chips .chip')`);
  await page.evaluate(`[...document.querySelectorAll('.chips .chip')].find(b => b.textContent === ${JSON.stringify(chip)}).click()`);
  await page.until(`!!document.querySelector('[data-part="hit-line"]')`);
  return page;
}

// Whether the row's time sits on the title's line, where it shows, or has wrapped below it, where the line clips it.
const timeShows = (page, title) => page.evaluate(`(row => {
  const line = row.querySelector('[data-part="hit-line"]').getBoundingClientRect();
  return row.querySelector('[data-part="hit-time"]').getBoundingClientRect().top < line.bottom;
})(${rowOf(title)})`);

test('a session row shows its state mark and title, with no folder, branch or button, and the time only while the whole title fits', { skip, timeout }, async t => {
  const page = await searchPage(t, 'Sessions');
  await page.until(`!!(${rowOf(LONG)}) && !!(${rowOf('Tidy the list')})`);
  const parts = await page.evaluate(`[...(${rowOf('Tidy the list')}).querySelectorAll('[data-part], .lamp, button')].map(el => el.dataset.part || el.className)`);
  assert.deepEqual(parts, ['lamp', 'hit-line', 'hit-title', 'hit-time']);
  assert.equal(await timeShows(page, 'Tidy the list'), true);
  assert.equal(await timeShows(page, LONG), false, 'a title too long for the row hides the time');
  assert.equal(await page.evaluate(`(el => el.scrollWidth > el.clientWidth)((${rowOf(LONG)}).querySelector('[data-part="hit-title"]'))`), true, 'and ends in an ellipsis');
  await page.hover(`#${await page.evaluate(`(${rowOf(LONG)}).id`)} [data-part="hit-title"]`);
  await page.until(`document.querySelector('[data-slot="tooltip-content"]')?.textContent.includes(${JSON.stringify(LONG)})`, 5000);
  assert.deepEqual(page.problems, []);
});

test('an archived row has no Unarchive button, Enter opens it, and Shift+Enter unarchives it with the key shown in the footer', { skip, timeout }, async t => {
  const page = await searchPage(t, 'Archived');
  await page.until(`!!(${rowOf('Old work')})`);
  assert.equal(await page.evaluate(`document.querySelectorAll('[cmdk-list] button').length`), 0);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('[data-part="command-footer"] span')].some(el => el.textContent.startsWith('Unarchive'))`), true);
  await page.evaluate(`document.querySelector('[cmdk-input]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))`);
  await page.until(`document.querySelector('[data-sonner-toast] [data-title]')?.textContent === 'Unarchived “Old work”.'`, 10_000);
  await page.until(`!(${rowOf('Old work')}) && !!(${rowOf('Older work')})`);
  await page.press('Enter');
  await page.until(`location.hash === '#/s/older'`);
  assert.deepEqual(page.problems, []);
});
