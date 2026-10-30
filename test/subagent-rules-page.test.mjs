// Run with `npm test`. What the Subagents tab decides with no page: when a chat has the tab, how a list from the server becomes the page's
// own clock, the order and the fold, the words for a state, a model and a time, and when an open helper is read again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentsButtonName, agentsOn, DETAIL_POLL_MS, elapsedOf, elapsedText, finishedLabel, foldMustOpen, heardAgents, metaOf, modelName, movedToFinished, partsOf, pollsDetail, summaryLine, tabOffered, titleOf,
} from '../public/ui/subagent-rules.js';

const NOW = Date.parse('2026-10-26T10:00:00.000Z');
const SECOND = 1000;
const agent = (id, extra = {}) => ({ id, type: 'Explore', description: `Job ${id}`, model: 'sonnet', state: 'running', startedAt: NOW - 60 * SECOND, endedAt: null, ms: 60 * SECOND, action: 'Read a.mjs', ...extra });

test('the tab is offered only to a server that sends helpers, and only once the chat has had one', () => {
  assert.equal(agentsOn({ subagents: true }), true);
  for (const features of [undefined, null, {}, { subagents: false }]) assert.equal(agentsOn(features), false);
  assert.equal(tabOffered({ subagents: true }, [agent('a')]), true);
  assert.equal(tabOffered({ subagents: true }, []), false, 'a chat with no helper has no tab');
  assert.equal(tabOffered({ subagents: true }, null), false, 'nor one that has not heard yet');
  assert.equal(tabOffered({}, [agent('a')]), false, 'a server without the feature offers none');
  assert.equal(tabOffered(undefined, undefined), false);
});

test('a running helper starts on the page\'s clock the server\'s elapsed time ago, so the two clocks need not agree', () => {
  const got = heardAgents(null, [agent('a', { startedAt: NOW - 9_999_000, ms: 12 * SECOND })], NOW);
  assert.equal(got[0].since, NOW - 12 * SECOND);
  assert.equal(elapsedOf(got[0], NOW + 3 * SECOND), 15 * SECOND, 'it keeps counting between events');
  assert.equal(elapsedText(got[0], NOW + 3 * SECOND), '15s');
});

test('a later report can only move a running start earlier, and a helper that ended keeps the time the server gave', () => {
  const first = heardAgents(null, [agent('a', { ms: 10 * SECOND })], NOW);
  const slow = heardAgents(first, [agent('a', { ms: 10 * SECOND })], NOW + 2 * SECOND);
  assert.equal(slow[0].since, NOW - 10 * SECOND, 'a report that arrives late does not step the timer back');
  const early = heardAgents(first, [agent('a', { ms: 30 * SECOND })], NOW + 2 * SECOND);
  assert.equal(early[0].since, NOW - 28 * SECOND);
  const done = heardAgents(early, [agent('a', { state: 'done', endedAt: NOW, ms: 95 * SECOND })], NOW + 60 * SECOND);
  assert.equal('since' in done[0], false);
  assert.equal(elapsedOf(done[0], NOW + 600 * SECOND), 95 * SECOND, 'the time stops when it does');
  const again = heardAgents(done, [agent('a', { ms: 5 * SECOND })], NOW + 70 * SECOND);
  assert.equal(again[0].since, NOW + 65 * SECOND, 'a helper that runs again starts afresh');
});

test('an event with no list, or entries with no id, leaves an empty list and an agent without ms counts from now', () => {
  assert.deepEqual(heardAgents(null, undefined, NOW), []);
  assert.deepEqual(heardAgents(null, 'x', NOW), []);
  assert.deepEqual(heardAgents(null, [null, 4, { state: 'running' }], NOW), []);
  const { ms, ...bare } = agent('a');
  assert.equal(elapsedOf(heardAgents(null, [bare], NOW)[0], NOW), 0);
});

test('running helpers come first, the newest start first, and the finished ones after, the newest end first', () => {
  const list = [
    agent('old-run', { startedAt: 1000 }), agent('done-a', { state: 'done', endedAt: 5000 }), agent('new-run', { startedAt: 3000 }),
    agent('failed', { state: 'failed', endedAt: 9000 }), agent('stopped', { state: 'stopped', endedAt: 7000 }),
  ];
  const { running, finished } = partsOf(list);
  assert.deepEqual(running.map(a => a.id), ['new-run', 'old-run']);
  assert.deepEqual(finished.map(a => a.id), ['failed', 'stopped', 'done-a']);
  assert.deepEqual(partsOf(null), { running: [], finished: [] });
});

test('the summary counts what is running and what has finished, and leaves out a part that is none', () => {
  const list = [agent('a'), agent('b'), ...['c', 'd', 'e', 'f', 'g'].map(id => agent(id, { state: 'done', endedAt: 1 }))];
  assert.equal(summaryLine(list), '2 running, 5 finished');
  assert.equal(summaryLine(list.slice(0, 2)), '2 running');
  assert.equal(summaryLine(list.slice(2)), '5 finished');
  assert.equal(summaryLine([]), '');
  assert.equal(finishedLabel(5), 'Finished (5)');
});

test('the header button is named with the counts, since its running mark is colour alone', () => {
  assert.equal(agentsButtonName([agent('a'), agent('b', { state: 'done' })]), 'Subagents: 1 running, 1 finished');
  assert.equal(agentsButtonName([agent('b', { state: 'done' })]), 'Subagents: 1 finished');
});

test('a model is named short, an id the page cannot read is shown as given, and none shows nothing', () => {
  assert.equal(modelName('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(modelName('sonnet'), 'Sonnet');
  assert.equal(modelName('haiku'), 'Haiku');
  assert.equal(modelName('opus'), 'Opus');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelName('some-other-model'), 'some-other-model');
  assert.equal(modelName(''), '');
  assert.equal(modelName(undefined), '');
});

test('time reads as seconds, then minutes and seconds, then hours and minutes', () => {
  const text = ms => elapsedText({ state: 'done', ms });
  assert.equal(text(12 * SECOND), '12s');
  assert.equal(text(184 * SECOND), '3m 04s');
  assert.equal(text(3720 * SECOND), '1h 02m');
  assert.equal(text(0), '0s');
});

test('the facts under a title give the state in words, then the model and the time, and a missing model leaves a gap out', () => {
  assert.deepEqual(metaOf(agent('a', { model: 'claude-sonnet-5-5', ms: 184 * SECOND, state: 'done' }), NOW), ['Done', 'Sonnet 5.5', '3m 04s']);
  assert.deepEqual(metaOf(agent('a', { model: '', state: 'failed', ms: 5 * SECOND }), NOW), ['Failed', '5s']);
  assert.deepEqual(metaOf({ state: 'stopped', model: '', ms: 1000 }, NOW), ['Stopped', '1s']);
  assert.equal(metaOf(agent('a'), NOW)[0], 'Running');
});

test('a title falls back to the type and then to a plain word', () => {
  assert.equal(titleOf(agent('a')), 'Job a');
  assert.equal(titleOf(agent('a', { description: '' })), 'Explore');
  assert.equal(titleOf({ id: 'a' }), 'Subagent');
});

test('an open helper is read again only while it runs and its tab is on show', () => {
  assert.equal(DETAIL_POLL_MS, 3000);
  assert.equal(pollsDetail({ open: true, active: true, state: 'running' }), true);
  for (const state of ['done', 'stopped', 'failed']) assert.equal(pollsDetail({ open: true, active: true, state }), false, state);
  assert.equal(pollsDetail({ open: false, active: true, state: 'running' }), false);
  assert.equal(pollsDetail({ open: true, active: false, state: 'running' }), false);
});

test('a card that stops running is found, and the fold must open for it only when it was open or had focus', () => {
  const before = [agent('a'), agent('b'), agent('c', { state: 'done' })];
  const after = [agent('a', { state: 'done' }), agent('b'), agent('c', { state: 'done' }), agent('d', { state: 'failed' })];
  const moved = movedToFinished(before, after);
  assert.deepEqual(moved, ['a'], 'a card already finished, or new, did not move');
  assert.deepEqual(movedToFinished(null, after), []);
  assert.equal(foldMustOpen(moved, { a: true }, null), true, 'it was open');
  assert.equal(foldMustOpen(moved, {}, 'a'), true, 'it had focus');
  assert.equal(foldMustOpen(moved, { b: true }, 'b'), false, 'another card was open');
  assert.equal(foldMustOpen([], { a: true }, 'a'), false);
});
