// Run with `npm test`. The pull requests and issues of the open session in the real page, against the real server and a fake gh: the badges in the
// header with their status words, links and names, adding one through the field and removing one, an item gh cannot read, a server that cannot
// attach, a phone, and the card on the Sub sessions tab speaking of the pull request that waits on the owner with the rest as badges.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, PASSWORD, request, signIn, start } from './harness.mjs';

const pr = n => `https://github.com/example-org/example-repo/pull/${n}`;
const is = n => `https://github.com/example-org/example-repo/issues/${n}`;
const OK = [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const raw = (extra = {}) => ({
  title: 'Fix the thing', state: 'OPEN', isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', statusCheckRollup: OK, latestReviews: [],
  reviewRequests: [], author: { login: 'octocat' }, ...extra,
});
const issue = (extra = {}) => ({ title: 'Something is broken', state: 'OPEN', stateReason: '', ...extra });

const SESSIONS = [
  { id: 'main', title: 'Main', ago: 1 },
  { id: 'plain', title: 'Plain', ago: 2 },
  { id: 'top', title: 'Top', ago: 3 },
  { id: 'kid', title: 'Kid', parent: 'top', ago: 4 },
];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let older;
let browser;
let token;

const transcript = id => path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
const says = (id, text) => fs.appendFileSync(transcript(id), `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })}\n`);
const made = (id, output) => fs.appendFileSync(transcript(id), `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: output }] } })}\n`);
const attach = (id, url, attached) => request(app, 'POST', '/api/attached', { headers: as(token), json: { id, url, attached } });
const linksFile = () => path.join(app.state, 'links.json');
const saved = () => (fs.existsSync(linksFile()) ? JSON.parse(fs.readFileSync(linksFile(), 'utf8')) : {});

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
  app = await start({ sessions: SESSIONS, claude: true, gh: true });
  fs.writeFileSync(path.join(app.home, 'gh-state.json'), JSON.stringify({
    pulls: {
      [pr(1)]: raw({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }),
      [pr(2)]: raw({ author: { login: 'hubot' }, reviewRequests: [{ login: 'octocat' }], reviewDecision: 'REVIEW_REQUIRED', title: 'Add the other thing' }),
      [pr(3)]: raw({ author: { login: 'hubot' } }),
    },
    issues: { [is(5)]: issue(), [is(6)]: issue({ state: 'CLOSED', stateReason: 'COMPLETED', title: 'Old problem' }) },
    threads: {},
  }));
  says('main', `Opened ${pr(1)}.`);
  made('main', `Creating issue in example-org/example-repo\n\n${is(5)}\n`);
  says('kid', `Opened ${pr(3)}.`);
  ({ token } = await signIn(app));
  await attach('kid', pr(2), true);
  older = await without(app, 'attachLinks');
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
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

// Each badge in the header as { ref, word, tone, href, name, tip, remove }.
const badges = page => page.evaluate(`[...document.querySelectorAll('.chat-head .session-link-item')].map(li => {
  const link = li.querySelector('.session-link-link');
  return {
    ref: li.querySelector('.session-link-ref').textContent, word: li.querySelector('.session-link-word').textContent, tone: li.dataset.tone, href: link.getAttribute('href'),
    name: link.getAttribute('aria-label'), tip: link.dataset.tip, remove: li.querySelector('.session-link-remove')?.getAttribute('aria-label') ?? null,
  };
})`);
const refs = async page => (await badges(page)).map(b => `${b.ref} ${b.word}`);
const shown = (page, list) => page.until(`JSON.stringify([...document.querySelectorAll('.chat-head .session-link-item')].map(li => li.querySelector('.session-link-ref').textContent + ' ' + li.querySelector('.session-link-word').textContent)) === ${JSON.stringify(JSON.stringify(list))}`, 15_000);

test('the header lists the pull request and the issue found in the session, each with its status word, a link that opens in another tab, and a name that says it all', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/main');
  await shown(page, ['example-repo#1 Ready to merge', 'example-repo#5 Open']);
  const [pull, issueBadge] = await badges(page);
  assert.deepEqual(pull, {
    ref: 'example-repo#1', word: 'Ready to merge', tone: 'needs', href: pr(1),
    name: 'example-repo#1, Ready to merge',
    tip: `Fix the thing. Merge the pull request. ${pr(1)}`, remove: 'Remove pull request example-repo#1',
  });
  assert.deepEqual(issueBadge, {
    ref: 'example-repo#5', word: 'Open', tone: 'quiet', href: is(5),
    name: 'example-repo#5, Open', tip: `Something is broken. ${is(5)}`, remove: 'Remove issue example-repo#5',
  });
  assert.equal(await page.evaluate(`[...document.querySelectorAll('.chat-head .session-link-link')].every(a => a.target === '_blank' && a.rel === 'noopener noreferrer')`), true);
  assert.equal(await page.evaluate(`!!document.querySelector('.chat-head .chat-meta + .session-links')`), true, 'under the folder and branch line');
  assert.equal(await page.evaluate(`document.querySelector('.chat-head .session-links').getAttribute('aria-label')`), 'Pull requests and issues');
  assert.deepEqual(page.problems, []);
});

test('a session with nothing to show has only the button that adds one', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/plain');
  await page.until(`!!document.querySelector('.chat-head .session-link-add')`, 15_000);
  assert.deepEqual(await badges(page), []);
  assert.equal(await page.evaluate(`document.querySelector('.session-link-add').getAttribute('aria-label')`), 'Add a pull request or issue');
  assert.deepEqual(page.problems, []);
});

test('an address pasted into the field is cut back and added, a bad one is refused with a toast and keeps the field, and the badge can be removed again', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/plain');
  await page.until(`!!document.querySelector('.chat-head .session-link-add')`, 15_000);
  await page.click('.session-link-add');
  await page.until(`document.activeElement?.matches('.session-link-form input')`);
  assert.equal(await page.evaluate(`(input => document.querySelector('label[for="' + input.id + '"]').textContent)(document.querySelector('.session-link-form input'))`), 'Pull request or issue address');
  await page.insert('not an address');
  await page.press('Enter');
  await page.until(`document.querySelector('[data-sonner-toast]')?.textContent.includes('Paste the address of a GitHub pull request or issue.')`);
  assert.equal(await page.evaluate(`!!document.querySelector('.session-link-form')`), true, 'the field stays open');
  await page.evaluate(`(input => { input.select(); })(document.querySelector('.session-link-form input'))`);
  await page.insert(`${is(6)}#issuecomment-12`);
  await page.press('Enter');
  await shown(page, ['example-repo#6 Done']);
  assert.deepEqual(saved().plain, { added: [is(6)], hidden: [] });
  assert.equal(await page.evaluate(`!document.querySelector('.session-link-form') && document.activeElement === document.querySelector('.session-link-add')`), true, 'the field closes and the focus returns to the add button');
  assert.equal((await badges(page))[0].tone, 'ready');
  await page.click('.chat-head .session-link-remove');
  await page.until(`!document.querySelector('.chat-head .session-link-item')`, 15_000);
  assert.deepEqual(saved(), { 'kid': { added: [pr(2)], hidden: [] } });
  assert.deepEqual(page.problems, []);
});

test('Escape closes the field without adding anything, and the add button is reached from the keyboard', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/plain');
  await page.until(`!!document.querySelector('.chat-head .session-link-add')`, 15_000);
  await page.evaluate(`document.querySelector('.session-link-add').focus()`);
  await page.press('Enter');
  await page.until(`document.activeElement?.matches('.session-link-form input')`);
  await page.press('Escape');
  await page.until(`!document.querySelector('.session-link-form') && document.activeElement === document.querySelector('.session-link-add')`);
  assert.deepEqual(saved().plain, undefined);
  assert.deepEqual(page.problems, []);
});

test('an added item gh cannot read shows as Can\'t read with a name, and removing a found item hides it for good', { skip, timeout }, async t => {
  await attach('main', is(404), true);
  const page = await appPage(t, '#/s/main');
  await shown(page, ['example-repo#1 Ready to merge', 'example-repo#5 Open', 'example-repo#404 Can\'t read']);
  const unreadable = (await badges(page))[2];
  assert.deepEqual([unreadable.tone, unreadable.name, unreadable.remove], ['error', "example-repo#404, Can't read", 'Remove issue example-repo#404']);
  await page.click('.chat-head .session-link-item:nth-child(1) .session-link-remove');
  await shown(page, ['example-repo#5 Open', 'example-repo#404 Can\'t read']);
  assert.deepEqual(saved().main, { added: [is(404)], hidden: [pr(1)] });
  await page.evaluate('location.reload()');
  await shown(page, ['example-repo#5 Open', 'example-repo#404 Can\'t read']);
  await attach('main', is(404), false);
  await attach('main', pr(1), true);
});

test('after a failed add or remove the focus is back on the field or the badge\'s remove button, not lost on the page', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/main');
  await shown(page, ['example-repo#1 Ready to merge', 'example-repo#5 Open']);
  await page.evaluate(`(real => { window.fetch = (url, init) => String(url).includes('api/attached') ? Promise.resolve(new Response(JSON.stringify({ error: 'Refused for the test' }), { status: 500, headers: { 'content-type': 'application/json' } })) : real(url, init); })(window.fetch.bind(window))`);
  await page.click('.chat-head .session-link-item:nth-child(1) .session-link-remove');
  await page.until(`document.querySelector('[data-sonner-toast]')?.textContent.includes('Refused for the test')`);
  await page.until(`document.activeElement === document.querySelector('.chat-head .session-link-item:nth-child(1) .session-link-remove')`);
  await page.click('.session-link-add');
  await page.until(`document.activeElement?.matches('.session-link-form input')`);
  await page.insert(is(7));
  await page.press('Enter');
  await page.until(`document.activeElement?.matches('.session-link-form input') && !document.activeElement.disabled && document.activeElement.value === ${JSON.stringify(is(7))}`);
  assert.deepEqual(saved().main, undefined);
  assert.deepEqual(page.problems, []);
});

test('a server that cannot attach shows the badges with no remove or add', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/main', { origin: older.origin });
  await shown(page, ['example-repo#1 Ready to merge', 'example-repo#5 Open']);
  assert.equal(await page.evaluate(`document.querySelectorAll('.chat-head .session-link-remove, .chat-head .session-link-add').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('on a phone the badges wrap inside the header, and so does the open field', { skip, timeout }, async t => {
  await attach('main', is(6), true);
  const page = await appPage(t, '#/s/main', { phone: true });
  await shown(page, ['example-repo#1 Ready to merge', 'example-repo#5 Open', 'example-repo#6 Done']);
  const fit = () => page.evaluate(`(() => {
    const head = document.querySelector('.chat-head').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.chat-head .session-links > li')].map(li => li.getBoundingClientRect());
    return { page: document.documentElement.scrollWidth <= window.innerWidth, inside: boxes.every(b => b.left >= head.left - 0.5 && b.right <= head.right + 0.5), rows: new Set(boxes.map(b => Math.round(b.top))).size };
  })()`);
  const closed = await fit();
  assert.deepEqual([closed.page, closed.inside], [true, true]);
  assert.ok(closed.rows >= 2, 'the badges wrap onto more than one line');
  await page.tap('.session-link-add');
  await page.until(`!!document.querySelector('.session-link-form input')`);
  const open = await fit();
  assert.deepEqual([open.page, open.inside], [true, true]);
  await attach('main', is(6), false);
  assert.deepEqual(page.problems, []);
});

test('a card speaks of the pull request that waits on the owner, and shows the session\'s other items as badges with no remove button', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`!!document.querySelector('.sub .sub-status')`, 15_000);
  const card = await page.evaluate(`(sub => ({
    status: sub.querySelector('.sub-status').textContent, link: sub.querySelector('.pull-link').textContent,
    badges: [...sub.querySelectorAll('.session-link-item')].map(li => li.querySelector('.session-link-ref').textContent + ' ' + li.querySelector('.session-link-word').textContent),
    removes: sub.querySelectorAll('.session-link-remove, .session-link-add').length, label: sub.querySelector('.session-links').getAttribute('aria-label'),
  }))([...document.querySelectorAll('.sub')].find(s => s.querySelector('.sub-title').firstChild.textContent === 'Kid'))`);
  assert.deepEqual(card, { status: 'Review the pull request', link: pr(2), badges: ['example-repo#3 Open'], removes: 0, label: 'Pull requests and issues of Kid' });
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-label')`), 'Sub sessions: 1, 1 waiting on you');
  assert.deepEqual(page.problems, []);
});
