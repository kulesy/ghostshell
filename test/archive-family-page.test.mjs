// Run with `npm test`. Archiving a parent from the sidebar in the real page: the row menu and the pick bar take the sessions below it too, the note counts them,
// Undo brings the family back, and a running sub session is asked about with its count. It needs Playwright's Chromium headless shell, and every test skips
// with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, PASSWORD, request, signIn, start, until } from './harness.mjs';

const SESSIONS = [
  { id: 'boss', title: 'Boss', ago: 1 },
  { id: 'kid', title: 'Kid', parent: 'boss', ago: 2 },
  { id: 'grand', title: 'Grand', parent: 'kid', ago: 3 },
  { id: 'loner', title: 'Loner', ago: 4 },
  { id: 'other', title: 'Other loner', ago: 5 },
];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let browser;

before(async () => {
  if (skip) return;
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const MENU = `.menu:not([data-sub])`;
const NOTE = `[data-sonner-toast]`;

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

async function ready(t, running) {
  const s = await start({ sessions: SESSIONS, claude: true });
  if (running) await startedRunning(s, running);
  const setter = await browser.open(`${s.origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'collapsed', 'folded'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  return { s, page: await open(t, s) };
}

async function open(t, s) {
  const page = await browser.open(`${s.origin}/`, {});
  t.after(() => page.close());
  await login(page);
  await page.until(`document.querySelectorAll('a.row[data-id]').length >= ${SESSIONS.length}`);
  return page;
}

const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const noteText = page => page.evaluate(`document.querySelector('${NOTE} [data-title]')?.textContent ?? null`);
const pickRows = (page, ...ids) => page.evaluate(`(() => {
  const mac = navigator.platform.startsWith('Mac');
  for (const id of ${JSON.stringify(ids)}) document.querySelector('a.row[data-id="' + id + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
})()`);
const rightClick = async (page, id) => {
  await page.evaluate(`(a => { const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 40, clientY: r.y + r.height / 2 })); })(document.querySelector('a.row[data-id="${id}"]'))`);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
};
const choose = async (page, label) => {
  await page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem]')].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '')`);
  await page.click(`${MENU} [data-picked]`);
};
// The note slides in from below the edge, and a click before it is on screen lands on nothing.
const undo = async page => {
  await page.until(`(b => !!b && b.getBoundingClientRect().bottom <= innerHeight)(document.querySelector('${NOTE} [data-action]'))`);
  await page.click(`${NOTE} [data-action]`);
};
const startedRunning = async (s, id) => {
  const { token } = await signIn(s);
  assert.equal((await request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text: 'begin a session' } })).status, 200);
  await until(() => cliCalls(s).some(c => c.user === 'begin a session'));
};

test('a parent\'s row menu archives it with the sessions below it, the note counts them, and Undo brings the family back', { skip, timeout }, async t => {
  const { s, page } = await ready(t);
  await rightClick(page, 'boss');
  await choose(page, 'Archive');
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent === 'Archived “Boss” and 2 sub sessions.'`);
  assert.deepEqual(Object.keys(onDisk(s).archived).sort(), ['boss', 'grand', 'kid']);
  await page.until(`!document.querySelector('a.row[data-id="kid"]') && !document.querySelector('a.row[data-id="grand"]') && !!document.querySelector('a.row[data-id="loner"]')`);

  await undo(page);
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent === 'Unarchived “Boss” and 2 sub sessions.'`);
  assert.deepEqual(onDisk(s).archived, {});
  await page.until(`!!document.querySelector('a.row[data-id="grand"]')`);
  assert.deepEqual(page.problems, []);
});

test('a sub session\'s row menu archives it with the sessions below it and leaves its parent', { skip, timeout }, async t => {
  const { s, page } = await ready(t);
  await rightClick(page, 'kid');
  await choose(page, 'Archive');
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent === 'Archived “Kid” and 1 sub session.'`);
  assert.deepEqual(Object.keys(onDisk(s).archived).sort(), ['grand', 'kid']);
  await page.until(`!document.querySelector('a.row[data-id="grand"]') && !!document.querySelector('a.row[data-id="boss"]')`);
  assert.deepEqual(page.problems, []);
});

test('a parent with a running sub session reads Stop and archive in the menu and asks with the count first, and Cancel archives nothing', { skip, timeout }, async t => {
  const { s, page } = await ready(t, 'grand');
  await rightClick(page, 'boss');
  assert.equal(await page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem] .menu-text')].some(el => el.textContent === 'Stop and archive')`), true);
  await choose(page, 'Stop and archive');
  await page.until(`document.querySelector('#ask-title')?.textContent === 'Stop and archive “Boss”?'`);
  assert.match(await page.evaluate(`document.querySelector('#ask-title').closest('[role="alertdialog"]').textContent`), /1 sub session is running or waiting on you\. Archiving stops it/);
  await page.evaluate(`document.querySelector('[data-slot="alert-dialog-cancel"]').click()`);
  await page.until(`!document.querySelector('#ask-title')`);
  assert.deepEqual(onDisk(s).archived ?? {}, {});

  await rightClick(page, 'boss');
  await choose(page, 'Stop and archive');
  await page.until(`!!document.querySelector('#ask-title')`);
  await page.evaluate(`document.querySelector('[data-slot="alert-dialog-action"]').click()`);
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent === 'Stopped and archived “Boss” and 2 sub sessions.'`);
  assert.deepEqual(Object.keys(onDisk(s).archived).sort(), ['boss', 'grand', 'kid']);
  await until(() => cliCalls(s).some(c => c.control === 'interrupt'));
  assert.deepEqual(page.problems, []);
});

test('the pick bar counts a picked session below another picked one as part of that family, and one Undo restores what the archive took', { skip, timeout }, async t => {
  const { s, page } = await ready(t);
  await pickRows(page, 'boss', 'kid', 'loner');
  await page.until(`!!document.querySelector('.pick-bar')`);
  await page.click(`.pick-bar .btn[data-variant="outline"]:not(.pick-new)`);
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent === 'Archived 2 sessions and 2 sub sessions.'`);
  assert.deepEqual(Object.keys(onDisk(s).archived).sort(), ['boss', 'grand', 'kid', 'loner']);

  await undo(page);
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent === 'Unarchived 2 sessions and 2 sub sessions.'`);
  assert.deepEqual(onDisk(s).archived, {});
  assert.deepEqual(page.problems, []);
});

test('the pick bar asks once when a picked parent has a running sub session, naming how many are running', { skip, timeout }, async t => {
  const { s, page } = await ready(t, 'grand');
  await pickRows(page, 'boss', 'loner');
  await page.until(`!!document.querySelector('.pick-bar')`);
  await page.click(`.pick-bar .btn[data-variant="outline"]:not(.pick-new)`);
  await page.until(`document.querySelector('#ask-title')?.textContent === 'Stop and archive “2 sessions”?'`);
  assert.match(await page.evaluate(`document.querySelector('#ask-title').closest('[role="alertdialog"]').textContent`), /1 session is running or waiting on you, all under a picked session\./);
  await page.evaluate(`document.querySelector('[data-slot="alert-dialog-action"]').click()`);
  await page.until(`document.querySelector('${NOTE} [data-title]')?.textContent.startsWith('Archived 2 sessions and 2 sub sessions')`);
  assert.deepEqual(Object.keys(onDisk(s).archived).sort(), ['boss', 'grand', 'kid', 'loner']);
  assert.deepEqual(page.problems, []);
});

test('the pick bar\'s second question words itself from what the server found running: an idle parent with two running sub sessions', { skip, timeout }, async t => {
  const { s, page } = await ready(t);
  await page.evaluate(`(() => {
    const real = window.fetch;
    let once = true;
    window.fetch = (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      if (once && String(url).includes('api/layout/archive') && body.id === 'boss' && body.stop === false) {
        once = false;
        return Promise.resolve(new Response(JSON.stringify({ error: 'Two sub sessions are running.', self: false, subs: 2 }), { status: 409, headers: { 'content-type': 'application/json' } }));
      }
      return real(url, init);
    };
  })()`);
  await pickRows(page, 'boss', 'loner');
  await page.until(`!!document.querySelector('.pick-bar')`);
  await page.click(`.pick-bar .btn[data-variant="outline"]:not(.pick-new)`);
  await page.until(`document.querySelector('#ask-title')?.textContent === 'Stop and archive “1 session”?'`);
  assert.match(await page.evaluate(`document.querySelector('#ask-title').closest('[role="alertdialog"]').textContent`), /2 sessions are running or waiting on you, all under a picked session\./);
  assert.deepEqual(Object.keys(onDisk(s).archived), ['loner'], 'the refused parent is still there');
  assert.deepEqual(page.problems, []);
});

test('the row menu for several picked sessions words its Archive entry as the note will, counting only the topmost and the sub sessions that go with them', { skip, timeout }, async t => {
  const { page } = await ready(t);
  await pickRows(page, 'boss', 'kid', 'loner');
  await page.until(`!!document.querySelector('.pick-bar')`);
  await rightClick(page, 'loner');
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem] .menu-text')].map(el => el.textContent).filter(t => t.startsWith('Archive'))`), ['Archive 2 sessions and 2 sub sessions']);
  assert.deepEqual(page.problems, []);
});
