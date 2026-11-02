// Run with `npm test`. Links in a widget, in the real page against the real server and a fake CLI: a click on a link opens it in a new
// tab with no bar, and a link a script opens with no click is put to the owner in the bar. The headless shell blocks no popups, so this
// proves the page's side and not a browser's popup blocker. It needs Playwright's Chromium headless shell, and every test skips with a
// reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, signIn, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let browser;
let target;

const WIDGETS = {
  clicked: () => `<a href="${target}/clicked" style="display:block;height:160px">Open the pull request</a>`,
  scripted: () => `<p>Loading</p><script>setTimeout(() => openLink('${target}/scripted'), 300)</script>`,
};

before(async () => {
  if (skip) return;
  app = await start({ sessions: Object.keys(WIDGETS).map(id => ({ id, title: id })), claude: true });
  target = `${app.origin}/target`;
  for (const [id, code] of Object.entries(WIDGETS)) {
    const file = path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id: `tool-${id}`, name: 'mcp__capcom__show_widget', input: { title: id, widget_code: code() } }] } })}\n`);
    const old = (Date.now() - 600_000) / 1000;
    fs.utimesSync(file, old, old);
  }
  await signIn(app);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const FRAME = `.widget iframe`;

async function chatPage(t, id) {
  const page = await browser.open(`${app.origin}/#/s/${id}`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST} || !!document.querySelector('${FRAME}'))`);
  if (await page.evaluate(LOGIN)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
    if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
      await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
      await page.until(`!document.querySelector('.offer')`);
    }
    await page.evaluate(`location.hash = '#/s/${id}'`);
  }
  await page.until(`!!document.querySelector('${FRAME}') && document.querySelector('${FRAME}').getBoundingClientRect().height > 40`, 10_000);
  return page;
}

const opened = async (page, url) => (await page.call('Target.getTargets')).targetInfos.filter(t => t.type === 'page' && t.url === url).length;

test('a click on a link in a widget opens it in a new tab, with no bar', { skip, timeout }, async t => {
  const page = await chatPage(t, 'clicked');
  await page.click(FRAME);
  await page.until(`!!document.querySelector('.widget-ask')`, 1500).then(() => assert.fail('the bar showed'), () => {});
  assert.equal(await opened(page, `${target}/clicked`), 1);
  assert.deepEqual(page.problems, []);
});

test('a link a script opens with no click shows the bar and opens nothing', { skip, timeout }, async t => {
  const page = await chatPage(t, 'scripted');
  await page.until(`document.querySelector('.widget-ask-url')?.textContent === ${JSON.stringify(`${target}/scripted`)}`);
  assert.equal(await opened(page, `${target}/scripted`), 0);
  assert.deepEqual(page.problems, []);
});
