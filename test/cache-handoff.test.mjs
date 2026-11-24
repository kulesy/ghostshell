// Run with `npm test`. The rules for who is asked and when, the words, the cache window read from a transcript, the one write that moves a session's place,
// and the scheduler run against fake callbacks and files in a temporary folder. The server and the page have their own tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askText, handoffPath, makeCacheHandoff, notDue, notWritten, outOfScope, scaled, seedable, seedText, thresholdOf, TIMING } from '../lib/cache-handoff.mjs';
import { cacheWindow } from '../lib/context.mjs';
import { makeLayout } from '../lib/layout.mjs';
import { allowsHandoff } from '../lib/runner.mjs';
import { makeUpdateStore } from '../lib/group-updates.mjs';

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-cache-handoff-test-')));
let made = 0;
const fresh = name => {
  const folder = path.join(dir, `${name}-${++made}`);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
};
const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const MINUTE = 60_000;

// ---- the window of the cache ------------------------------------------------------------------

const write = entries => {
  const file = path.join(fresh('transcript'), 'chat.jsonl');
  fs.writeFileSync(file, entries.map(e => `${JSON.stringify(e)}\n`).join(''));
  return file;
};
const wrote = (long, short, extra = {}) => ({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: short, ephemeral_1h_input_tokens: long } } }, ...extra });
const readOnly = { type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1, cache_read_input_tokens: 9, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } } } };

test('the window is the one the latest reply that wrote to the cache used', () => {
  assert.equal(cacheWindow(write([wrote(500, 0)])), '1h');
  assert.equal(cacheWindow(write([wrote(0, 500)])), '5m');
  assert.equal(cacheWindow(write([wrote(500, 0), wrote(0, 500)])), '5m', 'the latest one counts');
  assert.equal(cacheWindow(write([wrote(0, 500), wrote(500, 0)])), '1h');
});

test('a reply that wrote both windows counts as the short one, and one that wrote nothing says nothing', () => {
  assert.equal(cacheWindow(write([wrote(400, 100)])), '5m');
  assert.equal(cacheWindow(write([wrote(500, 0), readOnly])), '1h');
});

test('no window is known when no reply wrote to the cache, after a compaction, or from a reply that is not the chat\'s own', () => {
  assert.equal(cacheWindow(write([readOnly])), null);
  assert.equal(cacheWindow(write([wrote(500, 0), { type: 'system', subtype: 'compact_boundary' }])), null);
  assert.equal(cacheWindow(write([wrote(500, 0), wrote(0, 500, { isSidechain: true })])), '1h');
  assert.equal(cacheWindow(write([{ type: 'user', message: { role: 'user', content: 'ephemeral_1h_input_tokens' } }])), null);
});

// ---- the settings and the path ----------------------------------------------------------------

test('the threshold is 150000 tokens unless the setting is a whole number, and 0 turns it off', () => {
  const warned = [];
  const warn = m => warned.push(m);
  assert.equal(thresholdOf(undefined, warn), 150_000);
  assert.equal(thresholdOf(80_000, warn), 80_000);
  assert.equal(thresholdOf(0, warn), 0);
  assert.deepEqual(warned, []);
  for (const bad of ['150000', -1, 1.5, null, NaN]) assert.equal(thresholdOf(bad, warn), 150_000);
  assert.equal(warned.length, 5);
});

test('the test scale divides the tick and leaves the minutes a reply must be old as they are', () => {
  assert.equal(scaled(1), TIMING);
  assert.deepEqual(scaled(600), { ...TIMING, tick: 100 });
});

test('the handoff goes under the home\'s .claude folder, and only for a session id that is a UUID', () => {
  assert.equal(handoffPath(ID, '/home/x'), `/home/x/.claude/handoffs/${ID}.md`);
  for (const bad of ['../../etc/passwd', 'a', `${ID}/x`, '', undefined]) assert.equal(handoffPath(bad, '/home/x'), null);
});

// ---- who is asked -----------------------------------------------------------------------------

const ok = { listed: true, archived: false, title: 'Fix it', state: 'idle', pending: 0, awaiting: false, jobs: 0, elsewhere: false, group: false, routine: false, plan: false, restarting: false, blocked: false };

test('a listed, idle session with nothing waiting is in scope', () => {
  assert.equal(outOfScope(ok), null);
});

for (const [why, change] of [
  ['not listed', { listed: false }],
  ['archived', { archived: true }],
  ['done', { title: '✅ Done - Fix it' }],
  ['not idle', { state: 'working' }],
  ['a card is open', { pending: 1 }],
  ['awaiting the owner', { awaiting: true }],
  ['a background job is running', { jobs: 2 }],
  ['running in another app', { elsewhere: true }],
  ['a group or section chat', { group: true }],
  ['a routine or scheduled run', { routine: true }],
  ['in plan mode', { plan: true }],
  ['a restart is under way', { restarting: true }],
  ['its account cannot run it', { blocked: true }],
]) {
  test(`a session is left alone when it is ${why}`, () => {
    assert.equal(outOfScope({ ...ok, ...change }), why);
  });
}

// ---- when it is due ---------------------------------------------------------------------------

const NOW = Date.now();
const replyAgo = (minutes, extra = {}) => ({ at: NOW - minutes * MINUTE, total: 200_000, window: '1h', compacted: false, ...extra });
const due = (reply, extra = {}) => notDue(reply, { now: NOW, tokens: 150_000, ...extra });

test('a session is due from 50 minutes after its last reply and not from 58', () => {
  assert.equal(due(replyAgo(49)), 'too soon');
  assert.equal(due(replyAgo(49.99)), 'too soon');
  assert.equal(due(replyAgo(50)), null);
  assert.equal(due(replyAgo(57.9)), null);
  assert.equal(due(replyAgo(58)), 'too late');
  assert.equal(due(replyAgo(75)), 'too late');
});

test('a session is not due on a 5 minute window, under the size, after a compaction, with no reply or with no time on it', () => {
  assert.equal(due(replyAgo(52, { window: '5m' })), 'the cache does not last an hour');
  assert.equal(due(replyAgo(52, { window: null })), 'the cache does not last an hour');
  assert.equal(due(replyAgo(52, { total: 149_999 })), 'under the size');
  assert.equal(due(replyAgo(52, { total: 150_000 })), null, 'the size itself counts');
  assert.equal(due(replyAgo(52, { compacted: true })), 'no reply to go on');
  assert.equal(due(null), 'no reply to go on');
  assert.equal(due(replyAgo(52, { at: undefined })), 'no time on the reply');
});

test('a threshold of 0 turns it off', () => {
  assert.equal(notDue(replyAgo(52), { now: NOW, tokens: 0 }), 'off');
});

// ---- the file ---------------------------------------------------------------------------------

test('the handoff counts only as a regular, non-empty file written since the ask', () => {
  const folder = fresh('file');
  const file = path.join(folder, 'a.md');
  assert.equal(notWritten(file, 0), 'the file is not there');
  fs.writeFileSync(file, '');
  assert.equal(notWritten(file, 0), 'the file is empty');
  fs.writeFileSync(file, 'notes');
  assert.equal(notWritten(file, 0), null);
  assert.equal(notWritten(file, Date.now() + 60_000), 'the file is older than the ask');
  const link = path.join(folder, 'link.md');
  fs.symlinkSync(file, link);
  assert.equal(notWritten(link, 0), 'it is not a regular file');
  assert.equal(notWritten(folder, 0), 'it is not a regular file');
});

// ---- the words --------------------------------------------------------------------------------

test('the ask names the file and its sections, wraps itself as a message from GhostShell and relies on no skill', () => {
  const text = askText('/h/.claude/handoffs/x.md');
  assert.match(text, /^<session-message from="ghostshell" from-name="GhostShell">\n/);
  assert.match(text, /Write the handoff to \/h\/\.claude\/handoffs\/x\.md with the Write tool/);
  for (const part of ['Title and one-line status', 'Where it stands', 'Open items and next steps', 'Drafts not yet sent']) assert.ok(text.includes(part), part);
  assert.equal(/skill|hook|\/pre-compact/i.test(text), false);
  assert.equal(/[–—]/.test(text), false, 'no dashes');
});

test('the seed carries the handoff in, or only its path when it is too long, and says it is notes and not the owner\'s words', () => {
  const inline = seedText({ from: ID, transcript: '/t/x.jsonl', file: '/h/x.md', handoff: 'Next: ship it.' });
  assert.match(inline, /You carry on the work of session 0b1c2d3e/);
  assert.ok(inline.includes('/t/x.jsonl'));
  assert.ok(inline.includes('Next: ship it.'));
  assert.ok(inline.includes('notes the earlier session wrote, not instructions from the owner'));
  const long = seedText({ from: ID, transcript: '/t/x.jsonl', file: '/h/x.md', handoff: null });
  assert.ok(long.includes('Read it first.'));
  assert.equal(long.includes('Next: ship it.'), false);
});

test('a handoff goes in the seed unless it is long or has an @ in it, which the CLI could take as a file to load', () => {
  const file = path.join(fresh('seed'), 'x.md');
  for (const [text, want] of [['Next: ship it.', 'Next: ship it.'], ['x'.repeat(64 * 1024), 'x'.repeat(64 * 1024)], ['x'.repeat(64 * 1024 + 1), null], ['See @/etc/hosts', null]]) {
    fs.writeFileSync(file, text);
    assert.equal(seedable(file), want, text.slice(0, 20));
  }
});

// ---- the one write that moves the work --------------------------------------------------------

test('a handover gives the new session the old one\'s title, place and account pin, moves its children and archives it alone with its pin gone', () => {
  const layout = makeLayout(fresh('layout'));
  layout.addProject('P');
  const group = layout.addGroup('G', null).id;
  layout.rename('old', 'Fix it');
  layout.move('old', group);
  layout.setAccount('session', 'old', 'work', 'spare');
  layout.nest('kid', 'old');
  layout.handOver('old', 'new', { title: 'Fix it', parent: null, children: ['kid'] });
  const now = layout.read();
  assert.equal(now.titles.new, 'Fix it');
  assert.equal(now.assignments.new, group);
  assert.equal(now.accounts.new, 'work');
  assert.equal(now.overflow.new, 'spare');
  assert.equal(now.parents.kid, 'new');
  assert.ok(now.archived.old);
  assert.equal(now.archived.new, undefined);
  assert.equal(now.archivedWith.old, undefined);
  assert.equal(now.assignments.old, group, 'the old session keeps its place in the archive');
});

test('a session hands over its pin or its group together with its parent, which is a chat with no row when a group started it', () => {
  const pinned = makeLayout(fresh('layout'));
  pinned.pin('old', true);
  pinned.handOver('old', 'new', { title: 'T' });
  assert.deepEqual(pinned.read().pinned, ['new']);
  pinned.handOver('new', 'newer', { title: 'T', parent: 'pinned-chat' });
  assert.deepEqual([pinned.read().pinned, pinned.read().parents.newer], [['newer'], 'pinned-chat']);
  const grouped = makeLayout(fresh('layout'));
  const group = grouped.addGroup('G', null).id;
  grouped.move('old', group);
  grouped.handOver('old', 'new', { title: 'T', parent: 'group-chat' });
  assert.deepEqual([grouped.read().assignments.new, grouped.read().parents.new], [group, 'group-chat']);
});

// ---- the quiet write for one path -------------------------------------------------------------

test('the ask\'s Write and the Read before it are allowed for its file alone, and not by a link or a spelling of it', () => {
  const folder = fresh('allow');
  const file = path.join(folder, 'x.md');
  const chat = { handoff: { path: file } };
  const call = (tool_name, file_path) => ({ tool_name, input: { file_path } });
  assert.equal(allowsHandoff(chat, call('Write', file)), true, 'a file that is not there yet');
  assert.equal(allowsHandoff(chat, call('Read', file)), true);
  assert.equal(allowsHandoff(chat, call('Edit', file)), false);
  assert.equal(allowsHandoff(chat, call('Write', path.join(folder, 'y.md'))), false);
  assert.equal(allowsHandoff(chat, call('Write', `${folder}/./x.md`)), false);
  assert.equal(allowsHandoff(chat, call('Write', `${folder}/../${path.basename(folder)}/x.md`)), false);
  assert.equal(allowsHandoff({ handoff: null }, call('Write', file)), false);
  fs.writeFileSync(file, 'notes');
  assert.equal(allowsHandoff(chat, call('Write', file)), true, 'a plain file');
  fs.rmSync(file);
  fs.symlinkSync(path.join(folder, 'elsewhere'), file);
  assert.equal(allowsHandoff(chat, call('Write', file)), false, 'a link');
  const real = fresh('real');
  const linked = path.join(fresh('via'), 'dir');
  fs.symlinkSync(real, linked);
  assert.equal(allowsHandoff({ handoff: { path: path.join(linked, 'x.md') } }, call('Write', path.join(linked, 'x.md'))), false, 'a linked folder');
});

// ---- the scheduler ----------------------------------------------------------------------------

function rig({ facts = {}, reply = replyAgo(52), tokens = 150_000, ask } = {}) {
  const folder = fresh('rig');
  const state = { now: NOW, asked: [], reply, tokens };
  const logFile = path.join(folder, 'log.jsonl');
  const home = path.join(folder, 'home');
  const handoffs = makeCacheHandoff({
    now: () => state.now,
    tokens: () => state.tokens,
    home: () => home,
    store: makeUpdateStore(folder, 'entries.json'),
    logFile,
    log: () => {},
    facts: () => ({ ...ok, sortAt: 100, activeAt: 90, ...facts }),
    reply: () => state.reply,
    ask: ask ?? ((id, text, file) => { state.asked.push({ id, text, file }); }),
  });
  const events = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return { handoffs, state, events, home };
}

test('a session whose turn ended is asked once when it is due, with its place kept and an ask line logged', async () => {
  const { handoffs, state, events, home } = rig();
  handoffs.turnEnded(ID, NOW - 45 * MINUTE);
  await handoffs.tick();
  assert.equal(state.asked.length, 1);
  assert.equal(state.asked[0].file, path.join(home, '.claude', 'handoffs', `${ID}.md`));
  assert.ok(state.asked[0].text.includes(state.asked[0].file));
  assert.deepEqual(handoffs.kept(ID), { sortAt: 100, activeAt: 90 });
  assert.equal(handoffs.asking(ID), true);
  await handoffs.tick();
  await handoffs.tick();
  assert.equal(state.asked.length, 1, 'one ask for an idle stretch');
  assert.deepEqual(events().map(e => e.event), ['ask']);
  assert.equal(events()[0].tokens, 200_000);
  assert.equal(events()[0].idleMinutes, 52);
});

test('a session whose turn ended less than 40 minutes ago is not even looked at, and one with no turn of GhostShell\'s is never a candidate', async () => {
  const looked = [];
  const { handoffs, state } = rig({ facts: { get state() { looked.push(1); return 'idle'; } } });
  handoffs.turnEnded(ID, NOW - 39 * MINUTE);
  await handoffs.tick();
  assert.equal(looked.length, 0);
  assert.equal(state.asked.length, 0);
  const none = rig();
  await none.handoffs.tick();
  assert.equal(none.state.asked.length, 0);
});

test('a session outside the scope, not yet due or too late is not asked, and an entry past 58 minutes is dropped', async () => {
  for (const options of [{ facts: { pending: 1 } }, { reply: replyAgo(49) }, { reply: replyAgo(52, { window: '5m' }) }, { reply: replyAgo(52, { total: 100 }) }, { tokens: 0 }]) {
    const { handoffs, state } = rig(options);
    handoffs.turnEnded(ID, NOW - 45 * MINUTE);
    await handoffs.tick();
    assert.equal(state.asked.length, 0, JSON.stringify(options));
  }
  const { handoffs, state } = rig();
  handoffs.turnEnded(ID, NOW - 58 * MINUTE);
  await handoffs.tick();
  assert.equal(state.asked.length, 0);
  assert.deepEqual(handoffs.entries(), {});
});

test('a failed ask is logged and not tried again until a real turn ends', async () => {
  const { handoffs, state, events } = rig({ ask: () => { throw new Error('the chat is busy'); } });
  handoffs.turnEnded(ID, NOW - 45 * MINUTE);
  await handoffs.tick();
  await handoffs.tick();
  assert.equal(handoffs.entries()[ID].state, 'failed');
  assert.deepEqual(events().map(e => e.event), ['ask', 'failed']);
  assert.equal(events()[1].reason, 'the chat is busy');
  assert.equal(state.asked.length, 0);
  handoffs.turnEnded(ID, NOW);
  assert.equal(handoffs.entries()[ID].state, undefined, 'a real turn re-arms it');
});

test('the ask counts as written only when the file is there, and the session is then cold with its place kept', async () => {
  const { handoffs, state, events } = rig();
  handoffs.turnEnded(ID, NOW - 45 * MINUTE);
  await handoffs.tick();
  assert.equal(handoffs.cold(ID), null);
  fs.mkdirSync(path.dirname(state.asked[0].file), { recursive: true });
  fs.writeFileSync(state.asked[0].file, 'Notes.');
  state.now = NOW + 1000;
  handoffs.askEnded(ID);
  assert.equal(handoffs.cold(ID).path, state.asked[0].file);
  assert.equal(handoffs.cold(ID).coldAt, NOW + 1000);
  assert.deepEqual(handoffs.kept(ID), { sortAt: 100, activeAt: 90 });
  assert.deepEqual(events().map(e => e.event), ['ask', 'written']);
});

test('an ask whose file is missing, empty or old, or whose turn failed, is failed and says why', async () => {
  for (const [name, prepare, failed, reason] of [
    ['missing', () => {}, false, 'the file is not there'],
    ['empty', file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); }, false, 'the file is empty'],
    ['old', file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x'); fs.utimesSync(file, 1, 1); }, false, 'the file is older than the ask'],
    ['error', file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x'); }, true, 'the turn ended with an error'],
  ]) {
    const { handoffs, state, events } = rig();
    handoffs.turnEnded(ID, NOW - 45 * MINUTE);
    await handoffs.tick();
    prepare(state.asked[0].file);
    state.now = NOW + 1000;
    handoffs.askEnded(ID, { failed });
    assert.equal(handoffs.cold(ID), null, name);
    assert.equal(handoffs.entries()[ID].state, 'failed', name);
    assert.equal(events().at(-1).reason, reason, name);
  }
});

test('a message to the session while the ask is out voids it, and one after the handoff is saved ends it, and each is logged', async () => {
  const voided = rig();
  voided.handoffs.turnEnded(ID, NOW - 45 * MINUTE);
  await voided.handoffs.tick();
  voided.handoffs.sent(ID);
  assert.equal(voided.handoffs.entries()[ID], undefined);
  assert.equal(voided.handoffs.kept(ID), null);
  voided.handoffs.askEnded(ID);
  assert.equal(voided.handoffs.cold(ID), null, 'the ask\'s own end is no longer heard');
  assert.match(voided.events().at(-1).reason, /void/);

  const saved = rig();
  saved.handoffs.turnEnded(ID, NOW - 45 * MINUTE);
  await saved.handoffs.tick();
  fs.mkdirSync(path.dirname(saved.state.asked[0].file), { recursive: true });
  fs.writeFileSync(saved.state.asked[0].file, 'Notes.');
  saved.handoffs.askEnded(ID);
  assert.ok(saved.handoffs.cold(ID));
  saved.handoffs.sent(ID);
  assert.equal(saved.handoffs.cold(ID), null);
  assert.deepEqual(saved.events().map(e => e.event), ['ask', 'written', 'cleared']);
});

test('a session another app carried on is no longer cold and gets its place back, and so does one whose ask failed', async () => {
  for (const [name, failed, carry] of [['saved', false, () => ({ ...replyAgo(0), at: NOW + 60_000 })], ['failed', true, () => ({ ...replyAgo(0), at: NOW + 60_000 })], ['compacted', false, () => ({ compacted: true })]]) {
    const { handoffs, state, events } = rig();
    handoffs.turnEnded(ID, NOW - 45 * MINUTE);
    await handoffs.tick();
    fs.mkdirSync(path.dirname(state.asked[0].file), { recursive: true });
    fs.writeFileSync(state.asked[0].file, 'Notes.');
    state.now = NOW + 1000;
    state.reply = { ...replyAgo(0), at: NOW + 900 };
    handoffs.askEnded(ID, { failed });
    await handoffs.tick();
    assert.ok(handoffs.kept(ID), `${name}: the ask's own reply does not count`);
    state.reply = carry();
    state.tokens = 0;
    assert.equal(handoffs.carriedOn(ID), true, name);
    await handoffs.tick();
    assert.deepEqual([handoffs.cold(ID), handoffs.kept(ID)], [null, null], name);
    assert.equal(events().at(-1).reason, 'another app carried the session on', name);
  }
});

test('a message to a session whose ask failed gives it its place back', async () => {
  const { handoffs } = rig();
  handoffs.turnEnded(ID, NOW - 45 * MINUTE);
  await handoffs.tick();
  handoffs.askEnded(ID, { failed: true });
  assert.ok(handoffs.kept(ID));
  handoffs.sent(ID);
  assert.equal(handoffs.kept(ID), null);
});

test('an ask that was out at a restart is failed, and a handoff that is saved stays', async () => {
  const folder = fresh('restart');
  const store = makeUpdateStore(folder, 'entries.json');
  const make = () => makeCacheHandoff({ now: () => NOW, tokens: () => 1, store, logFile: path.join(folder, 'log.jsonl'), log: () => {}, facts: () => null, reply: () => null, ask: () => {} });
  store.set('a', { endedAt: 1, state: 'asking', askedAt: 2, path: '/x' });
  store.set('b', { endedAt: 1, state: 'cold', askedAt: 2, path: '/x', coldAt: 3 });
  make().recover();
  assert.equal(store.read().a.state, 'failed');
  assert.equal(store.read().b.state, 'cold');
});

test('a return is logged with where it went, how long after the ask and how big the session was, and both sides remember', async () => {
  const { handoffs, state, events } = rig();
  handoffs.turnEnded(ID, NOW - 45 * MINUTE);
  await handoffs.tick();
  state.now = NOW + 8 * MINUTE;
  handoffs.moved(ID, 'new-one');
  assert.deepEqual(handoffs.entries()[ID].movedTo, 'new-one');
  assert.deepEqual(handoffs.entries()['new-one'], { from: ID });
  assert.equal(handoffs.kept(ID), null);
  const line = events().at(-1);
  assert.deepEqual([line.event, line.from, line.to, line.minutes, line.tokens], ['returned', ID, 'new-one', 8, 200_000]);
});

test('where the work moved to survives the next turn, and one return runs at a time for a session', () => {
  const { handoffs } = rig();
  handoffs.moved(ID, 'new-one');
  handoffs.turnEnded(ID, NOW);
  assert.equal(handoffs.entries()[ID].movedTo, 'new-one');
  assert.equal(handoffs.begin(ID), true);
  assert.equal(handoffs.begin(ID), false);
  handoffs.end(ID);
  assert.equal(handoffs.begin(ID), true);
});

test('a message that could have moved and did not is logged with its reason, and clears the handoff only when it went to the session', async () => {
  const { handoffs, events } = rig();
  handoffs.turnEnded(ID, NOW - 45 * MINUTE);
  await handoffs.tick();
  handoffs.notMoved(ID, 'a slash command runs in the session it is for');
  assert.equal(events().at(-1).event, 'not-moved');
  assert.equal(handoffs.asking(ID), true, 'sent() is what clears it');
});

test('handoffLines says what a row carries and links the two ends of a hand over', async () => {
  const { handoffLines, COLD_LABEL } = await import('../public/ui/handoff-rules.js');
  assert.deepEqual(handoffLines(null), []);
  assert.deepEqual(handoffLines({ id: 'a' }), []);
  const cold = handoffLines({ cold: true, coldAt: Date.now() });
  assert.equal(cold.length, 1);
  assert.match(cold[0].text, /^Handoff saved at .+, your next message starts a fresh session from it\.$/);
  assert.equal(COLD_LABEL, 'Handoff saved');
  assert.deepEqual(handoffLines({ continues: 'x y' }).map(l => [l.href, l.label]), [['#/s/x%20y', 'Open the earlier session']]);
  assert.deepEqual(handoffLines({ continuedIn: 'z' }).map(l => [l.href, l.label]), [['#/s/z', 'Open it']]);
});
