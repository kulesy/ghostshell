// Run with `npm test`. The Sub sessions tab in the real page against the real server: the tab and the header button for a chat with sub sessions,
// its lines and what they read from the server, a line opened to its reply, a group's chat, a folded family in the list, a server that
// cannot summarise sessions, and when the page asks the server about a session and when it does not. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, PASSWORD, request, signIn, start, until } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
//   top
//     kid (asks a question)
//       grand
//   lead
//     mover (moves while the tests run)
//   loner
//   shelf
//     dozer (idle for days)
//     stowed (archived)
const SESSIONS = [
  { id: 'top', title: 'Top', ago: 5 },
  { id: 'kid', title: 'Kid', parent: 'top', ago: 4, verdict: 'need_input' },
  { id: 'grand', title: 'Grand', parent: 'kid', ago: 3 },
  { id: 'loner', title: 'Loner', ago: 9 },
  { id: 'lead', title: 'Lead', ago: 91 },
  { id: 'mover', title: 'Mover', parent: 'lead', ago: 90 },
  { id: 'shelf', title: 'Shelf', ago: 8 },
  { id: 'dozer', title: 'Dozer', parent: 'shelf', ago: 5000 },
  { id: 'stowed', title: 'Stowed', parent: 'shelf', archived: true, ago: 2 },
  { id: 'member', title: 'Member', group: 'cg-work', ago: 6 },
  { id: 'shelved', title: 'Shelved', group: 'cg-work', archived: true, ago: 2 },
  { id: WORK, title: 'Talk about the work', source: 'cli', ago: 1, group: 'cg-work' },
];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }];
const REPLY = 'The tests pass. Merging next.\n\n```bash\nnpm run release\n```\n\nShall I merge it?';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let older;
let spy;
let browser;

// The fake CLI's transcripts are in one folder, and a session that has said something has an assistant line at the end of its file. The file is
// dated 10 minutes back, since a session that wrote within the last 2 minutes is active and its card says it is working.
const said = (home, id, text) => {
  const file = path.join(home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'text', text }] } })}\n`);
  const old = (Date.now() - 600_000) / 1000;
  fs.utimesSync(file, old, old);
};
const says = (id, text) => said(app.home, id, text);

// The server behind a proxy that logs the requests it passes on and can hold the answers to api/summaries until they are let go. `leave` names
// the features of the list it leaves out, and `strip` the fields of each summary, as a server that started before they existed does.
function through(target, { leave = [], strip = [] } = {}) {
  const seen = [];
  const held = { on: false, answers: [] };
  const proxy = http.createServer((req, res) => {
    seen.push(req.url);
    const route = req.url.split('?')[0];
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      if (route !== '/api/summaries' && !(route === '/api/sessions' && leave.length)) {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        let body = Buffer.concat(chunks);
        if (route === '/api/sessions') {
          const { features, ...index } = JSON.parse(body.toString('utf8'));
          for (const name of leave) delete features[name];
          body = Buffer.from(JSON.stringify({ ...index, features }));
        }
        if (route === '/api/summaries' && strip.length) {
          const parsed = JSON.parse(body.toString('utf8'));
          for (const summary of Object.values(parsed.summaries ?? {})) for (const name of strip) delete summary[name];
          body = Buffer.from(JSON.stringify(parsed));
        }
        const answer = () => {
          res.writeHead(reply.statusCode, { ...reply.headers, 'content-length': body.length });
          res.end(body);
        };
        if (route === '/api/summaries' && held.on) held.answers.push(answer);
        else answer();
      });
    });
    req.pipe(forward);
  });
  return new Promise(resolve => proxy.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${proxy.address().port}`,
    // The urls asked for api/summaries so far.
    summaries: () => seen.filter(url => url.startsWith('/api/summaries')),
    hold: () => { held.on = true; },
    release: () => { held.on = false; for (const answer of held.answers.splice(0)) answer(); },
    waiting: () => held.answers.length,
    close: () => new Promise(done => { proxy.closeAllConnections(); proxy.close(done); }),
  })));
}

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  says('kid', REPLY);
  says('mover', 'Starting out. More to come.');
  older = await through(app, { leave: ['subStatus'] });
  spy = await through(app);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
  await spy?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const KEPT = ['panels', 'folded', 'subsMore', 'groupMore', 'groupShut'];

// A page signed in through the login page of the server at `origin`, with the passkey offer sent away. The browser keeps its storage between pages,
// so what a test leaves is cleared first, and `keep` is put in after.
async function appPage(t, hash = '', { origin = app.origin, phone = false, keep = {} } = {}) {
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`${JSON.stringify(KEPT)}.forEach(key => localStorage.removeItem('capcom.' + key)); Object.entries(${JSON.stringify(keep)}).forEach(([key, value]) => localStorage.setItem('capcom.' + key, JSON.stringify(value)))`);
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
const all = (page, selector, read) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(el => ${read})`);
// The ids each request for summaries named, in order, with whether it asked for the whole reply.
const asked = page => page.evaluate(`performance.getEntriesByType('resource').filter(e => e.name.includes('api/summaries')).map(e => { const q = new URL(e.name).searchParams; return [q.get('ids'), q.get('detail')]; })`);

test('a chat with sub sessions has the Sub sessions tab, open and first, and a header button that names how many there are and what waits on you', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`!!document.querySelector('#panel .subs')`);
  assert.equal((await all(page, '#panel .panel-tab', 'el.textContent.trim()'))[0], 'Sub sessions');
  assert.equal(await page.evaluate(`document.querySelector('#tab-subs').getAttribute('aria-selected')`), 'true');
  assert.equal(await page.evaluate(`document.querySelector('#tab-subs') === document.querySelector('.panel-tab')`), true, 'it is the first tab');
  assert.equal(await page.evaluate(`document.querySelector('#panel').getAttribute('aria-label').startsWith('Sub sessions')`), true);
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-label')`), 'Sub sessions: 2, 1 waiting on you', 'Kid ended its turn on a question, so its mark is awaiting');
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-expanded')`), 'true');
  assert.equal(await page.evaluate(`!!document.querySelector('#subsButton .subs-mark')`), true);
  assert.equal(await page.evaluate(`document.activeElement?.closest('#panel') === null`), true, 'opening by itself leaves the focus where it was');
  assert.equal(await text(page, '.subs-sum'), '2 sub sessions, 1 waiting on you');
  assert.deepEqual(await all(page, '.subs .status-heading', 'el.textContent'), ['Waiting on you (1)'], 'Kid is under Waiting on you and not Recent activity');
  assert.deepEqual(await all(page, '.subs .status-part .sub-title', 'el.firstChild.textContent'), ['Kid']);
  assert.deepEqual(page.problems, []);
});

test('a line has its title as a link, when it last moved, what to do next about it and its roll-up, and the page asks for the lines on screen only', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`document.querySelector('.sub .sub-next')?.textContent === 'Answer its question: Shall I merge it?'`);
  assert.equal(await page.evaluate(`document.querySelector('.sub .sub-next').dataset.tone`), 'needs', 'Kid is marked as awaiting');
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub .sub-said, .sub .sub-wait').length`), 0, 'one line, not a sentence and a line');
  assert.deepEqual(await all(page, '#panel .sub-title', 'el.getAttribute("href") + " " + el.firstChild.textContent'), ['#/s/kid Kid']);
  assert.equal(await text(page, '.sub .sub-roll'), '1 sub session');
  assert.equal(await page.evaluate(`!!document.querySelector('.sub .status-time')?.textContent`), true);
  assert.equal(await text(page, '.sub-card .sub-pill'), 'Waiting on you');
  assert.equal(await page.evaluate(`!!document.querySelector('.sub .row-dot')`), false, 'the pill carries the state, not a dot');
  assert.equal(await page.evaluate(`document.querySelector('.sub .sub-fold').tagName`), 'BUTTON');
  assert.deepEqual(await asked(page), [['kid', null]], 'one request, for the one line drawn');
  assert.deepEqual(page.problems, []);
});

test('a line opens to its whole reply and the sessions under it, and closes again, and a reply from another session has no Run', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`!!document.querySelector('.sub .sub-fold')`);
  assert.equal(await page.evaluate(`document.querySelector('.sub-fold').getAttribute('aria-expanded')`), 'false');
  assert.equal(await page.evaluate(`document.querySelector('.sub-fold').hasAttribute('aria-controls')`), false);
  await page.click('.sub-fold');
  await page.until(`!!document.querySelector('.sub-open .sub-reply')`);
  assert.equal(await page.evaluate(`document.querySelector('.sub-fold').getAttribute('aria-expanded')`), 'true');
  const controls = await page.evaluate(`document.querySelector('.sub-fold').getAttribute('aria-controls').split(' ')`);
  assert.equal(await page.evaluate(`document.getElementById(${JSON.stringify(controls[0])}) === document.querySelector('.sub-open')`), true);
  assert.match(await text(page, '.sub-reply'), /^The tests pass\. Merging next\./);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.sub-reply [data-code="run"]')).display`), 'none', 'a block of another session\'s reply cannot be run here');
  assert.equal(await page.evaluate(`!!document.querySelector('.sub-reply [data-code="copy"]')`), true);
  await page.until(`document.querySelectorAll('.sub-under .sub-title').length === 1`);
  assert.equal(await text(page, '.sub-under .sub-title'), 'Grand');
  assert.equal(controls.length, 2);
  assert.equal(await page.evaluate(`document.getElementById(${JSON.stringify(controls[1])}) === document.querySelector('.sub-under')`), true);
  assert.equal(await page.evaluate(`!document.querySelector('.sub-card').contains(document.querySelector('.sub-under'))`), true, 'the sessions under a card are not inside it');
  const requests = await asked(page);
  assert.deepEqual(requests.filter(([, detail]) => detail === '1'), [['kid', '1']], 'the reply is read for the one line that was opened');
  assert.deepEqual(requests.flatMap(([ids]) => ids.split(',')).sort(), ['grand', 'kid', 'kid']);
  await page.click('.sub-fold');
  await page.until(`!document.querySelector('.sub-open')`);
  assert.deepEqual(page.problems, []);
});

test('the header button closes the tab, opens it again, and a chat remembers that it was closed', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`!!document.querySelector('#panel .subs')`);
  await page.click('#subsButton');
  await page.until(`!document.querySelector('#panel')`);
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-expanded')`), 'false');
  await page.evaluate(`window.oldDocument = true; location.reload()`);
  await page.until(`!window.oldDocument && document.readyState === 'complete' && !!document.querySelector('#subsButton')`);
  assert.equal(await page.evaluate(`!!document.querySelector('#panel')`), false, 'a panel the owner closed stays closed');
  await page.click('#subsButton');
  await page.until(`!!document.querySelector('#panel #tab-subs[aria-selected="true"]')`);
  assert.equal(await page.evaluate(`document.activeElement?.closest('#panel') !== null`), true, 'a button takes the focus into the panel');
  assert.deepEqual(page.problems, []);
});

test('a chat with no sub sessions has no tab and no button', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/loner');
  await page.until(`!!document.querySelector('.chat-head') && document.querySelector('#title')?.textContent === 'Loner'`);
  assert.equal(await page.evaluate(`document.querySelectorAll('#subsButton, #tab-subs, .subs').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('a phone is shown the tab when the button is pressed and not before', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top', { phone: true });
  await page.until(`!!document.querySelector('#subsButton')`);
  assert.equal(await page.evaluate(`!!document.querySelector('#panel')`), false);
  await page.click('#subsButton');
  await page.until(`document.querySelector('#panel')?.getAttribute('role') === 'dialog' && !!document.querySelector('#panel .subs')`);
  assert.deepEqual(page.problems, []);
});

test('an idle sub session shows with the rest, with no fold, and an archived one does not show at all', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/shelf');
  await page.until(`!!document.querySelector('#panel .sub-card')`);
  assert.deepEqual(await all(page, '.subs .status-heading', 'el.textContent.trim()'), ['Idle (1)']);
  assert.deepEqual(await all(page, '#panel .sub-title', 'el.getAttribute("href")'), ['#/s/dozer']);
  assert.equal(await page.evaluate(`document.querySelectorAll('.subs .status-rest').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('a group\'s chat has its sessions in the Sub sessions tab, in place of the status over its transcript, and its button opens it on a phone', { skip, timeout }, async t => {
  const page = await appPage(t, '#/g/cg-work');
  await page.until(`!!document.querySelector('#panel .subs')`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.group-status').length`), 0);
  assert.deepEqual(await all(page, '#panel .panel-tab', 'el.textContent.trim()'), ['Sub sessions'], 'the group has no terminal');
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-label')`), 'Sub sessions: 1');
  assert.deepEqual(await all(page, '#panel .sub-title', 'el.getAttribute("href")'), ['#/s/member']);
  assert.equal(await text(page, '.subs-sum'), '1 session');
  assert.equal(await page.evaluate(`document.querySelectorAll('.subs .status-rest').length`), 0, 'no fold for the archived');
  assert.equal(await page.evaluate(`performance.getEntriesByType('resource').filter(e => e.name.includes('api/archived')).length`), 0);
  const phone = await appPage(t, '#/g/cg-work', { phone: true });
  await phone.until(`!!document.querySelector('#subsButton')`);
  assert.equal(await phone.evaluate(`!!document.querySelector('#panel')`), false);
  await phone.click('#subsButton');
  await phone.until(`!!document.querySelector('#panel .subs')`);
  assert.deepEqual(page.problems, []);
  assert.deepEqual(phone.problems, []);
});

test('a server that cannot summarise sessions keeps the status over a group\'s transcript, gives a chat no tab and is never asked for summaries', { skip, timeout }, async t => {
  const group = await appPage(t, '#/g/cg-work', { origin: older.origin });
  await group.until(`!!document.querySelector('.group-status .status-sum')`);
  assert.equal(await group.evaluate(`document.querySelectorAll('#panel, #subsButton').length`), 0);
  const chat = await appPage(t, '#/s/top', { origin: older.origin });
  await chat.until(`document.querySelector('#title')?.textContent === 'Top'`);
  assert.equal(await chat.evaluate(`document.querySelectorAll('#subsButton, #tab-subs, .subs').length`), 0);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.deepEqual(older.summaries(), [], 'the server behind the proxy has the route, and the page does not use it without the flag');
  assert.deepEqual(group.problems, []);
  assert.deepEqual(chat.problems, []);
});

test('a folded family shows the mark of the most urgent session under it, and says so on its arrow, on a server that cannot summarise too', { skip, timeout }, async t => {
  for (const origin of [app.origin, older.origin]) {
    const page = await appPage(t, '', { origin, keep: { folded: { top: true } } });
    await page.until(`!!document.querySelector('#sections a.row[data-id="top"]')`);
    assert.equal(await page.evaluate(`document.querySelector('a.row[data-id="top"] .row-dot')?.dataset.dot`), 'awaiting', origin);
    assert.equal(await page.evaluate(`document.querySelector('#sections li.has-fold:has(a.row[data-id="top"]) .fold').getAttribute('aria-label')`), '2 nested sessions, 1 waiting on you');
    await page.click('#sections li.has-fold:has(a.row[data-id="top"]) .fold');
    await page.until(`document.querySelector('#sections li.has-fold:has(a.row[data-id="top"]) .fold')?.getAttribute('aria-expanded') === 'true'`);
    assert.equal(await page.evaluate(`document.querySelector('a.row[data-id="top"] .row-dot')?.dataset.dot ?? null`), null, 'open, the head shows its own mark');
    assert.equal(await page.evaluate(`document.querySelector('#sections li.has-fold:has(a.row[data-id="top"]) .fold').getAttribute('aria-label')`), '2 nested sessions');
    assert.deepEqual(page.problems, []);
  }
});

test('on a touch screen a tap on the middle of a header button reaches that button and not the one beside it', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top', { phone: true });
  await page.until(`!!document.querySelector('#subsButton') && !!document.querySelector('#terminalButton')`);
  assert.equal(await page.evaluate(`matchMedia('(pointer: coarse)').matches`), true, 'the page takes this for a touch screen');
  for (const id of ['subsButton', 'terminalButton']) {
    const owner = (dx = 0) => page.evaluate(`(r => document.elementFromPoint(r.x + r.width / 2 + ${dx}, r.y + r.height / 2).closest('button')?.id)(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect())`);
    assert.deepEqual([await owner(-12), await owner(), await owner(12)], [id, id, id], `the middle of ${id} and a little to each side are its own`);
  }
  await page.tap('#subsButton');
  await page.until(`document.querySelector('#tab-subs')?.getAttribute('aria-selected') === 'true'`);
  assert.equal(await page.evaluate(`!!document.querySelector('#tab-terminal[aria-selected="true"]')`), false, 'the tap on Sub sessions did not open the terminal');
  await page.click('#panel [aria-label="Close panel"]');
  await page.until(`!document.querySelector('#panel')`);
  await page.tap('#terminalButton');
  await page.until(`document.querySelector('#tab-terminal')?.getAttribute('aria-selected') === 'true'`);
  assert.deepEqual(page.problems, []);
});

test('a panel that opened by itself is not saved, and goes instead of covering the chat when the window narrows to a phone', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`!!document.querySelector('#panel .subs')`);
  assert.equal(await page.evaluate(`localStorage.getItem('capcom.panels')`), null, 'opening by itself saves nothing');
  await page.resize(390, 844);
  await page.until(`!document.querySelector('#panel')`);
  assert.equal(await page.evaluate(`document.querySelector('#session').dataset.panel ?? null`), null);
  assert.equal(await page.evaluate(`[...document.querySelector('#session').children].some(el => el.inert)`), false, 'the chat can be reached');
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-expanded')`), 'false');
  await page.evaluate(`window.oldDocument = true; location.reload()`);
  await page.until(`!window.oldDocument && document.readyState === 'complete' && !!document.querySelector('#subsButton')`);
  assert.equal(await page.evaluate(`!!document.querySelector('#panel')`), false, 'a phone that never opened it is not shown it');
  await page.resize(1280, 860);
  await page.until(`document.querySelector('#panel')?.getAttribute('role') === 'region' && !!document.querySelector('#panel .subs')`);
  assert.equal(await page.evaluate(`localStorage.getItem('capcom.panels')`), null, 'and it is still the page\'s doing and not the owner\'s');
  assert.deepEqual(page.problems, []);
});

test('a panel the owner opened on a phone is saved and opens over the chat on the next visit, and one the owner closed stays closed on a wide screen', { skip, timeout }, async t => {
  const phone = await appPage(t, '#/s/top', { phone: true });
  await phone.until(`!!document.querySelector('#subsButton')`);
  await phone.click('#subsButton');
  await phone.until(`document.querySelector('#panel')?.getAttribute('role') === 'dialog'`);
  assert.equal(await phone.evaluate(`JSON.parse(localStorage.getItem('capcom.panels')).top.open`), true);
  await phone.evaluate(`window.oldDocument = true; location.reload()`);
  await phone.until(`!window.oldDocument && document.readyState === 'complete' && !!document.querySelector('#subsButton')`);
  await phone.until(`document.querySelector('#panel')?.getAttribute('role') === 'dialog'`);
  const wide = await appPage(t, '#/s/top');
  await wide.until(`!!document.querySelector('#panel .subs')`);
  await wide.click('#subsButton');
  await wide.until(`!document.querySelector('#panel')`);
  assert.equal(await wide.evaluate(`JSON.parse(localStorage.getItem('capcom.panels')).top.open`), false);
  await wide.resize(390, 844);
  await wide.resize(1280, 860);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await wide.evaluate(`!!document.querySelector('#panel')`), false);
  assert.deepEqual(phone.problems, []);
  assert.deepEqual(wide.problems, []);
});

// Appends a reply to `id` and loads the page's list until the row has moved, since the server looks in the folder every four seconds.
async function moves(page, id, reply) {
  const stamp = () => page.evaluate(`Promise.all([import('/ui/subs.js'), import('/ui/tree.js')]).then(([{ sessionIndex }, { findRow }]) => findRow(sessionIndex.get().ix, ${JSON.stringify(id)})?.lastActivityAt ?? null)`);
  const before = await stamp();
  says(id, reply);
  for (const start = Date.now(); (await stamp()) === before;) {
    if (Date.now() - start > 12_000) throw new Error(`${id} did not move`);
    await page.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

const listen = (url, { ids, detail }) => url.includes(`ids=${ids}`) && (detail ? url.includes('detail=1') : !url.includes('detail=1'));

test('a line that moves while its summary is on the way is asked for again when the answer lands, not at the next refresh of the list', { skip, timeout: 40_000 }, async t => {
  spy.hold();
  t.after(() => spy.release());
  const mark = spy.summaries().length;
  const page = await appPage(t, '#/s/lead', { origin: spy.origin });
  await page.until(`!!document.querySelector('#panel .subs .sub')`);
  for (const start = Date.now(); spy.waiting() < 1;) {
    if (Date.now() - start > 5000) throw new Error('the request for the line was never made');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await moves(page, 'mover', 'Moved on. Let me know when to carry on.');
  assert.equal(spy.summaries().length - mark, 1, 'the line is stale, but the request for it is still out, so it is not asked for twice');
  spy.release();
  await page.until(`document.querySelector('.sub .sub-next')?.textContent === 'Reply to its offer: Let me know when to carry on.'`, 8000);
  assert.deepEqual(spy.summaries().slice(mark).filter(url => listen(url, { ids: 'mover' })).length, 2, 'asked once more, with the new stamp');
  assert.deepEqual(page.problems, []);
});

test('a tab out of sight, and a closed panel, ask the server for nothing while sessions move', { skip, timeout: 40_000 }, async t => {
  const page = await appPage(t, '#/s/lead', { origin: spy.origin });
  await page.until(`!!document.querySelector('#panel .subs .sub')`);
  await page.click('.sub-fold');
  await page.until(`!!document.querySelector('.sub-open .sub-reply')`);
  assert.ok(spy.summaries().some(url => listen(url, { ids: 'mover', detail: true })), 'the open line read its reply');

  await page.click('#tab-terminal');
  await page.until(`document.querySelector('#tab-terminal')?.getAttribute('aria-selected') === 'true'`);
  let mark = spy.summaries().length;
  await moves(page, 'mover', 'Second reply. More.');
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.deepEqual(spy.summaries().slice(mark), [], 'the Terminal tab is on show, so nothing is asked about the sessions behind it');

  await page.click('#tab-subs');
  await page.until(`document.querySelector('.sub-reply')?.textContent.startsWith('Second reply.')`);
  assert.ok(spy.summaries().slice(mark).some(url => listen(url, { ids: 'mover', detail: true })), 'back on show, the open line reads the reply it missed');
  assert.ok(spy.summaries().slice(mark).some(url => listen(url, { ids: 'mover' })), 'and so does the line');

  await page.click('#subsButton');
  await page.until(`!document.querySelector('#panel')`);
  mark = spy.summaries().length;
  await moves(page, 'mover', 'Third reply. Even more.');
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.deepEqual(spy.summaries().slice(mark), [], 'a closed panel asks for nothing either');
  assert.deepEqual(page.problems, []);
});

test('more than 300 lines drawn are each asked for once and then the page stops asking', { skip, timeout: 60_000 }, async t => {
  const kids = Array.from({ length: 330 }, (_, n) => ({ id: `kid-${String(n).padStart(3, '0')}`, title: `Kid ${n}`, parent: 'big', ago: 10 + n }));
  const big = await start({ sessions: [{ id: 'big', title: 'Big', ago: 5 }, ...kids], claude: true });
  const watch = await through(big);
  t.after(() => watch.close());
  const page = await appPage(t, '#/s/big', { origin: watch.origin });
  await page.until(`document.querySelectorAll('#panel .subs .sub').length === 330`, 20_000);
  const asked = () => watch.summaries().flatMap(url => new URL(url, 'http://x').searchParams.get('ids').split(','));
  for (const first = Date.now(); new Set(asked()).size < 330;) {
    if (Date.now() - first > 20_000) throw new Error(`only ${new Set(asked()).size} of 330 lines were asked for`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(asked().length, 330, 'each line once, and no more after');
  assert.deepEqual(page.problems, []);
});

test('a card says what to do next: answer a waiting question, answer or reply to where a reply ended, or that there is nothing to do', { skip, timeout: 60_000 }, async t => {
  const steps = await start({ sessions: [
    { id: 'hub', title: 'Hub', ago: 5 },
    { id: 'asking', title: 'Asking', parent: 'hub', ago: 20 },
    { id: 'ended', title: 'Ended', parent: 'hub', ago: 21 },
    { id: 'offered', title: 'Offered', parent: 'hub', ago: 22 },
    { id: 'quiet', title: 'Quiet', parent: 'hub', ago: 23 },
  ], claude: true });
  const say = (id, text) => said(steps.home, id, text);
  say('ended', 'I read the config.\n\nWhich of the two branches should it use?');
  say('offered', 'The change is in. If you want, I can also add the test.');
  say('quiet', 'All finished.');
  const { token } = await signIn(steps);
  await request(steps, 'POST', '/api/sessions/asking/send', { headers: as(token), json: { text: 'ask a question' } });
  await until(async () => (await request(steps, 'GET', '/api/sessions', { headers: as(token) })).body().ungrouped.some(r => (r.children ?? []).some(c => c.id === 'asking' && c.state === 'waiting')), 10_000);
  const page = await appPage(t, '#/s/hub', { origin: steps.origin });
  await page.until(`document.querySelectorAll('.sub .sub-next').length === 4`, 15_000);
  const found = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('.sub')].map(sub => [sub.querySelector('.sub-title').firstChild.textContent, [sub.querySelector('.sub-next').textContent, sub.querySelector('.sub-next').dataset.tone]]))`);
  assert.deepEqual(found, {
    Asking: ['Answer its question: Which branch should it use?', 'needs'],
    Ended: ['Answer its question: Which of the two branches should it use?', 'ready'],
    Offered: ['Reply to its offer: If you want, I can also add the test.', 'ready'],
    Quiet: ["Nothing, it's done", 'quiet'],
  });
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub .sub-said, .sub .sub-wait').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('a server that sends no question or offer keeps the first sentence of the reply on the card, as before', { skip, timeout: 60_000 }, async t => {
  const proxy = await through(app, { strip: ['ask'] });
  t.after(() => proxy.close());
  const page = await appPage(t, '#/s/top', { origin: proxy.origin });
  await page.until(`document.querySelector('.sub .sub-said')?.textContent === 'The tests pass.'`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub .sub-next, .sub .sub-wait').length`), 0);
  assert.equal(await page.evaluate(`document.querySelector('.sub .sub-said').className`), 'sub-said');
  assert.deepEqual(page.problems, []);
});
