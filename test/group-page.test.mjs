// Run with `npm test`. A group's session in the real page: the button on the group's header, the chat it opens with the status of the group over its
// transcript, the archived part read only when it is opened, and what the page says when the server cannot run group sessions or has no such group.
// The status over the transcript is what a server that cannot summarise sessions gets, so those tests run against one. A server that can
// has it in the Sub sessions tab, which test/sub-status-page.test.mjs covers.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const SESSIONS = [
  { id: 'recent', title: 'Recent member', group: 'cg-work', ago: 5 },
  { id: 'idle', title: 'Idle member', group: 'cg-work', ago: 3000 },
  { id: 'old', title: 'Archived member', group: 'cg-work', archived: true, ago: 20 },
];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }, { id: 'cg-home', name: 'Home' }];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let older;
let unsummarised;
let browser;

// The server behind a proxy that leaves out what the list says of its features, or only the `left` ones, as a server that started before they
// existed does.
function withoutFeatures(target, left = null) {
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
        const whole = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const { features, ...index } = whole;
        const body = JSON.stringify(left && features ? { ...index, features: Object.fromEntries(Object.entries(features).filter(([name]) => !left.includes(name))) } : left ? whole : index);
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
  older = await withoutFeatures(app);
  unsummarised = await withoutFeatures(app, ['subStatus']);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
  await unsummarised?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

// A page signed in through the login page of the server at `origin`, with the passkey offer sent away. The browser keeps its storage between pages, so the
// folds a test leaves are cleared first.
async function appPage(t, origin = app.origin, hash = '') {
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore'].forEach(key => localStorage.removeItem('capcom.' + key))`);
  await setter.close();
  const page = await browser.open(`${origin}/${hash}`);
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
  if (hash && (await page.evaluate('location.hash')) !== hash) await go(page, hash);
  return page;
}

const go = (page, hash) => page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
// The reload is started after this returns, and the old document is marked so that nothing waits on it. A call made as the document changes is refused, and tried again.
async function reload(page) {
  await page.evaluate('window.stale = true; setTimeout(() => location.reload())');
  for (const start = Date.now(); Date.now() - start < 10_000; await new Promise(resolve => setTimeout(resolve, 20))) {
    if (await page.evaluate(`!window.stale && document.readyState === 'complete'`).catch(() => false)) return;
  }
  throw new Error('the page did not load again');
}
const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const summary = page => text(page, '.group-status .status-sum');
const archivedReads = page => page.evaluate(`performance.getEntriesByType('resource').filter(e => e.name.includes('api/archived')).length`);

test('each group\'s header is a link that opens the group\'s session, with its name in the label, and has a chevron and a new session button', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.until(`document.querySelectorAll('a.group-head').length === 2`);
  const heads = await page.evaluate(`[...document.querySelectorAll('a.group-head')].map(a => [a.getAttribute('href'), a.getAttribute('aria-label'), a.hasAttribute('aria-expanded'), a.querySelector('.lamp') === null, a.draggable])`);
  assert.deepEqual(heads, [
    ['#/g/cg-work', 'Open Work\'s session', false, true, false],
    ['#/g/cg-home', 'Open Home\'s session', false, true, false],
  ]);
  const tools = await page.evaluate(`[...document.querySelectorAll('.bar:has(a.group-head)')].map(bar => [...bar.children].map(el => el.localName + '.' + el.className.split(' ').join('.')))`);
  assert.deepEqual(tools[0], ['a.group-head', 'button.more.head-tool', 'button.more', 'button.fold']);
  const fold = await page.evaluate(`(b => [b.getAttribute('aria-label'), b.getAttribute('aria-expanded'), b.getAttribute('aria-controls'), !!document.getElementById(b.getAttribute('aria-controls'))])(document.querySelector('.bar:has(a.group-head[data-key="cg-work"]) .fold'))`);
  assert.deepEqual(fold, ['Sessions in Work', 'true', 'rows-cg-work', true]);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.head-tool')].map(b => [b.getAttribute('aria-label'), b.dataset.tip])`), [['New session in Work', 'New session in Work'], ['New session in Home', 'New session in Home']]);
  assert.deepEqual(page.problems, []);
});

test('a click on a group\'s header opens its session and leaves the group open, and its chevron folds and opens the group without leaving the page', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.until(`document.querySelectorAll('a.group-head').length === 2`);
  const FOLD = '.bar:has(a.group-head[data-key="cg-work"]) .fold';
  const open = `document.querySelector('${FOLD}').getAttribute('aria-expanded')`;
  const hash = await page.evaluate('location.hash');
  await page.click('a.group-head[data-key="cg-work"]');
  await page.until(`location.hash === '#/g/cg-work'`);
  assert.equal(await page.evaluate(open), 'true');
  assert.equal(await page.evaluate(`!!document.querySelector('.rows#rows-cg-work')`), true);
  await go(page, hash);
  await page.click(FOLD);
  await page.until(`${open} === 'false'`);
  assert.equal(await page.evaluate(`location.hash`), hash, 'folding does not open the session');
  assert.equal(await page.evaluate(`!!document.querySelector('#rows-cg-work')`), false);
  await page.click(FOLD);
  await page.until(`${open} === 'true' && !!document.querySelector('#rows-cg-work')`);
  assert.equal(await page.evaluate(`location.hash`), hash);
  assert.deepEqual(page.problems, []);
});

test('Enter on a focused header opens its session, and Left and Right on it fold and open the group through its chevron', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.until(`document.querySelectorAll('a.group-head').length === 2`);
  const open = `document.querySelector('.bar:has(a.group-head[data-key="cg-work"]) .fold').getAttribute('aria-expanded')`;
  await page.evaluate(`document.querySelector('a.group-head[data-key="cg-work"]').focus()`);
  await page.press('ArrowLeft');
  await page.until(`${open} === 'false'`);
  await page.press('ArrowRight');
  await page.until(`${open} === 'true'`);
  assert.equal(await page.evaluate(`location.hash`), '');
  await page.press('Enter');
  await page.until(`location.hash === '#/g/cg-work'`);
  assert.deepEqual(page.problems, []);
});

test('the new session button on a group\'s header opens the new session page in that group', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.until(`document.querySelectorAll('a.group-head').length === 2`);
  await page.click('.bar:has(a.group-head[data-key="cg-home"]) .head-tool');
  await page.until(`location.hash === '#/new/cg-home' && document.querySelector('.start-group .name')?.textContent === 'Home'`);
  assert.deepEqual(page.problems, []);
});

test('a server that does not say it can run group sessions has no such button, and its group page says to restart it', { skip, timeout }, async t => {
  const page = await appPage(t, older.origin);
  await page.until(`document.querySelectorAll('.group-head').length === 2`);
  assert.equal(await page.evaluate(`document.querySelectorAll('a.group-head, .head-tool, .fold').length`), 0, 'the header folds the group as it did');
  assert.equal(await page.evaluate(`[...document.querySelectorAll('button.group-head')].every(b => b.getAttribute('aria-expanded') === 'true')`), true);
  await go(page, '#/g/cg-work');
  await page.until(`!!document.querySelector('[data-slot="empty-title"]')`);
  assert.equal(await text(page, '[data-slot="empty-title"]'), 'Restart GhostShell to talk to a group');
  assert.equal(await page.evaluate(`document.querySelectorAll('.group-status, .dock').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('the header opens the group\'s session, headed Group session, with the status of the group over the transcript', { skip, timeout }, async t => {
  const page = await appPage(t, unsummarised.origin);
  await page.until(`!!document.querySelector('a.group-head')`);
  await page.click('a.group-head');
  await page.until(`!!document.querySelector('.group-status .status-sum')`);
  assert.equal(await page.evaluate('location.hash'), '#/g/cg-work');
  assert.equal(await text(page, '.chat-head h2'), 'Work');
  assert.match(await text(page, '.chat-head .chat-meta'), /^Group session\b/);
  assert.equal(await summary(page), '1 recent · 2 more');
  assert.equal(await page.evaluate(`document.querySelector('a.group-head').getAttribute('aria-current')`), 'page');
  assert.equal(await page.evaluate(`(s => s.previousElementSibling.classList.contains('chat-head') && s.nextElementSibling.matches('.scroller'))(document.querySelector('.group-status'))`), true, 'the status sits between the header and the transcript');
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.group-status .status-row')].map(a => [a.getAttribute('href'), a.querySelector('.status-title').textContent])`), [['#/s/recent', 'Recent member']]);
  assert.deepEqual(page.problems, []);
});

test('the archived sessions are read from the server only when the idle and archived part is opened, and each is a link to its session', { skip, timeout }, async t => {
  const page = await appPage(t, unsummarised.origin, '#/g/cg-work');
  await page.until(`!!document.querySelector('.group-status .status-rest')`);
  assert.equal(await archivedReads(page), 0);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.status-rest > span')].map(el => el.textContent)`), ['Idle and archived (2)']);
  await page.click('.status-rest');
  await page.until(`document.querySelectorAll('.group-status .status-row').length === 3`);
  assert.equal(await archivedReads(page), 1);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.group-status .status-part')].map(p => p.querySelector(':scope > .status-heading')?.textContent.replace(/\\s+/g, ' ').trim() ?? null)`), ['Recent activity (1)', null, 'Idle (1)', 'Archived (1)']);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.group-status .status-row')].map(a => a.getAttribute('href'))`), ['#/s/recent', '#/s/idle', '#/s/old']);
  assert.deepEqual(page.problems, []);
});

test('the folds are kept for the group in this browser, so a page opened again has them as they were left', { skip, timeout }, async t => {
  const page = await appPage(t, unsummarised.origin, '#/g/cg-work');
  await page.until(`!!document.querySelector('.group-status .status-rest')`);
  await page.click('.status-rest');
  await page.until(`!!document.querySelector('.group-status .status-heading + .status-rows') && document.querySelectorAll('.group-status .status-row').length === 3`);
  await reload(page);
  await page.until(`document.querySelector('.status-rest')?.getAttribute('aria-expanded') === 'true'`);
  await page.click('.status-sum');
  await page.until(`!document.querySelector('.status-body')`);
  await reload(page);
  await page.until(`!!document.querySelector('.status-sum')`);
  assert.equal(await page.evaluate(`document.querySelector('.status-sum').getAttribute('aria-expanded')`), 'false');
  assert.equal(await page.evaluate(`document.querySelectorAll('.status-body, .status-row').length`), 0);
  assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem('capcom.groupShut'))['cg-work']`), true);
  assert.deepEqual(page.problems, []);
});

test('a link to the group\'s own session opens the group, and a member\'s link leaves it for the member', { skip, timeout }, async t => {
  const page = await appPage(t, unsummarised.origin, `#/s/${WORK}`);
  await page.until(`location.hash === '#/g/cg-work' && !!document.querySelector('.group-status')`);
  await page.click('.status-row');
  await page.until(`location.hash === '#/s/recent' && !document.querySelector('.group-status')`);
  assert.deepEqual(page.problems, []);
});

test('a group the list does not have says so in a pane of its own, with a way back', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, '#/g/cg-gone');
  await page.until(`!!document.querySelector('[data-slot="empty-title"]')`);
  assert.equal(await text(page, '[data-slot="empty-title"]'), 'Group not found');
  assert.equal(await page.evaluate(`document.querySelectorAll('.group-status, .dock').length`), 0);
  assert.equal(await page.evaluate(`document.querySelector('.chat-head .back').getAttribute('href')`), '#/');
  assert.deepEqual(page.problems, []);
});
