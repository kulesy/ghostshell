// Run with `npm test`. What a session's pull requests say on its card and when they put the session in the owner's court, with no page: the
// status line of a pull request, its words, tone and who it waits on, the session's main pull request, and which sessions to ask about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRESH_MS, mainPull, needsOf, needsOwner, pullsToAsk, scopeOf, statusOf, wantsPulls } from '../public/ui/pull-rules.js';
import { stampOf } from '../public/ui/sub-panel-rules.js';

const NOW = Date.parse('2026-10-26T01:00:00.000Z');
const url = n => `https://github.com/example-org/example-repo/pull/${n}`;

const pull = (extra = {}) => ({
  url: url(12), repo: 'example-org/example-repo', number: 12, state: 'open', mine: true, asked: false, requested: 0,
  review: 'none', checks: 'none', conflicts: false, clean: false, threads: 0, ...extra,
});
const idle = { state: 'idle' };
const working = { state: 'working' };
const READY = { review: 'approved', clean: true, checks: 'passing' };
const line = (extra, row = idle) => statusOf(pull(extra), row);

test('each rule says what the owner has to do, or who the session waits on, with its tone', () => {
  const cases = [
    [{ state: 'merged' }, idle, false, 'Merged, nothing to do', 'ready'],
    [{ state: 'closed' }, idle, false, 'Closed, nothing to do', 'quiet'],
    [{ asked: true, mine: false }, idle, true, 'Review the pull request', 'needs'],
    [READY, idle, true, 'Merge the pull request', 'needs'],
    [{ review: 'changes' }, idle, true, 'Ask the session to deal with the requested changes', 'needs'],
    [{ conflicts: true }, idle, true, 'Ask the session to deal with the conflicts', 'needs'],
    [{ threads: 3 }, idle, true, 'Ask the session to deal with the 3 unresolved comments', 'needs'],
    [{ checks: 'failing' }, idle, true, 'Ask the session to deal with the failing checks', 'error'],
    [{ checks: 'failing' }, working, false, 'The session is dealing with the failing checks', 'working'],
    [{ checks: 'running' }, idle, false, 'Waiting on checks to finish', 'working'],
    [{ review: 'approved' }, idle, false, 'Approved, but it cannot merge yet', 'quiet'],
    [{ ...READY, mine: false }, idle, false, 'Approved, nothing asked of you', 'quiet'],
    [{ checks: 'failing' }, { state: 'active' }, false, 'The session is dealing with the failing checks', 'working'],
    [{ requested: 1 }, idle, false, 'Waiting on a reviewer', 'quiet'],
    [{ review: 'required' }, idle, false, 'Waiting on a reviewer', 'quiet'],
    [{ state: 'draft' }, idle, false, 'Still a draft', 'quiet'],
    [{}, idle, false, 'Open, no review asked for yet', 'quiet'],
    [{ mine: false }, idle, false, 'Open, nothing asked of you', 'quiet'],
  ];
  for (const [extra, row, you, text, tone] of cases) assert.deepEqual(line(extra, row), { you, text, tone }, text);
});

test('the work to do is listed in a fixed order, joined with commas and an and, and a single comment reads in the singular', () => {
  const all = { review: 'changes', conflicts: true, threads: 2, checks: 'failing' };
  assert.equal(line(all).text, 'Ask the session to deal with the requested changes, the conflicts, the 2 unresolved comments and the failing checks');
  assert.equal(line({ conflicts: true, checks: 'failing' }).text, 'Ask the session to deal with the conflicts and the failing checks');
  assert.equal(line({ review: 'changes', threads: 1 }).text, 'Ask the session to deal with the requested changes and the 1 unresolved comment');
  assert.equal(line({ threads: 1 }).text, 'Ask the session to deal with the 1 unresolved comment');
  assert.equal(line({ threads: null }).text, 'Open, no review asked for yet', 'comments that could not be counted say nothing');
  assert.equal(line({ threads: 0 }).text, 'Open, no review asked for yet');
});

test('the tone is error only when checks are failing, whatever else is listed', () => {
  assert.equal(line({ conflicts: true, threads: 1 }).tone, 'needs');
  assert.equal(line({ conflicts: true, checks: 'failing' }).tone, 'error');
  assert.equal(line({ review: 'changes', checks: 'failing' }, working).tone, 'working');
});

test('a working or active session is dealing with the work itself, and a session waiting for an approval or idle is not', () => {
  const all = { review: 'changes', conflicts: true };
  assert.deepEqual(line(all, working), { you: false, text: 'The session is dealing with the requested changes and the conflicts', tone: 'working' });
  assert.deepEqual(line(all, { state: 'active' }), line(all, working));
  for (const state of ['idle', 'waiting']) assert.equal(line(all, { state }).you, true, state);
  assert.equal(statusOf(pull(all), undefined).you, true, 'a row that is not known is not working');
});

test('the rules are tried in order, the first that fits winning', () => {
  const all = { asked: true, mine: true, ...READY, review: 'changes', conflicts: true, threads: 2, checks: 'failing', requested: 1, state: 'draft' };
  assert.equal(line({ ...all, state: 'merged' }).text, 'Merged, nothing to do');
  assert.equal(line({ ...all, state: 'closed' }).text, 'Closed, nothing to do');
  assert.equal(line(all).text, 'Review the pull request', 'a review asked of the owner beats all that follows');
  assert.equal(line({ ...all, asked: false }).text.startsWith('Ask the session to deal with'), true);
  assert.equal(line({ ...READY, requested: 1, state: 'draft' }).text, 'Approved, but it cannot merge yet', 'a draft cannot be merged');
  assert.equal(line({ ...READY, checks: 'running' }).text, 'Waiting on checks to finish', 'running checks come before an approval that cannot merge yet');
  assert.equal(line({ requested: 1, state: 'draft' }).text, 'Waiting on a reviewer');
  assert.equal(line({ checks: 'running', requested: 1 }).text, 'Waiting on checks to finish');
});

test('merge it needs an open pull request of the owner that is approved, clean and has no checks failing or running', () => {
  assert.equal(line(READY).text, 'Merge the pull request');
  assert.equal(line({ ...READY, checks: 'none' }).text, 'Merge the pull request');
  assert.equal(line({ ...READY, clean: false }).text, 'Approved, but it cannot merge yet');
  assert.equal(line({ ...READY, checks: 'failing' }).text, 'Ask the session to deal with the failing checks');
  assert.equal(line({ ...READY, mine: false }).text, 'Approved, nothing asked of you', 'only the owner is told to merge their own');
  assert.equal(line({ ...READY, mine: false, clean: false }).text, 'Approved, but it cannot merge yet');
  assert.equal(line({ ...READY, mine: false, state: 'draft' }).text, 'Approved, but it cannot merge yet');
  assert.equal(line(READY, working).you, true, 'only the owner can merge');
});

test('work on a pull request that is not the owner\'s is not theirs to ask for', () => {
  for (const extra of [{ review: 'changes' }, { conflicts: true }, { threads: 2 }, { checks: 'failing' }]) {
    assert.deepEqual(line({ ...extra, mine: false }), { you: false, text: 'Open, nothing asked of you', tone: 'quiet' }, JSON.stringify(extra));
  }
});

test('a viewer who is not known is never told what is asked of them, and gets the plain facts', () => {
  const unknown = extra => line({ mine: null, asked: null, ...extra });
  const cases = [
    [READY, 'Approved'],
    [{ ...READY, clean: false }, 'Approved, but it cannot merge yet'],
    [{ review: 'changes' }, 'Open'],
    [{ conflicts: true, threads: 2, checks: 'failing' }, 'Open'],
    [{ requested: 1 }, 'Waiting on a reviewer'],
    [{ review: 'required' }, 'Waiting on a reviewer'],
    [{ checks: 'running' }, 'Waiting on checks to finish'],
    [{ state: 'draft' }, 'Still a draft'],
    [{}, 'Open'],
    [{ state: 'merged' }, 'Merged, nothing to do'],
  ];
  for (const [extra, text] of cases) assert.deepEqual([unknown(extra).text, unknown(extra).you], [text, false], text);
  for (const extra of [{}, READY, { review: 'changes' }, { checks: 'failing' }]) assert.equal(/nothing asked of you/.test(unknown(extra).text), false);
  assert.equal(needsOwner([pull({ mine: null, asked: null, checks: 'failing' })], idle), false);
});

test('the main pull request is the first of the list that the page may link to', () => {
  const list = [pull({ url: 'javascript:alert(1)' }), pull({ url: 'https://github.com.evil.example/o/r/pull/3' }), null, pull({ url: url(2) }), pull({ url: url(1) })];
  assert.equal(mainPull(list).url, url(2));
  assert.equal(mainPull([pull({ url: 'javascript:alert(1)' })]), null);
  assert.equal(mainPull([pull({ url: url(1) + '/files' })]), null);
  assert.equal(mainPull([]), null);
  assert.equal(mainPull(undefined), null);
  assert.equal(mainPull('nothing'), null);
});

test('a review asked of the owner always waits on them, for a draft too, and merged and closed never do', () => {
  const asked = { asked: true, mine: false };
  for (const state of ['working', 'idle', 'waiting', 'active']) assert.equal(needsOwner([pull({ ...asked })], { state }), true, state);
  assert.equal(needsOwner([pull({ ...asked, state: 'draft' })], { state: 'working' }), true);
  assert.equal(needsOwner([pull({ ...asked, state: 'merged' })], { state: 'idle' }), false);
  assert.equal(needsOwner([pull({ ...asked, state: 'closed' })], { state: 'idle' }), false);
});

test('needsOwner agrees with the line for every kind of pull request and either state of the session', () => {
  const kinds = [
    {}, { mine: false }, { asked: true, mine: false }, READY, { ...READY, state: 'draft' }, { review: 'changes' }, { conflicts: true }, { threads: 2 },
    { checks: 'failing' }, { checks: 'running' }, { review: 'approved' }, { ...READY, mine: false }, { mine: null, asked: null, ...READY }, { mine: null, asked: null, checks: 'failing' }, { requested: 1 }, { review: 'required' }, { state: 'draft' }, { state: 'merged' },
    { state: 'closed', checks: 'failing' }, { mine: false, checks: 'failing' }, { review: 'changes', mine: false, state: 'draft' },
  ];
  for (const extra of kinds) for (const row of [idle, working, { state: 'active' }, { state: 'waiting' }]) assert.equal(needsOwner([pull(extra)], row), statusOf(pull(extra), row).you, JSON.stringify([extra, row.state]));
  assert.equal(needsOwner([pull({ checks: 'failing' })], idle), true);
  assert.equal(needsOwner([pull({ checks: 'failing' })], working), false, 'the session is on it');
  assert.equal(needsOwner([pull({ checks: 'running' })], idle), false);
  assert.equal(needsOwner([pull({ requested: 1 })], idle), false);
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
