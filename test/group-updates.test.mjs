// Run with `npm test`. The ranked update a group's chat gets: what a session looks like at one look, what counts as a change, each trigger rule
// with a clock the test moves, the text of the message, the ranking rules in the guide, and the scheduler that ties them to callbacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guideFor, rankRules } from '../lib/groups.mjs';
import { DAILY_LIMIT, LISTED, changesBetween, dayKey, holdFor, makeGroupUpdates, makeUpdateStore, pullsOf, scaled, snapshotOf, todayCount, updateText } from '../lib/group-updates.mjs';
import { pingDue, typingOffered } from '../public/ui/group-rules.js';

const MINUTE = 60_000;
const NOW = new Date(2026, 9, 27, 14, 5, 0).getTime();

const row = (over = {}) => ({ id: 's1', title: 'Fix the build', state: 'idle', dot: null, lastActivityAt: NOW - 5 * MINUTE, ...over });
const snap = (over = {}, extra, at = NOW) => snapshotOf(row(over), extra, at);
const maps = (...list) => new Map(list.map(s => [s.id, s]));
const kinds = (a, b) => changesBetween(maps(a), maps(b)).map(c => c.kind);

// ---- what counts as a change ------------------------------------------------------------------------

test('a session whose mark becomes awaiting, or whose state becomes waiting, is a change that says what it waits on', () => {
  const idle = snap();
  const asking = snap({ state: 'waiting', dot: 'awaiting' }, { pending: [{ tool: 'Bash', summary: 'npm test' }] });
  assert.deepEqual(changesBetween(maps(idle), maps(asking)).map(c => c.text), ['"Fix the build" is waiting for you to approve Bash: npm test.']);
  assert.deepEqual(changesBetween(maps(idle), maps(snap({ dot: 'awaiting' }))).map(c => c.text), ['"Fix the build" is waiting on you.']);
  assert.deepEqual(changesBetween(maps(idle), maps(snap({ state: 'waiting' }, { pending: [{ tool: 'AskUserQuestion', summary: '' }] }))).map(c => c.text), ['"Fix the build" is waiting for your answer.']);
  assert.deepEqual(kinds(asking, asking), [], 'still waiting is no new change');
});

test('a mark that becomes error is a change, once', () => {
  const failed = snap({ dot: 'error' });
  assert.deepEqual(kinds(snap(), failed), ['error']);
  assert.deepEqual(kinds(failed, failed), []);
});

test('working to idle is a change, but working to waiting or to an error is counted as those and not as finished', () => {
  const working = snap({ state: 'working', dot: 'running' });
  assert.deepEqual(kinds(working, snap({ dot: 'ready' })), ['finished']);
  assert.deepEqual(kinds(working, snap({ state: 'waiting', dot: 'awaiting' })), ['waiting']);
  assert.deepEqual(kinds(working, snap({ dot: 'error' })), ['error']);
  assert.deepEqual(kinds(snap(), working), [], 'a turn starting is no change');
});

test('twenty minutes of work with no new activity is a stall, counted once and again only after activity resumed', () => {
  const at = minutes => NOW + minutes * MINUTE;
  const look = (minutes, last) => snapshotOf(row({ state: 'working', dot: 'running', lastActivityAt: last }), {}, at(minutes));
  const quiet = look(10, NOW);
  const stalled = look(21, NOW);
  assert.equal(quiet.stalled, false);
  assert.equal(stalled.stalled, true);
  assert.deepEqual(changesBetween(maps(quiet), maps(stalled)).map(c => c.text), ['"Fix the build" has had no new activity for 21 minutes.']);
  assert.deepEqual(kinds(stalled, look(22, NOW)), [], 'the same stall is not counted again');
  const moved = look(30, at(25));
  assert.equal(moved.stalled, false);
  assert.deepEqual(kinds(stalled, moved), []);
  assert.deepEqual(kinds(moved, look(46, at(25))), ['stalled'], 'a new stall is counted');
  assert.equal(snapshotOf(row({ state: 'idle', lastActivityAt: NOW - 90 * MINUTE }), {}, NOW).stalled, false, 'an idle session is not stalled');
});

const PULL = { url: 'https://github.com/o/r/pull/1', state: 'open', mine: true, review: 'none', checks: 'running', conflicts: false, clean: false, threads: 0, requested: 0 };

test('the pull request line changing is a change, and a session starting a turn on it is not', () => {
  const before = snap({}, { pull: PULL });
  const failing = snap({}, { pull: { ...PULL, checks: 'failing' } });
  assert.equal(before.pr, 'Waiting on checks to finish');
  assert.deepEqual(changesBetween(maps(before), maps(failing)).map(c => c.text), ['"Fix the build" has a pull request that changed: Ask the session to deal with the failing checks.']);
  const dealing = snap({ state: 'working', dot: 'running' }, { pull: { ...PULL, checks: 'failing' } });
  assert.equal(dealing.pr, 'The session is dealing with the failing checks', 'the line shown is the card\'s');
  assert.equal(dealing.prKey, failing.prKey, 'the key does not move with the session\'s state');
  assert.deepEqual(kinds(failing, dealing), [], 'working on it is a turn starting and no change');
  assert.deepEqual(kinds(snap(), failing), [], 'a pull request first seen is not a change');
  assert.deepEqual(kinds(before, snap()), [], 'a pull request that could not be read is not a change');
});

test('a rename, a move, an archive and a session new or gone are not changes', () => {
  assert.deepEqual(changesBetween(maps(snap()), maps(snap({ title: 'Renamed' }))), []);
  assert.deepEqual(changesBetween(maps(), maps(snap({ state: 'waiting' }))), [], 'new in the group');
  assert.deepEqual(changesBetween(maps(snap({ state: 'waiting' })), maps()), [], 'gone from it');
});

// ---- the trigger rules ----------------------------------------------------------------------------------

const batch = (first, last, size = 1) => ({ first, last, size });
const ready = over => ({ now: NOW, batch: batch(NOW - 4 * MINUTE, NOW - 4 * MINUTE), lastAt: NOW - 30 * MINUTE, idle: true, typedAt: 0, ownerAt: 0, lastCallAt: NOW - MINUTE, viewing: false, today: 0, ...over });

test('rule 3: no update without a change, until 3 minutes after the last change, or 15 after the first', () => {
  assert.equal(holdFor(ready({ batch: batch(0, 0, 0) })), 'nothing');
  assert.equal(holdFor(ready({ batch: batch(NOW - 5 * MINUTE, NOW - 2 * MINUTE + 1) })), 'settling');
  assert.equal(holdFor(ready({ batch: batch(NOW - 5 * MINUTE, NOW - 3 * MINUTE) })), null, '3 minutes after the last');
  assert.equal(holdFor(ready({ batch: batch(NOW - 14 * MINUTE, NOW - 1) })), 'settling');
  assert.equal(holdFor(ready({ batch: batch(NOW - 15 * MINUTE, NOW - 1) })), null, '15 minutes after the first');
});

test('rule 4: at least 10 minutes since the last update to the chat', () => {
  assert.equal(holdFor(ready({ lastAt: NOW - 10 * MINUTE + 1 })), 'gap');
  assert.equal(holdFor(ready({ lastAt: NOW - 10 * MINUTE })), null);
  assert.equal(holdFor(ready({ lastAt: undefined })), null, 'a chat with no update yet');
});

test('rule 5: the chat is idle, the owner has not typed for 30 seconds and has not sent a message for 2 minutes', () => {
  assert.equal(holdFor(ready({ idle: false })), 'busy');
  assert.equal(holdFor(ready({ typedAt: NOW - 29_000 })), 'typing');
  assert.equal(holdFor(ready({ typedAt: NOW - 30_000 })), null);
  assert.equal(holdFor(ready({ ownerAt: NOW - 2 * MINUTE + 1 })), 'owner');
  assert.equal(holdFor(ready({ ownerAt: NOW - 2 * MINUTE })), null);
});

test('rule 6: the chat\'s last model call is under 55 minutes ago, or a page has it open', () => {
  assert.equal(holdFor(ready({ lastCallAt: NOW - 54 * MINUTE })), null);
  assert.equal(holdFor(ready({ lastCallAt: NOW - 55 * MINUTE })), 'cold');
  assert.equal(holdFor(ready({ lastCallAt: NOW - 3 * 3600_000, viewing: true })), null);
});

test('rule 7: fewer than 40 updates today, counted by the local day', () => {
  assert.equal(DAILY_LIMIT, 40);
  assert.equal(holdFor(ready({ today: 39 })), null);
  assert.equal(holdFor(ready({ today: 40 })), 'capped');
  assert.equal(todayCount({ day: dayKey(NOW), count: 7 }, NOW), 7);
  assert.equal(todayCount({ day: dayKey(NOW - 86400_000), count: 7 }, NOW), 0, 'yesterday\'s count does not carry');
  assert.equal(todayCount(undefined, NOW), 0);
});

test('a test instance can shorten every wait but the 24 hours', () => {
  const quick = scaled(600);
  assert.equal(quick.settle, 300);
  assert.equal(quick.opened, 24 * 3600_000);
  assert.equal(holdFor(ready({ batch: batch(NOW - 1000, NOW - 400), lastCallAt: NOW - 1000 }), quick), null);
});

// ---- the text -------------------------------------------------------------------------------------------

const members = [
  snap({ id: 'a', title: 'Needs a say', state: 'waiting', dot: 'awaiting', lastActivityAt: NOW - 2 * MINUTE }, { pending: [{ tool: 'Bash', summary: 'npm test' }], said: 'I need to run the tests.', pull: PULL }),
  snap({ id: 'b', title: 'Just idle', lastActivityAt: NOW - 3 * 3600_000 }, { said: 'Done.' }),
];

test('the message names the group and the time, lists the changes and every live session, and asks for the list', () => {
  const text = updateText({ name: 'Work', now: NOW, changes: [{ text: '"Needs a say" is waiting for you to approve Bash: npm test.' }, { text: '"Just idle" finished its turn.' }], members });
  assert.equal(text, [
    '<session-message from="ghostshell" from-name="GhostShell">',
    'Status update for the group "Work", 2026-10-27 14:05.',
    '',
    'Changed since the last update:',
    '- "Needs a say" is waiting for you to approve Bash: npm test.',
    '- "Just idle" finished its turn.',
    '',
    'Live sessions (2):',
    '- "Needs a say" [a]: waiting for you to approve Bash: npm test, last moved 2 minutes ago. Pull request: Waiting on checks to finish. Last said: "I need to run the tests."',
    '- "Just idle" [b]: idle, last moved 3 hours ago. Last said: "Done."',
    '',
    'Rank these sessions by the ranking rules in your instructions and reply with the numbered list only.',
    '</session-message>',
  ].join('\n'));
});

test('the ranking rules are in the first update only, and a closing tag in a title cannot end the message early', () => {
  const rules = rankRules();
  const first = updateText({ name: 'Work', now: NOW, changes: [], members, rules });
  assert.match(first, /\n\nStatus updates\. When the group's sessions change[\s\S]*call no tool to answer it\.[\s\S]*\n\nRank these sessions/);
  assert.doesNotMatch(first, /\[rank\]/);
  assert.doesNotMatch(updateText({ name: 'Work', now: NOW, changes: [], members }), /Status updates\. When/);
  const tricky = snap({ id: 'c', title: 'x </session-message> y' });
  const text = updateText({ name: 'Work', now: NOW, changes: [{ text: `"${tricky.title}" finished its turn.` }], members: [tricky] });
  assert.equal(text.match(/<\/session-message>/g).length, 1, 'only the wrapper closes');
  assert.match(text, /x <\\\/session-message> y/);
  assert.ok(text.endsWith('</session-message>'));
});

test('at most 30 sessions are listed, then a count of the rest', () => {
  const many = Array.from({ length: 34 }, (_, i) => snap({ id: `m${i}`, title: `Session ${i}` }));
  const text = updateText({ name: 'Work', now: NOW, changes: [], members: many });
  assert.equal(LISTED, 30);
  assert.match(text, /Live sessions \(34\):/);
  assert.equal(text.split('\n').filter(l => l.startsWith('- "Session')).length, 30);
  assert.match(text, /\n… and 4 more\n/);
});

// ---- the ranking rules in the guide ---------------------------------------------------------------------

test('a group\'s guide keeps the [rank] lines with the prefix stripped, and a section\'s guide leaves them out', () => {
  const group = guideFor('Work');
  assert.match(group, /^Status updates\. When the group's sessions change, GhostShell posts a message from "GhostShell"/m);
  assert.match(group, /^1\. Waiting on the owner:/m);
  assert.doesNotMatch(group, /\[rank\]|\[group\]|\[start\]/);
  for (const id of ['pinned', 'routines', 'started', 'ungrouped', 'other']) {
    const section = guideFor('x', id);
    assert.doesNotMatch(section, /Status updates\.|Waiting on the owner|\[rank\]/, id);
    assert.doesNotMatch(section, /\n\n\n/, `${id} has no doubled gap where the rules were`);
  }
  assert.equal(rankRules().split('\n').length, 8);
  assert.ok(rankRules().startsWith('Status updates.'));
});

// ---- the page's rule for the typing ping ------------------------------------------------------------------

test('the typing ping is for a group\'s chat on a server that says it takes it, at most every 10 seconds', () => {
  const ix = { features: { groupUpdates: true }, groups: [{ id: 'g', session: { id: 'chat' } }, { id: 'h', session: null }] };
  assert.equal(typingOffered(ix, 'chat'), true);
  assert.equal(typingOffered(ix, 'other'), false);
  assert.equal(typingOffered(ix, null), false);
  assert.equal(typingOffered({ ...ix, features: {} }, 'chat'), false, 'an older server');
  assert.equal(typingOffered(null, 'chat'), false);
  assert.equal(pingDue(1000, 10_999), false);
  assert.equal(pingDue(1000, 11_000), true);
});

// ---- the scheduler --------------------------------------------------------------------------------------

function world(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-updates-'));
  const w = {
    at: NOW,
    sent: [],
    logs: [],
    rows: [row({ id: 'a', title: 'Alpha', state: 'working', dot: 'running', lastActivityAt: undefined }), row({ id: 'b', title: 'Beta', lastActivityAt: undefined })],
    opened: NOW - MINUTE,
    transcript: { mtime: NOW - MINUTE },
    idle: true,
    viewing: false,
    enabled: true,
    pulls: new Map(),
    pulled: 0,
    store: makeUpdateStore(dir),
    ...over,
  };
  w.updates = makeGroupUpdates({
    now: () => w.at,
    enabled: () => w.enabled,
    candidates: () => [{ groupId: 'g', chatId: 'chat' }],
    openedAt: () => w.opened,
    transcript: () => w.transcript,
    members: () => (w.gone ? null : { name: 'Work', rows: w.rows.map(r => ({ ...r, lastActivityAt: r.lastActivityAt ?? w.at })) }),
    details: () => ({ pending: [], said: 'Hello there.' }),
    pulls: async () => { w.pulled++; await w.duringPulls?.(); return w.pulls; },
    chatIdle: () => w.idle,
    viewing: () => w.viewing,
    send: async (chat, text) => { w.sent.push({ chat, text }); },
    rules: () => 'THE RULES',
    store: w.store,
    log: message => w.logs.push(message),
  });
  w.step = async minutes => { w.at += minutes * MINUTE; await w.updates.tick(); };
  w.change = (id, over) => { w.rows = w.rows.map(r => (r.id === id ? { ...r, ...over } : r)); };
  return w;
}

test('the first look only takes a baseline and sends nothing, and a change then goes out once it has settled, with the rules the first time', async () => {
  const w = world();
  await w.updates.tick();
  assert.deepEqual(w.sent, []);
  w.change('a', { state: 'idle', dot: 'ready' });
  await w.step(1);
  await w.step(2);
  assert.deepEqual(w.sent, [], 'not settled yet');
  await w.step(1);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].chat, 'chat');
  assert.match(w.sent[0].text, /^<session-message from="ghostshell" from-name="GhostShell">\nStatus update for the group "Work", /);
  assert.match(w.sent[0].text, /- "Alpha" finished its turn\./);
  assert.match(w.sent[0].text, /\nTHE RULES\n/);
  assert.match(w.sent[0].text, /Last said: "Hello there\."/);
  assert.deepEqual(w.store.read().chat, { at: w.at, day: dayKey(w.at), count: 1, rules: true });
  await w.step(5);
  assert.equal(w.sent.length, 1, 'nothing changed, so nothing more');
});

test('the second update has no rules, waits 10 minutes after the first, and keeps its batch until the rules hold', async () => {
  const w = world();
  await w.updates.tick();
  w.change('a', { state: 'idle', dot: 'ready' });
  await w.step(1);
  await w.step(3);
  assert.equal(w.sent.length, 1);
  w.change('b', { state: 'waiting', dot: 'awaiting' });
  await w.step(1);
  await w.step(4);
  assert.equal(w.sent.length, 1, 'settled but under 10 minutes since the last');
  await w.step(5);
  assert.equal(w.sent.length, 2);
  assert.doesNotMatch(w.sent[1].text, /THE RULES/);
  assert.match(w.sent[1].text, /- "Beta" is waiting on you\./);
  assert.doesNotMatch(w.sent[1].text, /Alpha" finished/, 'the first batch is not repeated');
});

test('a busy chat, typing, an owner message, a cold cache and the daily cap each hold the batch, and it goes when they lift', async () => {
  const w = world();
  await w.updates.tick();
  w.idle = false;
  w.change('a', { state: 'idle', dot: 'ready' });
  await w.step(1);
  await w.step(4);
  assert.equal(w.sent.length, 0, 'busy');
  w.idle = true;
  w.updates.typing('chat');
  await w.step(0.2);
  assert.equal(w.sent.length, 0, 'typing');
  w.updates.ownerSpoke('chat');
  await w.step(0.5);
  assert.equal(w.sent.length, 0, 'the owner just wrote');
  w.transcript = { mtime: w.at - 60 * MINUTE };
  await w.step(2);
  assert.equal(w.sent.length, 0, 'cold');
  w.viewing = true;
  await w.step(0);
  assert.equal(w.sent.length, 1, 'a page has the chat open');
  assert.match(w.sent[0].text, /"Alpha" finished its turn/);
});

test('the daily cap stops updates and the next day starts the count again', async () => {
  const w = world();
  w.store.set('chat', { at: NOW - 60 * MINUTE, day: dayKey(NOW), count: 40, rules: true });
  await w.updates.tick();
  w.change('a', { state: 'idle', dot: 'ready' });
  await w.step(1);
  await w.step(4);
  assert.equal(w.sent.length, 0);
  w.viewing = true;
  w.opened = w.at + 24 * 60 * MINUTE;
  await w.step(24 * 60);
  assert.equal(w.sent.length, 1, 'a new day');
  assert.equal(w.store.read().chat.count, 1);
});

test('a group nobody has opened in a day, one with no transcript, a group gone and the setting off are all left alone', async () => {
  for (const over of [{ opened: NOW - 25 * 3600_000 }, { transcript: null }, { enabled: false }]) {
    const w = world(over);
    await w.updates.tick();
    w.change('a', { state: 'idle', dot: 'ready' });
    await w.step(4);
    assert.deepEqual(w.sent, [], JSON.stringify(over));
  }
  const w = world();
  await w.updates.tick();
  assert.equal(w.updates.watching('chat'), true);
  w.opened = NOW - 25 * 3600_000;
  await w.step(1);
  assert.equal(w.updates.watching('chat'), false, 'it stops being watched, and takes a new baseline if it comes back');
});

test('a failed send keeps the batch for the next look, and a pull request is asked for at most every 5 minutes', async () => {
  const w = world();
  let fail = true;
  const send = w.sent.push.bind(w.sent);
  const updates = makeGroupUpdates({
    now: () => w.at, enabled: () => true, candidates: () => [{ groupId: 'g', chatId: 'chat' }], openedAt: () => w.opened, transcript: () => w.transcript,
    members: () => ({ name: 'Work', rows: w.rows }), details: () => ({}), pulls: async () => { w.pulled++; return new Map(); }, chatIdle: () => true, viewing: () => false,
    send: async (chat, text) => { if (fail) throw new Error('no'); send({ chat, text }); }, rules: () => '', store: w.store, log: () => {},
  });
  w.change('a', { lastActivityAt: NOW });
  await updates.tick();
  w.change('a', { state: 'idle', dot: 'ready' });
  for (let i = 0; i < 4; i++) { w.at += MINUTE; await updates.tick(); }
  assert.equal(w.sent.length, 0);
  assert.equal(w.pulled, 1, 'asked once in 4 minutes');
  fail = false;
  w.at += MINUTE;
  await updates.tick();
  assert.equal(w.sent.length, 1);
  assert.equal(w.pulled, 2, 'and again after 5');
});

test('a pull request that changes between looks is sent, and one that could not be read keeps the last answer', async () => {
  const w = world({ pulls: new Map([['b', PULL]]) });
  await w.updates.tick();
  w.pulls = new Map([['b', { ...PULL, state: 'merged' }]]);
  await w.step(6);
  await w.step(3);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].text, /"Beta" has a pull request that changed: Merged, nothing to do\./);
  assert.match(w.sent[0].text, /Pull request: Merged, nothing to do\./);
  w.pulls = new Map([['b', undefined]]);
  await w.step(6);
  await w.step(10);
  assert.equal(w.sent.length, 1, 'an unreadable answer is not a change');
});

test('pullsOf gives a session its main pull request, null for none and undefined for one it could not read', async () => {
  const urls = { a: [], b: ['https://github.com/o/r/pull/1'], c: ['https://github.com/o/r/pull/2'] };
  const got = await pullsOf([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { urlsFor: id => urls[id], lookup: async () => ({ found: new Map([['https://github.com/o/r/pull/1', PULL]]), settling: false }) });
  assert.deepEqual([...got], [['a', null], ['b', PULL], ['c', undefined]]);
});

test('the store keeps a chat\'s record across a restart, reads a missing file as empty and refuses a broken one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-updates-'));
  assert.deepEqual(makeUpdateStore(dir).read(), {});
  makeUpdateStore(dir).set('chat', { at: 1, day: '2026-10-27', count: 2, rules: true });
  assert.deepEqual(makeUpdateStore(dir).read(), { chat: { at: 1, day: '2026-10-27', count: 2, rules: true } });
  fs.writeFileSync(path.join(dir, 'group-updates.json'), '{ nope');
  assert.throws(() => makeUpdateStore(dir).read(), /cannot be read\. Fix it or move it away/);
  fs.writeFileSync(path.join(dir, 'group-updates.json'), '[]');
  assert.throws(() => makeUpdateStore(dir).read());
});

const settle = async w => {
  await w.updates.tick();
  w.change('a', { state: 'idle', dot: 'ready' });
  await w.step(1);
  await w.step(3);
};

test('an update is recorded before it is sent, and a send that fails gives the record back', async () => {
  const w = world();
  let seen;
  const real = w.updates;
  w.sent.push = ((push) => (item) => { seen = w.store.read().chat; return push(item); })(w.sent.push.bind(w.sent));
  await settle(w);
  assert.equal(w.sent.length, 1);
  assert.deepEqual([seen.count, seen.rules], [1, true], 'the record was there when the message went');
  assert.ok(real);
  const f = world();
  f.sent.push = () => { throw new Error('the chat would not take it'); };
  await settle(f);
  assert.equal(f.store.read().chat.count, 0, 'the failed send was not counted');
  assert.equal(f.store.read().chat.rules, false, 'and the rules did not count as sent');
  assert.match(f.logs.join('\n'), /the chat would not take it/);
});

test('with a store that cannot be written or read nothing is sent, and the problem is logged once', async () => {
  const unwritable = world();
  unwritable.store.set = () => { throw new Error('disk full'); };
  await settle(unwritable);
  await unwritable.step(1);
  await unwritable.step(1);
  assert.deepEqual(unwritable.sent, []);
  assert.deepEqual(unwritable.logs, ['Group update for g failed: disk full']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-updates-'));
  fs.writeFileSync(path.join(dir, 'group-updates.json'), '{ nope');
  const broken = world({ store: makeUpdateStore(dir) });
  await settle(broken);
  await broken.step(1);
  assert.deepEqual(broken.sent, []);
  assert.equal(broken.logs.length, 1);
  assert.match(broken.logs[0], /group-updates\.json cannot be read/);
  fs.writeFileSync(path.join(dir, 'group-updates.json'), '{}');
  await broken.step(1);
  assert.equal(broken.sent.length, 1, 'it goes once the file can be read, with the batch it kept');
});

test('a pull request read without its threads or the viewer\'s login counts as unread', async () => {
  const rows = [{ id: 'a' }];
  const ask = pull => pullsOf(rows, { urlsFor: () => [PULL.url], lookup: async () => ({ found: new Map([[PULL.url, pull]]), settling: false }) });
  assert.deepEqual([...await ask({ ...PULL, threads: 0 })], [['a', { ...PULL, threads: 0 }]]);
  assert.deepEqual([...await ask({ ...PULL, threads: null, mine: true })], [['a', undefined]]);
  assert.deepEqual([...await ask({ ...PULL, threads: 0, mine: null })], [['a', undefined]]);
});

test('a turn read from another app\'s transcript that stops showing without a new write did not finish', () => {
  const run = at => snapshotOf(row({ state: 'active', dot: 'running', lastActivityAt: at }), { external: true }, NOW);
  const idle = at => snapshotOf(row({ lastActivityAt: at }), { external: true }, NOW);
  assert.deepEqual(kinds(run(NOW - 12 * MINUTE), idle(NOW - 12 * MINUTE)), [], 'dropped as too old');
  assert.deepEqual(kinds(run(NOW - 12 * MINUTE), idle(NOW - MINUTE)), ['finished'], 'ended with a write');
  const ours = snapshotOf(row({ state: 'working', dot: 'running', lastActivityAt: NOW - MINUTE }), {}, NOW);
  assert.deepEqual(kinds(ours, idle(NOW - MINUTE)), ['finished'], 'a turn GhostShell runs ends when its process says so');
  const long = snapshotOf(row({ state: 'active', dot: 'running', lastActivityAt: NOW - 12 * MINUTE }), { external: true }, NOW + 9 * MINUTE);
  assert.equal(long.stalled, true, 'a long tool call in another app is a stall at 20 minutes');
});

test('a group deleted while its pull requests are asked for gets no update', async () => {
  const w = world();
  await w.updates.tick();
  w.change('a', { state: 'idle', dot: 'ready' });
  w.duringPulls = async () => { w.gone = true; };
  await w.step(6);
  await w.step(4);
  assert.deepEqual(w.sent, []);
  assert.equal(w.updates.watching('chat'), false);
});

test('a chat that was started with the ranking rules in its guide is not sent them', async () => {
  const w = world();
  w.updates.rulesSent('chat');
  await settle(w);
  assert.equal(w.sent.length, 1);
  assert.doesNotMatch(w.sent[0].text, /THE RULES/);
  assert.deepEqual([w.store.read().chat.count, w.store.read().chat.rules], [1, true]);
});

test('a session that left the group is not listed as news in its update, and a batch of nothing else sends none', async () => {
  const w = world();
  await w.updates.tick();
  w.change('a', { state: 'idle', dot: 'ready' });
  w.change('b', { state: 'waiting', dot: 'awaiting' });
  await w.step(1);
  w.rows = w.rows.filter(r => r.id !== 'a');
  await w.step(3);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].text, /- "Beta" is waiting on you\./);
  assert.doesNotMatch(w.sent[0].text, /Alpha/);
  const alone = world();
  await alone.updates.tick();
  alone.change('a', { state: 'idle', dot: 'ready' });
  await alone.step(1);
  alone.rows = alone.rows.filter(r => r.id !== 'a');
  await alone.step(4);
  await alone.step(20);
  assert.deepEqual(alone.sent, []);
});
