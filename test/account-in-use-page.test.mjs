// Run with `npm test`. Several accounts in use at once, in the real page against the real server with the stub keychain tool and stub CLIs of test/harness.mjs and two
// fake accounts, Main and Second: the plan popover that names the account, the sign-in banner for an account in use only through a pin, the pinned line where the switch
// button was, and the Accounts page's line of pins. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there
// is none. CAPCOM_SHOTS=<folder> also saves a screenshot of each state there. See docs/adr/20261104-pin-work-to-an-account.md.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serviceFor } from '../lib/accounts.mjs';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, authCalls, PASSWORD, request, restart, signIn, start, until as waitFor } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 60_000;
const DAY = 86_400_000;
let browser;

before(async () => {
  if (!skip) browser = await launch(chromium);
});
after(async () => {
  await browser?.close();
});

const GROUPS = [{ id: 'cg-a', name: 'Work', project: 'cp-a' }, { id: 'cg-b', name: 'Loose' }];
const SESSIONS = [
  { id: 'live', title: 'Runs', source: 'cli', ago: 1 },
  { id: 'other', title: 'Another', source: 'cli', ago: 2 },
  { id: 'loosely', title: 'In the loose group', source: 'cli', ago: 3, group: 'cg-b' },
];
const row = (over = {}) => ({ kind: 'weekly_all', group: 'weekly', percent: 71, severity: 'normal', resets_at: new Date(Date.now() + 3 * DAY).toISOString(), scope: null, is_active: true, ...over });
const session = row({ kind: 'session', group: 'session', percent: 34, resets_at: new Date(Date.now() + 2 * 3_600_000).toISOString() });

// A server with accounts Main and Second (just Main with `one`), both with plan usage, Second signed in with a folder of its own.
async function open({ one = false } = {}) {
  const first = await start({ claude: true, sessions: SESSIONS, groups: GROUPS, layout: { projects: [{ id: 'cp-a', name: 'Proj' }] } });
  const dir = path.join(first.state, 'accounts', 'second');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(first.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }, ...(one ? [] : [{ id: 'second', name: 'Second', dir }])] }));
  fs.writeFileSync(path.join(first.home, 'plan-usage.json'), JSON.stringify([session, row()]));
  fs.writeFileSync(path.join(dir, 'plan-usage.json'), JSON.stringify([row({ percent: 12 })]));
  const c = { s: first, dir };
  signedIn(c, true);
  c.s = await restart(first);
  c.token = (await signIn(c.s)).token;
  await waitFor(async () => (await accountsOf(c)).accounts.every(a => a.signedOut || a.email || one), 20_000);
  for (const id of ['live', 'other']) {
    const folder = path.join(c.s.home, '.claude', 'projects', '-test-folder');
    fs.mkdirSync(folder, { recursive: true });
    fs.appendFileSync(path.join(folder, `${id}.jsonl`), `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text: 'Done' }], usage: { input_tokens: 1000, output_tokens: 9 } } })}\n`);
  }
  fs.writeFileSync(path.join(c.s.home, 'context-usage.json'), JSON.stringify({ summary: { totalTokens: 39300, maxTokens: 300000, autoCompactThreshold: 267000, isAutoCompactEnabled: true } }));
  return c;
}

// Second signed in with a sign-in that ends in `days`, or signed out (`hold` makes a sign-in wait on the Mac).
function signedIn(c, on, { days = 20, hold = false } = {}) {
  fs.writeFileSync(path.join(c.dir, 'auth-state.json'), JSON.stringify(on ? { loggedIn: true, email: 'second@example.com', orgId: 'org-hidden-2', subscriptionType: 'pro' } : { loggedIn: false, ...(hold && { hold: true }) }));
  fs.writeFileSync(path.join(c.s.home, `keychain-expiry-${serviceFor(c.dir)}`), String(on ? Date.now() + days * DAY : Date.now() - DAY));
}

const get = (c, url) => request(c.s, 'GET', url, { headers: as(c.token) });
const post = (c, url, json = {}) => request(c.s, 'POST', url, { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) }, json });
const accountsOf = async c => (await get(c, '/api/accounts')).body();
const pin = (c, kind, id, account) => post(c, '/api/layout/account', { kind, id, account });
// The second account's sign-in is read when something asks for it, and a refused switch to it asks.
const refresh = async c => {
  assert.equal((await post(c, '/api/accounts/second/use')).status, 409);
};

async function shot(page, name) {
  if (!process.env.CAPCOM_SHOTS) return;
  fs.mkdirSync(process.env.CAPCOM_SHOTS, { recursive: true });
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(process.env.CAPCOM_SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

async function openPage(t, c, hash = '') {
  const page = await browser.open(`${c.s.origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || !!document.querySelector('.list-foot'))`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
  }
  await page.until(`!document.querySelector('#boot') && !!document.querySelector('.list-foot')`, 10_000);
  if (await page.until(`!!document.querySelector('.offer')`, 1500).then(() => true, () => false)) {
    await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(b => b.textContent === 'Not now')?.click()`);
  }
  // A turn that ends before the chat's event stream is connected leaves no notice, so the tests wait for the stream before they send.
  await page.evaluate(`window.streams = 0; const Real = window.EventSource; window.EventSource = class extends Real { constructor(...args) { super(...args); this.addEventListener('open', () => window.streams++); } }`);
  if (hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  return page;
}

const send = (c, id, text) => post(c, `/api/sessions/${id}/send`, { text });
const streamed = (page, count) => page.until(`window.streams >= ${count}`, 30_000);
const LOGIN = 'aside.offer[aria-labelledby=banner-login-title]';
const banner = page => page.evaluate(`(a => ({ title: a.querySelector('h2').textContent, text: a.querySelector('.offer-text').textContent, buttons: [...a.querySelectorAll('button')].map(b => b.textContent.trim()), tone: a.dataset.tone ?? null }))(document.querySelector('${LOGIN}'))`);

test('the plan popover names the account the chat runs on when two are listed, and keeps "Plan usage" with one', { skip, timeout }, async t => {
  const c = await open();
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 200);
  assert.equal((await send(c, 'live', 'hello')).status, 200);
  assert.equal((await send(c, 'other', 'hello')).status, 200);
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('.btn.context')`, 15_000);
  await page.click('.btn.context');
  await page.until(`document.querySelectorAll('.context-plan [role=meter]').length === 2`);
  assert.equal(await page.evaluate(`document.querySelector('.context-plan-title').textContent`), 'Plan usage, Main');
  assert.equal(await page.evaluate(`document.querySelector('.context-plan').getAttribute('aria-labelledby') === document.querySelector('.context-plan-title').id`), true);
  await shot(page, 'plan-popover-two');
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await page.until(`!document.querySelector('.context-pop')`);

  await page.evaluate(`location.hash = '#/s/other'`);
  await page.until(`!!document.querySelector('.btn.context')`, 15_000);
  await page.click('.btn.context');
  await page.until(`document.querySelectorAll('.context-plan [role=meter]').length === 1`);
  assert.equal(await page.evaluate(`document.querySelector('.context-plan-title').textContent`), 'Plan usage, Second', 'a session pinned to Second shows the plan of Second');
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.context-plan [role=meter]')].map(m => m.getAttribute('aria-valuenow'))`), ['12']);

  const one = await open({ one: true });
  assert.equal((await send(one, 'live', 'hello')).status, 200);
  const plain = await openPage(t, one, '#/s/live');
  await plain.until(`!!document.querySelector('.btn.context')`, 15_000);
  await plain.click('.btn.context');
  await plain.until(`document.querySelectorAll('.context-plan [role=meter]').length === 2`);
  assert.equal(await plain.evaluate(`document.querySelector('.context-plan-title').textContent`), 'Plan usage');
  await shot(plain, 'plan-popover-one');
  assert.deepEqual([...page.problems, ...plain.problems], []);
});

test('the Accounts page keeps "Plan usage" over each account, however many are listed', { skip, timeout }, async t => {
  const c = await open();
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 200);
  for (const id of ['live', 'other']) await send(c, id, 'ask for approval');
  await waitFor(async () => (await accountsOf(c)).accounts.every(a => a.chats[0]?.state === 'waiting'), 20_000);
  const page = await openPage(t, c, '#/accounts');
  await page.until(`document.querySelectorAll('#accounts .context-plan-title').length === 2`, 15_000);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#accounts .context-plan-title')].map(h => h.textContent)`), ['Plan usage', 'Plan usage']);
});

test('a signed out account in use only through a pin gets the sign-in banner with its name, and the press signs in that account', { skip, timeout }, async t => {
  const c = await open();
  signedIn(c, true);
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 200);
  signedIn(c, false, { hold: true });
  await refresh(c);
  const page = await openPage(t, c);
  await page.until(`!!document.querySelector('${LOGIN}')`, 15_000);
  assert.deepEqual(await banner(page), { title: 'Second is signed out', text: 'Chats and routines on Second fail until you sign in again.', buttons: ['Sign in on the Mac'], tone: 'warning' });
  await shot(page, 'banner-signed-out');

  await page.click(`${LOGIN} .btn`);
  await page.until(`document.querySelector('${LOGIN} .offer-progress')?.textContent === 'Approve the sign-in page in the browser on the Mac.'`, 15_000);
  const calls = () => authCalls(c.s).filter(x => x.args[0] === 'login').map(x => x.dir);
  await waitFor(() => calls().length === 1, 15_000);
  assert.deepEqual(calls(), [c.dir], 'the sign-in ran for Second, not for the active account');

  fs.writeFileSync(path.join(c.s.home, 'auth-release'), '');
  await page.until(`!document.querySelector('${LOGIN}')`, 15_000);
  assert.equal((await accountsOf(c)).accounts.find(a => a.id === 'second').signedOut, false);
  assert.deepEqual(page.problems, []);
});

test('an account in use through a pin whose sign-in ends in three days is named in the banner, and the active account is not', { skip, timeout }, async t => {
  const c = await open();
  signedIn(c, true, { days: 3 });
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  const page = await openPage(t, c);
  await page.until(`!!document.querySelector('${LOGIN}')`, 15_000);
  const got = await banner(page);
  assert.match(got.title, /^Second's sign-in ends in [23] days$/);
  assert.match(got.text, /^It ends on \w{3} \d{1,2} \w{3}, \d\d:\d\d\. Chats and routines stop until you sign in again\. Signing in now starts a fresh four weeks\.$/);
  assert.deepEqual([got.buttons, got.tone], [['Sign in on the Mac'], null]);
  await shot(page, 'banner-ending');

  assert.equal((await pin(c, 'group', 'cg-b', null)).status, 200);
  await page.until(`!document.querySelector('${LOGIN}')`, 20_000);
});

test('with one account the banner keeps its old words', { skip, timeout }, async t => {
  const c = await open({ one: true });
  fs.writeFileSync(path.join(c.s.home, 'auth-state.json'), JSON.stringify({ loggedIn: false, hold: true }));
  fs.writeFileSync(path.join(c.s.home, 'keychain-expiry'), 'missing');
  const c2 = await restart(c.s);
  const page = await openPage(t, { ...c, s: c2, token: (await signIn(c2)).token });
  await page.until(`!!document.querySelector('${LOGIN}')`, 20_000);
  const got = await banner(page);
  assert.deepEqual([got.title, got.text], ['Claude is signed out', 'Every chat and routine fails until you sign in again.']);
  await shot(page, 'banner-signed-out-one');
});

test('a chat pinned to its account shows why a switch will not move it, where the switch button was, and an unpinned one keeps the button', { skip, timeout }, async t => {
  const c = await open();
  assert.equal((await pin(c, 'session', 'live', 'main')).status, 200);
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#notice') && !!document.querySelector('.btn.context, textarea, .composer')`, 30_000);
  await streamed(page, 1);
  await send(c, 'live', 'hit the usage limit');
  await page.until(`/hit your limit/.test(document.querySelector('#notice').textContent)`, 30_000);
  await page.until(`!!document.querySelector('.notice-action')`, 30_000);
  assert.equal(await page.evaluate(`document.querySelector('.notice-action').textContent`), "This session stays on Main because of a pin, so a switch won't move it. Change the pin to move it.");
  assert.equal(await page.evaluate(`!!document.querySelector('.notice-action button')`), false);
  await shot(page, 'chat-pinned-line');

  await page.evaluate(`location.hash = '#/s/other'`);
  await streamed(page, 2);
  await send(c, 'other', 'hit the usage limit');
  await page.until(`document.querySelector('.notice-action button')?.textContent === 'Switch to Second and continue'`, 30_000);
  assert.equal(await page.evaluate(`document.querySelectorAll('.notice-action .account-hint').length`), 0);
  await shot(page, 'chat-switch-button');
  assert.deepEqual(page.problems, []);
});

test('a chat pinned to Second while Main stays active and has room shows the stays line naming Second, with no button', { skip, timeout }, async t => {
  const c = await open();
  assert.equal((await pin(c, 'session', 'live', 'second')).status, 200);
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#notice') && !!document.querySelector('.btn.context, textarea, .composer')`, 30_000);
  await streamed(page, 1);
  await send(c, 'live', 'hit the usage limit');
  await page.until(`/hit your limit/.test(document.querySelector('#notice').textContent)`, 30_000);
  await page.until(`!!document.querySelector('.notice-action')`, 30_000);
  assert.equal(await page.evaluate(`document.querySelector('.notice-action').textContent`), "This session stays on Second because of a pin, so a switch won't move it. Change the pin to move it.");
  assert.equal(await page.evaluate(`!!document.querySelector('.notice-action button')`), false);
  assert.deepEqual(page.problems, []);
});

test('the Accounts page says what is pinned under each account and that a switch leaves it there, and says neither when nothing is', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/accounts');
  await page.until(`document.querySelectorAll('#accounts .account').length === 2`, 15_000);
  const lines = () => page.evaluate(`[...document.querySelectorAll('#accounts .account')].map(li => [...li.querySelectorAll('.account-line')].map(p => p.textContent))`);
  const lead = () => page.evaluate(`document.querySelector('#accounts .account-lead').textContent`);
  assert.equal((await lines()).flat().some(x => x.startsWith('Pinned')), false);
  assert.doesNotMatch(await lead(), /pinned work/);

  assert.equal((await pin(c, 'session', 'live', 'second')).status, 200);
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 200);
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  assert.equal((await pin(c, 'project', 'cp-a', 'main')).status, 200);
  await page.reload();
  await page.until(`document.querySelectorAll('#accounts .account').length === 2 && [...document.querySelectorAll('#accounts .account-line')].some(p => p.textContent.startsWith('Pinned'))`, 15_000);
  const [main, second] = await lines();
  assert.deepEqual(main.filter(x => x.startsWith('Pinned')), ['Pinned: 1 project']);
  assert.deepEqual(second.filter(x => x.startsWith('Pinned')), ['Pinned: 2 sessions, 1 group']);
  assert.match(await lead(), /Switching takes one click and no sign-in, and a chat carries on where it was\. A switch leaves pinned work on its account\.$/);
  await shot(page, 'accounts-pinned');

  assert.equal((await pin(c, 'project', 'cp-a', null)).status, 200);
  assert.equal((await pin(c, 'group', 'cg-b', null)).status, 200);
  assert.equal((await pin(c, 'session', 'live', null)).status, 200);
  assert.equal((await pin(c, 'session', 'other', null)).status, 200);
  await page.reload();
  await page.until(`document.querySelectorAll('#accounts .account').length === 2`, 15_000);
  assert.equal((await lines()).flat().some(x => x.startsWith('Pinned')), false);
  assert.doesNotMatch(await lead(), /pinned work/);
  assert.deepEqual(page.problems, []);
});

test('with one account a pin is still counted under it, and the lead says nothing about a switch', { skip, timeout }, async t => {
  const c = await open({ one: true });
  assert.equal((await pin(c, 'session', 'live', 'main')).status, 200);
  const page = await openPage(t, c, '#/accounts');
  await page.until(`[...document.querySelectorAll('#accounts .account-line')].some(p => p.textContent === 'Pinned: 1 session')`, 15_000);
  assert.doesNotMatch(await page.evaluate(`document.querySelector('#accounts .account-lead').textContent`), /pinned work/);
});
