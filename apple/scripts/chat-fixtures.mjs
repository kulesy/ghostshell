// A stub server for the chat screenshots. It answers sign-in, the session list, the messages route and a session's event stream with fixed
// chats, because a rich chat, a reply still streaming and a very long chat can't be had on demand from a scratch server.
import http from 'node:http';

const NOW = Date.now();
const iso = minutesAgo => new Date(NOW - minutesAgo * 60_000).toISOString();
const PAGE = 120;

const user = (text, at) => ({ kind: 'user', text, at: iso(at) });
const reply = (id, text, at) => ({ kind: 'assistant', msgId: id, text, at: iso(at) });
const tool = (id, name, summary, input, output, status = 'ok') => [
  { kind: 'tool', id, name, summary, input, status: 'pending' },
  { kind: 'result', toolId: id, status, output },
];

const RICH_REPLY = `The test fails because it starts the upload before the server has finished its setup. Three things stand out:

## What I found

- The \`uploadFile\` helper does not wait for the \`ready\` event, so about **one run in five** loses the race.
- The retry in \`waitForServer\` stops after *one* attempt, see [the docs](https://example.com/docs/retries).
- Nothing clears the temp folder, so a second run can read the first run's file.

~~Raising the timeout~~ would only hide it. This is the fix:

\`\`\`js
async function uploadFile(path) {
  await server.ready();
  const body = await fs.readFile(path);
  return fetch(url, { method: 'PUT', body });
}
\`\`\`

| File | Change | Lines |
| --- | --- | --- |
| \`upload.test.js\` | wait for ready | 3 |
| \`helpers.js\` | retry up to 5 times | 12 |

> The retry count is a guess. Say if you want it read from the config.`;

const FINAL_REPLY = `All 14 tests pass, and I ran the upload test 30 times with no failure.

1. The helper waits for \`ready\` now.
2. The retry makes five attempts.
3. The temp folder is cleared after each run.`;

function richItems() {
  const items = [
    user('Why is the upload test flaky? It fails about one run in five.', 52),
    { kind: 'thinking', msgId: 'm1', text: 'The test starts the upload right after the server is created. If setup has not finished, the first request gets refused. I should read the helper and the test before saying so.', at: iso(51) },
    ...tool('r1', 'Read', 'upload.test.js', { file_path: 'test/upload.test.js' }, "import { uploadFile } from './helpers.js';\n\ntest('uploads a file', async () => {\n  const res = await uploadFile('fixtures/a.txt');\n  expect(res.status).toBe(200);\n});"),
    ...tool('r2', 'Read', 'helpers.js', { file_path: 'test/helpers.js' }, 'export async function uploadFile(path) {\n  const body = await fs.readFile(path);\n  return fetch(url, { method: "PUT", body });\n}'),
    ...tool('g1', 'Grep', 'ready', { pattern: 'ready', path: 'test' }, 'test/server.js:14:  emit("ready")'),
    reply('m2', RICH_REPLY, 49),
    ...tool('e1', 'Edit', 'helpers.js', { file_path: 'test/helpers.js', old_string: 'export async function uploadFile(path) {\n  const body', new_string: 'export async function uploadFile(path) {\n  await server.ready();\n  const body' }, 'The file test/helpers.js has been updated.'),
    ...tool('b1', 'Bash', 'npm test -- upload', { command: 'npm test -- upload', description: 'Run the upload test' }, ' PASS  test/upload.test.js\n  uploads a file (41 ms)\n\nTests: 1 passed, 1 total'),
    ...tool('b2', 'Bash', 'git push', { command: 'git push' }, 'fatal: no upstream branch', 'failed'),
    ...tool('a1', 'Agent', 'Look for other races', { description: 'Look for other races', subagent_type: 'Explore', prompt: 'Find other tests that start work before the server is ready.' }, 'Two other tests do the same.'),
    { kind: 'system', title: 'Conversation compacted', text: 'Earlier messages were summarised to save room.', at: iso(30) },
    { kind: 'model', model: 'claude-sonnet-5-5', at: iso(29) },
    reply('m3', FINAL_REPLY, 20),
    user('Thanks. Can you add a note to the changelog?', 5),
    reply('m4', 'Done. I added **one line** under `Fixed` in `CHANGELOG.md`.', 4),
  ];
  return items;
}

function longItems() {
  const items = [];
  for (let i = 1; i <= 600; i++) {
    items.push(user(`Question ${i}: what does step ${i} of the migration do?`, 900 - i));
    items.push(reply(`m${i}`, `Step ${i} renames the \`items_${i}\` column and fills it from the old one.\n\n- It runs in a transaction.\n- It can be undone with \`down\`.`, 900 - i - 0.5));
  }
  return items;
}

const STREAM_TEXT = `them out now.

## First, the helper

It waits for the **ready** event before it sends anything, so the first request is never refused.

\`\`\`js
await server.ready();
\`\`\`

## Second, the retry

The retry makes five attempts with a short pause between them. That covers the slow runners without hiding a real failure, because the sixth refusal still fails the test.

## Third, the clean up

The temp folder is cleared after each run so a second run cannot read the first run's file. `.split(' ');

function chats() {
  const rich = richItems();
  const long = longItems();
  return {
    rich: { title: 'Fix the flaky upload test', items: rich },
    stream: { title: 'Plan the retry change', items: [user('Write out the fix for the upload race.', 3), reply('s0', 'Yes. I will lay it out in three parts.', 2.5), user('Go on, I am ready.', 1)], streaming: true },
    long: { title: 'Walk through the migration', items: long },
    empty: { title: 'A chat with nothing in it yet', items: [] },
    ...approvalChats(),
  };
}

// Chats that stop on a prompt. The `pending` array rides on the status frame, as the server sends it.
const ask = (requestId, tool, input, extra = {}) => ({ requestId, tool, label: tool, input, always: false, at: NOW - 30_000, ...extra });
const PLAN = `## Make the upload wait for the server

1. Add \`await server.ready()\` to \`uploadFile\` in \`test/helpers.js\`.
2. Retry the first request up to **5 times** with a 200 ms pause.
3. Clear the temp folder after each run.

Nothing outside \`test/\` changes. I will run the upload test 30 times to check it.`;
function approvalChats() {
  const chat = (title, pending, said = 'I need your go-ahead before I go on.') => ({
    title, pending, items: [user('Go ahead and fix it.', 6), reply('p1', said, 5)],
  });
  const bash = ask('req-bash', 'Bash', { command: 'git push origin HEAD --force-with-lease', description: 'Push the branch' }, { always: true, description: 'Pushes the branch you are on.' });
  const edit = ask('req-edit', 'Edit', {
    file_path: 'test/helpers.js',
    old_string: 'export async function uploadFile(path) {\n  const body = await fs.readFile(path);\n  return fetch(url, { method: "PUT", body });\n}',
    new_string: 'export async function uploadFile(path) {\n  await server.ready();\n  const body = await fs.readFile(path);\n  return fetch(url, { method: "PUT", body });\n}',
  }, { summary: 'test/helpers.js', always: true });
  const question = ask('req-ask', 'AskUserQuestion', { questions: [
    { question: 'Which test runner should the new tests use?', header: 'Runner', multiSelect: false, options: [
      { label: 'node:test', description: 'Built in, no new dependency.', preview: "import test from 'node:test';\n\ntest('uploads a file', async () => {});" },
      { label: 'vitest', description: 'Faster watch mode, one more dependency.' },
    ] },
    { question: 'Which checks should run before each commit?', header: 'Checks', multiSelect: true, options: [
      { label: 'Lint', description: 'Style and unused code.' }, { label: 'Types' }, { label: 'Unit tests', description: 'The fast suite only.' },
    ] },
  ] });
  const plan = ask('req-plan', 'ExitPlanMode', { plan: PLAN }, { always: true });
  const longBash = ask('req-long', 'Bash', { command: Array.from({ length: 40 }, (_, i) => `echo "step ${i + 1}" && sleep 1`).join(' \\\n  && ') });
  return {
    'ask-bash': chat('Push the upload fix', [bash]),
    'ask-edit': chat('Edit the upload helper', [edit]),
    'ask-question': chat('Choose the test setup', [question]),
    'ask-plan': chat('Approve the retry plan', [plan]),
    'ask-two': chat('Several things waiting', [bash, edit, longBash]),
  };
}

function pageOf(chat, url) {
  const items = chat.items;
  const before = url.searchParams.get('before');
  const after = url.searchParams.get('after');
  let lo;
  let hi = items.length;
  if (after !== null) lo = Math.min(Number(after) / 100, items.length);
  else if (before !== null) { hi = Math.min(Number(before) / 100, items.length); lo = Math.max(0, hi - PAGE); } else lo = Math.max(0, items.length - PAGE);
  return { items: items.slice(lo, hi), start: lo * 100, end: items.length * 100, hasEarlier: lo > 0, reset: false, fileLinks: false, terminal: false,
    session: { id: '', title: chat.title, cwd: '/work/example', branch: 'main', connectors: {} } };
}

const send = (res, name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

function stream(chat, res, timers) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  if (!chat.streaming) {
    send(res, 'status', { state: chat.pending ? 'waiting' : 'idle', running: true, model: 'claude-sonnet-5-5', mode: 'default', live: '', pending: chat.pending || [] });
    return;
  }
  let at = 0;
  const began = Date.now() - 14_000;
  const work = () => ({ writing: true, thinking: false, tools: [], tokens: 1240, turnMs: Date.now() - began, startedAt: began });
  send(res, 'status', { state: 'working', running: true, model: 'claude-sonnet-5-5', mode: 'default', live: 'The fix has three parts, and I am writing', work: work(),
    think: { id: 't1', text: 'The user wants the whole fix laid out. I will start with the helper, then the retry, then the clean up.', done: true } });
  timers.push(setInterval(() => {
    if (at >= STREAM_TEXT.length) return;
    send(res, 'delta', { text: ' ' + STREAM_TEXT[at++] });
  }, 350));
}

export async function startChatStub() {
  const all = chats();
  const rows = Object.entries(all).map(([id, chat], i) => ({ id, title: chat.title, dot: null, state: 'idle', sortAt: Date.now() - i * 60_000 }));
  const timers = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    req.resume();
    if (url.pathname === '/login') return void res.writeHead(303, { Location: '/', 'Set-Cookie': 'capcom=stub; HttpOnly' }).end();
    if (url.pathname === '/api/sessions') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ungrouped: rows }));
    const m = /^\/api\/sessions\/([^/]+)\/(messages|events)$/.exec(url.pathname);
    const chat = m && all[m[1]];
    if (!chat) return void res.writeHead(404).end('{}');
    if (m[2] === 'messages') {
      const page = pageOf(chat, url);
      page.session.id = m[1];
      return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(page));
    }
    stream(chat, res, timers);
    if (m[1] === 'rich') {
      send(res, 'subagents', { agents: [
        { id: 'a1', type: 'Explore', description: 'Look for other races', state: 'done', startedAt: NOW - 600_000, endedAt: NOW - 540_000, ms: 60_000 },
        { id: 'a2', type: 'general-purpose', description: 'Check the changelog format', state: 'running', startedAt: Date.now() - 20_000, ms: 20_000 },
      ] });
    }
    res.on('close', () => timers.splice(0).forEach(clearInterval));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    address: `http://localhost:${server.address().port}`,
    rows,
    stop: () => { timers.splice(0).forEach(clearInterval); server.closeAllConnections(); server.close(); },
  };
}
