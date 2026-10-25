// Run with `npm test`. The status of the pull requests a session works on, in the real page against the real server and a fake gh: each kind of
// status line on a card with the whole address as its link, a card with none drawn as before, a pull request that waits on the owner making its
// session wait on them in the pill, the section and the header button, a working session leaving its own failing checks to itself, a server that
// cannot say, and when the page asks the server and when it does not. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
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
  ['Open', 10], ['Draft', 11], ['Merged', 12], ['Closed', 13],
];
const SESSIONS = [
  { id: 'top', title: 'Top', ago: 1 },
  ...KINDS.map(([title, n], at) => ({ id: title.toLowerCase(), title, parent: 'top', ago: 10 + at })),
  { id: 'many', title: 'Many', parent: 'top', ago: 30 },
  { id: 'plain', title: 'Plain', parent: 'top', ago: 31 },
  { id: 'unknown', title: 'Unknown', parent: 'top', ago: 32 },
  { id: 'asks', title: 'Asks', parent: 'top', ago: 33, verdict: 'need_input' },
  { id: 'calm', title: 'Calm', ago: 2 },
  { id: 'calm-kid', title: 'Calm kid', parent: 'calm', ago: 40 },
  { id: 'work', title: 'Work', ago: 3 },
  { id: 'w-fail', title: 'Working on failing checks', parent: 'work', ago: 41 },
  { id: 'w-review', title: 'Working with a review asked', parent: 'work', ago: 42 },
];
const KIDS_OF_TOP = SESSIONS.filter(s => s.parent === 'top').length;
const NEED_YOU = ['Review', 'Changes', 'Conflicts', 'Comments', 'Failing', 'Ready', 'Many', 'Asks'];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let browser;
const proxies = [];

const says = (id, text) => fs.appendFileSync(path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`),
  `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'text', text }] } })}\n`);
const ghCalls = () => (fs.existsSync(app.ghLog) ? fs.readFileSync(app.ghLog, 'utf8').split('\n').filter(Boolean).length : 0);
const rowsOf = ix => [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.started, ...ix.ungrouped, ...ix.other].flatMap(r => [r, ...(r.children ?? [])]);

// The server behind a proxy that logs the requests to api/pulls and can leave out features of the list, or say a number of the answers are still settling.
function through(target, { leave = [], settle = 0 } = {}) {
  const seen = [];
  let settling = settle;
  const proxy = http.createServer((req, res) => {
    seen.push(req.url);
    const route = req.url.split('?')[0];
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      const rewrite = (route === '/api/sessions' && leave.length) || (route === '/api/pulls' && settling > 0);
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
        else { settling--; body.settling = true; }
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
  says('plain', 'Nothing to open yet.');
  says('unknown', `Opened ${pr(99)}.`);
  says('calm-kid', `Opened ${pr(41)}.`);
  says('w-fail', `Opened ${pr(31)}.`);
  says('w-review', `Opened ${pr(32)}.`);
  const { token } = await signIn(app);
  for (const id of ['w-fail', 'w-review']) await request(app, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text: 'keep going' } });
  await until(async () => {
    const ix = (await request(app, 'GET', '/api/sessions', { headers: as(token) })).body();
    return rowsOf(ix).filter(r => r.state === 'working').length === 2;
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
// The title of each card with what its pull request lines say and link to.
const cards = page => page.evaluate(`Object.fromEntries([...document.querySelectorAll('.sub')].map(sub => [
  sub.querySelector('.sub-title').firstChild.textContent,
  [...sub.querySelectorAll('.sub-pull')].map(li => ({ facts: [...li.querySelectorAll('.pull-fact')].map(f => f.textContent), tones: [...li.querySelectorAll('.pull-fact')].map(f => f.dataset.tone), link: li.querySelector('.pull-link').textContent, href: li.querySelector('.pull-link').getAttribute('href') })),
]))`);

test('a card shows a line for each pull request with the words for its status and the whole address as a link that opens in another tab', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`document.querySelectorAll('.sub-pull').length >= ${KINDS.length}`, 15_000);
  const found = await cards(page);
  const line = (facts, n, tones) => ({ facts, tones, link: pr(n), href: pr(n) });
  assert.deepEqual(found.Review, [line(['Needs your review'], 1, ['needs'])]);
  assert.deepEqual(found.Changes, [line(['Changes requested'], 2, ['needs'])]);
  assert.deepEqual(found.Conflicts, [line(['Has conflicts'], 3, ['needs'])]);
  assert.deepEqual(found.Comments, [line(['Has 2 unresolved comments'], 4, ['needs'])]);
  assert.deepEqual(found.Failing, [line(['Checks failing'], 5, ['error'])]);
  assert.deepEqual(found.Running, [line(['Checks running'], 6, ['working'])]);
  assert.deepEqual(found.Approved, [line(['Approved'], 7, ['ready'])]);
  assert.deepEqual(found.Ready, [line(['Ready to merge'], 8, ['ready'])]);
  assert.deepEqual(found.Waiting, [line(['Waiting for review'], 9, ['quiet'])]);
  assert.deepEqual(found.Open, [line(['Open'], 10, ['quiet'])]);
  assert.deepEqual(found.Draft, [line(['Draft'], 11, ['quiet'])]);
  assert.deepEqual(found.Merged, [line(['Merged'], 12, ['ready'])]);
  assert.deepEqual(found.Closed, [line(['Closed'], 13, ['quiet'])]);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('.pull-link')].every(a => a.target === '_blank' && a.rel === 'noopener noreferrer')`), true);
  assert.equal(await page.evaluate(`document.querySelector('.sub-pulls').getAttribute('aria-label')`), 'Pull requests');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.pull-fact[data-tone="needs"]')).fontWeight`), '500');
  assert.deepEqual(page.problems, []);
});

test('a card with several pull requests lists them most urgent first and shows three facts of one at most', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`!!document.querySelector('.sub-pull')`, 15_000);
  await page.until(`([...document.querySelectorAll('.sub')].find(s => s.querySelector('.sub-title').firstChild.textContent === 'Many')?.querySelectorAll('.sub-pull').length === 3)`, 15_000);
  const many = (await cards(page)).Many;
  assert.deepEqual(many.map(p => p.link), [pr(21), pr(22), pr(23)], 'the most urgent first, and the rest as the session named them');
  assert.deepEqual(many[0].facts, ['Needs your review', 'Changes requested', 'Has conflicts'], 'five things are true of it, and three are shown');
  assert.deepEqual(many.slice(1).map(p => p.facts), [['Open'], ['Merged']]);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('.sub-pull .pull-facts .pull-fact')].slice(0, 3).map(f => f.textContent).join(' · ')`), 'Needs your review · Changes requested · Has conflicts');
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub-pull .pull-facts [aria-hidden="true"]').length`), 2, 'the dots are hidden from a screen reader, which hears commas');
  assert.deepEqual(page.problems, []);
});

test('a card with no pull request, and one whose pull request gh could not read, have no list at all', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`document.querySelectorAll('.sub-pull').length >= ${KINDS.length}`, 15_000);
  const found = await cards(page);
  assert.deepEqual([found.Plain, found.Unknown], [[], []]);
  const bare = await page.evaluate(`['Plain', 'Unknown'].map(name => { const sub = [...document.querySelectorAll('.sub')].find(s => s.querySelector('.sub-title').firstChild.textContent === name); return sub.querySelectorAll('.sub-pulls, .pull-facts, .pull-link').length; })`);
  assert.deepEqual(bare, [0, 0]);
  assert.deepEqual(page.problems, []);
});

test('a session whose pull request waits on the owner shows Waiting on you, sits in that section, and is counted by the header button and its mark', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`document.querySelectorAll('.sub-pull').length >= ${KINDS.length}`, 15_000);
  assert.equal(await button(page), `Sub sessions: ${KIDS_OF_TOP}, ${NEED_YOU.length} waiting on you`);
  assert.equal(await page.evaluate(`!!document.querySelector('#subsButton .subs-mark')`), true);
  assert.equal(await text(page, '.subs-sum'), `${KIDS_OF_TOP} sub sessions, ${NEED_YOU.length} waiting on you`);
  const under = await page.evaluate(`[...document.querySelectorAll('.subs .status-part')].map(part => [part.querySelector('.status-heading').textContent, [...part.querySelectorAll('.sub-title')].map(a => a.firstChild.textContent).sort()])`);
  assert.deepEqual(under.find(([heading]) => heading.startsWith('Waiting on you')), [`Waiting on you (${NEED_YOU.length})`, [...NEED_YOU].sort()]);
  const pills = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('.sub')].map(sub => [sub.querySelector('.sub-title').firstChild.textContent, sub.querySelector('.sub-pill').textContent]))`);
  for (const name of NEED_YOU) assert.equal(pills[name], 'Waiting on you', name);
  for (const name of ['Running', 'Approved', 'Waiting', 'Open', 'Draft', 'Merged', 'Closed', 'Plain', 'Unknown']) assert.notEqual(pills[name], 'Waiting on you', name);
  assert.deepEqual(page.problems, []);
});

test('the header button counts a pull request that needs the owner with the panel closed, and a session with nothing pending is not counted', { skip, timeout }, async t => {
  const closed = await appPage(t, '#/s/top');
  await closed.until(`!!document.querySelector('#subsButton')`);
  await closed.click('#subsButton');
  await closed.until(`!document.querySelector('#panel')`);
  await closed.evaluate(`window.oldDocument = true; location.reload()`);
  await closed.until(`!window.oldDocument && document.readyState === 'complete' && !!document.querySelector('#subsButton')`);
  assert.equal(await closed.evaluate(`!!document.querySelector('#panel')`), false, 'the panel stays closed');
  await closed.until(`document.querySelector('#subsButton').getAttribute('aria-label').endsWith('${NEED_YOU.length} waiting on you')`, 15_000);
  assert.equal(await closed.evaluate(`!!document.querySelector('#subsButton .subs-mark')`), true);
  const calm = await appPage(t, '#/s/calm');
  await calm.until(`!!document.querySelector('#panel .sub-pull')`, 15_000);
  assert.equal(await button(calm), 'Sub sessions: 1');
  assert.equal(await calm.evaluate(`!!document.querySelector('#subsButton .subs-mark')`), false);
  assert.equal(await text(calm, '.sub-pill'), 'Idle');
  assert.deepEqual((await cards(calm))['Calm kid'].map(p => p.facts), [['Open']]);
  assert.deepEqual(closed.problems, []);
  assert.deepEqual(calm.problems, []);
});

test('a working session leaves its own failing checks to itself and is not counted, and one with a review asked of the owner is', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/work');
  await page.until(`document.querySelectorAll('.sub-pull').length === 2`, 15_000);
  assert.equal(await button(page), 'Sub sessions: 2, 1 waiting on you');
  const pills = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('.sub')].map(sub => [sub.querySelector('.sub-title').firstChild.textContent, sub.querySelector('.sub-pill').textContent]))`);
  assert.deepEqual(pills, { 'Working on failing checks': 'Working', 'Working with a review asked': 'Waiting on you' });
  const found = await cards(page);
  assert.deepEqual(found['Working on failing checks'].map(p => p.facts), [['Checks failing']], 'the line is still shown');
  assert.deepEqual(found['Working with a review asked'].map(p => p.facts), [['Needs your review']]);
  assert.deepEqual(await all(page, '.subs .status-heading', 'el.textContent'), ['Waiting on you (1)', 'Working (1)']);
  assert.equal(await text(page, '.subs-sum'), '2 sub sessions, 1 waiting on you, 1 working');
  assert.deepEqual(page.problems, []);
});

test('a server that cannot say draws no line, counts nothing extra and is never asked for pull requests', { skip, timeout }, async t => {
  const older = await through(app, { leave: ['pullStatus'] });
  const page = await appPage(t, '#/s/top', { origin: older.origin });
  await page.until(`document.querySelectorAll('#panel .sub').length === ${KIDS_OF_TOP} && !!document.querySelector('.sub-said')`, 15_000);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub-pulls, .sub-pull, .pull-link').length`), 0);
  assert.equal(await button(page), `Sub sessions: ${KIDS_OF_TOP}, 1 waiting on you`, 'only Asks, which asked a question');
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
  assert.equal(watch.pulls().length, first, 'the tab closed and opened, and the chat left and come back to');
  const before = ghCalls();
  await page.evaluate(`window.oldDocument = true; location.reload()`);
  await page.until(`!window.oldDocument && !!document.querySelector('#panel .sub-pull')`, 15_000);
  assert.equal(watch.pulls().length, first + 1, 'a new page knows nothing and asks');
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

test('on a phone each pull request link is at least 44 pixels high to touch, the address wraps inside the card and the page does not scroll sideways', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top', { phone: true });
  await page.until(`!!document.querySelector('#subsButton')`);
  await page.click('#subsButton');
  await page.until(`document.querySelectorAll('#panel .sub-pull').length >= ${KINDS.length}`, 15_000);
  assert.equal(await page.evaluate(`matchMedia('(pointer: coarse)').matches`), true);
  const tall = await page.evaluate(`[...document.querySelectorAll('.pull-link')].map(a => Math.round(a.getBoundingClientRect().height))`);
  assert.ok(tall.every(h => h >= 44), `heights ${tall}`);
  const reach = await page.evaluate(`[...document.querySelectorAll('.pull-link')].slice(0, 5).map(a => { const r = a.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === a; })`);
  assert.deepEqual(reach, [true, true, true, true, true], 'the middle of each link is the link');
  const wide = await page.evaluate(`[document.querySelector('.subs'), ...document.querySelectorAll('.sub-card')].some(el => el.scrollWidth > el.clientWidth + 1)`);
  assert.equal(wide, false);
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  assert.deepEqual(page.problems, []);
});
