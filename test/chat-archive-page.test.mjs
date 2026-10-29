// Run with `npm test`. Archive and Unarchive in the header of an open chat, in the real page: the button for an idle, a running and an archived session, the
// note with Undo, the question before a running chat is stopped, no button for a group's or section's chat or a new session, and the layout it writes. It needs
// Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, PASSWORD, request, signIn, start, until } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const GROUPS = [{ id: 'cg-a', name: 'Reviewing' }, { id: 'cg-b', name: 'Backlog', session: WORK }];
const SESSIONS = [
  { id: 's1', title: 'In reviewing', group: 'cg-a', ago: 1 },
  { id: 's2', title: 'In backlog', group: 'cg-b', ago: 2 },
  { id: 'old', title: 'Long gone', archived: true, ago: 30 },
];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let browser;

before(async () => {
  if (skip) return;
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const BUTTON = `#archiveButton`;
const LABEL = `(document.querySelector('${BUTTON}')?.getAttribute('aria-label') ?? null)`;
const NOTE = `[...document.querySelectorAll('[data-sonner-toast] [data-title]')].map(el => el.textContent).join('|')`;

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

async function appPage(t, origin, hash) {
  const page = await browser.open(`${origin}/${hash}`, {});
  t.after(() => page.close());
  await login(page);
  if ((await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.until(`!!document.querySelector('.chat-head')`);
  return page;
}

const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const pressNoteButton = page => page.evaluate(`document.querySelector('[data-sonner-toast] [data-action]').click()`);

test('an idle session\'s header archives it at once with a note that offers Undo, and the button then reads Unarchive', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, '#/s/s1');
  await page.until(`${LABEL} === 'Archive'`);
  assert.equal(await page.evaluate(`document.querySelector('${BUTTON}').closest('.chat-tools') !== null`), true);
  await page.click(BUTTON);
  await page.until(`${NOTE}.includes('Archived “In reviewing”.')`);
  await page.until(`${LABEL} === 'Unarchive'`);
  assert.ok(onDisk(s).archived.s1);
  assert.equal(await page.evaluate(`!document.querySelector('.ask, [data-slot="alert-dialog-title"]')`), true, 'an idle session is not asked about');

  await pressNoteButton(page);
  await page.until(`${NOTE}.includes('Unarchived “In reviewing”.')`);
  await page.until(`${LABEL} === 'Archive'`);
  assert.equal(onDisk(s).archived.s1, undefined);
  assert.deepEqual(page.problems, []);
});

test('an archived session\'s header offers Unarchive, which brings it back to its group and swaps the button for Archive', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, '#/s/old');
  await page.until(`${LABEL} === 'Unarchive'`);
  await page.click(BUTTON);
  await page.until(`${NOTE}.includes('Unarchived “Long gone”.')`);
  await page.until(`${LABEL} === 'Archive'`);
  const { token } = await signIn(s);
  const listed = path => request(s, 'GET', path, { headers: as(token) }).then(r => r.body());
  assert.equal((await listed('/api/archived')).archived.some(r => r.id === 'old'), false);
  assert.match(JSON.stringify(await listed('/api/sessions')), /"id":"old"/, 'the server lists it again');
  assert.deepEqual(page.problems, []);
});

test('the button reads Unarchive after an archive whose request lands after the page looked the archive up, and a double click archives once', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s.origin, '#/s/s1');
  await page.until(`${LABEL} === 'Archive'`);
  await page.evaluate(`(() => {
    const real = window.fetch;
    window.__posts = [];
    window.fetch = async (url, init) => {
      if (String(url).includes('api/layout/archive')) {
        window.__posts.push(String(url));
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      return real(url, init);
    };
  })()`);
  await page.evaluate(`(() => { const b = document.querySelector('${BUTTON}'); b.click(); b.click(); })()`);
  await page.until(`${NOTE}.includes('Archived “In reviewing”.')`, 10_000);
  await page.until(`${LABEL} === 'Unarchive'`);
  assert.equal(await page.evaluate('window.__posts.length'), 1, 'one request');
  assert.ok(onDisk(s).archived.s1);
  assert.deepEqual(page.problems, []);
});

test('a running session\'s button reads Stop and archive and asks first, Cancel leaves it running and unarchived, and confirming stops and archives it', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const { token } = await signIn(s);
  assert.equal((await request(s, 'POST', '/api/sessions/s1/send', { headers: as(token), json: { text: 'begin a session' } })).status, 200);
  const page = await appPage(t, s.origin, '#/s/s1');
  await page.until(`${LABEL} === 'Stop and archive'`);
  await page.click(BUTTON);
  await page.until(`document.querySelector('#ask-title')?.textContent === 'Stop and archive “In reviewing”?'`);
  await page.evaluate(`document.querySelector('[data-slot="alert-dialog-cancel"]').click()`);
  await page.until(`!document.querySelector('#ask-title')`);
  assert.equal(onDisk(s).archived?.s1, undefined);
  assert.equal(await page.evaluate(LABEL), 'Stop and archive');

  await page.click(BUTTON);
  await page.until(`!!document.querySelector('#ask-title')`);
  await page.evaluate(`document.querySelector('[data-slot="alert-dialog-action"]').click()`);
  await page.until(`${NOTE}.includes('Stopped and archived “In reviewing”.')`);
  await page.until(`${LABEL} === 'Unarchive'`);
  assert.ok(onDisk(s).archived.s1);
  await until(() => cliCalls(s).some(c => c.control === 'interrupt'));
  assert.deepEqual(page.problems, []);
});

test('a group\'s chat, a section\'s chat and a new session have no Archive button', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const group = await appPage(t, s.origin, '#/g/cg-b');
  await group.until(`document.querySelector('.chat-name h2')?.textContent === 'Backlog'`);
  const section = await appPage(t, s.origin, '#/g/pinned');
  await section.until(`/Section session/.test(document.querySelector('.chat-meta')?.textContent ?? '')`);
  const draft = await appPage(t, s.origin, '#/new');
  await draft.until(`document.querySelector('.chat-name h2')?.textContent === 'New session'`);
  for (const page of [group, section, draft]) assert.equal(await page.evaluate(`document.querySelectorAll('${BUTTON}').length`), 0);
  const session = await appPage(t, s.origin, '#/s/s2');
  await session.until(`${LABEL} === 'Archive'`);
  assert.deepEqual([...group.problems, ...section.problems, ...draft.problems, ...session.problems], []);
});
