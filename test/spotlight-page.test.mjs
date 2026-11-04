// Run with `npm test`. A session's row in the search, in a real page against the real server: the title alone with its state mark,
// the time only while the whole title fits, the full title in a tooltip, an archived row opened by Enter and unarchived by
// Shift+Enter, and the pull requests a typed number, address or #number finds, shown under the title. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked.
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

const pr = (n, repo) => `https://github.com/${repo}/pull/${n}`;
const RETRY = 'Retry a dropped upload from the byte where it stopped, so a large file on a poor connection does not start again from nothing each time';
const SHARED = [
  { id: 'retry', title: RETRY, ago: 3, said: [`Opened ${pr(7969, 'acme/web')}`] },
  { id: 'docs', title: 'Document the new flag', ago: 4, said: [pr(7969, 'acme/docs')] },
  { id: 'notes', title: 'Release notes', ago: 5, said: [`Both ${pr(7969, 'acme/web')} and ${pr(7969, 'acme/docs')}`] },
  { id: 'cache', title: 'Cache layer', ago: 6, said: [pr(88, 'acme/web')] },
];

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
      ...SHARED,
    ],
    layout: { archived: { gone: minutesAgo(5), older: minutesAgo(10) } },
  });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

async function searchPage(t, chip, size) {
  const page = await browser.open(`${app.origin}/`);
  if (size) await page.resize(...size);
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

const titlesShown = page => page.evaluate(`[...document.querySelectorAll('[data-slot="command-item"] [data-part="hit-title"]')].map(el => el.textContent)`);
const pullsOf = (page, title) => page.evaluate(`[...(${rowOf(title)}).querySelectorAll('[data-part="hit-pull"]')].map(el => el.querySelector('[data-part="hit-pull-repo"]').textContent + ' ' + el.querySelector('[data-part="hit-pull-number"]').textContent)`);

async function ask(page, text, shown) {
  await page.evaluate(`document.querySelector('[cmdk-input]').focus(); document.querySelector('[cmdk-input]').select()`);
  await page.insert(text);
  await page.until(`${JSON.stringify(shown)}.every(t => [...document.querySelectorAll('[data-slot="command-item"] [data-part="hit-title"]')].some(el => el.textContent === t))`, 15_000);
  await page.until(`document.querySelectorAll('[data-slot="command-item"]').length === ${shown.length}`, 5000);
}

test('a number, #number and pull/number find every session that links that pull request, each showing the repo and the number', { skip, timeout }, async t => {
  const page = await searchPage(t, 'Sessions');
  const all = [RETRY, 'Document the new flag', 'Release notes'];
  for (const text of ['7969', '#7969', 'pull/7969']) {
    await ask(page, text, all);
    assert.deepEqual((await titlesShown(page)).sort(), [...all].sort(), text);
  }
  assert.deepEqual(await pullsOf(page, RETRY), ['acme/web #7969']);
  assert.deepEqual(await pullsOf(page, 'Document the new flag'), ['acme/docs #7969']);
  assert.deepEqual((await pullsOf(page, 'Release notes')).sort(), ['acme/docs #7969', 'acme/web #7969']);
  assert.equal(await page.evaluate(`(${rowOf('Release notes')}).querySelector('[data-part="hit-pull"] > .sr').textContent`), 'Pull request ', 'a screen reader hears what the repo and number are');
  assert.deepEqual(page.problems, []);
});

test('a pasted address finds only the sessions that link that repo\'s pull request, and a word that finds a title alone shows no pull request', { skip, timeout }, async t => {
  const page = await searchPage(t, 'Sessions');
  await ask(page, pr(7969, 'acme/docs'), ['Document the new flag', 'Release notes']);
  assert.deepEqual(await pullsOf(page, 'Release notes'), ['acme/docs #7969'], 'only the link the address names');
  await ask(page, 'https://github.com/acme/web/pull/7969/files', [RETRY, 'Release notes']);
  await ask(page, '88', ['Cache layer']);
  assert.deepEqual(await pullsOf(page, 'Cache layer'), ['acme/web #88']);
  await ask(page, 'flag', ['Document the new flag']);
  assert.deepEqual(await pullsOf(page, 'Document the new flag'), [], 'a title match shows no pull request');
  assert.deepEqual(page.problems, []);
});

for (const [name, size] of [['a desktop window', [1280, 860]], ['a phone', [390, 844]]]) {
  test(`the pull request of a row with a very long title stays whole on ${name}, under the title and inside the row`, { skip, timeout }, async t => {
    const page = await searchPage(t, 'Sessions', size);
    await ask(page, '#7969', [RETRY, 'Document the new flag', 'Release notes']);
    const box = await page.evaluate(`(row => {
      const at = el => el.getBoundingClientRect();
      const inside = at(row);
      const pull = row.querySelector('[data-part="hit-pull"]');
      const number = pull.querySelector('[data-part="hit-pull-number"]');
      const title = row.querySelector('[data-part="hit-title"]');
      return { fits: at(number).right <= inside.right && at(number).left >= inside.left && at(number).width > 0, below: at(pull).top >= at(title).bottom, cut: title.scrollWidth > title.clientWidth };
    })(${rowOf(RETRY)})`);
    assert.deepEqual(box, { fits: true, below: true, cut: true });
    assert.deepEqual(page.problems, []);
  });
}

test('a row with no pull request found by its title keeps the parts it had', { skip, timeout }, async t => {
  const page = await searchPage(t, 'Sessions');
  await ask(page, 'tidy', ['Tidy the list']);
  const parts = await page.evaluate(`[...(${rowOf('Tidy the list')}).querySelectorAll('[data-part], .lamp, button')].map(el => el.dataset.part || el.className)`);
  assert.deepEqual(parts, ['lamp', 'hit-line', 'hit-title', 'hit-time']);
});
