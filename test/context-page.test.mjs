// Run with `npm test`. The plan usage section of the context popover in the real page against the real server and a fake CLI: a bar for each row
// the CLI sends, in its order, with the words a screen reader hears, and no section when the CLI sends none. It needs Playwright's Chromium
// headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, PASSWORD, request, signIn, start, until } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
const HOUR = 3_600_000;
let app;
let browser;

const row = (over = {}) => ({ kind: 'weekly_all', group: 'weekly', percent: 71, severity: 'normal', resets_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), scope: null, is_active: true, ...over });
const LIMITS = [
  row({ kind: 'session', group: 'session', percent: 34, resets_at: new Date(Date.now() + 2 * HOUR).toISOString() }),
  row(),
  row({ kind: 'weekly_scoped', percent: 2, scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false }),
];
const planFile = limits => fs.writeFileSync(path.join(app.home, 'plan-usage.json'), JSON.stringify(limits));

before(async () => {
  if (skip) return;
  app = await start({ claude: true, sessions: [{ id: 'live', title: 'Runs', source: 'cli', ago: 1 }] });
  const dir = path.join(app.home, '.claude', 'projects', '-test-folder');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'live.jsonl'), `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text: 'Done' }], usage: { input_tokens: 1000, output_tokens: 9 } } })}\n`);
  fs.writeFileSync(path.join(app.home, 'context-usage.json'), JSON.stringify({ summary: { totalTokens: 39300, maxTokens: 300000, autoCompactThreshold: 267000, isAutoCompactEnabled: true } }));
  const { token } = await signIn(app);
  assert.equal((await request(app, 'POST', '/api/sessions/live/send', { headers: as(token), json: { text: 'hello' } })).status, 200);
  await until(() => cliCalls(app).some(c => c.user), 20_000);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

async function chatPage(t) {
  const page = await browser.open(`${app.origin}/#/s/live`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST} || !!document.querySelector('.btn.context'))`);
  if (await page.evaluate(LOGIN)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
    if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
      await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
      await page.until(`!document.querySelector('.offer')`);
    }
    await page.evaluate(`location.hash = '#/s/live'`);
  }
  await page.until(`!!document.querySelector('.btn.context')`, 10_000);
  return page;
}

test('the popover lists the plan\'s limits in the server\'s order, each as a meter that a screen reader can read', { skip, timeout }, async t => {
  planFile(LIMITS);
  const page = await chatPage(t);
  await page.click('.btn.context');
  await page.until(`document.querySelectorAll('.context-plan [role=meter]').length === 3`);
  const meters = await page.evaluate(`[...document.querySelectorAll('.context-plan [role=meter]')].map(m => ({ label: m.getAttribute('aria-label'), now: m.getAttribute('aria-valuenow'), min: m.getAttribute('aria-valuemin'), max: m.getAttribute('aria-valuemax'), text: m.getAttribute('aria-valuetext'), width: m.firstElementChild.style.width }))`);
  assert.deepEqual(meters.map(m => [m.label, m.now, m.min, m.max, m.width]), [
    ['Current session', '34', '0', '100', '34%'],
    ['Weekly · All models', '71', '0', '100', '71%'],
    ['Weekly · Fable', '2', '0', '100', '2%'],
  ]);
  assert.match(meters[0].text, /^34% used, resets in (1 hr 5\d min|2 hr)$/);
  assert.match(meters[1].text, /^71% used, resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2} [ap]m$/);
  assert.equal(await page.evaluate(`document.querySelector('.context-plan-title').textContent`), 'Plan usage');
  assert.equal(await page.evaluate(`document.querySelector('.context-plan').getAttribute('aria-labelledby') === document.querySelector('.context-plan-title').id`), true);
  assert.deepEqual(cliCalls(app).filter(c => c.control === 'get_usage').map(c => c.skip), [true]);
  assert.deepEqual(page.problems, []);
});

test('a row near its limit takes the severity colour the server names', { skip, timeout }, async t => {
  planFile([row({ percent: 91, severity: 'warning' }), row({ kind: 'session', group: 'session', percent: 100, severity: 'critical' })]);
  const page = await chatPage(t);
  await page.click('.btn.context');
  await page.until(`document.querySelectorAll('.plan-row').length === 2`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.plan-row')].map(r => r.dataset.severity)`), ['warning', 'critical']);
  const fills = await page.evaluate(`[...document.querySelectorAll('.plan-row .context-fill')].map(f => getComputedStyle(f).backgroundColor)`);
  assert.notEqual(fills[0], fills[1]);
});

test('with no limits there is no plan section, and it goes again when the popover is opened with none', { skip, timeout }, async t => {
  planFile(LIMITS);
  const page = await chatPage(t);
  await page.click('.btn.context');
  await page.until(`document.querySelectorAll('.context-plan [role=meter]').length === 3`);
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await page.until(`!document.querySelector('.context-pop')`);

  planFile([]);
  await page.click('.btn.context');
  await page.until(`!!document.querySelector('.context-pop') && !!document.querySelector('.context-table, .context-note')`);
  await page.until(`!document.querySelector('.context-plan')`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.context-bar').length`), 1, 'only the context bar is left');
  assert.deepEqual(page.problems, []);
});
