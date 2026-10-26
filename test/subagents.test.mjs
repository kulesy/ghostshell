// Run with `npm test`. The helpers a session started with the Agent tool, read from the folder the CLI writes beside its transcript. The
// folders here are made up: each entry holds the fields the reader looks at and nothing else. The last tests go over HTTP against the real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSubagents } from '../lib/subagents.mjs';
import { STALE_MS } from '../lib/outside.mjs';
import { as, listen, request, signIn, start, until } from './harness.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-subagents-test-'));
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const NOW = Date.parse('2026-10-26T10:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();
const reader = options => createSubagents({ now: () => NOW, ...options });

let count = 0;
function chat() {
  const dir = fs.mkdtempSync(path.join(base, 'chat-'));
  const id = `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`;
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, '');
  const folder = path.join(dir, id, 'subagents');
  return { id, file, dir, folder };
}

const CWD = '/work/demo';
const stamp = before => ({ timestamp: ago(before), cwd: CWD, isSidechain: true });
const prompt = (text, before) => ({ type: 'user', message: { role: 'user', content: text }, ...stamp(before) });
const reply = (content, { before, reason = 'tool_use', model = 'claude-sonnet-5-5', ...extra }) => ({ type: 'assistant', message: { role: 'assistant', model, content, stop_reason: reason }, ...stamp(before), ...extra });
const call = (name, input, id = 't1') => ({ type: 'tool_use', id, name, input });
const said = text => ({ type: 'text', text });
const result = (before, content = 'ok', extra) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content }] }, ...stamp(before), ...extra });
const lines = entries => entries.map(e => `${typeof e === 'string' ? e : JSON.stringify(e)}\n`).join('');

// Writes agent-<id>.jsonl and its meta file, and sets the time the file was last written to `quiet` ms before NOW.
function agent(c, id, { meta, entries, quiet = SECOND, raw } = {}) {
  fs.mkdirSync(c.folder, { recursive: true });
  const file = path.join(c.folder, `agent-${id}.jsonl`);
  fs.writeFileSync(file, raw ?? lines(entries ?? [prompt('Look into it', 60 * SECOND), reply([call('Read', { file_path: `${CWD}/lib/work.mjs` })], { before: 50 * SECOND })]));
  if (meta !== null) fs.writeFileSync(path.join(c.folder, `agent-${id}.meta.json`), typeof meta === 'string' ? meta : JSON.stringify({ agentType: 'Explore', description: 'Find the thing', ...meta }));
  touch(file, quiet);
  return file;
}
const touch = (file, quiet) => fs.utimesSync(file, (NOW - quiet) / 1000, (NOW - quiet) / 1000);
const one = (c, id, options, readerOptions) => {
  agent(c, id, options);
  return reader(readerOptions).read(c).find(a => a.id === id);
};

test('a helper still being written reads as running, with when it began, its model, and its latest call', () => {
  const c = chat();
  assert.deepEqual(one(c, 'a1', { meta: { model: 'sonnet' } }), {
    id: 'a1', type: 'Explore', description: 'Find the thing', model: 'sonnet', state: 'running',
    startedAt: NOW - 60 * SECOND, endedAt: null, ms: 60 * SECOND, action: 'Read lib/work.mjs',
  });
});

test('a helper whose meta file says finished is done, ended when its last entry was written', () => {
  const c = chat();
  const a = one(c, 'a1', { meta: { finished: true }, quiet: 30 * SECOND, entries: [prompt('go', 90 * SECOND), reply([said('Found it.')], { before: 40 * SECOND, reason: null })] });
  assert.deepEqual([a.state, a.startedAt, a.endedAt, a.action], ['done', NOW - 90 * SECOND, NOW - 40 * SECOND, 'Found it.']);
  assert.equal(a.ms, 50 * SECOND, 'the time it ran is worked out on the server, so the page needs no common clock');
});

test('a helper whose last reply ended the turn is done though its meta file never says finished, which two thirds of them do not', () => {
  const c = chat();
  const a = one(c, 'a1', { entries: [prompt('go', 90 * SECOND), reply([said('All good.')], { before: 5 * SECOND, reason: 'end_turn' })] });
  assert.deepEqual([a.state, a.endedAt, a.action], ['done', NOW - 5 * SECOND, 'All good.']);
  const ended = one(c, 'a2', { entries: [prompt('go', 90 * SECOND), reply([call('Bash', { command: 'report' })], { before: 6 * SECOND }), result(5 * SECOND, 'ok', { toolEndsTurn: true })] });
  assert.equal(ended.state, 'done', 'a tool that ends the turn');
});

test('a helper that never ended and whose file has been quiet for the stale time reads as stopped, ended at its last entry', () => {
  const c = chat();
  const entries = [prompt('go', 30 * MINUTE), reply([call('Bash', { command: 'npm test' })], { before: 25 * MINUTE })];
  const a = one(c, 'a1', { entries, quiet: STALE_MS });
  assert.deepEqual([a.state, a.endedAt, a.action], ['stopped', NOW - 25 * MINUTE, 'Ran npm test']);
  assert.equal(one(c, 'a2', { entries, quiet: STALE_MS - SECOND }).state, 'running', 'a second short of the stale time');
  assert.equal(one(c, 'a3', { entries, quiet: 3 * MINUTE }, { staleMs: 2 * MINUTE }).state, 'stopped', 'the stale time is the reader\'s');
});

test('an old helper whose last reply was text with no stop reason is done and not stopped', () => {
  const c = chat();
  const a = one(c, 'a1', { quiet: HOUR, entries: [prompt('go', 2 * HOUR), reply([said('Here is the report.')], { before: HOUR, reason: null })] });
  assert.deepEqual([a.state, a.endedAt], ['done', NOW - HOUR]);
});

const HOUR = 60 * MINUTE;

test('an interrupt stops a helper at once, though its file was written a moment ago', () => {
  const c = chat();
  const entries = [prompt('go', 90 * SECOND), reply([call('Read', { file_path: `${CWD}/a.mjs` })], { before: 40 * SECOND }), { type: 'user', message: { role: 'user', content: [said('[Request interrupted by user]')] }, ...stamp(10 * SECOND) }];
  const a = one(c, 'a1', { entries, quiet: 10 * SECOND });
  assert.deepEqual([a.state, a.endedAt], ['stopped', NOW - 10 * SECOND]);
});

test('a helper that died of an API error, ran out of tokens or was refused is failed, even when its meta file says finished', () => {
  const c = chat();
  const run = (last, meta) => one(c, `f${++count}`, { meta, entries: [prompt('go', 90 * SECOND), reply([call('Read', { file_path: `${CWD}/a.mjs` })], { before: 40 * SECOND }), last] });
  const apiError = reply([said('API Error: 500 {"type":"error"}')], { before: 5 * SECOND, reason: 'stop_sequence', model: '<synthetic>', isApiErrorMessage: true, error: 'server_error' });
  const failed = run(apiError, { finished: true, model: 'opus' });
  assert.deepEqual([failed.state, failed.endedAt, failed.action, failed.model], ['failed', NOW - 5 * SECOND, 'API Error: 500 {"type":"error"}', 'opus']);
  assert.equal(run(apiError).state, 'failed');
  assert.equal(run(reply([said('cut')], { before: 5 * SECOND, reason: 'max_tokens' })).state, 'failed');
  assert.equal(run(reply([said('no')], { before: 5 * SECOND, reason: 'refusal', isApiErrorMessage: true })).state, 'failed');
  assert.equal(run({ ...apiError, message: { ...apiError.message, model: '<synthetic>' } }).model, 'claude-sonnet-5-5', 'the model of a failed helper is never the placeholder');
});

test('a helper that went on after an error is judged by its last entry, not the error', () => {
  const c = chat();
  const error = reply([said('API Error: 529')], { before: 30 * SECOND, reason: 'stop_sequence', isApiErrorMessage: true });
  const a = one(c, 'a1', { entries: [prompt('go', 90 * SECOND), error, reply([call('Grep', { pattern: 'retry' })], { before: 5 * SECOND })] });
  assert.deepEqual([a.state, a.action], ['running', 'Searched for retry']);
});

test('a helper with no meta file, or a meta file that is not valid, is still listed, described by the start of its prompt', () => {
  const c = chat();
  const entries = [prompt('Review the diff in\nlib/work.mjs please', 60 * SECOND), reply([said('Done.')], { before: 5 * SECOND, reason: 'end_turn' })];
  for (const [id, meta] of [['none', null], ['bad', '{not json'], ['list', '[1,2]'], ['empty', '']]) {
    const a = one(c, id, { meta, entries });
    assert.deepEqual([a.type, a.description, a.state, a.model], ['', 'Review the diff in', 'done', 'claude-sonnet-5-5'], id);
  }
});

test('a meta file with no model, or the model inherit, gives the full id of the first reply in the file', () => {
  const c = chat();
  const entries = [prompt('go', 60 * SECOND), reply([said('First')], { before: 50 * SECOND, model: 'claude-haiku-5-5', reason: null }), reply([said('Second')], { before: 5 * SECOND, model: 'claude-opus-5-5', reason: 'end_turn' })];
  assert.equal(one(c, 'a1', { entries, meta: {} }).model, 'claude-haiku-5-5');
  assert.equal(one(c, 'a2', { entries, meta: { model: 'inherit' } }).model, 'claude-haiku-5-5');
  assert.equal(one(c, 'a3', { entries, meta: { model: 'opus' } }).model, 'opus', 'the meta alias is shown as given');
  assert.equal(one(c, 'a4', { entries: [prompt('go', 5 * SECOND)], meta: {} }).model, '', 'no reply yet, no model');
});

test('a half-written last line is left for the next read', () => {
  const c = chat();
  const whole = lines([prompt('go', 60 * SECOND), reply([call('Read', { file_path: `${CWD}/a.mjs` })], { before: 20 * SECOND })]);
  const half = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Fin';
  const file = agent(c, 'a1', { raw: whole + half });
  const r = reader();
  assert.deepEqual(r.read(c).map(a => [a.state, a.action]), [['running', 'Read a.mjs']]);
  const rest = `ished."}],"stop_reason":"end_turn"},"timestamp":"${ago(2 * SECOND)}","isSidechain":true}\n`;
  fs.appendFileSync(file, rest);
  touch(file, SECOND);
  assert.deepEqual(r.read(c).map(a => [a.state, a.action]), [['done', 'Finished.']]);
});

test('a file with only a half-written line, and an empty file, give a running helper with nothing to say', () => {
  const c = chat();
  agent(c, 'half', { raw: '{"type":"user","mess' });
  agent(c, 'empty', { raw: '' });
  const got = reader().read(c);
  assert.deepEqual(got.map(a => [a.id, a.state, a.action, a.model]).sort(), [['empty', 'running', '', ''], ['half', 'running', '', '']]);
  assert.ok(got.every(a => Number.isFinite(a.startedAt)));
});

// Counts the bytes the reader asks the file system for, so a read of a whole file shows.
function counted(work) {
  const real = fs.readSync;
  let bytes = 0;
  fs.readSync = (fd, buffer, ...rest) => {
    const n = real(fd, buffer, ...rest);
    bytes += n;
    return n;
  };
  try { return [work(), bytes]; } finally { fs.readSync = real; }
}

test('padding between the first lines and the last is never read, and a repeat read of an unchanged file reads nothing', () => {
  const c = chat();
  const filler = result(30 * SECOND, 'x'.repeat(4000));
  const padding = Array.from({ length: 600 }, () => filler);
  const entries = [prompt('go', 90 * SECOND), reply([call('Bash', { command: 'first' })], { before: 80 * SECOND }), ...padding, reply([call('Bash', { command: 'npm test' })], { before: 5 * SECOND })];
  const file = agent(c, 'a1', { entries });
  assert.ok(fs.statSync(file).size > 2 * 1024 * 1024, 'about 2 MB of padding');
  const r = reader();
  const [first, bytes] = counted(() => r.read(c));
  assert.deepEqual([first[0].state, first[0].action, first[0].startedAt], ['running', 'Ran npm test', NOW - 90 * SECOND]);
  assert.ok(bytes < 400 * 1024, `read ${bytes} bytes of a 2 MB file`);
  const [again, more] = counted(() => r.read(c));
  assert.deepEqual(again, first);
  assert.equal(more, 0);
});

test('the head is read in a 64 KB window when the meta file gives the model, and a later window reads only the bytes not yet read', () => {
  const entries = [prompt('go', 90 * SECOND), ...Array.from({ length: 60 }, () => result(80 * SECOND, 'x'.repeat(4000))), reply([call('Bash', { command: 'npm test' })], { before: 5 * SECOND })];
  const [withMeta, without] = [chat(), chat()];
  const file = agent(withMeta, 'm1', { entries, meta: { model: 'sonnet' } });
  agent(without, 'm2', { entries, meta: {} });
  const size = fs.statSync(file).size;
  assert.ok(size > 240 * 1024 && size < 256 * 1024, 'the first reply is past the 64 KB and 128 KB windows');
  const [a, kept] = counted(() => reader().read(withMeta)[0]);
  const [b, cold] = counted(() => reader().read(without)[0]);
  assert.deepEqual([a.model, b.model], ['sonnet', 'claude-sonnet-5-5']);
  assert.ok(cold - kept < size, `widening read ${cold - kept} bytes more than the 64 KB window, against ${size} in the file`);
});

test('a second detail call on an unchanged big file reads nothing, and a growing file is read again', () => {
  const c = chat();
  const filler = result(80 * SECOND, 'x'.repeat(4000));
  const entries = [prompt('go', 90 * SECOND), ...Array.from({ length: 600 }, () => filler), reply([call('Bash', { command: 'npm test' })], { before: 5 * SECOND })];
  const file = agent(c, 'a1', { entries });
  assert.ok(fs.statSync(file).size > 2 * 1024 * 1024);
  const r = reader();
  const [first, bytes] = counted(() => r.detail(c, 'a1'));
  assert.ok(bytes > 0);
  const [again, more] = counted(() => r.detail(c, 'a1'));
  assert.deepEqual(again, first);
  assert.equal(more, 0);
  fs.appendFileSync(file, lines([reply([call('Bash', { command: 'npm run lint' })], { before: SECOND })]));
  touch(file, SECOND);
  assert.equal(r.detail(c, 'a1').steps.at(-1).label, 'Ran npm run lint');
});

test('a last entry bigger than a tail chunk is still found, and the state comes from it', () => {
  const c = chat();
  const entries = [prompt('go', 90 * SECOND), reply([call('Read', { file_path: `${CWD}/big.mjs` })], { before: 20 * SECOND }), result(5 * SECOND, 'y'.repeat(1024 * 1024))];
  const [got, bytes] = counted(() => reader().read(c.file && (agent(c, 'a1', { entries }), c)));
  assert.deepEqual([got[0].state, got[0].action], ['running', 'Read big.mjs']);
  assert.ok(bytes < 3 * 1024 * 1024);
});

test('a growing file is read again, and a changed meta file is too', () => {
  const c = chat();
  const file = agent(c, 'a1', { meta: {} });
  const r = reader();
  assert.deepEqual(r.read(c).map(a => [a.state, a.action]), [['running', 'Read lib/work.mjs']]);
  fs.appendFileSync(file, lines([reply([call('Bash', { command: 'npm test' })], { before: SECOND })]));
  touch(file, SECOND);
  assert.equal(r.read(c)[0].action, 'Ran npm test');
  fs.writeFileSync(path.join(c.folder, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Changed', finished: true }));
  assert.deepEqual(r.read(c).map(a => [a.state, a.type, a.description]), [['done', 'general-purpose', 'Changed']]);
});

test('the state moves with the clock while the file does not', () => {
  const c = chat();
  let at = NOW;
  agent(c, 'a1', { meta: {}, quiet: 0 });
  const r = createSubagents({ now: () => at });
  assert.equal(r.read(c)[0].state, 'running');
  at = NOW + STALE_MS;
  assert.equal(r.read(c)[0].state, 'stopped');
});

test('a chat with no folder, an empty one, or no file to look in lists nothing', () => {
  const c = chat();
  const r = reader();
  assert.deepEqual(r.read(c), []);
  fs.mkdirSync(c.folder, { recursive: true });
  assert.deepEqual(r.read(c), []);
  for (const t of [null, undefined, {}, { file: c.file }, { id: c.id }]) assert.deepEqual(r.read(t), []);
  assert.deepEqual(r.read({ file: path.join(base, 'no', 'such.jsonl'), id: 'x' }), []);
});

test('only agent files are listed: not meta files, prefix files, folders, or helpers of helpers', () => {
  const c = chat();
  agent(c, 'top');
  agent(c, 'kid', { meta: { parentAgentId: 'top', spawnDepth: 2 } });
  fs.writeFileSync(path.join(c.folder, 'agent-top.prefix.json'), '{}');
  fs.writeFileSync(path.join(c.folder, 'notes.jsonl'), lines([prompt('x', 1)]));
  fs.mkdirSync(path.join(c.folder, 'workflows', 'wf_1'), { recursive: true });
  fs.mkdirSync(path.join(c.folder, 'agent-dir.jsonl'));
  assert.deepEqual(reader().read(c).map(a => a.id), ['top']);
  assert.deepEqual(reader().detail(c, 'kid')?.id, 'kid', 'a helper of a helper can still be opened by its id');
});

test('only the newest helpers are listed, 50 by default', () => {
  const c = chat();
  for (let i = 0; i < 6; i++) agent(c, `n${i}`, { quiet: (i + 1) * SECOND });
  assert.deepEqual(reader({ limit: 3 }).read(c).map(a => a.id).sort(), ['n0', 'n1', 'n2']);
  const d = chat();
  for (let i = 0; i < 55; i++) agent(d, `m${i}`, { quiet: (i + 1) * SECOND });
  assert.equal(reader().read(d).length, 50);
});

test('running helpers come first by newest start, then the rest by newest end', () => {
  const c = chat();
  const run = (id, start, end, reason) => agent(c, id, { entries: [prompt('go', start), reply([said('x')], { before: end, reason })], quiet: Math.min(end, SECOND) });
  run('old-run', 5 * MINUTE, 4 * MINUTE, null);
  run('new-run', 2 * MINUTE, SECOND, null);
  run('done-a', 9 * MINUTE, 3 * MINUTE, 'end_turn');
  run('done-b', 8 * MINUTE, 6 * MINUTE, 'end_turn');
  agent(c, 'old-run', { entries: [prompt('go', 5 * MINUTE), reply([said('x')], { before: 4 * MINUTE, reason: null })], quiet: 10 * SECOND });
  assert.deepEqual(reader().read(c).map(a => a.id), ['new-run', 'old-run', 'done-a', 'done-b']);
});

test('the cache keeps the number of files it is told to, dropping the one read longest ago', () => {
  const c = chat();
  for (const id of ['a', 'b', 'c']) agent(c, id);
  const r = reader({ keep: 2 });
  const [, first] = counted(() => r.read(c));
  assert.ok(first > 0);
  const [, second] = counted(() => r.read(c));
  assert.ok(second > 0, 'one file was dropped, so one is read again');
});

test('the detail of a helper has its last 40 steps with each text cut to a line, and its reply once it is done', () => {
  const c = chat();
  const steps = Array.from({ length: 60 }, (_, i) => reply([call('Read', { file_path: `${CWD}/f${i}.mjs` })], { before: (70 - i) * SECOND }));
  const long = `Summary\nof the work ${'word '.repeat(100)}`;
  agent(c, 'a1', { meta: { model: 'sonnet', finished: true }, entries: [prompt('go', 90 * SECOND), ...steps, reply([said(long)], { before: 5 * SECOND, reason: 'end_turn' })] });
  const got = reader().detail(c, 'a1');
  assert.equal(got.steps.length, 40);
  assert.deepEqual([got.steps.at(-1).kind, got.steps.at(-1).label.length, got.steps.at(-1).label.startsWith('Summary of the work word'), got.steps.at(-1).label.endsWith('...')], ['text', 200, true, true]);
  assert.deepEqual(got.steps[0], { kind: 'tool', label: 'Read f21.mjs', at: NOW - 49 * SECOND });
  assert.equal(got.reply, long.trim());
  assert.deepEqual([got.id, got.state, got.model, got.type, got.endedAt], ['a1', 'done', 'sonnet', 'Explore', NOW - 5 * SECOND]);
  agent(c, 'big', { entries: [prompt('go', 9 * SECOND), reply([said('z'.repeat(9000))], { before: SECOND, reason: 'end_turn' })] });
  assert.equal(reader().detail(c, 'big').reply.length, 4000);
});

test('the detail of a helper at work has steps and no reply, and one that failed has the error as its reply', () => {
  const c = chat();
  agent(c, 'a1', { entries: [prompt('go', 30 * SECOND), reply([said('Looking.'), call('Grep', { pattern: 'x' })], { before: 5 * SECOND })] });
  const run = reader().detail(c, 'a1');
  assert.deepEqual([run.state, run.reply, run.steps.map(s => s.label)], ['running', '', ['Looking.', 'Searched for x']]);
  agent(c, 'a2', { entries: [prompt('go', 30 * SECOND), reply([said('API Error: 500')], { before: 5 * SECOND, reason: 'stop_sequence', isApiErrorMessage: true })] });
  const bad = reader().detail(c, 'a2');
  assert.deepEqual([bad.state, bad.reply], ['failed', 'API Error: 500']);
});

test('the detail answers null for an id the folder does not list, and never opens a path the caller made up', () => {
  const c = chat();
  agent(c, 'a1');
  fs.writeFileSync(path.join(path.dirname(c.folder), 'agent-outside.jsonl'), lines([prompt('secret', 1)]));
  fs.writeFileSync(path.join(c.folder, 'agent-a1.meta.json.jsonl'), '');
  const r = reader();
  for (const id of ['nope', '../agent-outside', '..', '', 'a1/../a1', 'a1.meta', 'agent-a1', 'outside', undefined, null, 42, {}]) assert.equal(r.detail(c, id), null, String(id));
  assert.equal(r.detail(c, 'a1').id, 'a1');
  assert.equal(r.detail(null, 'a1'), null);
});

// ---- over HTTP -------------------------------------------------------------------------------------

const SESSION = 'desk';
const folderOf = s => path.join(s.home, '.claude', 'projects', '-test-folder', SESSION, 'subagents');
const writeAgent = (s, id, entries, meta = { agentType: 'Explore', description: 'Find the thing' }) => {
  const dir = folderOf(s);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), lines(entries));
  fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
  return path.join(dir, `agent-${id}.jsonl`);
};
const live = (before, entry) => ({ ...entry, timestamp: new Date(Date.now() - before).toISOString(), cwd: CWD, isSidechain: true });
const asking = text => live(60 * SECOND, { type: 'user', message: { role: 'user', content: text } });
const working = (before, call_, model = 'claude-sonnet-5-5') => live(before, { type: 'assistant', message: { role: 'assistant', model, stop_reason: 'tool_use', content: [call_] } });
const get = (s, token, route) => request(s, 'GET', route, { headers: as(token) });

async function ready() {
  const s = await start({ sessions: [{ id: SESSION, title: 'Desktop one', ago: 1 }, { id: 'other', title: 'Another', ago: 2 }] });
  const signed = await signIn(s);
  await get(s, signed.token, '/api/sessions');
  return { s, ...signed };
}

test('the session list says the server knows helpers', async () => {
  const { s, token } = await ready();
  assert.equal((await get(s, token, '/api/sessions')).body().features.subagents, true);
});

test('the detail route is for a signed-in caller, and a bad id, a made-up path, an unknown helper and an unknown session are refused', async () => {
  const { s, token } = await ready();
  writeAgent(s, 'a1', [asking('go'), working(5 * SECOND, call('Read', { file_path: `${CWD}/a.mjs` }))]);
  fs.writeFileSync(path.join(path.dirname(folderOf(s)), 'agent-outside.jsonl'), lines([asking('secret')]));
  const route = id => `/api/sessions/${SESSION}/subagents/${id}`;
  assert.equal((await request(s, 'GET', route('a1'))).status, 401);
  const ok = await get(s, token, route('a1'));
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body().id, ok.body().state, ok.body().steps.map(x => x.label)], ['a1', 'running', ['Read a.mjs']]);
  for (const id of ['a.1', 'a1.meta', '..%2Fagent-outside', 'a%20b', 'a1;x', '..%5Cagent-outside', 'a1%00']) {
    const res = await get(s, token, route(id));
    assert.deepEqual([res.status, res.body()], [400, { error: 'Bad subagent id' }], id);
  }
  assert.notEqual((await get(s, token, route('%2e%2e'))).status, 200, 'the URL parser folds this into the session route');
  for (const id of ['outside', 'zzz', 'agent-a1', 'a1-']) {
    const res = await get(s, token, route(id));
    assert.deepEqual([res.status, res.body()], [404, { error: 'No such subagent.' }], id);
  }
  assert.equal((await get(s, token, route('a1/more'))).status, 404);
  assert.equal((await get(s, token, `/api/sessions/${SESSION}/subagents`)).status, 404);
  assert.equal((await get(s, token, '/api/sessions/nobody/subagents/a1')).status, 404);
  const other = await get(s, token, '/api/sessions/other/subagents/a1');
  assert.deepEqual([other.status, other.body()], [404, { error: 'No such subagent.' }], 'a helper belongs to its own session');
});

test('the detail route sends the shape the page reads', async () => {
  const { s, token } = await ready();
  writeAgent(s, 'a1', [
    asking('Check the build'),
    working(40 * SECOND, call('Bash', { command: 'npm test' })),
    live(5 * SECOND, { type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [said('Tests pass.')] } }),
  ], { agentType: 'Explore', description: 'Run the checks', finished: true, model: 'sonnet' });
  const body = (await get(s, token, `/api/sessions/${SESSION}/subagents/a1`)).body();
  assert.deepEqual(Object.keys(body).sort(), ['action', 'description', 'endedAt', 'id', 'model', 'ms', 'reply', 'startedAt', 'state', 'steps', 'type']);
  assert.deepEqual([body.state, body.reply, body.model, body.description], ['done', 'Tests pass.', 'sonnet', 'Run the checks']);
  assert.deepEqual(body.steps.map(({ kind, label }) => [kind, label]), [['tool', 'Ran npm test'], ['text', 'Tests pass.']]);
  assert.ok(body.steps.every(x => Number.isFinite(x.at)));
});

test('a viewer hears of the helpers with the first status, and again only when an id, a state or an action changes', async () => {
  const { s, token } = await ready();
  const file = writeAgent(s, 'a1', [asking('go'), working(30 * SECOND, call('Read', { file_path: `${CWD}/a.mjs` }))]);
  const viewer = listen(s, token, SESSION);
  await until(() => viewer.events.length >= 2);
  assert.deepEqual(viewer.events.map(e => e.type).slice(0, 2), ['status', 'subagents'], 'sent with the first status');
  const heard = () => viewer.events.filter(e => e.type === 'subagents');
  assert.deepEqual(heard()[0].data.agents.map(a => [a.id, a.state, a.action]), [['a1', 'running', 'Read a.mjs']]);
  assert.deepEqual(Object.keys(heard()[0].data.agents[0]).sort(), ['action', 'description', 'endedAt', 'id', 'model', 'ms', 'startedAt', 'state', 'type']);

  // The file is touched and the clock moves, and nothing the list shows has changed.
  fs.utimesSync(file, new Date(), new Date());
  await new Promise(resolve => setTimeout(resolve, 3300));
  assert.equal(heard().length, 1, 'no change, no event');

  fs.appendFileSync(file, lines([working(0, call('Bash', { command: 'npm test' }))]));
  await until(() => heard().length === 2, 6000);
  assert.equal(heard()[1].data.agents[0].action, 'Ran npm test');

  writeAgent(s, 'a2', [asking('go'), working(0, call('Grep', { pattern: 'x' }))]);
  await until(() => heard().length === 3, 6000);
  assert.deepEqual(heard()[2].data.agents.map(a => a.id).sort(), ['a1', 'a2']);

  fs.appendFileSync(file, lines([live(0, { type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [said('Done.')] } })]));
  await until(() => heard().length === 4, 6000);
  const final = heard()[3].data.agents.find(a => a.id === 'a1');
  assert.deepEqual([final.state, final.action, Number.isFinite(final.endedAt)], ['done', 'Done.', true]);
  viewer.close();
});

test('a viewer of a chat with no helpers is told so once, and a second viewer gets the list as it stands', async () => {
  const { s, token } = await ready();
  const first = listen(s, token, 'other');
  await until(() => first.events.length >= 2);
  assert.deepEqual(first.events[1], { type: 'subagents', data: { agents: [] } });
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(first.events.filter(e => e.type === 'subagents').length, 1);
  first.close();
  writeAgent(s, 'late', [asking('go'), working(2 * SECOND, call('Read', { file_path: `${CWD}/a.mjs` }))]);
  const second = listen(s, token, SESSION);
  await until(() => second.events.length >= 2);
  assert.deepEqual(second.events[1].data.agents.map(a => a.id), ['late']);
  second.close();
});
