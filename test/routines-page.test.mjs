// Run with `npm test`. The Routines page in the real browser: the list and its switch, the form with its live schedule preview, its
// choice of GhostShell's own text or a prompt file and its per-field problems, the delete question, the menu of a routine's row in Home,
// the routines that have no run in Home, the footer link, Ctrl+K, and what a server without routine edits or routine files gets. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, restart, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
const SEPARATOR = '-';
const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const MENU = `.menu:not([data-sub])`;
const DIALOG = `[data-slot="alert-dialog-content"]`;
let app;
let older;
let plain;
let lonely;
let named;
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

// A server with two routines in routines.json: one whose prompt is a file elsewhere on the Mac, off, and one of GhostShell's own text, on
// and with a session in Home. The prompt files are in the temporary home.
async function furnished() {
  const first = await start({ sessions: [{ id: 'r1', title: 'Morning run', routine: 'alpha', ago: 5 }], claude: true });
  const work = path.join(first.home, 'work');
  const prompts = path.join(first.home, 'prompts');
  const scrum = path.join(prompts, 'daily-scrum.md');
  const alpha = path.join(first.home, 'state', 'routines', 'alpha.md');
  fs.mkdirSync(work);
  fs.mkdirSync(prompts);
  fs.mkdirSync(path.dirname(alpha), { recursive: true });
  fs.writeFileSync(scrum, '---\nname: scrum\ndescription: Daily scrum\n---\n\nCheck the board.\n');
  fs.writeFileSync(path.join(prompts, 'weekly.md'), 'Write the weekly notes.\n');
  fs.writeFileSync(alpha, 'Read the morning notes.\n');
  fs.writeFileSync(path.join(first.state, 'routines.json'), JSON.stringify({
    routines: [
      { id: 'scrum', title: 'Daily scrum', cron: '30 7 * * 1-5', jitterSeconds: 737, file: scrum, cwd: work, model: null, effort: null, mode: null, enabled: false },
      { id: 'alpha', title: 'Alpha check', cron: '0 9 * * *', jitterSeconds: 0, file: alpha, cwd: work, model: 'claude-haiku-5-5', effort: 'high', mode: 'plan', enabled: false },
    ],
  }, null, 2));
  return Object.assign(await restart(first), { work, prompts, scrum });
}

// A server for the sidebar: a routine with a run, one whose only run is pinned, and three with no run in the list. One of those has run
// before, its runs since archived, and one is off. They go yearly on 1 January so none of them fires during a test.
async function unrun() {
  const first = await start({
    sessions: [{ id: 'a1', title: 'Alpha run', routine: 'alpha', ago: 5 }, { id: 'k1', title: 'Kept run', routine: 'kept', pinned: true, ago: 6 }],
    claude: true,
  });
  const work = path.join(first.home, 'work');
  fs.mkdirSync(work);
  fs.mkdirSync(path.join(first.state, 'routines'));
  const routine = (id, title, extra = {}) => {
    fs.writeFileSync(path.join(first.state, 'routines', `${id}.md`), `Do ${title}.\n`);
    return { id, title, cron: '0 3 1 1 *', jitterSeconds: 0, file: path.join(first.state, 'routines', `${id}.md`), cwd: work, model: null, effort: null, mode: null, enabled: true, ...extra };
  };
  fs.writeFileSync(path.join(first.state, 'routines.json'), JSON.stringify({
    routines: [
      routine('alpha', 'Alpha check'),
      routine('kept', 'Kept check'),
      routine('idle', 'Idle check'),
      routine('lapsed', 'Lapsed check', { lastRunAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
      routine('paused', 'Paused check', { enabled: false }),
    ],
  }, null, 2));
  return restart(first);
}

// A server for renaming from the sidebar: a routine with a latest run and two earlier ones, one of which was renamed in the layout, and a
// run of a routine that routines.json no longer holds. The routine goes yearly on 1 January so it does not fire during a test.
async function renamable() {
  const first = await start({
    sessions: [
      { id: 'n1', title: 'Title at the third run', routine: 'nightly', ago: 5 },
      { id: 'n2', title: 'Title at the second run', routine: 'nightly', ago: 65 },
      { id: 'n3', title: 'Title at the first run', routine: 'nightly', ago: 125 },
      { id: 'g1', title: 'Title of a deleted routine', routine: 'deleted', ago: 8 },
    ],
    layout: { titles: { n3: 'Own name for one run' } },
    claude: true,
  });
  const work = path.join(first.home, 'work');
  fs.mkdirSync(work);
  fs.mkdirSync(path.join(first.state, 'routines'));
  fs.writeFileSync(path.join(first.state, 'routines', 'nightly.md'), 'Do the nightly check.\n');
  fs.writeFileSync(path.join(first.state, 'routines.json'), JSON.stringify({
    routines: [{ id: 'nightly', title: 'Nightly check', cron: '0 3 1 1 *', jitterSeconds: 0, file: path.join(first.state, 'routines', 'nightly.md'), cwd: work, model: null, effort: null, mode: null, enabled: false }],
  }, null, 2));
  return restart(first);
}

before(async () => {
  if (skip) return;
  app = await furnished();
  named = await renamable();
  older = await without(app, 'routineEdits');
  plain = await without(app, 'routineFiles');
  lonely = await unrun();
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
  await plain?.close();
});

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

// A page signed in to the server at `origin`, starting at `hash`, with the view the browser keeps set to Home.
async function appPage(t, origin, { hash = '', phone = false } = {}) {
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'collapsed'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  const page = await browser.open(`${origin}/${hash}`, { phone });
  t.after(() => page.close());
  await login(page);
  if (hash && (await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  return page;
}

const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const titles = page => page.evaluate(`[...document.querySelectorAll('.routine-title')].map(el => el.textContent)`);
const row = id => `[data-routine="${id}"]`;
const focused = page => page.evaluate(`document.activeElement.id || document.activeElement.className || document.activeElement.tagName`);
const toast = page => page.until(`!!document.querySelector('[data-sonner-toast] [data-title]')`).then(() => text(page, '[data-sonner-toast] [data-title]'));
const menuOf = page => page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem], ${MENU} > [role=separator]')].map(el => (el.getAttribute('role') === 'separator' ? '${SEPARATOR}' : el.querySelector('.menu-text').textContent))`);

// Types into a field as a person does: the value changes and the page hears an input event.
const type = (page, selector, value) => page.evaluate(`(el => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
})(document.querySelector(${JSON.stringify(selector)}))`);

// The form is taller than the screen, and a click lands where the pointer is, so what is below the fold is scrolled to first.
const reveal = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
const press = async (page, selector) => {
  await reveal(page, selector);
  await page.click(selector);
};
const parts = (page, selector) => page.evaluate(`[...document.querySelector(${JSON.stringify(selector)}).children].map(el => el.textContent)`);

const switchOf = id => `${row(id)} [role=switch]`;
const hasFocus = (page, selector) => page.until(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);

const valueOf = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
const listed = page => page.until(`document.querySelectorAll('.routine').length >= 2`);
const rows = async page => page.evaluate(`(el => el && [...el.querySelectorAll('.routine')].length)(document.querySelector('.routine-list'))`);

async function pick(page, selector, label) {
  await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${MENU} > [role=menuitem]`)})].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '')`);
  await page.click(`${MENU} [data-picked]`);
}

test('the list shows the routines by title with their schedule in words, the next run, the last run, and a switch for each', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines' });
  await listed(page);
  assert.deepEqual(await titles(page), ['Alpha check', 'Daily scrum']);
  assert.deepEqual(await parts(page, `${row('scrum')} .routine-schedule`), ['Weekdays at 07:30, plus 12 min 17 s', '30 7 * * 1-5']);
  assert.deepEqual(await parts(page, `${row('alpha')} .routine-schedule`), ['Every day at 09:00', '0 9 * * *']);
  assert.deepEqual(await parts(page, `${row('alpha')} .routine-times`), ['Off', 'Never run']);
  assert.equal(await page.evaluate(`!!document.querySelector('${row('scrum')} .routine-quiet, ${row('scrum')} .routine-alert')`), false);
  assert.equal(await page.evaluate(`document.querySelector('${row('alpha')} [role=switch]').getAttribute('aria-checked')`), 'false');
  assert.equal(await text(page, '.chat-head h2'), 'Routines');
  assert.equal(await page.evaluate(`document.querySelector('#routine-new').getAttribute('href')`), '#/routines/new');
  await page.until(`document.title === 'Routines · GhostShell'`);
  assert.deepEqual(page.problems, []);
});

test('the switch turns a routine on and off through the server, and the row shows its next run once it is on', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines' });
  await listed(page);
  const sw = `${row('alpha')} [role=switch]`;
  await page.click(sw);
  await page.until(`document.querySelector('${sw}').getAttribute('aria-checked') === 'true' && /^Next /.test(document.querySelector('${row('alpha')} .routine-times span').textContent)`);
  await page.click(sw);
  await page.until(`document.querySelector('${sw}').getAttribute('aria-checked') === 'false' && document.querySelector('${row('alpha')} .routine-times span').textContent === 'Off'`);
  assert.deepEqual(page.problems, []);
});

// The fake CLI answers a routine's run with nothing, so the server would wait for it. The reply here is the server's, held for a moment, to
// see what the page does while it waits and once it comes. The server's side of a run is in routines-api.test.mjs.
test('Run now disables its button while the server answers, then says the session started with a link to it', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines' });
  await listed(page);
  await page.evaluate(`(of => { window.fetch = (url, init) => (String(url).endsWith('/run')
    ? new Promise(done => setTimeout(done, 400, new Response(JSON.stringify({ sessionId: 'abc', routine: {} }), { status: 200, headers: { 'content-type': 'application/json' } })))
    : of(url, init)); })(window.fetch)`);
  const button = `${row('scrum')} button[aria-label="Run Daily scrum now"]`;
  await page.click(button);
  await page.until(`document.querySelector('${button}').disabled`);
  await page.until(`document.querySelector('[data-sonner-toast] [data-title]')?.textContent === 'Started “Daily scrum”.'`);
  assert.equal(await page.evaluate(`document.querySelector('[data-sonner-toast] button')?.textContent`), 'Open');
  await page.until(`!document.querySelector('${button}').disabled`);
  assert.deepEqual(page.problems, []);
});

test('the menu of a row has Edit and Delete, Delete asks first with Cancel focused, and Cancel keeps the routine', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines' });
  await listed(page);
  await page.click(`${row('scrum')} .routine-more`);
  await page.until(`!!document.querySelector('${MENU}')`);
  assert.deepEqual(await menuOf(page), ['Edit', 'Delete']);
  assert.equal(await page.evaluate(`document.querySelector('${MENU}').getAttribute('aria-label')`), 'Actions for Daily scrum');
  await pick(page, MENU, 'Delete');
  await page.until(`!!document.querySelector('${DIALOG}')`);
  assert.equal(await text(page, '#ask-title'), 'Delete routine “Daily scrum”?');
  assert.match(await text(page, '#ask-detail'), /./);
  assert.equal(await page.evaluate(`document.activeElement.getAttribute('data-slot')`), 'alert-dialog-cancel');
  await page.click('[data-slot="alert-dialog-cancel"]');
  await page.until(`!document.querySelector('${DIALOG}')`);
  assert.equal(await rows(page), 2);
  assert.deepEqual(page.problems, []);
});

test('the form for a new routine previews the schedule as it is typed, and shows each refused field with the focus on the first', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/new' });
  await page.until(`!!document.querySelector('#routine-form')`);
  assert.equal(await text(page, '.chat-head h2'), 'New routine');
  assert.equal(await valueOf(page, '#routine-cwd'), await page.evaluate(`document.querySelector('#root').dataset.home`));
  assert.equal(await text(page, '.routine-default'), "Default follows Claude Desktop's settings for the folder.");
  assert.equal(await text(page, '.routine-kind > legend'), 'Prompt');
  await type(page, '#routine-cron', '30 7 * * 1-5');
  await page.until(`document.querySelectorAll('.routine-fires span').length === 4`);
  assert.equal(await text(page, '.routine-words'), 'Weekdays at 07:30');
  await type(page, '#routine-cron', '99 * * * *');
  await page.until(`document.querySelectorAll('.routine-fires span').length === 0 && !!document.querySelector('#routine-cron-error').textContent`);
  assert.equal(await page.evaluate(`document.querySelector('#routine-cron').getAttribute('aria-invalid')`), 'true');
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`!!document.querySelector('#routine-title-error').textContent`);
  assert.equal(await focused(page), 'routine-title');
  assert.equal(await page.evaluate(`document.querySelector('#routine-title').getAttribute('aria-invalid')`), 'true');
  assert.equal(await page.evaluate(`document.querySelector('#routine-prompt-error').textContent !== ''`), true);
  assert.equal(await page.evaluate(`location.hash`), '#/routines/new');
  assert.deepEqual(page.problems, []);
});

test('a preview answer that arrives after the schedule has changed again is dropped', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/new' });
  await page.until(`!!document.querySelector('#routine-form')`);
  await page.evaluate(`(of => { window.fetch = (url, init) => {
    const ask = String(url);
    if (!ask.startsWith('api/schedule?cron=0%2015')) return of(url, init);
    return new Promise(done => setTimeout(() => of(url, init).then(done), 1200));
  }; })(window.fetch)`);
  await type(page, '#routine-cron', '0 15 * * *');
  await new Promise(done => setTimeout(done, 450));
  await type(page, '#routine-cron', '0 16 * * *');
  await page.until(`document.querySelectorAll('.routine-fires span').length === 4 && /16:00/.test(document.querySelector('.routine-fires').textContent)`);
  await new Promise(done => setTimeout(done, 1300));
  assert.equal(await page.evaluate(`/16:00/.test(document.querySelector('.routine-fires').textContent) && !/15:00/.test(document.querySelector('.routine-fires').textContent)`), true);
  assert.deepEqual(page.problems, []);
});

test('a new routine is saved with what was typed, the page goes back to the list, and the routine is there', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/new' });
  await page.until(`!!document.querySelector('#routine-form')`);
  await type(page, '#routine-title', 'Evening look');
  await type(page, '#routine-cron', '15 18 * * *');
  await type(page, '#routine-cwd', app.work);
  await type(page, '#routine-model', 'claude-haiku-5-5');
  await type(page, '#routine-prompt', 'Look at the evening notes.');
  await page.until(`document.querySelectorAll('.routine-fires span').length === 4`);
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`location.hash === '#/routines' && !!document.querySelector('${row('evening-look')}')`);
  assert.equal(await toast(page), 'Added “Evening look”.');
  assert.deepEqual(await parts(page, `${row('evening-look')} .routine-schedule`), ['Every day at 18:15', '15 18 * * *']);
  assert.equal(await page.evaluate(`document.querySelector('${row('evening-look')} [role=switch]').getAttribute('aria-checked')`), 'true');
  assert.equal(fs.readFileSync(path.join(app.state, 'routines', 'evening-look.md'), 'utf8').trim(), 'Look at the evening notes.');
  assert.deepEqual(page.problems, []);
});

const readJson = () => JSON.parse(fs.readFileSync(path.join(app.state, 'routines.json'), 'utf8'));
const routineOf = id => readJson().routines.find(r => r.id === id);
const kindsOf = page => page.evaluate(`[...document.querySelectorAll('input[name="routine-prompt-kind"]')].map(el => [el.id, el.checked, el.labels[0].textContent])`);

test('the Prompt choice is a labelled radio group that starts on GhostShell\'s own text and moves with the arrow keys', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/new' });
  await page.until(`!!document.querySelector('#routine-form')`);
  assert.equal(await text(page, '.routine-kind > legend'), 'Prompt');
  assert.deepEqual(await kindsOf(page), [['routine-kind-text', true, "GhostShell's own text"], ['routine-kind-file', false, 'A prompt file']]);
  assert.equal(await text(page, '#routine-prompt-hint'), 'GhostShell keeps the text in its own folder, and you edit it here.');
  assert.equal(await page.evaluate(`!!document.querySelector('#routine-file')`), false);
  await page.evaluate(`document.querySelector('#routine-kind-text').focus()`);
  await page.press('ArrowDown');
  await page.until(`document.querySelector('#routine-kind-file').checked && !!document.querySelector('#routine-file')`);
  assert.equal(await focused(page), 'routine-kind-file');
  assert.equal(await page.evaluate(`!!document.querySelector('#routine-prompt')`), false);
  assert.equal(await page.evaluate(`document.querySelector('#routine-file').getAttribute('placeholder')`), '/Users/you/prompts/daily-scrum.md');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#routine-file')).fontFamily.includes('mono') || document.querySelector('#routine-file').classList.contains('routine-mono')`), true);
  assert.equal(await text(page, '#routine-file-hint'), 'GhostShell reads the file at each run and never writes it, so you edit it outside GhostShell.');
  await page.press('ArrowUp');
  await page.until(`document.querySelector('#routine-kind-text').checked && !!document.querySelector('#routine-prompt')`);
  assert.deepEqual(page.problems, []);
});

test('a routine is added with the path of a prompt file, which is kept as it is and is not copied into GhostShell\'s folder', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/new' });
  await page.until(`!!document.querySelector('#routine-form')`);
  await type(page, '#routine-title', 'Weekly notes');
  await type(page, '#routine-cron', '0 16 * * 5');
  await type(page, '#routine-cwd', app.work);
  await press(page, '#routine-kind-file');
  await page.until(`!!document.querySelector('#routine-file')`);
  await type(page, '#routine-file', path.join(app.prompts, 'weekly.md'));
  await page.until(`document.querySelectorAll('.routine-fires span').length === 4`);
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`location.hash === '#/routines' && !!document.querySelector('${row('weekly-notes')}')`);
  assert.equal(await toast(page), 'Added “Weekly notes”.');
  assert.equal(routineOf('weekly-notes').file, path.join(app.prompts, 'weekly.md'));
  assert.equal(fs.existsSync(path.join(app.state, 'routines', 'weekly-notes.md')), false);
  assert.equal(fs.readFileSync(path.join(app.prompts, 'weekly.md'), 'utf8'), 'Write the weekly notes.\n');
  assert.deepEqual(page.problems, []);
});

test('a path that is not a file shows its problem beside the path, keeps the form open on it and saves nothing', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/new' });
  await page.until(`!!document.querySelector('#routine-form')`);
  const before = fs.readFileSync(path.join(app.state, 'routines.json'), 'utf8');
  await type(page, '#routine-title', 'Missing prompt');
  await type(page, '#routine-cron', '0 16 * * 5');
  await type(page, '#routine-cwd', app.work);
  await press(page, '#routine-kind-file');
  await page.until(`!!document.querySelector('#routine-file')`);
  await type(page, '#routine-file', path.join(app.prompts, 'missing.md'));
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`!!document.querySelector('#routine-file-error').textContent`);
  assert.match(await text(page, '#routine-file-error'), /missing\.md/);
  assert.equal(await page.evaluate(`document.querySelector('#routine-file').getAttribute('aria-invalid')`), 'true');
  assert.match(await page.evaluate(`document.querySelector('#routine-file').getAttribute('aria-describedby')`), /routine-file-hint routine-file-error/);
  assert.equal(await focused(page), 'routine-file');
  assert.equal(await page.evaluate(`location.hash`), '#/routines/new');
  assert.equal(fs.readFileSync(path.join(app.state, 'routines.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(app.state, 'routines', 'missing-prompt.md')), false);
  assert.deepEqual(page.problems, []);
});

test('the form for a routine on a file elsewhere shows the path and that the file is edited outside GhostShell, and a new title leaves the file and the path alone', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/scrum' });
  await page.until(`!!document.querySelector('#routine-form') && document.querySelector('#routine-title')?.value === 'Daily scrum' && !!document.querySelector('#routine-file')`);
  assert.deepEqual(await kindsOf(page), [['routine-kind-text', false, "GhostShell's own text"], ['routine-kind-file', true, 'A prompt file']]);
  assert.equal(await valueOf(page, '#routine-file'), app.scrum);
  assert.equal(await text(page, '#routine-file-hint'), 'GhostShell reads the file at each run and never writes it, so you edit it outside GhostShell.');
  assert.equal(await valueOf(page, '#routine-cron'), '30 7 * * 1-5');
  assert.equal(await valueOf(page, '#routine-jitter'), '737');
  assert.equal(await page.evaluate(`document.querySelector('#routine-enabled').getAttribute('aria-checked')`), 'false');
  assert.equal(await page.evaluate(`!!document.querySelector('.routine-on .routine-alert')`), false);
  const outside = fs.readFileSync(app.scrum);
  await type(page, '#routine-title', 'Daily scrum, renamed');
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`location.hash === '#/routines' && document.querySelector('${row('scrum')} .routine-title')?.textContent === 'Daily scrum, renamed'`);
  assert.equal(routineOf('scrum').file, app.scrum);
  assert.equal(fs.existsSync(path.join(app.state, 'routines', 'scrum.md')), false, 'a title change does not copy the prompt');
  assert.deepEqual(fs.readFileSync(app.scrum), outside);
  assert.deepEqual(page.problems, []);
});

test('switching a routine on a file elsewhere to GhostShell\'s own text fills the box with the file\'s text, says the file stays, and writes only GhostShell\'s copy', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/scrum' });
  await page.until(`!!document.querySelector('#routine-file')`);
  const outside = fs.readFileSync(app.scrum);
  await press(page, '#routine-kind-text');
  await page.until(`!!document.querySelector('#routine-prompt')`);
  assert.equal(await valueOf(page, '#routine-prompt'), 'Check the board.');
  assert.equal(await text(page, '#routine-prompt-hint'), 'GhostShell keeps the text in its own folder, and you edit it here. The file stays as it is.');
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`location.hash === '#/routines'`);
  const own = path.join(app.state, 'routines', 'scrum.md');
  assert.equal(routineOf('scrum').file, own);
  assert.equal(fs.readFileSync(own, 'utf8').trim(), 'Check the board.');
  assert.deepEqual(fs.readFileSync(app.scrum), outside, 'the file elsewhere is byte for byte as it was');
  await page.evaluate(`location.hash = '#/routines/scrum'`);
  await page.until(`!!document.querySelector('#routine-prompt') && document.querySelector('#routine-kind-text').checked`);
  await press(page, '#routine-kind-file');
  await page.until(`!!document.querySelector('#routine-file')`);
  assert.equal(await text(page, '#routine-file-hint'), "GhostShell reads the file at each run and never writes it, so you edit it outside GhostShell. GhostShell's own copy stays in its folder.");
  assert.deepEqual(page.problems, []);
});

test('a text routine whose prompt cannot be read shows that beside the text, and choosing a prompt file or typing a prompt leaves it behind', { skip, timeout }, async t => {
  const own = path.join(app.state, 'routines', 'alpha.md');
  const kept = fs.readFileSync(own);
  fs.unlinkSync(own);
  try {
    const page = await appPage(t, app.origin, { hash: '#/routines/alpha' });
    await page.until(`!!document.querySelector('#routine-form') && document.querySelector('#routine-title')?.value === 'Alpha check' && !!document.querySelector('#routine-prompt')`);
    assert.match(await text(page, '#routine-prompt-error'), /Cannot read .*alpha\.md/);
    await press(page, '#routine-kind-file');
    await page.until(`!!document.querySelector('#routine-file')`);
    await type(page, '#routine-file', path.join(app.prompts, 'weekly.md'));
    assert.equal(await text(page, '#routine-file-error'), '');
    assert.equal(await page.evaluate(`document.querySelector('#routine-file').getAttribute('aria-invalid')`), null);
    await press(page, '#routine-kind-text');
    await page.until(`!!document.querySelector('#routine-prompt')`);
    assert.match(await text(page, '#routine-prompt-error'), /Cannot read/);
    await type(page, '#routine-prompt', 'Read the notes again.');
    assert.equal(await text(page, '#routine-prompt-error'), '');
    assert.deepEqual(page.problems, []);
  } finally {
    fs.writeFileSync(own, kept);
  }
});

test('Delete in the form asks first and takes the page back to the list without the routine', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/evening-look' });
  await page.until(`document.querySelector('#routine-title')?.value === 'Evening look'`);
  await press(page, '.routine-delete');
  await page.until(`!!document.querySelector('${DIALOG}')`);
  assert.equal(await text(page, '#ask-title'), 'Delete routine “Evening look”?');
  await page.click('[data-slot="alert-dialog-action"]');
  await page.until(`location.hash === '#/routines' && !document.querySelector('${row('evening-look')}')`);
  assert.equal(await toast(page), 'Deleted “Evening look”.');
  assert.deepEqual(page.problems, []);
});

test('back on the list the focus is on the saved routine\'s switch after a Save, changed or not, and on New routine after a Delete in the form', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/new' });
  await page.until(`!!document.querySelector('#routine-form')`);
  await type(page, '#routine-title', 'Focus check');
  await type(page, '#routine-cron', '15 18 * * *');
  await type(page, '#routine-cwd', app.work);
  await type(page, '#routine-prompt', 'Look at where the focus goes.');
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`location.hash === '#/routines' && !!document.querySelector('${row('focus-check')}')`);
  await hasFocus(page, switchOf('focus-check'));
  const edit = async title => {
    await page.evaluate(`location.hash = '#/routines/focus-check'`);
    await page.until(`document.querySelector('#routine-title')?.value === 'Focus check'`);
    if (title) await type(page, '#routine-title', title);
  };
  await edit();
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`location.hash === '#/routines' && !!document.querySelector('${row('focus-check')}')`);
  await hasFocus(page, switchOf('focus-check'));
  await edit('Focus check, renamed');
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`location.hash === '#/routines' && document.querySelector('${row('focus-check')} .routine-title')?.textContent === 'Focus check, renamed'`);
  await hasFocus(page, switchOf('focus-check'));
  await page.evaluate(`location.hash = '#/routines/focus-check'`);
  await page.until(`!!document.querySelector('.routine-delete')`);
  await page.until(`!document.querySelector('[data-sonner-toast]')`, 10_000);
  await press(page, '.routine-delete');
  await page.until(`!!document.querySelector('${DIALOG}')`);
  await page.click('[data-slot="alert-dialog-action"]');
  await page.until(`location.hash === '#/routines' && !document.querySelector('${row('focus-check')}')`);
  await hasFocus(page, '#routine-new');
  assert.deepEqual(page.problems, []);
});

test('a save whose reply comes after the owner has opened a session leaves the owner on that session', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/alpha' });
  await page.until(`document.querySelector('#routine-title')?.value === 'Alpha check'`);
  // The reply is the page's own, so the routine is not changed on the server, and it comes after the owner has moved on.
  await page.evaluate(`(of => { window.fetch = (url, init) => (init?.method === 'PATCH' && String(url).endsWith('api/routines/alpha')
    ? new Promise(done => setTimeout(done, 800, new Response(JSON.stringify({ routine: { id: 'alpha' } }), { status: 200, headers: { 'content-type': 'application/json' } })))
    : of(url, init)); })(window.fetch)`);
  await type(page, '#routine-title', 'Alpha check, late');
  await press(page, '.routine-buttons button[type=submit]');
  await page.until(`document.querySelector('.routine-buttons button[type=submit]').disabled`);
  await page.evaluate(`location.hash = '#/s/r1'`);
  assert.equal(await toast(page), 'Saved “Alpha check, late”.');
  await new Promise(done => setTimeout(done, 600));
  assert.equal(await page.evaluate(`location.hash`), '#/s/r1');
  assert.equal(await page.evaluate(`!!document.querySelector('#routines, #routine-form')`), false);
  assert.deepEqual(page.problems, []);
});

test('a route for a routine that is not there says so and leads back to the list', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines/nothing-here' });
  await page.until(`!!document.querySelector('.routines-failure')`);
  assert.equal(await text(page, '.routines-failure'), 'That routine is not here any more.');
  assert.equal(await page.evaluate(`document.querySelector('.routines-inner a.btn').getAttribute('href')`), '#/routines');
});

test('Home has a Manage routines button in the Routines header, a Routines link in the footer, and the row of a routine has Run now, Pause, Edit and Delete first, then a separator', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`!!document.querySelector('.group-head[data-key="routines"]')`);
  assert.equal(await page.evaluate(`document.querySelector('.group-head[data-key="routines"]').closest('.bar').querySelector('a.head-tool[href="#/routines"]').getAttribute('href')`), '#/routines');
  assert.equal(await page.evaluate(`document.querySelector('.group-head[data-key="routines"]').closest('.bar').querySelector('a.head-tool[href="#/routines"]').getAttribute('aria-label')`), 'Manage routines');
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.list-foot .foot-links a')].map(a => [a.textContent, a.getAttribute('href')])`), [['Routines', '#/routines'], ['Passkeys', '#/passkeys']]);
  await page.until(`!!document.querySelector('a.row[data-id="r1"]')`);
  await page.evaluate(`(el => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 40, clientY: r.y + r.height / 2 })); })(document.querySelector('a.row[data-id="r1"]'))`);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  const items = await menuOf(page);
  assert.deepEqual(items.slice(0, 6), ['Run now', 'Resume', 'Edit', 'Delete', SEPARATOR, 'Rename']);
  await pick(page, MENU, 'Edit');
  await page.until(`location.hash === '#/routines/alpha' && document.querySelector('#routine-title')?.value === 'Alpha check'`);
  assert.equal(await valueOf(page, '#routine-model'), 'claude-haiku-5-5');
  assert.equal(await valueOf(page, '#routine-mode'), 'plan');
  assert.deepEqual(page.problems, []);
});

test('the footer link opens the page and is marked as the current one', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`!!document.querySelector('.list-foot .foot-links a')`);
  await page.click('.list-foot .foot-links a');
  await page.until(`location.hash === '#/routines' && !!document.querySelector('.routine-list')`);
  assert.equal(await page.evaluate(`document.querySelector('.list-foot .foot-links a').getAttribute('aria-current')`), 'page');
  assert.equal(await page.evaluate(`document.querySelector('.group-head[data-key="routines"]').closest('.bar').querySelector('a.head-tool[href="#/routines"]').getAttribute('aria-current')`), 'page');
  assert.deepEqual(page.problems, []);
});

test('the search on the Routines chip has Manage routines first, and Enter opens the page', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin);
  await page.until(`!!document.querySelector('.group-head[data-key="routines"]')`);
  await page.click('button.find');
  await page.until(`!!document.querySelector('.chips .chip')`);
  await page.evaluate(`[...document.querySelectorAll('.chips .chip')].find(b => b.textContent === 'Routines').setAttribute('data-picked', '')`);
  await page.click('.chip[data-picked]');
  await page.until(`!!document.querySelector('[data-part="hit-title"]')`);
  assert.equal(await text(page, '[data-part="hit-title"]'), 'Manage routines');
  await page.press('Enter');
  await page.until(`location.hash === '#/routines'`);
  assert.deepEqual(page.problems, []);
});

test('a server that does not say it can edit routines gets the list with Run now and the switch, and no New routine, no menu, and the list for a form route', { skip, timeout }, async t => {
  const page = await appPage(t, older.origin, { hash: '#/routines' });
  await listed(page);
  assert.equal(await page.evaluate(`!!document.querySelector('#routine-new')`), false);
  assert.equal(await page.evaluate(`document.querySelectorAll('.routine-more').length`), 0);
  assert.equal(await page.evaluate(`document.querySelectorAll('.routine [role=switch]').length`), readJson().routines.length);
  await page.evaluate(`location.hash = '#/routines/new'`);
  await page.until(`!!document.querySelector('.routine-list') && !document.querySelector('#routine-form')`);
  await page.evaluate(`location.hash = '#/'`);
  await page.until(`!!document.querySelector('a.row[data-id="r1"]')`);
  await page.evaluate(`(el => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 40, clientY: r.y + r.height / 2 })); })(document.querySelector('a.row[data-id="r1"]'))`);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  assert.deepEqual((await menuOf(page)).slice(0, 4), ['Run now', 'Resume', SEPARATOR, 'Rename']);
  assert.deepEqual(page.problems, []);
});

test('on a phone the rows stack, the form fields are 16 pixels or more so the page does not zoom, and nothing is wider than the screen', { skip, timeout }, async t => {
  const page = await appPage(t, app.origin, { hash: '#/routines', phone: true });
  await listed(page);
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.routine')).gridTemplateColumns.split(' ').length`), 1);
  await page.evaluate(`location.hash = '#/routines/new'`);
  await page.until(`!!document.querySelector('#routine-form')`);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('#routine-form .input')].every(el => parseFloat(getComputedStyle(el).fontSize) >= 16)`), true);
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('.routine-choice')].every(el => el.getBoundingClientRect().height >= document.querySelector('#routine-title').getBoundingClientRect().height)`), true, 'a choice is as tall as a field');
  await reveal(page, '#routine-kind-file');
  await page.tap('#routine-kind-file');
  await page.until(`!!document.querySelector('#routine-file')`);
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true);
});

test('a server that does not say it keeps routine files gets the text box alone, with no choice of a prompt file', { skip, timeout }, async t => {
  const page = await appPage(t, plain.origin, { hash: '#/routines/new' });
  await page.until(`!!document.querySelector('#routine-form')`);
  assert.equal(await page.evaluate(`!!document.querySelector('.routine-kind, input[type=radio], #routine-file')`), false);
  assert.equal(await text(page, '#routine-prompt-hint'), 'GhostShell keeps the prompt in its own folder.');
  assert.equal(await text(page, '.routine-field label[for="routine-prompt"]'), 'Prompt');
  await page.evaluate(`location.hash = '#/routines/scrum'`);
  await page.until(`document.querySelector('#routine-title')?.value === 'Daily scrum, renamed' || document.querySelector('#routine-title')?.value === 'Daily scrum'`);
  assert.equal(await page.evaluate(`!!document.querySelector('.routine-kind, input[type=radio], #routine-file')`), false);
  assert.equal(await page.evaluate(`document.querySelector('#routine-prompt').tagName`), 'TEXTAREA');
  assert.deepEqual(page.problems, []);
});

const idleRows = page => page.evaluate(`[...document.querySelectorAll('a.row[data-idle]')].map(a => [a.dataset.idle, a.querySelector('.row-title').textContent, a.querySelector('.row-idle').textContent])`);
const ready = page => page.until(`!!document.querySelector('a.row[data-id="a1"]') && document.querySelectorAll('a.row[data-idle]').length > 0`);
const contextMenu = (page, selector) => page.evaluate(`(el => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 40, clientY: r.y + r.height / 2 })); })(document.querySelector(${JSON.stringify(selector)}))`);

test('Home draws a row for each routine with no run, after the routines that have runs, and none for a routine whose only run is pinned', { skip, timeout }, async t => {
  const page = await appPage(t, lonely.origin);
  await ready(page);
  assert.deepEqual(await idleRows(page), [
    ['idle', 'Idle check', "Hasn't run yet"],
    ['lapsed', 'Lapsed check', 'Last run 3 days ago'],
    ['paused', 'Paused check', 'Off'],
  ]);
  assert.equal(await page.evaluate(`!!document.querySelector('a.row[data-idle="kept"], a.row[data-idle="alpha"]')`), false);
  assert.equal(await page.evaluate(`!!document.querySelector('a.row[data-id="k1"]')`), true);
  assert.deepEqual(await page.evaluate(`[...document.querySelector('.group-head[data-key="routines"]').closest('.group').querySelectorAll('a.row')].map(a => a.dataset.id ?? a.dataset.idle)`), ['a1', 'idle', 'lapsed', 'paused']);
  assert.equal(await text(page, '.group-head[data-key="routines"] .count'), '4');
  assert.equal(await page.evaluate(`document.querySelector('a.row[data-idle="idle"]').getAttribute('href')`), '#/routines/idle');
  assert.equal(await page.evaluate(`document.querySelector('.group-head[data-key="routines"]').closest('.group').dataset.drop ?? null`), null);
  assert.deepEqual(page.problems, []);
});

test('the arrow keys walk onto a routine with no run and on, Enter opens the routine, and the row is no session to select or archive', { skip, timeout }, async t => {
  const page = await appPage(t, lonely.origin);
  await ready(page);
  await page.evaluate(`document.querySelector('a.row[data-id="a1"]').focus()`);
  await page.press('ArrowDown');
  await page.until(`document.activeElement === document.querySelector('a.row[data-idle="idle"]')`);
  await page.press('ArrowDown');
  await page.until(`document.activeElement === document.querySelector('a.row[data-idle="lapsed"]')`);
  await page.press('ArrowUp');
  await page.until(`document.activeElement === document.querySelector('a.row[data-idle="idle"]')`);
  await page.press('ArrowLeft');
  await page.until(`document.activeElement === document.querySelector('.group-head[data-key="routines"]')`);
  await page.evaluate(`document.querySelector('a.row[data-idle="idle"]').focus()`);
  await page.press('Enter');
  await page.until(`location.hash === '#/routines/idle' && document.querySelector('#routine-title')?.value === 'Idle check'`);
  assert.equal(await page.evaluate(`document.querySelector('a.row[data-idle="idle"]').hasAttribute('data-id')`), false);
  assert.deepEqual(page.problems, []);
});

test('a routine with no run has the menu a run has for its routine, from its dots button and a right click', { skip, timeout }, async t => {
  const page = await appPage(t, lonely.origin);
  await ready(page);
  await contextMenu(page, 'a.row[data-idle="idle"]');
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  assert.deepEqual(await menuOf(page), ['Run now', 'Pause', 'Edit', 'Delete']);
  assert.equal(await page.evaluate(`document.querySelector('${MENU}').getAttribute('aria-label')`), 'Actions for Idle check');
  await page.press('Escape');
  await page.until(`!document.querySelector('${MENU}')`);
  await page.click('li:has(> a.row[data-idle="paused"]) > .more');
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  assert.deepEqual(await menuOf(page), ['Run now', 'Resume', 'Edit', 'Delete']);
  await pick(page, MENU, 'Resume');
  await page.until(`document.querySelector('a.row[data-idle="paused"] .row-idle')?.textContent === "Hasn't run yet"`);
  await page.click('li:has(> a.row[data-idle="paused"]) > .more');
  await page.until(`!!document.querySelector('${MENU}')`);
  await pick(page, MENU, 'Edit');
  await page.until(`location.hash === '#/routines/paused' && document.querySelector('#routine-title')?.value === 'Paused check'`);
  assert.deepEqual(page.problems, []);
});

test('on a phone a routine with no run is as tall as any row, says its state on a second line, and nothing is wider than the screen', { skip, timeout }, async t => {
  const page = await appPage(t, lonely.origin, { phone: true });
  await ready(page);
  const box = selector => page.evaluate(`(r => ({ top: r.top, bottom: r.bottom, height: r.height }))(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`);
  const run = await box('a.row[data-id="a1"]');
  const idle = await box('a.row[data-idle="idle"]');
  assert.equal(idle.height, run.height);
  const title = await box('a.row[data-idle="idle"] .row-title');
  const state = await box('a.row[data-idle="idle"] .row-idle');
  assert.ok(state.top >= title.bottom - 1, 'the state is under the title');
  assert.ok(state.bottom <= idle.bottom + 1, 'and inside the row');
  const more = await box('li:has(> a.row[data-idle="idle"]) > .more');
  assert.ok(more.height >= 20, 'the dots button is the size of the others');
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true);
  assert.deepEqual(page.problems, []);
});

// ---- renaming a routine from its row in the sidebar ----------------------------------------------

const rowTitle = (page, id) => text(page, `a.row[data-id="${id}"] .row-title`);
const namedRows = page => page.evaluate(`[...document.querySelectorAll('a.row[data-id]')].map(a => [a.dataset.id, a.querySelector('.row-title').textContent])`);
const settled = page => page.until(`!!document.querySelector('a.row[data-id="n1"]') && !!document.querySelector('a.row[data-id="g1"]')`);
const openFold = async page => {
  await page.click('li.has-fold > .fold');
  await page.until(`!!document.querySelector('.earlier-runs a.row')`);
};
const nameBox = page => page.until(`document.activeElement?.closest('.name-form') !== null && document.activeElement.tagName === 'INPUT'`);
const nightly = () => JSON.parse(fs.readFileSync(path.join(named.state, 'routines.json'), 'utf8')).routines.find(r => r.id === 'nightly').title;
const layoutTitles = () => JSON.parse(fs.readFileSync(path.join(named.state, 'layout.json'), 'utf8')).titles ?? {};

test('a routine\'s row shows the routine\'s title, its earlier runs show their date even when one was renamed, and a deleted routine\'s run keeps its start title', { skip, timeout }, async t => {
  const page = await appPage(t, named.origin);
  await settled(page);
  assert.equal(await rowTitle(page, 'n1'), 'Nightly check');
  assert.equal(await rowTitle(page, 'g1'), 'Title of a deleted routine');
  await openFold(page);
  const dates = await page.evaluate(`[...document.querySelectorAll('.earlier-runs a.row .row-title')].map(el => el.textContent)`);
  assert.equal(dates.length, 2);
  assert.equal(dates.some(title => /Own name|Nightly check|Title at/.test(title)), false, dates.join(' | '));
  assert.deepEqual(page.problems, []);
});

test('an earlier run has no Rename in its menu and a double click on it opens no box, and the routine\'s row has both', { skip, timeout }, async t => {
  const page = await appPage(t, named.origin);
  await settled(page);
  await openFold(page);
  const earlier = '.earlier-runs a.row[data-id="n2"]';
  await contextMenu(page, earlier);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  const items = await menuOf(page);
  assert.equal(items.includes('Rename'), false, items.join(', '));
  assert.equal(items.includes('Archive'), true);
  await page.press('Escape');
  await page.until(`!document.querySelector('${MENU}')`);
  await page.evaluate(`document.querySelector('${earlier}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`);
  await new Promise(done => setTimeout(done, 150));
  assert.equal(await page.evaluate(`!!document.querySelector('.name-form')`), false);
  await contextMenu(page, 'a.row[data-id="n1"]');
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  assert.equal((await menuOf(page)).includes('Rename'), true);
  assert.deepEqual(page.problems, []);
});

test('a double click on the routine\'s row opens the box with the routine\'s title, and Esc leaves the title as it was', { skip, timeout }, async t => {
  const page = await appPage(t, named.origin);
  await settled(page);
  await page.evaluate(`document.querySelector('a.row[data-id="n1"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`);
  await nameBox(page);
  assert.equal(await valueOf(page, '.name-form input'), 'Nightly check');
  assert.equal(await page.evaluate(`document.querySelector('.name-form input').getAttribute('aria-label')`), 'Rename routine');
  await page.press('Escape');
  await page.until(`!document.querySelector('.name-form')`);
  assert.equal(await rowTitle(page, 'n1'), 'Nightly check');
  assert.equal(nightly(), 'Nightly check');
  assert.deepEqual(page.problems, []);
});

test('Rename on the routine\'s row renames the routine: routines.json, the row and the Routines page change, and no run gets a title of its own', { skip, timeout }, async t => {
  const page = await appPage(t, named.origin);
  await settled(page);
  await contextMenu(page, 'a.row[data-id="n1"]');
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  await pick(page, MENU, 'Rename');
  await nameBox(page);
  assert.equal(await valueOf(page, '.name-form input'), 'Nightly check');
  await page.insert('📥 Tina inboxes');
  await page.press('Enter');
  await page.until(`!document.querySelector('.name-form') && document.querySelector('a.row[data-id="n1"] .row-title')?.textContent === '📥 Tina inboxes'`);
  assert.equal(nightly(), '📥 Tina inboxes');
  assert.deepEqual(layoutTitles(), { n3: 'Own name for one run' });
  await page.evaluate(`location.hash = '#/routines'`);
  await page.until(`document.querySelector('.routine-title')?.textContent === '📥 Tina inboxes'`);
  assert.deepEqual(page.problems, []);
});

test('flag, hourglass and tick emoji keep their form through a rename of the routine', { skip, timeout }, async t => {
  const page = await appPage(t, named.origin);
  await settled(page);
  for (const title of ['🇩🇪 German word', '⏳ Timesheet', '✅ Done']) {
    await page.evaluate(`document.querySelector('a.row[data-id="n1"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`);
    await nameBox(page);
    await page.insert(title);
    await page.press('Enter');
    await page.until(`!document.querySelector('.name-form') && document.querySelector('a.row[data-id="n1"] .row-title')?.textContent === ${JSON.stringify(title)}`);
    assert.equal(nightly(), title);
  }
  assert.deepEqual(page.problems, []);
});

test('a refused routine title keeps the box open with the problem shown, and the routine is unchanged', { skip, timeout }, async t => {
  const page = await appPage(t, named.origin);
  await settled(page);
  const before = nightly();
  await page.evaluate(`document.querySelector('a.row[data-id="n1"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`);
  await nameBox(page);
  await page.insert('⁠');
  await page.press('Enter');
  assert.equal(await toast(page), 'Give the routine a title.');
  assert.equal(await page.evaluate(`!!document.querySelector('.name-form')`), true);
  assert.equal(nightly(), before);
  assert.deepEqual(page.problems, []);
});

test('the row of a run whose routine is gone is renamed as a session, in the layout', { skip, timeout }, async t => {
  const page = await appPage(t, named.origin);
  await settled(page);
  await page.evaluate(`document.querySelector('a.row[data-id="g1"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`);
  await nameBox(page);
  assert.equal(await valueOf(page, '.name-form input'), 'Title of a deleted routine');
  await page.insert('Kept run');
  await page.press('Enter');
  await page.until(`!document.querySelector('.name-form') && document.querySelector('a.row[data-id="g1"] .row-title')?.textContent === 'Kept run'`);
  assert.equal(layoutTitles().g1, 'Kept run');
  assert.deepEqual(page.problems, []);
});
