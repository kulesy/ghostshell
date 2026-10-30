// Run with `npm test`. The one-off scheduler is driven by a fake clock and a fake session start, so nothing waits and nothing runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CATCH_UP_MS, localIso, nextTry, PREAMBLE, RETRY_BACKOFF_MS, routineId, wrapPrompt } from '../lib/routines.mjs';
import { makeScheduledFile, makeScheduledSessions, wrapOneOff } from '../lib/scheduled.mjs';
import { readHead } from '../lib/transcripts.mjs';

process.env.TZ = 'Australia/Sydney';
const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const HOUR = 3600_000;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-scheduled-test-'));

// Friday 30 Oct 2026, 16:00. The session is set for Monday 2 Nov, 09:00.
const T0 = at(2026, 10, 30, 16);
const MONDAY = at(2026, 11, 2, 9);
const GROUPS = [{ id: 'cg-1', name: 'Research' }, { id: 'cg-2', name: 'Chores' }, { id: 'cg-3', name: 'chores' }];

// A real scheduled.json in a scratch folder with one pending entry, and a scheduler on a clock we move by hand.
function rig({ entry = {}, limit = Infinity } = {}) {
  const state = fs.mkdtempSync(path.join(base, 'state-'));
  const store = makeScheduledFile(state);
  store.add({ id: 'rnd', title: 'Look at the R&D doc', at: localIso(MONDAY), cwd: state, prompt: 'Read the R&D doc and summarise it.', model: 'haiku', effort: 'low', mode: 'plan', ...entry });
  const r = { state, store, clock: { t: T0 }, calls: [], logs: [], warns: [], placed: [], working: new Set(), waiting: new Set(), onStart: null, placeResult: true, restarting: false, groups: GROUPS };
  r.sched = makeScheduledSessions({
    store, limit, now: () => r.clock.t, log: l => r.logs.push(l), warn: l => r.warns.push(l),
    start: async (s, text) => {
      const id = `s${r.calls.length + 1}`;
      r.calls.push({ s, text, id });
      if (r.onStart) await r.onStart(s);
      return id;
    },
    groups: () => r.groups,
    place: (id, group) => { r.placed.push([id, group]); return r.placeResult; },
    working: id => r.working.has(id),
    waiting: id => r.waiting.has(id),
    restarting: () => r.restarting,
    check: s => (s.cwd === '/no/such/folder' ? 'The folder does not exist.' : null),
    fieldProblems: s => ({
      ...(s.cwd === '/no/such/folder' || !fs.existsSync(s.cwd) ? { cwd: 'The folder does not exist.' } : {}),
      ...(/\s/.test(s.model ?? '') ? { model: 'Unknown model.' } : {}),
    }),
  });
  r.entry = (id = 'rnd') => store.read().scheduled.find(s => s.id === id);
  r.tickAt = async t => { r.clock.t = t; await r.sched.tick(); };
  return r;
}

// ---- the first message ---------------------------------------------------------------------------

test('the first message is the routines\' tag and preamble around the prompt, marked as a one-off and naming no file', () => {
  const preamble = PREAMBLE.replace('if the task file asks', 'if the prompt asks');
  assert.equal(wrapOneOff('rnd', '  Read the doc.\n'), `<scheduled-task name="rnd" once="true">\n${preamble}\n\nRead the doc.\n</scheduled-task>`);
});

test('the preamble of a one-off says the prompt allows a write action, and a routine\'s still says the task file', () => {
  assert.match(wrapOneOff('rnd', 'x'), /only take them if the prompt asks for that specific action/);
  assert.doesNotMatch(wrapOneOff('rnd', 'x'), /task file/);
  assert.match(wrapPrompt('daily', '/x/SKILL.md', 'x'), /only take them if the task file asks/);
});

test('the transcript reader lists a one-off session like any other, and a routine run is still a routine', () => {
  const dir = fs.mkdtempSync(path.join(base, 'transcript-'));
  const head = (...texts) => {
    const file = path.join(dir, `${Math.random()}.jsonl`);
    fs.writeFileSync(file, texts.map(text => `${JSON.stringify({ type: 'user', cwd: '/home/x', message: { role: 'user', content: text } })}\n`).join(''));
    return readHead({ file, size: fs.statSync(file).size });
  };
  const once = head(wrapOneOff('rnd', 'Do it.'), 'A later message that must not become the title.');
  assert.deepEqual([once.routine, once.scheduled, once.title, once.cwd], [null, true, 'rnd', '/home/x']);
  const run = head(wrapPrompt('daily', '/x/SKILL.md', 'Do it.'));
  assert.deepEqual([run.routine, run.scheduled], ['daily', false]);
  assert.deepEqual([head('Hello there').routine, head('Hello there').scheduled], [null, false]);
});

// ---- the store -------------------------------------------------------------------------------------

test('scheduled.json keeps what the entry is, then what has happened to it, and is written whole through a temporary file', () => {
  const r = rig({ entry: { group: 'cg-1' } });
  const file = path.join(r.state, 'scheduled.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(saved), ['scheduled']);
  assert.deepEqual(Object.keys(saved.scheduled[0]), ['id', 'title', 'at', 'cwd', 'prompt', 'model', 'effort', 'mode', 'group', 'status', 'sessionId', 'startedAt', 'lastError', 'retry']);
  assert.deepEqual(fs.readdirSync(r.state), ['scheduled.json']);
  assert.equal(r.entry().status, 'pending');
});

test('a scheduled.json that cannot be read, or holds an id twice, is reported and left alone, and a missing one is an empty list', () => {
  const state = fs.mkdtempSync(path.join(base, 'state-'));
  const store = makeScheduledFile(state);
  assert.deepEqual(store.read(), { scheduled: [] });
  const file = path.join(state, 'scheduled.json');
  fs.writeFileSync(file, '{ not json');
  assert.match(store.read().problem, /^scheduled\.json cannot be read/);
  assert.throws(() => store.add({ id: 'x' }), { status: 500 });
  fs.writeFileSync(file, JSON.stringify({ scheduled: [{ id: 'a' }, { id: 'a' }] }));
  assert.equal(store.read().problem, 'scheduled.json cannot be read: more than one scheduled session has the id "a"');
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ scheduled: [{ id: 'a' }, { id: 'a' }] }), 'left as it was');
  fs.writeFileSync(file, JSON.stringify({ scheduled: [{ id: 'b', cwd: '/x', at: localIso(MONDAY) }] }));
  assert.deepEqual(store.read().scheduled[0], { id: 'b', cwd: '/x', at: localIso(MONDAY), group: null, status: 'pending', sessionId: null, startedAt: null, lastError: null, retry: null, title: 'b' });
});

// ---- when it starts ------------------------------------------------------------------------------

test('nothing starts before the time, and at it one session starts in the folder with the mode, model and effort, wrapped, and never again', async () => {
  const r = rig();
  await r.tickAt(MONDAY - 1000);
  assert.equal(r.calls.length, 0);
  assert.equal(r.entry().status, 'pending');
  await r.tickAt(MONDAY + 5000);
  assert.equal(r.calls.length, 1);
  const { s, text } = r.calls[0];
  assert.deepEqual([s.cwd, s.mode, s.model, s.effort, s.title], [r.state, 'plan', 'haiku', 'low', 'Look at the R&D doc']);
  assert.equal(text, wrapOneOff('rnd', 'Read the R&D doc and summarise it.'));
  const done = r.entry();
  assert.deepEqual([done.status, done.sessionId, done.lastError, done.retry], ['started', 's1', null, null]);
  assert.equal(Date.parse(done.startedAt), MONDAY + 5000);
  await r.tickAt(MONDAY + 35_000);
  await r.tickAt(MONDAY + 30 * 86400_000);
  assert.equal(r.calls.length, 1, 'once');
  assert.match(r.logs[0], /^Scheduled session rnd: started session s1 \(due 2026-11-02 09:00:00\)$/);
});

test('a session that is still starting is not started a second time by the next check', async () => {
  const r = rig();
  let release;
  r.onStart = () => new Promise(resolve => { release = resolve; });
  const first = r.tickAt(MONDAY);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.entry().status, 'started', 'written down before the session starts');
  await r.tickAt(MONDAY + 30_000);
  assert.equal(r.calls.length, 1);
  assert.throws(() => r.sched.remove('rnd'), { status: 409 });
  release();
  await first;
  assert.equal(r.entry().sessionId, 's1');
});

test('a session due while GhostShell was down starts when it is up if it is under 12 hours late, and is skipped with the reason if it is not', async () => {
  const late = rig();
  await late.tickAt(MONDAY + CATCH_UP_MS - 60_000);
  assert.equal(late.calls.length, 1);
  assert.match(late.logs[0], /catch-up for 2026-11-02 09:00:00, 11 h 59 min late/);
  const over = rig();
  await over.tickAt(MONDAY + CATCH_UP_MS);
  assert.equal(over.calls.length, 0);
  assert.deepEqual([over.entry().status, over.entry().lastError], ['skipped', '12 h late, over the 12 h limit']);
  await over.tickAt(MONDAY + CATCH_UP_MS + HOUR);
  assert.equal(over.calls.length, 0, 'a skipped one never starts');
});

test('a hand edit shows on the next check, and an entry whose time cannot be read is said once and never starts', async () => {
  const r = rig();
  r.store.update('rnd', { at: 'next Monday' });
  await r.tickAt(MONDAY);
  await r.tickAt(MONDAY + 30_000);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.warns, ['Scheduled session rnd: the date and time cannot be read, so it never starts']);
  assert.equal(r.sched.list().scheduled[0].problem, 'The date and time cannot be read.');
  r.store.update('rnd', { at: localIso(MONDAY + 60_000) });
  await r.tickAt(MONDAY + 60_000);
  assert.equal(r.calls.length, 1);
});

test('a cancelled, started or skipped entry is not started', async () => {
  const r = rig();
  r.store.add({ id: 'b', title: 'B', at: localIso(MONDAY), cwd: r.state, prompt: 'x', status: 'cancelled' });
  r.store.add({ id: 'c', title: 'C', at: localIso(MONDAY), cwd: r.state, prompt: 'x', status: 'started' });
  r.store.add({ id: 'd', title: 'D', at: localIso(MONDAY), cwd: r.state, prompt: 'x', status: 'skipped' });
  await r.tickAt(MONDAY);
  assert.deepEqual(r.calls.map(c => c.s.id), ['rnd']);
});

// ---- the group -----------------------------------------------------------------------------------

test('a session with a group goes into it once it has started, and one without is not placed', async () => {
  const r = rig({ entry: { group: 'cg-1' } });
  await r.tickAt(MONDAY);
  assert.deepEqual(r.placed, [['s1', 'cg-1']]);
  assert.equal(r.entry().lastError, null);
  const none = rig();
  await none.tickAt(MONDAY);
  assert.deepEqual(none.placed, []);
});

test('a group that is gone starts the session on Home and says why in lastError', async () => {
  const r = rig({ entry: { group: 'cg-9' } });
  await r.tickAt(MONDAY);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.placed, []);
  assert.deepEqual([r.entry().status, r.entry().sessionId, r.entry().lastError], ['started', 's1', 'Its group was deleted, so it started on Home.']);
  assert.equal(r.sched.list().scheduled[0].groupName, null);
});

test('a group that cannot take the session is told in lastError and the session still started', async () => {
  const r = rig({ entry: { group: 'cg-1' } });
  r.placeResult = false;
  await r.tickAt(MONDAY);
  assert.deepEqual([r.entry().status, r.entry().lastError], ['started', 'It started, but could not be put in the group Research.']);
});

// ---- a failed start --------------------------------------------------------------------------------

test('a start that throws is queued with its tries and next time, kept in the file, and tried again once the wait is over', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('Claude did not start within 60 seconds'); };
  await r.tickAt(MONDAY);
  const queued = r.entry();
  assert.deepEqual([queued.status, queued.startedAt, queued.sessionId, queued.lastError], ['pending', null, null, 'Claude did not start within 60 seconds']);
  assert.deepEqual(queued.retry, { tries: 1, nextAt: localIso(MONDAY + RETRY_BACKOFF_MS[0]) });
  assert.deepEqual(r.warns, ['Scheduled session rnd: could not start (Claude did not start within 60 seconds)']);
  await r.tickAt(MONDAY + 30_000);
  assert.equal(r.calls.length, 1, 'not before the wait is over');
  r.onStart = null;
  await r.tickAt(MONDAY + RETRY_BACKOFF_MS[0]);
  assert.equal(r.calls.length, 2);
  assert.deepEqual([r.entry().status, r.entry().sessionId, r.entry().lastError, r.entry().retry], ['started', 's2', null, null]);
  await r.tickAt(MONDAY + HOUR);
  assert.equal(r.calls.length, 2, 'one session, not two');
});

test('the wait grows 1, 2, 5, 10 minutes and then stays at 15, counted from when the start failed', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('boom'); };
  let t = MONDAY;
  const waits = [];
  for (let i = 0; i < 6; i++) {
    await r.tickAt(t);
    const { retry } = r.entry();
    waits.push([retry.tries, (Date.parse(retry.nextAt) - t) / 60_000]);
    t = Date.parse(retry.nextAt);
  }
  assert.deepEqual(waits, [[1, 1], [2, 2], [3, 5], [4, 10], [5, 15], [6, 15]]);
});

test('a retry that would be past 12 hours from the set time is dropped and the entry skipped', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('boom'); };
  await r.tickAt(MONDAY + CATCH_UP_MS - 30_000);
  assert.deepEqual([r.entry().status, r.entry().retry, r.entry().lastError], ['skipped', null, 'could not start within the 12 h limit']);
  const queued = rig();
  queued.onStart = async () => { throw new Error('boom'); };
  await queued.tickAt(MONDAY);
  queued.onStart = null;
  await queued.tickAt(MONDAY + CATCH_UP_MS);
  assert.equal(queued.calls.length, 1);
  assert.deepEqual([queued.entry().status, queued.entry().lastError], ['skipped', 'could not start within the 12 h limit']);
});

test('no retry starts while a restart is under way, and it starts once the restart is over', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('boom'); };
  await r.tickAt(MONDAY);
  r.onStart = null;
  r.restarting = true;
  await r.tickAt(MONDAY + 5 * 60_000);
  await r.tickAt(MONDAY + 5 * 60_000 + 30_000);
  assert.equal(r.calls.length, 1);
  assert.equal(r.logs.filter(l => /holding the retry/.test(l)).length, 1, 'said once');
  r.restarting = false;
  await r.tickAt(MONDAY + 6 * 60_000);
  assert.equal(r.calls.length, 2);
});

test('a refusal, such as a folder that is gone, is shown as a problem and skipped, never retried', async () => {
  const r = rig({ entry: { cwd: '/no/such/folder' } });
  assert.equal(r.sched.list().scheduled[0].problem, 'The folder does not exist.');
  await r.tickAt(MONDAY);
  assert.equal(r.calls.length, 0);
  assert.deepEqual([r.entry().status, r.entry().lastError, r.entry().retry], ['skipped', 'The folder does not exist.', null]);
  await r.tickAt(MONDAY + HOUR);
  assert.equal(r.calls.length, 0);
});

test('the queue is in scheduled.json, so a restart carries on with the same retry and does not repeat a session', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('boom'); };
  await r.tickAt(MONDAY);
  const again = makeScheduledSessions({ store: r.store, now: () => r.clock.t, log: () => {}, warn: () => {}, start: async () => { r.calls.push('again'); return 'z1'; }, check: () => null });
  r.clock.t = MONDAY + 30_000;
  await again.tick();
  assert.equal(r.calls.length, 1, 'not before the wait is over');
  r.clock.t = MONDAY + 60_000;
  await again.tick();
  assert.equal(r.calls.length, 2);
  r.clock.t = MONDAY + 2 * HOUR;
  await again.tick();
  assert.equal(r.calls.length, 2);
  assert.equal(r.entry().sessionId, 'z1');
});

test('a crash mid-start leaves the entry started with no session, and it is never started again', async () => {
  const r = rig();
  r.store.update('rnd', { status: 'started', startedAt: localIso(MONDAY), sessionId: null });
  await r.tickAt(MONDAY + 60_000);
  assert.equal(r.calls.length, 0);
  assert.equal(r.sched.list().scheduled[0].problem, 'Started, but no session was recorded.');
});

test('an entry whose status is not one GhostShell knows is a problem, is said once in the log, and never starts', async () => {
  const r = rig();
  r.store.update('rnd', { status: 'due' });
  await r.tickAt(MONDAY + 60_000);
  await r.tickAt(MONDAY + 90_000);
  assert.equal(r.calls.length, 0);
  assert.match(r.sched.list().scheduled[0].problem, /^The status "due" is not one of pending, started, skipped, cancelled, so it never starts\.$/);
  assert.equal(r.warns.filter(w => /status "due"/.test(w)).length, 1);
});

// ---- a stale save of the file -------------------------------------------------------------------

test('an older copy of scheduled.json saved over a started entry does not start it again, and the entry is put back to started', async () => {
  const r = rig();
  const older = { ...r.entry() };
  await r.tickAt(MONDAY);
  assert.equal(r.calls.length, 1);
  r.store.update('rnd', { status: 'pending', sessionId: null, startedAt: null });
  assert.equal(older.status, 'pending');
  await r.tickAt(MONDAY + 60_000);
  await r.tickAt(MONDAY + 90_000);
  assert.equal(r.calls.length, 1, 'no second session');
  assert.deepEqual([r.entry().status, r.entry().sessionId], ['started', 's1']);
});

test('a new time lets an entry that started go again, and a start that failed is not counted as started', async () => {
  const r = rig();
  await r.tickAt(MONDAY);
  const later = MONDAY + 2 * HOUR;
  r.store.update('rnd', { status: 'pending', sessionId: null, at: localIso(later) });
  await r.tickAt(later);
  assert.equal(r.calls.length, 2, 'a deliberate new time starts it');
  const f = rig();
  f.onStart = async () => { throw new Error('boom'); };
  await f.tickAt(MONDAY);
  f.onStart = null;
  await f.tickAt(MONDAY + 2 * 60_000);
  assert.equal(f.calls.length, 2, 'the retry still goes');
});

test('a start now that failed leaves nothing behind that stops the entry starting at its time', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('boom'); };
  await assert.rejects(r.sched.startNow('rnd'));
  r.onStart = null;
  await r.tickAt(MONDAY);
  assert.equal(r.calls.length, 2);
});

test('a session started now is not started again at its time if the file is saved back to pending', async () => {
  const r = rig();
  await r.sched.startNow('rnd');
  r.store.update('rnd', { status: 'pending', sessionId: null, startedAt: null });
  await r.tickAt(MONDAY);
  assert.equal(r.calls.length, 1);
});

// ---- the shared limit ----------------------------------------------------------------------------

test('sessions that routines have running count against the limit, so the two together never go over it', async () => {
  const r = rig({ limit: 2 });
  r.sched = makeScheduledSessions({
    store: r.store, limit: 2, elsewhere: () => r.others ?? 0, now: () => r.clock.t, log: l => r.logs.push(l), warn: l => r.warns.push(l),
    start: async s => { r.calls.push({ s, id: `s${r.calls.length + 1}` }); return `s${r.calls.length}`; },
    working: () => true,
  });
  for (const id of ['b', 'c']) r.store.add({ id, title: id, at: localIso(MONDAY), cwd: r.state, prompt: 'x' });
  r.others = 1;
  await r.tickAt(MONDAY);
  assert.deepEqual(r.calls.map(c => c.s.id), ['rnd'], 'one place left of two');
  assert.equal(r.sched.occupied(), 1, 'what it has running is what the routines count against their own limit');
  r.others = 0;
  await r.tickAt(MONDAY + 30_000);
  assert.deepEqual(r.calls.map(c => c.s.id), ['rnd', 'b'], 'with the routines idle there is one more place, not two');
  r.others = 1;
  await r.tickAt(MONDAY + 60_000);
  assert.equal(r.calls.length, 2, 'c keeps waiting and is not skipped');
  assert.equal(r.entry('c').status, 'pending');
});

test('the retry arithmetic and the id fallback are the routines\'', () => {
  assert.deepEqual(nextTry(0, 1000, 0), { tries: 1, nextAt: 1000 + RETRY_BACKOFF_MS[0], gaveUp: false });
  assert.equal(nextTry(9, 0, 0).nextAt, RETRY_BACKOFF_MS.at(-1));
  assert.equal(nextTry(0, CATCH_UP_MS, 0).gaveUp, true);
  assert.equal(routineId('???'), 'routine');
  assert.equal(routineId('???', () => false, 'scheduled-session'), 'scheduled-session');
});

test('a title with nothing in it that a slug can use is called scheduled-session', () => {
  const r = rig();
  assert.equal(r.sched.add({ title: '☃☃', at: localIso(MONDAY + HOUR), cwd: r.state, prompt: 'x' }).id, 'scheduled-session');
});

test('a retry waits for a free place under the shared limit, too', async () => {
  const r = rig({ limit: 1 });
  r.sched = makeScheduledSessions({
    store: r.store, limit: 1, elsewhere: () => r.others ?? 0, now: () => r.clock.t, log: l => r.logs.push(l), warn: l => r.warns.push(l),
    start: async s => { r.calls.push({ s }); if (r.fail) throw new Error('boom'); return 's1'; },
  });
  r.fail = true;
  await r.tickAt(MONDAY);
  r.fail = false;
  r.others = 1;
  await r.tickAt(MONDAY + 2 * 60_000);
  assert.equal(r.calls.length, 1);
  assert.equal(r.logs.filter(l => /waiting for a free place to retry/.test(l)).length, 1);
  r.others = 0;
  await r.tickAt(MONDAY + 3 * 60_000);
  assert.equal(r.calls.length, 2);
});

// ---- while a start is in flight ------------------------------------------------------------------

test('edit, cancel and start now are refused while the entry is starting, and delete too', async () => {
  const r = rig();
  let release;
  r.onStart = () => new Promise(resolve => { release = resolve; });
  const first = r.tickAt(MONDAY);
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => r.sched.edit('rnd', { title: 'x' }), { status: 409, message: 'Look at the R&D doc is starting.' });
  assert.throws(() => r.sched.cancel('rnd'), { status: 409, message: 'Look at the R&D doc is starting.' });
  await assert.rejects(r.sched.startNow('rnd'), { status: 409, message: 'Look at the R&D doc is starting.' });
  assert.throws(() => r.sched.remove('rnd'), { status: 409 });
  release();
  await first;
  assert.equal(r.calls.length, 1);
  assert.equal(r.entry().status, 'started');
});

// ---- down past the limit with a retry queued -----------------------------------------------------

test('GhostShell down past 12 hours with a retry queued: the next one up skips it as given up, and starts nothing', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('boom'); };
  await r.tickAt(MONDAY);
  assert.equal(r.entry().status, 'pending');
  assert.ok(r.entry().retry);
  r.onStart = null;
  const restarted = makeScheduledSessions({ store: r.store, now: () => r.clock.t, log: l => r.logs.push(l), warn: l => r.warns.push(l), start: async s => { r.calls.push({ s }); return 'again'; } });
  r.clock.t = MONDAY + CATCH_UP_MS + HOUR;
  await restarted.tick();
  assert.equal(r.calls.length, 1, 'only the first try');
  assert.deepEqual([r.entry().status, r.entry().retry, r.entry().lastError], ['skipped', null, 'could not start within the 12 h limit']);
});

// ---- the limit -----------------------------------------------------------------------------------

test('no more than the limit run at once, the rest wait their turn without being skipped, and a session only waiting for an answer does not count', async () => {
  const r = rig({ limit: 2 });
  for (const id of ['b', 'c']) r.store.add({ id, title: id, at: localIso(MONDAY), cwd: r.state, prompt: 'x' });
  for (const id of ['s1', 's2']) r.working.add(id);
  await r.tickAt(MONDAY);
  assert.deepEqual(r.calls.map(c => c.s.id), ['rnd', 'b']);
  assert.equal(r.entry('c').status, 'pending');
  await r.tickAt(MONDAY + 30_000);
  assert.equal(r.calls.length, 2);
  assert.equal(r.logs.filter(l => /waiting for a free place/.test(l)).length, 1, 'said once');
  r.waiting.add('s1');
  await r.tickAt(MONDAY + 60_000);
  assert.deepEqual(r.calls.map(c => c.s.id), ['rnd', 'b', 'c']);
});

// ---- adding --------------------------------------------------------------------------------------

test('adding saves the entry with its id from the title, a number added while it is taken, and the time as the Mac writes it', () => {
  const r = rig();
  const input = { title: 'Look at the R&D doc', at: '2026-11-03T09:30', cwd: r.state, prompt: '  Read it.  ', group: 'Research' };
  const added = r.sched.add(input);
  assert.deepEqual([added.id, added.at, added.prompt, added.group, added.groupName, added.status, added.model, added.effort, added.mode], ['look-at-the-r-d-doc', '2026-11-03T09:30:00+11:00', 'Read it.', 'cg-1', 'Research', 'pending', null, null, null]);
  assert.equal(r.sched.add(input).id, 'look-at-the-r-d-doc-2');
  assert.equal(r.sched.add({ ...input, title: 'New' }).id, 'new-2');
});

test('a group is picked by id or by name, an unknown or doubled name is refused, and none or null is no group', () => {
  const r = rig();
  const input = { title: 'T', at: '2026-11-03T09:30', cwd: r.state, prompt: 'x' };
  assert.equal(r.sched.add({ ...input, group: 'cg-2' }).group, 'cg-2');
  assert.equal(r.sched.add({ ...input, group: ' research ' }).group, 'cg-1');
  assert.equal(r.sched.add({ ...input, group: null }).group, null);
  assert.equal(r.sched.add({ ...input, group: '' }).group, null);
  assert.equal(r.sched.add(input).group, null);
});

test('adding is refused with every bad field named, and nothing is written', () => {
  const r = rig();
  const before = fs.readFileSync(path.join(r.state, 'scheduled.json'), 'utf8');
  assert.throws(() => r.sched.add({ title: ' ', at: 'soon', cwd: '/no/such/folder', model: 'two words', effort: 3, mode: null, group: 'Nowhere', prompt: ' ' }), e => {
    assert.equal(e.status, 400);
    assert.equal(e.message, 'Nothing was saved. Check the title, date and time, folder, model, effort, group and prompt.');
    assert.deepEqual(Object.keys(e.problems), ['title', 'at', 'cwd', 'model', 'effort', 'group', 'prompt']);
    assert.equal(e.problems.group, 'GhostShell has no group called "Nowhere". The groups are "Research", "Chores", "chores".');
    return true;
  });
  assert.throws(() => r.sched.add({ title: 'T', at: '2026-11-03T09:30', cwd: r.state, prompt: 'x', group: 'Chores' }), e => /^GhostShell group "Chores" matches 2 groups, so it is ambiguous\. Use the id of one of them instead: cg-2, cg-3\.$/.test(e.problems.group));
  assert.throws(() => r.sched.add('nope'), { status: 400 });
  assert.equal(fs.readFileSync(path.join(r.state, 'scheduled.json'), 'utf8'), before);
});

test('a time that has passed, or is this very moment, is refused on add', () => {
  const r = rig();
  const input = { title: 'T', cwd: r.state, prompt: 'x' };
  for (const when of [localIso(T0 - 1000), localIso(T0), '2020-01-01T09:00']) {
    assert.throws(() => r.sched.add({ ...input, at: when }), e => e.problems.at === 'That time has already passed. Pick one in the future.', when);
  }
  assert.equal(r.sched.add({ ...input, at: localIso(T0 + 1000) }).status, 'pending');
  assert.throws(() => r.sched.add({ ...input, at: 1790000000000 }), e => /Give the date and time/.test(e.problems.at));
});

test('a title whose id is taken by another entry gets a number', () => {
  const r = rig();
  assert.equal(r.sched.add({ title: 'Rnd', at: '2026-11-03T09:30', cwd: r.state, prompt: 'x' }).id, 'rnd-2');
});

// ---- editing, cancelling and deleting ----------------------------------------------------------------

test('editing changes only what is sent, checks a new time and leaves a time that did not change alone, even when it has passed', async () => {
  const r = rig();
  const edited = r.sched.edit('rnd', { title: 'Renamed', prompt: 'New text.', group: 'Research' });
  assert.deepEqual([edited.id, edited.title, edited.prompt, edited.group, edited.at, edited.cwd, edited.mode], ['rnd', 'Renamed', 'New text.', 'cg-1', localIso(MONDAY), r.state, 'plan']);
  assert.equal(r.sched.edit('rnd', { group: null }).group, null);
  assert.equal(r.sched.edit('rnd', { at: '2026-11-03T10:00' }).at, '2026-11-03T10:00:00+11:00');
  assert.throws(() => r.sched.edit('rnd', { at: localIso(T0 - 1000) }), e => e.problems.at && Object.keys(e.problems).length === 1);
  r.clock.t = at(2026, 11, 3, 11);
  assert.equal(r.sched.edit('rnd', { title: 'Late rename', at: '2026-11-03T10:00' }).title, 'Late rename', 'its own time need not be in the future');
  assert.throws(() => r.sched.edit('rnd', { cwd: '/no/such/folder' }), e => !!e.problems.cwd);
  assert.throws(() => r.sched.edit('rnd', 'nope'), { status: 400 });
  assert.throws(() => r.sched.edit('nope', { title: 'x' }), { status: 404 });
});

test('a new time clears a queued retry and the record of a failed try, so the entry starts clean', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('boom'); };
  await r.tickAt(MONDAY);
  assert.ok(r.entry().retry);
  r.sched.edit('rnd', { at: localIso(MONDAY + 2 * HOUR) });
  assert.deepEqual([r.entry().retry, r.entry().lastError], [null, null]);
  r.onStart = null;
  await r.tickAt(MONDAY + 2 * HOUR);
  assert.equal(r.calls.length, 2);
});

test('only a pending entry can be edited or cancelled', async () => {
  const r = rig();
  await r.tickAt(MONDAY);
  const words = 'Look at the R&D doc is started, so it cannot be';
  assert.throws(() => r.sched.edit('rnd', { title: 'x' }), { status: 409, message: `${words} edited.` });
  assert.throws(() => r.sched.cancel('rnd'), { status: 409, message: `${words} cancelled.` });
  await assert.rejects(r.sched.startNow('rnd'), { status: 409, message: `${words} started now.` });
  const c = rig();
  assert.equal(c.sched.cancel('rnd').status, 'cancelled');
  assert.throws(() => c.sched.edit('rnd', { title: 'x' }), { status: 409 });
  assert.throws(() => c.sched.cancel('rnd'), { status: 409 });
});

test('a cancelled entry stays in the list and never starts', async () => {
  const r = rig();
  r.sched.cancel('rnd');
  await r.tickAt(MONDAY + 5000);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.sched.list().scheduled.map(s => [s.id, s.status]), [['rnd', 'cancelled']]);
});

test('deleting removes the entry whatever state it is in, and a 404 follows', async () => {
  const r = rig();
  await r.tickAt(MONDAY);
  assert.equal(r.sched.remove('rnd'), 'rnd');
  assert.deepEqual(r.sched.list().scheduled, []);
  assert.throws(() => r.sched.remove('rnd'), { status: 404, message: 'No scheduled session with that id.' });
  const pending = rig();
  assert.equal(pending.sched.remove('rnd'), 'rnd');
});

test('with a scheduled.json that cannot be read, adding, editing and deleting are refused and the check does not throw', async () => {
  const r = rig();
  fs.writeFileSync(path.join(r.state, 'scheduled.json'), '[');
  assert.throws(() => r.sched.add({ title: 'T', at: '2026-11-03T09:30', cwd: r.state, prompt: 'x' }), { status: 500 });
  assert.throws(() => r.sched.edit('rnd', {}), { status: 500 });
  assert.throws(() => r.sched.remove('rnd'), { status: 500 });
  await r.tickAt(MONDAY);
  await r.tickAt(MONDAY + 30_000);
  assert.equal(r.warns.length, 1, 'said once');
  assert.equal(r.sched.list().problem.startsWith('scheduled.json cannot be read'), true);
});

// ---- start now -----------------------------------------------------------------------------------

test('start now starts a pending entry at once, before its time and over the limit, and it never fires again', async () => {
  const r = rig({ limit: 1 });
  r.working.add('busy');
  r.store.add({ id: 'other', title: 'Other', at: localIso(MONDAY), cwd: r.state, prompt: 'x', status: 'started', sessionId: 'busy' });
  const done = await r.sched.startNow('rnd');
  assert.equal(done.sessionId, 's1');
  assert.deepEqual([done.scheduled.status, done.scheduled.sessionId], ['started', 's1']);
  assert.match(r.logs.at(-1), /\(start now\)/);
  await r.tickAt(MONDAY + 5000);
  assert.equal(r.calls.length, 1);
});

test('a start now that fails or is refused leaves the entry pending, with its time and queue as they were, and queues nothing', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('boom'); };
  await assert.rejects(r.sched.startNow('rnd'), /boom/);
  assert.deepEqual([r.entry().status, r.entry().retry, r.entry().startedAt, r.entry().lastError], ['pending', null, null, null]);
  r.onStart = null;
  r.store.update('rnd', { cwd: '/no/such/folder' });
  await assert.rejects(r.sched.startNow('rnd'), { status: 400, message: 'The folder does not exist.' });
  assert.equal(r.entry().status, 'pending');
  r.store.update('rnd', { cwd: r.state });
  await r.tickAt(MONDAY);
  assert.equal(r.calls.length, 2, 'it still starts at its time');
});

test('start now keeps a queued retry queued when it fails, and clears it when it works', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('first'); };
  await r.tickAt(MONDAY);
  const queued = r.entry().retry;
  await assert.rejects(r.sched.startNow('rnd'), /boom|first/);
  assert.deepEqual(r.entry().retry, queued);
  r.onStart = null;
  await r.sched.startNow('rnd');
  assert.deepEqual([r.entry().status, r.entry().retry], ['started', null]);
});

// ---- the summary ---------------------------------------------------------------------------------

test('the list carries each entry with its group\'s name and whether its session is running, and a problem only while it is pending', async () => {
  const r = rig({ entry: { group: 'cg-1' } });
  const [first] = r.sched.list().scheduled;
  assert.deepEqual([first.groupName, first.running, first.problem, first.prompt], ['Research', false, null, 'Read the R&D doc and summarise it.']);
  await r.tickAt(MONDAY);
  r.working.add('s1');
  assert.equal(r.sched.list().scheduled[0].running, true);
  r.waiting.add('s1');
  assert.equal(r.sched.list().scheduled[0].running, false);
  r.store.update('rnd', { status: 'cancelled', cwd: '/no/such/folder' });
  assert.equal(r.sched.list().scheduled[0].problem, null);
});

test('an entry with an empty prompt or an id the wrapper cannot carry is explained and never started', async () => {
  const r = rig({ entry: { prompt: '  ' } });
  assert.equal(r.sched.list().scheduled[0].problem, 'The prompt is empty.');
  const bad = rig({ entry: { id: 'a"b' } });
  assert.equal(bad.sched.list().scheduled.find(s => s.id === 'a"b').problem, 'The id can only hold letters, digits, dashes and underscores.');
  await bad.tickAt(MONDAY);
  assert.equal(bad.calls.length, 0);
});
