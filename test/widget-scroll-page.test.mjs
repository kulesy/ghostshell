// Run with `npm test`. A widget's button that sends a message, in the real page against the real server and a fake CLI: the chat stays
// where the owner had scrolled it. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where
// it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { cliCalls, PASSWORD, signIn, start, until } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
const ID = 'widget-chat';
let app;
let browser;

const FILLER = Array.from({ length: 40 }, (_, n) => `Paragraph ${n} of a long reply.`).join('\n\n');
const WIDGET = '<button id="go" style="display:block;width:100%;height:160px" onclick="sendPrompt(\'Do step 2\')">Do 2</button>';

before(async () => {
  if (skip) return;
  app = await start({ sessions: [{ id: ID, title: 'Widget' }], claude: true });
  const file = path.join(app.home, '.claude', 'projects', '-test-folder', `${ID}.jsonl`);
  const line = (n, content) => fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { id: `m-${n}`, role: 'assistant', content } })}\n`);
  line(1, [{ type: 'text', text: FILLER }]);
  line(2, [{ type: 'tool_use', id: 'tool-w', name: 'mcp__capcom__show_widget', input: { title: 'steps', widget_code: WIDGET } }]);
  line(3, [{ type: 'text', text: FILLER }]);
  const old = (Date.now() - 600_000) / 1000;
  fs.utimesSync(file, old, old);
  await signIn(app);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const FRAME = `.widget iframe`;
const FRAME_TOP = `Math.round(document.querySelector('${FRAME}').getBoundingClientRect().top)`;
const GAP = `(b => Math.round(b.scrollHeight - b.scrollTop - b.clientHeight))(document.getElementById('transcript'))`;

async function chatPage(t) {
  const page = await browser.open(`${app.origin}/#/s/${ID}`);
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
    await page.evaluate(`location.hash = '#/s/${ID}'`);
  }
  await page.until(`!!document.querySelector('${FRAME}') && document.querySelector('${FRAME}').getBoundingClientRect().height > 100`, 10_000);
  // The owner scrolls up until the widget is in the middle of the chat.
  await page.evaluate(`(b => { const f = document.querySelector('${FRAME}'); b.scrollTop += f.getBoundingClientRect().top - b.getBoundingClientRect().top - 100; b.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); })(document.getElementById('transcript'))`);
  await page.until(`${GAP} > 200`);
  return page;
}

test('a message sent from a widget\'s button leaves the chat where the owner had scrolled it', { skip, timeout }, async t => {
  const page = await chatPage(t);
  const before = await page.evaluate(FRAME_TOP);
  await page.click(FRAME);
  await until(() => cliCalls(app).some(c => c.user === 'Do step 2'), 10_000);
  await page.until(`[...document.querySelectorAll('.msg.user')].some(m => m.textContent.includes('Do step 2'))`);
  await new Promise(done => setTimeout(done, 500));
  assert.equal(await page.evaluate(FRAME_TOP), before, 'the widget is where it was');
  assert.ok(await page.evaluate(`${GAP} > 200`), 'the chat did not go to its end');
  assert.equal(await page.evaluate(`document.querySelector('.scroll-end').dataset.active`), 'true', 'the scroll-to-end button shows');
  assert.deepEqual(page.problems, []);
});
