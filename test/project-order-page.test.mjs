// Run with `npm test`. A project in the projects sidebar in the real page: Move up and Move down on its menu, the toast and the saved order,
// a drag with the drop line, a plain click that still opens it, and the sidebar an older server gets. It needs Playwright's Chromium headless
// shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const PROJECTS = { projects: [{ id: 'cp-a', name: 'Alpha' }, { id: 'cp-b', name: 'Beta' }, { id: 'cp-c', name: 'Gamma' }] };
const GROUPS = [{ id: 'cg-a', name: 'Reviewing', project: 'cp-a' }, { id: 'cg-b', name: 'Backlog' }];
const SESSIONS = [{ id: 's1', title: 'In reviewing', group: 'cg-a', ago: 1 }];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let browser;

before(async () => {
  if (!skip) browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const MENU = `.menu:not([data-sub])`;
const scope = id => `.scope[data-key="${id}"]`;
const NAMES = `[...document.querySelectorAll('.scopes .scope[data-project] .scope-name')].map(el => el.textContent)`;

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

async function appPage(t, { phone = false, leave = null } = {}) {
  const server = await start({ sessions: SESSIONS, groups: GROUPS, layout: PROJECTS });
  const older = leave && await without(server, leave);
  if (older) t.after(() => older.close());
  const origin = older?.origin ?? server.origin;
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`localStorage.setItem('capcom.projectsDocked', '${!phone}'); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  const page = await browser.open(`${origin}/`, { phone });
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || (${LIST}))`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
  }
  if (phone) await page.click('.list-head [aria-label="Projects"]');
  await page.until(`document.querySelectorAll('.scope[data-key^="cp-"]').length === 3`);
  if (phone) await page.until(`document.querySelector('.scope[data-key^="cp-"]').getBoundingClientRect().left >= 0`);
  return { page, server };
}

const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8')).projects.map(p => p.name);
const menuOf = page => page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem]')].map(el => el.querySelector('.menu-text').textContent)`);

async function openMenu(page, id) {
  await page.evaluate(`document.querySelectorAll('[data-picked]').forEach(el => el.removeAttribute('data-picked')); document.querySelector('${scope(id)}').closest('li').querySelector('.more').setAttribute('data-picked', '')`);
  await page.click('.more[data-picked]');
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
}

async function choose(page, label) {
  await page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem]')].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '')`);
  await page.click(`${MENU} [data-picked]`);
}

test('a project menu offers Move up and Move down, left off at either end, and Move down saves the order, says so and keeps the focus', { skip, timeout }, async t => {
  const { page, server } = await appPage(t);
  const menus = {};
  for (const id of ['cp-a', 'cp-b', 'cp-c']) {
    await openMenu(page, id);
    menus[id] = (await menuOf(page)).filter(label => label.startsWith('Move'));
    await page.press('Escape');
    await page.until(`!document.querySelector('.menu')`);
  }
  assert.deepEqual(menus, { 'cp-a': ['Move down'], 'cp-b': ['Move up', 'Move down'], 'cp-c': ['Move up'] });
  await openMenu(page, 'cp-a');
  await choose(page, 'Move down');
  await page.until(`${NAMES}.join() === 'Beta,Alpha,Gamma'`);
  assert.deepEqual(onDisk(server), ['Beta', 'Alpha', 'Gamma']);
  assert.equal(await page.evaluate(`document.querySelector('[data-sonner-toast]').textContent`), 'Moved “Alpha” down.');
  assert.equal(await page.evaluate(`document.activeElement.closest('.scope')?.dataset.project`), 'cp-a');
  assert.deepEqual(page.problems, []);
});

test('a project carried to the bottom of the sidebar draws the line under the last one and the drop saves that order', { skip, timeout }, async t => {
  const { page, server } = await appPage(t);
  const release = await page.carry(scope('cp-a'), `(r => ({ x: r.x + r.width / 2, y: r.bottom - 2 }))(document.querySelector('${scope('cp-c')}').getBoundingClientRect())`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.scope.lifted').length`), 1);
  assert.equal(await page.evaluate(`document.querySelector('.scopes > li[data-line]')?.dataset.line + ':' + document.querySelector('.scopes > li[data-line] .scope-name').textContent`), 'after:Gamma');
  await release();
  await page.until(`${NAMES}.join() === 'Beta,Gamma,Alpha'`);
  assert.deepEqual(onDisk(server), ['Beta', 'Gamma', 'Alpha']);
  assert.equal(await page.evaluate(`document.querySelector('[data-sonner-toast]').textContent`), 'Moved “Alpha” below “Gamma”.');
  assert.deepEqual(page.problems, []);
});

test('a click on a project still opens it, and a project let go where it was changes nothing', { skip, timeout }, async t => {
  const { page, server } = await appPage(t);
  await page.click(scope('cp-b'));
  await page.until(`document.querySelector('${scope('cp-b')}').getAttribute('aria-current') !== null || localStorage.getItem('capcom.scope') === '"cp-b"'`);
  const release = await page.carry(scope('cp-b'), `(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 + 2 }))(document.querySelector('${scope('cp-b')}').getBoundingClientRect())`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.scopes > li[data-line]').length`), 0);
  await release();
  assert.deepEqual(onDisk(server), ['Alpha', 'Beta', 'Gamma']);
  assert.equal(await page.evaluate(`document.querySelector('[data-sonner-toast]')?.textContent ?? null`), null);
});

test('on a phone the sheet gives the same menu, and Move up saves the order', { skip, timeout }, async t => {
  const { page, server } = await appPage(t, { phone: true });
  await openMenu(page, 'cp-c');
  assert.deepEqual((await menuOf(page)).filter(label => label.startsWith('Move')), ['Move up']);
  await choose(page, 'Move up');
  await page.until(`${NAMES}.join() === 'Alpha,Gamma,Beta'`);
  assert.deepEqual(onDisk(server), ['Alpha', 'Gamma', 'Beta']);
});

test('a server that does not say it can order projects gets a project menu without the moves, and nothing to drag', { skip, timeout }, async t => {
  const { page } = await appPage(t, { leave: 'projectOrder' });
  await openMenu(page, 'cp-b');
  assert.deepEqual((await menuOf(page)).filter(label => label.startsWith('Move')), []);
  await page.press('Escape');
  assert.equal(await page.evaluate(`document.querySelectorAll('.scope[data-project]').length`), 0);
});
