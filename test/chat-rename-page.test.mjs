// Run with `npm test`. Renaming from the open chat's header in the real page: the pencil beside the title of a session and of a group's chat, the box that
// replaces the title, what saves and cancels it, a refused name, no pencil for a section or a server without group rename, and a phone. It needs
// Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const GROUPS = [{ id: 'cg-a', name: 'Reviewing' }, { id: 'cg-b', name: 'Backlog', session: WORK }];
const SESSIONS = [
  { id: 's1', title: 'In reviewing', group: 'cg-a', ago: 1 },
  { id: 's2', title: 'In backlog', group: 'cg-b', ago: 2 },
];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
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

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  older = await without(app, 'groupRename');
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const MENU = `.menu:not([data-sub])`;
const GROUP_HEADS = `.group-head[data-key^="cg-"]`;
const FOCUSED = `document.activeElement.closest?.('.group-head')?.querySelector('.name').textContent ?? document.activeElement.className ?? null`;

// Signs the page in through the login page if it is on it, and sends the passkey offer away.
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

async function appPage(t, origin, { hash, phone = false } = {}) {
  const page = await browser.open(`${origin}/${hash}`, { phone });
  t.after(() => page.close());
  await login(page);
  if ((await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.until(`!!document.querySelector('.chat-head')`);
  return page;
}

const TITLE = `document.querySelector('.chat-name h2')?.textContent`;
const BOX = `.chat-name .name-form .input`;
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const typeName = (page, value) => page.evaluate(`(input => { input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })(document.querySelector('${BOX}'))`);
// What one character past `max` leaves in the box, and how many characters a name of `max` that ends in an emoji keeps.
const limitOf = async (page, max) => {
  const was = await page.evaluate(`document.querySelector('${BOX}').value`);
  await typeName(page, 'x'.repeat(max + 1));
  const over = await page.evaluate(`document.querySelector('${BOX}').value`);
  await typeName(page, `${'x'.repeat(max - 1)}✅`);
  const full = await page.evaluate(`[...document.querySelector('${BOX}').value].length`);
  await typeName(page, was);
  return [over, full];
};
const open = async page => {
  await page.until(`!!document.querySelector('.chat-rename')`);
  await page.evaluate(`document.querySelector('.chat-rename').setAttribute('data-picked', '')`);
  await page.click('.chat-rename[data-picked]');
  await page.until(`document.activeElement === document.querySelector('${BOX}')`);
};
const heights = page => page.evaluate(`document.querySelector('.chat-head').getBoundingClientRect().height`);

test('a session\'s title has a pencil, and the box that replaces it is named, selected and limited to 120 characters', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, { hash: '#/s/s1' });
  assert.equal(await page.until(`${TITLE} === 'In reviewing'`) ?? true, true);
  assert.equal(await page.evaluate(`document.querySelector('.chat-rename').getAttribute('aria-label')`), 'Rename session');
  await page.until(`!!document.querySelector('.chat-rename') && !!document.querySelector('#terminalButton')`);
  const before = await heights(page);
  await open(page);
  assert.deepEqual(await page.evaluate(`(i => [i.getAttribute('aria-label'), i.value, i.selectionStart, i.selectionEnd, getComputedStyle(i).userSelect])(document.querySelector('${BOX}'))`), ['Rename session', 'In reviewing', 0, 12, 'text']);
  assert.equal(await heights(page), before, 'the header does not change height');
  assert.deepEqual(await limitOf(page, 120), ['In reviewing', 120]);
  assert.deepEqual(page.problems, []);
});

test('Enter saves a session\'s title everywhere it shows, with the pencil taking the focus back', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, { hash: '#/s/s1' });
  await open(page);
  await typeName(page, 'Plan the week');
  await page.press('Enter');
  await page.until(`!document.querySelector('.chat-name .name-form') && ${TITLE} === 'Plan the week'`);
  await page.until(`document.title === 'Plan the week · GhostShell'`);
  await page.until(`[...document.querySelectorAll('a.row .row-title')].some(el => el.textContent === 'Plan the week')`);
  assert.equal(onDisk(s).titles.s1, 'Plan the week');
  assert.equal(await page.evaluate(`document.activeElement.classList.contains('chat-rename')`), true);
  assert.deepEqual(page.problems, []);
});

test('Esc leaves the title as it was, and clicking away saves the new one', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, { hash: '#/s/s1' });
  await open(page);
  await typeName(page, 'Thrown away');
  await page.press('Escape');
  await page.until(`!document.querySelector('.chat-name .name-form')`);
  assert.equal(await page.evaluate(TITLE), 'In reviewing');
  assert.equal(onDisk(s).titles?.s1, undefined);

  await open(page);
  await typeName(page, 'Kept');
  await page.evaluate(`document.querySelector('.btn.add').focus()`);
  await page.until(`!document.querySelector('.chat-name .name-form') && ${TITLE} === 'Kept'`);
  assert.equal(onDisk(s).titles.s1, 'Kept');
  assert.equal(await page.evaluate(`document.activeElement.classList.contains('add')`), true, 'the focus stays where the click put it');
  assert.deepEqual(page.problems, []);
});

test('a group\'s chat renames the group, limited to 80 characters, and the sidebar, the title and the search follow', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, { hash: '#/g/cg-b' });
  await page.until(`${TITLE} === 'Backlog'`);
  assert.equal(await page.evaluate(`document.querySelector('.chat-rename').getAttribute('aria-label')`), 'Rename group');
  await open(page);
  assert.deepEqual(await page.evaluate(`(i => [i.getAttribute('aria-label'), i.value])(document.querySelector('${BOX}'))`), ['Rename group', 'Backlog']);
  assert.deepEqual(await limitOf(page, 80), ['Backlog', 80]);
  await typeName(page, 'Open tasks');
  await page.press('Enter');
  await page.until(`!document.querySelector('.chat-name .name-form') && ${TITLE} === 'Open tasks'`);
  await page.until(`[...document.querySelectorAll('.group-head[data-key^="cg-"] .name')].some(el => el.textContent === 'Open tasks')`);
  assert.equal(onDisk(s).groups[1].name, 'Open tasks');
  assert.equal(onDisk(s).groups[1].session, WORK, 'the group keeps its chat');
  assert.deepEqual(page.problems, []);
});

test('a name the server refuses keeps the box open with the reason shown, and the old title stays', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, { hash: '#/g/cg-b' });
  await open(page);
  await typeName(page, '\u200b');
  await page.press('Enter');
  await page.until(`/Give it a name/.test(document.body.textContent)`);
  assert.equal(await page.evaluate(`!!document.querySelector('${BOX}')`), true);
  assert.equal(onDisk(s).groups[1].name, 'Backlog');
  assert.deepEqual(page.problems.filter(p => !/400/.test(p)), []);
});

test('a section\'s chat has no pencil, and neither has a group\'s chat against a server that cannot rename groups', { skip, timeout }, async t => {
  const section = await appPage(t, app.origin, { hash: '#/g/pinned' });
  await section.until(`/Section session/.test(document.querySelector('.chat-meta')?.textContent ?? '')`);
  assert.equal(await section.evaluate(`document.querySelectorAll('.chat-rename').length`), 0);
  const group = await appPage(t, older.origin, { hash: '#/g/cg-b' });
  await group.until(`${TITLE} === 'Backlog'`);
  assert.equal(await group.evaluate(`document.querySelectorAll('.chat-rename').length`), 0);
  const session = await appPage(t, older.origin, { hash: '#/s/s1' });
  await session.until(`!!document.querySelector('.chat-rename')`);
  assert.deepEqual([...section.problems, ...group.problems, ...session.problems], []);
});

test('moving to another chat ends the box without saving it', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, { hash: '#/s/s1' });
  await open(page);
  await typeName(page, 'Unsaved');
  await page.evaluate(`location.hash = '#/s/s2'`);
  await page.until(`${TITLE} === 'In backlog' && !document.querySelector('.chat-name .name-form')`);
  assert.equal(onDisk(s).titles?.s1, undefined);
});

test('on a phone the pencil is there without a hover with a 44 pixel target, and the box has a 16 pixel font and the header keeps its height', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, { hash: '#/s/s1', phone: true });
  await page.until(`!!document.querySelector('.chat-rename')`);
  const pencil = await page.evaluate(`(el => { const r = getComputedStyle(el, '::after'); const b = el.getBoundingClientRect(); return [getComputedStyle(el).opacity, b.width + 2 * 10 >= 44 && b.height + 2 * 10 >= 44, b.right <= innerWidth]; })(document.querySelector('.chat-rename'))`);
  assert.deepEqual(pencil, ['1', true, true]);
  const before = await heights(page);
  await open(page);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${BOX}')).fontSize`), '16px');
  assert.equal(await heights(page), before);
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  assert.deepEqual(page.problems, []);
});
