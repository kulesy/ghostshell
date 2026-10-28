// Run with `npm test`. The CLI is a small script that never answers, so the start timeout can be shortened to a moment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCommands, listModels } from '../lib/commands.mjs';
import { activeStates, chatFor, onTurn, startChat, sweep } from '../lib/runner.mjs';

const wait = ms => new Promise(done => setTimeout(done, ms));

test('a start that times out is stopped and forgotten, so a slow CLI never becomes a session nothing knows about', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const exited = path.join(dir, 'exited');
  const cli = path.join(dir, 'slow-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "process.stdin.on('data', () => {});",
    `process.stdin.on('end', () => { fs.writeFileSync(${JSON.stringify(exited)}, 'closed'); process.exit(0); });`,
    '',
  ].join('\n'), { mode: 0o755 });
  await assert.rejects(
    startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: cli, chrome: false, chips: null, timeoutMs: 300 }),
    /Claude did not start within 0\.3 seconds/,
  );
  assert.deepEqual(Object.keys(activeStates()), [], 'the chat is gone from the registry');
  for (let i = 0; i < 40 && !fs.existsSync(exited); i++) await wait(50);
  assert.equal(fs.existsSync(exited), true, 'its input was closed, so the CLI was told to stop');
});

const until = async (check, ms = 4000) => {
  for (let waited = 0; !check(); waited += 20) {
    if (waited > ms) throw new Error('timed out waiting');
    await wait(20);
  }
};

test('Claude is asked for thinking summaries, and what it streams reaches the page as think and work events that are gone when the turn ends', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const log = path.join(dir, 'stdin.log');
  const cli = path.join(dir, 'streaming-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "const ev = event => out({ type: 'stream_event', event });",
    'let turn = 0;',
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    `  fs.appendFileSync(${JSON.stringify(log)}, line + '\\n');`,
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    '  turn++;',
    "  if (turn === 1) return out({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'stub' });",
    '  if (turn === 2) {',
    "    out({ type: 'system', subtype: 'status', status: 'requesting' });",
    "    ev({ type: 'message_start', message: { id: 'msg_1' } });",
    "    ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });",
    "    return ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Checking the folder.' } });",
    '  }',
    "  ev({ type: 'content_block_stop', index: 0 });",
    "  ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } });",
    "  ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{\"command\":\"ls\"}' } });",
    "  ev({ type: 'content_block_stop', index: 1 });",
    "  ev({ type: 'message_delta', usage: { output_tokens: 90 } });",
    "  out({ type: 'result', subtype: 'success', is_error: false });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: cli, chrome: false, chips: null });
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('think about it', []);
  await until(() => chat.status().think);
  assert.equal(chat.status().think.text, 'Checking the folder.', 'a page opened now is told what has been thought so far');
  assert.equal(chat.status().work.thinking, true);

  chat.send('go on', []);
  await until(() => chat.state === 'idle');
  const asked = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(m => m.request).filter(Boolean);
  assert.deepEqual(asked.find(r => r.subtype === 'set_max_thinking_tokens'), { subtype: 'set_max_thinking_tokens', thinking_display: 'summarized' });
  assert.deepEqual(heard.filter(e => e.type === 'think').map(e => e.data), [{ id: 'msg_1', text: 'Checking the folder.' }, { id: 'msg_1', done: true }]);
  const lastWork = heard.filter(e => e.type === 'work').at(-1).data;
  assert.deepEqual([lastWork.tools, lastWork.tokens], [[{ id: 'toolu_1', name: 'Bash', summary: 'ls' }], 90]);
  assert.equal(chat.status().work, null, 'nothing is left of the turn once it has ended');
  assert.equal(chat.status().think, null);
  chat.stop();
});

test('a message is written as images first, then documents, then the text, and as the bare text when it carries neither', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const log = path.join(dir, 'stdin.log');
  const cli = path.join(dir, 'logging-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import readline from 'node:readline';",
    'let turn = 0;',
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    `  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(m.message.content) + '\\n');`,
    "  if (!turn++) process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-blocks', model: 'stub' }) + '\\n');",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const picture = { mediaType: 'image/png', data: 'AAAA' };
  const picture2 = { mediaType: 'image/jpeg', data: 'BBBB' };
  const pdf = { mediaType: 'application/pdf', data: 'CCCC' };
  const chat = await startChat({ cwd: dir, mode: 'manual', text: '@"/up/a.pdf"\nfirst', images: [picture], documents: [pdf], claude: cli, chrome: false, chips: null });
  chat.send('plain words');
  chat.send('all three', [picture, picture2], [pdf, pdf]);
  chat.send('documents only', [], [pdf]);
  chat.send('  ', [], [pdf]);
  chat.send('pictures only', [picture]);
  await until(() => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length === 6);
  const sent = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const image = (mediaType, data) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
  const document = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'CCCC' } };
  assert.deepEqual(sent, [
    [image('image/png', 'AAAA'), document, { type: 'text', text: '@"/up/a.pdf"\nfirst' }],
    'plain words',
    [image('image/png', 'AAAA'), image('image/jpeg', 'BBBB'), document, document, { type: 'text', text: 'all three' }],
    [document, { type: 'text', text: 'documents only' }],
    [document],
    [image('image/png', 'AAAA')].concat([{ type: 'text', text: 'pictures only' }]),
  ]);
  chat.stop();
});

const holdingCli = dir => {
  const cli = path.join(dir, 'holding-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    "  const [state, id, rest] = m.message.content.split(' ');",
    "  if (state === 'start') return out({ type: 'system', subtype: 'init', session_id: id, model: 'stub' });",
    "  out({ type: 'system', subtype: 'peer_message_hold', state, message_uuid: id, lane: 'socket', from: 'uds:/tmp/cc-socks/1.sock', from_name: 'Worker', ...JSON.parse(rest || '{}') });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  return cli;
};

test('a message the CLI holds for another session shows as held with its cause and is gone once released, and it is never an approval', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const chat = await startChat({ cwd: dir, mode: 'acceptEdits', text: 'start sess-hold-1', images: [], claude: holdingCli(dir), chrome: false, chips: null });
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('held m1 {"cause":"mode-mismatch"}', []);
  await until(() => chat.status().holds.length === 1);
  assert.deepEqual(chat.status().holds.map(({ id, from, cause }) => ({ id, from, cause })), [{ id: 'm1', from: 'Worker', cause: 'mode-mismatch' }]);
  assert.deepEqual(chat.status().pending, [], 'there is nothing to allow or deny');
  assert.equal(chat.state, 'working', 'a hold does not make the chat wait for the owner');

  chat.send('held m1 {"cause":"no-mode-asserted"}', []);
  chat.send('released m1', []);
  await until(() => chat.status().holds.length === 0);
  assert.deepEqual(heard.filter(e => e.type.startsWith('hold')).map(e => [e.type, e.data.id, e.data.cause ?? e.data.state]), [
    ['hold', 'm1', 'mode-mismatch'],
    ['hold', 'm1', 'no-mode-asserted'],
    ['hold-ended', 'm1', 'released'],
  ]);
  chat.stop();
});

test('a hold that is dropped says how it ended, one the page never saw still ends, and a sender cannot pass off its name or id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const chat = await startChat({ cwd: dir, mode: 'acceptEdits', text: 'start sess-hold-2', images: [], claude: holdingCli(dir), chrome: false, chips: null });
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('dropped m2 {"outcome":"expired"}', []);
  chat.send('reopened m3', []);
  chat.send(`held ${'i'.repeat(300)} {"from_name":"A\\u202eB\\nC"}`, []);
  await until(() => chat.status().holds.length === 1);
  assert.deepEqual(heard.filter(e => e.type === 'hold-ended').map(e => e.data), [{ id: 'm2', from: 'Worker', state: 'dropped', outcome: 'expired' }]);
  assert.equal(heard.some(e => e.data?.id === 'm3'), false, 'a state the page cannot draw is ignored');
  const [held] = chat.status().holds;
  assert.deepEqual([held.id.length, held.from], [100, 'A B C']);

  chat.stop();
  await until(() => !chat.status().running);
  assert.deepEqual(chat.status().holds, [], 'a hold does not outlive the process that was holding it');
});

test('a hold frame with no message_uuid is ignored, since its own uuid differs from the one that ends it and the hold would never clear', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const chat = await startChat({ cwd: dir, mode: 'acceptEdits', text: 'start sess-hold-3', images: [], claude: holdingCli(dir), chrome: false, chips: null });
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('held x {"message_uuid":null,"uuid":"frame-1"}', []);
  chat.send('released x {"message_uuid":null,"uuid":"frame-2"}', []);
  chat.send('held m4', []);
  await until(() => chat.status().holds.some(h => h.id === 'm4'));
  assert.deepEqual(chat.status().holds.map(h => h.id), ['m4']);
  assert.deepEqual(heard.filter(e => e.type.startsWith('hold')).map(e => [e.type, e.data.id]), [['hold', 'm4']]);
  chat.stop();
});

test('a hold of a process that was told to stop is gone once a message starts a new one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const chat = await startChat({ cwd: dir, mode: 'acceptEdits', text: 'start sess-hold-4', images: [], claude: holdingCli(dir), chrome: false, chips: null });

  chat.send('held m5', []);
  await until(() => chat.status().holds.length === 1);
  chat.stop();
  chat.send('held m6', []);
  await until(() => chat.status().holds.some(h => h.id === 'm6'));
  assert.deepEqual(chat.status().holds.map(h => h.id), ['m6'], 'the old process\'s hold was not carried over');
  chat.stop();
});

test('a null line, content that is not a list and blocks that are not objects cost only themselves: the tool is tracked, the live text is cleared, and the turn ends normally', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const cli = path.join(dir, 'odd-blocks-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "const odd = [null, 'text', 7, true, [{ type: 'text', text: 'inside' }]];",
    "const notLists = ['text', { type: 'text', text: 'in an object' }, 7];",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    '  const step = m.message.content;',
    "  if (step === 'start') return out({ type: 'system', subtype: 'init', session_id: 'sess-odd-blocks', model: 'stub' });",
    "  if (step === 'write') {",
    "    out({ type: 'system', subtype: 'status', status: 'requesting' });",
    "    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Look' } } });",
    "    process.stdout.write('null\\n');",
    "    for (const content of notLists) out({ type: 'assistant', message: { id: 'msg_0', role: 'assistant', content } });",
    "    return out({ type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [...odd, { type: 'text', text: 'Looking.' }, ...odd, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }, ...odd] } });",
    '  }',
    "  if (step === 'answer') return out({ type: 'user', message: { role: 'user', content: [...odd, { type: 'tool_result', tool_use_id: 'toolu_1', content: [...odd, { type: 'text', text: 'ok' }] }, ...odd] } });",
    "  out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01 });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start', images: [], claude: cli, chrome: false, chips: null });
  // A failed assertion must not leave the CLI running, or the test run never ends.
  t.after(() => chat.stop());
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('write', []);
  await until(() => chat.status().work?.tools.length === 1);
  assert.deepEqual(chat.status().work.tools, [{ id: 'toolu_1', name: 'Bash', summary: 'ls' }]);
  assert.equal(heard.some(e => e.type === 'delta'), true, 'the text was being written');
  assert.equal(chat.status().live, '', 'and the finished message, odd blocks and all, cleared it');

  chat.send('answer', []);
  await until(() => chat.status().work?.tools.length === 0);

  chat.send('finish', []);
  await until(() => chat.state === 'idle');
  assert.deepEqual(heard.filter(e => e.type === 'turn-end').map(e => e.data), [{ error: false, message: '', cost: 0.01 }]);
  assert.deepEqual([chat.status().running, chat.status().lastError], [true, '']);
});

test('a line the CLI prints that is not an object costs only itself: the chat carries on, and the turn ends normally', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const cli = path.join(dir, 'odd-lines-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    "  if (m.message.content === 'start') return out({ type: 'system', subtype: 'init', session_id: 'sess-odd-lines', model: 'stub' });",
    "  for (const odd of ['null', '7', '\"text\"', 'true', '[]']) process.stdout.write(odd + '\\n');",
    "  out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01 });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start', images: [], claude: cli, chrome: false, chips: null });
  // A failed assertion must not leave the CLI running, or the test run never ends.
  t.after(() => chat.stop());
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('go', []);
  await until(() => chat.state === 'idle');
  assert.deepEqual(heard.filter(e => e.type === 'turn-end').map(e => e.data), [{ error: false, message: '', cost: 0.01 }]);
  assert.deepEqual([chat.status().running, chat.status().lastError], [true, '']);
});

test('Always allow is offered and kept for a tool with suggestions but never for Chrome, and Bypass allows Chrome with no card', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const cli = path.join(dir, 'asking-claude.mjs');
  const rule = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'localSettings' }];
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "const mode = process.argv[process.argv.indexOf('--permission-mode') + 1];",
    `const ask = (id, tool_name) => out({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name, input: {}, permission_suggestions: ${JSON.stringify(rule)} } });`,
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    `  fs.appendFileSync(path.join(${JSON.stringify(dir)}, mode + '.log'), line + '\\n');`,
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    "  if (m.message.content === 'start') return out({ type: 'system', subtype: 'init', session_id: `sess-always-${mode}`, model: 'stub' });",
    "  ask('ask-chrome', 'mcp__claude-in-chrome__navigate');",
    "  ask('ask-bash', 'Bash');",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const answers = mode => fs.readFileSync(path.join(dir, `${mode}.log`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(m => m.type === 'control_response').map(m => [m.response.request_id, m.response.response.behavior, m.response.response.updatedPermissions]);

  const chat = await startChat({ cwd: dir, mode: 'default', text: 'start', images: [], claude: cli, chrome: true, chips: null });
  // A failed assertion must not leave the CLI running, or the test run never ends.
  t.after(() => chat.stop());
  chat.send('ask', []);
  await until(() => chat.status().pending.length === 2);
  assert.deepEqual(chat.status().pending.map(p => [p.tool, p.always]), [['mcp__claude-in-chrome__navigate', false], ['Bash', true]]);
  chat.answer('ask-chrome', 'always');
  chat.answer('ask-bash', 'always');
  await until(() => answers('default').length === 2);
  assert.deepEqual(answers('default'), [['ask-chrome', 'allow', undefined], ['ask-bash', 'allow', rule]], 'Always allow on Chrome allows this one call and keeps no rule');

  const bypass = await startChat({ cwd: dir, mode: 'bypassPermissions', text: 'start', images: [], claude: cli, chrome: true, chips: null });
  t.after(() => bypass.stop());
  bypass.send('ask', []);
  await until(() => bypass.status().pending.length === 1 && answers('bypassPermissions').length === 1);
  assert.deepEqual(bypass.status().pending.map(p => p.tool), ['Bash']);
  assert.deepEqual(answers('bypassPermissions'), [['ask-chrome', 'allow', undefined]]);
});

// A CLI that answers an initialize request with `reply`, and starts its session when it is sent the first message.
const listingCli = (dir, reply) => {
  const cli = path.join(dir, 'listing-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    `  if (m.type === 'control_request' && m.request.subtype === 'initialize') return out({ type: 'control_response', response: { request_id: m.request_id, ...${JSON.stringify(reply)} } });`,
    "  if (m.type === 'user') out({ type: 'system', subtype: 'init', session_id: 'sess-listing', model: 'stub' });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  return cli;
};

test('the commands Claude lists in its reply to initialize are tidied onto the chat, and its folder keeps them for the next session started there', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const commands = [
    { name: 'review-pr', description: 'Review a pull request  (user)', argumentHint: '[number]' },
    { name: 'clear', description: 'Clear the conversation', builtin: true },
    { name: 'code-review', description: 'Review the diff', argumentHint: '[level]', builtin: true, aliases: ['review'] },
    { name: '__remote-workflow', builtin: true },
  ];
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: listingCli(dir, { subtype: 'success', response: { commands } }), chrome: false, chips: null });
  t.after(() => chat.stop());
  await until(() => chat.commands);
  assert.deepEqual(chat.commands, [
    { name: 'review-pr', description: 'Review a pull request (user)', hint: '[number]', aliases: [] },
    { name: 'code-review', description: 'Review the diff', hint: '[level]', aliases: ['review'] },
  ]);
  assert.deepEqual(await listCommands(dir, path.join(dir, 'no-such-claude')), chat.commands, 'the folder starts no CLI for what a chat has just listed');
});

test('the models Claude lists in its reply to initialize are tidied onto the chat, and its folder keeps them for the next model menu opened there', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const models = [
    { value: 'default', resolvedModel: 'claude-opus-5', displayName: 'Default (recommended)', supportsFastMode: true },
    { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
    { value: 'claude-opus-5', resolvedModel: 'claude-opus-5', displayName: 'Opus 5', supportsFastMode: true },
  ];
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: listingCli(dir, { subtype: 'success', response: { commands: [], models } }), chrome: false, chips: null });
  t.after(() => chat.stop());
  await until(() => chat.models);
  assert.deepEqual(chat.models, [{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', fast: false }, { id: 'claude-opus-5', label: 'Opus 5', fast: true }]);
  assert.deepEqual(await listModels(dir, path.join(dir, 'no-such-claude')), chat.models, 'the folder starts no CLI for what a chat has just listed');
});

test('a reply to initialize that lists commands and no models leaves the chat with no models to offer and its commands intact', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: listingCli(dir, { subtype: 'success', response: { commands: [{ name: 'review-pr' }] } }), chrome: false, chips: null });
  t.after(() => chat.stop());
  await until(() => chat.commands);
  assert.deepEqual(chat.models, []);
  assert.deepEqual(chat.commands.map(c => c.name), ['review-pr']);
});

// A CLI that logs how it was started and each control request it is sent. It answers an initialize request with `models`, any other request
// with success, or with an error when `refuse` is set, and never answers apply_flag_settings when `silent` is set. It starts its session when it is
// sent the first message. Each message it is sent is a turn, and `reports` says what the turns of a process report about fast mode, in order:
// `init` is the fast_mode_state on the turn's system/init, a `result` ends the turn with a result that carries that fast_mode_state, and a `reason`
// is the fast_mode_disabled_reason on both.
const recordingCli = (dir, { models = [], refuse = false, silent = false, reports = [] } = {}) => {
  const log = path.join(dir, 'recorded.log');
  const cli = path.join(dir, 'recording-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    `const note = entry => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');`,
    "note({ started: process.argv.slice(2) });",
    `const reports = ${JSON.stringify(reports)};`,
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type === 'control_request') {",
    '    note(m.request);',
    `    if (${JSON.stringify(silent)} && m.request.subtype === 'apply_flag_settings') return;`,
    `    const reply = m.request.subtype === 'initialize' ? { subtype: 'success', response: { commands: [], models: ${JSON.stringify(models)} } } : ${JSON.stringify(refuse)} ? { subtype: 'error', error: 'Not on this model.' } : { subtype: 'success' };`,
    "    return out({ type: 'control_response', response: { request_id: m.request_id, ...reply } });",
    '  }',
    "  if (m.type !== 'user') return;",
    "  const report = reports.shift() || {};",
    "  out({ type: 'system', subtype: 'init', session_id: 'sess-recording', model: 'stub', fast_mode_state: report.init, fast_mode_disabled_reason: report.reason });",
    "  if ('result' in report) out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, fast_mode_state: report.result, fast_mode_disabled_reason: report.reason });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const noted = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return { cli, started: () => noted().find(e => e.started).started, requests: () => noted().filter(e => e.subtype) };
};

test('a chat started in fast mode turns it on with apply_flag_settings once initialize is sent, and puts nothing about it in the CLI\'s arguments', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const recorded = recordingCli(dir);
  const chat = await startChat({ cwd: dir, mode: 'manual', model: 'claude-opus-5-5', effort: 'high', fast: true, text: 'hello', images: [], claude: recorded.cli, chrome: true, chips: null });
  t.after(() => chat.stop());
  await until(() => recorded.requests().some(r => r.subtype === 'set_max_thinking_tokens'));
  const asked = recorded.requests();
  assert.deepEqual(asked.filter(r => r.subtype === 'apply_flag_settings'), [{ subtype: 'apply_flag_settings', settings: { fastMode: true } }]);
  assert.ok(asked.findIndex(r => r.subtype === 'initialize') < asked.findIndex(r => r.subtype === 'apply_flag_settings'), 'after initialize');
  assert.equal(JSON.stringify(recorded.started()).includes('fastMode'), false, 'a value given at spawn could not be turned off later');
  assert.equal(chat.status().fast, true);
});

test('a chat started with fast mode off or unsaid asks for nothing about it', async t => {
  for (const fast of [undefined, false]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
    const recorded = recordingCli(dir);
    const chat = await startChat({ cwd: dir, mode: 'manual', fast, text: 'hello', images: [], claude: recorded.cli, chrome: false, chips: null });
    t.after(() => chat.stop());
    await until(() => recorded.requests().some(r => r.subtype === 'set_max_thinking_tokens'));
    assert.equal(recorded.requests().some(r => r.subtype === 'apply_flag_settings'), false, String(fast));
    assert.equal(chat.status().fast, false, String(fast));
  }
});

// A chat with fast mode picked and no process yet, with a listener on it before its first message starts one, as a viewer of the page is.
const fastChat = (t, id, options) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const recorded = recordingCli(dir, options);
  const chat = chatFor(id, { cwd: dir, mode: 'manual', model: 'claude-opus-5-5', fast: true, claude: recorded.cli, chrome: false, chips: null });
  // A failed assertion must not leave the CLI running, or the test run never ends.
  t.after(() => chat.stop());
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));
  return { chat, recorded, heard, told: () => heard.filter(e => e.type === 'fast').map(e => e.data) };
};

test('a chat started in fast mode shows it off until Claude accepts it and on after, and a later report of on says nothing new', async t => {
  const { chat, heard, told } = fastChat(t, 'fast-accepted', { reports: [{}, { init: 'on' }] });
  assert.equal(chat.status().fast, true, 'with no process the status shows the pick');

  chat.send('hello', []);
  assert.equal(chat.status().fast, false, 'Claude has not answered yet');
  await until(() => told().length === 2);
  assert.equal(chat.status().fast, true, 'accepted');

  chat.send('again', []);
  await until(() => heard.filter(e => e.type === 'init').length === 2);
  assert.deepEqual([chat.status().fast, chat.fast], [true, true]);
  assert.deepEqual(told(), [{ fast: false }, { fast: true }]);
});

test('a start in fast mode that Claude refuses turns fast mode off for the chat, tells the page and the hook once, and costs nothing else', async t => {
  const { chat, recorded, heard, told } = fastChat(t, 'fast-refused', { refuse: true });
  let refused = 0;
  chat.onFastRefused = () => { refused++; };

  chat.send('hello', []);
  assert.deepEqual(told(), [{ fast: false }], 'off until Claude has answered');
  await until(() => refused);
  assert.deepEqual(told(), [{ fast: false }, { fast: false }], 'and told again once it has refused, as the page may be showing the pick');
  assert.equal(chat.fast, false);
  assert.equal(chat.status().fast, false);
  await until(() => heard.some(e => e.type === 'init'));
  assert.equal(refused, 1);
  assert.equal(chat.status().running, true, 'the chat carries on');
  assert.equal(chat.status().lastError, '');

  chat.stop();
  await until(() => !chat.status().running);
  chat.send('again', []);
  await until(() => heard.filter(e => e.type === 'init').length === 2);
  assert.equal(recorded.requests().filter(r => r.subtype === 'apply_flag_settings').length, 1, 'the next process does not ask again');
  assert.deepEqual([chat.status().fast, refused], [false, 1]);
});

test('a request for fast mode that Claude does not answer in time is no refusal, so the pick and the hook are left alone and the status stays off', async t => {
  const { chat, heard, told } = fastChat(t, 'fast-unanswered', { silent: true });
  let refused = 0;
  chat.onFastRefused = () => { refused++; };

  chat.send('hello', []);
  await until(() => chat.replies.size === 1 && heard.some(e => e.type === 'init'));
  // Waiting out the 15 seconds would slow the run, so the reply that the timeout makes is given by hand.
  const [asked] = chat.replies.values();
  asked.done({ subtype: 'error', error: 'Claude did not answer in time.', unanswered: true });
  await wait(20);
  assert.deepEqual([chat.status().fast, chat.fast, refused], [false, true, 0]);
  assert.deepEqual(told(), [{ fast: false }]);
});

test('a stop before Claude has answered the request for fast mode is no refusal, and the status goes back to the pick', async t => {
  const { chat, heard, told } = fastChat(t, 'fast-stopped', { silent: true });
  let refused = 0;
  chat.onFastRefused = () => { refused++; };

  chat.send('hello', []);
  await until(() => heard.some(e => e.type === 'init'));
  chat.stop();
  await until(() => !chat.status().running);
  assert.deepEqual([chat.status().fast, chat.fast, refused], [true, true, 0]);
  assert.deepEqual(told(), [{ fast: false }, { fast: true }]);
});

test('a reply to the request that comes after its process was replaced says nothing about the pick', async t => {
  const { chat, recorded, told } = fastChat(t, 'fast-replaced', { silent: true });
  let refused = 0;
  chat.onFastRefused = () => { refused++; };

  chat.send('first', []);
  await until(() => chat.replies.size === 1);
  const [first] = chat.replies.keys();
  chat.stop();
  chat.send('second', []);
  await until(() => recorded.requests().filter(r => r.subtype === 'apply_flag_settings').length === 2);
  chat.handle({ type: 'control_response', response: { subtype: 'error', request_id: first, error: 'Too late.' } });
  await wait(20);
  assert.deepEqual([chat.fast, refused, told()], [true, 0, [{ fast: false }]]);
});

test('a reply to the request and then a report of off, read in the same chunk, end with the status off, since the report is the newer word', async t => {
  const { chat, told } = fastChat(t, 'fast-reply-then-off', { silent: true });

  chat.send('hello', []);
  await until(() => chat.replies.size === 1);
  const [asked] = chat.replies.keys();
  // The lines of one chunk are handled one after the other, with nothing run in between.
  chat.handle({ type: 'control_response', response: { subtype: 'success', request_id: asked } });
  chat.handle({ type: 'system', subtype: 'init', session_id: 'sess-recording', model: 'stub', fast_mode_state: 'off' });
  assert.deepEqual([chat.status().fast, chat.fast], [false, true]);
  assert.deepEqual(told(), [{ fast: false }, { fast: true }, { fast: false }]);
});

test('a report of off and then the reply to the request, read in the same chunk, end with the status on, since the acceptance is the newer word', async t => {
  const { chat, told } = fastChat(t, 'fast-off-then-reply', { silent: true });

  chat.send('hello', []);
  await until(() => chat.replies.size === 1);
  const [asked] = chat.replies.keys();
  chat.handle({ type: 'system', subtype: 'init', session_id: 'sess-recording', model: 'stub', fast_mode_state: 'off' });
  chat.handle({ type: 'control_response', response: { subtype: 'success', request_id: asked } });
  assert.deepEqual([chat.status().fast, chat.fast], [true, true]);
  assert.deepEqual(told(), [{ fast: false }, { fast: true }]);
});

test('a new process starts with no report of its own, so the one an earlier process left is cleared', async t => {
  const { chat, told } = fastChat(t, 'fast-leftover');
  // What a replaced process leaves behind, since its exit is ignored.
  chat.fast = false;
  chat.fastSaid = true;

  chat.send('hello', []);
  assert.equal(chat.status().fast, false);
  assert.deepEqual(told(), [{ fast: false }]);
});

test('a turn that reports fast mode off turns the status off and tells the page, cooldown counts as on, and a change of model goes back to the pick', async t => {
  const { chat, told } = fastChat(t, 'fast-reports', { reports: [{ init: 'on' }, { init: 'off' }, { init: 'cooldown' }, { result: 'off' }] });

  chat.send('first', []);
  await until(() => told().length === 2);
  assert.equal(chat.status().fast, true, 'accepted');

  chat.send('second', []);
  await until(() => told().length === 3);
  assert.equal(chat.status().fast, false, 'the turn said off');

  chat.send('third', []);
  await until(() => told().length === 4);
  assert.equal(chat.status().fast, true, 'cooldown is fast mode paused, and counts as on');

  chat.send('fourth', []);
  await until(() => told().length === 5);
  assert.equal(chat.status().fast, false, 'a result reports it as the start of a turn does');

  await chat.setModel('claude-sonnet-5-5');
  assert.equal(chat.status().fast, true, 'what Claude said was about the model before');
  assert.equal(chat.fast, true, 'the pick held through it all');
  assert.deepEqual(told(), [{ fast: false }, { fast: true }, { fast: false }, { fast: true }, { fast: false }, { fast: true }]);
});

test('a report of off with the reason pending, network_error or unknown settles nothing, so the status shows the pick, and off with another reason or none turns it off', async t => {
  const cases = [['sdk_opt_in_required', false], ['pending', true], [undefined, false], ['network_error', true], ['policy', false], ['unknown', true]];
  // A turn's system/init and its result each carry a report, so each is tried alone.
  for (const [line, ends] of [['init', 'init'], ['result', 'turn-end']]) {
    const { chat, heard, told } = fastChat(t, `fast-reasons-${line}`, { reports: cases.map(([reason]) => ({ [line]: 'off', reason })) });

    for (const [n, [reason, shown]] of cases.entries()) {
      chat.send(`turn ${n}`, []);
      await until(() => heard.filter(e => e.type === ends).length === n + 1);
      assert.equal(chat.status().fast, shown, `${line} with ${reason ?? 'no reason'}`);
    }
    assert.equal(chat.fast, true, 'the pick held through it all');
    assert.deepEqual(told(), [false, true, false, true, false, true, false, true].map(fast => ({ fast })), line);
  }
});

test('a reason beside a report of on or cooldown changes nothing, since only an off can be unsettled', async t => {
  const { chat, heard } = fastChat(t, 'fast-reason-beside-on', { reports: [{ init: 'on', reason: 'pending' }, { init: 'off' }, { init: 'cooldown', reason: 'unknown' }] });
  // With the pick off, only a report can show fast mode on.
  chat.fast = false;

  for (const [n, shown] of [true, false, true].entries()) {
    chat.send(`turn ${n}`, []);
    await until(() => heard.filter(e => e.type === 'init').length === n + 1);
    assert.equal(chat.status().fast, shown, `turn ${n}`);
  }
});

test('a switch of fast mode puts the status on the new pick, whatever the last turn reported', async t => {
  const { chat, told } = fastChat(t, 'fast-switched', { reports: [{ init: 'on' }, { init: 'off' }] });

  chat.send('first', []);
  await until(() => told().length === 2);
  chat.send('second', []);
  await until(() => told().length === 3);
  assert.equal(chat.status().fast, false, 'the turn said off');

  await chat.setFast(true);
  assert.deepEqual([chat.status().fast, chat.fast], [true, true]);
  await chat.setFast(false);
  assert.deepEqual([chat.status().fast, chat.fast], [false, false]);
  assert.deepEqual(told().slice(3), [{ fast: true }, { fast: false }]);
});

test('a report of fast mode that is not on, off or cooldown is ignored, so the status stays as the last report left it', async t => {
  const odd = [{ init: 'standby', result: 7 }, { init: null, result: true }, { init: {}, result: ['off'] }];
  const { chat, heard, told } = fastChat(t, 'fast-odd-reports', { reports: [{ init: 'on' }, { init: 'off' }, ...odd] });

  chat.send('first', []);
  await until(() => told().length === 2);
  chat.send('second', []);
  await until(() => told().length === 3);
  for (const [n, text] of ['third', 'fourth', 'fifth'].entries()) {
    chat.send(text, []);
    await until(() => heard.filter(e => e.type === 'turn-end').length === n + 1);
  }
  assert.deepEqual([chat.status().fast, chat.fast], [false, true]);
  assert.deepEqual(told(), [{ fast: false }, { fast: true }, { fast: false }]);
});

test('once its process has exited the status shows the pick again, and the next process asks for it again', async t => {
  const { chat, recorded, heard, told } = fastChat(t, 'fast-exited', { reports: [{ init: 'on' }, { init: 'off' }] });

  chat.send('first', []);
  await until(() => told().length === 2);
  chat.send('second', []);
  await until(() => told().length === 3);
  assert.equal(chat.status().fast, false, 'the turn said off');

  chat.stop();
  await until(() => !chat.status().running);
  assert.deepEqual([chat.status().fast, chat.fast], [true, true]);
  assert.deepEqual(told().at(-1), { fast: true });

  chat.send('third', []);
  assert.equal(chat.status().fast, false, 'off again until the new process has accepted it');
  await until(() => recorded.requests().filter(r => r.subtype === 'apply_flag_settings').length === 2);
  assert.equal(heard.filter(e => e.type === 'exit').length, 1);
});

test('a reply that Capcom makes up for want of one is marked unanswered, whether Claude was too slow or stopped first, and one from Claude is not', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const recorded = recordingCli(dir, { silent: true });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: recorded.cli, chrome: false, chips: null });
  t.after(() => chat.stop());
  const ask = { subtype: 'apply_flag_settings', settings: { fastMode: true } };

  assert.deepEqual(await chat.request(ask, 50), { subtype: 'error', error: 'Claude did not answer in time.', unanswered: true });
  const stopped = chat.request(ask);
  chat.stop();
  assert.deepEqual(await stopped, { subtype: 'error', error: 'Claude stopped before it answered.', unanswered: true });
});

test('the reply to a request reaches onReply as its line is read, and so does the one Capcom makes up for a timeout or a stop', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const recorded = recordingCli(dir, { silent: true });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: recorded.cli, chrome: false, chips: null });
  t.after(() => chat.stop());
  const ask = { subtype: 'apply_flag_settings', settings: { fastMode: true } };
  const got = [];
  const onReply = reply => got.push(reply);

  const answered = chat.request(ask, undefined, { onReply });
  const [asked] = chat.replies.keys();
  chat.handle({ type: 'control_response', response: { request_id: asked, subtype: 'success' } });
  assert.deepEqual(got, [{ request_id: asked, subtype: 'success' }], 'before the promise has run');
  assert.deepEqual(await answered, got[0]);

  await chat.request(ask, 30, { onReply });
  assert.deepEqual(got.at(-1), { subtype: 'error', error: 'Claude did not answer in time.', unanswered: true });

  const stopped = chat.request(ask, undefined, { onReply });
  chat.stop();
  await stopped;
  assert.deepEqual(got.at(-1), { subtype: 'error', error: 'Claude stopped before it answered.', unanswered: true });
  assert.equal(got.length, 3);
});

test('a reply that Claude gives, a refusal included, is not marked unanswered', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const recorded = recordingCli(dir, { refuse: true });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: recorded.cli, chrome: false, chips: null });
  t.after(() => chat.stop());

  const reply = await chat.request({ subtype: 'apply_flag_settings', settings: { fastMode: true } });
  assert.equal(reply.subtype, 'error');
  assert.equal(reply.error, 'Not on this model.');
  assert.equal('unanswered' in reply, false);
});

test('turning fast mode on or off asks Claude with apply_flag_settings and tells the page, and the status says which', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const recorded = recordingCli(dir);
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: recorded.cli, chrome: false, chips: null });
  t.after(() => chat.stop());
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));
  await chat.setFast(true);
  assert.equal(chat.status().fast, true);
  await chat.setFast(false);
  assert.equal(chat.status().fast, false);
  assert.deepEqual(recorded.requests().filter(r => r.subtype === 'apply_flag_settings'), [
    { subtype: 'apply_flag_settings', settings: { fastMode: true } },
    { subtype: 'apply_flag_settings', settings: { fastMode: false } },
  ]);
  assert.deepEqual(heard.filter(e => e.type === 'fast').map(e => e.data), [{ fast: true }, { fast: false }]);
});

test('a fast mode change Claude refuses throws what Claude said, tells no page and leaves fast mode as it was', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const recorded = recordingCli(dir, { refuse: true });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: recorded.cli, chrome: false, chips: null });
  t.after(() => chat.stop());
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));
  await assert.rejects(chat.setFast(true), { message: 'Not on this model.' });
  assert.equal(chat.status().fast, false);
  assert.deepEqual(heard.filter(e => e.type === 'fast'), []);
});

test('a reply to initialize with an error or with no commands leaves the chat with no list, keeps nothing for its folder, and does not stop the chat', async t => {
  for (const reply of [{ subtype: 'error', error: 'Not today.' }, { subtype: 'success', response: {} }]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
    const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: listingCli(dir, reply), chrome: false, chips: null });
    t.after(() => chat.stop());
    assert.equal(chat.commands, null, reply.subtype);
    assert.equal(chat.models, null, reply.subtype);
    assert.equal(chat.status().running, true, 'the chat carries on');
    await assert.rejects(listCommands(dir, path.join(dir, 'no-such-claude')), /ENOENT/, 'the folder has to ask for itself');
  }
});

test('the context count is asked for with the detail wanted, comes back as the CLI gave it, and is null when the CLI refuses, answers with something else, or is not running', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const log = path.join(dir, 'stdin.log');
  const cli = path.join(dir, 'counting-claude.mjs');
  const count = { totalTokens: 47760, maxTokens: 300000, categories: [{ id: 'messages', name: 'Messages', tokens: 20000, kind: 'used' }] };
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    `const replies = { summary: { subtype: 'success', response: ${JSON.stringify(count)} }, full: { subtype: 'error', error: 'Cannot count.' }, text: { subtype: 'success', response: 'text' }, bare: { subtype: 'success' } };`,
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    `  fs.appendFileSync(${JSON.stringify(log)}, line + '\\n');`,
    '  const m = JSON.parse(line);',
    "  if (m.type === 'user') return out({ type: 'system', subtype: 'init', session_id: 'sess-context-1', model: 'stub' });",
    "  if (m.request?.subtype === 'get_context_usage') out({ type: 'control_response', response: { request_id: m.request_id, ...replies[m.request.detail] } });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const asks = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).request).filter(r => r?.subtype === 'get_context_usage');

  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start', images: [], claude: cli, chrome: false, chips: null });
  t.after(() => chat.stop());
  const before = [chat.state, chat.seq];
  assert.deepEqual(await chat.contextUsage('summary'), count);
  assert.equal(await chat.contextUsage('full'), null, 'a refusal is no count');
  assert.equal(await chat.contextUsage('text'), null, 'a reply that is not an object is none either');
  assert.equal(await chat.contextUsage('bare'), null, 'nor is a success with nothing in it');
  assert.deepEqual(asks().map(r => r.detail), ['summary', 'full', 'text', 'bare']);
  assert.deepEqual([chat.state, chat.seq], before, 'a count is not a turn, so the page hears nothing of it');

  chat.stop();
  await until(() => !chat.status().running);
  assert.equal(await chat.contextUsage('summary'), null, 'with no process there is nothing to ask');
  assert.equal(asks().length, 4);
});

test('a context count leaves the idle clock alone, so a chat nobody is using is still stopped, while the reply to any other control request restarts it', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const cli = path.join(dir, 'idle-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type === 'user') { out({ type: 'system', subtype: 'init', session_id: 'sess-idle-1', model: 'stub' }); out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 }); }",
    "  if (m.request?.subtype === 'get_context_usage') out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { totalTokens: 1, maxTokens: 10 } } });",
    "  if (m.request?.subtype === 'apply_flag_settings') out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start', images: [], claude: cli, chrome: false, chips: null });
  t.after(() => chat.stop());
  await until(() => chat.state === 'idle');
  const idleMinutes = () => (Date.now() - chat.lastActive) / 60_000;

  chat.lastActive = Date.now() - 31 * 60_000;
  await chat.setEffort('high');
  assert.ok(idleMinutes() < 1, 'the reply to a change of effort counts as use');
  sweep(30);
  assert.equal(chat.status().running, true, 'so the sweep leaves the chat running');

  chat.lastActive = Date.now() - 31 * 60_000;
  assert.ok(await chat.contextUsage('summary'));
  assert.ok(await chat.contextUsage('full'));
  assert.ok(idleMinutes() > 30, 'a count of either detail is no use of the chat');
  sweep(30);
  await until(() => !chat.status().running);
});

// A CLI that names its session when sent 'start <id>', ends the turn when sent 'finish', ends it with an error when sent 'fail', and exits
// when sent 'crash'. Sent anything else it says nothing, so the turn stays open.
const turningCli = dir => {
  const cli = path.join(dir, 'turning-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    "  const [word, id] = m.message.content.split(' ');",
    "  if (word === 'start') out({ type: 'system', subtype: 'init', session_id: id, model: 'stub' });",
    "  if (word === 'finish') out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 });",
    "  if (word === 'fail') out({ type: 'result', subtype: 'success', is_error: true, result: 'It failed.' });",
    "  if (word === 'crash') process.exit(3);",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  return cli;
};

const heardTurns = t => {
  const heard = [];
  onTurn(e => heard.push(e));
  t.after(() => onTurn(null));
  return heard;
};
const kinds = heard => heard.map(({ id, kind }) => [id, kind]);

test('a turn is reported when it starts and when it ends, under the session the CLI named, and never under the temporary id a new chat has', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const heard = heardTurns(t);
  const before = Date.now();
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start sess-turn-1', images: [], claude: turningCli(dir), chrome: false, chips: null });
  t.after(() => chat.stop());
  assert.deepEqual(kinds(heard), [['sess-turn-1', 'start']], 'the first turn is reported once its session has a name');
  assert.ok(heard[0].at >= before && heard[0].at <= Date.now(), 'at the time the turn began');

  chat.send('finish', []);
  await until(() => chat.state === 'idle');
  assert.deepEqual(kinds(heard), [['sess-turn-1', 'start'], ['sess-turn-1', 'end']]);
  assert.ok(heard[1].at >= heard[0].at);

  chat.send('finish', []);
  await until(() => heard.length === 4);
  assert.deepEqual(kinds(heard).slice(2), [['sess-turn-1', 'start'], ['sess-turn-1', 'end']], 'a later turn is reported the same way');
  assert.ok(heard.every(e => !e.id.startsWith('new-')));
});

test('a turn that ends in an error is reported as ended and as failed, and a turn the owner stopped is reported as ended only', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const heard = heardTurns(t);
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start sess-turn-2', images: [], claude: turningCli(dir), chrome: false, chips: null });
  t.after(() => chat.stop());

  chat.send('fail', []);
  await until(() => heard.length === 3);
  assert.deepEqual(kinds(heard), [['sess-turn-2', 'start'], ['sess-turn-2', 'end'], ['sess-turn-2', 'failed']]);

  heard.length = 0;
  chat.send('hold', []);
  await until(() => heard.length === 1);
  chat.interrupt();
  chat.send('fail', []);
  await until(() => chat.state === 'idle');
  assert.deepEqual(kinds(heard), [['sess-turn-2', 'start'], ['sess-turn-2', 'end']], 'a stopped turn is no failure');
});

test('a CLI that dies in the middle of a turn ends it as a failure', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const heard = heardTurns(t);
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start sess-turn-3', images: [], claude: turningCli(dir), chrome: false, chips: null });
  t.after(() => chat.stop());
  heard.length = 0;
  chat.send('crash', []);
  await until(() => heard.some(e => e.kind === 'end'));
  assert.deepEqual(new Set(heard.map(e => e.kind)), new Set(['failed', 'end']));
  assert.ok(heard.every(e => e.id === 'sess-turn-3'));
});

test('the hook is no listener on the chat, so a chat nobody watches is still stopped by the idle sweep', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const heard = heardTurns(t);
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start sess-turn-4', images: [], claude: turningCli(dir), chrome: false, chips: null });
  t.after(() => chat.stop());
  chat.send('finish', []);
  await until(() => chat.state === 'idle');
  assert.ok(heard.length > 0, 'the hook is in use');
  assert.equal(chat.listeners.size, 0);
  chat.lastActive = Date.now() - 31 * 60_000;
  sweep(30);
  await until(() => !chat.status().running);
});

test('with no hook installed a turn runs the same', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  onTurn(null);
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start sess-turn-5', images: [], claude: turningCli(dir), chrome: false, chips: null });
  t.after(() => chat.stop());
  chat.send('finish', []);
  await until(() => chat.state === 'idle');
  assert.equal(chat.status().running, true);
});

// A CLI for a group's chat. It logs how it was started and every line it is sent. It starts its session when it is sent the first message
// (named by --session-id or --resume), and a message of `call <tool> <json>` makes it ask Capcom's tool server, `ask <tool> [json]` ask to use one of Capcom's tools, with that input and `builtin <Tool>` one of the CLI's own.
// Each of these starts several CLIs, which a busy machine can be slow to launch, so they wait longer than the others.
const slow = check => until(check, 20_000);
const groupCli = dir => {
  const log = path.join(dir, 'group.log');
  const cli = path.join(dir, 'group-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    `const note = entry => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');`,
    "const flag = name => process.argv[process.argv.indexOf(name) + 1];",
    "note({ started: process.argv.slice(2), cwd: process.cwd() });",
    "const rule = [{ type: 'addRules', rules: [{ toolName: 'x' }], behavior: 'allow', destination: 'localSettings' }];",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    '  note(m);',
    "  if (m.type === 'control_request') return out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { commands: [], models: [] } } });",
    "  if (m.type !== 'user') return;",
    "  out({ type: 'system', subtype: 'init', session_id: flag('--session-id') || flag('--resume') || 'sess-unnamed', model: 'stub' });",
    "  const [verb, tool, ...rest] = m.message.content.split(' ');",
    "  if (verb === 'ask') out({ type: 'control_request', request_id: `ask-${tool}`, request: { subtype: 'can_use_tool', tool_name: `mcp__capcom__${tool}`, input: JSON.parse(rest.join(' ') || '{}'), permission_suggestions: rule } });",
    "  if (verb === 'builtin') out({ type: 'control_request', request_id: `builtin-${tool}`, request: { subtype: 'can_use_tool', tool_name: tool, input: {}, permission_suggestions: rule } });",
    "  if (verb === 'call') out({ type: 'control_request', request_id: `call-${tool}`, request: { subtype: 'mcp_message', server_name: 'capcom', message: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: JSON.parse(rest.join(' ') || '{}') } } } });",
    "  if (verb === 'tools') out({ type: 'control_request', request_id: 'tools', request: { subtype: 'mcp_message', server_name: 'capcom', message: { jsonrpc: '2.0', id: 2, method: 'tools/list' } } });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const noted = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return {
    cli,
    starts: () => noted().filter(e => e.started),
    answers: () => noted().filter(m => m.type === 'control_response').map(m => m.response).filter(r => r.request_id),
  };
};

const GROUP_ID = '11111111-2222-4333-8444-555555555555';
// What a group's chat is made to ask about, whatever the mode. Spelled out here so a change to the list is a change to a test.
const GROUP_ASKS = ['mcp__capcom__start_group_session', 'mcp__capcom__send_session', 'Bash', 'Monitor', 'Write', 'Edit', 'NotebookEdit', 'SendMessage'];
const groupChat = (t, { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-')), id = GROUP_ID, ...options } = {}) => {
  const recorded = groupCli(dir);
  const cwd = path.join(dir, 'groups', 'cg-1');
  const chat = chatFor(id, { cwd, mode: 'manual', claude: recorded.cli, chrome: false, chips: null, ...options });
  // A failed assertion must not leave the CLI running, or the test run never ends.
  t.after(() => chat.stop());
  return { chat, recorded, cwd, dir };
};
const flagOf = (argv, name) => argv[argv.indexOf(name) + 1];

test('a group chat whose session has no transcript yet starts with --session-id, its instructions, the tools that act asked about, only the user settings loaded, and its own folder made 0700 and used as the working folder', async t => {
  const { chat, recorded, cwd } = groupChat(t, { group: {}, instructions: 'Be the group of {{x}}', fresh: () => true, id: '11111111-2222-4333-8444-000000000001' });
  assert.equal(fs.existsSync(cwd), false);
  chat.send('hi', []);
  await slow(() => recorded.starts().length === 1);
  const { started, cwd: ran } = recorded.starts()[0];
  assert.equal(flagOf(started, '--session-id'), '11111111-2222-4333-8444-000000000001');
  assert.equal(started.includes('--resume'), false);
  assert.equal(flagOf(started, '--append-system-prompt'), 'Be the group of {{x}}');
  assert.deepEqual(JSON.parse(flagOf(started, '--settings')), { permissions: { ask: GROUP_ASKS } });
  assert.equal(flagOf(started, '--setting-sources'), 'user', 'a settings file in the group\'s own folder is never loaded');
  assert.equal(started.includes('--chrome'), false);
  assert.equal(fs.realpathSync(ran), fs.realpathSync(cwd));
  assert.equal(fs.statSync(cwd).mode & 0o777, 0o700);
});

test('a group chat whose session has a transcript resumes it and gets its instructions again, read afresh at each spawn, and Chrome joins the tools of the group in one ask list', async t => {
  let text = 'first guide';
  const { chat, recorded, cwd } = groupChat(t, { group: {}, instructions: () => text, fresh: () => false, chrome: true, id: '11111111-2222-4333-8444-000000000002' });
  fs.mkdirSync(cwd, { recursive: true });
  chat.send('hi', []);
  await slow(() => recorded.starts().length === 1);
  const [{ started }] = recorded.starts();
  assert.equal(flagOf(started, '--resume'), '11111111-2222-4333-8444-000000000002');
  assert.equal(started.includes('--session-id'), false);
  assert.equal(flagOf(started, '--append-system-prompt'), 'first guide');
  assert.deepEqual(JSON.parse(flagOf(started, '--settings')), { permissions: { ask: ['mcp__claude-in-chrome', ...GROUP_ASKS] } });
  assert.equal(started.includes('--chrome'), true);
  chat.stop();
  await slow(() => !chat.status().running);
  text = 'second guide';
  fs.rmSync(cwd, { recursive: true });
  chat.send('again', []);
  await slow(() => recorded.starts().length === 2);
  assert.equal(flagOf(recorded.starts()[1].started, '--append-system-prompt'), 'second guide');
  assert.equal(fs.existsSync(cwd), true, 'a folder that went is made again before the spawn, so the chat does not fall back to the home folder');
  assert.equal(fs.realpathSync(recorded.starts()[1].cwd), fs.realpathSync(cwd));
});

test('whether the CLI has a transcript is asked at each spawn, so the first process names the session and a later one resumes it', async t => {
  let fresh = true;
  const { chat, recorded } = groupChat(t, { group: {}, instructions: 'guide', fresh: () => fresh, id: '11111111-2222-4333-8444-000000000003' });
  chat.send('hi', []);
  await slow(() => recorded.starts().length === 1);
  fresh = false;
  chat.stop();
  await slow(() => !chat.status().running);
  chat.send('again', []);
  await slow(() => recorded.starts().length === 2);
  assert.deepEqual(recorded.starts().map(s => s.started.includes('--session-id')), [true, false]);
  assert.deepEqual(recorded.starts().map(s => s.started.includes('--resume')), [false, true]);
});

test('an ordinary chat is started as before: --resume, no instructions, every settings file loaded, no ask rule unless Chrome is on, and Chrome\'s rule is exactly what it was', async t => {
  const plain = groupChat(t, { id: '11111111-2222-4333-8444-000000000004' });
  plain.chat.send('hi', []);
  await slow(() => plain.recorded.starts().length === 1);
  const [{ started }] = plain.recorded.starts();
  assert.equal(flagOf(started, '--resume'), '11111111-2222-4333-8444-000000000004');
  for (const flag of ['--session-id', '--append-system-prompt', '--settings', '--setting-sources']) assert.equal(started.includes(flag), false, flag);
  assert.equal(fs.existsSync(plain.cwd), false, 'only a group chat makes its folder');
  const chrome = groupChat(t, { id: '11111111-2222-4333-8444-000000000005', chrome: true });
  chrome.chat.send('hi', []);
  await slow(() => chrome.recorded.starts().length === 1);
  assert.equal(flagOf(chrome.recorded.starts()[0].started, '--settings'), '{"permissions":{"ask":["mcp__claude-in-chrome"]}}');
});

test('the tools a group chat offers are the group\'s as well, and an ordinary chat offers none of them', async t => {
  const names = async chat => {
    chat.send('tools', []);
    await slow(() => chat.status().running);
    return chat;
  };
  const withGroup = groupChat(t, { group: {}, id: '11111111-2222-4333-8444-000000000006' });
  const without = groupChat(t, { id: '11111111-2222-4333-8444-000000000007' });
  await names(withGroup.chat);
  await names(without.chat);
  await slow(() => withGroup.recorded.answers().some(a => a.request_id === 'tools') && without.recorded.answers().some(a => a.request_id === 'tools'));
  const listed = ({ recorded }) => recorded.answers().find(a => a.request_id === 'tools').response.mcp_response.result.tools.map(tool => tool.name);
  assert.ok(['list_group_sessions', 'read_group_session', 'start_group_session'].every(n => listed(withGroup).includes(n)));
  assert.equal(listed(without).some(n => n.endsWith('_group_session') || n === 'list_group_sessions'), false);
});

test('a tool call that waits is answered when it settles, not before, and an answer for a process that has gone is not written to the next one', async t => {
  const finishers = [];
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-state-'));
  const group = { lookup: () => ({ name: 'Work', members: [] }), pending: () => [], stateDir, start: () => new Promise(done => finishers.push(done)) };
  const { chat, recorded, dir } = groupChat(t, { group, id: '11111111-2222-4333-8444-000000000008' });
  const repo = fs.mkdtempSync(path.join(dir, 'repo-'));
  const call = text => ({ text: `call start_group_session ${JSON.stringify({ cwd: repo, prompt: text })}` });
  chat.send(call('first').text, []);
  await slow(() => finishers.length === 1);
  await wait(100);
  assert.equal(recorded.answers().some(a => a.request_id === 'call-start_group_session'), false, 'nothing is written while the start is still going');
  finishers[0]({ id: 'child-one', placed: true });
  await slow(() => recorded.answers().some(a => a.request_id === 'call-start_group_session'));
  const answer = recorded.answers().find(a => a.request_id === 'call-start_group_session').response.mcp_response;
  assert.equal(answer.id, 1);
  assert.match(answer.result.content[0].text, /^Started session \[child-one\]/);

  chat.send(call('second').text, []);
  await slow(() => finishers.length === 2);
  chat.stop();
  await slow(() => !chat.status().running);
  chat.send('hello', []);
  await slow(() => recorded.starts().length === 2);
  const before = recorded.answers().length;
  finishers[1]({ id: 'child-two', placed: true });
  await wait(150);
  assert.equal(recorded.answers().length, before, 'the process that asked is gone, so the new one is told nothing about its request');
});

test('in a group chat the read tools are allowed with no card, in any mode, and starting a session always shows a card that does not offer Always allow', async t => {
  for (const mode of ['manual', 'bypassPermissions', 'auto']) {
    const { chat, recorded } = groupChat(t, { group: {}, mode, id: `11111111-2222-4333-8444-00000000001${['manual', 'bypassPermissions', 'auto'].indexOf(mode)}` });
    chat.send('ask list_group_sessions', []);
    await slow(() => recorded.answers().some(a => a.request_id === 'ask-list_group_sessions'));
    chat.send('ask read_group_session', []);
    await slow(() => recorded.answers().some(a => a.request_id === 'ask-read_group_session'));
    chat.send('ask start_group_session', []);
    await slow(() => chat.status().pending.length === 1);
    assert.deepEqual(chat.status().pending.map(p => [p.tool, p.always]), [['mcp__capcom__start_group_session', false]], mode);
    assert.deepEqual(recorded.answers().filter(a => a.request_id.startsWith('ask-')).map(a => [a.request_id, a.response.behavior]), [['ask-list_group_sessions', 'allow'], ['ask-read_group_session', 'allow']], mode);
    chat.answer('ask-start_group_session', 'always');
    await slow(() => recorded.answers().some(a => a.request_id === 'ask-start_group_session'));
    assert.equal(recorded.answers().find(a => a.request_id === 'ask-start_group_session').response.updatedPermissions, undefined, 'Always allow keeps no rule for it');
  }
});

test('in a group chat Bash, Monitor, file edits and messages to other sessions always show a card, in any mode, with no Always allow, even when the CLI offers one', async t => {
  const modes = ['manual', 'bypassPermissions', 'auto'];
  for (const mode of modes) {
    const { chat, recorded } = groupChat(t, { group: {}, mode, id: `11111111-2222-4333-8444-00000000003${modes.indexOf(mode)}` });
    const builtin = GROUP_ASKS.filter(name => !name.startsWith('mcp__'));
    for (const [n, name] of builtin.entries()) {
      chat.send(`builtin ${name}`, []);
      await slow(() => chat.status().pending.length === n + 1);
    }
    assert.deepEqual(chat.status().pending.map(p => [p.tool, p.always]), builtin.map(name => [name, false]), mode);
    assert.equal(recorded.answers().some(a => a.request_id.startsWith('builtin-')), false, `${mode}: nothing was allowed without the owner`);
    chat.answer('builtin-Bash', 'always');
    await slow(() => recorded.answers().some(a => a.request_id === 'builtin-Bash'));
    assert.equal(recorded.answers().find(a => a.request_id === 'builtin-Bash').response.updatedPermissions, undefined, 'Always allow keeps no rule for it');
  }
});

test('outside a group chat the CLI\'s own tools keep Always allow, and a group chat still offers it for a tool it does not ask about', async t => {
  const plain = groupChat(t, { mode: 'manual', id: '11111111-2222-4333-8444-000000000040' });
  plain.chat.send('builtin Bash', []);
  await slow(() => plain.chat.status().pending.length === 1);
  assert.equal(plain.chat.status().pending[0].always, true);
  const grouped = groupChat(t, { group: {}, mode: 'manual', id: '11111111-2222-4333-8444-000000000041' });
  grouped.chat.send('builtin WebFetch', []);
  await slow(() => grouped.chat.status().pending.length === 1);
  assert.equal(grouped.chat.status().pending[0].always, true);
});

test('outside a group chat the group tools are no business of the runner\'s: they get a card like any tool, with no automatic allow', async t => {
  const { chat, recorded } = groupChat(t, { mode: 'bypassPermissions', id: '11111111-2222-4333-8444-000000000020' });
  chat.send('ask list_group_sessions', []);
  await slow(() => chat.status().pending.length === 1);
  chat.send('ask read_group_session', []);
  await slow(() => chat.status().pending.length === 2);
  assert.equal(recorded.answers().some(a => a.request_id.startsWith('ask-')), false);
});

test('a tool call from an ordinary chat is refused by the tool server as unknown, since there is no group behind it', async t => {
  const { chat, recorded } = groupChat(t, { id: '11111111-2222-4333-8444-000000000021' });
  chat.send('call list_group_sessions {}', []);
  await slow(() => recorded.answers().some(a => a.request_id === 'call-list_group_sessions'));
  const { result, error } = recorded.answers().find(a => a.request_id === 'call-list_group_sessions').response.mcp_response;
  assert.ok(error || result?.isError, JSON.stringify({ result, error }));
});

const SUB_SEND = 'mcp__capcom__send_session';
const subsOf = (rows = [{ id: 'kid', title: 'Review - dialogs' }]) => () => ({ lookup: () => ({ self: { id: 'me', title: 'Me' }, rows: rows.map(r => ({ via: 'me', ...r })) }), pending: () => [], summary: () => null });

test('an ordinary chat that has sub sessions asks before every send to one, a group chat asks for it in its own list, one with no sub sessions is given no rule, and Chrome\'s stays beside it', async t => {
  const rules = async (id, options) => {
    const { chat, recorded } = groupChat(t, { id, ...options });
    chat.send('hi', []);
    await slow(() => recorded.starts().length === 1);
    const { started } = recorded.starts()[0];
    return started.includes('--settings') ? JSON.parse(flagOf(started, '--settings')).permissions.ask : undefined;
  };
  assert.deepEqual(await rules('11111111-2222-4333-8444-000000000050', { subs: subsOf() }), [SUB_SEND]);
  assert.deepEqual(await rules('11111111-2222-4333-8444-000000000051', { subs: subsOf(), chrome: true }), ['mcp__claude-in-chrome', SUB_SEND]);
  assert.equal(await rules('11111111-2222-4333-8444-000000000052', {}), undefined, 'a chat with no sub sessions to reach is given no rule');
  assert.deepEqual(await rules('11111111-2222-4333-8444-000000000053', { group: {}, subs: subsOf() }), GROUP_ASKS, 'a group chat keeps its own list, which has the send in it');
});

test('in an ordinary chat a send to a sub session always shows a card, in any mode, naming the recipient and the start of the message, with no Always allow even when the CLI offers one, while the reads need no card', async t => {
  const modes = ['manual', 'bypassPermissions', 'auto'];
  for (const mode of modes) {
    const { chat, recorded } = groupChat(t, { subs: subsOf(), mode, id: `11111111-2222-4333-8444-00000000006${modes.indexOf(mode)}` });
    for (const tool of ['list_sub_sessions', 'read_sub_session']) {
      chat.send(`ask ${tool}`, []);
      await slow(() => recorded.answers().some(a => a.request_id === `ask-${tool}`));
    }
    chat.send(`ask send_session ${JSON.stringify({ session_id: 'kid', message: 'Please rebase\nand push' })}`, []);
    await slow(() => chat.status().pending.length === 1);
    const [card] = chat.status().pending;
    assert.deepEqual([card.tool, card.always, card.summary], [SUB_SEND, false, 'to "Review - dialogs": Please rebase and push'], mode);
    assert.deepEqual(recorded.answers().filter(a => a.request_id.startsWith('ask-')).map(a => [a.request_id, a.response.behavior]), [['ask-list_sub_sessions', 'allow'], ['ask-read_sub_session', 'allow']], mode);
    chat.answer('ask-send_session', 'always');
    await slow(() => recorded.answers().some(a => a.request_id === 'ask-send_session'));
    const answer = recorded.answers().find(a => a.request_id === 'ask-send_session').response;
    assert.deepEqual([answer.behavior, answer.updatedPermissions], ['allow', undefined], 'Always allow keeps no rule for it');
  }
});

test('in a group chat a send always shows a card too, in any mode, naming the recipient, with no Always allow, while its reads of sub sessions are not allowed', async t => {
  const modes = ['manual', 'bypassPermissions', 'auto'];
  for (const mode of modes) {
    const { chat, recorded } = groupChat(t, { group: {}, subs: subsOf(), mode, id: `11111111-2222-4333-8444-00000000008${modes.indexOf(mode)}` });
    chat.send('ask read_sub_session', []);
    chat.send(`ask send_session ${JSON.stringify({ session_id: 'kid', message: 'Please rebase' })}`, []);
    await slow(() => chat.status().pending.length === 2);
    const card = chat.status().pending.find(p => p.tool === SUB_SEND);
    assert.deepEqual([card.always, card.summary], [false, 'to "Review - dialogs": Please rebase'], mode);
    assert.equal(recorded.answers().some(a => a.request_id.startsWith('ask-')), false, mode);
  }
});

test('a chat with no sub sessions, and a group chat, are given no automatic allow for the send tool either', async t => {
  for (const [n, options] of [{}, { group: {} }].entries()) {
    const { chat, recorded } = groupChat(t, { mode: 'bypassPermissions', id: `11111111-2222-4333-8444-00000000007${n}`, ...options });
    chat.send('ask send_session {}', []);
    await slow(() => chat.status().pending.length === 1);
    assert.equal(recorded.answers().some(a => a.request_id.startsWith('ask-')), false);
  }
});
