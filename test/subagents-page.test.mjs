// Run with `npm test`. The Subagents tab in the real page against the real server: no tab for a chat with no helpers, the tab and its cards for one
// that has them, the fold for the finished, a helper opened to its steps and reply, an old server, and a phone. It needs Playwright's Chromium
// headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const WITH = 'with-helpers';
const MOVER = 'mover';
const SESSIONS = [{ id: WITH, title: 'Fans out', source: 'cli', ago: 1 }, { id: 'plain', title: 'Plain', source: 'cli', ago: 2 }, { id: MOVER, title: 'Moves on', source: 'cli', ago: 3 }];
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const CWD = '/work/demo';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let older;
let browser;

const stamp = before => ({ timestamp: new Date(Date.now() - before).toISOString(), cwd: CWD, isSidechain: true });
const prompt = (text, before) => ({ type: 'user', message: { role: 'user', content: text }, ...stamp(before) });
const reply = (content, before, extra = {}) => ({ type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: extra.reason ?? 'tool_use' }, ...stamp(before), ...extra.entry });
const call = (name, input, id) => ({ type: 'tool_use', id, name, input });
const said = text => ({ type: 'text', text });

// Writes one helper into the folder the CLI keeps beside the session's transcript.
function helper(id, entries, meta, session = WITH) {
  const dir = path.join(app.home, '.claude', 'projects', '-test-folder', session, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), entries.map(e => `${JSON.stringify(e)}\n`).join(''));
  fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
}

// The server behind a proxy that leaves out the features of the list that `leave` names, as a server that started before they existed does.
function through(target, { leave = [] } = {}) {
  const proxy = http.createServer((req, res) => {
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, answer => {
      if (req.url.split('?')[0] !== '/api/sessions') { res.writeHead(answer.statusCode, answer.headers); answer.pipe(res); return; }
      const chunks = [];
      answer.on('data', chunk => chunks.push(chunk));
      answer.on('end', () => {
        const { features, ...index } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        for (const name of leave) delete features[name];
        const body = Buffer.from(JSON.stringify({ ...index, features }));
        res.writeHead(answer.statusCode, { ...answer.headers, 'content-length': body.length });
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
  app = await start({ sessions: SESSIONS, claude: true });
  helper('run1', [prompt('Look into it', 95 * SECOND), reply([call('Read', { file_path: `${CWD}/lib/work.mjs` }, 't1')], 2 * SECOND)], { agentType: 'Explore', description: 'Find where the status is built', model: 'sonnet' });
  helper('done1', [prompt('Review it', 5 * MINUTE), reply([call('Grep', { pattern: 'status' }, 't1')], 4 * MINUTE),
    reply([said('Found it in lib/status.mjs.\n\n- the key is built there')], 3 * MINUTE, { reason: 'end_turn' })], { agentType: 'general-purpose', description: 'Review the diff', model: 'claude-haiku-4-5-20251001', finished: true });
  helper('bad1', [prompt('Try it', 4 * MINUTE), reply([call('Bash', { command: 'npm test' }, 't1')], 3 * MINUTE),
    reply([said('API Error: 500 upstream failed')], 2 * MINUTE, { reason: 'stop_sequence', entry: { isApiErrorMessage: true, error: 'server_error' } })], { agentType: 'Plan', description: 'Plan the change', model: 'opus' });
  helper('move1', [prompt('Look into it', 95 * SECOND), reply([call('Read', { file_path: `${CWD}/lib/work.mjs` }, 't1')], 2 * SECOND)], { agentType: 'Explore', description: 'Moves soon', model: 'sonnet' }, MOVER);
  older = await through(app, { leave: ['subagents'] });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const KEPT = ['panels', 'folded', 'subsMore', 'groupMore', 'groupShut'];

async function appPage(t, hash, { origin = app.origin, phone = false } = {}) {
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`${JSON.stringify(KEPT)}.forEach(key => localStorage.removeItem('capcom.' + key))`);
  await setter.close();
  const page = await browser.open(`${origin}/${hash}`, { phone });
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (await page.evaluate(LOGIN)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
    if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
      await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
      await page.until(`!document.querySelector('.offer')`);
    }
  }
  if ((await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  return page;
}

const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const all = (page, selector, read) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(el => ${read})`);
const tabs = page => all(page, '#panel .panel-tab', 'el.textContent.trim()');

async function agentsTab(page) {
  await page.until(`!document.querySelector('#panel') && !!document.querySelector('#terminalButton')`);
  await page.click('#terminalButton');
  await page.until(`!!document.querySelector('#tab-agents')`);
  await page.click('#tab-agents');
  await page.until(`!!document.querySelector('#pane-agents:not([hidden]) .agents .agent')`);
}

test('a chat that has had helpers has the Subagents tab, a summary and the running helper first', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${WITH}`);
  await agentsTab(page);
  assert.deepEqual(await tabs(page), ['Subagents', 'Terminal']);
  assert.equal(await text(page, '.agents .subs-sum'), '1 running, 2 finished');
  assert.deepEqual(await all(page, '.agents .status-heading', 'el.textContent'), ['Running (1)']);
  assert.equal(await text(page, '.agent .badge'), 'Explore');
  assert.equal(await text(page, '.agent .agent-title'), 'Find where the status is built');
  assert.match(await text(page, '.agent .agent-meta'), /^Running · Sonnet · (\d+m \d{2}s|\d+s)$/);
  assert.equal(await text(page, '.agent .agent-line'), 'Read lib/work.mjs');
  assert.equal(await page.evaluate(`document.querySelector('.agent .lamp').dataset.state`), 'working');
  assert.equal(await page.evaluate(`document.querySelector('.agent-card').getAttribute('aria-expanded')`), 'false');
  assert.equal(await page.evaluate(`document.querySelector('.agent-list').getAttribute('aria-label')`), 'Running subagents');
  assert.deepEqual(page.problems, []);
});

test('a chat with a terminal also has the Subagents button in its header, marked while a helper runs, and it opens the tab', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${WITH}`);
  await page.until(`!!document.querySelector('#agentsButton') && !!document.querySelector('#terminalButton')`);
  assert.deepEqual(await all(page, '.chat-tools > .btn', 'el.id'), ['archiveButton', 'agentsButton', 'terminalButton']);
  assert.equal(await page.evaluate(`document.querySelector('#agentsButton').getAttribute('aria-label')`), 'Subagents: 1 running, 2 finished');
  assert.equal(await page.evaluate(`!!document.querySelector('#agentsButton .agents-mark')`), true);
  await page.click('#agentsButton');
  await page.until(`!!document.querySelector('#tab-agents[aria-selected="true"]') && !!document.querySelector('#pane-agents:not([hidden]) .agents .agent')`);
  assert.equal(await page.evaluate(`document.querySelector('#agentsButton').getAttribute('aria-expanded')`), 'true');
  assert.deepEqual(page.problems, []);
});

test('the running time counts up by the second on the page\'s own clock', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${WITH}`);
  await agentsTab(page);
  const first = await text(page, '.agent .agent-meta');
  await page.until(`document.querySelector('.agent .agent-meta').textContent.replace(/\\s+/g, ' ').trim() !== ${JSON.stringify(first)}`, 3000);
  assert.deepEqual(page.problems, []);
});

test('the finished helpers are in a fold, closed at first, newest end first, with their state in words', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${WITH}`);
  await agentsTab(page);
  assert.equal(await text(page, '.agents .status-fold'), 'Finished (2)');
  assert.equal(await page.evaluate(`document.querySelector('.agents .status-fold').getAttribute('aria-expanded')`), 'false');
  assert.equal(await page.evaluate(`document.querySelectorAll('.agent').length`), 1, 'only the running one is drawn');
  await page.click('.agents .status-fold');
  await page.until(`document.querySelectorAll('.agent').length === 3`);
  assert.deepEqual(await all(page, '.agent .agent-title', 'el.textContent'), ['Find where the status is built', 'Plan the change', 'Review the diff']);
  assert.deepEqual(await all(page, '.agent .agent-state', 'el.textContent'), ['Running', 'Failed', 'Done']);
  assert.deepEqual(await all(page, '.agent .agent-meta', 'el.textContent.split(" · ")[1]'), ['Sonnet', 'Opus', 'Haiku 4.5']);
  assert.equal(await page.evaluate(`document.querySelector('.agent[data-state="failed"] .lamp').dataset.state`), 'failed');
  assert.equal(await text(page, '.agent[data-state="failed"] .agent-line'), 'API Error: 500 upstream failed');
  assert.deepEqual(page.problems, []);
});

test('a helper opens in place to its steps and reply, and closes again', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${WITH}`);
  await agentsTab(page);
  await page.click('.agents .status-fold');
  await page.until(`document.querySelectorAll('.agent').length === 3`);
  await page.click('.agent[data-state="done"] .agent-card');
  await page.until(`!!document.querySelector('.agent[data-state="done"] .agent-reply')`);
  assert.equal(await page.evaluate(`document.querySelector('.agent[data-state="done"] .agent-card').getAttribute('aria-expanded')`), 'true');
  const controls = await page.evaluate(`document.querySelector('.agent[data-state="done"] .agent-card').getAttribute('aria-controls')`);
  assert.equal(await page.evaluate(`document.getElementById(${JSON.stringify(controls)}) === document.querySelector('.agent[data-state="done"] .agent-open')`), true);
  assert.deepEqual(await all(page, '.agent[data-state="done"] .agent-label', 'el.textContent'), ['Searched for status', 'Found it in lib/status.mjs. - the key is built there']);
  assert.match(await text(page, '.agent[data-state="done"] .agent-reply'), /^Found it in lib\/status\.mjs\./);
  assert.equal(await page.evaluate(`document.querySelectorAll('.agent[data-state="done"] .agent-reply li').length`), 1, 'the reply is drawn as markdown');
  assert.equal(await page.evaluate(`!document.querySelector('.agent[data-state="done"] .agent-card').contains(document.querySelector('.agent-open'))`), true, 'what opens is not inside the button');
  await page.click('.agent[data-state="done"] .agent-card');
  await page.until(`!document.querySelector('.agent-open')`);
  assert.deepEqual(page.problems, []);
});

test('a helper that is still running opens to its steps and no reply, and a failed one shows its error as the reply', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${WITH}`);
  await agentsTab(page);
  await page.click('.agents .status-fold');
  await page.until(`document.querySelectorAll('.agent').length === 3`);
  await page.click('.agent[data-state="running"] .agent-card');
  await page.until(`!!document.querySelector('.agent[data-state="running"] .agent-steps')`);
  assert.equal(await text(page, '.agent[data-state="running"] .agent-steps'), `${await text(page, '.agent[data-state="running"] .agent-at')}Read lib/work.mjs`);
  assert.equal(await page.evaluate(`!!document.querySelector('.agent[data-state="running"] .agent-reply')`), false);
  await page.click('.agent[data-state="failed"] .agent-card');
  await page.until(`!!document.querySelector('.agent[data-state="failed"] .agent-reply')`);
  assert.match(await text(page, '.agent[data-state="failed"] .agent-reply'), /^API Error: 500/);
  assert.deepEqual(page.problems, []);
});

test('Subagents is reached with the arrow keys from the tab list, and the tab alone does not open the panel', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${WITH}`);
  await page.until(`!!document.querySelector('#terminalButton') && document.querySelector('#title')?.textContent === 'Fans out'`);
  assert.equal(await page.evaluate(`!!document.querySelector('#panel')`), false, 'helpers do not open the panel by themselves');
  await page.click('#terminalButton');
  await page.until(`!!document.querySelector('#tab-terminal[aria-selected="true"]')`);
  await page.evaluate(`document.querySelector('#tab-terminal').focus()`);
  await page.press('ArrowLeft');
  await page.until(`document.querySelector('#tab-agents')?.getAttribute('aria-selected') === 'true' && document.activeElement?.id === 'tab-agents'`);
  assert.equal(await page.evaluate(`document.querySelector('#pane-agents').hidden`), false);
  assert.equal(await page.evaluate(`document.querySelector('#panel').getAttribute('aria-label')`), 'Subagents and terminal');
  assert.deepEqual(page.problems, []);
});

test('a chat with no helpers has no Subagents tab or button', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/plain');
  await page.until(`document.querySelector('#title')?.textContent === 'Plain' && !!document.querySelector('#terminalButton')`);
  await page.click('#terminalButton');
  await page.until(`!!document.querySelector('#panel #tab-terminal')`);
  assert.equal(await page.evaluate(`document.querySelectorAll('#agentsButton, #tab-agents, .agents').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('a server that does not send helpers offers no tab for a chat that has them', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${WITH}`, { origin: older.origin });
  await page.until(`document.querySelector('#title')?.textContent === 'Fans out' && !!document.querySelector('#terminalButton')`);
  await page.click('#terminalButton');
  await page.until(`!!document.querySelector('#panel #tab-terminal')`);
  assert.equal(await page.evaluate(`document.querySelectorAll('#agentsButton, #tab-agents, .agents').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('a phone is shown the tab in the panel that covers the chat, and a card does not run past the screen', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${WITH}`, { phone: true });
  await page.until(`!!document.querySelector('#terminalButton')`);
  await page.tap('#terminalButton');
  await page.until(`document.querySelector('#panel')?.getAttribute('role') === 'dialog' && !!document.querySelector('#tab-agents')`);
  await page.tap('#tab-agents');
  await page.until(`!!document.querySelector('#pane-agents:not([hidden]) .agents .agent')`);
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('.agent').getBoundingClientRect().right <= innerWidth`), true);
  assert.deepEqual(page.problems, []);
});

test('a helper that is open and has focus keeps both when it ends and moves to the Finished fold, and the header dot goes', { skip, timeout }, async t => {
  const page = await appPage(t, `#/s/${MOVER}`);
  await agentsTab(page);
  await page.click('.agent[data-state="running"] .agent-card');
  await page.until(`!!document.querySelector('.agent[data-state="running"] .agent-steps')`);
  await page.evaluate(`document.querySelector('.agent-card').focus()`);
  const file = path.join(app.home, '.claude', 'projects', '-test-folder', MOVER, 'subagents', 'agent-move1.jsonl');
  fs.appendFileSync(file, `${JSON.stringify(reply([said('All done here.')], 0, { reason: 'end_turn' }))}\n`);
  await page.until(`!!document.querySelector('.agent[data-state="done"] .agent-card')`, 10_000);
  await page.until(`document.activeElement === document.querySelector('.agent[data-state="done"] .agent-card')`);
  assert.equal(await page.evaluate(`document.querySelector('.agents .status-fold').getAttribute('aria-expanded')`), 'true');
  await page.until(`!!document.querySelector('.agent[data-state="done"] .agent-reply')`);
  assert.equal(await page.evaluate(`!!document.querySelector('#agentsButton .agents-mark')`), false, 'the dot goes with the last running helper');
  assert.equal(await page.evaluate(`document.querySelector('#agentsButton').getAttribute('aria-label')`), 'Subagents: 1 finished');
  assert.deepEqual(page.problems, []);
});
