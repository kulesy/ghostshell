// Shared by the tests that start the real server on a free port, each with its own home and state folders, and talk to it over HTTP.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePassword } from '../lib/auth.mjs';
import { batch, logOf, set } from './leveldb-fixture.mjs';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PASSWORD = 'a long password for the tests';
export const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-server-test-'));
// What the fake CLI answers to an initialize request, as the real one does: `clear` and `__remote-workflow` are for the server to leave out.
export const CLI_COMMANDS = [
  { name: 'review-pr', description: 'Review a pull request  (user)', argumentHint: '[number]' },
  { name: 'clear', description: 'Clear the conversation', builtin: true },
  { name: 'code-review', description: 'Review the diff', argumentHint: '[level]', builtin: true, aliases: ['review'] },
  { name: '__remote-workflow', builtin: true },
];
// And its models: the aliases come first, then the full ids, as the real one lists them. Only some Opus models take fast mode.
export const CLI_MODELS = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportsFastMode: true },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', supportsFastMode: true },
  { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku' },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
  { value: 'claude-sonnet-5', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet 5' },
  { value: 'claude-opus-5', resolvedModel: 'claude-opus-5', displayName: 'Opus 5', supportsFastMode: true },
  { value: 'claude-fable-5', resolvedModel: 'claude-fable-5', displayName: 'Fable 5' },
  { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: 'Opus 4.8', supportsFastMode: true },
];
const running = [];
const launches = new WeakMap();

const freePort = () => new Promise(resolve => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// Desktop's records and the CLI's transcripts for `sessions`, Capcom's layout over them, and a CLI that logs how it was started, what it was sent
// and when its input closed. It answers an initialize request with CLI_COMMANDS and CLI_MODELS, and a change of model or setting with success, logging the settings.
// It refuses a switch to the model `refused-by-the-fake`, and a request for fast mode when it was started on the model `no-fast-by-the-fake`.
// Started on `late-no-fast-by-the-fake` it refuses that request too, but holds the refusal until it is sent anything after 'begin a session'.
// Sent 'finish the turn with fast mode off' it ends the turn as 'finish the turn' does, with a result that reports fast mode off.
// Sent 'begin a session', or a message that opens with a file mention (as text, or as the text block beside pictures or documents), it names its session, sent 'ask for approval' it asks to run a command, sent 'finish the turn' it ends the turn and stays open, and
// sent 'fail the turn' it ends the turn with an error. It never answers an interrupt, but copies layout.json as it is then to layout-at-interrupt.json in
// the home, and it exits when its input closes. A request for the context usage is answered from the `summary` or `full` entry of context-usage.json in the home, or with an error if there is none.
// Started with --session-id it names that session, writes its transcript on the first message, and exits at once if there already is one, as the real
// CLI does. Sent 'call <tool> <json>' it calls that tool of Capcom's own server, sent 'list the tools' it lists them, and sent 'ask to start a session',
// 'ask to list the group', 'ask to list the subs' or 'ask to send to a sub' it asks to use the tool of that name, and a message that opens with a <session-message> tag ends its turn. The log has the folder it started in, and the reply to each such request as `mcp`.
// `autoTitle` turns on naming sessions from their first turn, which is off in the tests unless they ask, since the fake CLI would be asked as well.
// A session is { id, title, archived, archivedAgo, routine, group, pinned, ago, source, remoteMcpServersConfig, parent, spawnedFrom, lineageDetached, fileAgo,
// edgeAgo, createdAgo, forkedFrom, verdict, errorAgo, fields }, with `ago`, `archivedAgo` (when Desktop archived it) and the other `Ago` times in minutes.
// `ago` is the record's lastActivityAt and, unless `fileAgo` says otherwise, when the transcript was written. `edgeAgo` and `createdAgo` write the record's
// lastTurnEdgeAt and createdAt, `forkedFrom` its forkedFromSessionId, `verdict` the status_category of its postTurnSummary, and `errorAgo` an error and when it
// happened. `fields` is merged over the record last, so a key set to undefined is left out of it.
// A source of 'desktop' (the default) has a Desktop record, 'capcom' is listed in started.json instead, with its `routine`, and 'cli' has a transcript only, as a terminal
// session does. `groups` and `layout` are written as they are, and so is a session's `remoteMcpServersConfig`, a null included. A record has no such key without it.
// `parent` is the id of the session Desktop links this one to, as a side chat: the record's `spawnedFrom` names it with `sideSession` true. `spawnedFrom` and
// `lineageDetached` are written as they are, for the records Desktop does not count as a link.
// `sections` is how Desktop sorts its lists: an array for the scope that holds the groups, or an object of scope keys to arrays. `localStorage` is Desktop's
// Local Storage, with the ids of the sessions it marks `unread` and the minutes ago it `acked` each id, and writes a key only for what it is given. `marks` is
// Capcom's marks.json, with the minutes ago for each id under `edges`, `seen`, `unread` and `errors`. `chips` are the chips in chips.json, each
// { sessionId, startedId, status } with the other fields as they are, a `toolUseId` made up when it has none, and `status` open unless it is given.
function furnish(home, state, { sessions = [], groups = [], layout = {}, claude = false, sections, localStorage, marks, chips }) {
  const desktop = path.join(home, 'Library', 'Application Support', 'Claude');
  const records = path.join(desktop, 'claude-code-sessions', 'account', 'org');
  const transcripts = path.join(home, '.claude', 'projects', '-test-folder');
  fs.mkdirSync(records, { recursive: true });
  fs.mkdirSync(transcripts, { recursive: true });
  const now = Date.now();
  const back = minutes => now - minutes * 60_000;
  const sectionScopes = Array.isArray(sections) ? { scope: sections } : sections;
  fs.writeFileSync(path.join(desktop, 'claude_desktop_config.json'), JSON.stringify({
    preferences: { epitaxyPrefs: {
      'dframe-group-scopes': { scope: { groups: [] } },
      ...(sectionScopes && { 'dframe-code-sections': Object.fromEntries(Object.entries(sectionScopes).map(([key, list]) => [key, { sections: list }])) }),
    } },
  }));
  if (localStorage) {
    const store = path.join(desktop, 'Local Storage', 'leveldb');
    fs.mkdirSync(store, { recursive: true });
    const { unread, acked } = localStorage;
    const kept = (key, value) => set(key, JSON.stringify({ state: value, version: 0 }), 'https://claude.ai');
    fs.writeFileSync(path.join(store, '000003.log'), logOf([batch(1,
      ...(unread ? [kept('epitaxy-unread-v1', { unreadIds: unread.map(id => `local_${id}`), explicitUnreadIds: [] })] : []),
      ...(acked ? [kept('epitaxy-awaiting-ack-v1', { ackedAt: Object.fromEntries(Object.entries(acked).map(([id, minutes]) => [`local_${id}`, back(minutes)])) })] : []),
    )]));
  }
  if (marks) {
    const times = list => Object.fromEntries(Object.entries(list ?? {}).map(([id, minutes]) => [id, back(minutes)]));
    fs.writeFileSync(path.join(state, 'marks.json'), JSON.stringify({ edges: times(marks.edges), seen: times(marks.seen), unread: times(marks.unread), errors: times(marks.errors) }));
  }
  if (chips) {
    const made = chips.map((c, i) => ({ toolUseId: `toolu_${i}`, status: 'open', title: 'A chip', ...c }));
    fs.writeFileSync(path.join(state, 'chips.json'), JSON.stringify(Object.fromEntries(made.map(c => [c.toolUseId, c]))));
  }
  const started = [];
  sessions.forEach(({ id, title = '', archived = false, archivedAgo, routine, ago = 10, source = 'desktop', remoteMcpServersConfig, parent, spawnedFrom = parent && { sessionId: `local_${parent}`, sideSession: true }, lineageDetached, fileAgo = ago, edgeAgo, createdAgo, forkedFrom, verdict, errorAgo, fields }) => {
    const at = back(ago);
    if (source === 'desktop') {
      const record = path.join(records, `local_${id}.json`);
      fs.writeFileSync(record, JSON.stringify({
        sessionId: `local_${id}`, cliSessionId: id, title, cwd: home, isArchived: archived, lastActivityAt: at,
        ...(routine && { scheduledTaskId: routine }), ...(remoteMcpServersConfig !== undefined && { remoteMcpServersConfig }), ...(spawnedFrom && { spawnedFrom }), ...(lineageDetached !== undefined && { lineageDetached }),
        ...(edgeAgo !== undefined && { lastTurnEdgeAt: back(edgeAgo) }), ...(createdAgo !== undefined && { createdAt: back(createdAgo) }), ...(forkedFrom && { forkedFromSessionId: `local_${forkedFrom}` }),
        ...(verdict && { postTurnSummary: { status_category: verdict } }), ...(errorAgo !== undefined && { error: 'The turn failed.', errorAt: back(errorAgo) }),
        ...fields,
      }));
      if (archivedAgo !== undefined) {
        const changed = back(archivedAgo) / 1000;
        fs.utimesSync(record, changed, changed);
      }
    }
    if (source === 'capcom') started.push({ id, cwd: home, at, title, ...(routine && { routine }) });
    const transcript = path.join(transcripts, `${id}.jsonl`);
    fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', cwd: home, message: { role: 'user', content: title || 'hello' } })}\n`);
    fs.utimesSync(transcript, back(fileAgo) / 1000, back(fileAgo) / 1000);
  });
  if (started.length) fs.writeFileSync(path.join(state, 'started.json'), JSON.stringify(started));
  fs.writeFileSync(path.join(state, 'layout.json'), JSON.stringify({
    seededAt: '2026-10-16T00:00:00.000Z',
    groups,
    pinned: sessions.filter(s => s.pinned).map(s => s.id),
    assignments: Object.fromEntries(sessions.filter(s => s.group && !s.pinned).map(s => [s.id, s.group])),
    ...layout,
  }, null, 2));
  if (!claude) return {};
  const log = path.join(home, 'claude.log');
  const cli = path.join(home, 'claude');
  const usageFile = path.join(home, 'context-usage.json');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import readline from 'node:readline';",
    `const note = entry => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');`,
    "const say = message => process.stdout.write(JSON.stringify(message) + '\\n');",
    "note({ started: process.argv.slice(2), cwd: process.cwd() });",
    "const startedOn = process.argv[process.argv.indexOf('--model') + 1];",
    "const namedId = process.argv.includes('--session-id') ? process.argv[process.argv.indexOf('--session-id') + 1] : null;",
    "const projects = path.join(process.env.HOME, '.claude', 'projects');",
    "const transcriptOf = id => (fs.existsSync(projects) ? fs.readdirSync(projects).map(d => path.join(projects, d, `${id}.jsonl`)).find(f => fs.existsSync(f)) : undefined);",
    // The real CLI exits at once when --session-id names a session that already has a transcript (checked on CLI 2.1.309).
    "if (namedId && transcriptOf(namedId)) { process.stderr.write(`Error: Session ID ${namedId} is already in use.\\n`); process.exit(1); }",
    "const held = [];",
    "let begun = false;",
    // A title ask is a one-shot process with plain text on stdin and a JSON answer. It answers 'Fake - generated title' and logs what it was sent as `titled`.
    "const titling = process.argv[process.argv.indexOf('--output-format') + 1] === 'json';",
    "if (titling) {",
    "  let asked = '';",
    "  process.stdin.on('data', d => { asked += d; }).on('end', () => { note({ titled: asked }); say({ type: 'result', result: 'Fake - generated title', is_error: false }); process.exit(0); });",
    "}",
    "if (!titling) readline.createInterface({ input: process.stdin }).on('line', line => {",
    "  try {",
    "    const m = JSON.parse(line);",
    "    if (begun) held.splice(0).forEach(say);",
    "    if (m.type === 'control_request') note({ control: m.request.subtype, ...(m.request.subtype === 'get_context_usage' && { detail: m.request.detail }) });",
    `    if (m.type === 'control_request' && m.request.subtype === 'interrupt') fs.copyFileSync(${JSON.stringify(path.join(state, 'layout.json'))}, ${JSON.stringify(path.join(home, 'layout-at-interrupt.json'))});`,
    `    if (m.type === 'control_request' && m.request.subtype === 'initialize') say({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { commands: ${JSON.stringify(CLI_COMMANDS)}, models: ${JSON.stringify(CLI_MODELS)} } } });`,
    "    if (m.type === 'control_request' && m.request.subtype === 'get_context_usage') {",
    `      const usage = fs.existsSync(${JSON.stringify(usageFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(usageFile)}, 'utf8'))[m.request.detail] : null;`,
    "      say({ type: 'control_response', response: usage ? { subtype: 'success', request_id: m.request_id, response: usage } : { subtype: 'error', request_id: m.request_id, error: 'No usage to report.' } });",
    "    }",
    "    if (m.type === 'control_response') note({ response: m.response.response?.behavior || m.response.subtype, requestId: m.response.request_id, ...(m.response.response?.mcp_response && { mcp: m.response.response.mcp_response }), ...(m.response.response?.updatedPermissions && { rules: m.response.response.updatedPermissions }) });",
    "    if (m.type === 'control_request' && m.request.settings) note({ settings: m.request.settings });",
    "    if (m.type === 'control_request' && ['set_model', 'apply_flag_settings'].includes(m.request.subtype)) {",
    "      const noFast = m.request.settings?.fastMode === true && ['no-fast-by-the-fake', 'late-no-fast-by-the-fake'].includes(startedOn);",
    "      const error = m.request.model === 'refused-by-the-fake' ? 'The fake refused that model.' : noFast ? 'The fake refused fast mode.' : '';",
    "      const reply = { type: 'control_response', response: error ? { subtype: 'error', request_id: m.request_id, error } : { subtype: 'success', request_id: m.request_id } };",
    "      if (noFast && startedOn === 'late-no-fast-by-the-fake') held.push(reply);",
    "      else say(reply);",
    "    }",
    "    if (m.type !== 'user') return;",
    "    note({ user: m.message.content });",
    "    const said = Array.isArray(m.message.content) ? m.message.content.filter(b => b.type === 'text').map(b => b.text).join('\\n') : String(m.message.content);",
    // A session named by --session-id writes its transcript when it takes its first message, as the real one does.
    "    if (namedId && !transcriptOf(namedId)) {",
    "      fs.mkdirSync(path.join(projects, '-group-folder'), { recursive: true });",
    "      fs.writeFileSync(path.join(projects, '-group-folder', `${namedId}.jsonl`), JSON.stringify({ type: 'user', cwd: process.cwd(), message: { role: 'user', content: m.message.content } }) + '\\n');",
    "    }",
    "    if (said.startsWith('call ')) {",
    "      const [, tool, ...json] = said.split(' ');",
    "      say({ type: 'control_request', request_id: `call-${tool}`, request: { subtype: 'mcp_message', server_name: 'capcom', message: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: JSON.parse(json.join(' ') || '{}') } } } });",
    "    }",
    "    if (m.message.content === 'list the tools') say({ type: 'control_request', request_id: 'list-tools', request: { subtype: 'mcp_message', server_name: 'capcom', message: { jsonrpc: '2.0', id: 2, method: 'tools/list' } } });",
    "    if (m.message.content === 'ask to start a session') say({ type: 'control_request', request_id: 'perm-start', request: { subtype: 'can_use_tool', tool_name: 'mcp__capcom__start_group_session', input: { cwd: '/tmp', prompt: 'x' }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'mcp__capcom__start_group_session' }], behavior: 'allow', destination: 'localSettings' }] } });",
    "    if (m.message.content === 'ask to list the group') say({ type: 'control_request', request_id: 'perm-list', request: { subtype: 'can_use_tool', tool_name: 'mcp__capcom__list_group_sessions', input: {} } });",
    "    if (m.message.content === 'ask to list the subs') say({ type: 'control_request', request_id: 'perm-subs', request: { subtype: 'can_use_tool', tool_name: 'mcp__capcom__list_sub_sessions', input: {} } });",
    "    if (m.message.content === 'ask to send to a sub') say({ type: 'control_request', request_id: 'perm-send', request: { subtype: 'can_use_tool', tool_name: 'mcp__capcom__send_session', input: { session_id: 'kid', message: 'Please rebase' }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'mcp__capcom__send_session' }], behavior: 'allow', destination: 'localSettings' }] } });",
    "    if (said.startsWith('<session-message')) say({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 });",
    "    if (m.message.content === 'ask for approval') say({ type: 'control_request', request_id: 'perm-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } });",
    "    if (m.message.content === 'finish the turn') say({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 });",
    "    if (m.message.content === 'finish the turn with fast mode off') say({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, fast_mode_state: 'off' });",
    "    if (m.message.content === 'fail the turn') say({ type: 'result', subtype: 'success', is_error: true, result: 'The fake turn failed.' });",
    "    if (said === 'begin a session' || said.startsWith('@\\\"')) {",
    "      say({ type: 'system', subtype: 'init', session_id: namedId || 'begun-by-the-fake', model: 'stub' });",
    "      begun = true;",
    "    }",
    "  } catch {}",
    "}).on('close', () => { note({ closed: true }); process.exit(0); });",
    '',
  ].join('\n'), { mode: 0o755 });
  return { cli, log };
}

// A GitHub CLI that never leaves the machine. It logs its arguments to gh.log in the home, and answers from gh-state.json there: `pulls` is the
// output of pr view for each address, `issues` the output of issue view, `threads` the unresolved flags of its review threads, and `fail` makes every call fail. The login is octocat.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.HOME;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(home, 'gh.log'), JSON.stringify(args) + '\\n');
const file = path.join(home, 'gh-state.json');
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const fail = message => { process.stderr.write(message + '\\n'); process.exit(1); };
if (state.fail) fail('The fake gh is broken.');
const named = key => (args.find(a => a.startsWith(key + '=')) || '').slice(key.length + 1);
if (args[0] === 'api' && args[1] === 'user') console.log('octocat');
else if (args[0] === 'pr' && args[1] === 'view') {
  const pull = (state.pulls || {})[args[2]];
  if (!pull) fail('Could not resolve to a PullRequest.');
  console.log(JSON.stringify(pull));
} else if (args[0] === 'issue' && args[1] === 'view') {
  const issue = (state.issues || {})[args[2]];
  if (!issue) fail('Could not resolve to an Issue.');
  console.log(JSON.stringify(issue));
} else if (args[0] === 'api' && args[1] === 'graphql') {
  const url = 'https://github.com/' + named('owner') + '/' + named('name') + '/pull/' + named('number');
  const nodes = ((state.threads || {})[url] || []).map(isResolved => ({ isResolved }));
  console.log(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } }));
} else process.exit(2);
`;

// `gh` in the session options is true for the fake GitHub CLI, or 'missing' for a path with no CLI at it.
function furnishGh(home, gh) {
  const file = path.join(home, gh === 'missing' ? 'no-such-gh' : 'gh');
  if (gh !== 'missing') fs.writeFileSync(file, FAKE_GH, { mode: 0o755 });
  return { gh: file, ghLog: path.join(home, 'gh.log') };
}

export async function start(mac) {
  const home = fs.mkdtempSync(path.join(base, 'home-'));
  const state = path.join(home, 'state');
  fs.mkdirSync(state);
  writePassword(state, PASSWORD);
  const made = mac ? { ...furnish(home, state, mac), ...(mac.gh && furnishGh(home, mac.gh)), autoTitle: !!mac.autoTitle } : {};
  return launch(home, state, made);
}

async function launch(home, state, made) {
  const port = await freePort();
  const env = { ...process.env, HOME: home, PORT: String(port), CAPCOM_STATE: state, CAPCOM_AUTO_TITLE: made.autoTitle ? '1' : '0', ...(made.cli && { CAPCOM_CLAUDE: made.cli }), ...(made.gh && { CAPCOM_GH: made.gh }) };
  const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  running.push(child);
  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`The server did not start. ${errors}`)), 15_000);
    child.stdout.on('data', chunk => { out += chunk; if (out.includes('Capcom on')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`The server exited with ${code}. ${errors}`)); });
  });
  const server = { port, home, state, origin: `http://localhost:${port}`, tokens: path.join(state, 'tokens.json'), layout: path.join(state, 'layout.json'), cliLog: made.log, ghLog: made.ghLog, errors: () => errors };
  launches.set(server, { child, made });
  return server;
}

// Stops the server behind `s`, as launchd does, and starts another on its home and state folder, to test what a restart keeps.
export async function restart(s) {
  const { child, made } = launches.get(s);
  // A server that has already exited sends no exit event, and node --test has no timeout to end the wait.
  if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  return launch(s.home, s.state, made);
}

after(() => { for (const child of running) child.kill(); });

export function request(s, method, url, { headers = {}, json, form } = {}) {
  const body = json !== undefined ? JSON.stringify(json) : form !== undefined ? new URLSearchParams(form).toString() : undefined;
  const type = json !== undefined ? 'application/json' : form !== undefined ? 'application/x-www-form-urlencoded' : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, method, path: url, headers: { host: `localhost:${s.port}`, ...(type && { 'content-type': type }), ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, body: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

export const as = token => ({ cookie: `capcom=${token}`, 'user-agent': CHROME });
export const tokenIn = cookie => /^capcom=([0-9a-f]{64});/.exec(cookie)[1];

export async function signIn(s, headers) {
  const res = await request(s, 'POST', '/login', { form: { password: PASSWORD }, headers: { 'user-agent': CHROME, ...headers } });
  assert.equal(res.status, 303);
  const cookie = res.headers['set-cookie'][0];
  return { res, cookie, token: tokenIn(cookie) };
}

// What the fake CLI has logged so far: how it was started, each message and control message it was sent, and when its input closed.
export const cliCalls = s => (fs.existsSync(s.cliLog) ? fs.readFileSync(s.cliLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);

// A viewer of a chat's events, as the page is. `events` fills with { type, data } as they arrive, the first being the chat's status.
export function listen(s, token, id) {
  const events = [];
  const req = http.get({ host: '127.0.0.1', port: s.port, path: `/api/sessions/${id}/events`, headers: { host: `localhost:${s.port}`, ...as(token) } }, res => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', chunk => {
      text += chunk;
      for (let end = text.indexOf('\n\n'); end >= 0; end = text.indexOf('\n\n')) {
        const block = text.slice(0, end);
        text = text.slice(end + 2);
        const type = /^event: (.*)$/m.exec(block)?.[1];
        if (type) events.push({ type, data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] || '{}') });
      }
    });
  });
  req.on('error', () => {});
  return { events, close: () => req.destroy() };
}

export async function until(check, ms = 4000) {
  for (let waited = 0; !(await check()); waited += 20) {
    if (waited > ms) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
