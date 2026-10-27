// Run with `npm test`. The one line a card shows for the pull request its session is working on, and the Archive button of a card, in the real page
// against the real server and a fake gh: the sentence for each kind of status with the whole address as its link, a session that names several pull
// requests showing none, the approval line and the status line never together, a pull request that waits on the owner making its session wait on them
// in the pill, the section and the header button, a working session leaving its own failing checks to itself, a server that cannot say, when the page
// asks the server and when it does not, and archiving from a card with Undo, the question for a running session, a refusal, and where the focus goes.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, PASSWORD, request, signIn, start, until } from './harness.mjs';

const pr = n => `https://github.com/example-org/example-repo/pull/${n}`;
const OK = [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const raw = (extra = {}) => ({
  state: 'OPEN', isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', statusCheckRollup: OK, latestReviews: [],
  reviewRequests: [], author: { login: 'octocat' }, ...extra,
});
const asked = { author: { login: 'hubot' }, reviewRequests: [{ login: 'octocat' }], reviewDecision: 'REVIEW_REQUIRED' };

// What the fake gh knows: the pull request for each number, and the unresolved review threads of some.
const PULLS = {
  1: raw(asked),
  2: raw({ reviewDecision: 'CHANGES_REQUESTED' }),
  3: raw({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }),
  4: raw(),
  5: raw({ statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
  6: raw({ statusCheckRollup: [{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }] }),
  7: raw({ reviewDecision: 'APPROVED' }),
  8: raw({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }),
  9: raw({ author: { login: 'hubot' }, reviewRequests: [{ login: 'hubot-2' }], reviewDecision: 'REVIEW_REQUIRED' }),
  10: raw({ author: { login: 'hubot' } }),
  11: raw({ isDraft: true }),
  12: raw({ state: 'MERGED' }),
  13: raw({ state: 'CLOSED' }),
  14: raw(),
  15: raw({ reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING', statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
  16: raw({ author: { login: 'hubot' } }),
  21: raw({ ...asked, reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING', statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
  22: raw({ author: { login: 'hubot' } }),
  23: raw({ state: 'MERGED' }),
  31: raw({ statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
  32: raw(asked),
  41: raw({ author: { login: 'hubot' } }),
};
const THREADS = { 4: [false, true, false], 21: [false] };

// Under `top`, a card for each kind of line. `calm` has one session with nothing pending, and `work` two that are working.
const KINDS = [
  ['Review', 1], ['Changes', 2], ['Conflicts', 3], ['Comments', 4], ['Failing', 5], ['Running', 6], ['Approved', 7], ['Ready', 8], ['Waiting', 9],
  ['Open', 10], ['Draft', 11], ['Merged', 12], ['Closed', 13], ['Mine', 14], ['Everything', 15],
];

// The sentence, tone and address each of those cards shows.
const LINES = {
  Review: ['Review the pull request', 'needs'],
  Changes: ['Ask the session to deal with the requested changes', 'needs'],
  Conflicts: ['Ask the session to deal with the conflicts', 'needs'],
  Comments: ['Ask the session to deal with the 2 unresolved comments', 'needs'],
  Failing: ['Ask the session to deal with the failing checks', 'error'],
  Running: ['Waiting on checks to finish', 'working'],
  Approved: ['Approved, but it cannot merge yet', 'quiet'],
  Ready: ['Merge the pull request', 'needs'],
  Waiting: ['Waiting on a reviewer', 'quiet'],
  Open: ['Open, nothing asked of you', 'quiet'],
  Draft: ['Still a draft', 'quiet'],
  Merged: ['Merged, nothing to do', 'ready'],
  Closed: ['Closed, nothing to do', 'quiet'],
  Mine: ['Open, no review asked for yet', 'quiet'],
  Everything: ['Ask the session to deal with the requested changes, the conflicts and the failing checks', 'error'],
};
const SESSIONS = [
  { id: 'top', title: 'Top', ago: 1 },
  ...KINDS.map(([title, n], at) => ({ id: title.toLowerCase(), title, parent: 'top', ago: 10 + at })),
  { id: 'many', title: 'Many', parent: 'top', ago: 30 },
  { id: 'plain', title: 'Plain', parent: 'top', ago: 31 },
  { id: 'unknown', title: 'Unknown', parent: 'top', ago: 32 },
  { id: 'asks', title: 'Asks', parent: 'top', ago: 33, verdict: 'need_input' },
  { id: 'approve', title: 'Approve', parent: 'top', ago: 34 },
  { id: 'calm', title: 'Calm', ago: 2 },
  { id: 'calm-kid', title: 'Calm kid', parent: 'calm', ago: 40 },
  { id: 'work', title: 'Work', ago: 3 },
  { id: 'w-fail', title: 'Working on failing checks', parent: 'work', ago: 41 },
  { id: 'w-review', title: 'Working with a review asked', parent: 'work', ago: 42 },
  { id: 'lone', title: 'Lone', ago: 5 },
  { id: 'lone-kid', title: 'Lone kid', parent: 'lone', ago: 70 },
  { id: 'chores', title: 'Chores', ago: 4 },
  ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((letter, at) => ({ id: `tidy-${letter}`, title: `Tidy ${letter.toUpperCase()}`, parent: 'chores', ago: 50 + at })),
  { id: 'busy-a', title: 'Busy A', parent: 'chores', ago: 60 },
  { id: 'busy-b', title: 'Busy B', parent: 'chores', ago: 61 },
  { id: 'fam', title: 'Fam', ago: 6 },
  { id: 'fam-a', title: 'Fam A', parent: 'fam', ago: 80 },
  { id: 'fam-a-kid', title: 'Fam A kid', parent: 'fam-a', ago: 81 },
  { id: 'fam-b', title: 'Fam B', parent: 'fam', ago: 82 },
];
const KIDS_OF_TOP = SESSIONS.filter(s => s.parent === 'top').length;
const NEED_YOU = ['Review', 'Changes', 'Conflicts', 'Comments', 'Failing', 'Ready', 'Everything', 'Asks', 'Approve'];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let browser;
const proxies = [];

// A reply written more than the 2 minutes that make a session active, so its row is idle.
const says = (id, text) => {
  const file = path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })}\n`);
  const old = (Date.now() - 600_000) / 1000;
  fs.utimesSync(file, old, old);
};
const ghCalls = () => (fs.existsSync(app.ghLog) ? fs.readFileSync(app.ghLog, 'utf8').split('\n').filter(Boolean).length : 0);
const rowsOf = ix => [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.started, ...ix.ungrouped, ...ix.other].flatMap(r => [r, ...(r.children ?? [])]);

// The server behind a proxy that logs the requests to api/pulls and api/layout/archive and can leave out features of the list, say a number of the answers
// are still settling, change the pull requests it answers with, refuse archiving, or answer the first archive that does not stop a chat with a 409.
function through(target, { leave = [], settle = 0, change = null, refuse = false, running = false } = {}) {
  const seen = [];
  const archives = [];
  let settling = settle;
  let busy = running;
  const proxy = http.createServer((req, res) => {
    seen.push(req.url);
    const route = req.url.split('?')[0];
    if (req.method === 'POST' && route === '/api/layout/archive') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const sent = JSON.parse(body.toString('utf8'));
        archives.push(sent);
        const answer = refuse ? [500, 'The layout could not be written.'] : busy && sent.archived && sent.stop === false ? [409, 'That chat is running, and archiving it would stop it.'] : null;
        if (answer) {
          if (answer[0] === 409) busy = false;
          const text = Buffer.from(JSON.stringify({ error: answer[1] }));
          res.writeHead(answer[0], { 'content-type': 'application/json', 'content-length': text.length });
          res.end(text);
          return;
        }
        const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        });
        forward.end(body);
      });
      return;
    }
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      const rewrite = (route === '/api/sessions' && leave.length) || (route === '/api/pulls' && (settling > 0 || change));
      if (!rewrite) {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (route === '/api/sessions') for (const name of leave) delete body.features[name];
        else {
          if (settling > 0) { settling--; body.settling = true; }
          if (change) change(body);
        }
        const text = Buffer.from(JSON.stringify(body));
        res.writeHead(reply.statusCode, { ...reply.headers, 'content-length': text.length });
        res.end(text);
      });
    });
    req.pipe(forward);
  });
  return new Promise(resolve => proxy.listen(0, '127.0.0.1', () => {
    const made = {
      origin: `http://127.0.0.1:${proxy.address().port}`,
      pulls: () => seen.filter(url => url.startsWith('/api/pulls')),
      archives: () => archives,
      close: () => new Promise(done => { proxy.closeAllConnections(); proxy.close(done); }),
    };
    proxies.push(made);
    resolve(made);
  }));
}

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, claude: true, gh: true });
  fs.writeFileSync(path.join(app.home, 'gh-state.json'), JSON.stringify({
    pulls: Object.fromEntries(Object.entries(PULLS).map(([n, value]) => [pr(n), value])),
    threads: Object.fromEntries(Object.entries(THREADS).map(([n, value]) => [pr(n), value])),
  }));
  KINDS.forEach(([title, n]) => says(title.toLowerCase(), `Working on ${pr(n)}.`));
  says('many', `Opened ${pr(22)} and ${pr(21)} and ${pr(23)}.`);
  says('approve', `Opened ${pr(16)}.`);
  says('plain', 'Nothing to open yet.');
  says('unknown', `Opened ${pr(99)}.`);
  says('calm-kid', `Opened ${pr(41)}.`);
  says('w-fail', `Opened ${pr(31)}.`);
  says('w-review', `Opened ${pr(32)}.`);
  const { token } = await signIn(app);
  const running = ['w-fail', 'w-review', 'busy-a', 'busy-b'];
  for (const id of running) await request(app, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text: 'keep going' } });
  await request(app, 'POST', '/api/sessions/approve/send', { headers: as(token), json: { text: 'ask for approval' } });
  await until(async () => {
    const ix = (await request(app, 'GET', '/api/sessions', { headers: as(token) })).body();
    return rowsOf(ix).filter(r => r.state === 'working').length === running.length && rowsOf(ix).some(r => r.id === 'approve' && r.state === 'waiting');
  }, 10_000);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  for (const proxy of proxies) await proxy.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const KEPT = ['panels', 'folded', 'subsMore', 'groupMore', 'groupShut'];

async function appPage(t, hash = '', { origin = app.origin, phone = false } = {}) {
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`${JSON.stringify(KEPT)}.forEach(key => localStorage.removeItem('capcom.' + key))`);
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
const button = page => page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-label')`);
// The title of each card with the one status line it shows, and the address it links to.
const cards = page => page.evaluate(`Object.fromEntries([...document.querySelectorAll('.sub')].map(sub => {
  const status = sub.querySelector(':scope > .sub-card .sub-status');
  const link = sub.querySelector(':scope > .sub-card .pull-link');
  return [sub.querySelector('.sub-title').firstChild.textContent, status && { text: status.textContent, tone: status.dataset.tone, link: link.textContent, href: link.getAttribute('href'), described: link.getAttribute('aria-describedby') === status.id, lines: sub.querySelectorAll(':scope > .sub-card .sub-status').length }];
}))`);
const settled = page => page.until(`document.querySelectorAll('.sub-status').length >= ${KINDS.length}`, 15_000);

test('a card shows one line saying what the owner has to do, with the whole address as a link that opens in another tab', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await settled(page);
  const found = await cards(page);
  for (const [title, n] of KINDS) {
    const [text, tone] = LINES[title];
    assert.deepEqual(found[title], { text, tone, link: pr(n), href: pr(n), described: true, lines: 1 }, title);
  }
  assert.equal(await page.evaluate(`[...document.querySelectorAll('.pull-link')].every(a => a.target === '_blank' && a.rel === 'noopener noreferrer')`), true);
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub-pulls, .pull-facts, .pull-fact').length`), 0, 'no list of pull requests');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.sub-status[data-tone="needs"]')).fontWeight`), '500');
  assert.deepEqual(page.problems, []);
});

test('a session that names several pull requests together shows none of them, and none is asked of gh', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await settled(page);
  assert.equal((await cards(page)).Many, null);
  const noise = await page.evaluate(`(sub => sub.querySelectorAll('.sub-pull, .sub-status, .pull-link').length)([...document.querySelectorAll('.sub')].find(s => s.querySelector('.sub-title').firstChild.textContent === 'Many'))`);
  assert.equal(noise, 0);
  const asked = fs.readFileSync(app.ghLog, 'utf8');
  for (const n of [21, 22, 23]) assert.equal(asked.includes(pr(n)), false, `pull request ${n}`);
  assert.equal(await button(page), `Sub sessions: ${KIDS_OF_TOP}, ${NEED_YOU.length} waiting on you`, 'a review asked on one of a sweep\'s pull requests does not count');
  assert.deepEqual(page.problems, []);
});

test('a card that shows what it waits on for an approval shows no status line', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await settled(page);
  await page.until(`!![...document.querySelectorAll('.sub')].find(s => s.querySelector('.sub-title').firstChild.textContent === 'Approve')?.querySelector('.sub-wait')`, 15_000);
  const card = await page.evaluate(`(sub => ({ wait: sub.querySelector('.sub-wait').textContent, status: sub.querySelectorAll('.sub-status, .pull-link').length }))([...document.querySelectorAll('.sub')].find(s => s.querySelector('.sub-title').firstChild.textContent === 'Approve'))`);
  assert.deepEqual(card, { wait: 'Waiting for you to approve Bash: ls', status: 0 });
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub .sub-status').length`), KINDS.length, 'every other card keeps its line');
  assert.deepEqual(page.problems, []);
});

test('a card with no pull request, and one whose pull request gh could not read, have no line at all', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await settled(page);
  const found = await cards(page);
  assert.deepEqual([found.Plain, found.Unknown], [null, null]);
  const bare = await page.evaluate(`['Plain', 'Unknown'].map(name => { const sub = [...document.querySelectorAll('.sub')].find(s => s.querySelector('.sub-title').firstChild.textContent === name); return sub.querySelectorAll('.sub-pull, .sub-status, .pull-link').length; })`);
  assert.deepEqual(bare, [0, 0]);
  assert.deepEqual(page.problems, []);
});

test('an address the page may not link to is never drawn as a line or a link', { skip, timeout }, async t => {
  const rewriting = await through(app, {
    change: body => {
      body.pulls.plain = [{ url: 'javascript:alert(1)', repo: 'x/y', number: 1, state: 'open', mine: true, asked: false, requested: 0, review: 'none', checks: 'none', conflicts: false, clean: false, threads: 0 }];
      body.pulls.unknown = [{ url: 'https://github.com.evil.example/o/r/pull/3', repo: 'o/r', number: 3, state: 'open', mine: true, asked: false, requested: 0, review: 'none', checks: 'none', conflicts: false, clean: false, threads: 0 }];
    },
  });
  const page = await appPage(t, '#/s/top', { origin: rewriting.origin });
  await settled(page);
  const found = await cards(page);
  assert.deepEqual([found.Plain, found.Unknown], [null, null]);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('a')].some(a => /^javascript:|evil\\.example/.test(a.getAttribute('href') ?? ''))`), false);
  assert.deepEqual(page.problems, []);
});

test('a session whose pull request waits on the owner shows Waiting on you, sits in that section, and is counted by the header button and its mark', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await settled(page);
  assert.equal(await button(page), `Sub sessions: ${KIDS_OF_TOP}, ${NEED_YOU.length} waiting on you`);
  assert.equal(await page.evaluate(`!!document.querySelector('#subsButton .subs-mark')`), true);
  assert.equal(await text(page, '.subs-sum'), `${KIDS_OF_TOP} sub sessions, ${NEED_YOU.length} waiting on you`);
  const under = await page.evaluate(`[...document.querySelectorAll('.subs .status-part')].map(part => [part.querySelector('.status-heading').textContent, [...part.querySelectorAll('.sub-title')].map(a => a.firstChild.textContent).sort()])`);
  assert.deepEqual(under.find(([heading]) => heading.startsWith('Waiting on you')), [`Waiting on you (${NEED_YOU.length})`, [...NEED_YOU].sort()]);
  const pills = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('.sub')].map(sub => [sub.querySelector('.sub-title').firstChild.textContent, sub.querySelector('.sub-pill').textContent]))`);
  for (const name of NEED_YOU) assert.equal(pills[name], 'Waiting on you', name);
  for (const name of ['Running', 'Approved', 'Waiting', 'Open', 'Draft', 'Merged', 'Closed', 'Mine', 'Many', 'Plain', 'Unknown']) assert.notEqual(pills[name], 'Waiting on you', name);
  assert.deepEqual(page.problems, []);
});

test('the header button counts a pull request that needs the owner with the panel closed, and a session with nothing pending is not counted', { skip, timeout }, async t => {
  const closed = await appPage(t, '#/s/top');
  await closed.until(`!!document.querySelector('#subsButton')`);
  await closed.click('#subsButton');
  await closed.until(`!document.querySelector('#panel')`);
  await closed.evaluate(`window.oldDocument = true; location.reload()`);
  // A poll that lands mid-navigation is refused, so it is asked again.
  for (let tries = 0; ; tries++) {
    try { await closed.until(`!window.oldDocument && document.readyState === 'complete' && !!document.querySelector('#subsButton')`); break; } catch (e) { if (tries > 40 || !/navigated or closed/.test(e.message)) throw e; }
  }
  assert.equal(await closed.evaluate(`!!document.querySelector('#panel')`), false, 'the panel stays closed');
  await closed.until(`document.querySelector('#subsButton').getAttribute('aria-label').endsWith('${NEED_YOU.length} waiting on you')`, 15_000);
  assert.equal(await closed.evaluate(`!!document.querySelector('#subsButton .subs-mark')`), true);
  const calm = await appPage(t, '#/s/calm');
  await calm.until(`!!document.querySelector('#panel .sub-pull')`, 15_000);
  assert.equal(await button(calm), 'Sub sessions: 1');
  assert.equal(await calm.evaluate(`!!document.querySelector('#subsButton .subs-mark')`), false);
  assert.equal(await text(calm, '.sub-pill'), 'Idle');
  assert.equal((await cards(calm))['Calm kid'].text, 'Open, nothing asked of you');
  assert.deepEqual(closed.problems, []);
  assert.deepEqual(calm.problems, []);
});

test('a working session leaves its own failing checks to itself and is not counted, and one with a review asked of the owner is', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/work');
  await page.until(`document.querySelectorAll('.sub-status').length === 2`, 15_000);
  assert.equal(await button(page), 'Sub sessions: 2, 1 waiting on you');
  const pills = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('.sub')].map(sub => [sub.querySelector('.sub-title').firstChild.textContent, sub.querySelector('.sub-pill').textContent]))`);
  assert.deepEqual(pills, { 'Working on failing checks': 'Working', 'Working with a review asked': 'Waiting on you' });
  const found = await cards(page);
  assert.deepEqual([found['Working on failing checks'].text, found['Working on failing checks'].tone], ['The session is dealing with the failing checks', 'working']);
  assert.deepEqual([found['Working with a review asked'].text, found['Working with a review asked'].tone], ['Review the pull request', 'needs']);
  assert.deepEqual(await all(page, '.subs .status-heading', 'el.textContent'), ['Waiting on you (1)', 'Working (1)']);
  assert.equal(await text(page, '.subs-sum'), '2 sub sessions, 1 waiting on you, 1 working');
  assert.deepEqual(page.problems, []);
});

test('a server that cannot say draws no line, counts nothing extra and is never asked for pull requests', { skip, timeout }, async t => {
  const older = await through(app, { leave: ['pullStatus'] });
  const page = await appPage(t, '#/s/top', { origin: older.origin });
  await page.until(`document.querySelectorAll('#panel .sub').length === ${KIDS_OF_TOP} && !!document.querySelector('.sub-said')`, 15_000);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub-pull, .sub-status, .pull-link').length`), 0);
  assert.equal(await button(page), `Sub sessions: ${KIDS_OF_TOP}, 2 waiting on you`, 'only Asks, which asked a question, and Approve, which waits for an approval');
  assert.deepEqual(older.pulls(), []);
  assert.deepEqual(page.problems, []);
});

test('a second look at the same sessions within the minute asks the server for nothing, and a reload asks it but runs gh no more', { skip, timeout }, async t => {
  const watch = await through(app);
  const page = await appPage(t, '#/s/calm', { origin: watch.origin });
  await page.until(`!!document.querySelector('#panel .sub-pull')`, 15_000);
  const first = watch.pulls().length;
  assert.equal(first, 1, 'one request for the one session');
  await page.click('#subsButton');
  await page.until(`!document.querySelector('#panel')`);
  await page.click('#subsButton');
  await page.until(`!!document.querySelector('#panel .sub-pull')`);
  await page.evaluate(`location.hash = '#/s/plain'`);
  await page.until(`document.querySelector('#title')?.textContent === 'Plain'`);
  await page.evaluate(`location.hash = '#/s/calm'`);
  await page.until(`!!document.querySelector('#panel .sub-pull')`);
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.deepEqual(watch.pulls().slice(first), ['/api/pulls?ids=plain'], 'the tab closed and opened, and the chat left and come back to, with only the session the page opened asking for itself');
  const before = ghCalls();
  await page.evaluate(`window.oldDocument = true; location.reload()`);
  await page.until(`!window.oldDocument && !!document.querySelector('#panel .sub-pull')`, 15_000);
  assert.equal(watch.pulls().length, first + 2, 'a new page knows nothing and asks');
  assert.equal(ghCalls(), before, 'and the server answers from its cache');
  assert.deepEqual(page.problems, []);
});

test('an answer that says some lookups are not ready is asked for again after a few seconds', { skip, timeout }, async t => {
  const watch = await through(app, { settle: 1 });
  const page = await appPage(t, '#/s/calm', { origin: watch.origin });
  await page.until(`!!document.querySelector('#panel .sub')`);
  for (const start = Date.now(); watch.pulls().length < 1;) {
    if (Date.now() - start > 10_000) throw new Error('no request was made');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const first = Date.now();
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.equal(watch.pulls().length, 1, 'not yet');
  for (; watch.pulls().length < 2;) {
    if (Date.now() - first > 9000) throw new Error('the page did not ask again');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(Date.now() - first >= 3500, 'it waited about four seconds');
  await page.until(`!!document.querySelector('#panel .sub-pull')`, 10_000);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(watch.pulls().length, 2, 'the second answer was complete, so it stops');
  assert.deepEqual(page.problems, []);
});

test('on a phone the pull request link and the buttons are at least 44 pixels high to touch, the lines wrap inside the card and the page does not scroll sideways', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top', { phone: true });
  await page.until(`!!document.querySelector('#subsButton')`);
  await new Promise(resolve => setTimeout(resolve, 500));
  if ((await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-expanded')`)) !== 'true') await page.click('#subsButton');
  await page.until(`document.querySelectorAll('#panel .sub-status').length >= ${KINDS.length}`, 15_000);
  await page.until(`!document.querySelector('#pane-subs').hidden && document.querySelector('.pull-link').getBoundingClientRect().height > 0`);
  assert.equal(await page.evaluate(`matchMedia('(pointer: coarse)').matches`), true);
  const tall = await page.evaluate(`[...document.querySelectorAll('.pull-link')].map(a => Math.round(a.getBoundingClientRect().height))`);
  assert.ok(tall.every(h => h >= 44), `heights ${tall}`);
  const reach = await page.evaluate(`[...document.querySelectorAll('.pull-link')].slice(0, 5).map(a => { a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === a; })`);
  assert.deepEqual(reach, [true, true, true, true, true], 'the middle of each link is the link');
  const buttons = await page.evaluate(`[...document.querySelectorAll('.sub-archive, .sub-fold')].map(b => { const r = b.getBoundingClientRect(); const after = getComputedStyle(b, '::after'); return [Math.round(r.height), parseFloat(after.height)]; })`);
  assert.ok(buttons.length >= KINDS.length * 2 && buttons.every(([, target]) => target >= 44), `touch targets ${JSON.stringify(buttons.slice(0, 4))}`);
  const long = await page.evaluate(`[...document.querySelectorAll('.sub-status')].every(p => p.scrollWidth <= p.clientWidth + 1 && p.getBoundingClientRect().right <= innerWidth)`);
  assert.equal(long, true, 'the longest sentence wraps');
  const wide = await page.evaluate(`[document.querySelector('.subs'), ...document.querySelectorAll('.sub-card')].some(el => el.scrollWidth > el.clientWidth + 1)`);
  assert.equal(wide, false);
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  assert.deepEqual(page.problems, []);
});

const archiveOf = id => `[data-archive-card="${id}"]`;
const present = (page, id) => page.evaluate(`!!document.querySelector('[data-archive-card="${id}"]')`);
const toast = page => page.evaluate(`(t => t && { text: t.querySelector('[data-title]').textContent, problem: t.dataset.type === 'warning', action: t.querySelector('button')?.textContent ?? null })(document.querySelector('[data-sonner-toast]'))`);
const toastIs = (page, text) => page.until(`document.querySelector('[data-sonner-toast] [data-title]')?.textContent === ${JSON.stringify(text)}`, 10_000);
const asking = page => page.evaluate(`(d => d && { title: d.querySelector('[data-slot="alert-dialog-title"]').textContent, detail: d.querySelector('[data-slot="alert-dialog-description"]').textContent, action: d.querySelector('[data-slot="alert-dialog-action"]').textContent })(document.querySelector('[data-slot="alert-dialog-content"]'))`);
const focused = page => page.evaluate(`(el => el === document.body ? 'body' : el.dataset.archiveCard ?? el.dataset.subCard ?? el.className)(document.activeElement)`);
const onTitle = (page, id) => page.until(`document.activeElement?.dataset?.subCard === ${JSON.stringify(id)}`);
const titles = page => page.evaluate(`[...document.querySelectorAll('[data-sub-card]')].map(a => a.dataset.subCard)`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const order = page => page.evaluate(`[...document.querySelectorAll('[data-archive-card]')].map(b => b.dataset.archiveCard)`);
const archive = async (page, id) => {
  await page.evaluate(`document.querySelector(${JSON.stringify(archiveOf(id))}).scrollIntoView({ block: 'center' })`);
  await page.click(archiveOf(id));
};
const DIALOG = `!!document.querySelector('[data-slot="alert-dialog-content"]')`;

test('each card has an Archive button beside Details, named for its session, and a running one says it stops it', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chores');
  await page.until(`document.querySelectorAll('[data-archive-card]').length === 9`, 15_000);
  const found = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('.sub')].map(sub => {
    const b = sub.querySelector('.sub-archive');
    return [sub.querySelector('.sub-title').firstChild.textContent, [b.textContent, b.getAttribute('aria-label'), b.dataset.size, b.dataset.variant, !!b.querySelector('svg'), b.nextElementSibling?.classList.contains('sub-fold')]];
  }))`);
  assert.deepEqual(found['Tidy A'], ['Archive', 'Archive Tidy A', 'xs', 'ghost', true, true]);
  assert.deepEqual(found['Busy A'], ['Archive', 'Stop and archive Busy A', 'xs', 'ghost', true, true]);
  assert.deepEqual(page.problems, []);
});

test('archiving an idle session takes the card away at once with no question, says so with Undo, and Undo brings the card back', { skip, timeout }, async t => {
  const watch = await through(app);
  const page = await appPage(t, '#/s/chores', { origin: watch.origin });
  await page.until(`${JSON.stringify(archiveOf('tidy-a'))} && !!document.querySelector(${JSON.stringify(archiveOf('tidy-a'))})`, 15_000);
  await archive(page, 'tidy-a');
  await toastIs(page, 'Archived “Tidy A”.');
  assert.equal(await page.evaluate(DIALOG), false, 'no question for an idle session');
  assert.deepEqual(await toast(page), { text: 'Archived “Tidy A”.', problem: false, action: 'Undo' });
  await page.until(`!document.querySelector(${JSON.stringify(archiveOf('tidy-a'))})`);
  assert.deepEqual(watch.archives(), [{ id: 'tidy-a', archived: true, stop: false }]);
  await page.until(`(b => !!b && b.getBoundingClientRect().bottom <= innerHeight)(document.querySelector('[data-sonner-toast] button'))`);
  await page.click('[data-sonner-toast] button');
  await toastIs(page, 'Unarchived “Tidy A”.');
  await page.until(`!!document.querySelector(${JSON.stringify(archiveOf('tidy-a'))})`, 10_000);
  assert.deepEqual(watch.archives()[1], { id: 'tidy-a', archived: false });
  assert.deepEqual(page.problems, []);
});

test('archiving a running session asks first, Cancel leaves the card where it was, and the answer stops and archives it', { skip, timeout }, async t => {
  const watch = await through(app);
  const page = await appPage(t, '#/s/chores', { origin: watch.origin });
  await page.until(`!!document.querySelector(${JSON.stringify(archiveOf('busy-a'))})`, 15_000);
  await archive(page, 'busy-a');
  await page.until(DIALOG);
  const question = await asking(page);
  assert.deepEqual(question, {
    title: 'Stop and archive “Busy A”?',
    detail: "Archiving stops Claude's turn and denies any approval it is waiting for. Undo brings the session back, but not the turn.",
    action: 'Stop and archive',
  });
  assert.deepEqual(watch.archives(), [], 'nothing is sent before the answer');
  await page.click('[data-slot="alert-dialog-cancel"]');
  await page.until(`!document.querySelector('[data-slot="alert-dialog-content"]')`);
  assert.equal(await present(page, 'busy-a'), true);
  assert.deepEqual(watch.archives(), []);
  await page.until(`document.activeElement?.dataset?.archiveCard === 'busy-a'`);
  await archive(page, 'busy-a');
  await page.until(DIALOG);
  await page.click('[data-slot="alert-dialog-action"]');
  await toastIs(page, 'Stopped and archived “Busy A”.');
  assert.equal((await toast(page)).action, 'Undo');
  await page.until(`!document.querySelector(${JSON.stringify(archiveOf('busy-a'))})`);
  assert.deepEqual(watch.archives(), [{ id: 'busy-a', archived: true }]);
  assert.notEqual(await focused(page), 'body');
  assert.deepEqual(page.problems, []);
});

test('a server that says the session is running makes the card ask, and then archives it', { skip, timeout }, async t => {
  const watch = await through(app, { running: true });
  const page = await appPage(t, '#/s/chores', { origin: watch.origin });
  await page.until(`!!document.querySelector(${JSON.stringify(archiveOf('tidy-f'))})`, 15_000);
  await archive(page, 'tidy-f');
  await page.until(DIALOG);
  assert.equal((await asking(page)).title, 'Stop and archive “Tidy F”?');
  assert.equal(await present(page, 'tidy-f'), true, 'the card came back after the refusal');
  await page.click('[data-slot="alert-dialog-action"]');
  await page.until(`!document.querySelector(${JSON.stringify(archiveOf('tidy-f'))})`, 10_000);
  assert.deepEqual(watch.archives(), [{ id: 'tidy-f', archived: true, stop: false }, { id: 'tidy-f', archived: true }]);
  assert.deepEqual(page.problems, []);
});

test('a refusal shows as a problem and the card stays, with the focus back on its button', { skip, timeout }, async t => {
  const refusing = await through(app, { refuse: true });
  const page = await appPage(t, '#/s/chores', { origin: refusing.origin });
  await page.until(`!!document.querySelector(${JSON.stringify(archiveOf('tidy-e'))})`, 15_000);
  await page.evaluate(`document.querySelector(${JSON.stringify(archiveOf('tidy-e'))}).focus()`);
  await page.press('Enter');
  await toastIs(page, 'Not archived: The layout could not be written.');
  assert.deepEqual(await toast(page), { text: 'Not archived: The layout could not be written.', problem: true, action: null });
  await page.until(`!!document.querySelector(${JSON.stringify(archiveOf('tidy-e'))})`);
  await page.until(`document.activeElement?.dataset?.archiveCard === 'tidy-e'`);
  assert.deepEqual(page.problems.filter(p => !/HTTP 500|500/.test(p)), []);
});

test('after a card is archived the focus is on the next card\'s title link, else the one before, else the tab, and never on a button or the page', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chores');
  await page.until(`!!document.querySelector(${JSON.stringify(archiveOf('tidy-g'))})`, 15_000);
  const cards = await order(page);
  const middle = cards[cards.indexOf('tidy-b')];
  const next = cards[cards.indexOf('tidy-b') + 1];
  await page.evaluate(`document.querySelector(${JSON.stringify(archiveOf(middle))}).focus()`);
  await page.press('Enter');
  await page.until(`!document.querySelector(${JSON.stringify(archiveOf(middle))})`);
  await onTitle(page, next);
  await page.until(`!!document.querySelector('[data-sonner-toast]')`, 10_000);
  const last = (await order(page)).at(-1);
  const before = (await order(page)).at(-2);
  await page.evaluate(`document.querySelector(${JSON.stringify(archiveOf(last))}).focus()`);
  await page.press('Enter');
  await page.until(`!document.querySelector(${JSON.stringify(archiveOf(last))})`);
  await onTitle(page, before);
  assert.deepEqual(page.problems, []);
});

test('a session that had sessions under it hands the focus to the first of them, which move up into its place, before any other card', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/fam');
  await page.until(`document.querySelectorAll('[data-archive-card]').length === 2`, 15_000);
  const cards = await order(page);
  assert.deepEqual(cards.sort(), ['fam-a', 'fam-b']);
  assert.equal((await titles(page)).includes('fam-a-kid'), false, 'the child is folded under its parent');
  await page.evaluate(`document.querySelector(${JSON.stringify(archiveOf('fam-a'))}).focus()`);
  await page.press('Enter');
  await page.until(`!document.querySelector(${JSON.stringify(archiveOf('fam-a'))})`);
  await onTitle(page, 'fam-a-kid');
  assert.deepEqual(page.problems, []);
});

test('a held Enter archives one card, and a double click archives one card', { skip, timeout }, async t => {
  const watch = await through(app);
  const page = await appPage(t, '#/s/chores', { origin: watch.origin });
  await page.until(`document.querySelectorAll('[data-archive-card]').length >= 4`, 15_000);
  const cards = await page.evaluate(`document.querySelectorAll('[data-archive-card]').length`);
  await page.evaluate(`document.querySelector('[data-archive-card^="tidy"]').focus()`);
  const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...enter });
  for (let n = 0; n < 6; n++) {
    await sleep(40);
    await page.call('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', autoRepeat: true, ...enter });
  }
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
  await page.until(`!!document.querySelector('[data-sonner-toast]')`, 10_000);
  await sleep(600);
  assert.equal(watch.archives().length, 1, 'the repeats did nothing');
  assert.equal(await page.evaluate(`document.querySelectorAll('[data-archive-card]').length`), cards - 1);
  assert.equal(await page.evaluate(`location.hash`), '#/s/chores', 'the repeats did not open the card the focus moved to');
  assert.equal((await focused(page)).startsWith('tidy') || (await focused(page)).startsWith('busy'), true, 'the focus is on a title link');
  assert.equal(await page.evaluate(`document.activeElement.tagName`), 'A');

  const { x, y } = await page.evaluate(`(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))(document.querySelector('[data-archive-card^="tidy"]').getBoundingClientRect())`);
  for (const clickCount of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) await page.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount });
  await sleep(1200);
  assert.equal(watch.archives().length, 2, 'the double click archived one card');
  assert.equal(await page.evaluate(`document.querySelectorAll('[data-archive-card]').length`), cards - 2);
  assert.deepEqual(page.problems, []);
});

test('archiving the only card, which takes the tab with it, puts the focus on the message box, not on the page', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/lone');
  await page.until(`!!document.querySelector(${JSON.stringify(archiveOf('lone-kid'))})`, 15_000);
  await page.evaluate(`document.querySelector(${JSON.stringify(archiveOf('lone-kid'))}).focus()`);
  await page.press('Enter');
  await page.until(`!document.querySelector(${JSON.stringify(archiveOf('lone-kid'))})`);
  await page.until(`document.activeElement !== document.body`);
  assert.equal(await page.evaluate(`document.activeElement.id`), 'text');
  assert.deepEqual(page.problems, []);
});
