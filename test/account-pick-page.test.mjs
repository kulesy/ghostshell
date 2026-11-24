// Run with `npm test`. The account picks, the quiet label and the blocked notice in the real page against the real server, with the stub keychain tool and stub CLIs
// of test/harness.mjs and two fake accounts, Main and Second. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked
// when there is none. CAPCOM_SHOTS=<folder> also saves a screenshot of each state there. See docs/adr/20261104-pin-work-to-an-account.md.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serviceFor } from '../lib/accounts.mjs';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, PASSWORD, request, restart, signIn, start, until } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 60_000;
const DAY = 86_400_000;
const MENU = '.menu:not([data-sub])';
const SUB = '.menu[data-sub]';
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
  { id: 'grouped', title: 'In a group', source: 'cli', ago: 3, group: 'cg-a' },
];

// A server with accounts Main and Second (just Main with `one`), Second signed out with `out`, and `accounts` as the layout's session pins. With `chrome`, Chrome is
// set up and only Main's folder sees a browser, and the server surveys at once, so Second is proved to have no Chrome.
async function open({ one = false, out = false, accounts = {}, groups = GROUPS, routines, chips, sessions = [], chrome = false } = {}) {
  const first = await start({ claude: true, sessions: [...SESSIONS, ...sessions], groups, chips, layout: { projects: [{ id: 'cp-a', name: 'Proj' }], accounts }, ...(chrome && { env: { CAPCOM_SURVEY_DELAY_MS: '100' } }) });
  if (chrome) {
    fs.writeFileSync(path.join(first.home, '.claude.json'), JSON.stringify({ cachedChromeExtensionInstalled: true }));
    fs.writeFileSync(path.join(first.home, 'chrome-state.json'), JSON.stringify({ browsers: [{ deviceId: 'd1', name: 'Fake', osPlatform: 'darwin', connectedAt: 1, isLocal: true, inUse: false }] }));
  }
  const dir = path.join(first.state, 'accounts', 'second');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(first.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }, ...(one ? [] : [{ id: 'second', name: 'Second', dir }])] }));
  if (routines) fs.writeFileSync(path.join(first.state, 'routines.json'), JSON.stringify({ routines }, null, 2));
  signedIn(first, dir, !out);
  const s = await restart(first);
  const { token } = await signIn(s);
  const c = { s, token, dir };
  await until(async () => (await accountsOf(c)).accounts.every(a => a.signedOut || a.email || one));
  return c;
}

function signedIn(s, dir, on = true) {
  fs.writeFileSync(path.join(dir, 'auth-state.json'), JSON.stringify(on ? { loggedIn: true, email: 'second@example.com', orgId: 'org-hidden-2', subscriptionType: 'pro' } : { loggedIn: false }));
  fs.writeFileSync(path.join(s.home, `keychain-expiry-${serviceFor(dir)}`), String(on ? Date.now() + 20 * DAY : Date.now() - DAY));
}

const get = (c, url) => request(c.s, 'GET', url, { headers: as(c.token) });
const accountsOf = async c => (await get(c, '/api/accounts')).body();
const pin = (c, kind, id, account) => request(c.s, 'POST', '/api/layout/account', { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) }, json: { kind, id, account } });
const index = async c => (await get(c, '/api/sessions')).body();
const rowOf = async (c, id) => {
  const ix = await index(c);
  return [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.started, ...ix.ungrouped, ...ix.other].find(r => r.id === id);
};

async function shot(page, name) {
  if (!process.env.CAPCOM_SHOTS) return;
  fs.mkdirSync(process.env.CAPCOM_SHOTS, { recursive: true });
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(process.env.CAPCOM_SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

async function openPage(t, c, hash = '', { phone = false } = {}) {
  const page = await browser.open(`${c.s.origin}/`, { phone });
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
  await accountsKnown(page);
  if (hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  return page;
}

// A menu takes its items as it opens, so one opened before the page's own read of the accounts lands has no Account item.
const accountsKnown = page => page.until(`import('/ui/account-list.js').then(m => m.accountList.get().accounts !== null)`, 15_000);
// The page's own row, which a menu is built from, can lag the server's after a change.
const pageRow = (page, id) => `Promise.all([import('/ui/subs.js'), import('/ui/tree.js')]).then(([{ sessionIndex }, { findRow }]) => findRow(sessionIndex.get().ix, ${JSON.stringify(id)}))`;

const rightClick = (page, selector) => page.evaluate(`(el => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 40, clientY: r.y + r.height / 2 })); })(document.querySelector(${JSON.stringify(selector)}))`);
const itemsOf = (page, menu) => page.evaluate(`[...document.querySelectorAll('${menu} [role^=menuitem]')].map(el => el.querySelector('.menu-text').textContent + (el.getAttribute('aria-checked') === 'true' ? ' (checked)' : '') + (el.hasAttribute('data-disabled') ? ' (disabled)' : ''))`);
const labels = (page, menu = MENU) => page.evaluate(`[...document.querySelectorAll('${menu} [role^=menuitem] .menu-text')].map(el => el.textContent)`);
const choose = async (page, menu, label) => {
  await page.until(`[...document.querySelectorAll('${menu} [role^=menuitem] .menu-text')].some(el => el.textContent === ${JSON.stringify(label)})`, 15_000);
  await page.evaluate(`[...document.querySelectorAll('${menu} [role^=menuitem]')].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '')`);
  await page.click(`${menu} [data-picked]`);
};
const openSub = async (page, label) => {
  await choose(page, MENU, label);
  await page.until(`!!document.querySelector('${SUB}') && document.querySelector('${SUB}').dataset.state === 'open'`);
};
const rowMenu = async (page, id) => {
  await page.until(`!document.querySelector('.menu')`);
  await page.until(`!!document.querySelector('a.row[data-id="${id}"]')`);
  await rightClick(page, `a.row[data-id="${id}"]`);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
};

// Lists what the page posts as window.__posts ([url, body]) and holds its reads of the session index until window.__release() is called, so a test can send
// before the index has caught up with the server.
const hold = page => page.evaluate(`(() => {
  const real = window.fetch;
  const gate = new Promise(resolve => { window.__release = resolve; });
  window.__posts = [];
  window.fetch = async (url, init) => {
    const address = String(url);
    if (init?.method === 'POST') window.__posts.push([address, JSON.parse(init.body)]);
    else if (/^api\\/sessions(\\?|$)/.test(address)) await gate;
    return real(url, init);
  };
})()`);

const type = (page, text) => page.evaluate(`(el => { el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); })(document.querySelector('#text'))`);

test('with one account and nothing pinned the menus and the label show no account pick', { skip, timeout }, async t => {
  const c = await open({ one: true });
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#model') && !document.querySelector('#model').disabled`, 15_000);
  await page.click('#model');
  await page.until(`!!document.querySelector('${MENU}')`);
  assert.equal((await labels(page)).includes('Account'), false);
  assert.equal(await page.evaluate(`!!document.querySelector('#accountLabel')`), false);
  await page.press('Escape');
  await rowMenu(page, 'live');
  assert.equal((await labels(page)).includes('Account'), false);
  assert.deepEqual(page.problems, []);
});

test('with two accounts the model menu, the row menu, the group menu and the project menu each pick an account and call the route', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#model') && !document.querySelector('#model').disabled`, 15_000);
  await page.until(`!!document.querySelector('#accountLabel')`, 15_000);
  assert.equal(await page.evaluate(`document.querySelector('#accountLabel').textContent`), 'Main');
  await page.click('#model');
  await page.until(`!!document.querySelector('${MENU}')`);
  await openSub(page, 'Account');
  assert.deepEqual(await itemsOf(page, SUB), ['Active account (checked)', 'Main', 'Second']);
  assert.match(await page.evaluate(`document.querySelector('${SUB} .menu-note').textContent`), /^Takes effect at the next start\./);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('${SUB} .menu-note')].map(n => n.textContent)[1]`), 'Chrome works only on the account its extension is signed into.');
  await choose(page, SUB, 'Second');
  await until(async () => (await rowOf(c, 'live')).accountPin === 'second');
  await page.until(`document.querySelector('#accountLabel')?.textContent === 'Second'`);

  await rowMenu(page, 'other');
  await openSub(page, 'Account');
  assert.deepEqual(await itemsOf(page, SUB), ['Active account (checked)', 'Main', 'Second']);
  await choose(page, SUB, 'Second');
  await until(async () => (await rowOf(c, 'other')).accountPin === 'second');

  await page.evaluate(`location.hash = '#/'`);
  await page.until(`!document.querySelector('.menu') && !!document.querySelector('.group-head[data-key="cg-b"]')`);
  await rightClick(page, '.group-head[data-key="cg-b"]');
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  await openSub(page, 'Account');
  await choose(page, SUB, 'Second');
  await until(async () => (await index(c)).groups.find(g => g.id === 'cg-b').account === 'second');

  await page.until(`!document.querySelector('.menu')`);
  await page.evaluate(`localStorage.setItem('capcom.projectsDocked', 'true')`);
  await page.reload();
  await page.until(`!!document.querySelector('button[aria-label="Actions for Proj"]')`, 15_000);
  await accountsKnown(page);
  await page.click('button[aria-label="Actions for Proj"]');
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  await openSub(page, 'Account');
  await choose(page, SUB, 'Second');
  await until(async () => (await index(c)).projects.find(p => p.id === 'cp-a').account === 'second');
  assert.deepEqual(page.problems, []);
});

test('a pin to Active account clears the pin through the route', { skip, timeout }, async t => {
  const c = await open({ accounts: { live: 'second' } });
  const page = await openPage(t, c, '#/');
  await rowMenu(page, 'live');
  await openSub(page, 'Account');
  assert.deepEqual(await itemsOf(page, SUB), ['Active account', 'Main', 'Second (checked)', 'Main', 'Stay on Second (checked)']);
  await choose(page, SUB, 'Active account');
  await until(async () => (await rowOf(c, 'live')).accountPin === undefined);
});

test('a signed out account shows as signed out in the menu and cannot be picked', { skip, timeout }, async t => {
  const c = await open({ out: true });
  const page = await openPage(t, c, '#/');
  await rowMenu(page, 'live');
  await openSub(page, 'Account');
  assert.deepEqual(await itemsOf(page, SUB), ['Active account (checked)', 'Main', 'Second (disabled)']);
  assert.match(await page.evaluate(`[...document.querySelectorAll('${SUB} [role^=menuitem]')][2].textContent`), /Signed out/);
});

test('a session pinned with only one account listed still shows its pick', { skip, timeout }, async t => {
  const c = await open({ one: true, accounts: { live: 'main' } });
  const page = await openPage(t, c, '#/');
  await rowMenu(page, 'live');
  await page.until(`[...document.querySelectorAll('${MENU} .menu-text')].some(el => el.textContent === 'Account')`);
  await openSub(page, 'Account');
  assert.deepEqual(await itemsOf(page, SUB), ['Active account', 'Main (checked)']);
  await page.press('Escape');
  await page.until(`!document.querySelector('.menu')`);
  await rowMenu(page, 'other');
  assert.equal((await labels(page)).includes('Account'), false, 'a session with no pin shows none');
});

test('a refused send shows the notice with its buttons and keeps the text, before the index has caught up', { skip, timeout }, async t => {
  const c = await open({ accounts: { live: 'second' } });
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#model') && !document.querySelector('#model').disabled`, 15_000);
  assert.equal(await page.evaluate(`!!document.querySelector('#blocked')`), false);
  await hold(page);
  signedIn(c.s, c.dir, false);
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 409);
  await type(page, 'keep this text');
  await page.click('#send');
  await page.until(`document.querySelector('#text').value === 'keep this text' && !!document.querySelector('#blocked')`, 15_000);
  assert.match(await page.evaluate(`document.querySelector('#blocked').textContent`), /is pinned to Second, which is signed out\. Sign it in first\./);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.notice-action .btn')].map(b => b.textContent)`), ['Sign in to Second', 'Change the pin']);
  await shot(page, 'blocked-signed-out');

  await page.evaluate(`window.__release()`);
  await page.click('#blockedChange');
  await page.until(`!!document.querySelector('${MENU}')`);
  await choose(page, MENU, 'Active account');
  await until(async () => (await rowOf(c, 'live')).accountPin === undefined);
  await page.until(`!document.querySelector('#blocked')`);
});

test('a refused send leaves no notice behind once the pin is cleared from the row menu', { skip, timeout }, async t => {
  const c = await open({ accounts: { live: 'second' } });
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#model') && !document.querySelector('#model').disabled`, 15_000);
  await hold(page);
  signedIn(c.s, c.dir, false);
  assert.equal((await pin(c, 'session', 'other', 'second')).status, 409);
  await type(page, 'keep this text');
  await page.click('#send');
  await page.until(`!!document.querySelector('#blocked')`, 15_000);
  await page.evaluate(`window.__release()`);
  await page.until(`!!document.querySelector('#blocked')`);

  await rowMenu(page, 'live');
  await openSub(page, 'Account');
  await choose(page, SUB, 'Active account');
  await until(async () => (await rowOf(c, 'live')).accountPin === undefined);
  await page.until(`!document.querySelector('#blocked')`, 15_000);
  assert.equal(await page.evaluate(`document.querySelector('#text').value`), 'keep this text');
});

test('the composer of a new session in a group pinned to Second labels Second', { skip, timeout }, async t => {
  const c = await open();
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  const page = await openPage(t, c, '#/new/cg-b');
  await page.until(`document.querySelector('#accountLabel')?.textContent === 'Second'`, 15_000);
  await shot(page, 'composer-draft-pinned-group');
  const loose = await openPage(t, c, '#/new');
  await loose.until(`document.querySelector('#accountLabel')?.textContent === 'Main'`, 15_000);
});

test('a removed pin shows Clear the pin even with one account, and clearing it removes the notice', { skip, timeout }, async t => {
  const c = await open({ one: true, accounts: { live: 'gone' } });
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#blocked')`, 15_000);
  assert.match(await page.evaluate(`document.querySelector('#blocked').textContent`), /no longer lists/);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.notice-action .btn')].map(b => b.textContent)`), ['Clear the pin']);
  await shot(page, 'blocked-removed');
  await page.evaluate(`[...document.querySelectorAll('.notice-action .btn')][0].click()`);
  await until(async () => (await rowOf(c, 'live')).accountPin === undefined);
  await page.until(`!document.querySelector('#blocked')`);
});

test('a blocked group pin is cleared at the group, not at the session', { skip, timeout }, async t => {
  const c = await open({ one: true });
  const set = await pin(c, 'group', 'cg-a', 'main');
  assert.equal(set.status, 200);
  fs.writeFileSync(c.s.layout, JSON.stringify({ ...JSON.parse(fs.readFileSync(c.s.layout, 'utf8')), groups: JSON.parse(fs.readFileSync(c.s.layout, 'utf8')).groups.map(g => (g.id === 'cg-a' ? { ...g, account: 'gone' } : g)) }));
  const page = await openPage(t, c, '#/s/grouped');
  await page.until(`!!document.querySelector('#blocked')`, 20_000);
  await page.evaluate(`[...document.querySelectorAll('.notice-action .btn')].find(b => b.textContent === "Clear the group's pin").click()`);
  await until(async () => (await index(c)).groups.find(g => g.id === 'cg-a').account === undefined);
});

// Sets a group's pin to an account nobody lists, which the pin route refuses, by writing the layout.
const removeGroupAccount = (c, id) => {
  const layout = JSON.parse(fs.readFileSync(c.s.layout, 'utf8'));
  fs.writeFileSync(c.s.layout, JSON.stringify({ ...layout, groups: layout.groups.map(g => (g.id === id ? { ...g, account: 'gone' } : g)) }));
};

test('a session nested under a session in a pinned group names the group, and its button clears the group\'s pin', { skip, timeout }, async t => {
  const c = await open({ one: true, chips: [{ sessionId: 'grouped', startedId: 'nested', status: 'started', title: 'Follow up' }], sessions: [{ id: 'nested', title: 'Nested', source: 'cli', ago: 5 }] });
  assert.equal((await pin(c, 'group', 'cg-a', 'main')).status, 200);
  removeGroupAccount(c, 'cg-a');
  const page = await openPage(t, c, '#/s/nested');
  await page.until(`!!document.querySelector('#blocked')`, 20_000);
  assert.match(await page.evaluate(`document.querySelector('#blocked').textContent`), /^The group of the session it sits under \(Work\) is pinned to an account GhostShell no longer lists/);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.notice-action .btn')].map(b => b.textContent)`), ["Clear the group's pin"]);
  await shot(page, 'blocked-nested-group');
  await page.evaluate(`[...document.querySelectorAll('.notice-action .btn')][0].click()`);
  await until(async () => (await index(c)).groups.find(g => g.id === 'cg-a').account === undefined);
  await page.until(`!document.querySelector('#blocked')`, 15_000);
});

test('a group\'s own chat shows the notice of its group\'s pin, and it goes once the pin is cleared', { skip, timeout }, async t => {
  const CHAT = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
  const c = await open({ one: true, groups: [{ id: 'cg-a', name: 'Work', project: 'cp-a', session: CHAT }, GROUPS[1]] });
  assert.equal((await pin(c, 'group', 'cg-a', 'main')).status, 200);
  removeGroupAccount(c, 'cg-a');
  const page = await openPage(t, c, '#/g/cg-a');
  await page.until(`!!document.querySelector('#blocked')`, 20_000);
  await shot(page, 'blocked-group-chat');
  await page.evaluate(`[...document.querySelectorAll('.notice-action .btn')].find(b => b.textContent === "Clear the group's pin").click()`);
  await until(async () => (await index(c)).groups.find(g => g.id === 'cg-a').account === undefined);
  await page.until(`!document.querySelector('#blocked')`, 15_000);
});

test('a new session started in a group passes the group, so a group pin applies to its first turn, and is not moved after', { skip, timeout }, async t => {
  const c = await open();
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  const page = await openPage(t, c, '');
  await hold(page);
  await page.evaluate(`location.hash = '#/new/cg-b'`);
  await page.until(`!!document.querySelector('#text')`, 15_000);
  await type(page, 'begin a session');
  await page.until(`!document.querySelector('#send').disabled`);
  await page.click('#send');
  await page.evaluate(`window.__release()`);
  await page.until(`location.hash.startsWith('#/s/') || !!document.querySelector('#notice:not([hidden])')`, 15_000);
  const id = decodeURIComponent(await page.evaluate('location.hash')).slice(4);
  await until(async () => (await rowOf(c, id))?.group === 'cg-b');
  const made = await rowOf(c, id);
  assert.deepEqual([made.account, made.accountFrom], ['second', 'group']);
  const posts = await page.evaluate('window.__posts');
  assert.equal(posts.find(([url]) => url === 'api/new')[1].group, 'cg-b');
  assert.equal(posts.some(([url]) => url === 'api/layout/move'), false);
});

test('a new session picks its account in the composer and sends it', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/new');
  await page.until(`!!document.querySelector('#model') && !document.querySelector('#model').disabled`, 15_000);
  await page.click('#model');
  await page.until(`!!document.querySelector('${MENU}')`);
  await openSub(page, 'Account');
  await choose(page, SUB, 'Second');
  await page.until(`!document.querySelector('.menu')`);
  await page.evaluate(`(el => { el.value = 'begin a session'; el.dispatchEvent(new Event('input', { bubbles: true })); })(document.querySelector('#text'))`);
  await page.until(`!document.querySelector('#send').disabled`);
  await page.click('#send');
  await page.until(`location.hash.startsWith('#/s/')`, 15_000);
  const id = decodeURIComponent(await page.evaluate('location.hash')).slice(4);
  await until(async () => (await rowOf(c, id))?.accountPin === 'second');
});

const ROUTINE = { id: 'r1', title: 'Morning check', cron: '30 7 * * 1-5', jitterSeconds: 0, file: 'r1.md', cwd: '/tmp', model: null, effort: null, mode: null, account: null, enabled: false };

test('the routine form shows an Account pick with two accounts, none with one, and keeps one a routine already has', { skip, timeout }, async t => {
  const many = await open({ routines: [ROUTINE] });
  const page = await openPage(t, many, '#/routines/r1');
  await page.until(`!!document.querySelector('#routine-account')`, 15_000);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#routine-account option')].map(o => o.textContent)`), ['Active account', 'Main', 'Second']);
  assert.match(await page.evaluate(`document.querySelector('#routine-account').closest('.routine-field').textContent`), /Takes effect at the next start\..*Chrome works only on the account/);

  const lone = await open({ one: true, routines: [ROUTINE] });
  const plain = await openPage(t, lone, '#/routines/r1');
  await plain.until(`!!document.querySelector('#routine-title')`, 15_000);
  await new Promise(done => setTimeout(done, 500));
  assert.equal(await plain.evaluate(`!!document.querySelector('#routine-account')`), false);

  const pinned = await open({ one: true, routines: [{ ...ROUTINE, account: 'main' }] });
  const kept = await openPage(t, pinned, '#/routines/r1');
  await kept.until(`!!document.querySelector('#routine-account')`, 15_000);
  assert.equal(await kept.evaluate(`document.querySelector('#routine-account').value`), 'main');
});

test('when the survey proves Chrome is on Main, the Account menu, the routine form and the Accounts page say so, and with one account none of it shows', { skip, timeout }, async t => {
  const c = await open({ chrome: true, accounts: { live: 'second' }, routines: [ROUTINE] });
  await until(async () => (await accountsOf(c)).accounts.find(a => a.id === 'second').chromeOn === 'main');
  const page = await openPage(t, c, '#/');
  await rowMenu(page, 'other');
  await openSub(page, 'Account');
  assert.deepEqual(await itemsOf(page, SUB), ['Active account (checked)', 'Main', 'Second']);
  assert.match(await page.evaluate(`[...document.querySelectorAll('${SUB} [role^=menuitem]')][2].textContent`), /No Chrome/);
  assert.doesNotMatch(await page.evaluate(`[...document.querySelectorAll('${SUB} [role^=menuitem]')][1].textContent`), /No Chrome/);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('${SUB} .menu-note')].map(n => n.textContent)[1]`), "Chrome is on Main, so work on another account can't reach it.");
  await page.press('Escape');

  await page.evaluate(`location.hash = '#/routines/r1'`);
  await page.until(`!!document.querySelector('#routine-account')`, 15_000);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#routine-account option')].map(o => [o.textContent, o.disabled])`), [['Active account', false], ['Main', false], ['Second (no Chrome)', false]]);
  assert.match(await page.evaluate(`document.querySelector('#routine-account').closest('.routine-field').textContent`), /Chrome is on Main, so work on another account can't reach it\./);

  await page.evaluate(`location.hash = '#/accounts'`);
  await page.until(`document.querySelectorAll('#accounts .account').length === 2`, 15_000);
  const lines = await page.evaluate(`[...document.querySelectorAll('#accounts .account')].map(li => [...li.querySelectorAll('.account-line')].map(x => x.textContent))`);
  assert.deepEqual(lines[1].slice(1), ['Pinned: 1 session', "Chrome is on Main, so these can't reach it."]);
  assert.equal(lines[0].some(x => /Chrome/.test(x)), false, 'the account that has Chrome gets no line');

  const lone = await open({ one: true, chrome: true, accounts: { live: 'main' }, routines: [ROUTINE] });
  await new Promise(done => setTimeout(done, 500));
  assert.equal((await accountsOf(lone)).accounts.some(a => a.chromeOn), false);
  const plain = await openPage(t, lone, '#/accounts');
  await plain.until(`document.querySelectorAll('#accounts .account').length === 1`, 15_000);
  assert.equal(await plain.evaluate(`/Chrome/.test(document.querySelector('#accounts').textContent)`), false);
  assert.deepEqual(page.problems, []);
});

// Opens a menu and its Account submenu.
async function accountSub(page, open) {
  await open();
  await openSub(page, 'Account');
}
const post = (c, url, json) => request(c.s, 'POST', url, { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) }, json });
const pinTo = (c, kind, id, account, overflow) => post(c, '/api/layout/account', { kind, id, account, overflow });
const spare = (page, heading, label) => page.evaluate(`(() => {
  const group = [...document.querySelectorAll('${SUB} [role=group]')].find(g => g.getAttribute('aria-label') === ${JSON.stringify(heading)});
  [...group.querySelectorAll('[role^=menuitem]')].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '');
})()`).then(() => page.click(`${SUB} [data-picked]`));

test('the row menu of a pinned session picks and clears an overflow under the pinned account, and an unpinned one shows none', { skip, timeout }, async t => {
  const c = await open({ accounts: { live: 'second' } });
  const page = await openPage(t, c, '#/');
  await accountSub(page, () => rowMenu(page, 'other'));
  assert.deepEqual(await itemsOf(page, SUB), ['Active account (checked)', 'Main', 'Second'], 'no pin of its own, no overflow choices');
  await page.press('Escape');
  await accountSub(page, () => rowMenu(page, 'live'));
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('${SUB} [role=group] .menu-label')].map(el => el.textContent)`), ['If Second runs out']);
  await shot(page, 'overflow-menu-session-none');
  await spare(page, 'If Second runs out', 'Main');
  await until(async () => (await rowOf(c, 'live')).accountOverflow === 'main');
  await page.until(`${pageRow(page, 'live')}.then(r => r.accountOverflow === 'main')`);
  await accountSub(page, () => rowMenu(page, 'live'));
  assert.deepEqual(await itemsOf(page, SUB), ['Active account', 'Main', 'Second (checked)', 'Main (checked)', 'Stay on Second']);
  await shot(page, 'overflow-menu-session-main');
  await spare(page, 'If Second runs out', 'Stay on Second');
  await until(async () => (await rowOf(c, 'live')).accountOverflow === undefined);
  assert.equal((await rowOf(c, 'live')).accountPin, 'second', 'clearing the overflow keeps the pin');
  assert.deepEqual(page.problems, []);
});

test('the group and project menus pick an overflow, and a single account shows none', { skip, timeout }, async t => {
  const c = await open();
  assert.equal((await pinTo(c, 'group', 'cg-b', 'second')).status, 200);
  assert.equal((await pinTo(c, 'project', 'cp-a', 'second')).status, 200);
  const page = await openPage(t, c, '#/');
  await page.until(`!document.querySelector('.menu') && !!document.querySelector('.group-head[data-key="cg-b"]')`);
  await accountSub(page, async () => {
    await page.until(`!document.querySelector('.menu')`);
    await rightClick(page, '.group-head[data-key="cg-b"]');
    await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  });
  await spare(page, 'If Second runs out', 'Main');
  await until(async () => (await index(c)).groups.find(g => g.id === 'cg-b').overflow === 'main');
  await page.until(`!document.querySelector('.menu')`);
  await page.evaluate(`localStorage.setItem('capcom.projectsDocked', 'true')`);
  await page.reload();
  await page.until(`!!document.querySelector('button[aria-label="Actions for Proj"]')`, 15_000);
  await accountsKnown(page);
  await accountSub(page, async () => {
    await page.until(`!document.querySelector('.menu')`);
    await page.click('button[aria-label="Actions for Proj"]');
    await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  });
  await spare(page, 'If Second runs out', 'Main');
  await until(async () => (await index(c)).projects.find(p => p.id === 'cp-a').overflow === 'main');
  assert.deepEqual(page.problems, []);

  const one = await open({ one: true, accounts: { live: 'main' } });
  const alone = await openPage(t, one, '#/');
  await accountSub(alone, () => rowMenu(alone, 'live'));
  assert.equal(await alone.evaluate(`!!document.querySelector('${SUB} [role=group]')`), false);
});

test('a chat that spilled says so, adds the Chrome limit only when the survey proved it, and is silent otherwise', { skip, timeout }, async t => {
  const c = await open({ chrome: true });
  assert.equal((await pinTo(c, 'session', 'live', 'main', 'second')).status, 200);
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#model') && !document.querySelector('#model').disabled`, 15_000);
  assert.equal(await page.evaluate(`!!document.querySelector('.account-hint')`), false, 'nothing spilled, nothing said');
  assert.equal((await post(c, '/api/sessions/live/send', { text: 'hit the usage limit' })).status, 200);
  await until(async () => (await rowOf(c, 'live')).accountSpill === 'main');
  const hint = "Main is out of usage, so this session runs on Second until Main resets. Chrome is on Main, so it can't reach Chrome.";
  await page.until(`document.querySelector('.account-hint')?.textContent === ${JSON.stringify(hint)}`, 15_000);
  assert.equal(await page.evaluate(`document.querySelector('.account-hint').textContent`), hint);
  await shot(page, 'spill-line-chrome');
  assert.deepEqual(page.problems, []);
});

test('a chat that spilled with no Chrome survey says only that it moved', { skip, timeout }, async t => {
  const c = await open();
  assert.equal((await pinTo(c, 'session', 'live', 'main', 'second')).status, 200);
  assert.equal((await post(c, '/api/sessions/live/send', { text: 'hit the usage limit' })).status, 200);
  await until(async () => (await rowOf(c, 'live')).accountSpill === 'main');
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('.account-hint')`, 15_000);
  assert.equal(await page.evaluate(`document.querySelector('.account-hint').textContent`), 'Main is out of usage, so this session runs on Second until Main resets.');
  await shot(page, 'spill-line');
  assert.deepEqual(page.problems, []);
});

// ---- the account line on a chip card ----------------------------------------------------------------------------------------

const MAKER = { id: 'maker', title: 'Maker', source: 'cli', ago: 5, group: 'cg-b' };
const CHIP = { sessionId: 'maker', title: 'Follow up', prompt: 'begin a session' };
const transcriptOf = (c, id) => path.join(c.s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);

// Puts a suggested task in a session's transcript, as the chat's own tool writes it, so the page draws a card for it.
const plant = (c, id, ...uses) => {
  const lines = uses.map(([toolUseId, input = { title: 'Follow up', prompt: 'begin a session' }]) => ({ type: 'assistant', message: { id: `m-${toolUseId}`, role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'mcp__capcom__spawn_task', input }] } }));
  fs.appendFileSync(transcriptOf(c, id), lines.map(l => `${JSON.stringify(l)}\n`).join(''));
};

// The card's account lines and what its buttons say, in the order they sit.
const cardOf = page => page.evaluate(`(() => {
  const card = document.querySelector('.chip-card');
  const start = card.querySelector('[data-chip=start]');
  return {
    lines: [...card.querySelectorAll('p.chip-account')].map(p => p.textContent).filter(Boolean),
    state: card.querySelector('p.chip-account')?.dataset.state ?? null,
    buttons: [...card.querySelectorAll('.chip-actions .btn')].map(b => b.textContent),
    start: start ? { disabled: start.disabled } : null,
  };
})()`);
const cardUp = async (t, c, { chips, phone = false, width } = {}) => {
  const page = await openPage(t, c, '', { phone });
  if (width) await page.resize(width, 860);
  await page.evaluate(`location.hash = '#/s/maker'`);
  await page.until(`!!document.querySelector('.chip-card')`, 20_000);
  await page.until(`!!document.querySelector('.chip-card [data-chip=start]')`);
  return page;
};
const openCard = async (t, c, hash) => {
  const page = await openPage(t, c, hash ?? '#/s/maker');
  await page.until(`!!document.querySelector('.chip-card')`, 20_000);
  return page;
};
const MENU_BUTTON = '.chip-card [data-chip=account]';
const pickOnCard = async (page, label) => {
  await page.click(MENU_BUTTON);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  await choose(page, MENU, label);
  await page.until(`!document.querySelector('${MENU}')`);
};
const plainOpen = async opts => {
  const c = await open({ sessions: [MAKER], ...opts });
  plant(c, 'maker', ['toolu_a']);
  return c;
};

test('a card with one account listed shows no account line and posts no account', { skip, timeout }, async t => {
  const c = await plainOpen({ one: true, chips: [{ ...CHIP, toolUseId: 'toolu_a' }] });
  const page = await openCard(t, c);
  assert.deepEqual(await cardOf(page), { lines: [], state: null, buttons: ['Start session', 'Dismiss'], start: { disabled: false } });
  await page.evaluate(`window.__posts = []; const real = window.fetch; window.fetch = (u, i) => { if (i?.method === 'POST') window.__posts.push([String(u), JSON.parse(i.body)]); return real(u, i); }`);
  await page.click('.chip-card [data-chip=start]');
  await until(async () => (await page.evaluate(`window.__posts.length`)) === 1);
  const [url, body] = (await page.evaluate(`window.__posts`))[0];
  assert.equal(url, 'api/chips/start');
  assert.equal(Object.hasOwn(body, 'account') || Object.hasOwn(body, 'confirmAccount'), false);
  assert.deepEqual(page.problems, []);
});

test('a card that follows the active account says so, and Start posts a null account with the account it confirms', { skip, timeout }, async t => {
  const c = await plainOpen({ chips: [{ ...CHIP, toolUseId: 'toolu_a' }] });
  const page = await openCard(t, c);
  assert.deepEqual(await cardOf(page), { lines: ['Starts on Main, the active account.'], state: 'ok', buttons: ['Start session', 'Change account', 'Dismiss'], start: { disabled: false } });
  await shot(page, 'chip-follows-active');
  await page.evaluate(`window.__posts = []; const real = window.fetch; window.fetch = (u, i) => { if (i?.method === 'POST') window.__posts.push([String(u), JSON.parse(i.body)]); return real(u, i); }`);
  await page.click('.chip-card [data-chip=start]');
  await until(async () => (await page.evaluate(`window.__posts.length`)) === 1);
  const [, body] = (await page.evaluate(`window.__posts`))[0];
  assert.deepEqual([body.account, body.confirmAccount], [null, 'main']);
  await page.until(`!!document.querySelector('.chip-card a.btn')`, 20_000);
  assert.deepEqual(await cardOf(page), { lines: [], state: null, buttons: ['Open the session'], start: null });
  assert.deepEqual(page.problems, []);
});

test('a card in a pinned group names the account and the group that pins it', { skip, timeout }, async t => {
  const c = await plainOpen({ chips: [{ ...CHIP, toolUseId: 'toolu_a' }] });
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  const page = await openCard(t, c);
  assert.deepEqual((await cardOf(page)).lines, ['Starts on Second, pinned to the group Loose.']);
  await shot(page, 'chip-group-pin');
  assert.deepEqual(page.problems, []);
});

test('a card for a chip that names an account says the chip chose it, and the pick on the card wins over the chip', { skip, timeout }, async t => {
  const c = await plainOpen({ chips: [{ ...CHIP, toolUseId: 'toolu_a', account: 'second' }] });
  const page = await openCard(t, c);
  assert.deepEqual((await cardOf(page)).lines, ['Starts on Second, chosen by this chip.']);
  await shot(page, 'chip-named');
  await page.click(MENU_BUTTON);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  assert.deepEqual(await itemsOf(page, MENU), ['Follow the pins', 'Main', 'Second (checked)']);
  await shot(page, 'chip-menu');
  await choose(page, MENU, 'Main');
  await page.until(`!document.querySelector('${MENU}')`);
  await page.until(`document.querySelector('.chip-card p.chip-account')?.textContent === 'Starts on Main, picked here.'`);
  await shot(page, 'chip-picked');
  await pickOnCard(page, 'Follow the pins');
  await page.until(`document.querySelector('.chip-card p.chip-account')?.textContent === 'Starts on Main, the active account.'`);
  assert.deepEqual(page.problems, []);
});

test('a chip that names an account other than its group\'s pin says it replaces the pin, and one Start confirms it', { skip, timeout }, async t => {
  const c = await plainOpen({ chips: [{ ...CHIP, toolUseId: 'toolu_a', account: 'main' }] });
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  const page = await openCard(t, c);
  assert.deepEqual((await cardOf(page)).lines, ['Starts on Main, chosen by this chip.', 'This replaces the pin to Second on the group Loose. The session has no overflow account.']);
  await shot(page, 'chip-replaces');
  await page.evaluate(`window.__posts = []; const real = window.fetch; window.fetch = (u, i) => { if (i?.method === 'POST') window.__posts.push([String(u), JSON.parse(i.body)]); return real(u, i); }`);
  await page.click('.chip-card [data-chip=start]');
  await until(async () => (await page.evaluate(`window.__posts.length`)) === 1);
  const [, body] = (await page.evaluate(`window.__posts`))[0];
  assert.deepEqual([body.account, body.confirmAccount], ['main', 'main']);
  await page.until(`!!document.querySelector('.chip-card a.btn')`, 20_000);
  assert.equal((await index(c)).groups.find(g => g.id === 'cg-b').account, 'second', 'the group keeps its own pin');
  assert.deepEqual(page.problems, []);
});

test('a signed out account stops Start and offers Sign in, which asks the server for the sign-in', { skip, timeout }, async t => {
  const c = await plainOpen({ out: true, chips: [{ ...CHIP, toolUseId: 'toolu_a', account: 'second' }] });
  const page = await openCard(t, c);
  const card = await cardOf(page);
  assert.deepEqual([card.lines, card.state, card.start, card.buttons], [['Second is signed out. Sign it in, or pick another account.'], 'signedOut', { disabled: true }, ['Start session', 'Sign in to Second', 'Change account', 'Dismiss']]);
  await shot(page, 'chip-signed-out');
  await page.evaluate(`window.__posts = []; const real = window.fetch; window.fetch = (u, i) => { if (i?.method === 'POST') window.__posts.push([String(u), JSON.parse(i.body)]); return real(u, i); }`);
  await page.evaluate(`[...document.querySelectorAll('.chip-card .btn')].find(b => b.textContent === 'Sign in to Second').click()`);
  await until(async () => (await page.evaluate(`window.__posts.map(p => p[0])`)).includes('api/accounts/second/sign-in'));
  await pickOnCard(page, 'Main');
  await page.until(`!document.querySelector('.chip-card [data-chip=start]').disabled`);
  assert.deepEqual((await cardOf(page)).lines, ['Starts on Main, picked here.']);
});

test('an account that is no longer listed stops Start, says so, and offers no Sign in', { skip, timeout }, async t => {
  const c = await plainOpen({ accounts: { maker: 'vanished' }, chips: [{ ...CHIP, toolUseId: 'toolu_a' }] });
  const page = await openCard(t, c);
  const card = await cardOf(page);
  assert.match(card.lines[0], /no longer lists|no longer listed/);
  assert.deepEqual([card.state, card.start, card.buttons], ['removed', { disabled: true }, ['Start session', 'Change account', 'Dismiss']]);
  await shot(page, 'chip-removed');
  await pickOnCard(page, 'Second');
  await page.until(`!document.querySelector('.chip-card [data-chip=start]').disabled`);
  assert.deepEqual((await cardOf(page)).lines.slice(0, 1), ['Starts on Second, picked here.']);
});

test('a card with a stored account the page cannot confirm because it has no account list shows no line, and Start gives the refusal in words and starts nothing', { skip, timeout }, async t => {
  const c = await plainOpen({ chips: [{ ...CHIP, toolUseId: 'toolu_a', account: 'second' }] });
  const page = await openPage(t, c, '');
  await page.evaluate(`import('/ui/account-list.js').then(m => m.accountList.set({ accounts: null, at: Date.now() + 3_600_000 }))`);
  await page.evaluate(`location.hash = '#/s/maker'`);
  await page.until(`!!document.querySelector('.chip-card [data-chip=start]')`, 20_000);
  assert.deepEqual(await cardOf(page), { lines: [], state: null, buttons: ['Start session', 'Dismiss'], start: { disabled: false } });
  const before = cliCalls(c.s).length;
  await page.click('.chip-card [data-chip=start]');
  await page.until(`/This chip names an account/.test(document.body.textContent)`, 15_000);
  assert.equal(cliCalls(c.s).length, before, 'nothing started');
  assert.equal(await page.evaluate(`!!document.querySelector('.chip-card [data-chip=start]')`), true, 'the card is still open');
  assert.deepEqual(page.problems.filter(p => !/400/.test(p)), []);
});

test('a card follows a pin set from the sidebar and an account that signs out, without the chat being reopened', { skip, timeout }, async t => {
  const c = await plainOpen({ chips: [{ ...CHIP, toolUseId: 'toolu_a' }] });
  const page = await openCard(t, c);
  assert.deepEqual((await cardOf(page)).lines, ['Starts on Main, the active account.']);
  await rightClick(page, '.group-head[data-key="cg-b"]');
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
  await openSub(page, 'Account');
  await choose(page, SUB, 'Second');
  await page.until(`document.querySelector('.chip-card p.chip-account')?.textContent === 'Starts on Second, pinned to the group Loose.'`, 20_000);
  signedIn(c.s, c.dir, false);
  assert.equal((await request(c.s, 'POST', '/api/accounts/second/use', { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) }, json: {} })).status >= 200, true);
  await page.until(`/Second is signed out/.test(document.querySelector('.chip-card p.chip-account')?.textContent || '')`, 30_000);
  assert.equal(await page.evaluate(`document.querySelector('.chip-card [data-chip=start]').disabled`), true);
});

test('a card the server did not store follows the pins of the session it was drawn in', { skip, timeout }, async t => {
  const c = await open({ sessions: [MAKER] });
  assert.equal((await pin(c, 'group', 'cg-b', 'second')).status, 200);
  plant(c, 'maker', ['toolu_unstored', { title: 'Follow up', prompt: 'begin a session', account: 'main' }]);
  const page = await openCard(t, c);
  assert.deepEqual((await cardOf(page)).lines, ['Starts on Second, pinned to the group Loose.'], 'the tool input in the transcript is not used');
});
