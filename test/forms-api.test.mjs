// Run with `npm test`. A form Claude showed with show_form, over HTTP against the real server and a fake CLI: the list of a chat's forms, and a send
// that answers or skips one. A form takes one send, whichever device sends it. See docs/adr/20261124-page-draws-ask-forms.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serviceFor } from '../lib/accounts.mjs';
import { as, cliCalls, request, restart, signIn, start, until } from './harness.mjs';

const DAY = 86_400_000;
const QUESTIONS = [
  { type: 'choice', question: 'Which branch?', options: [{ label: 'main' }, { label: 'next' }] },
  { type: 'text', question: 'Anything else?', optional: true },
];
const form = (toolUseId, sessionId, over = {}) => ({ toolUseId, sessionId, title: 'Plan the release', questions: QUESTIONS, ...over });
const SESSIONS = [{ id: 'live', title: 'Runs', source: 'cli', ago: 1 }, { id: 'other', title: 'Another', source: 'cli', ago: 2 }];

async function open(forms = [form('tool-a', 'live'), form('tool-b', 'live'), form('tool-c', 'other')]) {
  const s = await start({ claude: true, sessions: SESSIONS, forms });
  return { s, token: (await signIn(s)).token };
}

const get = (c, url) => request(c.s, 'GET', url, { headers: as(c.token) });
const post = (c, url, json) => request(c.s, 'POST', url, { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) }, json });
const send = (c, id, text, formBody) => post(c, `/api/sessions/${id}/send`, { text, ...(formBody !== undefined && { form: formBody }) });
const sent = c => cliCalls(c.s).filter(x => x.user).map(x => x.user);
// The fake CLI logs a message a moment after the server writes it, so a count of none or one waits that long before it is read.
const settle = async (c, n) => { if (n) await until(() => sent(c).length >= n); await new Promise(r => setTimeout(r, 300)); return sent(c); };
const statusOf = async (c, id) => Object.fromEntries((await get(c, `/api/sessions/${id}/forms`)).body().forms.map(f => [f.toolUseId, f.status]));

test('a chat lists its own forms with their questions and status, and not another chat\'s', async () => {
  const c = await open();
  const res = await get(c, '/api/sessions/live/forms');
  assert.equal(res.status, 200);
  const forms = res.body().forms;
  assert.deepEqual(forms.map(f => f.toolUseId).sort(), ['tool-a', 'tool-b']);
  assert.deepEqual(forms[0].questions, QUESTIONS);
  assert.ok(forms.every(f => f.status === 'open' && f.title === 'Plan the release'));
  assert.deepEqual(Object.keys(await statusOf(c, 'other')), ['tool-c']);
  assert.equal((await request(c.s, 'GET', '/api/sessions/live/forms')).status, 401, 'not without signing in');
});

test('a send with a form sends the message once and settles the form, and a second send of it is a 409 that sends nothing', async () => {
  const c = await open();
  const first = await send(c, 'live', 'Answers to the form', { id: 'tool-a' });
  assert.equal(first.status, 200);
  assert.equal(first.body().form.status, 'answered');
  assert.deepEqual(await statusOf(c, 'live'), { 'tool-a': 'answered', 'tool-b': 'open' });

  const second = await send(c, 'live', 'Answers to the form again', { id: 'tool-a' });
  assert.equal(second.status, 409);
  assert.match(second.body().error, /already answered/);
  assert.equal(second.body().form.status, 'answered');
  const skipped = await send(c, 'live', 'Skipped the form', { id: 'tool-a', skipped: true });
  assert.equal(skipped.status, 409, 'a skip does not settle one that was answered');
  assert.deepEqual(await settle(c, 1), ['Answers to the form'], 'only the first message reached the chat');
});

test('two sends of one form at once settle it once and send one message', async () => {
  const c = await open();
  const both = await Promise.all([send(c, 'live', 'From the phone', { id: 'tool-a' }), send(c, 'live', 'From the laptop', { id: 'tool-a' })]);
  assert.deepEqual(both.map(r => r.status).sort(), [200, 409]);
  assert.equal((await settle(c, 1)).length, 1);
});

test('a skip settles the form as skipped', async () => {
  const c = await open();
  const res = await send(c, 'live', 'Skipped the form "Plan the release".', { id: 'tool-b', skipped: true });
  assert.equal(res.status, 200);
  assert.equal(res.body().form.status, 'skipped');
  assert.deepEqual(await statusOf(c, 'live'), { 'tool-a': 'open', 'tool-b': 'skipped' });
  assert.match((await send(c, 'live', 'Answers', { id: 'tool-b' })).body().error, /already skipped/);
});

test('a form of another chat, or one that does not exist, is a 404 that sends nothing and settles nothing', async () => {
  const c = await open();
  assert.equal((await send(c, 'live', 'Answers', { id: 'tool-c' })).status, 404);
  assert.equal((await send(c, 'live', 'Answers', { id: 'nope' })).status, 404);
  assert.deepEqual(await statusOf(c, 'other'), { 'tool-c': 'open' });
  assert.deepEqual(await settle(c, 0), []);
});

test('a form of the wrong shape is a 400 that sends nothing', async () => {
  const c = await open();
  for (const bad of [{}, { id: 5 }, { id: 'tool-a', skipped: 'yes' }, 'tool-a', null]) {
    assert.equal((await send(c, 'live', 'Answers', bad)).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(await statusOf(c, 'live'), { 'tool-a': 'open', 'tool-b': 'open' });
  assert.deepEqual(await settle(c, 0), []);
});

test('a send without a form is as it was, and a form stays open when its chat gets other messages', async () => {
  const c = await open();
  assert.equal((await send(c, 'live', 'Just a message')).status, 200);
  assert.equal((await send(c, 'live', 'Another one')).body().form, undefined);
  assert.deepEqual(await statusOf(c, 'live'), { 'tool-a': 'open', 'tool-b': 'open' });
});

test('a send that the server refuses puts the form back to open, so it can be sent again', async () => {
  const s = await start({ claude: true, sessions: SESSIONS, forms: [form('tool-a', 'live')] });
  const dir = path.join(s.state, 'accounts', 'second');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(s.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }, { id: 'second', name: 'Second', dir }] }));
  const signedIn = on => {
    fs.writeFileSync(path.join(dir, 'auth-state.json'), JSON.stringify(on ? { loggedIn: true, email: 'second@example.com', orgId: 'org-hidden-2', subscriptionType: 'pro' } : { loggedIn: false }));
    fs.writeFileSync(path.join(s.home, `keychain-expiry-${serviceFor(dir)}`), String(on ? Date.now() + 20 * DAY : Date.now() - DAY));
  };
  signedIn(true);
  const c = { s: await restart(s) };
  c.token = (await signIn(c.s)).token;
  assert.equal((await post(c, '/api/layout/account', { kind: 'session', id: 'live', account: 'second' })).status, 200);
  signedIn(false);
  assert.equal((await post(c, '/api/layout/account', { kind: 'session', id: 'other', account: 'second' })).status, 409, 'asking reads the sign-out');

  const refused = await send(c, 'live', 'Answers to the form', { id: 'tool-a' });
  assert.equal(refused.status, 409);
  assert.ok(refused.body().blocked, 'refused for the pinned account');
  assert.deepEqual(await statusOf(c, 'live'), { 'tool-a': 'open' });
  assert.deepEqual(await settle(c, 0), []);

  assert.equal((await post(c, '/api/layout/account', { kind: 'session', id: 'live', account: null })).status, 200);
  assert.equal((await send(c, 'live', 'Answers to the form', { id: 'tool-a' })).status, 200);
  assert.deepEqual(await statusOf(c, 'live'), { 'tool-a': 'answered' });
});
