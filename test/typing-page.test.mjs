// Run with `npm test`. The typing ping in the real page against the real server: sent from a group's prompt box while it has text and at most every
// 10 seconds, and not sent from another chat, with an empty box, or to a server that does not say it takes it. It needs Playwright's Chromium
// headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const SESSIONS = [
  { id: 'member', title: 'Member', group: 'cg-work', ago: 6 },
  { id: 'loose', title: 'Loose', ago: 9 },
  { id: WORK, title: 'Talk about the work', source: 'cli', ago: 1, group: 'cg-work' },
];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let older;
let spy;
let browser;

// The server behind a proxy that logs the requests it passes on. `leave` names the features of the list it leaves out, as a server that started
// before they existed does.
function through(target, { leave = [] } = {}) {
  const seen = [];
  const proxy = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      if (req.url.split('?')[0] !== '/api/sessions' || !leave.length) {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        const { features, ...index } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        for (const name of leave) delete features[name];
        const body = Buffer.from(JSON.stringify({ ...index, features }));
        res.writeHead(reply.statusCode, { ...reply.headers, 'content-length': body.length });
        res.end(body);
      });
    });
    req.pipe(forward);
  });
  return new Promise(resolve => proxy.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${proxy.address().port}`,
    pings: () => seen.filter(line => line.startsWith('POST') && line.endsWith('/typing')),
    close: () => new Promise(done => { proxy.closeAllConnections(); proxy.close(done); }),
  })));
}

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  older = await through(app, { leave: ['groupUpdates'] });
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

async function appPage(t, origin, hash) {
  const page = await browser.open(`${origin}/`);
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
  await page.until(`!!document.querySelector('#text')`);
  return page;
}

const type = async (page, text) => {
  await page.click('#text');
  await page.insert(text);
  await new Promise(resolve => setTimeout(resolve, 400));
};

test('a group\'s prompt box sends the typing ping when it has text, and then at most once in 10 seconds', { skip, timeout }, async t => {
  const page = await appPage(t, spy.origin, '#/g/cg-work');
  const before = spy.pings().length;
  await type(page, '');
  assert.equal(spy.pings().length, before, 'an empty box sends none');
  await type(page, 'hello');
  assert.deepEqual(spy.pings().slice(before), [`POST /api/sessions/${WORK}/typing`]);
  await type(page, ' and more');
  await type(page, ' and more');
  assert.equal(spy.pings().length, before + 1, 'typing on within the 10 seconds sends no more');
  assert.deepEqual(page.problems, []);
});

test('another chat\'s prompt box sends none, and neither does a page against a server that does not say it takes the ping', { skip, timeout }, async t => {
  const other = await appPage(t, spy.origin, '#/s/loose');
  const before = spy.pings().length;
  await type(other, 'hello');
  assert.equal(spy.pings().length, before);
  const old = await appPage(t, older.origin, '#/g/cg-work');
  await type(old, 'hello');
  assert.deepEqual(older.pings(), []);
  assert.deepEqual(old.problems, []);
});
