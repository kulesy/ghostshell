// Run with `npm test`. The cards for create_project and create_group in the real page against the real server, and that a project and group a tool makes
// show in a sidebar that is already open. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, PASSWORD, request, signIn, start } from './harness.mjs';

const SESSIONS = [{ id: 'top', title: 'Top', ago: 5 }, { id: 'other', title: 'Other', ago: 6 }];
const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 60_000;
const CTRL = 2;
let app;
let browser;

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, claude: true, layout: { projects: [{ id: 'cp-side', name: 'Side' }] } });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

async function appPage(t, hash = '') {
  const setter = await browser.open(`${app.origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'panels', 'subsMore'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  const page = await browser.open(`${app.origin}/${hash}`);
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

test('the card for a new project and a new group has its own title and says what is made and where', { skip, timeout }, async t => {
  const { token } = await signIn(app);
  const sent = text => request(app, 'POST', '/api/sessions/top/send', { headers: as(token), json: { text } });
  assert.equal((await sent('begin a session')).status, 200);
  assert.equal((await sent('ask to use create_project {"name":"Fresh \\"one\\""}')).status, 200);
  assert.equal((await sent('ask to use create_group {"name":"Shiny","project":"side"}')).status, 200);
  const page = await appPage(t, '#/s/top');
  await page.until(`document.querySelectorAll('.approval').length === 2`);
  const cards = await page.evaluate(`[...document.querySelectorAll('.approval')].map(a => [a.querySelector('h3').textContent, a.querySelector('.approval-path')?.textContent])`);
  assert.deepEqual(cards.sort(), [
    ['Claude wants to create a group', 'create the group "Shiny" in the project "Side"'],
    ['Claude wants to create a project', 'create the project "Fresh one"'],
  ]);
  assert.deepEqual(page.problems, []);
});

test('a project and a group made by a tool show in a sidebar that is already open, with no reload', { skip, timeout }, async t => {
  const { token } = await signIn(app);
  const page = await appPage(t);
  if (!(await page.evaluate(`!!document.querySelector('.new-project')`))) await page.press('b', CTRL);
  await page.until(`!!document.querySelector('.scope-name')`);
  const names = `[...document.querySelectorAll('.scopes .scope-name')].map(n => n.textContent)`;
  const heads = `[...document.querySelectorAll('.bar .name')].map(n => n.textContent)`;
  assert.equal((await page.evaluate(names)).includes('Made by a tool'), false);
  const call = text => request(app, 'POST', '/api/sessions/other/send', { headers: as(token), json: { text } });
  assert.equal((await call('call create_project {"name":"Made by a tool"}')).status, 200);
  assert.equal((await call('call create_group {"name":"Tool group"}')).status, 200);
  const waited = Date.now();
  await page.until(`${names}.includes('Made by a tool') && ${heads}.includes('Tool group')`, 25_000);
  t.diagnostic(`the open sidebar showed both after ${Math.round((Date.now() - waited) / 1000)} seconds`);
  assert.deepEqual(page.problems, []);
});
