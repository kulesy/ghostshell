// Run with `npm test`. Replying to a session from its card in the Sub sessions tab, in the real page against the real server and the fake CLI: the box and
// what stays as it was, a message that reaches its session, an archived session, a send that fails, keys, a card that moves, and a phone.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, PASSWORD, request, signIn, start, until } from './harness.mjs';

const SESSIONS = [
  { id: 'hub', title: 'Hub', ago: 5 },
  ...['first', 'second', 'third', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'].map((id, at) => ({ id, title: id[0].toUpperCase() + id.slice(1), parent: 'hub', ago: 20 + at })),
  { id: 'planner', title: 'Planner', parent: 'hub', ago: 40, fields: { permissionMode: 'plan' } },
];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let token;
let browser;

const said = (id, text) => {
  const file = path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'text', text }] } })}\n`);
  const old = (Date.now() - 600_000) / 1000;
  fs.utimesSync(file, old, old);
};

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, claude: true });
  ({ token } = await signIn(app));
  for (const { id, parent } of SESSIONS) if (parent) said(id, 'Done. Shall I merge it?');
  browser = await launch(chromium);
});

after(async () => { await browser?.close(); });

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

async function hubPage(t, { phone = false } = {}) {
  const page = await browser.open(`${app.origin}/#/s/hub`, { phone });
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
  if ((await page.evaluate('location.hash')) !== '#/s/hub') await page.evaluate(`location.hash = '#/s/hub'`);
  if (phone) {
    await page.until(`!!document.querySelector('#subsButton')`);
    if (!(await page.evaluate(`!!document.querySelector('#panel .subs')`))) await page.tap('#subsButton');
  }
  await page.until(`!!document.querySelector('#panel .subs [data-reply-card]')`, 10_000);
  return page;
}

// Opens a card's box and waits for it to take the focus. The list can still be moving as its summaries arrive, and a press lands where the button was, so it tries again.
const openBox = async (page, id, { press = page.click, at = 'nearest' } = {}) => {
  const focused = `document.activeElement === document.querySelector(${JSON.stringify(box(id))})`;
  for (let tries = 5; tries; tries--) {
    await page.evaluate(`document.querySelector(${JSON.stringify(button(id))}).scrollIntoView({ block: ${JSON.stringify(at)} })`);
    await press(button(id));
    if (await page.until(focused, 1500).then(() => true, () => false)) return;
  }
  assert.fail(`the box of ${id} did not open`);
};
const button = id => `[data-reply-card="${id}"]`;
const box = id => `[data-reply-text="${id}"]`;
const value = (page, id) => page.evaluate(`document.querySelector(${JSON.stringify(box(id))})?.value ?? null`);
const toastSays = (page, text) => page.until(`[...document.querySelectorAll('[data-sonner-toast]')].some(el => el.textContent.includes(${JSON.stringify(text)}))`);
const told = text => cliCalls(app).some(call => call.user === text);
const startedFor = id => cliCalls(app).find(call => call.started?.includes(id))?.started;
const flag = (args, name) => args[args.indexOf(name) + 1];
const notInterrupted = async message => {
  await new Promise(done => setTimeout(done, 500));
  assert.equal(fs.existsSync(path.join(app.home, 'layout-at-interrupt.json')), false, message);
};
const failNextSend = (page, body) => page.evaluate(`(() => { const real = window.fetch; window.fetch = (url, init) => (String(url).endsWith('/send') ? (window.fetch = real, Promise.resolve(new Response(${JSON.stringify(JSON.stringify(body))}, { status: 409 }))) : real(url, init)); })()`);
const rowOf = async id => {
  const { ungrouped } = (await request(app, 'GET', '/api/sessions', { headers: as(token) })).body();
  return ungrouped.flatMap(r => [r, ...(r.children ?? [])]).find(r => r.id === id);
};

test('a card has a Reply button and no box until it is opened, and its other parts do what they did', { skip, timeout }, async t => {
  const page = await hubPage(t);
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub-send').length`), 0, 'a long list stays easy to scan');
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(button('first'))}).getAttribute('aria-expanded')`), 'false');
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(button('first'))}).getAttribute('aria-label')`), 'Reply to First');

  await openBox(page, 'first');
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub-send').length`), 1, 'only the card asked');
  const controls = await page.evaluate(`document.querySelector(${JSON.stringify(button('first'))}).getAttribute('aria-controls')`);
  assert.equal(await page.evaluate(`document.getElementById(${JSON.stringify(controls)}) === document.querySelector('.sub-send')`), true);
  assert.equal(await page.evaluate(`document.querySelector('.sub-send button[type=submit]').disabled`), true, 'nothing to send yet');

  const card = `.sub:has(${button('first')})`;
  await page.click(`${card} .sub-fold`);
  await page.until(`!!document.querySelector(${JSON.stringify(`${card} .sub-open .sub-reply`)})`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.sub-send').length`), 1, 'Details and Reply open apart');
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(`${card} .sub-open`)}).compareDocumentPosition(document.querySelector('.sub-send')) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false`), true, 'the box sits under the reply it answers');

  await page.click(button('first'));
  await page.until(`!document.querySelector('.sub-send')`);
  await page.click(`${card} .sub-title`);
  await page.until(`location.hash === '#/s/first'`);
  assert.deepEqual(page.problems, []);
});

test('a message sent from a card reaches that session, says it went and leaves the list where it was', { skip, timeout }, async t => {
  const page = await hubPage(t);
  await openBox(page, 'second');
  await page.insert('Yes, merge it');
  await page.click('.sub-send button[type=submit]');
  await toastSays(page, 'Sent to Second');
  await until(() => told('Yes, merge it'));
  assert.equal(flag(startedFor('second'), '--resume'), 'second');
  assert.equal(startedFor('hub'), undefined, 'the chat on screen took no message');
  assert.equal(await page.evaluate('location.hash'), '#/s/hub');
  await page.until(`!document.querySelector('.sub-send')`);
  assert.equal(await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(button('second'))})`), true);
  await page.until(`document.querySelector(${JSON.stringify(`.sub:has(${button('second')}) .sub-pill`)})?.textContent === 'Working'`, 3000);

  await openBox(page, 'second');
  assert.equal(await value(page, 'second'), '', 'the box comes back empty');
  assert.deepEqual(page.problems, []);
});

test('a card sends what the chat would: the words alone, with the session on its own permission mode', { skip, timeout }, async t => {
  const page = await hubPage(t);
  await openBox(page, 'planner');
  await page.insert('  plain words\n');
  await page.press('Enter');
  await until(() => told('plain words'));
  assert.equal(flag(startedFor('planner'), '--permission-mode'), 'plan');
});

test('a held Enter sends once, on the press and not on the repeats, and a held Shift+Enter keeps making lines', { skip, timeout }, async t => {
  const page = await hubPage(t);
  await openBox(page, 'third');
  await page.insert('kept draft');
  await page.press('Enter', 0, { repeat: true });
  assert.equal(await value(page, 'third'), 'kept draft', 'a repeat from the Reply button neither sends nor adds a line');
  await page.press('Enter', 8, { repeat: true });
  assert.equal(await value(page, 'third'), 'kept draft\n');
  await new Promise(done => setTimeout(done, 300));
  assert.equal(told('kept draft\n'), false);
  assert.equal(told('kept draft'), false);
});

test('an archived session comes back when a card sends to it, as it does from its own chat', { skip, timeout }, async t => {
  const page = await hubPage(t);
  await openBox(page, 'fifth');
  await page.insert('Back to work');
  await request(app, 'POST', '/api/layout/archive', { headers: as(token), json: { id: 'fifth', archived: true } });
  await until(async () => !(await rowOf('fifth')));
  await page.press('Enter');
  await toastSays(page, 'Sent to Fifth');
  await until(() => told('Back to work'));
  await until(async () => !!(await rowOf('fifth')));
  await page.until(`!!document.querySelector(${JSON.stringify(button('fifth'))})`);
});

test('a send that fails keeps the text in the box and says why, and the same text can go again', { skip, timeout }, async t => {
  const page = await hubPage(t);
  await failNextSend(page, { error: 'The account is out of usage.', blocked: { from: 'session' } });
  await openBox(page, 'sixth');
  await page.insert('Please rebase');
  await page.press('Enter');
  await page.until(`document.querySelector('.sub-send-note[role=alert]')?.textContent === 'Not sent: The account is out of usage.'`);
  assert.equal(await value(page, 'sixth'), 'Please rebase');
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(box('sixth'))}).getAttribute('aria-invalid')`), 'true');
  assert.equal(told('Please rebase'), false);
  await toastSays(page, 'Not sent to Sixth: The account is out of usage.');

  await page.press('Enter');
  await toastSays(page, 'Sent to Sixth');
  await until(() => told('Please rebase'));
  assert.equal(cliCalls(app).filter(call => call.user === 'Please rebase').length, 1);
  assert.deepEqual(page.problems.filter(p => !p.includes('409')), []);
});

test('Esc closes the box from anywhere in it and keeps its text, even after a click on Send failed, the panel stays and the chat on screen is not stopped, and Shift+Enter is a new line', { skip, timeout }, async t => {
  await request(app, 'POST', '/api/sessions/hub/send', { headers: as(token), json: { text: 'keep going' } });
  const page = await hubPage(t);
  await page.until(`document.querySelector('#chatLamp')?.dataset.state === 'working'`);
  await openBox(page, 'seventh');
  await page.insert('line one');
  await page.press('Enter', 8);
  await page.insert('line two');
  assert.equal(await value(page, 'seventh'), 'line one\nline two');
  await page.press('Escape');
  await page.until(`!document.querySelector('.sub-send')`);
  assert.equal(await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(button('seventh'))})`), true);
  assert.equal(await page.evaluate(`!!document.querySelector('#panel .subs')`), true);
  await notInterrupted('no interrupt reached the chat');
  await openBox(page, 'seventh');
  assert.equal(await value(page, 'seventh'), 'line one\nline two');

  await page.evaluate(`document.querySelector('.sub-send button[type=submit]').focus()`);
  await page.press('Escape');
  await page.until(`!document.querySelector('.sub-send')`);
  await notInterrupted('Esc on Send stays in the box');
  await openBox(page, 'seventh');

  await failNextSend(page, { error: 'Not now.' });
  await page.click('.sub-send button[type=submit]');
  await page.until(`!!document.querySelector('.sub-send-note[role=alert]')`);
  assert.equal(await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(box('seventh'))})`), true, 'the focus stays in the box');
  await page.press('Escape');
  await page.until(`!document.querySelector('.sub-send')`);
  await notInterrupted('Esc after a failed click stays in the box');
  await request(app, 'POST', '/api/sessions/hub/send', { headers: as(token), json: { text: 'finish the turn' } });
});

test('a card that moves to another part while its box is in use keeps the text and the focus', { skip, timeout }, async t => {
  await request(app, 'POST', '/api/sessions/eighth/send', { headers: as(token), json: { text: 'keep going' } });
  const page = await hubPage(t);
  await page.until(`document.querySelector(${JSON.stringify(`.sub:has(${button('eighth')}) .sub-pill`)})?.textContent === 'Working'`, 16_000);
  await openBox(page, 'eighth');
  await page.insert('half a thought');
  const before = await page.evaluate(`document.querySelector(${JSON.stringify(box('eighth'))}).closest('.status-part').querySelector('.status-heading').textContent`);
  await request(app, 'POST', '/api/sessions/eighth/send', { headers: as(token), json: { text: 'finish the turn' } });
  await page.until(`document.querySelector(${JSON.stringify(box('eighth'))})?.closest('.status-part').querySelector('.status-heading').textContent !== ${JSON.stringify(before)}`, 20_000);
  assert.equal(await value(page, 'eighth'), 'half a thought');
  assert.equal(await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(box('eighth'))})`), true);
  await page.insert(' more');
  assert.equal(await value(page, 'eighth'), 'half a thought more');
  assert.deepEqual(page.problems, []);
});

test('archiving a card with its box open moves the focus on, and the text is there when the session comes back', { skip, timeout }, async t => {
  const page = await hubPage(t);
  await openBox(page, 'tenth');
  await page.insert('for later');
  await page.click('[data-archive-card="tenth"]');
  await page.until(`!document.querySelector(${JSON.stringify(button('tenth'))})`);
  await page.until(`document.activeElement !== document.body`);
  await request(app, 'POST', '/api/layout/archive', { headers: as(token), json: { id: 'tenth', archived: false } });
  await page.until(`!!document.querySelector(${JSON.stringify(box('tenth'))})`, 16_000);
  assert.equal(await value(page, 'tenth'), 'for later');
  assert.deepEqual(page.problems, []);
});

test('a session with a card waiting in its chat says the message waits behind it', { skip, timeout }, async t => {
  const steps = await start({ sessions: [{ id: 'hub', title: 'Hub', ago: 5 }, { id: 'asking', title: 'Asking', parent: 'hub', ago: 20 }], claude: true });
  const { token: mine } = await signIn(steps);
  await request(steps, 'POST', '/api/sessions/asking/send', { headers: as(mine), json: { text: 'ask a question' } });
  await until(async () => (await request(steps, 'GET', '/api/sessions', { headers: as(mine) })).body().ungrouped.some(r => (r.children ?? []).some(c => c.id === 'asking' && c.state === 'waiting')), 10_000);
  const page = await browser.open(`${steps.origin}/#/s/hub`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (await page.evaluate(LOGIN)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
  }
  if ((await page.evaluate('location.hash')) !== '#/s/hub') await page.evaluate(`location.hash = '#/s/hub'`);
  await page.until(`!!document.querySelector(${JSON.stringify(button('asking'))})`, 15_000);
  await openBox(page, 'asking');
  await page.until(`/after you answer that/.test(document.querySelector('.sub-send-note')?.textContent ?? '')`);
  const note = await page.evaluate(`document.querySelector('.sub-send-note').id`);
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(box('asking'))}).getAttribute('aria-describedby')`), note);
});

test('at phone width a tap opens the box, the text is big enough that Safari does not zoom, Enter is a new line and a tap on Send sends', { skip, timeout }, async t => {
  const page = await hubPage(t, { phone: true });
  await openBox(page, 'first', { press: page.tap, at: 'end' });
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(box('first'))})).fontSize`), '16px');
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  await page.insert('From my phone');
  await page.press('Enter');
  assert.equal(await value(page, 'first'), 'From my phone\n', 'Enter on a touch screen makes a new line');
  assert.equal(await page.evaluate(`document.querySelector('.sub-send').getBoundingClientRect().bottom <= document.querySelector('.subs').getBoundingClientRect().bottom`), true, 'Send stays in view at the foot of the list');
  await page.tap('.sub-send button[type=submit]');
  await toastSays(page, 'Sent to First');
  await until(() => told('From my phone'));
  assert.equal(await page.evaluate('location.hash'), '#/s/hub');
});
