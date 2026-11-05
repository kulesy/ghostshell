// Run with `npm test`. The New session button on a parent session's row in the real page: where it shows, what it says, the draft it opens with the parent in a chip,
// the session it starts in the parent's folder under the parent, and room left for the title, the fold arrow and the menu at the narrowest widths. It needs
// Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { cliCalls, PASSWORD, start } from './harness.mjs';

const LONG = 'Rework the billing export so the nightly job stops timing out on the very large accounts';
const SESSIONS = [
  { id: 'boss', title: 'Plan the release', folder: 'work', ago: 1 },
  { id: 'kid', title: 'Check the changelog', parent: 'boss', folder: 'work', ago: 2 },
  { id: 'long', title: LONG, ago: 3 },
  { id: 'long-kid', title: 'Nested under the long one', parent: 'long', ago: 4 },
  { id: 'lone', title: 'Loose notes', ago: 5 },
  { id: 'run', title: 'Nightly run', routine: 'nightly', ago: 6 },
];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let browser;

before(async () => {
  if (skip) return;
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const furnished = () => start({ sessions: SESSIONS, claude: true });
const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const CHIP = '.start-group';
const HEAD = `document.querySelector('.chat-head')?.textContent`;
const IN_WORK = `/Code in \\S*work/.test(${HEAD})`;
const AT_HOME = `${HEAD} && !${IN_WORK}`;
const BUTTON = id => `li:has(> a.row[data-id="${id}"]) > .head-tool`;

async function login(page) {
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (!(await page.evaluate(LOGIN))) return;
  await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
  await page.click('.gate-actions button[type=submit]');
  await page.until(LIST, 10_000);
  if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
    await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
    await page.until(`!document.querySelector('.offer')`);
  }
}

async function appPage(t, s, { phone = false, width = null, hash = '#/' } = {}) {
  const setter = await browser.open(`${s.origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'collapsed', 'folded'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  const page = await browser.open(`${s.origin}/${hash}`, { phone });
  t.after(() => page.close());
  if (width) await page.resize(width, 860);
  await login(page);
  if ((await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.until(`document.querySelectorAll('a.row[data-id]').length >= 5`);
  return page;
}

const typeInto = (page, value) => page.evaluate(`(box => { box.value = ${JSON.stringify(value)}; box.dispatchEvent(new Event('input', { bubbles: true })); })(document.querySelector('#text'))`);

// Where the pieces of a parent's row sit, as left and right edges. `room` is the title's own width less what it needs, which is under zero when it is cut short.
const geometry = (page, id) => page.evaluate(`(() => {
  const li = document.querySelector('a.row[data-id="${id}"]').closest('li');
  const edge = el => (el ? (r => [Math.round(r.left * 10) / 10, Math.round(r.right * 10) / 10])(el.getBoundingClientRect()) : null);
  const title = li.querySelector(':scope > a.row .row-title');
  return {
    title: edge(title), shown: title.clientWidth, tool: edge(li.querySelector(':scope > .head-tool')), more: edge(li.querySelector(':scope > .more:not(.head-tool)')),
    fold: edge(li.querySelector(':scope > .fold')), row: edge(li.querySelector(':scope > a.row')),
  };
})()`);

test('only a session that holds others has the button on its row, and its tip names the parent', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s);
  const tools = await page.evaluate(`[...document.querySelectorAll('li > .head-tool')].filter(b => b.parentElement.querySelector(':scope > a.row')).map(b => [b.parentElement.querySelector(':scope > a.row').dataset.id, b.getAttribute('aria-label'), b.dataset.tip])`);
  assert.deepEqual(tools, [['boss', 'New session under Plan the release', 'New session under Plan the release'], ['long', `New session under ${LONG}`, `New session under ${LONG}`]]);
  assert.equal(await page.evaluate(`['kid', 'long-kid', 'lone', 'run'].filter(id => !document.querySelector('a.row[data-id="' + id + '"]')).length`), 0, 'every other row is drawn');
  assert.deepEqual(page.problems, []);
});

test('pressing it opens the new session page with the parent in a chip, and the chip puts the session outside the parent again, keeping the text', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s);
  await page.click(BUTTON('boss'));
  await page.until(`location.hash === '#/new-under/boss' && !!document.querySelector('${CHIP}')`);
  assert.equal(await page.evaluate(`document.querySelector('${CHIP} .name').textContent`), 'Plan the release');
  assert.equal(await page.evaluate(`document.querySelector('${CHIP} button').getAttribute('aria-label')`), 'Start outside Plan the release');
  assert.match(await page.evaluate(`document.querySelector('.chat-head').textContent`), /work/);
  await typeInto(page, 'half a thought');
  await page.click(`${CHIP} button`);
  await page.until(`location.hash === '#/new' && !document.querySelector('${CHIP}')`);
  assert.equal(await page.evaluate(`document.querySelector('#text').value`), 'half a thought');
  await page.until(AT_HOME);
  assert.deepEqual(page.problems, []);
});

test('moving from one parent\'s page to another parent\'s and on to a group\'s changes the chip and the folder', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, claude: true, groups: [{ id: 'cg-work', name: 'Team' }] });
  const page = await appPage(t, s);
  await page.click(BUTTON('boss'));
  await page.until(`location.hash === '#/new-under/boss' && ${IN_WORK}`);
  await page.evaluate(`location.hash = '#/new-under/long'`);
  await page.until(`document.querySelector('${CHIP} .name')?.textContent === ${JSON.stringify(LONG)} && ${AT_HOME}`);
  await page.evaluate(`location.hash = '#/new-under/boss'`);
  await page.until(`document.querySelector('${CHIP} .name')?.textContent === 'Plan the release' && ${IN_WORK}`);
  await page.evaluate(`location.hash = '#/new/cg-work'`);
  await page.until(`document.querySelector('${CHIP} .name')?.textContent === 'Team' && ${AT_HOME}`);
  assert.deepEqual(page.problems, []);
});

test('a page opened for a sub session shows its parent, and one for a session that is gone shows no chip and the home folder', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s);
  await page.evaluate(`location.hash = '#/new-under/kid'`);
  await page.until(`document.querySelector('${CHIP} .name')?.textContent === 'Plan the release' && ${IN_WORK}`);
  await page.evaluate(`location.hash = '#/new-under/nobody'`);
  await page.until(`!document.querySelector('${CHIP}') && ${AT_HOME}`);
  assert.deepEqual(page.problems, []);
});

test('the first message from that page starts the session in the parent\'s folder and nests it under the parent', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s);
  await page.click(BUTTON('boss'));
  await page.until(`location.hash === '#/new-under/boss' && !!document.querySelector('${CHIP}')`);
  await typeInto(page, 'begin a session');
  await page.click('#send');
  await page.until(`location.hash === '#/s/begun-by-the-fake'`);
  assert.equal(cliCalls(s).find(x => x.started).cwd, fs.realpathSync(path.join(s.home, 'work')));
  assert.equal(JSON.parse(fs.readFileSync(s.layout, 'utf8')).parents['begun-by-the-fake'], 'boss');
  await page.until(`!!document.querySelector('a.row[data-id="begun-by-the-fake"]')`);
  assert.equal(await page.evaluate(`document.querySelector('a.row[data-id="begun-by-the-fake"]').closest('ul.sub-rows')?.closest('li').querySelector('a.row').dataset.id`), 'boss');
  assert.deepEqual(page.problems, []);
});

// The pieces of a row from left to right must not overlap, and the title must keep room to read.
const fits = (g, where) => {
  assert.ok(g.tool && g.fold && g.more, `${where}: every button is drawn ${JSON.stringify(g)}`);
  assert.ok(g.title[1] <= g.tool[0] + 0.5, `${where}: the title stops before the new session button ${JSON.stringify(g)}`);
  assert.ok(g.tool[1] <= g.fold[0] + 0.5 || g.tool[1] <= g.more[0] + 0.5 && g.fold[1] <= g.tool[0] + 0.5, `${where}: the new session button and the fold arrow are apart ${JSON.stringify(g)}`);
  assert.ok(g.tool[1] <= g.more[0] + 0.5 || g.more[1] <= g.tool[0] + 0.5, `${where}: the new session button and the menu are apart ${JSON.stringify(g)}`);
  assert.ok(g.fold[1] <= g.more[0] + 0.5 || g.more[1] <= g.fold[0] + 0.5, `${where}: the fold arrow and the menu are apart ${JSON.stringify(g)}`);
  assert.ok(g.more[1] <= g.row[1] + 0.5, `${where}: the menu is inside the row ${JSON.stringify(g)}`);
  assert.ok(g.shown >= 64, `${where}: the title keeps room to read, ${g.shown}`);
};

test('with a pointer the button shows when the row is hovered, and leaves the title, the fold arrow and the menu their room at the narrowest list', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s, { width: 900 });
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${BUTTON('boss')}')).opacity`), '0');
  await page.hover('a.row[data-id="boss"]');
  await page.until(`getComputedStyle(document.querySelector('${BUTTON('boss')}')).opacity === '1'`);
  for (const id of ['boss', 'long']) fits(await geometry(page, id), `900 ${id}`);
  assert.deepEqual(page.problems, []);
});

test('on a phone the button is always shown and fits beside the title, the fold arrow and the menu at 390 and at 320', { skip, timeout }, async t => {
  const s = await furnished();
  for (const width of [390, 320]) {
    const page = await appPage(t, s, { phone: true });
    await page.resize(width, 844);
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${BUTTON('boss')}')).opacity`), '1');
    for (const id of ['boss', 'long']) fits(await geometry(page, id), `${width} ${id}`);
    assert.deepEqual(page.problems, []);
  }
});
