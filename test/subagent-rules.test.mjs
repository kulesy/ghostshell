// Run with `npm test`. What the helpers a session started say about themselves, with no files: how an entry leaves the agent, the state
// that makes, how a step reads and the order of the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionOf, agentsKey, callLabel, howOf, orderAgents, replyOf, stateOf, stepsOf } from '../lib/subagent-rules.mjs';

const T = '2026-10-26T01:00:00.000Z';
const assistant = (content, extra = {}, message = {}) => ({ type: 'assistant', timestamp: T, message: { role: 'assistant', content, ...message }, ...extra });
const text = t => ({ type: 'text', text: t });
const call = (name, input) => ({ type: 'tool_use', id: 't1', name, input });

test('a tool call reads as a verb and what it touches, with the folder left off a path', () => {
  const cases = [
    ['Read', { file_path: '/work/demo/lib/work.mjs' }, 'Read lib/work.mjs'],
    ['Bash', { command: 'npm test' }, 'Ran npm test'],
    ['Bash', { command: 'git log\n  --oneline' }, 'Ran git log --oneline'],
    ['Grep', { pattern: 'subagent' }, 'Searched for subagent'],
    ['Grep', { pattern: 'x', path: '/work/demo/lib' }, 'Searched for x in lib'],
    ['Glob', { pattern: '**/*.mjs' }, 'Listed **/*.mjs'],
    ['Edit', { file_path: '/work/demo/a.mjs' }, 'Edited a.mjs'],
    ['Write', { file_path: '/elsewhere/a.mjs' }, 'Wrote /elsewhere/a.mjs'],
    ['WebSearch', { query: 'node test runner' }, 'Searched the web for node test runner'],
    ['Task', { description: 'Check the build' }, 'Started Check the build'],
    ['mcp__claude-in-chrome__navigate', { url: 'https://example.com' }, 'Navigate https://example.com'],
    ['mcp__other__list_things', {}, 'List things'],
    ['Read', {}, 'Read'],
  ];
  for (const [name, input, want] of cases) assert.equal(callLabel(name, input, '/work/demo'), want, name);
  assert.equal(callLabel(undefined, undefined), '');
});

test('a long command is cut to one line with an ellipsis', () => {
  const label = callLabel('Bash', { command: `echo ${'x'.repeat(500)}` });
  assert.ok(label.length <= 'Ran '.length + 120);
  assert.ok(label.endsWith('...'));
  assert.equal(actionOf({ label: 'a'.repeat(200) }).length, 80);
  assert.equal(actionOf(undefined), '');
});

test('an assistant entry gives its tool calls and its text as steps in the order written, and skips thinking', () => {
  const e = assistant([{ type: 'thinking', thinking: 'hmm' }, text('Looking\n  at it'), call('Read', { file_path: '/w/a' }), text('  ')]);
  assert.deepEqual(stepsOf(e).map(s => [s.kind, s.label]), [['text', 'Looking at it'], ['tool', 'Read /w/a']]);
  assert.equal(stepsOf(e)[0].at, Date.parse(T));
  assert.equal(stepsOf({ ...e, timestamp: 'nope' })[0].at, null);
  assert.deepEqual(stepsOf({ type: 'user', message: { content: [text('hi')] } }), []);
  assert.deepEqual(stepsOf(null), []);
  assert.equal(stepsOf(assistant([text('x'.repeat(500))]))[0].label.length, 200);
});

test('the reply is the last piece of text in an assistant entry, and nothing for any other entry', () => {
  assert.equal(replyOf(assistant([text('one'), call('Read', {}), text(' two ')])), 'two');
  assert.equal(replyOf(assistant([call('Read', {})])), '');
  assert.equal(replyOf({ type: 'user', message: { content: 'x' } }), '');
});

test('howOf tells how an entry leaves the agent', () => {
  const how = e => howOf(e)?.how;
  assert.equal(how(assistant([text('Done.')], {}, { stop_reason: 'end_turn' })), 'ended');
  assert.equal(how(assistant([text('Done.')], {}, { stop_reason: 'stop_sequence' })), 'ended');
  assert.equal(how(assistant([call('Read', {})], {}, { stop_reason: 'tool_use' })), 'working');
  assert.equal(how(assistant([text('API Error: 500')], { isApiErrorMessage: true, error: 'server_error' }, { stop_reason: 'stop_sequence' })), 'failed');
  assert.equal(how(assistant([text('cut off')], {}, { stop_reason: 'max_tokens' })), 'failed');
  assert.equal(how(assistant([text('no')], {}, { stop_reason: 'refusal' })), 'failed');
  assert.equal(how(assistant([text('final words')])), 'text');
  assert.equal(how(assistant([text('and then'), call('Read', {})])), 'working');
  assert.equal(how(assistant([{ type: 'thinking', thinking: 'x' }])), 'working');
  assert.equal(how({ type: 'user', message: { content: [text('[Request interrupted by user]')] } }), 'stopped');
  assert.equal(how({ type: 'user', message: { content: '[Request interrupted by user for tool use]' } }), 'stopped');
  assert.equal(how({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }), 'working');
  assert.equal(how({ type: 'user', toolEndsTurn: true, message: { content: [{ type: 'tool_result', content: 'ok' }] } }), 'ended');
  assert.equal(howOf({ type: 'user', timestamp: T, message: { content: 'x' } }).at, Date.parse(T));
});

test('entries that say nothing about the agent are skipped', () => {
  for (const e of [null, undefined, {}, { type: 'attachment' }, { type: 'api-request' }, { type: 'system', subtype: 'x' }]) assert.equal(howOf(e), null);
  assert.equal(howOf({ type: 'user', timestamp: 'nope', message: { content: 'x' } }).at, null);
});

test('the state follows how the agent ended, the meta file and whether its file has gone quiet', () => {
  const state = (how, finished = false, quiet = false) => stateOf({ finished, how, quiet });
  assert.deepEqual(['working', 'text', 'ended'].map(h => state(h)), ['running', 'running', 'done']);
  assert.deepEqual(['working', 'text', 'ended'].map(h => state(h, true)), ['done', 'done', 'done']);
  assert.deepEqual(['working', 'text', 'ended', 'stopped', 'failed'].map(h => state(h, false, true)), ['stopped', 'done', 'done', 'stopped', 'failed']);
  assert.equal(state('stopped'), 'stopped', 'an interrupt needs no wait');
  assert.equal(state('failed', true), 'failed', 'finished does not hide a failure');
  assert.equal(state('failed'), 'failed');
  assert.equal(stateOf({}), 'running');
});

test('running agents come first, the newest start first, then the rest, the newest end first', () => {
  const list = [
    { id: 'a', state: 'done', startedAt: 10, endedAt: 50 },
    { id: 'b', state: 'running', startedAt: 20, endedAt: null },
    { id: 'c', state: 'failed', startedAt: 5, endedAt: 90 },
    { id: 'd', state: 'running', startedAt: 30, endedAt: null },
    { id: 'e', state: 'stopped', startedAt: 40, endedAt: 60 },
    { id: 'f', state: 'done', startedAt: 1, endedAt: null },
  ];
  const before = JSON.stringify(list);
  assert.deepEqual(orderAgents(list).map(a => a.id), ['d', 'b', 'c', 'e', 'a', 'f']);
  assert.equal(JSON.stringify(list), before, 'the list is not changed');
  assert.deepEqual(orderAgents([{ id: 'y', state: 'done', endedAt: 1 }, { id: 'x', state: 'done', endedAt: 1 }]).map(a => a.id), ['x', 'y']);
});

test('the key moves with ids, states and actions and not with the clock', () => {
  const a = { id: 'a', state: 'running', action: 'Read x', startedAt: 1, endedAt: null };
  assert.equal(agentsKey([a]), agentsKey([{ ...a, startedAt: 2, endedAt: 9, model: 'm', type: 't' }]));
  for (const change of [{ id: 'b' }, { state: 'done' }, { action: 'Ran y' }]) assert.notEqual(agentsKey([a]), agentsKey([{ ...a, ...change }]));
  assert.notEqual(agentsKey([a]), agentsKey([]));
});
