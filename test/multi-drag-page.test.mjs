// Run with `npm test`. Dragging and acting on a selection in the real page: the badge on the lifted copy, a drop on a group or a row,
// the refusal marker, the Move menu on the pick bar, the one Undo, and swipe being off while rows are picked. It needs Playwright's
// Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const GROUPS = [{ id: 'cg-work', name: 'Work' }, { id: 'cg-home', name: 'Home' }];
const SESSIONS = [
  { id: 'a', title: 'Alpha', ago: 1 },
  { id: 'b', title: 'Bravo', ago: 2 },
  { id: 'c', title: 'Charlie', group: 'cg-work', ago: 3 },
  { id: 'd', title: 'Delta', group: 'cg-home', ago: 4 },
  { id: 'e', title: 'Echo', group: 'cg-home', ago: 5 },
];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let browser;

before(async () => {
  if (!skip) browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const MENU = `.menu:not([data-sub])`;
const SUB = `.menu[data-sub]`;
const NOTE = `[data-sonner-toast]`;
const ROW = id => `a.row[data-id="${id}"]`;

async function appPage(t, { phone = false } = {}) {
  const server = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const setter = await browser.open(`${server.origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'collapsed', 'folded'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  const page = await browser.open(`${server.origin}/`, { phone });
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || (${LIST}))`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
  }
  await page.until(`document.querySelectorAll('a.row[data-id]').length >= ${SESSIONS.length}`);
  return { page, server };
}

const layoutOf = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const middleOf = selector => `(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))(document.querySelector('${selector}').getBoundingClientRect())`;
const noteText = page => page.evaluate(`document.querySelector('${NOTE} [data-title]')?.textContent ?? null`);
const pickRows = (page, ...ids) => page.evaluate(`(() => {
  const mac = navigator.platform.startsWith('Mac');
  for (const id of ${JSON.stringify(ids)}) document.querySelector('a.row[data-id="' + id + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
})()`);
const labels = (page, menu = MENU) => page.evaluate(`[...document.querySelectorAll('${menu} > [role=menuitem] .menu-text')].map(el => el.textContent)`);
const choose = async (page, label, menu = MENU) => {
  await page.evaluate(`[...document.querySelectorAll('${menu} [role=menuitem], ${menu} [role=option]')].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '')`);
  await page.click(`${menu} [data-picked]`);
};
const undo = async page => {
  await page.until(`(b => !!b && b.getBoundingClientRect().bottom <= innerHeight)(document.querySelector('${NOTE} [data-action]'))`);
  await page.click(`${NOTE} [data-action]`);
};
const GROUP_OF = key => `.group-head[data-key="${key}"]`;

test('carrying one of two picked rows lifts a copy with a count, dims both, and a drop on a group moves both with one Undo', { skip, timeout }, async t => {
  const { page, server } = await appPage(t);
  await pickRows(page, 'a', 'b');
  const release = await page.carry(ROW('a'), middleOf(GROUP_OF('cg-work')), { after: true });
  assert.equal(await page.evaluate(`document.querySelector('.row.lifted .lift-count')?.textContent`), '2');
  assert.equal(await page.evaluate(`document.querySelectorAll('${ROW('a')}[data-lifted], ${ROW('b')}[data-lifted]').length`), 2, 'both picked rows are dimmed');
  await release();
  await page.until(`!!document.querySelector('${NOTE}')`);
  assert.deepEqual([layoutOf(server).assignments.a, layoutOf(server).assignments.b], ['cg-work', 'cg-work']);
  assert.equal(await noteText(page), 'Moved 2 sessions to Work.');
  await new Promise(done => setTimeout(done, 400));
  await undo(page);
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent === 'Put 2 sessions back.'`);
  assert.deepEqual([layoutOf(server).assignments.a, layoutOf(server).assignments.b], [undefined, undefined]);
  assert.deepEqual(page.problems, []);
});

test('a row that is not picked carries alone, with no count', { skip, timeout }, async t => {
  const { page } = await appPage(t);
  await pickRows(page, 'a', 'b');
  const release = await page.carry(ROW('d'), middleOf(GROUP_OF('cg-work')), { after: true });
  assert.equal(await page.evaluate(`document.querySelector('.row.lifted') !== null && document.querySelector('.row.lifted .lift-count') === null`), true);
  await release();
});

test('a drop of the selection on a row nests every picked session under it, and a drop on a picked row is refused', { skip, timeout }, async t => {
  const { page, server } = await appPage(t);
  await pickRows(page, 'a', 'b');
  const refused = await page.carry(ROW('a'), middleOf(ROW('b')), { after: true });
  assert.equal(await page.evaluate(`document.querySelector('${ROW('b')}').dataset.refused`), 'true');
  assert.equal(await page.evaluate(`document.querySelector('${ROW('b')} .row-nest').textContent`), "Can't nest");
  await refused();
  await page.until(`!!document.querySelector('${NOTE}')`);
  assert.equal(await noteText(page), 'A session cannot nest under itself or a session nested under it.');
  assert.deepEqual(layoutOf(server).parents ?? {}, {}, 'nothing is written');
  const release = await page.carry(ROW('a'), middleOf(ROW('c')), { after: true });
  assert.equal(await page.evaluate(`document.querySelector('${ROW('c')} .row-nest').textContent`), 'Nest here');
  await release();
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent.startsWith('Nested')`);
  assert.deepEqual(layoutOf(server).parents, { a: 'c', b: 'c' });
  assert.equal(await noteText(page), 'Nested 2 sessions under “Charlie”.');
  assert.deepEqual(page.problems, []);
});

test('the Move menu on the pick bar moves, nests and takes out the picked sessions, each with one Undo', { skip, timeout }, async t => {
  const { page, server } = await appPage(t);
  await pickRows(page, 'a', 'b');
  await page.click('.pick-new');
  await page.until(`!!document.querySelector('${MENU}')`);
  assert.deepEqual(await labels(page), ['Move to', 'Nest under', 'New parent session']);
  await choose(page, 'Nest under');
  await page.until(`!!document.querySelector('${SUB}')`);
  await choose(page, 'Charlie', SUB);
  await page.until(`!!document.querySelector('${NOTE}')`);
  assert.deepEqual(layoutOf(server).parents, { a: 'c', b: 'c' });
  assert.equal(await page.evaluate(`!!document.querySelector('.pick-bar')`), true, 'the selection stays for the next action');

  await page.click('.pick-new');
  await page.until(`!!document.querySelector('${MENU}')`);
  assert.deepEqual(await labels(page), ['Move to', 'Nest under', 'Move out of “Charlie”', 'New parent session']);
  await choose(page, 'Move out of “Charlie”');
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent.startsWith('Moved 2 sessions out')`);
  assert.deepEqual(layoutOf(server).parents, { a: null, b: null });
  await undo(page);
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent === 'Put 2 sessions back.'`);
  assert.deepEqual(layoutOf(server).parents, { a: 'c', b: 'c' });
  assert.deepEqual(page.problems, []);
});

test('the row menu of a picked row lists the same actions above Archive, and swipe is off while rows are picked', { skip, timeout }, async t => {
  const { page } = await appPage(t);
  await pickRows(page, 'a', 'b');
  await page.evaluate(`(a => { const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 40, clientY: r.y + r.height / 2 })); })(document.querySelector('${ROW('a')}'))`);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  assert.deepEqual(await labels(page), ['Move to', 'Nest under', 'New parent session', 'Archive 2 sessions', 'Clear selection']);
});

test('on a phone a touch swipe on a row does not archive it while rows are picked', { skip, timeout }, async t => {
  const { page } = await appPage(t, { phone: true });
  await pickRows(page, 'a', 'b');
  await page.until(`!!document.querySelector('.pick-bar')`);
  await page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: await page.evaluate(`document.querySelector('${ROW('c')}').getBoundingClientRect().y + 20`) }] });
  const y = await page.evaluate(`document.querySelector('${ROW('c')}').getBoundingClientRect().y + 20`);
  for (const x of [280, 240, 200, 150, 100, 60]) await page.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  assert.equal(await page.evaluate(`document.querySelector('${ROW('c')}').parentElement.dataset.swipe ?? null`), null);
  await page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});
