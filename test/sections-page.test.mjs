// Run with `npm test`. The built-in sections of Home in the real page against the real server: the button with its lamp on each header, none against a server
// that has no section sessions, no menu on a built-in header, two buttons that fit on Routines even on a phone, the chat a button opens and its Sub sessions tab.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, PASSWORD, request, signIn, start, until } from './harness.mjs';

const WORK_CHAT = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const SECTIONS = ['routines', 'pinned', 'started', 'ungrouped', 'other'];
const NAMES = ['Routines', 'Pinned', 'Started here', 'Ungrouped', 'Terminal and other'];
// One session in each section, and in Work. The pinned one and the group's member each end their turn on a question, so the same roll-up is
// expected of the Pinned chat and the Work chat.
const SESSIONS = [
  { id: 'pinned-one', title: 'Pinned one', pinned: true, ago: 5, verdict: 'need_input' },
  { id: 'run-one', title: 'Run one', source: 'capcom', routine: 'nightly', ago: 6 },
  { id: 'started-one', title: 'Started one', source: 'capcom', ago: 7 },
  { id: 'ungrouped-one', title: 'Ungrouped one', ago: 8 },
  { id: 'other-one', title: 'Other one', source: 'cli', ago: 9 },
  { id: 'member', title: 'Member', group: 'cg-work', ago: 5, verdict: 'need_input' },
];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK_CHAT }];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let sparse;
let scoped;
let older;
let browser;

// The server behind a proxy that leaves out what a server from before section sessions would: the feature and the sections of the list.
function withoutSections(target) {
  const proxy = http.createServer((req, res) => {
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      if (req.url.split('?')[0] !== '/api/sessions') {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        const { sections, features, ...index } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const { sectionSessions, ...kept } = features;
        const body = JSON.stringify({ ...index, features: kept });
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
  sparse = await start({ sessions: [SESSIONS[0], SESSIONS[3]], claude: true });
  scoped = await start({ sessions: [SESSIONS[0], { id: 'inside', title: 'Inside', group: 'cg-p', ago: 4 }, SESSIONS[3]], groups: [{ id: 'cg-p', name: 'Inside', project: 'cp-x' }], layout: { projects: [{ id: 'cp-x', name: 'Capcom' }] }, claude: true });
  older = await withoutSections(app);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

// A page signed in through the login page of the server at `origin`, with the passkey offer sent away. The folds a test leaves are cleared first.
async function appPage(t, hash = '', { origin = app.origin, phone = false, scope = null } = {}) {
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'panels', 'subsMore'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', ${JSON.stringify(JSON.stringify(scope))})`);
  await setter.close();
  const page = await browser.open(`${origin}/${hash}`, { phone });
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
  if (hash && (await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  return page;
}

const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const barOf = name => `[...document.querySelectorAll('.bar')].find(b => b.querySelector('.name')?.textContent === ${JSON.stringify(name)})`;
const HEADERS = `[...document.querySelectorAll('.bar')].map(b => b.querySelector('.name')?.textContent)`;

test('every built-in section\'s header has a button that opens its session, with the section named in the label, and none has a menu', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.until(`document.querySelectorAll('.bar.has-chat').length === 6`);
  assert.deepEqual(await page.evaluate(HEADERS), ['Routines', 'Pinned', 'Work', 'Started here', 'Ungrouped', 'Terminal and other']);
  const buttons = await page.evaluate(`${JSON.stringify(NAMES)}.map(name => {
    const bar = [...document.querySelectorAll('.bar')].find(b => b.querySelector('.name')?.textContent === name);
    return [name, [...bar.querySelectorAll('.chat-open')].map(a => [a.getAttribute('href'), a.getAttribute('aria-label')]), bar.querySelectorAll('button.more').length];
  })`);
  assert.deepEqual(buttons, [
    ['Routines', [['#/g/routines', 'Open the Routines section\'s session'], ['#/routines', 'Manage routines']], 0],
    ['Pinned', [['#/g/pinned', 'Open the Pinned section\'s session']], 0],
    ['Started here', [['#/g/started', 'Open the Started here section\'s session']], 0],
    ['Ungrouped', [['#/g/ungrouped', 'Open the Ungrouped section\'s session']], 0],
    ['Terminal and other', [['#/g/other', 'Open the Terminal and other section\'s session']], 0],
  ]);
  assert.equal(await page.evaluate(`(${barOf('Work')}).querySelectorAll('button.more').length`), 1, 'a group keeps its menu');
  assert.equal(await page.evaluate(`(${barOf('Work')}).querySelector('.chat-open').getAttribute('aria-label')`), 'Open Work\'s session');
  assert.deepEqual(page.problems, []);
});

test('a section with no sessions is not drawn, so it has no button either', { skip, timeout }, async t => {
  const page = await appPage(t, '', { origin: sparse.origin });
  await page.until(`document.querySelectorAll('.bar').length === 2`);
  assert.deepEqual(await page.evaluate(HEADERS), ['Pinned', 'Ungrouped']);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.chat-open')].map(a => a.getAttribute('href'))`), ['#/g/pinned', '#/g/ungrouped']);
  assert.deepEqual(page.problems, []);
});

test('Pinned shows its button in a project view too, as the pinned sessions show in every view, and the other sections are Home\'s alone', { skip, timeout }, async t => {
  const page = await appPage(t, '', { origin: scoped.origin, scope: 'cp-x' });
  await page.until(`document.querySelectorAll('.bar').length === 2`);
  assert.deepEqual(await page.evaluate(HEADERS), ['Pinned', 'Inside']);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.chat-open')].map(a => a.getAttribute('href'))`), ['#/g/pinned', '#/g/cg-p']);
  assert.deepEqual(page.problems, []);
});

test('a server with no section sessions has no such buttons, keeps the group\'s, and its section page says to restart it', { skip, timeout }, async t => {
  const page = await appPage(t, '', { origin: older.origin });
  await page.until(`document.querySelectorAll('.bar').length === 6`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.chat-open')].map(a => a.getAttribute('href'))`), ['#/routines', '#/g/cg-work']);
  assert.equal(await page.evaluate(`(${barOf('Routines')}).classList.contains('has-two')`), false);
  await page.evaluate(`location.hash = '#/g/pinned'`);
  await page.until(`!!document.querySelector('[data-slot="empty-title"]')`);
  assert.equal(await text(page, '[data-slot="empty-title"]'), 'Restart GhostShell to talk to a section');
  assert.equal(await text(page, '.chat-head h2'), 'Section session');
  assert.equal(await page.evaluate(`document.querySelectorAll('.dock, #panel').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('the button opens the section\'s session, headed Section session, with the Sub sessions tab rolling up what the section holds as a group\'s does', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.until(`!!document.querySelector('.bar.has-chat .chat-open')`);
  await page.click(`.bar .chat-open[href="#/g/pinned"]`);
  await page.until(`!!document.querySelector('#panel .subs-sum')`);
  assert.equal(await page.evaluate('location.hash'), '#/g/pinned');
  assert.equal(await text(page, '.chat-head h2'), 'Pinned');
  assert.match(await text(page, '.chat-head .chat-meta'), /^Section session\b/);
  assert.equal(await page.evaluate(`document.title`), 'Pinned · GhostShell');
  const section = await text(page, '.subs-sum');
  assert.equal(section, '1 session, 1 waiting on you');
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-label')`), 'Sub sessions: 1, 1 waiting on you');
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#panel .sub-title')].map(a => [a.getAttribute('href'), a.firstChild.textContent])`), [['#/s/pinned-one', 'Pinned one']]);
  assert.equal(await page.evaluate(`document.querySelector('.chat-open[aria-current="page"]')?.getAttribute('href')`), '#/g/pinned');
  await page.evaluate(`location.hash = '#/g/cg-work'`);
  await page.until(`document.querySelector('.chat-head h2')?.textContent === 'Work' && !!document.querySelector('#panel .subs-sum')`);
  assert.equal(await text(page, '.subs-sum'), section, 'the group of the same session says the same');
  assert.match(await text(page, '.chat-head .chat-meta'), /^Group session\b/);
  assert.deepEqual(page.problems, []);
});

test('a link to a section\'s own session opens the section, and a session in the Sub sessions tab leaves it for that session', { skip, timeout }, async t => {
  const page = await appPage(t, '#/g/started');
  await page.until(`!!document.querySelector('.chat-head h2') && document.querySelector('.chat-head h2').textContent === 'Started here'`);
  const chat = await page.evaluate(`fetch('/api/sessions').then(r => r.json()).then(ix => ix.sections.find(s => s.id === 'started').session.id)`);
  assert.match(chat, /^[0-9a-f-]{36}$/);
  await page.evaluate(`location.hash = '#/s/${chat}'`);
  await page.until(`location.hash === '#/g/started'`);
  await page.until(`!!document.querySelector('#panel .sub-title')`);
  await page.click('#panel .sub-title');
  await page.until(`location.hash === '#/s/started-one'`);
  assert.deepEqual(page.problems, []);
});

test('the button lights while the section\'s session waits for the owner, and carries the lamp in its label', { skip, timeout }, async t => {
  const { token } = await signIn(app);
  const booked = await request(app, 'POST', '/api/groups/other/session', { headers: as(token), json: {} });
  const chat = booked.body().id;
  const sent = text => request(app, 'POST', `/api/sessions/${chat}/send`, { headers: as(token), json: { text } });
  assert.equal((await sent('begin a session')).status, 200);
  assert.equal((await sent('ask for approval')).status, 200);
  await until(async () => (await request(app, 'GET', '/api/sessions', { headers: as(token) })).body().sections.find(s => s.id === 'other').session.state === 'waiting');
  const page = await appPage(t);
  await page.until(`!!document.querySelector('.chat-open[href="#/g/other"][data-state="waiting"] .lamp')`);
  assert.equal(await page.evaluate(`document.querySelector('.chat-open[href="#/g/other"]').getAttribute('aria-label')`), 'Open the Terminal and other section\'s session, needs you');
  assert.equal(await page.evaluate(`document.querySelectorAll('.chat-open .lamp').length`), 1, 'only that section\'s button is lit');
  assert.deepEqual(page.problems, []);
});

// The buttons of a header sit on its right end and the count before them, so a second button must not cover the first or the count.
const FIT = `(bar => {
  const [a, b] = [...bar.querySelectorAll('.chat-open')].map(el => el.getBoundingClientRect());
  const count = bar.querySelector('.count').getBoundingClientRect();
  const head = bar.getBoundingClientRect();
  return { two: !!b, apart: b ? a.right <= b.left + 0.5 : true, clear: count.right <= a.left + 0.5, inside: (b ?? a).right <= head.right + 0.5 && a.left >= head.left };
})`;

test('Routines fits both its buttons and its count, on a wide screen and on a phone, and the other built-ins fit theirs', { skip, timeout }, async t => {
  const wide = await appPage(t);
  await wide.until(`document.querySelectorAll('.bar.has-chat').length === 6`);
  assert.deepEqual(await wide.evaluate(`${FIT}(${barOf('Routines')})`), { two: true, apart: true, clear: true, inside: true });
  assert.equal(await wide.evaluate(`(${barOf('Routines')}).classList.contains('has-two')`), true);
  for (const name of NAMES.slice(1)) assert.deepEqual(await wide.evaluate(`${FIT}(${barOf(name)})`), { two: false, apart: true, clear: true, inside: true }, name);
  assert.deepEqual(await wide.evaluate(`${FIT}(${barOf('Work')})`).then(r => r.clear), true);

  const phone = await appPage(t, '', { phone: true });
  await phone.until(`document.querySelectorAll('.bar.has-chat').length === 6`);
  assert.deepEqual(await phone.evaluate(`${FIT}(${barOf('Routines')})`), { two: true, apart: true, clear: true, inside: true });
  for (const name of NAMES.slice(1)) assert.deepEqual(await phone.evaluate(`${FIT}(${barOf(name)})`), { two: false, apart: true, clear: true, inside: true }, name);
  assert.equal(await phone.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true);
  assert.deepEqual(wide.problems, []);
  assert.deepEqual(phone.problems, []);
});

test('on a phone a tap on a section\'s button opens its session', { skip, timeout }, async t => {
  const phone = await appPage(t, '', { phone: true });
  await phone.until(`!!document.querySelector('.chat-open[href="#/g/ungrouped"]')`);
  await phone.tap('.chat-open[href="#/g/ungrouped"]');
  await phone.until(`location.hash === '#/g/ungrouped' && document.querySelector('.chat-head h2')?.textContent === 'Ungrouped'`);
  assert.match(await text(phone, '.chat-head .chat-meta'), /^Section session\b/);
  assert.deepEqual(phone.problems, []);
});

test('the card that asks to start a session says section in a section\'s chat and group in a group\'s', { skip, timeout }, async t => {
  for (const [server, id, place] of [[app, 'started', 'section'], [scoped, 'cg-p', 'group']]) {
    const { token } = await signIn(server);
    const booked = await request(server, 'POST', `/api/groups/${id}/session`, { headers: as(token), json: {} });
    const sent = text => request(server, 'POST', `/api/sessions/${booked.body().id}/send`, { headers: as(token), json: { text } });
    assert.equal((await sent('begin a session')).status, 200);
    assert.equal((await sent('ask to start a session')).status, 200);
    const page = await appPage(t, `#/g/${id}`, { origin: server.origin });
    await page.until(`!!document.querySelector('.approval h3')`);
    assert.equal(await text(page, '.approval h3'), `Claude wants to start a session in this ${place}`);
    assert.deepEqual(page.problems, []);
  }
});
