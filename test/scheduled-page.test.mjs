// Run with `npm test`. The Scheduled sessions page in the real browser: the list, the form and its refused fields, the menu of a row, the
// Scheduled section in Home, the footer link, Ctrl+K, and what a server without scheduled sessions shows. It needs Playwright's Chromium
// headless shell, and every test skips with a reason that names where it looked.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { localIso } from '../lib/routines.mjs';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, restart, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
const DAY = 86_400_000;
const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const MENU = `.menu:not([data-sub])`;
const DIALOG = `[data-slot="alert-dialog-content"]`;
let app;
let older;
let browser;

// A proxy to `target` that leaves `leave` out of the features the list says, as a server that started before they existed does.
function without(target, leave) {
  const proxy = http.createServer((req, res) => {
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      if (!req.url.startsWith('/api/sessions')) {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        const index = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        delete index.features?.[leave];
        const body = JSON.stringify(index);
        res.writeHead(reply.statusCode, { ...reply.headers, 'content-length': Buffer.byteLength(body) });
        res.end(body);
      });
    });
    req.pipe(forward);
  });
  return new Promise(resolve => proxy.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${proxy.address().port}`,
    close: () => new Promise(done => { proxy.closeAllConnections(); proxy.close(done); }),
  })));
}

// A server with four entries in scheduled.json: two to start in days, one skipped as too late and one started, with its session in Home.
async function furnished() {
  const first = await start({
    sessions: [{ id: 'done-1', title: 'Check the backups', ago: 5 }],
    groups: [{ id: 'cg-work', name: 'Work' }],
    claude: true,
  });
  const work = path.join(first.home, 'work');
  fs.mkdirSync(work);
  const at = days => localIso(Date.now() + days * DAY);
  const entry = (id, title, extra = {}) => ({ id, title, at: at(3), cwd: work, prompt: `Do ${title}.`, model: null, effort: null, mode: null, group: null, status: 'pending', sessionId: null, startedAt: null, lastError: null, retry: null, ...extra });
  fs.writeFileSync(path.join(first.state, 'scheduled.json'), JSON.stringify({
    scheduled: [
      entry('soon', 'Look at the R&D doc', { at: at(2), group: 'cg-work', model: 'haiku', mode: 'plan' }),
      entry('later', 'Write the notes', { at: at(9) }),
      entry('missed', 'Missed one', { at: at(-2), status: 'skipped', lastError: 'It was 48 h late, so it did not start.' }),
      entry('ran', 'Check the backups', { at: at(-1), status: 'started', sessionId: 'done-1', startedAt: at(-1) }),
    ],
  }, null, 2));
  return Object.assign(await restart(first), { work });
}

before(async () => {
  if (skip) return;
  app = await furnished();
  older = await without(app, 'scheduled');
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
});

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

async function appPage(t, origin, { hash = '' } = {}) {
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'collapsed'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  const page = await browser.open(`${origin}/${hash}`);
  t.after(() => page.close());
  await login(page);
  if (hash && (await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  return page;
}

const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const titles = page => page.evaluate(`[...document.querySelectorAll('.routine-title')].map(el => el.textContent)`);
const valueOf = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
const menuOf = page => page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem], ${MENU} > [role=separator]')].map(el => (el.getAttribute('role') === 'separator' ? '-' : el.querySelector('.menu-text').textContent))`);
const toast = page => page.until(`!!document.querySelector('[data-sonner-toast] [data-title]')`).then(() => text(page, '[data-sonner-toast] [data-title]'));
const hasFocus = (page, selector) => page.until(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);

const type = (page, selector, value) => page.evaluate(`(el => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
})(document.querySelector(${JSON.stringify(selector)}))`);

const press = async (page, selector) => {
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
  await page.click(selector);
};

async function pick(page, label) {
  await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${MENU} > [role=menuitem]`)})].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '')`);
  await page.click(`${MENU} [data-picked]`);
}

const saved = () => JSON.parse(fs.readFileSync(path.join(app.state, 'scheduled.json'), 'utf8')).scheduled;

test('the list shows what starts soonest first, then the rest, each with its status, folder and group, and a link to the session it started', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/scheduled' });
  await page.until(`document.querySelectorAll('.routine').length >= 4`);
  assert.deepEqual(await titles(page), ['Look at the R&D doc', 'Write the notes', 'Check the backups', 'Missed one']);
  assert.match(await text(page, '[data-scheduled="soon"] .routine-schedule'), /^Starts in 1 day|^Starts in 2 days|^Starts in 47 h/);
  const where = id => page.evaluate(`[...document.querySelector('[data-scheduled="${id}"] .routine-times').children].map(el => el.textContent)`);
  assert.deepEqual(await where('soon'), [app.work, 'Group Work']);
  assert.deepEqual(await where('later'), [app.work, 'Home']);
  assert.match(await text(page, '[data-scheduled="missed"] .routine-alert'), /It was 48 h late/);
  assert.equal(await text(page, '[data-scheduled="missed"] .routine-schedule span'), 'Skipped');
  assert.equal(await page.evaluate(`document.querySelector('[data-scheduled="ran"] .routine-schedule a').getAttribute('href')`), '#/s/done-1');
  assert.equal(await page.evaluate(`!!document.querySelector('[data-scheduled="ran"] .routine-alert')`), false);
  assert.equal(await text(page, '.chat-head h2'), 'Scheduled sessions');
  assert.equal(await page.evaluate(`document.querySelector('#scheduled-new').getAttribute('href')`), '#/scheduled/new');
  assert.deepEqual(await page.evaluate(`['soon', 'missed'].map(id => !!document.querySelector('[data-scheduled="' + id + '"] .routine-actions .btn[data-variant=outline]'))`), [true, false]);
  await page.until(`document.title === 'Scheduled sessions · GhostShell'`);
  assert.deepEqual(page.problems, []);
});

test('the menu of a pending row has Start now, Edit, Cancel and Delete, and Delete asks first with Cancel focused', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/scheduled' });
  await page.until(`document.querySelectorAll('.routine').length >= 4`);
  await page.click('[data-scheduled="later"] .routine-more');
  await page.until(`!!document.querySelector('${MENU}')`);
  assert.deepEqual(await menuOf(page), ['Start now', 'Edit', 'Cancel', 'Delete']);
  await page.press('Escape');
  await page.until(`!document.querySelector('${MENU}')`);
  await page.click('[data-scheduled="missed"] .routine-more');
  await page.until(`!!document.querySelector('${MENU}')`);
  assert.deepEqual(await menuOf(page), ['Delete']);
  await pick(page, 'Delete');
  await page.until(`!!document.querySelector('${DIALOG}')`);
  assert.match(await text(page, DIALOG), /Missed one/);
  assert.equal(await page.evaluate(`document.activeElement.textContent`), 'Cancel');
  await page.click(`${DIALOG} button:not([data-variant=destructive])`);
  await page.until(`!document.querySelector('${DIALOG}')`);
  assert.equal(saved().some(s => s.id === 'missed'), true);
  assert.deepEqual(page.problems, []);
});

test('Home has a Scheduled section with the pending and skipped entries, a Manage button, and none that started', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`!!document.querySelector('.group-head[data-key="scheduled"]')`);
  assert.equal(await page.evaluate(`document.querySelector('.group-head[data-key="scheduled"]').closest('.bar').querySelector('a.head-tool[href="#/scheduled"]').getAttribute('aria-label')`), 'Manage scheduled sessions');
  const rows = await page.evaluate(`[...document.querySelectorAll('a.row[data-scheduled]')].map(a => [a.dataset.scheduled, a.querySelector('.row-title').textContent, a.querySelector('.row-idle').textContent, a.getAttribute('href'), a.querySelector('.row-idle').dataset.tone ?? null])`);
  assert.deepEqual(rows.map(r => r[0]), ['soon', 'later', 'missed']);
  assert.match(rows[0][2], /^Starts /);
  assert.equal(rows[0][3], '#/scheduled/soon');
  assert.equal(rows[2][2], 'Skipped: It was 48 h late, so it did not start.');
  assert.equal(rows[2][3], '#/scheduled');
  assert.equal(rows[2][4], 'problem');
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.list-foot .foot-links a')].map(a => [a.textContent, a.getAttribute('href')])`), [['Routines', '#/routines'], ['Scheduled', '#/scheduled'], ['Passkeys', '#/passkeys']]);
  assert.deepEqual(page.problems, []);
});

test('the row of a pending entry in Home has the page\'s menu, and Edit opens its form with the fields filled in', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`!!document.querySelector('a.row[data-scheduled="soon"]')`);
  await page.click('a.row[data-scheduled="soon"] ~ .more');
  await page.until(`!!document.querySelector('${MENU}')`);
  assert.deepEqual(await menuOf(page), ['Start now', 'Edit', 'Cancel', 'Delete']);
  await pick(page, 'Edit');
  await page.until(`location.hash === '#/scheduled/soon' && document.querySelector('#scheduled-title')?.value === 'Look at the R&D doc'`);
  assert.equal(await valueOf(page, '#scheduled-model'), 'haiku');
  assert.equal(await valueOf(page, '#scheduled-mode'), 'plan');
  assert.equal(await valueOf(page, '#scheduled-group'), 'cg-work');
  assert.equal(await valueOf(page, '#scheduled-prompt'), 'Do Look at the R&D doc.');
  assert.equal(await valueOf(page, '#scheduled-cwd'), app.work);
  assert.deepEqual(page.problems, []);
});

test('the footer link opens the page and is marked as the current one', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`!!document.querySelector('.list-foot .foot-links a[href="#/scheduled"]')`);
  await page.click('.list-foot .foot-links a[href="#/scheduled"]');
  await page.until(`location.hash === '#/scheduled' && !!document.querySelector('.routine-list')`);
  assert.equal(await page.evaluate(`document.querySelector('.list-foot .foot-links a[href="#/scheduled"]').getAttribute('aria-current')`), 'page');
  assert.equal(await page.evaluate(`document.querySelector('.group-head[data-key="scheduled"]').closest('.bar').querySelector('a.head-tool').getAttribute('aria-current')`), 'page');
  assert.deepEqual(page.problems, []);
});

test('the search on the Scheduled chip has Scheduled sessions and Schedule a session, and Enter opens the page', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`!!document.querySelector('.group-head[data-key="scheduled"]')`);
  await page.click('button.find');
  await page.until(`!!document.querySelector('.chips .chip')`);
  await page.evaluate(`[...document.querySelectorAll('.chips .chip')].find(b => b.textContent === 'Scheduled').setAttribute('data-picked', '')`);
  await page.click('.chip[data-picked]');
  await page.until(`document.querySelectorAll('[data-part="hit-title"]').length === 2`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('[data-part="hit-title"]')].map(el => el.textContent)`), ['Scheduled sessions', 'Schedule a session']);
  await page.press('Enter');
  await page.until(`location.hash === '#/scheduled'`);
  assert.deepEqual(page.problems, []);
});

test('a refused form shows each bad field and puts the focus on the first, and a good one is saved, listed and in the file', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/scheduled/new' });
  await page.until(`!!document.querySelector('#scheduled-title')`);
  assert.match(await valueOf(page, '#scheduled-at'), /^\d{4}-\d{2}-\d{2}T09:00$/);
  await type(page, '#scheduled-at', localIso(Date.now() - DAY).slice(0, 16));
  await type(page, '#scheduled-cwd', path.join(app.home, 'nowhere'));
  await press(page, '.routine-form button[type=submit]');
  await page.until(`!!document.querySelector('.routine-error:not(:empty)')`);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('.routine-error')].filter(el => el.textContent).length`), 4);
  await hasFocus(page, '#scheduled-title');
  assert.equal(saved().length, 4);
  await type(page, '#scheduled-title', 'Tidy the desk');
  await type(page, '#scheduled-at', localIso(Date.now() + 5 * DAY).slice(0, 16));
  await type(page, '#scheduled-cwd', app.work);
  await type(page, '#scheduled-prompt', 'Tidy it.');
  await type(page, '#scheduled-group', 'cg-work');
  await press(page, '.routine-form button[type=submit]');
  await page.until(`location.hash === '#/scheduled' && [...document.querySelectorAll('.routine-title')].some(el => el.textContent === 'Tidy the desk')`);
  const made = saved().find(s => s.title === 'Tidy the desk');
  assert.deepEqual([made.id, made.status, made.group, made.prompt, made.cwd], ['tidy-the-desk', 'pending', 'cg-work', 'Tidy it.', app.work]);
  assert.deepEqual(page.problems, []);
});

test('Cancel in the row\'s menu keeps the entry as cancelled with no Start now, and the form of a started one says it can no longer be changed', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/scheduled' });
  await page.until(`!!document.querySelector('[data-scheduled="later"]')`);
  await page.click('[data-scheduled="later"] .routine-more');
  await page.until(`!!document.querySelector('${MENU}')`);
  await pick(page, 'Cancel');
  await page.until(`document.querySelector('[data-scheduled="later"] .routine-schedule span')?.textContent === 'Cancelled'`);
  assert.equal(saved().find(s => s.id === 'later').status, 'cancelled');
  assert.equal(await page.evaluate(`!!document.querySelector('[data-scheduled="later"] .routine-actions .btn[data-variant=outline]')`), false);
  await page.evaluate(`location.hash = '#/scheduled/ran'`);
  await page.until(`!!document.querySelector('.routines-failure')`);
  assert.match(await text(page, '.routines-failure'), /Check the backups is started, so it can no longer be changed/);
  assert.deepEqual(page.problems, []);
});

test('Start now starts the session, says so with a link to it, and the row is then started', { skip, timeout: 60_000 }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/scheduled' });
  await page.until(`!!document.querySelector('[data-scheduled="soon"] .routine-actions .btn[data-variant=outline]')`);
  await page.click('[data-scheduled="soon"] .routine-actions .btn[data-variant=outline]');
  assert.match(await toast(page), /Started “Look at the R&D doc”/);
  await page.until(`document.querySelector('[data-scheduled="soon"] .routine-schedule span')?.textContent.startsWith('Started')`, 20_000);
  assert.equal(saved().find(s => s.id === 'soon').status, 'started');
  assert.deepEqual(page.problems, []);
});

test('a server without scheduled sessions shows no Scheduled section or footer link, and the page says so', { skip, timeout }, async t => {
  const page = await appPage(t, older.origin);
  await page.until(`!!document.querySelector('.group-head')`);
  assert.equal(await page.evaluate(`!!document.querySelector('.group-head[data-key="scheduled"]')`), false);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.list-foot .foot-links a')].map(a => a.textContent)`), ['Routines', 'Passkeys']);
  await page.evaluate(`location.hash = '#/scheduled'`);
  await page.until(`!!document.querySelector('.routines-failure')`);
  assert.match(await text(page, '.routines-failure'), /does not have scheduled sessions/);
  assert.deepEqual(page.problems, []);
});
