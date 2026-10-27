// Run with `npm test`. The badge after a pull request or issue link in a reply, and the card behind it, in the real page against the real server and a fake
// gh: one badge with the right word for each kind of link and none for a link gh cannot show, the card opening on a click and a hover with the title as text,
// closing on Escape, a press outside, a scroll and a resize, a tap on a phone, the badge coming back when a reply is drawn again, the badge staying out of a
// quote, and a server that cannot say leaving the page with no badge and no request. It needs Playwright's Chromium headless shell, and every test skips
// with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const pr = n => `https://github.com/example-org/example-repo/pull/${n}`;
const issue = n => `https://github.com/example-org/example-repo/issues/${n}`;
const OK = [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const raw = (extra = {}) => ({
  state: 'OPEN', isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', statusCheckRollup: OK, latestReviews: [],
  reviewRequests: [], author: { login: 'octocat' }, title: 'A pull request', ...extra,
});

const TITLE = 'Add <img src=x onerror="window.pwned=1"> link previews';
const PULLS = {
  1: raw({ title: TITLE, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }),
  3: raw({ state: 'MERGED', title: 'Merged one' }),
  4: raw({ isDraft: true, title: 'Draft one' }),
  5: raw({ state: 'CLOSED', title: 'Closed one' }),
};
const ISSUES = {
  2: { title: 'Not planned one', state: 'CLOSED', stateReason: 'NOT_PLANNED' },
  6: { title: 'Open issue', state: 'OPEN', stateReason: '' },
  7: { title: 'Done issue', state: 'CLOSED', stateReason: 'COMPLETED' },
};
const WORDS = [[1, 'Open'], [3, 'Merged'], [4, 'Draft'], [5, 'Closed']];
const ISSUE_WORDS = [[2, 'Not planned'], [6, 'Open'], [7, 'Closed']];

const SESSIONS = [{ id: 'chat', title: 'Chat', ago: 10 }, { id: 'old', title: 'Old', ago: 11 }, { id: 'shy', title: 'Shy', ago: 12 }];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let browser;
const proxies = [];
let said = 0;

const says = (id, text) => {
  const file = path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}-${++said}`, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })}\n`);
  const old = (Date.now() - 600_000) / 1000;
  fs.utimesSync(file, old, old);
};

const FILLER = Array.from({ length: 40 }, (_, n) => `Paragraph ${n} of a long reply.`).join('\n\n');

// A server behind a proxy that logs the requests to api/links and can leave `linkStatus` out of the session list, as a server that does not know it does.
function through(target, { leave = false } = {}) {
  const seen = [];
  const proxy = http.createServer((req, res) => {
    seen.push(req.url);
    const route = req.url.split('?')[0];
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      if (!(leave && route === '/api/sessions')) {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        delete body.features.linkStatus;
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
      links: () => seen.filter(url => url.startsWith('/api/links')),
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
    issues: Object.fromEntries(Object.entries(ISSUES).map(([n, value]) => [issue(n), value])),
    threads: {},
  }));
  says('chat', FILLER);
  says('chat', [
    `The change is [the first pull request](${pr(1)}), with the issue ${issue(2)} behind it.`,
    `Also [merged](${pr(3)}), [a draft](${pr(4)}), [closed](${pr(5)}), [an open issue](${issue(6)}) and [a done issue](${issue(7)}).`,
    `[Nobody knows this one](${pr(99)}), [an elsewhere](https://example.com/o/r/pull/1) and [a file list](${pr(1)}/files).`,
  ].join('\n\n'));
  for (const id of ['old', 'shy']) says(id, [`[the first pull request](${pr(1)})`, `[an open issue](${issue(6)})`].join('\n\n'));
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  for (const proxy of proxies) await proxy.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

async function appPage(t, hash, { origin = app.origin, phone = false } = {}) {
  const page = await browser.open(`${origin}/`, { phone });
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
  await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.until(`!!document.querySelector('.msg.claude a')`, 15_000);
  return page;
}

// The word on each badge, by the address of the link before it, and the badges that are not right after a link.
const badges = page => page.evaluate(`Object.fromEntries([...document.querySelectorAll('.msg.claude a')].map(a => [a.getAttribute('href'), a.nextSibling?.classList?.contains('link-badge') ? a.nextSibling.textContent : null]))`);
const count = (page, selector = '.link-badge') => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const shown = page => page.evaluate(`!!document.querySelector('#link-card') && !document.querySelector('#link-card').hidden`);
const badgeOf = href => `.msg.claude a[href="${href}"] + .link-badge`;
const withBadges = (page, n = 7) => page.until(`document.querySelectorAll('.link-badge').length >= ${n}`, 15_000);
const nap = ms => new Promise(resolve => setTimeout(resolve, ms));

test('each pull request and issue link in a reply gets one badge with the state in a word, and a link gh cannot show gets none', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page, WORDS.length + ISSUE_WORDS.length);
  const found = await badges(page);
  for (const [n, word] of WORDS) assert.equal(found[pr(n)], word, `pull request ${n}`);
  for (const [n, word] of ISSUE_WORDS) assert.equal(found[issue(n)], word, `issue ${n}`);
  assert.equal(found[pr(99)], null, 'gh cannot show it');
  assert.equal(found['https://example.com/o/r/pull/1'], null, 'another host');
  assert.equal(found[`${pr(1)}/files`], null, 'not the plain address');
  assert.equal(await count(page), WORDS.length + ISSUE_WORDS.length, 'one badge for each link, none for the rest');
  const shape = await page.evaluate(`[...document.querySelectorAll('.link-badge')].every(b => b.tagName === 'BUTTON' && b.type === 'button' && b.classList.contains('badge') && b.dataset.variant === 'outline' && b.getAttribute('aria-expanded') === 'false' && b.getAttribute('aria-controls') === 'link-card' && !!b.querySelector('svg') && b.getAttribute('aria-label').includes(b.textContent))`);
  assert.equal(shape, true);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.link-badge')).userSelect`), 'none');
  assert.deepEqual(page.problems, []);
});

test('a link in a message the owner wrote gets no badge, and neither does a link in a code block', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page);
  assert.equal(await page.evaluate(`document.querySelectorAll('.msg.user .link-badge, pre .link-badge, .msg:not(.claude) .link-badge').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('a click on the badge opens the card with the title as text, the repo, the state, the review, the checks and the next step, and a second click closes it', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page);
  const button = badgeOf(pr(1));
  await page.click(button);
  await page.until(`!!document.querySelector('#link-card') && !document.querySelector('#link-card').hidden`);
  const card = await page.evaluate(`(c => ({
    title: c.querySelector('.link-title').textContent, repo: c.querySelector('.link-repo').textContent, state: c.querySelector('.link-state').textContent,
    facts: [...c.querySelectorAll('.link-facts dt, .link-facts dd')].map(el => el.textContent), next: c.querySelector('.link-next').textContent,
    tone: c.querySelector('.link-next').dataset.tone, role: c.getAttribute('role'), label: c.getAttribute('aria-label'), extra: c.querySelectorAll('img, b, script').length,
    weight: getComputedStyle(c.querySelector('.link-title')).fontWeight, wide: c.getBoundingClientRect().width === 20 * parseFloat(getComputedStyle(document.documentElement).fontSize), pwned: !!window.pwned,
  }))(document.querySelector('#link-card'))`);
  assert.deepEqual(card, {
    title: TITLE, repo: 'example-org/example-repo #1', state: 'Open', facts: ['Review', 'Approved', 'Checks', 'Passing'], next: 'Merge the pull request', tone: 'needs',
    role: 'dialog', label: 'Pull request example-org/example-repo #1', extra: 0, weight: '500', wide: true, pwned: false,
  });
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(button)}).getAttribute('aria-expanded')`), 'true');
  assert.equal(await count(page, '.link-card'), 1);
  const near = await page.evaluate(`(c => { const b = document.querySelector(${JSON.stringify(button)}).getBoundingClientRect(); const r = c.getBoundingClientRect(); return { above: r.bottom <= b.top, below: r.top >= b.bottom, inside: r.left >= 0 && r.right <= innerWidth }; })(document.querySelector('#link-card'))`);
  assert.equal(near.inside && (near.above || near.below), true, 'the card is above or below the badge and in the window');
  await page.click(button);
  assert.equal(await shown(page), false);
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(button)}).getAttribute('aria-expanded')`), 'false');
  assert.deepEqual(page.problems, []);
});

test('the card of an issue has no review, checks or next step, and says why a closed one was closed', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page);
  await page.click(badgeOf(issue(2)));
  await page.until(`!!document.querySelector('#link-card') && !document.querySelector('#link-card').hidden`);
  const card = await page.evaluate(`(c => ({ title: c.querySelector('.link-title').textContent, repo: c.querySelector('.link-repo').textContent, state: c.querySelector('.link-state').textContent, tone: c.querySelector('.link-state').dataset.tone, rest: c.querySelectorAll('.link-facts, .link-next').length }))(document.querySelector('#link-card'))`);
  assert.deepEqual(card, { title: 'Not planned one', repo: 'example-org/example-repo #2', state: 'Not planned', tone: 'quiet', rest: 0 });
  assert.deepEqual(page.problems, []);
});

test('Enter on the focused badge opens the card, and Escape closes it and returns the focus to the badge', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page);
  const button = badgeOf(pr(3));
  await page.evaluate(`document.querySelector(${JSON.stringify(button)}).focus()`);
  await page.press('Enter');
  await page.until(`!!document.querySelector('#link-card') && !document.querySelector('#link-card').hidden`);
  assert.equal(await page.evaluate(`document.querySelector('.link-state').textContent`), 'Merged');
  await page.press('Escape');
  await page.until(`document.querySelector('#link-card').hidden`);
  assert.equal(await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(button)})`), true);
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(button)}).getAttribute('aria-expanded')`), 'false');
  assert.deepEqual(page.problems, []);
});

test('a press outside closes the card, a press on another badge swaps it, and a resize closes it', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page);
  await page.click(badgeOf(pr(3)));
  await page.until(`!document.querySelector('#link-card')?.hidden`);
  await page.click(badgeOf(pr(4)));
  await page.until(`document.querySelector('.link-state')?.textContent === 'Draft'`);
  assert.equal(await count(page, '.link-badge[aria-expanded="true"]'), 1);
  await page.click('.dock');
  await page.until(`document.querySelector('#link-card').hidden`);
  assert.equal(await count(page, '.link-badge[aria-expanded="true"]'), 0);
  await page.click(badgeOf(pr(5)));
  await page.until(`!document.querySelector('#link-card').hidden`);
  await page.evaluate(`dispatchEvent(new Event('resize'))`);
  await page.until(`document.querySelector('#link-card').hidden`);
  assert.deepEqual(page.problems, []);
});

test('scrolling the badge out of sight closes the card', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page);
  await page.click(badgeOf(pr(3)));
  await page.until(`!document.querySelector('#link-card')?.hidden`);
  await page.evaluate(`document.querySelector('#transcript').scrollTop = 0`);
  await page.until(`document.querySelector('#link-card').hidden`);
  assert.deepEqual(page.problems, []);
});

test('the pointer over the link opens the card after the hover delay and not before, over the card keeps it, and leaving closes it after a moment', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page);
  const link = `.msg.claude a[href="${pr(4)}"]`;
  await page.hover(link);
  await nap(250);
  assert.equal(await shown(page), false, 'not yet');
  await page.until(`!document.querySelector('#link-card')?.hidden`, 3000);
  assert.equal(await page.evaluate(`document.querySelector('.link-state').textContent`), 'Draft');
  await page.hover('#link-card');
  await nap(600);
  assert.equal(await shown(page), true, 'the pointer is on the card');
  await page.hover('.dock');
  await nap(100);
  assert.equal(await shown(page), true, 'not at once');
  await page.until(`document.querySelector('#link-card').hidden`, 3000);
  await page.hover(badgeOf(pr(5)));
  await page.until(`!document.querySelector('#link-card')?.hidden && document.querySelector('.link-state').textContent === 'Closed'`, 3000);
  assert.deepEqual(page.problems, []);
});

test('on a phone a tap on the badge opens the card inside the screen, and a tap outside closes it', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat', { phone: true });
  await withBadges(page);
  assert.equal(await page.evaluate(`matchMedia('(hover: hover)').matches`), false);
  await page.tap(badgeOf(pr(3)));
  await page.until(`!document.querySelector('#link-card')?.hidden`);
  const box = await page.evaluate(`(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight }))(document.querySelector('#link-card').getBoundingClientRect())`);
  assert.equal(box.left >= 0 && box.right <= box.width && box.top >= 0 && box.bottom <= box.height, true, JSON.stringify(box));
  await page.tap('.dock');
  await page.until(`document.querySelector('#link-card').hidden`);
  assert.deepEqual(page.problems, []);
});

test('a reply drawn again gets its badges back, one for each link', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page);
  await page.evaluate(`(li => { const copy = li.cloneNode(true); copy.querySelectorAll('.link-badge').forEach(b => b.remove()); li.innerHTML = copy.innerHTML; })([...document.querySelectorAll('li.msg.claude')].at(-1))`);
  await page.until(`document.querySelectorAll('.link-badge').length === ${WORDS.length + ISSUE_WORDS.length}`);
  await nap(300);
  assert.equal(await count(page), WORDS.length + ISSUE_WORDS.length);
  const found = await badges(page);
  assert.equal(found[pr(1)], 'Open');
  assert.equal(found[issue(7)], 'Closed');
  assert.deepEqual(page.problems, []);
});

test('the badge is not in a quote of the reply', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/chat');
  await withBadges(page);
  await page.evaluate(`(li => { const range = document.createRange(); range.selectNodeContents(li); getSelection().removeAllRanges(); getSelection().addRange(range); })([...document.querySelectorAll('li.msg.claude')].at(-1))`);
  await page.until(`!!document.querySelector('.quote-pick')`, 5000);
  await page.click('.quote-pick');
  await page.until(`!!document.querySelector('.quote-text')`);
  const quoted = await page.evaluate(`document.querySelector('.quote-text').textContent`);
  assert.match(quoted, /the first pull request/);
  assert.doesNotMatch(quoted, /\b(Open|Merged|Draft|Not planned)\b/);
  assert.deepEqual(page.problems, []);
});

test('a server that cannot say draws no badge and is never asked', { skip, timeout }, async t => {
  const old = await through(app, { leave: true });
  const page = await appPage(t, '#/s/old', { origin: old.origin });
  await nap(1500);
  assert.equal(await count(page), 0);
  assert.deepEqual(old.links(), []);
  assert.equal(await page.evaluate(`document.querySelectorAll('.msg.claude a').length`), 2, 'the links themselves are there');
  assert.deepEqual(page.problems, []);
  const current = await through(app);
  const control = await appPage(t, '#/s/shy', { origin: current.origin });
  await control.until(`document.querySelectorAll('.link-badge').length === 2`, 15_000);
  assert.equal(current.links().length > 0, true, 'the same proxy does see a request when the server can say');
  assert.deepEqual(control.problems, []);
});
