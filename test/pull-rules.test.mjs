// Run with `npm test`. What a session's pull requests say on its card and when they put the session in the owner's court, with no page: the
// status line of a pull request, its words, tone and who it waits on, the pull request a card speaks of, the badge of each kind of item, and which
// sessions to ask about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeOf, FRESH_MS, issueWord, itemsOf, leadPull, needsOf, needsOwner, pullsToAsk, scopeOf, statusOf, wantsPulls } from '../public/ui/pull-rules.js';
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
    [{ state: 'merged' }, idle, false, 'Merged, nothing to do', 'ready', 'Merged'],
    [{ state: 'closed' }, idle, false, 'Closed, nothing to do', 'quiet', 'Closed'],
    [{ asked: true, mine: false }, idle, true, 'Review the pull request', 'needs', 'Review asked'],
    [READY, idle, true, 'Merge the pull request', 'needs', 'Ready to merge'],
    [{ review: 'changes' }, idle, true, 'Ask the session to deal with the requested changes', 'needs', 'Changes asked'],
    [{ conflicts: true }, idle, true, 'Ask the session to deal with the conflicts', 'needs', 'Conflicts'],
    [{ threads: 3 }, idle, true, 'Ask the session to deal with the 3 unresolved comments', 'needs', 'Comments'],
    [{ checks: 'failing' }, idle, true, 'Ask the session to deal with the failing checks', 'error', 'Checks failing'],
    [{ checks: 'failing' }, working, false, 'The session is dealing with the failing checks', 'working', 'Checks failing'],
    [{ checks: 'running' }, idle, false, 'Waiting on checks to finish', 'working', 'Checks running'],
    [{ review: 'approved' }, idle, false, 'Approved, but it cannot merge yet', 'quiet', 'Approved'],
    [{ ...READY, mine: false }, idle, false, 'Approved, nothing asked of you', 'quiet', 'Approved'],
    [{ checks: 'failing' }, { state: 'active' }, false, 'The session is dealing with the failing checks', 'working', 'Checks failing'],
    [{ requested: 1 }, idle, false, 'Waiting on a reviewer', 'quiet', 'In review'],
    [{ review: 'required' }, idle, false, 'Waiting on a reviewer', 'quiet', 'In review'],
    [{ state: 'draft' }, idle, false, 'Still a draft', 'quiet', 'Draft'],
    [{}, idle, false, 'Open, no review asked for yet', 'quiet', 'Open'],
    [{ mine: false }, idle, false, 'Open, nothing asked of you', 'quiet', 'Open'],
  ];
  for (const [extra, row, you, text, tone, word] of cases) assert.deepEqual(line(extra, row), { you, text, tone, word }, text);
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
  assert.deepEqual(line(all, working), { you: false, text: 'The session is dealing with the requested changes and the conflicts', tone: 'working', word: 'Changes asked' });
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
    assert.deepEqual(line({ ...extra, mine: false }), { you: false, text: 'Open, nothing asked of you', tone: 'quiet', word: 'Open' }, JSON.stringify(extra));
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

test('the word of a pull request is the first thing to do from the sentence\'s list, and a viewer who is not known gets the plain words', () => {
  const all = { review: 'changes', conflicts: true, threads: 2, checks: 'failing' };
  assert.equal(line(all).word, 'Changes asked');
  assert.equal(line({ ...all, review: 'none' }).word, 'Conflicts');
  assert.equal(line({ ...all, review: 'none', conflicts: false }).word, 'Comments');
  assert.equal(line({ ...all, asked: true, mine: false }).word, 'Review asked');
  assert.equal(line({ mine: null, asked: null, ...READY }).word, 'Approved');
});

const issue = (extra = {}) => ({ url: 'https://github.com/example-org/example-repo/issues/5', kind: 'issue', repo: 'example-org/example-repo', number: 5, title: 'Something is broken', state: 'open', attached: false, ...extra });

test('the items the page may link to are the pull requests and issues at their plain address, whatever else a list holds', () => {
  const list = [pull({ url: 'javascript:alert(1)' }), pull({ url: 'https://github.com.evil.example/o/r/pull/3' }), null, pull({ url: url(2) }), issue(), pull({ url: url(1) + '/files' }), issue({ url: 'https://github.com/o/r/issues/5/x' })];
  assert.deepEqual(itemsOf(list).map(item => item.url), [url(2), issue().url]);
  for (const nothing of [[], undefined, 'nothing', null]) assert.deepEqual(itemsOf(nothing), []);
});

test('a card speaks of the first pull request that waits on the owner, else the first pull request, and never of an issue or an item that could not be read', () => {
  const quiet = pull({ url: url(1), mine: false });
  const asked = pull({ url: url(2), asked: true, mine: false });
  const later = pull({ url: url(3), ...READY });
  assert.equal(leadPull([quiet, asked, later], idle).url, url(2));
  assert.equal(leadPull([quiet, later, asked], idle).url, url(3));
  assert.equal(leadPull([quiet, pull({ url: url(4), mine: false })], idle).url, url(1));
  assert.equal(leadPull([pull({ url: url(5), checks: 'failing' }), asked], working).url, url(2), 'work the session is doing is not waiting on the owner');
  assert.equal(leadPull([issue(), quiet], idle).url, url(1), 'an issue is skipped');
  assert.equal(leadPull([issue(), pull({ url: url(6), state: 'unknown', attached: true })], idle), null);
  assert.equal(leadPull([pull({ url: 'javascript:alert(1)' })], idle), null);
  assert.equal(leadPull([], idle), null);
  assert.equal(leadPull(undefined, idle), null);
});

test('an issue or an item that could not be read never puts a session in the owner\'s court', () => {
  const waiting = pull({ url: url(1), asked: true, mine: false });
  assert.equal(needsOwner([issue(), pull({ url: url(2), state: 'unknown', asked: true, attached: true })], idle), false);
  assert.equal(needsOwner([issue(), waiting], idle), true);
  assert.equal(needsOwner([issue({ state: 'completed' }), issue({ state: 'not_planned' })], idle), false);
  assert.equal(needsOwner(undefined, idle), false);
});

test('an issue reads Open, Done or Not planned, and an item that could not be read reads Can\'t read', () => {
  assert.deepEqual([issueWord(issue()), issueWord(issue({ state: 'completed' })), issueWord(issue({ state: 'not_planned' }))], [['Open', 'quiet'], ['Done', 'ready'], ['Not planned', 'quiet']]);
  assert.deepEqual([issueWord(issue({ state: 'unknown' })), issueWord(issue({ state: 'what' })), issueWord(undefined)], [["Can't read", 'error'], ["Can't read", 'error'], ["Can't read", 'error']]);
});

test('a badge names the item by repo and number, with the status word, tone, title, sentence and address a screen reader and a tooltip give', () => {
  const merge = badgeOf(pull({ url: url(12), title: 'Fix the thing', ...READY, attached: true }), idle);
  assert.deepEqual({ ...merge, name: undefined, tip: undefined }, {
    kind: 'pull', label: 'Pull request', word: 'Ready to merge', tone: 'needs', title: 'Fix the thing', sentence: 'Merge the pull request', url: url(12), ref: 'example-repo#12', attached: true, name: undefined, tip: undefined,
  });
  assert.equal(merge.name, `Pull request example-repo#12. Ready to merge. Fix the thing. Merge the pull request. ${url(12)}`);
  assert.equal(merge.tip, `Fix the thing. Merge the pull request. ${url(12)}`);
  const done = badgeOf(issue({ state: 'completed' }), idle);
  assert.deepEqual([done.kind, done.label, done.word, done.tone, done.sentence, done.ref, done.attached], ['issue', 'Issue', 'Done', 'ready', '', 'example-repo#5', false]);
  assert.equal(done.name, `Issue example-repo#5. Done. Something is broken. ${issue().url}`);
  const lost = badgeOf({ url: issue().url, kind: 'issue', repo: 'example-org/example-repo', number: 5, state: 'unknown', attached: true }, idle);
  assert.deepEqual([lost.word, lost.tone, lost.title, lost.sentence, lost.name], ["Can't read", 'error', '', '', `Issue example-repo#5. Can't read. ${issue().url}`]);
  const lostPull = badgeOf({ url: url(9), state: 'unknown', attached: true }, idle);
  assert.deepEqual([lostPull.word, lostPull.label, lostPull.sentence], ["Can't read", 'Pull request', '']);
  assert.equal(badgeOf(pull({ url: url(12), checks: 'failing' }), working).word, 'Checks failing', 'the word does not change with what the session is doing');
  assert.equal(badgeOf(pull({ url: url(12), checks: 'failing' }), working).sentence, 'The session is dealing with the failing checks');
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
