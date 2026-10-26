// Run with `npm test`. A group's menu in the real page: Move up, Move down and Delete group beside the moves between projects, what is
// left out at either end of a view, the question before a delete, where the focus goes, and the menu an older server gets. It needs
// Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, PASSWORD, request, signIn, start } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const GROUPS = [
  { id: 'cg-a', name: 'Reviewing' },
  { id: 'cg-b', name: 'Backlog', session: WORK },
  { id: 'cg-c', name: 'Notes' },
  { id: 'cg-p1', name: 'Inside one', project: 'cp-x' },
  { id: 'cg-p2', name: 'Inside two', project: 'cp-x' },
];
const SESSIONS = [
  { id: 's1', title: 'In reviewing', group: 'cg-a', ago: 1 },
  { id: 's2', title: 'In backlog', group: 'cg-b', ago: 2 },
  { id: 's3', title: 'Loose', ago: 3 },
];
const PROJECTS = { projects: [{ id: 'cp-x', name: 'Capcom' }] };
const SEPARATOR = '-';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let lone;
let older;
let noRename;
let olderLone;
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

const furnished = mac => start({ sessions: SESSIONS, groups: GROUPS, layout: PROJECTS, claude: true, ...mac });

before(async () => {
  if (skip) return;
  app = await furnished();
  lone = await start({ groups: [{ id: 'cg-only', name: 'Only' }] });
  older = await without(app, 'groupEdits');
  olderLone = await without(lone, 'groupEdits');
  noRename = await without(app, 'groupRename');
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
  await olderLone?.close();
  await noRename?.close();
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

// A page signed in to the server at `origin`, with the view chosen as the browser keeps it, so a test starts in Home unless it asks for
// a project.
async function appPage(t, origin, { view = null, phone = false, hash = '' } = {}) {
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'collapsed'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', ${JSON.stringify(JSON.stringify(view))})`);
  await setter.close();
  const page = await browser.open(`${origin}/${hash}`, { phone });
  t.after(() => page.close());
  await login(page);
  if (hash && (await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  return page;
}

const names = page => page.evaluate(`[...document.querySelectorAll('${GROUP_HEADS} .name')].map(el => el.textContent)`);
const head = name => `[...document.querySelectorAll('${GROUP_HEADS}')].find(el => el.querySelector('.name').textContent === ${JSON.stringify(name)})`;
const hasMenu = page => page.evaluate(`!!document.querySelector('${MENU}')`);
const gone = page => page.until(`!document.querySelector('.menu')`);

// The right click on a group's header, as the page hears it.
async function rightClick(page, name) {
  await page.until(`!!${head(name)}`);
  await page.evaluate(`(bar => { const r = bar.getBoundingClientRect(); bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 40, clientY: r.y + r.height / 2 })); })(${head(name)}.closest('.bar'))`);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
}

// The open menu as a list of what it holds: the label of each item, and a dash for each separator.
const menuOf = page => page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem], ${MENU} > [role=separator]')].map(el => (el.getAttribute('role') === 'separator' ? '${SEPARATOR}' : el.querySelector('.menu-text').textContent))`);
const menuLabel = page => page.evaluate(`document.querySelector('${MENU}').getAttribute('aria-label')`);

// Every item in the menu has an icon, so the labels line up whichever ones are shown.
const bareItems = page => page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem]')].filter(el => !el.querySelector(':scope > svg')).map(el => el.textContent)`);

async function choose(page, label) {
  await page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem]')].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '')`);
  await page.click(`${MENU} [data-picked]`);
}

// What the menu of each group shows, one after another.
async function menusOf(page, ...groups) {
  const seen = {};
  for (const name of groups) {
    await rightClick(page, name);
    seen[name] = { label: await menuLabel(page), items: await menuOf(page), bare: await bareItems(page) };
    await page.press('Escape');
    await gone(page);
  }
  return seen;
}

const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));

test('a server that can edit groups gives each group in Home Move up and Move down, left off at either end, then its moves to a project, then Delete group, a separator between each part', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  assert.deepEqual(await names(page), ['Reviewing', 'Backlog', 'Notes']);
  assert.deepEqual(await menusOf(page, 'Reviewing', 'Backlog', 'Notes'), {
    Reviewing: { label: 'Actions for Reviewing', items: ['Rename', SEPARATOR, 'New session', SEPARATOR, 'Move down', SEPARATOR, 'Move to Capcom', SEPARATOR, 'Delete group'], bare: [] },
    Backlog: { label: 'Actions for Backlog', items: ['Rename', SEPARATOR, 'New session', SEPARATOR, 'Move up', 'Move down', SEPARATOR, 'Move to Capcom', SEPARATOR, 'Delete group'], bare: [] },
    Notes: { label: 'Actions for Notes', items: ['Rename', SEPARATOR, 'New session', SEPARATOR, 'Move up', SEPARATOR, 'Move to Capcom', SEPARATOR, 'Delete group'], bare: [] },
  });
  assert.deepEqual(page.problems, []);
});

test('the button at the end of the header opens the same menu, and Delete group is drawn as a destructive item', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  assert.equal(await page.evaluate(`${head('Backlog')}.closest('.bar').querySelector('.more').getAttribute('aria-label')`), 'Actions for Backlog');
  await page.evaluate(`${head('Backlog')}.closest('.bar').querySelector('.more').setAttribute('data-picked', '')`);
  await page.click('.more[data-picked]');
  await page.until(`!!document.querySelector('${MENU}')`);
  assert.deepEqual(await menuOf(page), ['Rename', SEPARATOR, 'New session', SEPARATOR, 'Move up', 'Move down', SEPARATOR, 'Move to Capcom', SEPARATOR, 'Delete group']);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('${MENU} [role=menuitem]')].map(el => el.dataset.variant ?? '').join()`), ',,,,,destructive');
  assert.deepEqual(page.problems, []);
});

test('in a project, the groups are ordered among those of the project, and the moves are to Home', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { view: 'cp-x' });
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 2`);
  assert.deepEqual(await names(page), ['Inside one', 'Inside two']);
  assert.deepEqual(await menusOf(page, 'Inside one', 'Inside two'), {
    'Inside one': { label: 'Actions for Inside one', items: ['Rename', SEPARATOR, 'New session', SEPARATOR, 'Move down', SEPARATOR, 'Move to Home', SEPARATOR, 'Delete group'], bare: [] },
    'Inside two': { label: 'Actions for Inside two', items: ['Rename', SEPARATOR, 'New session', SEPARATOR, 'Move up', SEPARATOR, 'Move to Home', SEPARATOR, 'Delete group'], bare: [] },
  });
});

test('a group alone in its view with nowhere to move to has a menu of Rename, New session and Delete group', { skip, timeout }, async t => {
  const page = await appPage(t, lone.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 1`);
  assert.deepEqual(await menusOf(page, 'Only'), { Only: { label: 'Actions for Only', items: ['Rename', SEPARATOR, 'New session', SEPARATOR, 'Delete group'], bare: [] } });
});

test('a server that does not say it can edit groups gets the menu it had, which is only the moves to a project, and no menu for a group with none', { skip, timeout }, async t => {
  const page = await appPage(t, older.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  assert.deepEqual(await menusOf(page, 'Reviewing', 'Backlog', 'Notes'), {
    Reviewing: { label: 'Move Reviewing', items: ['Move to Capcom'], bare: ['Move to Capcom'] },
    Backlog: { label: 'Move Backlog', items: ['Move to Capcom'], bare: ['Move to Capcom'] },
    Notes: { label: 'Move Notes', items: ['Move to Capcom'], bare: ['Move to Capcom'] },
  });
  assert.equal(await page.evaluate(`document.querySelectorAll('.bar.has-menu').length`), 3);

  const alone = await appPage(t, olderLone.origin);
  await alone.until(`document.querySelectorAll('${GROUP_HEADS}').length === 1`);
  assert.equal(await alone.evaluate(`document.querySelectorAll('.bar.has-menu, .bar > button.more').length`), 0, 'no button');
  await alone.evaluate(`document.querySelector('.bar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))`);
  await new Promise(done => setTimeout(done, 200));
  assert.equal(await hasMenu(alone), false, 'and no menu on a right click');
  assert.deepEqual([...page.problems, ...alone.problems], []);
});

test('a server that can edit groups but does not say it can rename them gets the menu without Rename', { skip, timeout }, async t => {
  const page = await appPage(t, noRename.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  assert.deepEqual((await menusOf(page, 'Reviewing')).Reviewing.items, ['New session', SEPARATOR, 'Move down', SEPARATOR, 'Move to Capcom', SEPARATOR, 'Delete group']);
  assert.deepEqual(page.problems, []);
});

test('Rename puts a box with the name in place of the header, and Enter saves it everywhere the name shows, Esc keeps the old one', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  await rightClick(page, 'Backlog');
  await choose(page, 'Rename');
  await page.until(`document.activeElement.matches('.bar > .name-form .input')`);
  assert.deepEqual(await page.evaluate(`[document.activeElement.getAttribute('aria-label'), document.activeElement.value, document.activeElement.maxLength, document.querySelectorAll('.bar[data-handle="cg-b"]').length, getComputedStyle(document.activeElement).userSelect]`), ['Rename group', 'Backlog', 80, 0, 'text']);
  await page.press('Escape');
  await page.until(`!document.querySelector('.name-form')`);
  await page.until(`${FOCUSED} === 'Backlog'`);
  assert.equal(onDisk(s).groups[1].name, 'Backlog');

  await rightClick(page, 'Backlog');
  await choose(page, 'Rename');
  await page.until(`document.activeElement.matches('.bar > .name-form .input')`);
  await page.evaluate(`(input => { input.value = 'Open tasks'; input.dispatchEvent(new Event('input', { bubbles: true })); })(document.activeElement)`);
  await page.press('Enter');
  await page.until(`!document.querySelector('.name-form')`);
  assert.deepEqual(await names(page), ['Reviewing', 'Open tasks', 'Notes']);
  await page.until(`${FOCUSED} === 'Open tasks'`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.bar[data-handle="cg-b"]').length`), 1, 'it can be carried again');
  assert.equal(onDisk(s).groups[1].name, 'Open tasks');
  assert.equal(await page.evaluate(`${head('Open tasks')}.closest('.bar').querySelector('.more').getAttribute('aria-label')`), 'Actions for Open tasks');
  assert.deepEqual(page.problems, []);
});

test('a name the server refuses keeps the box open and the old name', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  await rightClick(page, 'Notes');
  await choose(page, 'Rename');
  await page.until(`document.activeElement.matches('.bar > .name-form .input')`);
  await page.evaluate(`(input => { input.removeAttribute('maxlength'); input.value = 'x'.repeat(81); input.dispatchEvent(new Event('input', { bubbles: true })); })(document.activeElement)`);
  await page.press('Enter');
  await page.until(`/80 characters/.test(document.body.textContent)`);
  assert.equal(await page.evaluate(`!!document.querySelector('.bar > .name-form')`), true);
  assert.equal(onDisk(s).groups[2].name, 'Notes');
  assert.deepEqual(page.problems.filter(p => !/400/.test(p)), []);
});

const startRename = async (page, name) => {
  await rightClick(page, name);
  await choose(page, 'Rename');
  await page.until(`document.activeElement.matches('.bar > .name-form .input')`);
};
const typeName = (page, value) => page.evaluate(`(input => { input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })(document.activeElement)`);

test('clicking away from the rename box saves the name, with the focus left where the click put it', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  await startRename(page, 'Notes');
  await typeName(page, 'Scratch');
  await page.evaluate(`document.querySelector('.btn.add').focus()`);
  await page.until(`!document.querySelector('.name-form')`);
  assert.deepEqual(await names(page), ['Reviewing', 'Backlog', 'Scratch']);
  assert.equal(onDisk(s).groups[2].name, 'Scratch');
  assert.equal(await page.evaluate(`document.activeElement.classList.contains('add')`), true);
  assert.deepEqual(page.problems, []);
});

test('the rename box closes when its group is gone after a reload, and when the view changes', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  await startRename(page, 'Notes');
  const gone = await request(s, 'POST', '/api/layout/group/remove', { headers: as((await signIn(s)).token), json: { id: 'cg-c' } });
  assert.equal(gone.status, 200);
  await page.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 2 && !document.querySelector('.name-form')`);

  await startRename(page, 'Backlog');
  await page.evaluate(`location.hash = '#/g/cg-p1'`);
  await page.until(`!document.querySelector('.name-form')`);
  assert.deepEqual(await names(page), ['Inside one', 'Inside two']);
  assert.deepEqual(page.problems, []);
});

test('on a phone the button is there to touch without a hover, and opens the menu', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { phone: true });
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  assert.equal(await page.evaluate(`matchMedia('(hover: none)').matches && matchMedia('(pointer: coarse)').matches`), true);
  const buttons = await page.evaluate(`[...document.querySelectorAll('.bar > button.more')].map(el => { const r = el.getBoundingClientRect(); return [getComputedStyle(el).opacity, r.width > 0 && r.height > 0 && r.right <= innerWidth && getComputedStyle(el, '::after').content !== 'none']; })`);
  assert.deepEqual(buttons, [['1', true], ['1', true], ['1', true]]);
  await page.evaluate(`${head('Notes')}.closest('.bar').querySelector('.more').setAttribute('data-picked', '')`);
  await page.click('.more[data-picked]');
  await page.until(`!!document.querySelector('${MENU}')`);
  assert.deepEqual(await menuOf(page), ['Rename', SEPARATOR, 'New session', SEPARATOR, 'Move up', SEPARATOR, 'Move to Capcom', SEPARATOR, 'Delete group']);
  assert.deepEqual(page.problems, []);
});

test('Move down puts the group below the next one and the focus stays on its header, then Move up puts it back, each with a note', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  await rightClick(page, 'Reviewing');
  await choose(page, 'Move down');
  await page.until(`document.querySelector('${GROUP_HEADS} .name').textContent === 'Backlog'`);
  assert.deepEqual(await names(page), ['Backlog', 'Reviewing', 'Notes']);
  await page.until(`${FOCUSED} === 'Reviewing'`);
  await page.until(`document.querySelector('[data-sonner-toast] [data-title]')?.textContent === 'Moved “Reviewing” down.'`);
  assert.deepEqual(onDisk(s).groups.map(g => g.id), ['cg-b', 'cg-a', 'cg-c', 'cg-p1', 'cg-p2']);

  await rightClick(page, 'Reviewing');
  assert.deepEqual(await menuOf(page), ['Rename', SEPARATOR, 'New session', SEPARATOR, 'Move up', 'Move down', SEPARATOR, 'Move to Capcom', SEPARATOR, 'Delete group']);
  await choose(page, 'Move up');
  await page.until(`document.querySelector('${GROUP_HEADS} .name').textContent === 'Reviewing'`);
  assert.deepEqual(await names(page), ['Reviewing', 'Backlog', 'Notes']);
  await page.until(`${FOCUSED} === 'Reviewing'`);
  await page.until(`document.querySelector('[data-sonner-toast] [data-title]')?.textContent === 'Moved “Reviewing” up.'`);
  assert.deepEqual(onDisk(s).groups.map(g => g.id), ['cg-a', 'cg-b', 'cg-c', 'cg-p1', 'cg-p2']);
  assert.deepEqual(page.problems, []);
});

const CHIP = '.start-group';
const typeInto = (page, value) => page.evaluate(`(box => { box.value = ${JSON.stringify(value)}; box.dispatchEvent(new Event('input', { bubbles: true })); })(document.querySelector('#text'))`);

test('New session opens the new session page with the group chosen, shown in a chip that clears it and keeps the typed text', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  await rightClick(page, 'Reviewing');
  await choose(page, 'New session');
  await page.until(`location.hash === '#/new/cg-a' && !!document.querySelector('${CHIP}')`);
  assert.equal(await text(page, `${CHIP} .name`), 'Reviewing');
  assert.equal(await page.evaluate(`document.querySelector('${CHIP} button').getAttribute('aria-label')`), 'Start outside Reviewing');
  await gone(page);
  await typeInto(page, 'half a thought');
  await page.click(`${CHIP} button`);
  await page.until(`location.hash === '#/new' && !document.querySelector('${CHIP}')`);
  assert.equal(await page.evaluate(`document.querySelector('#text').value`), 'half a thought');
  assert.equal(await page.evaluate(`document.activeElement.id`), 'text');
  assert.deepEqual(page.problems, []);
});

test('the + menu and its New session start outside any group, and an address naming no group the owner made shows no chip', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/new/cg-a' });
  await page.until(`!!document.querySelector('${CHIP}')`);
  await page.evaluate(`document.querySelector('.add').setAttribute('data-picked', '')`);
  await page.click('.add[data-picked]');
  await page.until(`!!document.querySelector('${MENU}')`);
  await choose(page, 'New session');
  await page.until(`location.hash === '#/new' && !document.querySelector('${CHIP}')`);
  for (const hash of ['#/new/pinned', '#/new/cg-gone']) {
    await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
    await page.until(`document.querySelector('#title')?.textContent === 'New session'`);
    await new Promise(done => setTimeout(done, 300));
    assert.equal(await page.evaluate(`!!document.querySelector('${CHIP}')`), false, hash);
  }
  assert.deepEqual(page.problems, []);
});

test('choosing New session while a new session page is open moves the focus to its message box', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/new' });
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3 && !!document.querySelector('#text')`);
  await rightClick(page, 'Notes');
  await choose(page, 'New session');
  await page.until(`location.hash === '#/new/cg-c' && !!document.querySelector('${CHIP}')`);
  await page.until(`document.activeElement.id === 'text'`);
  await page.evaluate(`document.querySelector('${CHIP} button').focus()`);
  await rightClick(page, 'Reviewing');
  await choose(page, 'New session');
  await page.until(`location.hash === '#/new/cg-a' && document.activeElement.id === 'text'`);
  assert.deepEqual(page.problems, []);
});

test('a first message sent after the chip is cleared places the session in no group', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin, { hash: '#/new/cg-c' });
  await page.until(`!!document.querySelector('${CHIP}')`);
  await page.click(`${CHIP} button`);
  await page.until(`location.hash === '#/new' && !document.querySelector('${CHIP}')`);
  await typeInto(page, 'begin a session');
  await page.click('#send');
  await page.until(`location.hash === '#/s/begun-by-the-fake'`);
  assert.equal(onDisk(s).assignments['begun-by-the-fake'], undefined);
  assert.deepEqual(page.problems, []);
});

test('on a phone New session from the menu closes it and shows the new session page, with the chip big enough to touch', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { phone: true });
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  await page.evaluate(`${head('Notes')}.closest('.bar').querySelector('.more').setAttribute('data-picked', '')`);
  await page.click('.more[data-picked]');
  await page.until(`!!document.querySelector('${MENU}')`);
  await choose(page, 'New session');
  await gone(page);
  await page.until(`location.hash === '#/new/cg-c' && !!document.querySelector('${CHIP}')`);
  const box = await page.evaluate(`(r => [r.width, r.height, r.right <= innerWidth])(document.querySelector('${CHIP} button').getBoundingClientRect())`);
  assert.deepEqual(box, [32, 32, true]);
  assert.deepEqual(page.problems, []);
});

test('the first message from a new session started in a group puts the session in that group', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin, { hash: '#/new/cg-c' });
  await page.until(`!!document.querySelector('${CHIP}')`);
  await typeInto(page, 'begin a session');
  await page.click('#send');
  await page.until(`location.hash.startsWith('#/s/')`);
  assert.equal(await page.evaluate('location.hash'), '#/s/begun-by-the-fake');
  assert.equal(onDisk(s).assignments['begun-by-the-fake'], 'cg-c');
  assert.deepEqual(page.problems, []);
});

test('moving a group in a project orders it among the project\'s groups and leaves the groups in Home as they are', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin, { view: 'cp-x' });
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 2`);
  await rightClick(page, 'Inside two');
  await choose(page, 'Move up');
  await page.until(`document.querySelector('${GROUP_HEADS} .name').textContent === 'Inside two'`);
  assert.deepEqual(await names(page), ['Inside two', 'Inside one']);
  assert.deepEqual(onDisk(s).groups.map(g => g.id), ['cg-a', 'cg-b', 'cg-c', 'cg-p2', 'cg-p1']);
  assert.deepEqual(page.problems, []);
});

test('Delete group asks first, says where its sessions and its chat go, has Cancel focused, and Cancel keeps the group and the focus on its header', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  await rightClick(page, 'Backlog');
  await choose(page, 'Delete group');
  await page.until(`!!document.querySelector('[data-slot="alert-dialog-content"]')`);
  assert.equal(await text(page, '#ask-title'), 'Delete group “Backlog”?');
  assert.equal(await text(page, '#ask-detail'), '1 session becomes ungrouped. Its chat is hidden, and its transcript is kept. No session is deleted.');
  assert.equal(await page.evaluate(`document.activeElement.textContent`), 'Cancel');
  assert.equal(await text(page, '[data-slot="alert-dialog-action"]'), 'Delete group');
  await page.click('[data-slot="alert-dialog-cancel"]');
  await page.until(`!document.querySelector('[data-slot="alert-dialog-content"]')`);
  await page.until(`${FOCUSED} === 'Backlog'`);
  assert.deepEqual(await names(page), ['Reviewing', 'Backlog', 'Notes']);
  assert.deepEqual(onDisk(s).groups.map(g => g.id), ['cg-a', 'cg-b', 'cg-c', 'cg-p1', 'cg-p2']);

  await rightClick(page, 'Notes');
  await choose(page, 'Delete group');
  await page.until(`!!document.querySelector('[data-slot="alert-dialog-content"]')`);
  assert.equal(await text(page, '#ask-detail'), 'It has no sessions.');
  await page.press('Escape');
  await page.until(`!document.querySelector('[data-slot="alert-dialog-content"]')`);
  assert.deepEqual(await names(page), ['Reviewing', 'Backlog', 'Notes']);
  assert.deepEqual(page.problems, []);
});

test('confirming Delete group removes the group, ungroups its sessions, says so in a note, and puts the focus on the header beside it', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 3`);
  await rightClick(page, 'Backlog');
  await choose(page, 'Delete group');
  await page.until(`!!document.querySelector('[data-slot="alert-dialog-content"]')`);
  await page.click('[data-slot="alert-dialog-action"]');
  await page.until(`document.querySelectorAll('${GROUP_HEADS} .name').length === 2 && !document.querySelector('[data-slot="alert-dialog-content"]')`);
  assert.deepEqual(await names(page), ['Reviewing', 'Notes']);
  await page.until(`${FOCUSED} === 'Notes'`);
  await page.until(`document.querySelector('[data-sonner-toast] [data-title]')?.textContent === 'Deleted “Backlog”.'`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('a.row .row-title')].map(el => el.textContent)`), ['In reviewing', 'In backlog', 'Loose']);
  assert.equal(await page.evaluate(`document.querySelector('.group-head[data-key="ungrouped"] .name')?.textContent`), 'Ungrouped');
  const layout = onDisk(s);
  assert.deepEqual(layout.groups.map(g => g.id), ['cg-a', 'cg-c', 'cg-p1', 'cg-p2']);
  assert.deepEqual(layout.assignments, { s1: 'cg-a' });
  assert.deepEqual(layout.retired, [{ id: 'cg-b', name: 'Backlog', session: WORK }], 'its chat is kept as a deleted group\'s');
  assert.deepEqual(layout.archived, {}, 'and is not archived');
  assert.deepEqual(page.problems, []);
});

test('deleting the last group of a view puts the focus on the + button', { skip, timeout }, async t => {
  const s = await start({ groups: [{ id: 'cg-only', name: 'Only' }] });
  const page = await appPage(t, s.origin);
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 1`);
  await rightClick(page, 'Only');
  await choose(page, 'Delete group');
  await page.until(`!!document.querySelector('[data-slot="alert-dialog-content"]')`);
  await page.click('[data-slot="alert-dialog-action"]');
  await page.until(`document.querySelectorAll('${GROUP_HEADS}').length === 0`);
  await page.until(`document.activeElement.classList.contains('add')`);
  assert.deepEqual(page.problems, []);
});

test('deleting a group whose chat is open leaves the chat for the list, and a group whose chat is not open leaves the page where it is', { skip, timeout }, async t => {
  const s = await furnished();
  const page = await appPage(t, s.origin, { hash: '#/g/cg-b' });
  await page.until(`location.hash === '#/g/cg-b' && !!document.querySelector('.subs')`);
  await rightClick(page, 'Notes');
  await choose(page, 'Delete group');
  await page.until(`!!document.querySelector('[data-slot="alert-dialog-content"]')`);
  await page.click('[data-slot="alert-dialog-action"]');
  await page.until(`document.querySelectorAll('${GROUP_HEADS} .name').length === 2`);
  assert.equal(await page.evaluate('location.hash'), '#/g/cg-b', 'another group\'s chat stays open');

  await rightClick(page, 'Backlog');
  await choose(page, 'Delete group');
  await page.until(`!!document.querySelector('[data-slot="alert-dialog-content"]')`);
  await page.click('[data-slot="alert-dialog-action"]');
  await page.until(`document.querySelectorAll('${GROUP_HEADS} .name').length === 1`);
  await page.until(`location.hash === '#/' && !document.querySelector('.subs')`);
  assert.deepEqual(await names(page), ['Reviewing']);
  await page.until(`${FOCUSED} === 'Reviewing'`);
  assert.deepEqual(page.problems, []);
});
