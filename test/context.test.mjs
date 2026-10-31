// Run with `npm test`. The reader and the window memory are checked on files in a temporary folder, and the route over HTTP
// against the real server, whose CLI is the fake from the harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lastReply, makeWindows, shapePlan, shapeUsage, transcriptFigure } from '../lib/context.mjs';
import { as, cliCalls, request, signIn, start, until } from './harness.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-context-test-'));
let made = 0;
const lines = entries => entries.map(e => `${typeof e === 'string' ? e : JSON.stringify(e)}\n`).join('');
const transcript = entries => {
  const file = path.join(dir, `chat-${++made}.jsonl`);
  fs.writeFileSync(file, lines(entries));
  return file;
};

const AT = '2026-10-22T01:02:03.000Z';
const reply = (input, extra = {}) => ({
  type: 'assistant',
  timestamp: AT,
  message: { id: `msg_${input}`, role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text: 'Done: é€😀' }], usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 9 } },
  ...extra,
});
const said = text => ({ type: 'user', message: { role: 'user', content: text } });
const boundary = { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' };
const summary = { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'The conversation so far, in short.' } };

// ---- the CLI's count --------------------------------------------------------------------------------

const raw = {
  categories: [
    { id: 'system_prompt', name: 'System prompt', tokens: 5000, color: 'promptBorder', kind: 'used' },
    { id: 'messages', name: 'Messages', tokens: 20000, color: 'purple', kind: 'used' },
    { id: 'skills', name: 'Skills', tokens: 0, color: 'warning', kind: 'used' },
    { id: 'system_tools', name: 'System tools', tokens: 14300, color: 'inactive', kind: 'used' },
    { id: 'mcp_tools_deferred', name: 'MCP tools (deferred)', tokens: 9000, color: 'inactive', kind: 'deferred', isDeferred: true },
    { id: 'autocompact_buffer', name: 'Autocompact buffer', tokens: 33000, color: 'inactive', kind: 'buffer' },
    { id: 'free_space', name: 'Free space', tokens: 227700, color: 'promptBorder', kind: 'free' },
  ],
  totalTokens: 39300,
  maxTokens: 300000,
  percentage: 13.1,
  model: 'claude-opus-4-5',
  autoCompactThreshold: 267000,
  isAutoCompactEnabled: true,
  gridRows: [[{ color: 'purple' }]],
};

test('a summary is the total and the window, and a full count adds the parts that fill it, largest first, with the buffer and the free space kept apart', () => {
  assert.deepEqual(shapeUsage(raw, 'summary'), { total: 39300, window: 300000, autoCompactAt: 267000, model: 'claude-opus-4-5' });
  assert.deepEqual(shapeUsage(raw, 'full'), {
    total: 39300,
    window: 300000,
    autoCompactAt: 267000,
    model: 'claude-opus-4-5',
    categories: [
      { id: 'messages', name: 'Messages', tokens: 20000 },
      { id: 'system_tools', name: 'System tools', tokens: 14300 },
      { id: 'system_prompt', name: 'System prompt', tokens: 5000 },
    ],
    buffer: { name: 'Autocompact buffer', tokens: 33000 },
    free: { name: 'Free space', tokens: 227700 },
  });
});

test('auto-compact is null when the CLI says it is off, and a part the CLI does not size is left out rather than guessed', () => {
  assert.equal(shapeUsage({ ...raw, isAutoCompactEnabled: false }, 'summary').autoCompactAt, null);
  assert.equal(shapeUsage({ ...raw, autoCompactThreshold: undefined }, 'summary').autoCompactAt, null);
  const odd = shapeUsage({ ...raw, categories: [null, 'x', { name: 'No size', kind: 'used' }, { name: 'Bad size', tokens: Number.NaN, kind: 'used' }, { name: 'Negative', tokens: -5, kind: 'used' }, { name: 'Kept', tokens: 7, kind: 'used' }] }, 'full');
  assert.deepEqual(odd.categories, [{ id: 'Kept', name: 'Kept', tokens: 7 }]);
  assert.deepEqual([odd.buffer, odd.free], [null, null]);
  const bare = shapeUsage({ totalTokens: 10 }, 'full');
  assert.deepEqual(bare, { total: 10, window: null, autoCompactAt: null, model: null, categories: [], buffer: null, free: null });
});

test('a reply with no usable total is no figure, and a window that is not a positive number is no window', () => {
  for (const bad of [null, undefined, 'x', 5, [], {}, { totalTokens: 'many' }, { totalTokens: -1 }, { totalTokens: Number.NaN }, { totalTokens: Infinity }]) assert.equal(shapeUsage(bad, 'summary'), null, JSON.stringify(bad));
  for (const bad of [0, -300000, '300000', null, Number.NaN]) assert.equal(shapeUsage({ totalTokens: 1, maxTokens: bad }, 'summary').window, null, JSON.stringify(bad));
});

// ---- the transcript ---------------------------------------------------------------------------------

test('the last reply is the size of the context: its input and both cache counts, and not its output', () => {
  const file = transcript([
    said('hello'),
    reply(100),
    said('go on'),
    reply(3, { message: { ...reply(3).message, usage: { input_tokens: 3, cache_creation_input_tokens: 4000, cache_read_input_tokens: 40000, output_tokens: 99999 } } }),
    said('and again'),
  ]);
  assert.deepEqual(lastReply(file), { total: 44003, model: 'claude-opus-4-5', at: AT });
});

test('a reply from a side chain or a synthetic one, a line that only mentions usage, and a reply without counts are passed over', () => {
  const file = transcript([
    reply(1000),
    reply(99999, { isSidechain: true }),
    { ...reply(0), message: { ...reply(0).message, model: '<synthetic>', usage: { input_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } },
    { type: 'assistant', timestamp: AT, message: { model: 'claude-opus-4-5', role: 'assistant', content: [], usage: { input_tokens: 'many' } } },
    { type: 'assistant', timestamp: AT, message: { model: 'claude-opus-4-5', role: 'assistant', content: [], usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: 'assistant', timestamp: AT, message: { model: 'claude-opus-4-5', role: 'assistant', content: [] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"usage":{"input_tokens":888888}} compact_boundary' }] } },
    { type: 'system', subtype: 'informational', content: 'usage: "usage"' },
    said('and now'),
  ]);
  assert.deepEqual(lastReply(file), { total: 1000, model: 'claude-opus-4-5', at: AT });
});

test('a compaction after the last reply says so instead of giving a total, and a reply after the compaction is the total again', () => {
  assert.deepEqual(lastReply(transcript([said('hi'), reply(150000), said('/compact'), boundary, summary])), { compacted: true });
  assert.deepEqual(lastReply(transcript([said('hi'), reply(150000), boundary, summary, said('go on'), reply(21000)])), { total: 21000, model: 'claude-opus-4-5', at: AT });
});

test('nothing is found in an empty transcript, one with no reply, or one that is all side chain', () => {
  assert.equal(lastReply(transcript([])), null);
  assert.equal(lastReply(transcript([said('hello'), said('anyone there')])), null);
  assert.equal(lastReply(transcript([said('hello'), reply(500, { isSidechain: true })])), null);
});

test('a last line that is cut short is skipped, and one that is whole but has no newline is read', () => {
  const whole9999 = JSON.stringify(reply(9999));
  const half = whole9999.slice(0, whole9999.length - 15);
  const cut = path.join(dir, 'cut.jsonl');
  fs.writeFileSync(cut, `${lines([said('hi'), reply(1500)])}${half}`);
  assert.deepEqual(lastReply(cut), { total: 1500, model: 'claude-opus-4-5', at: AT });
  const whole = path.join(dir, 'whole.jsonl');
  fs.writeFileSync(whole, `${lines([said('hi'), reply(1500)])}${JSON.stringify(reply(2500))}`);
  assert.deepEqual(lastReply(whole), { total: 2500, model: 'claude-opus-4-5', at: AT });
});

test('every chunk size finds the same reply, so a line and a character that straddle a boundary are read whole', () => {
  const file = transcript([said('ünïcode é€😀 first'), reply(111), said('x'.repeat(300) + '€😀'), reply(222), said('😀'.repeat(50)), { type: 'user', message: { content: '€'.repeat(90) } }]);
  for (const chunk of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 4096]) {
    assert.deepEqual(lastReply(file, { chunk }), { total: 222, model: 'claude-opus-4-5', at: AT }, `chunk ${chunk}`);
  }
  const compacted = transcript([reply(333), said('é'.repeat(200)), boundary, summary]);
  for (const chunk of [1, 7, 64, 100, 1000]) assert.deepEqual(lastReply(compacted, { chunk }), { compacted: true }, `chunk ${chunk}`);
});

test('a tool result of several megabytes on either side of the reply does not hide it', () => {
  const big = says => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: says }] } });
  const before = transcript([reply(4321), big('x'.repeat(5 * 1024 * 1024))]);
  assert.deepEqual(lastReply(before), { total: 4321, model: 'claude-opus-4-5', at: AT });
  const around = transcript([big('é'.repeat(3 * 1024 * 1024)), reply(8765), big('€'.repeat(2 * 1024 * 1024)), said('after')]);
  assert.deepEqual(lastReply(around), { total: 8765, model: 'claude-opus-4-5', at: AT });
});

test('the reader gives up past its reach, and a line it reaches only half way is not read', () => {
  const first = JSON.stringify(reply(5000));
  const rest = JSON.stringify(said('filler '.repeat(20)));
  const file = path.join(dir, 'reach.jsonl');
  fs.writeFileSync(file, `${first}\n${rest}\n`);
  const size = fs.statSync(file).size;
  assert.deepEqual(lastReply(file, { reach: size }), { total: 5000, model: 'claude-opus-4-5', at: AT });
  assert.equal(lastReply(file, { reach: size - 1 }), null, 'one byte short, so the line starts out of reach');
  assert.equal(lastReply(file, { reach: size - 10 }), null, 'the rest of that line still holds the usage, but is not a line');
  assert.equal(lastReply(file, { reach: 0 }), null);
});

test('reading a transcript for its figure leaves the file as it was', () => {
  const file = transcript([said('hi'), reply(77)]);
  const before = [fs.readFileSync(file), fs.statSync(file).mtimeMs];
  lastReply(file);
  assert.deepEqual([fs.readFileSync(file), fs.statSync(file).mtimeMs], before);
});

// ---- the window of each model -----------------------------------------------------------------------

const stateOf = () => fs.mkdtempSync(path.join(dir, 'state-'));
const windowsFile = state => path.join(state, 'windows.json');

test('a window is learned for a model, saved, and still known to the next server', () => {
  const state = stateOf();
  const windows = makeWindows(state);
  assert.equal(windows.get('opus'), null, 'nothing is known until a chat has said');
  windows.learn('opus', { window: 300000, autoCompactAt: 267000, total: 5 });
  assert.deepEqual(windows.get('opus'), { window: 300000, autoCompactAt: 267000 });
  assert.deepEqual(JSON.parse(fs.readFileSync(windowsFile(state), 'utf8')), { opus: { window: 300000, autoCompactAt: 267000 } });
  assert.deepEqual(makeWindows(state).get('opus'), { window: 300000, autoCompactAt: 267000 });
  windows.learn('opus', { window: 300000, autoCompactAt: null });
  assert.deepEqual(makeWindows(state).get('opus'), { window: 300000, autoCompactAt: null }, 'auto-compact turned off is learned too');
});

test('a model with [1m] and the same model without it keep separate windows, and neither answers for the other', () => {
  const windows = makeWindows(stateOf());
  windows.learn('sonnet[1m]', { window: 1000000, autoCompactAt: 900000 });
  assert.equal(windows.get('sonnet'), null);
  windows.learn('sonnet', { window: 200000, autoCompactAt: 167000 });
  assert.deepEqual([windows.get('sonnet').window, windows.get('sonnet[1m]').window], [200000, 1000000]);
  const other = makeWindows(stateOf());
  other.learn('opus', { window: 300000, autoCompactAt: null });
  assert.equal(other.get('opus[1m]'), null);
});

test('a window that is not a positive number is not learned, and no model means nothing to learn or to ask', () => {
  const state = stateOf();
  const windows = makeWindows(state);
  for (const bad of [undefined, null, {}, { window: 0 }, { window: -5 }, { window: '300000' }, { window: Number.NaN }, { window: Infinity }]) windows.learn('opus', bad);
  for (const key of [null, undefined, '']) windows.learn(key, { window: 300000, autoCompactAt: 1 });
  assert.equal(windows.get('opus'), null);
  assert.deepEqual([windows.get(null), windows.get(undefined), windows.get('')], [null, null, null]);
  assert.equal(fs.existsSync(windowsFile(state)), false, 'nothing was worth saving');
  windows.learn('opus', { window: 300000, autoCompactAt: -1 });
  assert.deepEqual(windows.get('opus'), { window: 300000, autoCompactAt: null }, 'a bad auto-compact point costs only itself');
});

test('a saved file that is damaged, or holds a bad entry, costs only what is bad', () => {
  const state = stateOf();
  fs.writeFileSync(windowsFile(state), '{ not json');
  assert.equal(makeWindows(state).get('opus'), null);
  fs.writeFileSync(windowsFile(state), 'null');
  assert.equal(makeWindows(state).get('opus'), null);
  fs.writeFileSync(windowsFile(state), JSON.stringify({ good: { window: 300000, autoCompactAt: 267000 }, zero: { window: 0 }, text: { window: 'big' }, nothing: null, number: 5, list: [1], odd: { window: 100, autoCompactAt: 'soon' } }));
  const windows = makeWindows(state);
  assert.deepEqual(['good', 'zero', 'text', 'nothing', 'number', 'list', 'odd'].map(key => windows.get(key)), [{ window: 300000, autoCompactAt: 267000 }, null, null, null, null, null, { window: 100, autoCompactAt: null }]);
});

test('the file is written only when a value changes, and a name like __proto__ is a key and nothing more', () => {
  const state = stateOf();
  const windows = makeWindows(state);
  windows.learn('opus', { window: 300000, autoCompactAt: 267000 });
  const saved = fs.statSync(windowsFile(state)).ino;
  windows.learn('opus', { window: 300000, autoCompactAt: 267000 });
  windows.learn('opus', { window: 300000, autoCompactAt: 267000, total: 99, model: 'other' });
  assert.equal(fs.statSync(windowsFile(state)).ino, saved, 'the same window again is not a write');
  windows.learn('opus', { window: 300001, autoCompactAt: 267000 });
  assert.notEqual(fs.statSync(windowsFile(state)).ino, saved, 'a different one is');
  windows.learn('__proto__', { window: 5, autoCompactAt: null });
  assert.equal(({}).window, undefined);
  assert.deepEqual(makeWindows(state).get('__proto__'), { window: 5, autoCompactAt: null });
  assert.deepEqual(fs.readdirSync(state).sort(), ['windows.json'], 'no temporary file is left');
});

test('a window that cannot be saved is reported once and still known until the server restarts', () => {
  const warned = [];
  const windows = makeWindows(path.join(stateOf(), 'missing', 'folder'), { warn: message => warned.push(message) });
  windows.learn('opus', { window: 300000, autoCompactAt: 267000 });
  assert.equal(warned.length, 1);
  assert.match(warned[0], /Could not save the context windows/);
  assert.equal(windows.get('opus').window, 300000);
});

test('a transcript figure carries the window only while the total still fits in it', () => {
  const found = { total: 120000, model: 'claude-opus-4-5', at: AT };
  const base = { source: 'transcript', total: 120000, model: 'claude-opus-4-5', at: AT };
  assert.deepEqual(transcriptFigure(found, { window: 300000, autoCompactAt: 267000 }), { ...base, window: 300000, autoCompactAt: 267000 });
  assert.deepEqual(transcriptFigure(found, { window: 120000, autoCompactAt: null }), { ...base, window: 120000, autoCompactAt: null }, 'exactly full still fits');
  assert.deepEqual(transcriptFigure(found, { window: 100000, autoCompactAt: 90000 }), { ...base, window: null, autoCompactAt: null }, 'a window smaller than the total was learned for another model');
  assert.deepEqual(transcriptFigure(found, null), { ...base, window: null, autoCompactAt: null });
});

// ---- the plan's usage -------------------------------------------------------------------------------

const weekly = { kind: 'weekly_all', group: 'weekly', percent: 71, severity: 'normal', resets_at: '2026-11-04T01:59:59.864730+00:00', scope: null, is_active: true };
const scoped = { kind: 'weekly_scoped', group: 'weekly', percent: 2, severity: 'warning', resets_at: '2026-11-04T01:59:59.864949+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false };

test('the plan rows keep the server\'s order and say, for each, its kind, group, percent, reset, scope and severity', () => {
  assert.deepEqual(shapePlan([weekly, scoped]), [
    { kind: 'weekly_all', group: 'weekly', percent: 71, resetsAt: '2026-11-04T01:59:59.864Z', scope: null, severity: 'normal' },
    { kind: 'weekly_scoped', group: 'weekly', percent: 2, resetsAt: '2026-11-04T01:59:59.864Z', scope: 'Fable', severity: 'warning' },
  ]);
  assert.deepEqual(shapePlan([scoped, weekly]).map(r => r.kind), ['weekly_scoped', 'weekly_all'], 'the order is the server\'s');
  assert.equal(shapePlan([{ ...scoped, scope: { model: { display_name: 'Fable' }, surface: { display_name: 'Cowork' } } }])[0].scope, 'Fable · Cowork');
});

test('a percent is clamped to 0 to 100, a reset that is not a date is no reset, and a severity that is not known is normal', () => {
  const [over, under, odd] = shapePlan([{ ...weekly, percent: 140 }, { ...weekly, percent: -3 }, { ...weekly, resets_at: 'soon', severity: 'dire' }]);
  assert.deepEqual([over.percent, under.percent], [100, 0]);
  assert.deepEqual([odd.resetsAt, odd.severity], [null, 'normal']);
  assert.equal(shapePlan([{ ...weekly, resets_at: null }])[0].resetsAt, null);
});

test('a row without a kind, a group or a finite percent is dropped, and no usable row is null', () => {
  const bad = [null, 'x', 5, {}, { ...weekly, kind: '' }, { ...weekly, kind: 5 }, { ...weekly, group: undefined }, { ...weekly, percent: '71' }, { ...weekly, percent: NaN }, { ...weekly, percent: Infinity }];
  assert.equal(shapePlan(bad), null);
  assert.deepEqual(shapePlan([...bad, weekly]).map(r => r.percent), [71]);
  for (const none of [undefined, null, [], 'rows', {}]) assert.equal(shapePlan(none), null);
});

// ---- the route --------------------------------------------------------------------------------------

const file = (s, id) => path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
const append = (s, id, ...entries) => fs.appendFileSync(file(s, id), lines(entries));
const context = (s, token, id, json = {}, headers = {}) => request(s, 'POST', `/api/sessions/${id}/context`, { headers: { ...as(token), ...headers }, json });
const send = (s, token, id, text = 'hello') => request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text } });
// The CLI is asked for a count only once it is running, so a slow machine starting it would use up the time it has to answer.
const run = async (s, token, id) => {
  const before = cliCalls(s).filter(c => c.user).length;
  assert.equal((await send(s, token, id)).status, 200);
  await until(() => cliCalls(s).filter(c => c.user).length > before, 20_000);
};
const setModel = (s, token, id, model) => request(s, 'POST', `/api/sessions/${id}/model`, { headers: as(token), json: { model } });
const userSettings = (s, settings) => fs.writeFileSync(path.join(s.home, '.claude', 'settings.json'), JSON.stringify(settings));
const cliUsage = (s, answers) => fs.writeFileSync(path.join(s.home, 'context-usage.json'), JSON.stringify(answers));
const asked = s => cliCalls(s).filter(c => c.control === 'get_context_usage').map(c => c.detail);

test('only a signed-in browser on this site can ask, by POST, only summary and full are details, and a session with no reply to read has no figure', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'quiet', title: 'No reply yet' }] });
  assert.equal((await request(s, 'POST', '/api/sessions/quiet/context', { json: {} })).status, 401);
  const { token } = await signIn(s);
  assert.equal((await context(s, token, 'quiet', {}, { origin: 'http://evil.example' })).status, 403, 'cross-site');
  assert.equal((await context(s, token, 'quiet', {}, { origin: s.origin })).status, 200, 'the same origin is let through');
  assert.equal((await request(s, 'GET', '/api/sessions/quiet/context?detail=full', { headers: as(token) })).status, 405, 'an ask can save a window, so a GET is no ask');

  const plain = await context(s, token, 'quiet');
  assert.equal(plain.status, 200);
  assert.match(plain.headers['content-type'], /application\/json/);
  assert.equal(plain.headers['cache-control'], 'no-store');
  assert.deepEqual(plain.body(), { source: 'none' });
  assert.deepEqual((await context(s, token, 'quiet', { detail: 'full' })).body(), { source: 'none' });
  assert.deepEqual((await context(s, token, 'quiet', { detail: 'summary' })).body(), { source: 'none' });
  assert.deepEqual((await context(s, token, 'no-such-chat')).body(), { source: 'none' }, 'a session with no transcript has no figure to give');

  for (const bad of ['', 'everything', 'Full', 'full ', 'summary,full', 5, ['full'], {}]) {
    const refused = await context(s, token, 'quiet', { detail: bad });
    assert.equal(refused.status, 400, JSON.stringify(bad));
    assert.match(refused.body().error, /summary or full/);
  }
  assert.equal((await context(s, token, 'bad%20id')).status, 400);
  assert.deepEqual(asked(s), [], 'no chat is running, so no CLI was asked');
});

test('a chat with no process is read from its transcript: the window comes from what its model was last seen with, never from the model\'s [1m] twin', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'one', title: 'Runs' }, { id: 'two', title: 'Idle' }, { id: 'huge', title: 'Over' }, { id: 'long', title: 'Long' }] });
  userSettings(s, { model: 'sonnet' });
  const { token } = await signIn(s);
  for (const id of ['one', 'two', 'long']) append(s, id, reply(2000), said('go on'), reply(47000, { message: { ...reply(0).message, model: 'claude-sonnet-4-5', usage: { input_tokens: 60, cache_creation_input_tokens: 1700, cache_read_input_tokens: 46000, output_tokens: 400 } } }));
  const before = fs.readFileSync(file(s, 'two'), 'utf8');

  const unknown = { source: 'transcript', total: 47760, model: 'claude-sonnet-4-5', at: AT, window: null, autoCompactAt: null };
  assert.deepEqual((await context(s, token, 'two')).body(), unknown, 'nothing has told Capcom how big sonnet\'s window is yet');
  assert.deepEqual((await context(s, token, 'two', { detail: 'full' })).body(), unknown, 'and a full count is only a process\'s to give');

  cliUsage(s, { summary: { totalTokens: 47760, maxTokens: 300000, model: 'claude-sonnet-4-5', autoCompactThreshold: 267000, isAutoCompactEnabled: true } });
  assert.equal((await setModel(s, token, 'one', 'sonnet')).status, 200);
  await run(s, token, 'one');
  assert.deepEqual((await context(s, token, 'one')).body(), { source: 'process', detail: 'summary', total: 47760, window: 300000, autoCompactAt: 267000, model: 'claude-sonnet-4-5' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.state, 'windows.json'), 'utf8')), { sonnet: { window: 300000, autoCompactAt: 267000 } });

  assert.deepEqual((await context(s, token, 'two')).body(), { ...unknown, window: 300000, autoCompactAt: 267000 }, 'another chat on the same model is known by it');
  assert.equal((await setModel(s, token, 'long', 'sonnet[1m]')).status, 200);
  assert.deepEqual((await context(s, token, 'long')).body(), unknown, 'the [1m] twin has not been seen');
  assert.equal((await setModel(s, token, 'two', 'opus')).status, 200);
  assert.deepEqual((await context(s, token, 'two')).body(), unknown, 'and neither has another model');

  append(s, 'huge', reply(400000, { message: { ...reply(0).message, usage: { input_tokens: 400000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } }));
  assert.deepEqual((await context(s, token, 'huge')).body(), { ...unknown, total: 400000, model: 'claude-opus-4-5' }, 'a total beyond the window means the window is not this chat\'s');

  assert.equal(fs.readFileSync(file(s, 'two'), 'utf8'), before, 'asking never writes a transcript');
});

test('a chat Capcom runs answers from its CLI, and a full count adds the parts, which the CLI is asked for only when the page asks', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'live', title: 'Runs' }] });
  userSettings(s, { model: 'opus' });
  const { token } = await signIn(s);
  append(s, 'live', reply(1234));
  const figure = { totalTokens: 39300, maxTokens: 300000, model: 'claude-opus-4-5', autoCompactThreshold: 267000, isAutoCompactEnabled: true };
  cliUsage(s, { summary: figure, full: { ...figure, categories: raw.categories } });
  await run(s, token, 'live');

  const summary = await context(s, token, 'live');
  assert.deepEqual(summary.body(), { source: 'process', detail: 'summary', total: 39300, window: 300000, autoCompactAt: 267000, model: 'claude-opus-4-5' });
  assert.deepEqual(asked(s), ['summary']);

  const full = (await context(s, token, 'live', { detail: 'full' })).body();
  assert.deepEqual(full, { source: 'process', detail: 'full', ...shapeUsage({ ...figure, categories: raw.categories }, 'full') });
  assert.deepEqual(full.categories.map(c => c.name), ['Messages', 'System tools', 'System prompt']);
  assert.deepEqual(asked(s), ['summary', 'full']);
});

test('when the CLI cannot answer, the transcript does, and a compaction after the last reply is a figure of its own', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'live', title: 'Runs' }, { id: 'packed', title: 'Compacted' }] });
  userSettings(s, { model: 'opus' });
  const { token } = await signIn(s);
  append(s, 'live', reply(5000));
  cliUsage(s, { summary: { totalTokens: 9000, maxTokens: 300000, autoCompactThreshold: 267000, isAutoCompactEnabled: true } });
  assert.equal((await setModel(s, token, 'live', 'opus')).status, 200);
  await run(s, token, 'live');
  assert.equal((await context(s, token, 'live')).body().source, 'process');

  const fallback = await context(s, token, 'live', { detail: 'full' });
  assert.equal(fallback.status, 200);
  assert.deepEqual(fallback.body(), { source: 'transcript', total: 5000, model: 'claude-opus-4-5', at: AT, window: 300000, autoCompactAt: 267000 }, 'the CLI refused a full count, and the window it taught for opus is used');
  await until(() => asked(s).length === 2);

  cliUsage(s, { summary: { totalTokens: 'unreadable' } });
  assert.deepEqual((await context(s, token, 'live')).body().source, 'transcript', 'a reply with no total is no reply');

  append(s, 'packed', reply(150000), said('/compact'), boundary, summary);
  assert.deepEqual((await context(s, token, 'packed')).body(), { source: 'none', compacted: true });
  append(s, 'packed', said('go on'), reply(21000));
  assert.equal((await context(s, token, 'packed')).body().total, 21000);
});

test('a window is saved only for a model the chat was set to, so a chat on the model settings.json names teaches nothing', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'default', title: 'Settings model' }, { id: 'picked', title: 'Picked model' }, { id: 'idle', title: 'Idle' }] });
  userSettings(s, { model: 'opus' });
  const { token } = await signIn(s);
  append(s, 'idle', reply(5000));
  cliUsage(s, { summary: { totalTokens: 39300, maxTokens: 300000, model: 'claude-opus-4-5', autoCompactThreshold: 267000, isAutoCompactEnabled: true } });
  const saved = () => path.join(s.state, 'windows.json');

  await run(s, token, 'default');
  assert.equal((await context(s, token, 'default')).body().window, 300000, 'the chat still shows its own count');
  assert.equal(fs.existsSync(saved()), false, 'but nothing set it to a model, so there is no model to save the window under');
  assert.equal((await context(s, token, 'idle')).body().window, null, 'and a chat that is not running is no wiser');

  assert.equal((await setModel(s, token, 'picked', 'opus')).status, 200);
  await run(s, token, 'picked');
  assert.equal((await context(s, token, 'picked')).body().window, 300000);
  assert.deepEqual(JSON.parse(fs.readFileSync(saved(), 'utf8')), { opus: { window: 300000, autoCompactAt: 267000 } });
  assert.equal((await context(s, token, 'idle')).body().window, 300000, 'now it knows');
});

// A CLI that keeps its first count until the model is switched, then answers it with the window of the model it was asked on.
const holdingCli = s => fs.writeFileSync(path.join(s.home, 'claude'), [
  '#!/usr/bin/env node',
  "import fs from 'node:fs';",
  "import readline from 'node:readline';",
  `const note = entry => fs.appendFileSync(${JSON.stringify(s.cliLog)}, JSON.stringify(entry) + '\\n');`,
  "const say = message => process.stdout.write(JSON.stringify(message) + '\\n');",
  "let model = process.argv[process.argv.indexOf('--model') + 1];",
  'let held = null;',
  "readline.createInterface({ input: process.stdin }).on('line', line => {",
  '  const m = JSON.parse(line);',
  "  if (m.type === 'user') note({ user: m.message.content });",
  "  if (m.type !== 'control_request') return;",
  "  const answer = response => say({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } });",
  "  if (m.request.subtype === 'get_context_usage') {",
  "    note({ control: 'get_context_usage', detail: m.request.detail });",
  "    const window = model.endsWith('[1m]') ? 1000000 : 300000;",
  "    const count = () => answer({ totalTokens: 40000, maxTokens: window, model, autoCompactThreshold: window - 33000, isAutoCompactEnabled: true });",
  '    if (held === null) held = count;',
  '    else count();',
  '  }',
  "  if (m.request.subtype === 'set_model') {",
  '    model = m.request.model;',
  '    answer({});',
  '    if (held) setTimeout(held, 200);',
  '  }',
  '});',
  '',
].join('\n'), { mode: 0o755 });

test('a count that was in flight when the model was switched is not saved for the new model, and the next count is', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'live', title: 'Switches' }] });
  holdingCli(s);
  const { token } = await signIn(s);
  const saved = () => path.join(s.state, 'windows.json');
  assert.equal((await setModel(s, token, 'live', 'sonnet')).status, 200);
  await run(s, token, 'live');

  const late = context(s, token, 'live');
  await until(() => asked(s).length === 1);
  assert.equal((await setModel(s, token, 'live', 'sonnet[1m]')).status, 200);
  assert.equal((await late).body().window, 300000, 'the count is the one that was asked for, with the window of the model it was asked on');
  assert.equal(fs.existsSync(saved()), false, 'and it says nothing about the model the chat is on now');

  assert.equal((await context(s, token, 'live')).body().window, 1_000_000);
  assert.deepEqual(JSON.parse(fs.readFileSync(saved(), 'utf8')), { 'sonnet[1m]': { window: 1_000_000, autoCompactAt: 967_000 } });
});

// ---- the route for the plan's usage ------------------------------------------------------------------

const plan = (s, token, id, headers = {}) => request(s, 'POST', `/api/sessions/${id}/plan`, { headers: { ...as(token), ...headers }, json: {} });
const planFile = (s, limits) => fs.writeFileSync(path.join(s.home, 'plan-usage.json'), JSON.stringify(limits));
const usageAsks = s => cliCalls(s).filter(c => c.control === 'get_usage');

test('only a signed-in browser on this site can ask for the plan, by POST, and with no chat running no process is started to answer', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'quiet', title: 'Idle' }] });
  assert.equal((await request(s, 'POST', '/api/sessions/quiet/plan', { json: {} })).status, 401);
  const { token } = await signIn(s);
  assert.equal((await plan(s, token, 'quiet', { origin: 'http://evil.example' })).status, 403);
  assert.equal((await request(s, 'GET', '/api/sessions/quiet/plan', { headers: as(token) })).status, 405);
  assert.equal((await plan(s, token, 'bad%20id')).status, 400);

  planFile(s, [weekly]);
  const answer = await plan(s, token, 'quiet');
  assert.equal(answer.status, 200);
  assert.equal(answer.headers['cache-control'], 'no-store');
  assert.deepEqual(answer.body(), { limits: null });
  assert.deepEqual(cliCalls(s), [], 'nothing was started for it');
});

test('a chat Capcom runs answers with the plan\'s rows, shaped, and the CLI is told to skip the scan of transcripts', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'live', title: 'Runs' }] });
  const { token } = await signIn(s);
  await run(s, token, 'live');
  planFile(s, [weekly, { kind: 'weekly_scoped', percent: 'many' }, scoped]);
  assert.deepEqual((await plan(s, token, 'live')).body(), { limits: shapePlan([weekly, scoped]) });
  assert.deepEqual(usageAsks(s).map(c => c.skip), [true]);
});

test('the plan belongs to the account, so a chat with no process is answered by another that runs, and a failed or empty answer is no limits', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'live', title: 'Runs' }, { id: 'idle', title: 'Idle' }] });
  const { token } = await signIn(s);
  await run(s, token, 'live');
  planFile(s, [weekly]);
  assert.deepEqual((await plan(s, token, 'idle')).body(), { limits: shapePlan([weekly]) });
  assert.equal(usageAsks(s).length, 1);

  for (const none of [[], null]) {
    planFile(s, none);
    assert.deepEqual((await plan(s, token, 'idle')).body(), { limits: null });
  }
  assert.deepEqual((await plan(s, token, 'live')).body(), { limits: null }, 'the CLI refusing is no limits');
});
