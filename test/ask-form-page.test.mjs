// Run with `npm test`. The ask form Claude shows with show_form, in the real page against the real server and a fake CLI: the answers go as one message,
// once, only on the owner's own click, and a widget on the same page cannot settle the form. It needs Playwright's Chromium headless shell, and every
// test skips with a reason that names where it looked when there is none. See docs/adr/20261124-page-draws-ask-forms.md.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, PASSWORD, request, signIn, start, until } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let browser;
let token;

const TITLE = 'Plan the release';
const QUESTIONS = [
  { type: 'choice', question: 'Which branch should ship?', options: [{ label: 'main' }, { label: 'next', description: 'The one with the new editor' }] },
  { type: 'choices', question: 'Which platforms?', options: [{ label: 'Mac' }, { label: 'iPhone' }, { label: 'Web' }] },
  { type: 'text', question: 'Anything the notes should say?', placeholder: 'A sentence or two' },
  { type: 'date', question: 'Ship on which day?', min: '2026-12-01', max: '2026-12-31' },
  { type: 'slider', question: 'How many testers?', min: 1, max: 20, step: 1, start: 5, unit: 'people' },
];
const ANSWERS_MESSAGE = `Answers to the form "${TITLE}":\n\n1. Which branch should ship?\nnext\n\n2. Which platforms?\nMac, Web\n\n3. Anything the notes should say?\nMention the new editor\n\n4. Ship on which day?\n2026-12-15\n\n5. How many testers?\n8 people`;
const SKIP_MESSAGE = `Skipped the form "${TITLE}".`;

// A widget that tries to settle the form from inside its frame: it names the form in a form message and in a prompt, on load, with no click.
const WIDGET = `<p style="height:80px">Trying to answer the form</p><script>
parent.postMessage({ capcom: 'form', id: 'tool-form-widget', status: 'answered' }, '*');
parent.postMessage({ capcom: 'prompt', text: ${JSON.stringify(ANSWERS_MESSAGE)}, form: { id: 'tool-form-widget' } }, '*');
parent.postMessage({ capcom: 'form', form: { id: 'tool-form-widget', skipped: true } }, '*');
</script>`;

// The same widget with a button, which the owner clicks: that sends a plain message, and the message names the form but settles nothing.
const CLICKED = `<button style="display:block;width:100%;height:120px" onclick="parent.postMessage({ capcom: 'form', id: 'tool-form-widgetclick', status: 'answered' }, '*'); sendPrompt('Answers to the form: next')">Send</button>`;

const IDS = ['full', 'double', 'enter', 'synthetic', 'skipped', 'reload', 'widget', 'widgetclick'];

function addRows(id, rows) {
  const file = path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
  for (const row of rows) fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { id: `m-${row.id}`, role: 'assistant', content: [{ type: 'tool_use', ...row }] } })}\n`);
  const old = (Date.now() - 600_000) / 1000;
  fs.utimesSync(file, old, old);
}

before(async () => {
  if (skip) return;
  app = await start({
    sessions: IDS.map(id => ({ id, title: id })),
    claude: true,
    forms: IDS.map(id => ({ toolUseId: `tool-form-${id}`, sessionId: id, title: TITLE, questions: QUESTIONS })),
  });
  for (const id of IDS) {
    addRows(id, [{ id: `tool-form-${id}`, name: 'mcp__capcom__show_form', input: { title: TITLE, questions: QUESTIONS } }]);
  }
  addRows('widget', [{ id: 'tool-widget', name: 'mcp__capcom__show_widget', input: { title: 'trick', widget_code: WIDGET } }]);
  addRows('widgetclick', [{ id: 'tool-widget', name: 'mcp__capcom__show_widget', input: { title: 'button', widget_code: CLICKED } }]);
  token = (await signIn(app)).token;
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const CARD = `.form-card`;
const SEND = `[data-form-send="answers"]`;
const SKIP = `[data-form-send="skip"]`;

async function chatPage(t, id) {
  const page = await browser.open(`${app.origin}/#/s/${id}`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST} || !!document.querySelector('${CARD}'))`);
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
  await page.until(`!!document.querySelector('${CARD}')`, 10_000);
  return page;
}

// Sets a date or a slider the way a picker does: the value, then the input event the page listens for.
const setValue = (page, selector, value) => page.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

async function fill(page) {
  await page.click(`[data-q="0"][data-o="1"]`);
  await page.click(`[data-q="1"][data-o="0"]`);
  await page.click(`[data-q="1"][data-o="2"]`);
  await page.click(`input.input[data-q="2"]`);
  await page.insert('Mention the new editor');
  await setValue(page, `input[type="date"]`, '2026-12-15');
  await setValue(page, `input[type="range"]`, 8);
  await page.until(`!document.querySelector('${SEND}').disabled`);
}

const messages = () => cliCalls(app).filter(x => x.user).map(x => x.user);
const quiet = () => new Promise(resolve => setTimeout(resolve, 600));
const formStatus = async id => (await request(app, 'GET', `/api/sessions/${id}/forms`, { headers: as(token) })).body().forms[0].status;

test('a form with a choice, choices, text, date and slider sends all its answers as one message and settles', { skip, timeout }, async t => {
  const page = await chatPage(t, 'full');
  assert.equal(await page.evaluate(`document.querySelector('${SEND}').disabled`), true, 'a required question is open');
  assert.equal(await page.evaluate(`document.querySelector('${CARD} h4').textContent`), TITLE);
  const before = messages().length;
  await fill(page);
  await page.click(SEND);
  await page.until(`document.querySelector('${CARD}')?.dataset.status === 'answered'`);
  assert.equal(await page.evaluate(`document.querySelector('${CARD} .chip-actions').textContent`), 'Answered');
  assert.equal(await page.evaluate(`!!document.querySelector('${CARD} input, ${CARD} button')`), false, 'nothing left to send');
  await quiet();
  assert.deepEqual(messages().slice(before), [ANSWERS_MESSAGE]);
  assert.equal(await formStatus('full'), 'answered');
  assert.deepEqual(page.problems, []);
});

test('a double click sends the form once', { skip, timeout }, async t => {
  const page = await chatPage(t, 'double');
  const before = messages().length;
  await fill(page);
  const { x, y } = await page.evaluate(`(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))(document.querySelector('${SEND}').getBoundingClientRect())`);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (const clickCount of [1, 2]) {
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
  }
  await page.until(`document.querySelector('${CARD}')?.dataset.status === 'answered'`);
  await quiet();
  assert.deepEqual(messages().slice(before), [ANSWERS_MESSAGE]);
  assert.deepEqual(page.problems, []);
});

test('Enter in a field does not send the form', { skip, timeout }, async t => {
  const page = await chatPage(t, 'enter');
  const before = messages().length;
  await fill(page);
  await page.click(`input.input[data-q="2"]`);
  await page.press('Enter');
  await page.click(`input.input.other[data-q="0"]`);
  await page.press('Enter');
  await quiet();
  assert.equal(messages().length, before);
  assert.equal(await page.evaluate(`document.querySelector('${CARD}').dataset.status`), 'open');
  assert.equal(await formStatus('enter'), 'open');
  assert.deepEqual(page.problems, []);
});

test('a click a script makes sends nothing, and the owner can still send afterwards', { skip, timeout }, async t => {
  const page = await chatPage(t, 'synthetic');
  const before = messages().length;
  await fill(page);
  await page.evaluate(`document.querySelector('${SEND}').click(); document.querySelector('${SKIP}').click(); document.querySelector('${SEND}').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await quiet();
  assert.equal(messages().length, before);
  assert.equal(await page.evaluate(`document.querySelector('${CARD}').dataset.status`), 'open');
  assert.equal(await page.evaluate(`document.querySelector('${SEND}').disabled`), false, 'the buttons are not left locked');
  assert.equal(await formStatus('synthetic'), 'open');
  await page.click(SEND);
  await page.until(`document.querySelector('${CARD}')?.dataset.status === 'answered'`);
  assert.deepEqual(page.problems, []);
});

test('Skip sends the note that the form was skipped, with nothing filled in', { skip, timeout }, async t => {
  const page = await chatPage(t, 'skipped');
  const before = messages().length;
  await page.click(SKIP);
  await page.until(`document.querySelector('${CARD}')?.dataset.status === 'skipped'`);
  assert.equal(await page.evaluate(`document.querySelector('${CARD} .chip-actions').textContent`), 'Skipped');
  await quiet();
  assert.deepEqual(messages().slice(before), [SKIP_MESSAGE]);
  assert.equal(await formStatus('skipped'), 'skipped');
  assert.deepEqual(page.problems, []);
});

test('a settled form shows settled after a reload and on another tab, and has no controls', { skip, timeout }, async t => {
  const page = await chatPage(t, 'reload');
  await fill(page);
  await page.click(SEND);
  await page.until(`document.querySelector('${CARD}')?.dataset.status === 'answered'`);
  await page.reload();
  await page.until(`document.querySelector('${CARD}')?.dataset.status === 'answered'`, 10_000);
  assert.equal(await page.evaluate(`document.querySelector('${CARD} .chip-actions').textContent`), 'Answered');
  assert.equal(await page.evaluate(`!!document.querySelector('${CARD} input, ${CARD} button')`), false);
  const other = await chatPage(t, 'reload');
  await other.until(`document.querySelector('${CARD}')?.dataset.status === 'answered'`, 10_000);
  assert.deepEqual([...page.problems, ...other.problems], []);
});

test('a widget on the same page cannot settle the form, and its frame stays sandboxed to allow-scripts', { skip, timeout }, async t => {
  const page = await chatPage(t, 'widget');
  await page.until(`!!document.querySelector('.widget iframe') && document.querySelector('.widget iframe').getBoundingClientRect().height > 40`, 10_000);
  const before = messages().length;
  await page.until(`!!document.querySelector('.widget-ask')`, 10_000);
  await quiet();
  assert.equal(await page.evaluate(`document.querySelector('${CARD}').dataset.status`), 'open', 'the form is still open after the widget posted');
  assert.equal(await page.evaluate(`document.querySelector('${SEND}').disabled`), true, 'its buttons are as they were');
  assert.equal(await formStatus('widget'), 'open');
  assert.equal(messages().length, before, 'the widget sent nothing on its own, its prompt waits in the bar');
  assert.equal(await page.evaluate(`document.querySelector('.widget iframe').getAttribute('sandbox')`), 'allow-scripts');
  assert.deepEqual(page.problems, []);
});

test('a click in a widget sends its message and settles no form', { skip, timeout }, async t => {
  const page = await chatPage(t, 'widgetclick');
  await page.until(`!!document.querySelector('.widget iframe') && document.querySelector('.widget iframe').getBoundingClientRect().height > 40`, 10_000);
  const before = messages().length;
  await page.click('.widget iframe');
  await until(() => messages().length > before);
  await quiet();
  assert.deepEqual(messages().slice(before), ['Answers to the form: next']);
  assert.equal(await page.evaluate(`document.querySelector('${CARD}').dataset.status`), 'open');
  assert.equal(await formStatus('widgetclick'), 'open');
  assert.equal(await page.evaluate(`document.querySelector('.widget iframe').getAttribute('sandbox')`), 'allow-scripts');
  assert.deepEqual(page.problems, []);
});
