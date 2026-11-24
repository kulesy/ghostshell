// Run with `npm test`. The Settings pane and its Account menu item, in the real page against the real server. It needs Playwright's Chromium headless shell, and every
// test skips with a reason that names where it looked when there is none. CAPCOM_SHOTS=<folder> also saves a screenshot of each state there.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, PASSWORD, request, signIn, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 60_000;
let browser;

before(async () => {
  if (!skip) browser = await launch(chromium);
});
after(async () => {
  await browser?.close();
});

async function open() {
  const s = await start({ claude: true, sessions: [{ id: 'live', title: 'Runs', source: 'cli', ago: 1 }] });
  const { token } = await signIn(s);
  return { s, token };
}

const post = (c, json) => request(c.s, 'POST', '/api/settings', { headers: { connection: 'close', origin: c.s.origin, ...as(c.token) }, json });
const reach = async c => (await request(c.s, 'GET', '/api/settings', { headers: as(c.token) })).body().sendReach;

// Runs before the page's own scripts. `window.posts` collects each body posted to api/settings, `get` and `put` run first in the matching call and may return a Response.
const spy = ({ get = '', put = '' } = {}) => `const real = window.fetch; window.posts = [];
  window.fetch = async (url, init) => { if (String(url) === 'api/settings') { if (init?.method === 'POST') { window.posts.push(init.body); ${put} } else { ${get} } } return real(url, init); };`;
const refuse = `return new Response(JSON.stringify({ error: 'The disk is full.' }), { status: 500 });`;
const hold = `await window.gate;`;
const old = `const real = window.fetch; window.fetch = async (...a) => { const r = await real(...a); if (String(a[0]) !== 'api/sessions') return r; const j = await r.json(); delete j.features.sendReach; return new Response(JSON.stringify(j), { status: r.status }); };`;

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
  if (before) await page.reload();
  if (hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  return page;
}

const radios = `[...document.querySelectorAll('#settings input[type=radio]')].map(r => ({ value: r.value, checked: r.checked, disabled: r.disabled }))`;
const checked = `[...document.querySelectorAll('#settings input[type=radio]')].find(r => r.checked)?.value ?? null`;
const focused = `document.activeElement?.matches('#settings input[type=radio]') ? document.activeElement.value : null`;
const ready = `document.querySelectorAll('#settings input[type=radio]').length === 3`;

test('the Account menu has Settings after Passkeys, marks it when open and marks the footer button, when the server has the setting', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/settings');
  await page.until(`document.querySelector('.list-foot .foot-account')?.hasAttribute('data-current')`, 15_000);
  await page.click('.list-foot .foot-account');
  await page.until(`!!document.querySelector('.menu [role=menuitem]')`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.menu [role=menuitem]')].map(el => [el.textContent, el.getAttribute('aria-current')])`), [['Accounts', null], ['Passkeys', null], ['Settings', 'page'], ['Sign out', null]]);
  assert.equal(await page.evaluate(`!!document.querySelector('.menu [role=menuitem]:nth-child(3) svg')`), true);
  await page.press('Escape');
  await page.evaluate(`location.hash = '#/'`);
  await page.until(`!document.querySelector('.list-foot .foot-account').hasAttribute('data-current')`);
  await page.click('.list-foot .foot-account');
  await page.until(`!!document.querySelector('.menu [role=menuitem]')`);
  await page.evaluate(`[...document.querySelectorAll('.menu [role=menuitem]')].find(el => el.textContent === 'Settings').click()`);
  await page.until(`location.hash === '#/settings' && ${ready}`, 10_000);
  assert.equal(await page.evaluate(`document.title`).then(x => x.includes('Settings')), true);
});

test('in front of a server without the setting, the menu has no Settings item and #/settings opens no pane', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/settings', { before: old });
  await page.until(`!!document.querySelector('.list-foot .foot-account')`, 15_000);
  await new Promise(done => setTimeout(done, 500));
  await page.click('.list-foot .foot-account');
  await page.until(`!!document.querySelector('.menu [role=menuitem]')`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.menu [role=menuitem]')].map(el => el.textContent)`), ['Accounts', 'Passkeys', 'Sign out']);
  assert.equal(await page.evaluate(`!!document.querySelector('#settings') || !!document.querySelector('.dock')`), false);
});

test('the pane shows nothing checked until the server answers, then the server\'s choice, and posts nothing on load', { skip, timeout }, async t => {
  const c = await open();
  assert.equal((await post(c, { sendReach: 'project' })).status, 200);
  const page = await openPage(t, c, '#/settings', { before: `window.gate = new Promise(done => { window.release = done; }); ${spy({ get: hold })}` });
  await page.until(`!!document.querySelector('#settings')`, 15_000);
  await page.until(`document.querySelector('#settings .settings-inner').textContent.includes('Loading settings')`);
  assert.equal(await page.evaluate(`document.querySelectorAll('#settings input').length`), 0);
  await page.evaluate(`window.release()`);
  await page.until(ready, 10_000);
  assert.deepEqual(await page.evaluate(radios), [{ value: 'family', checked: false, disabled: false }, { value: 'project', checked: true, disabled: false }, { value: 'any', checked: false, disabled: false }]);
  await new Promise(done => setTimeout(done, 300));
  assert.deepEqual(await page.evaluate(`window.posts`), []);
  assert.equal(await reach(c), 'project');
  await page.evaluate(`location.hash = '#/'; location.hash = '#/settings'`);
  await page.until(ready);
  await new Promise(done => setTimeout(done, 300));
  assert.deepEqual(await page.evaluate(`window.posts`), []);
  await shot(page, 'a-settings-pane');
});

test('a fresh server shows its own family chosen, marked Default, and each radio is tied to its description', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/settings');
  await page.until(ready, 15_000);
  assert.equal(await page.evaluate(checked), 'family');
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#settings .badge')].map(b => b.closest('label').querySelector('input').value + ':' + b.textContent)`), ['family:Default']);
  const tied = await page.evaluate(`[...document.querySelectorAll('#settings input[type=radio]')].map(r => [document.getElementById(r.getAttribute('aria-labelledby')).textContent, document.getElementById(r.getAttribute('aria-describedby')).textContent])`);
  assert.deepEqual(tied.map(([name]) => name), ['Its own familyDefault', 'Its own project', 'Any session']);
  assert.match(tied[0][1], /^Its parent, the sessions beside it and the ones below it\./);
  assert.match(tied[1][1], /^Its family and any session in its project\./);
  assert.match(tied[2][1], /^Every session that isn't archived/);
  assert.equal(await page.evaluate(`document.querySelector('#settings fieldset legend').textContent`), 'Messages between sessions');
  assert.equal(await page.evaluate(`document.getElementById(document.querySelector('#settings fieldset').getAttribute('aria-describedby')).textContent.startsWith('Choose which messages')`), true);
});

test('picking a choice posts exactly that value once, shows it at once, and keeps the others disabled until the save lands', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/settings', { before: `window.gate = new Promise(done => { window.release = done; }); ${spy({ put: hold })}` });
  await page.until(ready, 15_000);
  await page.click('#settings .send-choice:nth-child(3) .send-choice-words');
  await page.until(`window.posts.length === 1`);
  assert.deepEqual(await page.evaluate(`window.posts`), ['{"sendReach":"any"}']);
  assert.equal(await page.evaluate(checked), 'any');
  assert.deepEqual(await page.evaluate(`${radios}.map(r => r.disabled)`), [true, true, false]);
  assert.equal(await page.evaluate(`document.querySelector('#settings [role=status]').textContent`), 'Saving');
  await shot(page, 'b-settings-saving');
  await page.evaluate(`window.release()`);
  await page.until(`document.querySelector('#settings [role=status]').textContent === 'Saved.'`);
  assert.deepEqual(await page.evaluate(`${radios}.map(r => r.disabled)`), [false, false, false]);
  assert.equal(await reach(c), 'any');
  assert.equal(await page.evaluate(`window.posts.length`), 1);
});

test('arrow keys pick a choice, the focus stays on that radio through the save, and a refused save goes back with the notice', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/settings', { before: spy() });
  await page.until(ready, 15_000);
  await page.evaluate(`document.querySelector('#settings input[value=family]').focus()`);
  await page.press('ArrowDown');
  await page.until(`window.posts.length === 1`);
  await page.until(`document.querySelector('#settings [role=status]').textContent === 'Saved.'`);
  assert.deepEqual(await page.evaluate(`[window.posts, ${checked}, ${focused}]`), [['{"sendReach":"project"}'], 'project', 'project']);
  assert.equal(await reach(c), 'project');

  const bad = await openPage(t, c, '#/settings', { before: spy({ put: refuse }) });
  await bad.until(ready, 15_000);
  await bad.evaluate(`document.querySelector('#settings input[value=project]').focus()`);
  await bad.press('ArrowDown');
  await bad.until(`document.querySelector('#settings .notice').textContent !== ''`);
  assert.equal(await bad.evaluate(`document.querySelector('#settings .notice').textContent`), 'The disk is full.');
  assert.equal(await bad.evaluate(`document.querySelector('#settings .notice').getAttribute('role')`), 'alert');
  assert.deepEqual(await bad.evaluate(`[window.posts, ${checked}, ${focused}, ${radios}.some(r => r.disabled)]`), [['{"sendReach":"any"}'], 'project', 'project', false]);
  assert.equal(await reach(c), 'project');
  await shot(bad, 'c-settings-save-failed');
});

test('a settings load that fails shows the notice and no radio, and writes nothing', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/settings', { before: spy({ get: refuse }) });
  await page.until(`!!document.querySelector('#settings .notice')?.textContent`, 15_000);
  assert.equal(await page.evaluate(`document.querySelector('#settings .notice').textContent`), 'Could not load the settings: The disk is full.');
  assert.deepEqual(await page.evaluate(`[document.querySelectorAll('#settings input').length, document.querySelector('#settings .settings-inner').textContent.includes('Loading'), window.posts]`), [0, false, []]);
  assert.equal(await reach(c), 'family');
  await shot(page, 'd-settings-load-failed');
});

test('the rows stay 44px high with a finger and the pane has no sideways scroll at 320px', { skip, timeout }, async t => {
  const c = await open();
  const page = await openPage(t, c, '#/settings', { phone: true });
  await page.resize(320, 568);
  await page.until(ready, 15_000);
  assert.equal(await page.evaluate(`[...document.querySelectorAll('#settings .send-choice')].every(l => l.getBoundingClientRect().height >= 44)`), true);
  assert.equal(await page.evaluate(`document.querySelector('.settings-body').scrollWidth <= document.querySelector('.settings-body').clientWidth`), true);
});
