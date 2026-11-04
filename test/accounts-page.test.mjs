// Run with `npm test`. The Accounts pane, the sidebar banner for an account that is out of usage and the switch in a chat, in the real page against the real server
// with the stub keychain tool and stub CLIs of test/harness.mjs. It needs Playwright's Chromium headless shell, and every test skips with a reason that names
// where it looked when there is none. CAPCOM_SHOTS=<folder> also saves a screenshot of each state there.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serviceFor } from '../lib/accounts.mjs';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, openCalls, PASSWORD, request, restart, signIn, start, until } from './harness.mjs';

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

const row = (over = {}) => ({ kind: 'weekly_all', group: 'weekly', percent: 71, severity: 'normal', resets_at: new Date(Date.now() + 3 * DAY).toISOString(), scope: null, is_active: true, ...over });

// With `chrome`, Chrome is set up and the first account's folder sees a browser on this Mac, so a switch to the second finds Chrome still on the first.
async function open({ second = true, same = false, chrome = false } = {}) {
  const first = await start({ claude: true, sessions: [{ id: 'live', title: 'Runs', source: 'cli', ago: 1 }, { id: 'other', title: 'Fix the build', source: 'cli', ago: 2 }] });
  const dir = path.join(first.state, 'accounts', 'second');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(first.state, 'accounts.json'), JSON.stringify({ active: 'main', autoSwitch: false, accounts: [{ id: 'main', name: 'Main' }, ...(second ? [{ id: 'second', name: 'Second', dir }] : [])] }));
  fs.writeFileSync(path.join(first.home, 'auth-state.json'), JSON.stringify(same ? { email: 'same@example.com', orgId: 'org-same' } : { email: 'main@example.com' }));
  fs.writeFileSync(path.join(dir, 'auth-state.json'), JSON.stringify(same ? { loggedIn: true, email: 'same@example.com', orgId: 'org-same' } : { loggedIn: true, email: 'second@example.com', orgId: 'org-2', subscriptionType: 'pro' }));
  fs.writeFileSync(path.join(first.home, `keychain-expiry-${serviceFor(dir)}`), String(Date.now() + 20 * DAY));
  if (chrome) {
    fs.writeFileSync(path.join(first.home, '.claude.json'), JSON.stringify({ cachedChromeExtensionInstalled: true }));
    fs.writeFileSync(path.join(first.home, 'chrome-state.json'), JSON.stringify({ browsers: [{ deviceId: 'd1', name: 'Fake', osPlatform: 'darwin', connectedAt: 1, isLocal: true, inUse: false }] }));
  }
  fs.writeFileSync(path.join(dir, 'plan-usage.json'), JSON.stringify([row({ kind: 'session', group: 'session', percent: 34, resets_at: new Date(Date.now() + 2 * 3_600_000).toISOString() }), row()]));
  const s = await restart(first);
  const { token } = await signIn(s);
  const c = { s, token, dir };
  await until(async () => (await request(s, 'GET', '/api/accounts', { headers: as(token) })).body().accounts.every(a => a.email));
  return c;
}

const post = (c, url, json = {}) => request(c.s, 'POST', url, { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) }, json });
const accounts = async c => (await request(c.s, 'GET', '/api/accounts', { headers: as(c.token) })).body();

async function shot(page, name) {
  if (!process.env.CAPCOM_SHOTS) return;
  fs.mkdirSync(process.env.CAPCOM_SHOTS, { recursive: true });
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(process.env.CAPCOM_SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

async function openPage(t, c, hash = '', { phone = false, before = '' } = {}) {
  const page = await browser.open(`${c.s.origin}/`, { phone });
  t.after(() => page.close());
  if (before) await page.call('Page.addScriptToEvaluateOnNewDocument', { source: before });
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || !!document.querySelector('.list-foot'))`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
  }
  await page.until(`!document.querySelector('#boot') && !!document.querySelector('.list-foot')`, 10_000);
  if (await page.until(`!!document.querySelector('.offer')`, 1500).then(() => true, () => false)) {
    await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(b => b.textContent === 'Not now')?.click()`);
  }
  if (hash) {
    if (before) await page.evaluate('location.reload()');
    await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  }
  return page;
}

const rows = `[...document.querySelectorAll('#accounts .account')].map(li => ({
  name: li.querySelector('.account-name')?.textContent.trim(),
  active: !!li.querySelector('.badge'),
  meta: [...li.querySelectorAll('.account-meta span')].map(x => x.textContent),
  line: li.querySelector('.account-line')?.textContent,
  buttons: [...li.querySelectorAll('.account-actions button')].map(b => b.textContent.trim()),
  plan: [...li.querySelectorAll('.plan-row')].map(r => r.querySelector('.plan-label').textContent + ' ' + r.querySelector('.plan-percent').textContent),
  chats: [...li.querySelectorAll('.account-chats li')].map(x => x.textContent),
  links: [...li.querySelectorAll('.account-chats a')].map(x => x.getAttribute('href')),
}))`;

test('the Accounts pane lists each account with its email, plan, sign-in end, plan usage and running chats, and switches on one press', { skip, timeout }, async t => {
  const c = await open();
  await post(c, '/api/accounts/second/use');
  await request(c.s, 'POST', '/api/sessions/other/send', { headers: { origin: c.s.origin, ...as(c.token) }, json: { text: 'ask for approval' } });
  await until(async () => (await accounts(c)).accounts[1].chats[0]?.state === 'waiting');
  await post(c, '/api/accounts/main/use');
  const page = await openPage(t, c, '#/accounts');
  await page.until(`document.querySelectorAll('#accounts .account').length === 2 && !!document.querySelector('#accounts .plan-row')`, 15_000);
  const [main, second] = await page.evaluate(rows);
  assert.deepEqual([main.name, main.active, main.meta, main.buttons], ['Main Active', true, ['main@example.com', 'max'], ['Rename']]);
  assert.match(main.line, /^Signed in until \w{3} \d{1,2} \w{3}, \d\d:\d\d$/);
  assert.deepEqual([second.name, second.active, second.meta, second.buttons], ['Second', false, ['second@example.com', 'pro'], ['Switch to this', 'Rename']]);
  assert.deepEqual(second.plan, ['Current session 34%', 'Weekly · All models 71%']);
  assert.deepEqual([second.chats, second.links], [['Fix the buildWaiting for approval'], ['#/s/other']]);
  assert.equal(await page.evaluate(`document.title`).then(x => x.includes('Accounts')), true);
  const roles = await page.evaluate(`({ alerts: document.querySelectorAll('#accounts [role=alert]').length, status: document.querySelectorAll('#accounts [role=status]').length, marked: document.querySelector('.list-foot .foot-account')?.hasAttribute('data-current') })`);
  assert.deepEqual([roles.alerts > 0, roles.status > 0, roles.marked], [true, true, true]);
  await shot(page, 'a-accounts-pane');

  await page.click('#accounts .account:nth-child(2) .account-actions button');
  await page.until(`document.querySelector('#accounts .account:nth-child(2) .badge')`, 10_000);
  assert.equal((await accounts(c)).accounts.find(a => a.active).id, 'second');
});

test('Rename opens a box in the row, saves on Enter, refuses a name another account has, and puts the focus back on the button', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/accounts');
  await page.until(`document.querySelectorAll('#accounts .account').length === 2`, 15_000);
  const rename = `#accounts .account:nth-child(2) .account-actions button[aria-label="Rename Second"]`;
  await page.click(rename);
  await page.until(`document.activeElement?.matches('#accounts .name-form input')`);
  await page.evaluate(`(el => { el.value = 'Main'; el.dispatchEvent(new Event('input', { bubbles: true })); })(document.activeElement)`);
  await page.press('Enter');
  await page.until(`document.querySelector('#accounts .account:nth-child(2) .notice')?.textContent.includes('already has that name')`);
  await page.evaluate(`(el => { el.value = 'Work'; el.dispatchEvent(new Event('input', { bubbles: true })); })(document.activeElement)`);
  await page.press('Enter');
  await page.until(`document.querySelector('#accounts .account:nth-child(2) .account-name')?.textContent.trim() === 'Work'`);
  await page.until(`document.activeElement?.getAttribute('aria-label') === 'Rename Work'`);
  assert.equal((await accounts(c)).accounts[1].name, 'Work');
});

test('adding an account says to approve the sign-in page on the Mac with the account wanted, holds the form while it waits, and lists the account once it is signed in', { skip, timeout }, async t => {
  const c = await open();
  fs.writeFileSync(path.join(c.s.home, 'auth-state-next.json'), JSON.stringify({ hold: true, signInAs: { email: 'third@example.com', orgId: 'org-3', subscriptionType: 'max' } }));
  const page = await openPage(t, c, '#/accounts');
  await page.until(`document.querySelectorAll('#accounts .account').length === 2 && !!document.querySelector('#account-name')`, 15_000);
  assert.equal(await page.evaluate(`document.querySelector('#account-add-hint').textContent`), 'Signing in opens a page in the browser on the Mac. Approve it with the Claude account you want to add.');
  await page.evaluate(`(el => { el.focus(); el.value = 'Work'; el.dispatchEvent(new Event('input', { bubbles: true })); })(document.querySelector('#account-name'))`);
  await page.click('.account-add button[type=submit]');
  await page.until(`document.querySelectorAll('#accounts .account').length === 3`, 10_000);
  const status = `document.querySelector('#accounts .account:nth-child(3) .account-progress')`;
  await page.until(`${status}?.textContent === 'Approve the sign-in page in the browser on the Mac, with the Claude account you want for Work.'`);
  assert.equal(await page.evaluate(`${status}.getAttribute('role')`), 'status');
  const held = await page.evaluate(`({ add: document.querySelector('.account-add button').getAttribute('aria-disabled'), sign: document.querySelector('#accounts .account:nth-child(3) .account-actions button').textContent, other: [...document.querySelectorAll('#accounts .account:nth-child(-n+2) .account-actions button')].filter(b => b.textContent === 'Sign in').length })`);
  assert.deepEqual([held.add, held.sign], ['true', 'Waiting for the Mac']);
  await shot(page, 'd-add-progress');

  fs.writeFileSync(path.join(c.s.home, 'auth-release'), '');
  await page.until(`/^Signed in until/.test(document.querySelector('#accounts .account:nth-child(3) .account-line')?.textContent)`, 15_000);
  assert.deepEqual((await page.evaluate(rows))[2].meta, ['third@example.com', 'max']);
  assert.equal(await page.evaluate(`${status}.textContent`), '');
});

test('two accounts approved as one Claude account get a warning on each', { skip, timeout }, async t => {
  const c = await open({ same: true });
  const page = await openPage(t, c, '#/accounts');
  await page.until(`document.querySelectorAll('#accounts .routine-alert').length === 2`, 15_000);
  const text = await page.evaluate(`document.querySelector('#accounts .routine-alert').textContent`);
  assert.match(text, /^This is the same Claude account as Second\./);
});

test('the setting to switch by itself is a checkbox that saves on a press and says what it does', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/accounts');
  await page.until(`!!document.querySelector('.account-auto input')`, 15_000);
  assert.match(await page.evaluate(`document.getElementById('account-auto-hint').textContent`), /runs out of usage, new messages go to another signed-in account/);
  await page.click('.account-auto input');
  await until(async () => (await accounts(c)).autoSwitch === true);
  assert.equal(await page.evaluate(`document.querySelector('.account-auto input').checked`), true);
});

test('an active account that is out of usage shows a banner with the CLI\'s words and a Switch button, and the switch clears it', { skip, timeout }, async t => {
  const c = await open();
  await request(c.s, 'POST', '/api/sessions/live/send', { headers: { origin: c.s.origin, ...as(c.token) }, json: { text: 'hit the usage limit' } });
  await until(async () => (await accounts(c)).accounts[0].out);
  const page = await openPage(t, c);
  await page.until(`!!document.querySelector('aside.offer[aria-labelledby=banner-out-title]')`, 15_000);
  const banner = await page.evaluate(`(a => ({ title: a.querySelector('h2').textContent, text: a.querySelector('.offer-text').textContent, tone: a.dataset.tone, icon: !!a.querySelector('h2 svg'), buttons: [...a.querySelectorAll('button')].map(b => b.textContent), alert: !!a.querySelector('[role=alert]') }))(document.querySelector('aside.offer[aria-labelledby=banner-out-title]'))`);
  assert.deepEqual(banner, { title: 'Main is out of usage', text: "You've hit your limit, resets at 3pm", tone: 'warning', icon: true, buttons: ['Switch to Second'], alert: true });
  await shot(page, 'b-out-of-usage-banner');
  await page.click('aside.offer[aria-labelledby=banner-out-title] button');
  await page.until(`!document.querySelector('aside.offer[aria-labelledby=banner-out-title]')`, 10_000);
  assert.equal((await accounts(c)).accounts.find(a => a.active).id, 'second');
});

test('a switch by itself is announced in the sidebar until it is dismissed', { skip, timeout }, async t => {
  const c = await open();
  await post(c, '/api/accounts/auto', { on: true });
  await request(c.s, 'POST', '/api/sessions/live/send', { headers: { origin: c.s.origin, ...as(c.token) }, json: { text: 'hit the usage limit' } });
  await until(async () => (await accounts(c)).auto);
  const page = await openPage(t, c);
  const sel = 'aside.offer[aria-labelledby=banner-auto-title]';
  await page.until(`!!document.querySelector('${sel}')`, 15_000);
  assert.equal(await page.evaluate(`document.querySelector('${sel} .offer-text').textContent`), 'Main ran out of usage, so new messages now go to Second.');
  await page.click(`${sel} button`);
  await page.until(`!document.querySelector('${sel}')`, 10_000);
  assert.equal((await accounts(c)).auto, null);
});

test('a chat whose turn ran out of usage offers to switch and continue, and the press switches and sends Continue.', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#notice') && !!document.querySelector('.btn.context, textarea, .composer')`, 15_000);
  await page.evaluate(`window.asked = []; const real = window.fetch; window.fetch = (...a) => { window.asked.push(String(a[0])); return real(...a); }`);
  await request(c.s, 'POST', '/api/sessions/live/send', { headers: { origin: c.s.origin, ...as(c.token) }, json: { text: 'hit the usage limit' } });
  await page.until(`!!document.querySelector('.notice-action button')`, 15_000);
  assert.equal(await page.evaluate(`window.asked.includes('api/accounts')`), false, 'the pick comes from api/banners');
  assert.equal(await page.evaluate(`document.querySelector('#notice').textContent`), "You've hit your limit, resets at 3pm");
  assert.equal(await page.evaluate(`document.querySelector('.notice-action button').textContent`), 'Switch to Second and continue');
  await shot(page, 'c-chat-switch-and-continue');
  await page.click('.notice-action button');
  await until(() => cliCalls(c.s).some(x => x.user === 'Continue.'));
  assert.equal((await accounts(c)).accounts.find(a => a.active).id, 'second');
  await page.until(`!document.querySelector('.notice-action button')`, 10_000);
});

test('a transient limit in a chat shows its error and no switch button', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/s/live');
  await page.until(`!!document.querySelector('#notice') && !!document.querySelector('.composer, textarea')`, 15_000);
  await request(c.s, 'POST', '/api/sessions/live/send', { headers: { origin: c.s.origin, ...as(c.token) }, json: { text: 'hit a busy limit' } });
  await page.until(`document.querySelector('#notice').textContent === 'API Error: Request rejected (429)'`, 15_000);
  assert.equal(await page.evaluate(`!!document.querySelector('.notice-action')`), false);
});

test('in front of a server that has no accounts, the page shows no link, no pane and no banner', { skip, timeout }, async t => {
  const c = await open();
  await request(c.s, 'POST', '/api/sessions/live/send', { headers: { origin: c.s.origin, ...as(c.token) }, json: { text: 'hit the usage limit' } });
  await until(async () => (await accounts(c)).accounts[0].out);
  const old = `const real = window.fetch; window.fetch = async (...a) => { const r = await real(...a); if (String(a[0]) !== 'api/sessions') return r; const j = await r.json(); delete j.features.accounts; return new Response(JSON.stringify(j), { status: r.status }); };`;
  const page = await openPage(t, c, '#/accounts', { before: old });
  await page.until(`!!document.querySelector('.list-foot .foot-account')`, 15_000);
  await new Promise(done => setTimeout(done, 500));
  await page.click('.list-foot .foot-account');
  await page.until(`!!document.querySelector('.menu [role=menuitem]')`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.menu [role=menuitem]')].map(el => el.textContent)`), ['Passkeys', 'Sign out']);
  assert.deepEqual(await page.evaluate(`({ pane: !!document.querySelector('#accounts'), banner: !!document.querySelector('aside.offer[aria-labelledby=banner-out-title]') })`), { pane: false, banner: false });
});

test('the footer has Routines, Scheduled and an Account menu that a key opens, and the menu marks the page on screen', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/accounts');
  await page.until(`document.querySelector('.list-foot .foot-account')?.hasAttribute('data-current')`, 15_000);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.list-foot .foot-links a')].map(a => a.textContent)`), ['Routines', 'Scheduled']);
  await page.evaluate(`document.querySelector('.list-foot .foot-account').focus()`);
  await page.press('ArrowDown');
  await page.until(`document.activeElement?.closest('.menu') && document.activeElement.textContent === 'Accounts'`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.menu [role=menuitem]')].map(el => [el.textContent, el.getAttribute('aria-current')])`), [['Accounts', 'page'], ['Passkeys', null], ['Sign out', null]]);
  await page.press('ArrowDown');
  await page.press('Enter');
  await page.until(`location.hash === '#/passkeys' && !document.querySelector('.menu')`);
  assert.equal(await page.evaluate(`document.querySelector('.list-foot .foot-account').hasAttribute('data-current')`), true);
});

test('the footer keeps to one line on a phone 320px wide', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '', { phone: true });
  await page.resize(320, 568);
  await page.until(`document.querySelectorAll('.list-foot .foot-links a').length === 2`, 15_000);
  assert.equal(await page.evaluate(`new Set([...document.querySelectorAll('.list-foot a, .list-foot button')].map(el => Math.round(el.getBoundingClientRect().top))).size`), 1);
});

test('the pane fits a phone and has no sideways scroll', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/accounts', { phone: true });
  await page.until(`document.querySelectorAll('#accounts .account').length === 2`, 15_000);
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth && document.querySelector('.accounts-body').scrollWidth <= document.querySelector('.accounts-body').clientWidth`), true);
});

const chromeSel = 'aside.offer[aria-labelledby=banner-chrome-title]';
const chromeView = `(a => ({ title: a.querySelector('h2').textContent, text: a.querySelector('.offer-text').textContent, tone: a.dataset.tone, icon: !!a.querySelector('h2 svg'), steps: [...a.querySelectorAll('ol.offer-list li')].map(x => x.textContent), warning: a.querySelector('ol.offer-list + .offer-text').textContent, buttons: [...a.querySelectorAll('button')].map(b => b.textContent), inPane: !!a.closest('#accounts') }))(document.querySelector('${chromeSel}'))`;

test('a switch on the Accounts pane shows the Chrome banner in the pane and not in the sidebar, Open shows its progress, and Dismiss clears it', { skip, timeout }, async t => {
  const c = await open({ chrome: true });
  const page = await openPage(t, c, '#/accounts');
  await page.until(`document.querySelectorAll('#accounts .account').length === 2`, 15_000);
  assert.equal(await page.evaluate(`!!document.querySelector('${chromeSel}')`), false);
  await page.click('#accounts .account:nth-child(2) .account-actions button');
  await page.until(`!!document.querySelector('${chromeSel}')`, 15_000);
  assert.deepEqual(await page.evaluate(chromeView), {
    title: 'Chrome is still on Main',
    text: "Chats on Second can't use Chrome until the Claude extension is on Second too.",
    tone: 'warning',
    icon: true,
    steps: ['Press Log out in the settings.', 'Log in with second@example.com, picking it on the sign-in page.'],
    warning: "Logging out deletes the extension's saved shortcuts and scheduled tasks.",
    buttons: ['Open in Chrome on the Mac', 'Dismiss'],
    inPane: true,
  });
  assert.equal(await page.evaluate(`document.querySelectorAll('${chromeSel}').length`), 1, 'one banner, none in the sidebar');
  await shot(page, 'e-chrome-banner');

  await page.click(`${chromeSel} .offer-actions button`);
  await page.until(`document.querySelector('${chromeSel} .offer-progress')?.textContent === 'Opened on the Mac. This clears once Chrome is on Second.'`, 10_000);
  assert.deepEqual(openCalls(c.s).at(-1), ['-a', 'Google Chrome', 'https://clau.de/chrome/permissions']);

  fs.writeFileSync(path.join(c.s.home, 'open-fails'), '');
  await page.click(`${chromeSel} .offer-actions button`);
  await page.until(`document.querySelector('${chromeSel} .notice')?.textContent.startsWith('Could not open Chrome')`, 10_000);
  assert.equal(await page.evaluate(`document.querySelector('${chromeSel} .offer-progress').textContent`), '', 'a refused press does not claim Chrome opened');

  await page.click(`${chromeSel} .offer-actions button:last-child`);
  await page.until(`!document.querySelector('${chromeSel}')`, 10_000);
  assert.equal((await accounts(c)).chrome, null);
});

test('on another route the sidebar shows the Chrome banner, and the pane takes it over when the Accounts page opens', { skip, timeout }, async t => {
  const c = await open({ chrome: true });
  await post(c, '/api/accounts/second/use');
  await until(async () => (await accounts(c)).chrome?.state === 'elsewhere');
  const page = await openPage(t, c);
  await page.until(`!!document.querySelector('${chromeSel}')`, 15_000);
  assert.deepEqual(await page.evaluate(chromeView).then(v => [v.title, v.inPane]), ['Chrome is still on Main', false]);

  await page.evaluate(`location.hash = '#/accounts'`);
  await page.until(`!!document.querySelector('#accounts ${chromeSel}')`, 15_000);
  assert.equal(await page.evaluate(`document.querySelectorAll('${chromeSel}').length`), 1);

  await page.click(`${chromeSel} .offer-actions button:last-child`);
  await page.until(`!document.querySelector('${chromeSel}')`, 10_000);
  await page.evaluate(`location.hash = '#/'`);
  await new Promise(done => setTimeout(done, 500));
  assert.equal(await page.evaluate(`!!document.querySelector('${chromeSel}')`), false, 'dismissed for good');
});
