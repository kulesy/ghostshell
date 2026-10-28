// Run with `npm test`. The pick bar's New parent in the real page: the button and the row menu item, the form that replaces the bar with
// its title selected, Enter and Esc, the choice of a place when the rows are in different places, the note with its Undo, a refusal, and a
// phone. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, PASSWORD, request, signIn, start } from './harness.mjs';

const GROUPS = [{ id: 'cg-work', name: 'Work' }, { id: 'cg-home', name: 'Home' }];
const SESSIONS = [
  { id: 'loner', title: 'Loner', ago: 1 },
  { id: 'other', title: 'Other loner', ago: 2 },
  { id: 'peer', title: 'Peer', group: 'cg-work', ago: 3 },
  { id: 'twin', title: 'Fix login bug', ago: 4 },
  { id: 'twin2', title: 'Fix login flow', ago: 5 },
];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let browser;

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const MENU = `.menu:not([data-sub])`;

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

async function appPage(t, { phone = false } = {}) {
  const setter = await browser.open(`${app.origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'collapsed', 'folded'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  const page = await browser.open(`${app.origin}/`, { phone });
  t.after(() => page.close());
  await login(page);
  await page.until(`document.querySelectorAll('a.row[data-id]').length >= ${SESSIONS.length}`);
  return page;
}

const ROW = id => `a.row[data-id="${id}"]`;
const BAR = `.pick-bar:not(.pick-making)`;
const FORM = `.pick-making`;
const INPUT = `${FORM} input`;
const NOTE = `[data-sonner-toast]`;

// A Cmd-click on a Mac and a Ctrl-click anywhere else picks a row without opening it.
const pickRows = (page, ...ids) => page.evaluate(`(() => {
  const mac = navigator.platform.startsWith('Mac');
  for (const id of ${JSON.stringify(ids)}) document.querySelector('a.row[data-id="' + id + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
})()`);
const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const noteText = page => text(page, `${NOTE} [data-title]`);
const focused = page => page.evaluate(`document.activeElement.matches('a.row') ? 'row:' + document.activeElement.dataset.id : document.activeElement.matches('${INPUT}') ? 'input' : document.activeElement.className || document.activeElement.tagName`);
const layoutOf = () => JSON.parse(fs.readFileSync(app.layout, 'utf8'));
const choose = async (page, label) => {
  await page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem]')].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '')`);
  await page.click(`${MENU} [data-picked]`);
};
const rightClick = async (page, id) => {
  await page.evaluate(`(a => { const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 40, clientY: r.y + r.height / 2 })); })(document.querySelector('${ROW(id)}'))`);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
};
// The note slides in from below the edge, and a click before it is on screen lands on nothing.
const undo = async page => {
  await page.until(`(b => !!b && b.getBoundingClientRect().bottom <= innerHeight)(document.querySelector('${NOTE} [data-action]'))`);
  await page.click(`${NOTE} [data-action]`);
};

test('two picked rows show New parent beside Archive, and one row shows neither the form nor the button', { skip, timeout }, async t => {
  const page = await appPage(t);
  await pickRows(page, 'loner');
  await page.until(`!!document.querySelector('${BAR}')`);
  assert.equal(await page.evaluate(`!!document.querySelector('.pick-new')`), false, 'one row is not enough');
  await pickRows(page, 'other');
  await page.until(`!!document.querySelector('.pick-new')`);
  assert.equal(await text(page, '.pick-new'), 'New parent');
  assert.deepEqual(page.problems, []);
});

test('New parent turns the bar into a form with a default title selected, Esc gives the bar and the focus back, and Enter makes the parent', { skip, timeout }, async t => {
  const page = await appPage(t);
  await pickRows(page, 'twin', 'twin2');
  await page.until(`!!document.querySelector('.pick-new')`);
  await page.click('.pick-new');
  await page.until(`!!document.querySelector('${INPUT}')`);
  assert.equal(await focused(page), 'input');
  assert.deepEqual(await page.evaluate(`(i => [i.value, i.selectionStart, i.selectionEnd, i.getAttribute('aria-label')])(document.querySelector('${INPUT}'))`), ['Fix login', 0, 9, 'Title of the new parent of 2 sessions']);
  assert.equal(await page.evaluate(`!!document.querySelector('${FORM} select')`), false, 'both rows are in one place, so no place is asked');
  assert.equal(await page.evaluate(`document.querySelector('${FORM} [type=submit]').disabled`), false);

  await page.press('Escape');
  await page.until(`!document.querySelector('${FORM}') && !!document.querySelector('${BAR}')`);
  assert.equal(await focused(page), 'btn pick-new');
  assert.equal(await text(page, '.pick-count'), '2 selected', 'the pick is as it was');

  await page.press('Enter');
  await page.until(`!!document.querySelector('${INPUT}')`);
  await page.insert('Login work');
  await page.press('Enter');
  await page.until(`!document.querySelector('.pick-bar')`);
  await page.until(`!!document.querySelector('${NOTE}')`);
  assert.equal(await noteText(page), 'Made “Login work” the parent of 2 sessions.');
  assert.equal(await text(page, `${NOTE} [data-action]`), 'Undo');
  const [made] = Object.keys(layoutOf().titles);
  await page.until(`!!document.querySelector('${ROW(made)}')`);
  assert.equal(await focused(page), `row:${made}`);
  assert.equal(await page.evaluate(`document.querySelector('${ROW(made)}').closest('li').querySelector('.sub-rows')?.querySelectorAll('a.row').length`), 2, 'the family is open');
  assert.equal(await text(page, `${ROW(made)} .row-title`), 'Login work');
  assert.deepEqual(layoutOf().parents, { twin: made, twin2: made });
  assert.deepEqual(page.problems, []);

  await undo(page);
  await page.until(`!document.querySelector('${ROW(made)}')`);
  assert.equal(await noteText(page), 'Took back “Login work”.');
  assert.deepEqual([layoutOf().parents, layoutOf().titles], [{}, {}]);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${app.state}/started.json`, 'utf8')).filter(e => e.booked), []);
  assert.deepEqual(page.problems, []);
});

test('the row menu of a picked row has New parent session, and a menu on a row outside the pick does not', { skip, timeout }, async t => {
  const page = await appPage(t);
  await pickRows(page, 'loner', 'other');
  await rightClick(page, 'other');
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem] .menu-text')].map(el => el.textContent)`), ['New parent session', 'Archive 2 sessions', 'Clear selection']);
  await choose(page, 'New parent session');
  await page.until(`!!document.querySelector('${INPUT}')`);
  assert.equal(await focused(page), 'input');
  assert.equal(await page.evaluate(`document.querySelector('${INPUT}').value`), 'Loner and 1 more');
  await page.press('Escape');
  await page.until(`!!document.querySelector('${BAR}')`);
});

test('a pick that changes closes the form, and a refusal from the server shows its sentence and leaves the form and the pick', { skip, timeout }, async t => {
  const page = await appPage(t);
  await pickRows(page, 'loner', 'other');
  await page.click('.pick-new');
  await page.until(`!!document.querySelector('${INPUT}')`);
  await pickRows(page, 'twin');
  await page.until(`!document.querySelector('${FORM}') && !!document.querySelector('${BAR}')`);
  assert.equal(await text(page, '.pick-count'), '3 selected');

  await page.evaluate(`(fetch => { window.fetch = (url, init) => String(url).endsWith('api/layout/parent') ? fetch(url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), ids: [...JSON.parse(init.body).ids, 'ghost'] }) }) : fetch(url, init); })(window.fetch.bind(window))`);
  await page.click('.pick-new');
  await page.until(`!!document.querySelector('${INPUT}')`);
  await page.insert('Will be refused');
  await page.press('Enter');
  await page.until(`!!document.querySelector('${NOTE}')`);
  assert.equal(await page.evaluate(`document.querySelector('${NOTE}').dataset.type`), 'warning');
  assert.equal(await noteText(page), 'No session with that id on this Mac.');
  assert.equal(await page.evaluate(`!!document.querySelector('${INPUT}')`), true, 'the form stays to try again');
  assert.equal(await page.evaluate(`document.querySelector('${INPUT}').getAttribute('aria-label')`), 'Title of the new parent of 3 sessions', 'the pick stays');
  assert.deepEqual(layoutOf().parents, {});
});

test('rows in different places ask for one: Create waits for a choice among only those places, and the choice is where the parent goes', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.evaluate(`document.querySelector('${NOTE}')?.remove()`);
  await pickRows(page, 'loner', 'peer');
  await page.click('.pick-new');
  await page.until(`!!document.querySelector('${FORM} select')`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('${FORM} select option')].map(o => [o.textContent, o.disabled, o.selected])`), [['Choose where it goes', true, true], ['Work', false, false], ['Started here', false, false]]);
  assert.equal(await page.evaluate(`document.querySelector('${FORM} [type=submit]').disabled`), true);
  await page.press('Enter');
  assert.equal(await page.evaluate(`!!document.querySelector('${FORM}')`), true, 'Enter does nothing until a place is chosen');
  await page.evaluate(`(select => { select.value = 'cg-work'; select.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('${FORM} select'))`);
  await page.until(`!document.querySelector('${FORM} [type=submit]').disabled`);
  await page.click(`${FORM} [type=submit]`);
  await page.until(`!document.querySelector('.pick-bar')`);
  const made = Object.keys(layoutOf().titles)[0];
  assert.equal(layoutOf().assignments[made], 'cg-work');
  await page.until(`!!document.querySelector('${ROW(made)}')`);
  await undo(page);
  await page.until(`!document.querySelector('${ROW(made)}')`);
  assert.equal(layoutOf().assignments.peer, 'cg-work', 'Undo puts the group back');
});

test('on a phone the form fits the screen and the menu does the whole job', { skip, timeout }, async t => {
  const page = await appPage(t, { phone: true });
  await pickRows(page, 'twin', 'twin2');
  await page.until(`!!document.querySelector('.pick-new')`);
  await page.tap('.pick-new');
  await page.until(`!!document.querySelector('${INPUT}')`);
  const box = await page.evaluate(`(r => [r.left, r.right, innerWidth])(document.querySelector('${FORM}').getBoundingClientRect())`);
  assert.ok(box[0] >= 0 && box[1] <= box[2], JSON.stringify(box));
  const create = await page.evaluate(`(r => [r.width, r.height])(document.querySelector('${FORM} [type=submit]').getBoundingClientRect())`);
  assert.ok(create[1] >= 28, JSON.stringify(create));
  await page.tap(`${FORM} [type=submit]`);
  await page.until(`!document.querySelector('.pick-bar')`);
  assert.equal(Object.keys(layoutOf().titles).length >= 1, true);
});
