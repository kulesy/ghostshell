// Run with `npm test`. What a session's pull requests say on its card and when they put the session in the owner's court, with no page: the
// facts of one pull request, their words, tones and order, the order of a session's pull requests, who is waited on, and which sessions to ask about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardPulls, factsOf, FRESH_MS, needsOf, needsOwner, orderPulls, pullsToAsk, scopeOf, wantsPulls } from '../public/ui/pull-rules.js';
import { stampOf } from '../public/ui/sub-panel-rules.js';

const NOW = Date.parse('2026-10-26T01:00:00.000Z');
const url = n => `https://github.com/example-org/example-repo/pull/${n}`;

const pull = (extra = {}) => ({
  url: url(12), repo: 'example-org/example-repo', number: 12, state: 'open', mine: true, asked: false, requested: 0,
  review: 'none', checks: 'none', conflicts: false, clean: false, threads: 0, ...extra,
});
const words = p => factsOf(p).map(f => f.text);
const keys = p => factsOf(p).map(f => f.key);

test('each fact has its words and tone', () => {
  const cases = [
    [{ asked: true, mine: false }, 'review', 'Needs your review', 'needs'],
    [{ review: 'changes' }, 'changes', 'Changes requested', 'needs'],
    [{ conflicts: true }, 'conflicts', 'Has conflicts', 'needs'],
    [{ threads: 3 }, 'comments', 'Has 3 unresolved comments', 'needs'],
    [{ checks: 'failing' }, 'failing', 'Checks failing', 'error'],
    [{ checks: 'running' }, 'running', 'Checks running', 'working'],
    [{ review: 'approved' }, 'approved', 'Approved', 'ready'],
    [{ review: 'approved', clean: true, checks: 'passing' }, 'ready', 'Ready to merge', 'ready'],
    [{ requested: 1 }, 'waiting', 'Waiting for review', 'quiet'],
    [{ review: 'required' }, 'waiting', 'Waiting for review', 'quiet'],
    [{}, 'open', 'Open', 'quiet'],
    [{ state: 'merged' }, 'merged', 'Merged', 'ready'],
    [{ state: 'closed' }, 'closed', 'Closed', 'quiet'],
  ];
  for (const [extra, key, text, tone] of cases) assert.deepEqual(factsOf(pull(extra)), [{ key, text, tone }], key);
});

test('a single unresolved comment reads in the singular', () => {
  assert.deepEqual(words(pull({ threads: 1 })), ['Has 1 unresolved comment']);
  assert.deepEqual(words(pull({ threads: 0 })), ['Open']);
  assert.deepEqual(words(pull({ threads: null })), ['Open'], 'comments that could not be counted say nothing');
});

test('the facts come most urgent first, and a pull request shows at most three', () => {
  const all = pull({ asked: true, mine: false, review: 'changes', conflicts: true, threads: 2, checks: 'failing', state: 'draft' });
  assert.deepEqual(keys(all), ['review', 'changes', 'conflicts']);
  assert.deepEqual(factsOf(all, Infinity).map(f => f.key), ['review', 'changes', 'conflicts', 'comments', 'failing', 'draft']);
  assert.deepEqual(keys(pull({ threads: 1, checks: 'running', review: 'approved' })), ['comments', 'running', 'approved']);
  assert.deepEqual(keys(pull({ conflicts: true, checks: 'failing' })), ['conflicts', 'failing']);
});

test('ready to merge needs an open pull request that is approved, clean and has no checks failing or running, and approved is what is left of it', () => {
  const ok = { review: 'approved', clean: true, checks: 'passing' };
  assert.deepEqual(keys(pull(ok)), ['ready']);
  assert.deepEqual(keys(pull({ ...ok, checks: 'none' })), ['ready']);
  assert.deepEqual(keys(pull({ ...ok, clean: false })), ['approved']);
  assert.deepEqual(keys(pull({ ...ok, checks: 'failing' })), ['failing', 'approved']);
  assert.deepEqual(keys(pull({ ...ok, checks: 'running' })), ['running', 'approved']);
  assert.deepEqual(keys(pull({ ...ok, state: 'draft' })), ['approved', 'draft']);
});

test('waiting for review and open show only when nothing above them applies, and a draft says so last', () => {
  assert.deepEqual(keys(pull({ requested: 2, checks: 'failing' })), ['failing']);
  assert.deepEqual(keys(pull({ review: 'required', threads: 1 })), ['comments']);
  assert.deepEqual(keys(pull({ checks: 'passing' })), ['open']);
  assert.deepEqual(keys(pull({ state: 'draft' })), ['draft'], 'a draft is open already');
  assert.deepEqual(keys(pull({ state: 'draft', requested: 1 })), ['waiting', 'draft']);
  assert.deepEqual(keys(pull({ state: 'draft', checks: 'failing' })), ['failing', 'draft']);
});

test('a merged or closed pull request says only that, whatever else is true of it', () => {
  const busy = { asked: true, review: 'changes', conflicts: true, threads: 4, checks: 'failing', clean: true };
  assert.deepEqual(words(pull({ ...busy, state: 'merged' })), ['Merged']);
  assert.deepEqual(words(pull({ ...busy, state: 'closed' })), ['Closed']);
});

test('a session\'s pull requests go in the order of their most urgent fact, and a tie keeps the order the server gave', () => {
  const list = [
    pull({ url: url(1), state: 'merged' }),
    pull({ url: url(2) }),
    pull({ url: url(3), checks: 'failing' }),
    pull({ url: url(4), asked: true, mine: false }),
    pull({ url: url(5), checks: 'failing' }),
    pull({ url: url(6), state: 'draft' }),
    pull({ url: url(7), review: 'approved', clean: true }),
    pull({ url: url(8), state: 'closed' }),
    pull({ url: url(9), review: 'changes' }),
  ];
  assert.deepEqual(orderPulls(list).map(p => p.url.slice(-1)), ['4', '9', '3', '5', '7', '2', '6', '1', '8']);
  assert.deepEqual(list.map(p => p.url.slice(-1)), ['1', '2', '3', '4', '5', '6', '7', '8', '9'], 'the list given is not changed');
  assert.deepEqual(orderPulls([]), []);
});

test('a card draws only pull requests the page may link to, in order', () => {
  const list = [pull({ url: 'javascript:alert(1)' }), pull({ url: 'https://github.com.evil.example/o/r/pull/3' }), pull({ url: url(2) }), pull({ url: url(1), checks: 'failing' }), null];
  assert.deepEqual(cardPulls(list).map(p => p.url), [url(1), url(2)]);
  assert.deepEqual(cardPulls(undefined), []);
  assert.deepEqual(cardPulls('nothing'), []);
});

test('a review asked of the owner always waits on them, for a draft too, and merged and closed never do', () => {
  const asked = { asked: true, mine: false };
  for (const state of ['working', 'idle', 'waiting', 'active']) assert.equal(needsOwner([pull({ ...asked })], { state }), true, state);
  assert.equal(needsOwner([pull({ ...asked, state: 'draft' })], { state: 'working' }), true);
  assert.equal(needsOwner([pull({ ...asked, state: 'merged' })], { state: 'idle' }), false);
  assert.equal(needsOwner([pull({ ...asked, state: 'closed' })], { state: 'idle' }), false);
});

test('the owner\'s own pull request waits on them when it is ready to merge, and when it has work on it only while its session is not working', () => {
  const ready = pull({ review: 'approved', clean: true, checks: 'passing' });
  assert.equal(needsOwner([ready], { state: 'idle' }), true);
  assert.equal(needsOwner([ready], { state: 'working' }), true, 'only the owner can merge');
  assert.equal(needsOwner([pull({ ...ready, state: 'draft' })], { state: 'idle' }), false);
  for (const extra of [{ review: 'changes' }, { conflicts: true }, { threads: 2 }, { checks: 'failing' }]) {
    assert.equal(needsOwner([pull(extra)], { state: 'idle' }), true, JSON.stringify(extra));
    assert.equal(needsOwner([pull(extra)], { state: 'active' }), true, JSON.stringify(extra));
    assert.equal(needsOwner([pull(extra)], { state: 'working' }), false, `${JSON.stringify(extra)}: the session is on it`);
  }
  assert.equal(needsOwner([pull({ checks: 'running' })], { state: 'idle' }), false);
  assert.equal(needsOwner([pull({ requested: 1 })], { state: 'idle' }), false);
  assert.equal(needsOwner([pull({ state: 'merged', review: 'approved', clean: true })], { state: 'idle' }), false);
  assert.equal(needsOwner([pull({ state: 'closed', checks: 'failing' })], { state: 'idle' }), false);
});

test('a pull request that is not the owner\'s and was not asked of them never waits on them', () => {
  for (const extra of [{ review: 'changes' }, { conflicts: true }, { threads: 2 }, { checks: 'failing' }, { review: 'approved', clean: true }]) {
    assert.equal(needsOwner([pull({ ...extra, mine: false })], { state: 'idle' }), false, JSON.stringify(extra));
  }
});

test('a session waits on the owner when any of its pull requests does, and one with none, or none known, does not', () => {
  const fine = pull({ checks: 'running' });
  assert.equal(needsOwner([fine, pull({ asked: true, mine: false })], { state: 'idle' }), true);
  assert.equal(needsOwner([fine, pull({ checks: 'passing' })], { state: 'idle' }), false);
  assert.equal(needsOwner([], { state: 'idle' }), false);
  assert.equal(needsOwner(undefined, { state: 'idle' }), false);
  assert.equal(needsOwner([pull({ checks: 'failing' })], undefined), true, 'a row that is not known is not working');
});

test('needsOf names the sessions in a list that wait on the owner, from what the page heard', () => {
  const rows = [{ id: 'a', state: 'idle' }, { id: 'b', state: 'working' }, { id: 'c', state: 'idle' }, { id: 'd', state: 'idle' }];
  const known = new Map([
    ['a', { pulls: [pull({ checks: 'failing' })] }],
    ['b', { pulls: [pull({ checks: 'failing' })] }],
    ['c', { pulls: [] }],
  ]);
  assert.deepEqual([...needsOf(rows, known)], ['a']);
  assert.deepEqual([...needsOf(rows, new Map())], []);
});

const row = (id, ago = 1000, state = 'idle') => ({ id, state, lastActivityAt: NOW - ago });

test('a session is asked about when nothing is known of it, it moved, the answer is over a minute old, or the answer was unfinished', () => {
  const quiet = row('a');
  const fresh = { stamp: stampOf(quiet), at: NOW - 1000, pulls: [] };
  assert.equal(wantsPulls(quiet, new Map(), NOW), true);
  assert.equal(wantsPulls(quiet, new Map([['a', fresh]]), NOW), false);
  assert.equal(wantsPulls(quiet, new Map([['a', { ...fresh, at: NOW - FRESH_MS }]]), NOW), false, 'a minute to the millisecond is not over a minute');
  assert.equal(wantsPulls(quiet, new Map([['a', { ...fresh, at: NOW - FRESH_MS - 1 }]]), NOW), true);
  assert.equal(wantsPulls({ ...quiet, lastActivityAt: quiet.lastActivityAt + 1 }, new Map([['a', fresh]]), NOW), true, 'it moved');
  assert.equal(wantsPulls({ ...quiet, state: 'working' }, new Map([['a', fresh]]), NOW), true, 'it changed state');
  assert.equal(wantsPulls(quiet, new Map([['a', { ...fresh, settling: true }]]), NOW), true);
  assert.equal(wantsPulls(quiet, new Map([['a', { ...fresh, settling: false }]]), NOW), false);
});

test('pullsToAsk lists each stale id once, in the order of the rows', () => {
  const [a, b, c] = [row('a'), row('b'), row('c')];
  const known = new Map([['b', { stamp: stampOf(b), at: NOW, pulls: [] }]]);
  assert.deepEqual(pullsToAsk([a, b, c, a], known, NOW), ['a', 'c']);
  assert.deepEqual(pullsToAsk([], known, NOW), []);
});

const index = (extra = []) => ({
  features: { subStatus: true, pullStatus: true },
  pinned: [], routines: [], started: [], other: [],
  groups: [{ id: 'cg-work', name: 'Work', session: { id: 'chat-of-work' }, sessions: [{ id: 'w1', via: null, ...row('w1', 10), children: [{ ...row('w1a', 20), via: 'w1' }] }, { ...row('w2', 5), archived: true }] }],
  ungrouped: [{ ...row('top', 0), via: null, children: [{ ...row('kid', 30), via: 'top' }, { ...row('grand', 10), via: 'kid' }, { ...row('gone', 1), via: 'top', archived: true }, ...extra] }, { ...row('loner', 2), via: null }],
});

test('the sessions to ask about are every live one below the chat at any depth or in the group, the most recently active first', () => {
  assert.deepEqual(scopeOf(index(), 'top').map(r => r.id), ['grand', 'kid']);
  assert.deepEqual(scopeOf(index(), 'chat-of-work').map(r => r.id), ['w1', 'w1a']);
  assert.deepEqual(scopeOf(index(), 'loner'), []);
});

test('no more than the 120 most recently active sessions are asked about', () => {
  const many = Array.from({ length: 150 }, (_, n) => ({ ...row(`s${n}`, 100 + n), via: 'top' }));
  const found = scopeOf(index(many), 'top');
  assert.equal(found.length, 120);
  assert.equal(found.some(r => r.id === 's0'), true);
  assert.equal(found.some(r => r.id === 's149'), false, 'the least recent are left out');
  assert.equal(scopeOf(index(many), 'top', 5).length, 5);
});
