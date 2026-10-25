// Run with `npm test`. The scheduler is driven by a fake clock and a fake session start, so nothing waits and nothing runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CATCH_UP_MS, dueAction, localIso, makeRoutines, makeScheduler, makeZoneFollower, PREAMBLE, routineId, stamp, upcoming, wrapPrompt } from '../lib/routines.mjs';
import { nextFire } from '../lib/cron.mjs';
import { readHead } from '../lib/transcripts.mjs';

process.env.TZ = 'Australia/Sydney';
const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const HOUR = 3600_000;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-routines-test-'));

// Thursday 15 Oct 2026, 21:43:12. A weekday 07:30 routine with 737 s of jitter next fires at Friday 07:42:17.
const T0 = at(2026, 10, 15, 21, 43, 12);
const FRIDAY = at(2026, 10, 16, 7, 42, 17);
const MONDAY = at(2026, 10, 19, 7, 42, 17);

const fixture = (file, cwd, extra = {}) => ({
  id: 'demo', title: 'Demo routine', cron: '30 7 * * 1-5', jitterSeconds: 737, file, cwd, model: 'haiku', effort: 'low', mode: 'bypassPermissions', ...extra,
});

// Puts routines in routines.json as a person editing the file would: switched off, with nothing run yet unless the entry says so.
const BLANK = { enabled: false, armedAt: null, lastRunAt: null, lastSessionId: null, lastError: null, skipped: null };
const put = (state, list) => fs.writeFileSync(path.join(state, 'routines.json'), `${JSON.stringify({ routines: list.map(x => ({ ...BLANK, ...x })) }, null, 2)}\n`);

// One routine on a real routines.json in a scratch folder, switched on at `armed`, with a scheduler on a clock we move by hand.
function rig({ cron, jitter, armed = T0, enabled = true, patch = {}, body = 'Check the thing.' } = {}) {
  const state = fs.mkdtempSync(path.join(base, 'state-'));
  const file = path.join(state, 'SKILL.md');
  const raw = `---\nname: demo\ndescription: A demo\n---\n\n${body}\n`;
  fs.writeFileSync(file, raw);
  const store = makeRoutines(state);
  put(state, [fixture(file, state, { ...(cron && { cron }), ...(jitter !== undefined && { jitterSeconds: jitter }) })]);
  if (enabled) store.update('demo', { enabled: true, armedAt: localIso(armed) });
  if (Object.keys(patch).length) store.update('demo', patch);
  const r = { state, file, raw, store, clock: { t: T0 }, calls: [], logs: [], warns: [], working: new Set(), waiting: new Set(), stops: [], taken: new Set(), onStart: null };
  r.boot = () => {
    r.sched = makeScheduler({
      store, now: () => r.clock.t, log: l => r.logs.push(l), warn: l => r.warns.push(l),
      start: async (routine, text) => {
        const id = `s${r.calls.length + 1}`;
        r.calls.push({ routine, text, id });
        if (r.onStart) await r.onStart(routine);
        return id;
      },
      working: id => r.working.has(id),
      waiting: id => r.waiting.has(id),
      stop: id => { r.stops.push(id); r.working.delete(id); r.waiting.delete(id); },
      check: routine => (routine.cwd === '/no/such/folder' ? 'The folder does not exist.' : null),
      idTaken: id => r.taken.has(id),
      fieldProblems: routine => ({
        ...(routine.cwd === '/no/such/folder' || !fs.existsSync(routine.cwd) ? { cwd: 'The folder does not exist.' } : {}),
        ...(/\s/.test(routine.model ?? '') ? { model: 'Unknown model.' } : {}),
      }),
    });
    return r.sched;
  };
  r.boot();
  r.demo = () => store.read().routines.find(x => x.id === 'demo');
  r.tickAt = async t => { r.clock.t = t; await r.sched.tick(); };
  return r;
}

// ---- Desktop's prompt ------------------------------------------------------------------------------

test('the preamble is Desktop\'s own wording, byte for byte, with its one em dash', () => {
  assert.equal(crypto.createHash('sha256').update(PREAMBLE).digest('hex'), 'f6d19dc886dc171a161b741ec1a78d4db158addd366093a74e58016991b95ccc');
  const EM = String.fromCodePoint(0x2014);
  assert.equal([...PREAMBLE].filter(c => c === EM).length, 1);
  assert.ok(PREAMBLE.includes(`clarifying questions ${EM} make reasonable choices`));
  assert.match(PREAMBLE, /"write" actions \(e\.g\. MCP tools/);
});

test('the wrapped prompt is the tag, the preamble, a blank line, the body and the closing tag', () => {
  const text = wrapPrompt('daily-scrum', '/home/x/.claude/scheduled-tasks/daily-scrum/SKILL.md', '---\nname: daily-scrum\ndescription: Weekdays\n---\n\nYou are preparing the email.\n\nSecond paragraph.\n');
  assert.equal(text, `<scheduled-task name="daily-scrum" file="/home/x/.claude/scheduled-tasks/daily-scrum/SKILL.md">\n${PREAMBLE}\n\nYou are preparing the email.\n\nSecond paragraph.\n</scheduled-task>`);
});

test('frontmatter is stripped whatever its line endings, and a body without any is kept whole', () => {
  const body = 'Line one.\n\n---\n\nAfter a rule.';
  const expected = wrapPrompt('x', '/f', `---\nname: x\n---\n${body}`);
  assert.ok(expected.endsWith(`\n\n${body}\n</scheduled-task>`));
  assert.equal(wrapPrompt('x', '/f', `---\r\nname: x\r\ndescription: y\r\n---\r\n\r\n${body}\r\n`).replace(/\r/g, ''), expected);
  assert.equal(wrapPrompt('x', '/f', `\n\n${body}\n\n\n`), expected);
  assert.equal(wrapPrompt('x', '/f', `---\n---\n${body}`), expected);
  assert.equal(wrapPrompt('x', '/f', `---\nname: x\n---`), `<scheduled-task name="x" file="/f">\n${PREAMBLE}\n\n\n</scheduled-task>`);
});

test('Capcom\'s transcript reader recognises the wrapped prompt as a routine run', () => {
  const dir = fs.mkdtempSync(path.join(base, 'transcript-'));
  const file = path.join(dir, 'abc.jsonl');
  const content = wrapPrompt('daily-scrum', '/x/SKILL.md', '---\nname: daily-scrum\n---\n\nDo it.');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', cwd: '/home/x', message: { role: 'user', content } })}\n`);
  const head = readHead({ file, size: fs.statSync(file).size });
  assert.equal(head.routine, 'daily-scrum');
  assert.equal(head.cwd, '/home/x');
});

// ---- times -----------------------------------------------------------------------------------------

test('local times read back, with their offset, in any zone', () => {
  const t = at(2026, 10, 16, 7, 42, 17);
  assert.equal(localIso(t), '2026-10-16T07:42:17+11:00');
  assert.equal(stamp(t), '2026-10-16 07:42:17');
  assert.equal(Date.parse(localIso(t)), t);
  for (const [zone, offset] of [['Asia/Kolkata', '+05:30'], ['America/New_York', '-04:00'], ['UTC', '+00:00'], ['Australia/Brisbane', '+10:00']]) {
    process.env.TZ = zone;
    const u = Date.UTC(2026, 9, 16, 12, 0, 0);
    assert.ok(localIso(u).endsWith(offset), `${zone}: ${localIso(u)}`);
    assert.equal(Date.parse(localIso(u)), u);
  }
  process.env.TZ = 'Australia/Sydney';
});

// ---- routines.json ---------------------------------------------------------------------------------

test('an old routines.json with enabledInDesktop and seededAt loads with no problem, and neither is in the file after the next write', async () => {
  const r = rig({ enabled: false });
  const old = JSON.parse(fs.readFileSync(path.join(r.state, 'routines.json'), 'utf8'));
  fs.writeFileSync(path.join(r.state, 'routines.json'), JSON.stringify({ seededAt: '2026-10-16T00:00:00+11:00', routines: old.routines.map(x => ({ ...x, enabledInDesktop: true })) }));
  const listed = r.sched.list();
  assert.equal(listed.problem, null);
  assert.deepEqual([listed.routines[0].problem, 'enabledInDesktop' in listed.routines[0], 'enabledInDesktop' in r.demo(), 'seededAt' in r.store.read()], [null, false, false, false]);
  assert.ok(fs.readFileSync(path.join(r.state, 'routines.json'), 'utf8').includes('enabledInDesktop'), 'reading alone leaves the file as it is');
  r.sched.setEnabled('demo', true);
  const text = fs.readFileSync(path.join(r.state, 'routines.json'), 'utf8');
  assert.ok(!text.includes('enabledInDesktop') && !text.includes('seededAt'), text);
  assert.equal(JSON.parse(text).routines[0].enabled, true);
  assert.deepEqual(fs.readdirSync(r.state).filter(f => f.endsWith('.tmp')), [], 'written through a temporary file that is gone');
});

test('a routines.json missing is an empty list', () => {
  assert.deepEqual(makeRoutines(fs.mkdtempSync(path.join(base, 'empty-'))).read(), { routines: [] });
});

test('a routines.json that cannot be read is reported and never written over', () => {
  const dir = fs.mkdtempSync(path.join(base, 'broken-'));
  const file = path.join(dir, 'routines.json');
  const store = makeRoutines(dir);
  for (const text of ['{ not json', '[]', '{"routines":"no"}', 'null']) {
    fs.writeFileSync(file, text);
    assert.match(store.read().problem, /^routines\.json cannot be read: /);
    assert.deepEqual(store.read().routines, []);
    assert.throws(() => store.update('a', { enabled: true }), e => e.status === 500 && /cannot be read/.test(e.message));
    assert.throws(() => store.add({ id: 'a' }), /cannot be read/);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
});

test('entries missing their optional fields are filled in, and a jitter is read as whole seconds', () => {
  const dir = fs.mkdtempSync(path.join(base, 'sparse-'));
  fs.writeFileSync(path.join(dir, 'routines.json'), JSON.stringify({ routines: [{ id: 'a', cron: '0 0 * * *', jitterSeconds: '12' }, { id: 'b', jitterSeconds: 737.5 }, { id: 'c', jitterSeconds: 'x' }] }));
  const { routines } = makeRoutines(dir).read();
  assert.deepEqual(routines.map(r => [r.id, r.title, r.jitterSeconds, r.enabled, r.armedAt, r.lastRunAt]), [['a', 'a', 12, false, null, null], ['b', 'b', 738, false, null, null], ['c', 'c', 0, false, null, null]]);
});

test('a routine without an id, or an id used twice, is a problem with the file, so nothing runs and nothing is written over', async () => {
  for (const [entries, why] of [
    [[{ id: 'a' }, { title: 'no id' }], /every routine needs an id/],
    [[{ id: 'a' }, 'junk'], /every routine needs an id/],
    [[{ id: 'a' }, { id: 7 }], /every routine needs an id/],
    [[{ id: 'a' }, { id: 'b' }, { id: 'a' }], /more than one routine has the id "a"/],
  ]) {
    const r = rig();
    const text = JSON.stringify({ routines: entries.map(e => (typeof e === 'object' ? { cron: '30 7 * * 1-5', jitterSeconds: 737, file: r.file, cwd: r.state, enabled: true, armedAt: localIso(T0), ...e } : e)) });
    fs.writeFileSync(path.join(r.state, 'routines.json'), text);
    assert.match(r.store.read().problem, why);
    assert.deepEqual(r.store.read().routines, []);
    await r.tickAt(FRIDAY + 3000);
    assert.equal(r.calls.length, 0);
    assert.match(r.sched.list().problem, why);
    assert.throws(() => r.store.update('a', { enabled: false }), e => e.status === 500 && why.test(e.message));
    assert.equal(fs.readFileSync(path.join(r.state, 'routines.json'), 'utf8'), text, 'the file is left as it was');
  }
});

// ---- the rules -------------------------------------------------------------------------------------

test('dueAction: waits until the fire, jitter included, then runs', () => {
  const routine = { cron: '30 7 * * 1-5', jitterSeconds: 737, armedAt: localIso(T0), lastRunAt: null };
  assert.deepEqual(dueAction(routine, FRIDAY - 1000), { action: 'wait' });
  assert.deepEqual(dueAction({ ...routine, jitterSeconds: 0 }, at(2026, 10, 16, 7, 30) - 1000), { action: 'wait' });
  assert.deepEqual(dueAction(routine, FRIDAY), { action: 'run', fireAt: FRIDAY, late: 0 });
  assert.deepEqual(dueAction(routine, FRIDAY + 20_000), { action: 'run', fireAt: FRIDAY, late: 20_000 });
});

test('dueAction: the latest missed fire runs if it is under 12 hours late, and is skipped if not', () => {
  const routine = { cron: '30 7 * * 1-5', jitterSeconds: 737, armedAt: localIso(T0), lastRunAt: null };
  assert.equal(CATCH_UP_MS, 12 * HOUR);
  assert.deepEqual(dueAction(routine, FRIDAY + 3 * HOUR + 12 * 60_000), { action: 'run', fireAt: FRIDAY, late: 3 * HOUR + 12 * 60_000 });
  assert.equal(dueAction(routine, FRIDAY + 12 * HOUR - 1000).action, 'run');
  assert.equal(dueAction(routine, FRIDAY + 12 * HOUR).action, 'skip', 'exactly 12 hours is not under 12 hours');
  assert.deepEqual(dueAction(routine, FRIDAY + 20 * HOUR), { action: 'skip', fireAt: FRIDAY, late: 20 * HOUR });
  const three = dueAction(routine, at(2026, 10, 20, 10));
  assert.deepEqual([three.action, three.fireAt], ['run', at(2026, 10, 20, 7, 42, 17)], 'Friday, Monday and Tuesday were missed; only Tuesday counts');
  const week = dueAction(routine, at(2026, 11, 5, 9));
  assert.deepEqual([week.action, week.fireAt], ['run', at(2026, 11, 5, 7, 42, 17)]);
  assert.equal(dueAction(routine, at(2026, 11, 5, 21)).action, 'skip');
});

test('dueAction: it counts from armedAt alone, which a number or a time both give', () => {
  const on = { cron: '30 7 * * 1-5', jitterSeconds: 737 };
  assert.deepEqual(dueAction({ ...on, armedAt: null }, FRIDAY), { action: 'arm' });
  assert.deepEqual(dueAction({ ...on, armedAt: 'nonsense' }, FRIDAY), { action: 'arm' });
  assert.deepEqual(dueAction({ ...on, armedAt: null, lastRunAt: localIso(T0) }, FRIDAY), { action: 'arm' }, 'a last run on its own is only a record');
  const switchedOnAfterToday = { ...on, armedAt: localIso(at(2026, 10, 16, 10)) };
  assert.equal(dueAction(switchedOnAfterToday, at(2026, 10, 16, 10, 5)).action, 'wait', 'a fire already past when it was switched on is not caught up');
  assert.equal(dueAction(switchedOnAfterToday, MONDAY).action, 'run');
  assert.equal(dueAction({ ...on, armedAt: localIso(T0), lastRunAt: localIso(at(2026, 10, 16, 9)) }, FRIDAY).action, 'run', 'lastRunAt does not move it');
  assert.equal(dueAction({ ...on, armedAt: localIso(at(2026, 10, 15, 8)) }, at(2026, 10, 15, 8, 5)).action, 'wait');
  assert.equal(dueAction({ ...on, armedAt: localIso(at(2027, 1, 1)) }, FRIDAY).action, 'wait', 'a clock that was ahead waits for the real time to catch up');
  assert.equal(dueAction({ ...on, armedAt: FRIDAY - 60_000 }, FRIDAY).action, 'run', 'a time in milliseconds works as well as a string');
  assert.equal(dueAction({ ...on, armedAt: FRIDAY + 3000 }, FRIDAY + 4 * HOUR).action, 'wait');
});

test('dueAction: a schedule that cannot be read throws, and one that never fires waits', () => {
  assert.throws(() => dueAction({ cron: 'nonsense', jitterSeconds: 0, armedAt: localIso(T0) }, FRIDAY), /five fields/);
  assert.deepEqual(dueAction({ cron: '0 0 31 2 *', jitterSeconds: 0, armedAt: localIso(T0) }, FRIDAY), { action: 'wait' });
});

// ---- the scheduler ---------------------------------------------------------------------------------

test('a routine fires once at its time, with Desktop\'s prompt, and not again until its next time', async () => {
  const r = rig();
  await r.tickAt(FRIDAY - 1000);
  assert.equal(r.calls.length, 0);
  await r.tickAt(FRIDAY);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].text, wrapPrompt('demo', r.file, r.raw));
  assert.ok(r.calls[0].text.includes('\nCheck the thing.\n</scheduled-task>'));
  assert.deepEqual([r.calls[0].routine.cwd, r.calls[0].routine.mode, r.calls[0].routine.model, r.calls[0].routine.effort, r.calls[0].routine.title], [r.state, 'bypassPermissions', 'haiku', 'low', 'Demo routine']);
  const saved = r.demo();
  assert.deepEqual([saved.lastSessionId, saved.lastError, Date.parse(saved.lastRunAt)], ['s1', null, FRIDAY]);
  assert.deepEqual(r.logs, ['Routine demo: started session s1 (due 2026-10-16 07:42:17)']);
  for (const later of [FRIDAY + 30_000, FRIDAY + 60_000, FRIDAY + 4 * HOUR, at(2026, 10, 17, 12), at(2026, 10, 18, 12), MONDAY - 1000]) await r.tickAt(later);
  assert.equal(r.calls.length, 1, 'nothing on the rest of Friday or the weekend');
  await r.tickAt(MONDAY + 12_000);
  assert.equal(r.calls.length, 2);
  assert.equal(r.demo().lastSessionId, 's2');
  assert.deepEqual(r.warns, []);
});

test('the tick that runs a little late still counts as on time, and one that runs much later is logged as a catch-up', async () => {
  const late = rig();
  await late.tickAt(FRIDAY + 90_000);
  assert.deepEqual(late.logs, ['Routine demo: started session s1 (due 2026-10-16 07:42:17)']);
  const wake = rig();
  await wake.tickAt(FRIDAY + 3 * HOUR + 12 * 60_000);
  assert.deepEqual(wake.logs, ['Routine demo: started session s1 (catch-up for 2026-10-16 07:42:17, 3 h 12 min late)']);
});

test('a routine that is switched off never fires', async () => {
  const r = rig({ enabled: false });
  for (const t of [FRIDAY, FRIDAY + HOUR, MONDAY]) await r.tickAt(t);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.logs, []);
});

test('switching on starts the schedule from now, so a fire already past is not run on top of Desktop\'s', async () => {
  const r = rig({ enabled: false });
  r.clock.t = at(2026, 10, 16, 10);
  const summary = r.sched.setEnabled('demo', true);
  assert.equal(summary.enabled, true);
  assert.equal(Date.parse(r.demo().armedAt), at(2026, 10, 16, 10));
  await r.tickAt(at(2026, 10, 16, 10, 0, 30));
  await r.tickAt(at(2026, 10, 16, 11));
  assert.equal(r.calls.length, 0);
  await r.tickAt(MONDAY);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.logs, ['Routine demo: switched on', 'Routine demo: started session s1 (due 2026-10-19 07:42:17)']);
});

test('switching on and off is checked, repeated safely, and refused when the routine could not run', async () => {
  const r = rig({ enabled: false });
  assert.throws(() => r.sched.setEnabled('demo', 'yes'), e => e.status === 400 && /true or false/.test(e.message));
  assert.throws(() => r.sched.setEnabled('demo', undefined), e => e.status === 400);
  assert.throws(() => r.sched.setEnabled('nope', true), e => e.status === 404);
  r.sched.setEnabled('demo', true);
  const armed = r.demo().armedAt;
  r.clock.t += HOUR;
  assert.equal(r.sched.setEnabled('demo', true).enabled, true);
  assert.equal(r.demo().armedAt, armed, 'switching on twice does not move the start');
  assert.equal(r.sched.setEnabled('demo', false).enabled, false);
  assert.equal(r.sched.setEnabled('demo', false).enabled, false);
  assert.equal(r.demo().enabled, false);
  r.store.update('demo', { cwd: '/no/such/folder' });
  assert.throws(() => r.sched.setEnabled('demo', true), e => e.status === 400 && /cannot be switched on\. The folder does not exist\./.test(e.message));
  r.store.update('demo', { cwd: r.state, cron: 'nonsense' });
  assert.throws(() => r.sched.setEnabled('demo', true), e => e.status === 400 && /five fields/.test(e.message));
  r.store.update('demo', { cron: '30 7 * * 1-5', file: path.join(r.state, 'gone.md') });
  assert.throws(() => r.sched.setEnabled('demo', true), e => e.status === 400 && /Cannot read .*gone\.md/.test(e.message));
  assert.equal(r.demo().enabled, false);
});

test('a fire missed while the Mac slept runs once on waking, however many were missed', async () => {
  const r = rig();
  await r.tickAt(at(2026, 10, 20, 10));
  assert.equal(r.calls.length, 1);
  assert.match(r.logs[0], /catch-up for 2026-10-20 07:42:17, 2 h 18 min late/);
  await r.tickAt(at(2026, 10, 20, 10, 0, 30));
  await r.tickAt(at(2026, 10, 20, 11));
  assert.equal(r.calls.length, 1, 'no second catch-up');
  await r.tickAt(at(2026, 10, 21, 7, 42, 30));
  assert.equal(r.calls.length, 2, 'and the schedule carries on');
});

test('a fire missed by 12 hours or more is skipped, said so, and not run later', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 12 * HOUR);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.logs, ['Routine demo: skipped the 2026-10-16 07:42:17 run (12 h late, over the 12 h limit)']);
  const saved = r.demo();
  assert.deepEqual(saved.skipped, { fireAt: localIso(FRIDAY), at: localIso(FRIDAY + 12 * HOUR), reason: '12 h late, over the 12 h limit' });
  assert.equal(Date.parse(saved.armedAt), FRIDAY + 12 * HOUR);
  assert.equal(saved.lastRunAt, null);
  await r.tickAt(FRIDAY + 12 * HOUR + 30_000);
  await r.tickAt(FRIDAY + 13 * HOUR);
  assert.equal(r.calls.length, 0);
  assert.equal(r.logs.length, 1, 'said once');
  await r.tickAt(MONDAY + 5000);
  assert.equal(r.calls.length, 1);
  assert.equal(r.demo().skipped, null, 'a run clears the note of the skip');
});

test('after several days off, a stale fire is skipped and a fire inside the window runs', async () => {
  const stale = rig();
  await stale.tickAt(at(2026, 10, 17, 12));
  assert.deepEqual(stale.logs, ['Routine demo: skipped the 2026-10-16 07:42:17 run (28 h 18 min late, over the 12 h limit)']);
  assert.equal(stale.calls.length, 0);
});

test('a run is never started while the one before it is still working', async () => {
  const r = rig({ cron: '0 7 * * *', jitter: 0 });
  await r.tickAt(at(2026, 10, 16, 7));
  assert.equal(r.calls.length, 1);
  r.working.add('s1');
  await r.tickAt(at(2026, 10, 17, 7, 0, 5));
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.logs.at(-1), 'Routine demo: skipped the 2026-10-17 07:00:00 run (the previous run is still working)');
  assert.equal(r.demo().skipped.reason, 'the previous run is still working');
  await r.tickAt(at(2026, 10, 17, 7, 1));
  assert.equal(r.calls.length, 1, 'the skipped fire is not held over for when the run ends');
  r.working.delete('s1');
  await r.tickAt(at(2026, 10, 17, 9));
  assert.equal(r.calls.length, 1);
  await r.tickAt(at(2026, 10, 18, 7, 0, 5));
  assert.equal(r.calls.length, 2);
});

test('a run now is refused while the routine is working, and allowed once it has finished', async () => {
  const r = rig();
  const first = await r.sched.runNow('demo');
  assert.equal(first.sessionId, 's1');
  assert.equal(first.routine.id, 'demo');
  assert.equal(first.routine.lastSessionId, 's1');
  r.working.add('s1');
  assert.equal(r.sched.list().routines[0].running, true);
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 409 && /still running/.test(e.message));
  assert.equal(r.calls.length, 1);
  r.working.delete('s1');
  assert.equal(r.sched.list().routines[0].running, false);
  assert.equal((await r.sched.runNow('demo')).sessionId, 's2');
  await assert.rejects(r.sched.runNow('nope'), e => e.status === 404);
});

test('a session that is still starting counts as running, so a second tick or a run now cannot double it', async () => {
  const r = rig();
  let release;
  r.onStart = () => new Promise(done => { release = done; });
  const first = r.tickAt(FRIDAY);
  assert.equal(r.calls.length, 1);
  assert.equal(r.sched.list().routines[0].running, true);
  const again = r.tickAt(FRIDAY + 30_000);
  await again;
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 409);
  assert.equal(r.calls.length, 1);
  assert.equal(r.demo().lastSessionId, null);
  release();
  await first;
  assert.equal(r.demo().lastSessionId, 's1');
  assert.equal(r.sched.list().routines[0].running, false);
  assert.equal(r.calls.length, 1);
});

test('a run now works for a routine that is switched off, and uses up fires already due but not ones to come', async () => {
  const r = rig({ enabled: false });
  r.clock.t = FRIDAY - 2 * 60_000;
  await r.sched.runNow('demo');
  assert.equal(r.demo().enabled, false);
  r.sched.setEnabled('demo', true);
  await r.tickAt(FRIDAY + 10_000);
  assert.equal(r.calls.length, 2, 'the manual run, then the fire two minutes later');
  const m = rig();
  m.clock.t = FRIDAY - 2 * 60_000;
  await m.sched.runNow('demo');
  await m.tickAt(FRIDAY + 10_000);
  assert.equal(m.calls.length, 2, 'a manual run two minutes before the fire does not stop the fire');
  const late = rig();
  late.clock.t = FRIDAY + 5 * 60_000;
  await late.sched.runNow('demo');
  await late.tickAt(FRIDAY + 6 * 60_000);
  assert.equal(late.calls.length, 1, 'a manual run after the fire time takes its place');
});

test('a session that fails to start is recorded and not retried into a second run', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('Claude did not start within 60 seconds'); };
  await r.tickAt(FRIDAY);
  assert.equal(r.calls.length, 1);
  const saved = r.demo();
  assert.deepEqual([saved.lastSessionId, saved.lastError], [null, 'Claude did not start within 60 seconds']);
  assert.equal(Date.parse(saved.lastRunAt), FRIDAY);
  assert.deepEqual(r.warns, ['Routine demo: could not start (Claude did not start within 60 seconds)']);
  await r.tickAt(FRIDAY + 30_000);
  await r.tickAt(FRIDAY + HOUR);
  assert.equal(r.calls.length, 1);
  assert.equal(r.sched.list().routines[0].running, false);
  r.onStart = null;
  await r.tickAt(MONDAY + 1000);
  assert.equal(r.calls.length, 2);
  assert.equal(r.demo().lastError, null, 'the next success clears the error');
  r.onStart = async () => { throw new Error('boom'); };
  await assert.rejects(r.sched.runNow('demo'), /boom/);
  assert.equal(r.demo().lastError, 'boom');
});

test('a missing prompt file or a folder that is gone is a clear refusal that does not start anything', async () => {
  const r = rig();
  r.store.update('demo', { file: path.join(r.state, 'gone.md') });
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 400 && /Cannot read .*gone\.md/.test(e.message));
  assert.match(r.demo().lastError, /Cannot read/);
  r.store.update('demo', { file: r.file, cwd: '/no/such/folder' });
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 400 && /The folder does not exist/.test(e.message));
  await r.tickAt(FRIDAY);
  assert.equal(r.calls.length, 0);
  assert.match(r.warns.at(-1), /could not start \(The folder does not exist\.\)/);
});

test('the prompt file is read afresh at each run, so an edit applies at once', async () => {
  const r = rig();
  await r.tickAt(FRIDAY);
  fs.writeFileSync(r.file, '---\nname: demo\ndescription: Edited\n---\n\nA new instruction.\n');
  await r.tickAt(MONDAY);
  assert.ok(r.calls[0].text.includes('Check the thing.'));
  assert.ok(r.calls[1].text.includes('A new instruction.'));
  assert.ok(!r.calls[1].text.includes('Check the thing.'));
});

test('a restart keeps the schedule: nothing runs twice, and a fire missed while down is caught up', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 3000);
  assert.equal(r.calls.length, 1);
  r.boot();
  await r.tickAt(FRIDAY + 60_000);
  await r.tickAt(at(2026, 10, 16, 12));
  assert.equal(r.calls.length, 1, 'a new scheduler on the same file does not run it again');
  assert.equal(r.sched.list().routines[0].next, localIso(MONDAY));
  r.boot();
  await r.tickAt(at(2026, 10, 19, 9, 30));
  assert.equal(r.calls.length, 2, 'down over Monday\'s fire, up at 09:30, so it catches up');
  assert.match(r.logs.at(-1), /catch-up for 2026-10-19 07:42:17, 1 h 48 min late/);
});

test('a run that was working when Capcom stopped is no longer working after it starts again', async () => {
  const r = rig();
  await r.tickAt(FRIDAY);
  r.working.add('s1');
  assert.equal(r.sched.list().routines[0].running, true);
  r.boot();
  r.working.clear();
  assert.equal(r.sched.list().routines[0].running, false);
  assert.equal((await r.sched.runNow('demo')).sessionId, 's2');
});

test('a routine switched on by hand in routines.json is armed from that moment, not caught up', async () => {
  const r = rig({ enabled: false });
  r.store.update('demo', { enabled: true });
  await r.tickAt(FRIDAY + 2 * HOUR);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.logs, ['Routine demo: is on but was never armed, so it counts from 2026-10-16 09:42:17']);
  await r.tickAt(MONDAY + 1000);
  assert.equal(r.calls.length, 1);
});

test('a hand edit to routines.json shows on the next check', async () => {
  const r = rig();
  r.store.update('demo', { cron: '0 9 * * *', jitterSeconds: 0 });
  await r.tickAt(at(2026, 10, 16, 7, 50));
  assert.equal(r.calls.length, 0, 'the old time passes without a run');
  await r.tickAt(at(2026, 10, 16, 9, 0, 10));
  assert.equal(r.calls.length, 1);
});

test('one routine that cannot run does not stop the others, and a bad schedule is said once', async () => {
  const state = fs.mkdtempSync(path.join(base, 'many-'));
  const store = makeRoutines(state);
  const files = ['a', 'b', 'c'].map(id => { const f = path.join(state, `${id}.md`); fs.writeFileSync(f, `---\nname: ${id}\n---\n\nBody ${id}\n`); return f; });
  put(state, [
    fixture(files[0], state, { id: 'a', cron: '0 7 * * *', jitterSeconds: 0 }),
    fixture(files[1], state, { id: 'b', cron: '0 7 * * *', jitterSeconds: 0 }),
    fixture(files[2], state, { id: 'c', cron: '0 7 * * *', jitterSeconds: 0 }),
  ]);
  for (const id of ['a', 'b', 'c']) store.update(id, { enabled: true, armedAt: localIso(T0) });
  store.update('b', { cron: 'nonsense' });
  const clock = { t: at(2026, 10, 16, 7, 0, 5) };
  const started = [];
  const warns = [];
  const sched = makeScheduler({ store, now: () => clock.t, log: () => {}, warn: l => warns.push(l), working: () => false,
    start: async routine => { started.push(routine.id); if (routine.id === 'a') throw new Error('a failed'); return `s-${routine.id}`; } });
  await sched.tick();
  await sched.tick();
  clock.t += 30_000;
  await sched.tick();
  assert.deepEqual(started, ['a', 'c']);
  assert.equal(store.read().routines.find(r => r.id === 'c').lastSessionId, 's-c');
  assert.equal(store.read().routines.find(r => r.id === 'a').lastError, 'a failed');
  assert.equal(warns.filter(w => /five fields/.test(w)).length, 1, 'the bad schedule is said once');
  assert.equal(warns.filter(w => /a failed/.test(w)).length, 1);
});

test('a routines.json that cannot be read stops the check without throwing, and is said once', async () => {
  const r = rig();
  fs.writeFileSync(path.join(r.state, 'routines.json'), '{ broken');
  await r.tickAt(FRIDAY);
  await r.tickAt(FRIDAY + 30_000);
  assert.equal(r.calls.length, 0);
  assert.equal(r.warns.length, 1);
  assert.match(r.warns[0], /routines\.json cannot be read/);
  assert.equal(r.sched.list().problem.includes('cannot be read'), true);
  assert.deepEqual(r.sched.list().routines, []);
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 500);
});

test('the list shows each routine with its next fire in local time, whether it is running, and what is wrong with it', () => {
  const r = rig({ enabled: false });
  const [item] = r.sched.list().routines;
  assert.deepEqual(Object.keys(item), ['id', 'title', 'cron', 'jitterSeconds', 'file', 'cwd', 'model', 'effort', 'mode', 'enabled', 'armedAt', 'lastRunAt', 'lastSessionId', 'lastError', 'skipped', 'running', 'next', 'problem']);
  assert.deepEqual([item.id, item.title, item.enabled, item.running, item.problem], ['demo', 'Demo routine', false, false, null]);
  assert.equal(item.next, '2026-10-16T07:42:17+11:00');
  r.store.update('demo', { cron: 'nonsense' });
  const bad = r.sched.list().routines[0];
  assert.equal(bad.next, null);
  assert.match(bad.problem, /five fields/);
  r.store.update('demo', { cron: '0 0 31 2 *' });
  assert.equal(r.sched.list().routines[0].next, null);
  r.store.update('demo', { cron: '30 7 * * 1-5', file: '/nope/SKILL.md' });
  assert.equal(r.sched.list().routines[0].problem, 'Cannot read /nope/SKILL.md.');
  r.store.update('demo', { file: r.file, cwd: '/no/such/folder' });
  assert.equal(r.sched.list().routines[0].problem, 'The folder does not exist.');
});

test('when the clocks go back, a routine in the repeated hour runs once', async () => {
  const r = rig({ cron: '30 2 * * *', jitter: 0, armed: at(2027, 4, 3, 12) });
  const first = at(2027, 4, 4, 2, 30, 10);
  const second = first + HOUR;
  assert.equal(stamp(second), stamp(first), 'the same wall-clock time, an hour apart');
  await r.tickAt(first);
  assert.equal(r.calls.length, 1);
  await r.tickAt(second);
  await r.tickAt(second + 30_000);
  assert.equal(r.calls.length, 1);
  await r.tickAt(at(2027, 4, 5, 2, 30, 10));
  assert.equal(r.calls.length, 2);
});

test('only a true switches a routine on, so a hand-written "false" or 1 never runs one, and it is said', async () => {
  const state = fs.mkdtempSync(path.join(base, 'strict-'));
  const file = path.join(state, 'SKILL.md');
  fs.writeFileSync(file, '---\nname: x\n---\n\nBody\n');
  const entry = (id, enabled) => ({ ...fixture(file, state, { id, cron: '0 7 * * *', jitterSeconds: 0 }), enabled, armedAt: localIso(T0), lastRunAt: null });
  fs.writeFileSync(path.join(state, 'routines.json'), JSON.stringify({ routines: [entry('a', 'false'), entry('b', 1), entry('c', 'true'), entry('d', null), entry('e', true)] }));
  const store = makeRoutines(state);
  const started = [];
  const warns = [];
  const sched = makeScheduler({ store, now: () => at(2026, 10, 16, 7, 0, 5), log: () => {}, warn: w => warns.push(w), working: () => false, start: async r => { started.push(r.id); return `s-${r.id}`; } });
  await sched.tick();
  await sched.tick();
  assert.deepEqual(started, ['e']);
  assert.equal(warns.filter(w => /enabled flag must be true or false/.test(w)).length, 4, 'said once for each of the four, not once per check');
  const listed = Object.fromEntries(sched.list().routines.map(r => [r.id, r.problem]));
  assert.match(listed.a, /enabled flag must be true or false/);
  assert.equal(listed.e, null);
  assert.equal(store.read().routines.find(r => r.id === 'a').armedAt, null, 'a routine that is not on keeps no place in its schedule');
  assert.equal(sched.setEnabled('a', true).enabled, true, 'switching it on through the API repairs the flag');
  assert.equal(store.read().routines.find(r => r.id === 'a').enabled, true);
});

test('trouble with one routine in a check does not stop the others', async () => {
  const state = fs.mkdtempSync(path.join(base, 'isolate-'));
  const store = makeRoutines(state);
  const files = ['a', 'b'].map(id => { const f = path.join(state, `${id}.md`); fs.writeFileSync(f, `---\nname: ${id}\n---\n\nBody ${id}\n`); return f; });
  put(state, [
    fixture(files[0], state, { id: 'a', cron: '0 7 * * *', jitterSeconds: 0 }),
    fixture(files[1], state, { id: 'b', cron: '0 20 * * *', jitterSeconds: 0 }),
  ]);
  store.update('a', { enabled: true, armedAt: localIso(at(2026, 10, 14)) });
  store.update('b', { enabled: true, armedAt: localIso(T0) });
  const failing = { ...store, update: (id, patch) => { if (id === 'a') throw new Error('disk full'); return store.update(id, patch); } };
  const warns = [];
  const started = [];
  const sched = makeScheduler({ store: failing, now: () => at(2026, 10, 16, 20, 0, 5), log: () => {}, warn: w => warns.push(w), working: () => false, start: async r => { started.push(r.id); return `s-${r.id}`; } });
  await sched.tick();
  assert.deepEqual(started, ['b'], 'a was 13 hours late, so skipping it needs a write, which fails; b still runs');
  assert.deepEqual(warns, ['Routine a: disk full']);
  assert.equal(store.read().routines.find(r => r.id === 'b').lastSessionId, 's-b');
});

test('a change of the Mac\'s time zone is followed, and an unknown zone is ignored', () => {
  const dir = fs.mkdtempSync(path.join(base, 'zone-'));
  const zones = ['Australia/Sydney', 'Australia/Brisbane', 'Nope/Zone'];
  for (const zone of zones) {
    fs.mkdirSync(path.join(dir, 'zoneinfo', path.dirname(zone)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'zoneinfo', zone), '');
  }
  const link = path.join(dir, 'localtime');
  const point = zone => { try { fs.unlinkSync(link); } catch {} fs.symlinkSync(path.join(dir, 'zoneinfo', zone), link); };
  const offset = () => new Date(2026, 9, 15, 12).getTimezoneOffset();
  const logs = [];
  process.env.TZ = 'Australia/Sydney';
  point('Australia/Sydney');
  const follow = makeZoneFollower({ link, log: l => logs.push(l) });
  follow();
  assert.deepEqual([offset(), logs.length], [-660, 0], 'the zone Node started in is taken as right');
  point('Australia/Brisbane');
  follow();
  assert.deepEqual([offset(), process.env.TZ, logs], [-600, 'Australia/Brisbane', ['The Mac\'s time zone is now Australia/Brisbane, so routines follow it.']]);
  assert.equal(nextFireLocalHour('30 7 * * *'), 7, 'the schedule is now read in Brisbane time');
  follow();
  assert.equal(logs.length, 1, 'said once');
  point('Nope/Zone');
  follow();
  assert.deepEqual([offset(), process.env.TZ, logs.length], [-600, 'Australia/Brisbane', 1], 'a zone Intl refuses is not applied');
  fs.unlinkSync(link);
  follow();
  assert.equal(offset(), -600, 'a missing link changes nothing');
  assert.doesNotThrow(() => makeZoneFollower({ link: path.join(dir, 'no-such-link') })());
  process.env.TZ = 'Australia/Sydney';
});

function nextFireLocalHour(cron) {
  return new Date(nextFire(cron, at(2026, 10, 15, 12))).getHours();
}

test('a routine switched on by hand starts from then, whatever it did before, so it never repeats a run Desktop made', async () => {
  // A trial run on Monday afternoon while it is off, then Desktop runs Tuesday's fire, then it is switched on by hand at 09:00.
  const trial = rig({ enabled: false });
  trial.clock.t = at(2026, 10, 19, 16);
  await trial.sched.runNow('demo');
  assert.equal(trial.demo().armedAt, null, 'a run now on a routine that is off does not give it a place in its schedule');
  trial.store.update('demo', { enabled: true });
  await trial.tickAt(at(2026, 10, 20, 9));
  assert.equal(trial.calls.length, 1, 'Tuesday 07:42:17 is not caught up');
  assert.deepEqual(trial.logs.slice(-1), ['Routine demo: is on but was never armed, so it counts from 2026-10-20 09:00:00']);
  await trial.tickAt(at(2026, 10, 21, 7, 42, 30));
  assert.equal(trial.calls.length, 2, 'and the next fire is its own');

  // Switched off through the API and on again by hand.
  const api = rig();
  await api.tickAt(FRIDAY + 3000);
  api.sched.setEnabled('demo', false);
  assert.equal(api.demo().armedAt, null);
  api.store.update('demo', { enabled: true });
  await api.tickAt(at(2026, 10, 19, 9));
  assert.equal(api.calls.length, 1, 'Monday 07:42:17 is not caught up');

  // Switched off by hand and on again by hand, with a check in between.
  const hand = rig();
  await hand.tickAt(FRIDAY + 3000);
  hand.store.update('demo', { enabled: false });
  await hand.tickAt(FRIDAY + 60_000);
  assert.equal(hand.demo().armedAt, null, 'the check lets go of its place in the schedule');
  hand.store.update('demo', { enabled: true });
  await hand.tickAt(at(2026, 10, 19, 9));
  assert.equal(hand.calls.length, 1);
});

test('an older copy of routines.json saved over it does not run a fire again, or forget a session that is working', async () => {
  const r = rig();
  const before = fs.readFileSync(path.join(r.state, 'routines.json'), 'utf8');
  await r.tickAt(FRIDAY + 3000);
  assert.equal(r.calls.length, 1);
  r.working.add('s1');
  fs.writeFileSync(path.join(r.state, 'routines.json'), before);
  assert.equal(r.demo().lastSessionId, null, 'the editor put the old record back');
  assert.equal(r.sched.list().routines[0].running, true, 'the session this process started still counts');
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 409);
  await r.tickAt(FRIDAY + 3 * 60_000);
  await r.tickAt(FRIDAY + HOUR);
  assert.equal(r.calls.length, 1, 'no second run of the same fire, working or not');
  r.working.clear();
  await r.tickAt(FRIDAY + 2 * HOUR);
  assert.equal(r.calls.length, 1);
  await r.tickAt(MONDAY + 5000);
  assert.equal(r.calls.length, 2, 'the next fire still comes');
});

test('a routine that is off keeps no place in its schedule, and one that is on keeps the place its last run gave it', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 3000);
  assert.equal(Date.parse(r.demo().armedAt), FRIDAY + 3000, 'a run while on moves the place to the run');
  assert.equal(Date.parse(r.demo().lastRunAt), FRIDAY + 3000);
  r.sched.setEnabled('demo', false);
  assert.deepEqual([r.demo().enabled, r.demo().armedAt], [false, null]);
  assert.equal(r.demo().lastRunAt !== null, true, 'the record of the last run stays');
});

// ---- the limit and stuck runs ----------------------------------------------------------------------

// Four routines due at the same moment, Friday 07:00, all switched on the evening before.
function crowd(limit) {
  const state = fs.mkdtempSync(path.join(base, 'crowd-'));
  const file = path.join(state, 'SKILL.md');
  fs.writeFileSync(file, '---\nname: x\n---\n\nDo it.\n');
  const store = makeRoutines(state);
  const ids = ['a', 'b', 'c', 'd'];
  put(state, ids.map(id => fixture(file, state, { id, title: id, cron: '0 7 * * 5', jitterSeconds: 0 })));
  for (const id of ids) store.update(id, { enabled: true, armedAt: localIso(T0) });
  const c = { store, clock: { t: T0 }, started: [], running: new Set(), logs: [] };
  c.sched = makeScheduler({
    store, limit, now: () => c.clock.t, log: l => c.logs.push(l), warn: () => {},
    start: async routine => { const id = `run-${routine.id}`; c.started.push(routine.id); c.running.add(id); return id; },
    working: id => c.running.has(id),
  });
  c.tickAt = async t => { c.clock.t = t; await c.sched.tick(); };
  return c;
}

test('no more than the limit start at once, and the rest wait their turn without being skipped', async () => {
  const c = crowd(3);
  await c.tickAt(at(2026, 10, 16, 7, 0, 5));
  assert.deepEqual(c.started, ['a', 'b', 'c']);
  await c.tickAt(at(2026, 10, 16, 7, 1, 0));
  assert.deepEqual(c.started, ['a', 'b', 'c']);
  assert.equal(c.store.read().routines.find(r => r.id === 'd').skipped, null);
  assert.equal(c.logs.filter(l => /waiting for a free place/.test(l)).length, 1);
  c.running.delete('run-b');
  await c.tickAt(at(2026, 10, 16, 7, 9, 0));
  assert.deepEqual(c.started, ['a', 'b', 'c', 'd']);
  await c.tickAt(at(2026, 10, 16, 7, 10, 0));
  assert.deepEqual(c.started, ['a', 'b', 'c', 'd']);
});

test('with no limit, every routine due starts on time', async () => {
  const c = crowd(Infinity);
  await c.tickAt(at(2026, 10, 16, 7, 0, 5));
  assert.deepEqual(c.started, ['a', 'b', 'c', 'd']);
});

test('a run only waiting for an answer is stopped and replaced when its routine is next due', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 5_000);
  assert.equal(r.calls.length, 1);
  r.working.add('s1');
  r.waiting.add('s1');
  await r.tickAt(MONDAY + 5_000);
  assert.deepEqual(r.stops, ['s1']);
  assert.equal(r.calls.length, 2);
  assert.ok(r.logs.some(l => /stopped s1, which was waiting for an answer/.test(l)));
});

test('a run still working is left alone and the next fire is skipped, as before', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 5_000);
  r.working.add('s1');
  await r.tickAt(MONDAY + 5_000);
  assert.deepEqual(r.stops, []);
  assert.equal(r.calls.length, 1);
  assert.match(r.demo().skipped.reason, /still working/);
});

test('run now replaces a stuck run, and refuses while the run is working', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 5_000);
  r.working.add('s1');
  await assert.rejects(r.sched.runNow('demo'), /still running/);
  r.waiting.add('s1');
  await r.sched.runNow('demo');
  assert.deepEqual(r.stops, ['s1']);
  assert.equal(r.calls.length, 2);
});

// ---- ids, adding, editing and deleting -------------------------------------------------------------

const MORNING = { title: 'Morning check', cron: '30 7 * * 1-5', jitterSeconds: 737, prompt: 'Look at the board.' };
const promptsOf = r => path.join(r.state, 'routines');
const rawOf = r => fs.readFileSync(path.join(r.state, 'routines.json'), 'utf8');
const refused = (status, problems) => e => e.status === status && (problems === undefined || JSON.stringify(Object.keys(e.problems)) === JSON.stringify(problems));

// A person or another program saving routines.json between two of Capcom's own writes.
function handEdit(r, change) {
  const file = path.join(r.state, 'routines.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(data);
  fs.writeFileSync(file, JSON.stringify(data));
}

test('a routine id is its title in lower case letters and single dashes, and a number is added while it is taken', () => {
  assert.equal(routineId('Morning check'), 'morning-check');
  assert.equal(routineId('  Daily   Scrum -- prep  '), 'daily-scrum-prep');
  const used = new Set(['demo', 'demo-2']);
  assert.equal(routineId('Demo', id => used.has(id)), 'demo-3');
  assert.equal(routineId('Demo', id => id !== 'demo-12'), 'demo-12');
  assert.equal(routineId('Other', id => used.has(id)), 'other');
});

test('the id new is kept for the add form\'s route, so a routine titled New gets new-2', () => {
  assert.equal(routineId('New'), 'new-2');
  assert.equal(routineId('  NEW!  '), 'new-2');
  assert.equal(routineId('New', id => id === 'new-2'), 'new-3');
  assert.equal(routineId('New thing'), 'new-thing');
  assert.equal(routineId('Newer'), 'newer');
});

test('a routine id drops accents, emoji and punctuation, falls back to "routine", and is cut to 40 characters', () => {
  for (const [title, id] of [
    ['Café Résumé', 'cafe-resume'], ['Ünïcödé ﬁne', 'unicode-fine'], ['🚀 Launch day!!', 'launch-day'], ['a/b\\c..d', 'a-b-c-d'], ['Weekly: "report" (draft)', 'weekly-report-draft'],
    ['', 'routine'], ['   ', 'routine'], ['!!!', 'routine'], ['日本語', 'routine'], ['😀😀', 'routine'], [undefined, 'routine'],
    ['x'.repeat(60), 'x'.repeat(40)], [`${'a'.repeat(39)} b`, 'a'.repeat(39)], ['abcdefghij abcdefghij abcdefghij abcdefghij xyz', 'abcdefghij-abcdefghij-abcdefghij-abcdefg'],
  ]) assert.equal(routineId(title), id, JSON.stringify(title));
  for (const title of ['x'.repeat(200), '🚀🚀', 'Ça va? Très bien -- 100%', '../../etc/passwd', 'a\u0000b']) assert.match(routineId(title, id => !id.endsWith('-3')), /^[\w-]+$/);
});

test('the next fire times of a schedule are three local times with jitter, none for one that never fires, and a message for a bad one', () => {
  assert.deepEqual(upcoming('30 7 * * 1-5', 737, T0), [localIso(FRIDAY), localIso(MONDAY), localIso(at(2026, 10, 20, 7, 42, 17))]);
  assert.equal(upcoming('*/15 * * * *', 0, T0, 2).length, 2);
  assert.deepEqual(upcoming('0 0 31 2 *', 0, T0), []);
  assert.throws(() => upcoming('nonsense', 0, T0), /five fields/);
  assert.throws(() => upcoming('61 * * * *', 0, T0), /outside/);
});

test('adding a routine writes its prompt in GhostShell\'s own folder, points the routine at it, and starts the schedule from now', async () => {
  const r = rig({ enabled: false });
  r.clock.t = at(2026, 10, 16, 10);
  const made = r.sched.add({ ...MORNING, cwd: r.state, model: 'haiku', effort: '', mode: null });
  const file = path.join(promptsOf(r), 'morning-check.md');
  assert.equal(made.id, 'morning-check');
  assert.deepEqual([made.file, made.title, made.cron, made.jitterSeconds, made.cwd, made.model, made.effort, made.mode], [file, 'Morning check', '30 7 * * 1-5', 737, r.state, 'haiku', null, null]);
  assert.deepEqual([made.enabled, made.armedAt, made.lastRunAt, made.lastSessionId, made.problem], [true, localIso(r.clock.t), null, null, null]);
  assert.equal(made.next, localIso(MONDAY));
  assert.equal(fs.readFileSync(file, 'utf8'), 'Look at the board.\n');
  assert.equal(fs.statSync(promptsOf(r)).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(promptsOf(r)), ['morning-check.md']);
  assert.deepEqual(r.store.read().routines.map(x => x.id), ['demo', 'morning-check']);
  await r.tickAt(at(2026, 10, 16, 10, 0, 30));
  await r.tickAt(at(2026, 10, 16, 12));
  assert.equal(r.calls.length, 0, 'a fire already past today is not run');
  await r.tickAt(MONDAY + 5000);
  assert.deepEqual(r.calls.map(c => c.routine.id), ['morning-check']);
  assert.equal(r.calls[0].text, wrapPrompt('morning-check', file, 'Look at the board.\n'));
  assert.ok(r.logs.includes('Routine morning-check: added and switched on'));
});

test('a routine added switched off is not armed, and one added with the defaults is on, with no jitter and no model', () => {
  const r = rig({ enabled: false });
  const off = r.sched.add({ ...MORNING, cwd: r.state, enabled: false });
  assert.deepEqual([off.enabled, off.armedAt], [false, null]);
  const plain = r.sched.add({ title: 'Plain', cron: '0 9 * * *', cwd: r.state, prompt: 'x' });
  assert.deepEqual([plain.enabled, plain.jitterSeconds, plain.model, plain.effort, plain.mode, plain.id], [true, 0, null, null, null, 'plain']);
  assert.equal(Date.parse(plain.armedAt), T0);
});

test('adding is refused with every bad field named, and nothing is written', () => {
  const r = rig({ enabled: false });
  const before = rawOf(r);
  assert.throws(() => r.sched.add({}), refused(400, ['title', 'cron', 'cwd', 'prompt']));
  assert.throws(() => r.sched.add({ title: '  ', cron: 'nonsense', jitterSeconds: 1.5, cwd: '/no/such/folder', model: 'bad model', prompt: '   ' }), refused(400, ['title', 'cron', 'jitterSeconds', 'cwd', 'model', 'prompt']));
  assert.throws(() => r.sched.add({ ...MORNING, cwd: r.state, title: 'x'.repeat(121) }), refused(400, ['title']));
  assert.throws(() => r.sched.add({ ...MORNING, cwd: r.state, jitterSeconds: 86400 }), refused(400, ['jitterSeconds']));
  assert.throws(() => r.sched.add({ ...MORNING, cwd: r.state, jitterSeconds: '12' }), refused(400, ['jitterSeconds']));
  assert.throws(() => r.sched.add({ ...MORNING, cwd: r.state, enabled: 'yes' }), e => e.status === 400 && /true or false/.test(e.message));
  assert.throws(() => r.sched.add({ ...MORNING, cwd: r.state, enabled: null }), e => e.status === 400 && /true or false/.test(e.message));
  assert.throws(() => r.sched.add(null), e => e.status === 400);
  try { r.sched.add({ title: '', cron: '61 * * * *', cwd: 'relative', prompt: '' }); } catch (e) {
    assert.match(e.message, /^Nothing was saved\. Check the title, schedule, folder and prompt\.$/);
    assert.match(e.problems.cron, /outside 0 to 59/);
    assert.match(e.problems.title, /title/);
  }
  assert.equal(rawOf(r), before);
  assert.equal(fs.existsSync(promptsOf(r)), false);
  const long = r.sched.add({ ...MORNING, cwd: r.state, title: '🚀'.repeat(120), jitterSeconds: 86399 });
  assert.deepEqual([[...long.title].length, long.jitterSeconds], [120, 86399]);
});

test('a title is read as a group\'s name is: one that draws nothing is refused, a bidi control is dropped, and an emoji keeps its joiners', () => {
  const r = rig({ enabled: false });
  const input = { ...MORNING, cwd: r.state };
  for (const title of ['\u200b', ' \u200b\u2060 ', '\u202e\u2069', '\u2800', '\ufe0f', '\u200b\t\n']) {
    assert.throws(() => r.sched.add({ ...input, title }), refused(400, ['title']), JSON.stringify(title));
    assert.throws(() => r.sched.edit('demo', { title }), refused(400, ['title']), JSON.stringify(title));
  }
  assert.equal(rawOf(r).includes('Morning'), false);
  assert.equal(r.sched.add({ ...input, title: '\u202eMorning\u202c \u2066check\u2069' }).title, 'Morning check');
  assert.equal(r.sched.edit('demo', { title: 'A\u202ebc' }).title, 'Abc');
  const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
  assert.equal(r.sched.edit('demo', { title: ` ${family} day ` }).title, `${family} day`);
  assert.throws(() => r.sched.add({ ...input, title: `\u202e${'x'.repeat(121)}` }), refused(400, ['title']));
  assert.equal(r.sched.add({ ...input, title: `\u202e${'x'.repeat(120)}` }).title, 'x'.repeat(120), 'the length is counted once the controls are dropped');
});

test('a second routine with the same title gets -2, then -3, and a prompt file kept from a deleted routine counts as taken', () => {
  const r = rig({ enabled: false });
  const input = { ...MORNING, cwd: r.state };
  assert.deepEqual([r.sched.add(input).id, r.sched.add(input).id, r.sched.add(input).id], ['morning-check', 'morning-check-2', 'morning-check-3']);
  r.sched.remove('morning-check-2');
  assert.equal(fs.existsSync(path.join(promptsOf(r), 'morning-check-2.md')), true);
  assert.equal(r.sched.add(input).id, 'morning-check-4', 'the kept file of morning-check-2 and the routines still there are all taken');
  r.sched.remove('morning-check');
  r.sched.remove('morning-check-3');
  r.sched.remove('morning-check-4');
  fs.writeFileSync(path.join(promptsOf(r), 'morning-check-5.md'), 'Kept by hand.\n');
  assert.equal(r.sched.add(input).id, 'morning-check-6', 'no routine holds the first ids now, but their files are kept');
  assert.equal(fs.readFileSync(path.join(promptsOf(r), 'morning-check-5.md'), 'utf8'), 'Kept by hand.\n');
  const junk = fs.mkdtempSync(path.join(base, 'junk-'));
  fs.renameSync(path.join(promptsOf(r), 'morning-check.md'), path.join(junk, 'morning-check.md'));
  assert.equal(r.sched.add(input).id, 'morning-check', 'free again once its file is moved away');
  assert.equal(r.sched.add({ ...input, title: 'Demo' }).id, 'demo-2', 'an id from routines.json is taken too');
});

test('an id something outside routines.json holds is taken, and so is new', () => {
  const r = rig({ enabled: false });
  const input = { ...MORNING, cwd: r.state };
  r.taken.add('morning-check').add('morning-check-2');
  assert.equal(r.sched.add(input).id, 'morning-check-3');
  assert.deepEqual(fs.readdirSync(promptsOf(r)), ['morning-check-3.md']);
  const reserved = r.sched.add({ ...input, title: 'New' });
  assert.deepEqual([reserved.id, reserved.file], ['new-2', path.join(promptsOf(r), 'new-2.md')]);
});

test('adding never writes over a kept prompt file', () => {
  const r = rig({ enabled: false });
  fs.mkdirSync(promptsOf(r));
  fs.writeFileSync(path.join(promptsOf(r), 'morning-check.md'), 'Old prompt.\n');
  const made = r.sched.add({ ...MORNING, cwd: r.state });
  assert.equal(made.id, 'morning-check-2');
  assert.equal(fs.readFileSync(path.join(promptsOf(r), 'morning-check.md'), 'utf8'), 'Old prompt.\n');
});

// ---- a prompt file anywhere on the Mac ---------------------------------------------------------------

const { prompt: _text, ...MORNING_FILELESS } = MORNING;
const FILE_BODY = '---\nname: elsewhere\n---\n\nRead the board from the file.\n';

// A prompt file in a folder of its own, outside any state folder, with an old mtime so a write would show.
function outsideFile(name = 'prompt.md', body = FILE_BODY) {
  const dir = fs.mkdtempSync(path.join(base, 'outside-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  const old = new Date(2026, 5, 1, 12);
  fs.utimesSync(file, old, old);
  return file;
}
const snap = file => ({ bytes: fs.readFileSync(file).toString('hex'), mtime: fs.statSync(file).mtimeMs, listing: fs.readdirSync(path.dirname(file)) });

test('a routine on a prompt file outside GhostShell is added, listed, run, edited, moved to GhostShell\'s text and back, and the file is never touched', async () => {
  const r = rig({ enabled: false });
  const file = outsideFile();
  const before = snap(file);
  r.clock.t = at(2026, 10, 16, 10);
  const made = r.sched.add({ ...MORNING_FILELESS, cwd: r.state, file: `  ${path.dirname(file)}/../${path.basename(path.dirname(file))}/prompt.md  ` });
  assert.deepEqual([made.id, made.file, made.problem, made.enabled], ['morning-check', file, null, true]);
  assert.equal(fs.existsSync(promptsOf(r)), false, 'nothing is written in GhostShell\'s folder for it');
  assert.equal(r.sched.list().routines.find(x => x.id === 'morning-check').file, file);
  assert.deepEqual(r.sched.prompt('morning-check'), { file, text: 'Read the board from the file.', ours: false });
  await r.tickAt(MONDAY + 5000);
  assert.deepEqual(r.calls.map(c => c.text), [wrapPrompt('morning-check', file, FILE_BODY)]);
  assert.match(r.calls[0].text, new RegExp(`^<scheduled-task name="morning-check" file="${file}">\\n`));

  r.sched.edit('morning-check', { title: 'Morning look', cron: '0 8 * * 1-5', mode: 'plan' });
  assert.deepEqual([r.store.read().routines[1].file, r.store.read().routines[1].title], [file, 'Morning look']);
  assert.equal(fs.existsSync(promptsOf(r)), false);
  r.sched.edit('morning-check', { enabled: false });
  r.sched.edit('morning-check', { enabled: true });
  await r.sched.runNow('morning-check');
  assert.equal(r.calls.at(-1).text, wrapPrompt('morning-check', file, FILE_BODY));

  const own = path.join(promptsOf(r), 'morning-check.md');
  const moved = r.sched.edit('morning-check', { prompt: 'Read the board from the file.' });
  assert.equal(moved.file, own, 'moving onto GhostShell\'s text writes it even when the text is the same');
  assert.equal(fs.readFileSync(own, 'utf8'), 'Read the board from the file.\n');
  r.sched.edit('morning-check', { prompt: 'Now in GhostShell.' });
  assert.deepEqual(r.sched.prompt('morning-check'), { file: own, text: 'Now in GhostShell.', ours: true });
  const back = r.sched.edit('morning-check', { file });
  assert.equal(back.file, file);
  assert.equal(fs.readFileSync(own, 'utf8'), 'Now in GhostShell.\n', 'GhostShell\'s copy is left on disk');
  const again = r.sched.edit('morning-check', { prompt: 'Text again.' });
  assert.equal(again.file, own);
  assert.equal(fs.readFileSync(own, 'utf8'), 'Text again.\n');
  r.sched.edit('morning-check', { file });
  await r.sched.runNow('morning-check');
  assert.equal(r.calls.at(-1).text, wrapPrompt('morning-check', file, FILE_BODY));
  assert.deepEqual(snap(file), before, 'bytes, mtime and its folder are as they were');
  assert.ok(r.logs.includes('Routine morning-check: edited file'));
});

test('a prompt file outside GhostShell is left alone by an edit that sends the same text, and the store refuses to write it', () => {
  const r = rig({ enabled: false });
  const file = outsideFile();
  const before = snap(file);
  r.store.update('demo', { file });
  r.sched.edit('demo', { prompt: 'Read the board from the file.', title: 'Same' });
  assert.deepEqual(snap(file), before);
  assert.throws(() => r.store.writePrompt(file, 'x'), /not in GhostShell's prompt folder/);
  assert.deepEqual(snap(file), before);
});

test('adding by file or by text takes exactly one of them, and a file must be a full path to a readable file outside GhostShell\'s prompt folder', () => {
  const r = rig({ enabled: false });
  const file = outsideFile();
  const input = { ...MORNING_FILELESS, cwd: r.state };
  const before = rawOf(r);
  const reason = (extra, key) => { try { r.sched.add({ ...input, ...extra }); } catch (e) { assert.equal(e.status, 400); assert.deepEqual(Object.keys(e.problems), [key]); return e.problems[key]; } assert.fail(`was added: ${JSON.stringify(extra)}`); };

  assert.equal(reason({}, 'prompt'), 'Write the prompt the routine will run, or give the path of a prompt file.');
  assert.equal(reason({ prompt: '  ' }, 'prompt'), 'Write the prompt the routine will run, or give the path of a prompt file.');
  assert.equal(reason({ prompt: 'x', file }, 'prompt'), 'Send the prompt text or the path of a file, not both.');
  assert.equal(reason({ prompt: '', file }, 'prompt'), 'Send the prompt text or the path of a file, not both.');
  for (const bad of ['prompt.md', './prompt.md', '~/prompt.md', '', '   ', 7, null, {}]) assert.equal(reason({ file: bad }, 'file'), 'Give the full path, starting with /.', JSON.stringify(bad));
  assert.equal(reason({ file: '/tmp/a"b.md' }, 'file'), 'The path cannot hold a double quote or a line break.');
  assert.equal(reason({ file: '/tmp/a\nb.md' }, 'file'), 'The path cannot hold a double quote or a line break.');
  assert.equal(reason({ file: '/tmp/a\rb.md' }, 'file'), 'The path cannot hold a double quote or a line break.');
  const missing = path.join(path.dirname(file), 'missing.md');
  assert.equal(reason({ file: missing }, 'file'), `Cannot read ${missing}.`);
  assert.equal(reason({ file: path.dirname(file) }, 'file'), `${path.dirname(file)} is a folder, not a file.`);
  if (process.getuid?.() !== 0) {
    const locked = outsideFile('locked.md');
    fs.chmodSync(locked, 0o000);
    try { assert.equal(reason({ file: locked }, 'file'), `Cannot read ${locked}.`); } finally { fs.chmodSync(locked, 0o600); }
  }
  const mine = path.join(promptsOf(r), 'inside.md');
  fs.mkdirSync(path.join(promptsOf(r), 'sub'), { recursive: true });
  fs.writeFileSync(mine, 'x');
  fs.writeFileSync(path.join(promptsOf(r), 'sub', 'deep.md'), 'x');
  fs.symlinkSync(mine, path.join(path.dirname(file), 'link.md'));
  const ownFolder = "That file is in GhostShell's own prompt folder. Choose GhostShell's own text instead.";
  for (const inside of [mine, path.join(promptsOf(r), 'sub', 'deep.md'), path.join(promptsOf(r), 'sub', '..', 'inside.md'), path.join(path.dirname(file), 'link.md')]) assert.equal(reason({ file: inside }, 'file'), ownFolder, inside);
  assert.equal(rawOf(r), before, 'a refusal writes nothing');
  assert.deepEqual(fs.readdirSync(promptsOf(r)).sort(), ['inside.md', 'sub']);
  assert.throws(() => r.sched.add({ ...input, title: '', model: 'bad model', file: 'relative.md' }), e => refused(400, ['title', 'model', 'file'])(e) && /^Nothing was saved\. Check the title, model and prompt file\.$/.test(e.message));
});

test('editing by file or by text takes at most one of them, and neither leaves the prompt alone', () => {
  const r = rig();
  const file = outsideFile();
  const before = rawOf(r);
  for (const [patch, key, why] of [
    [{ prompt: 'x', file }, 'prompt', 'Send the prompt text or the path of a file, not both.'],
    [{ file: 'relative.md' }, 'file', 'Give the full path, starting with /.'],
    [{ file: path.join(path.dirname(file), 'nope.md') }, 'file', `Cannot read ${path.join(path.dirname(file), 'nope.md')}.`],
    [{ file: path.dirname(file) }, 'file', `${path.dirname(file)} is a folder, not a file.`],
    [{ file: '' }, 'file', 'Give the full path, starting with /.'],
  ]) {
    assert.throws(() => r.sched.edit('demo', patch), e => refused(400, [key])(e) && e.problems[key] === why, JSON.stringify(patch));
  }
  assert.equal(rawOf(r), before);
  assert.equal(fs.existsSync(promptsOf(r)), false);
  const untouched = r.sched.edit('demo', { title: 'Only the title' });
  assert.deepEqual([untouched.file, untouched.title], [r.file, 'Only the title']);
  const pointed = r.sched.edit('demo', { file });
  assert.equal(pointed.file, file);
  assert.equal(r.store.read().routines[0].file, file);
  assert.throws(() => r.sched.edit('demo', { file: path.join(promptsOf(r), 'demo.md') }), refused(400, ['file']));
});

test('a hand-edited prompt file that is not a full path is explained and never run', async () => {
  for (const bad of ['SKILL.md', './SKILL.md', '~/SKILL.md', '']) {
    const r = rig();
    r.store.update('demo', { file: bad });
    const problem = 'The prompt file needs a full path, starting with /.';
    assert.equal(r.sched.list().routines[0].problem, problem, JSON.stringify(bad));
    await r.tickAt(FRIDAY + 3000);
    assert.equal(r.calls.length, 0);
    assert.equal(r.demo().lastError, problem);
    await assert.rejects(r.sched.runNow('demo'), e => e.status === 400 && e.message === problem);
    r.store.update('demo', { enabled: false });
    assert.throws(() => r.sched.setEnabled('demo', true), e => e.status === 400 && e.message === `Demo routine cannot be switched on. ${problem}`);
    assert.equal(r.calls.length, 0);
  }
});

test('a hand-edited prompt file path with a double quote or a line break is explained and never run', async () => {
  for (const bad of ['/tmp/a"b/SKILL.md', '/tmp/a\nb/SKILL.md']) {
    const r = rig();
    r.store.update('demo', { file: bad });
    const problem = 'The prompt file path cannot hold a double quote or a line break.';
    assert.equal(r.sched.list().routines[0].problem, problem, JSON.stringify(bad));
    await r.tickAt(FRIDAY + 3000);
    assert.equal(r.calls.length, 0);
    assert.equal(r.demo().lastError, problem);
  }
});

test('a hand-added id the routes refuse is explained and never run', async () => {
  for (const bad of ['daily scrum', 'a"b']) {
    const r = rig();
    put(r.state, [fixture(r.file, r.state, { id: bad, enabled: true, armedAt: localIso(T0) })]);
    const problem = 'The id can only hold letters, digits, dashes and underscores.';
    assert.equal(r.sched.list().routines[0].problem, problem, JSON.stringify(bad));
    await r.tickAt(FRIDAY + 3000);
    assert.equal(r.calls.length, 0);
    assert.equal(r.store.read().routines[0].lastError, problem);
  }
});

test('a path into the prompt folder that differs only in case is the prompt folder where the disk ignores case', () => {
  const r = rig({ enabled: false });
  fs.mkdirSync(promptsOf(r), { recursive: true });
  const own = path.join(promptsOf(r), 'inside.md');
  fs.writeFileSync(own, 'x');
  const variant = path.join(r.state, 'ROUTINES', 'inside.md');
  const caseBlind = fs.existsSync(variant);
  assert.equal(r.store.inPromptFolder(variant), caseBlind);
  assert.throws(() => r.sched.add({ ...MORNING_FILELESS, cwd: r.state, file: variant }), e => refused(400, ['file'])(e) && e.problems.file === (caseBlind ? "That file is in GhostShell's own prompt folder. Choose GhostShell's own text instead." : `Cannot read ${variant}.`));
});

test('an add that fails after the checks leaves a prompt file elsewhere in place and removes only the text GhostShell wrote', () => {
  const r = rig({ enabled: false });
  const file = outsideFile();
  const before = snap(file);
  r.store.add = () => { throw new Error('disk full'); };
  assert.throws(() => r.sched.add({ ...MORNING_FILELESS, cwd: r.state, file }), /disk full/);
  assert.deepEqual(snap(file), before);
  assert.throws(() => r.sched.add({ ...MORNING, cwd: r.state }), /disk full/);
  assert.deepEqual(fs.readdirSync(promptsOf(r)), []);
  assert.deepEqual(snap(file), before);
});

test('editing the prompt of a routine on a file elsewhere copies it to GhostShell\'s folder and leaves that file as it was', async () => {
  const r = rig({ enabled: false });
  const old = new Date(2026, 5, 1, 12);
  fs.utimesSync(r.file, old, old);
  const mtime = fs.statSync(r.file).mtimeMs;
  const edited = r.sched.edit('demo', { prompt: 'Check the other thing.\n\nSecond paragraph.' });
  const ours = path.join(promptsOf(r), 'demo.md');
  assert.equal(edited.file, ours);
  assert.equal(fs.readFileSync(ours, 'utf8'), 'Check the other thing.\n\nSecond paragraph.\n');
  assert.equal(fs.readFileSync(r.file, 'utf8'), r.raw, 'the file elsewhere is byte for byte as it was');
  assert.equal(fs.statSync(r.file).mtimeMs, mtime);
  assert.deepEqual(fs.readdirSync(path.dirname(r.file)).sort(), ['SKILL.md', 'routines', 'routines.json']);
  assert.deepEqual(r.sched.prompt('demo'), { file: ours, text: 'Check the other thing.\n\nSecond paragraph.', ours: true });
  r.sched.setEnabled('demo', true);
  await r.tickAt(MONDAY + 5000);
  assert.equal(r.calls[0].text, wrapPrompt('demo', ours, 'Check the other thing.\n\nSecond paragraph.'));
});

test('the prompt of a routine is its body without the frontmatter, with the file it is read from and whether that is GhostShell\'s own', () => {
  const r = rig();
  assert.deepEqual(r.sched.prompt('demo'), { file: r.file, text: 'Check the thing.', ours: false });
  fs.unlinkSync(r.file);
  const gone = r.sched.prompt('demo');
  assert.deepEqual([gone.text, gone.ours, gone.file, gone.error], ['', false, r.file, `Cannot read ${r.file}.`]);
  assert.throws(() => r.sched.prompt('nope'), refused(404));
});

test('a prompt that has not changed writes nothing once the routine is on GhostShell\'s own text, whatever the spacing round it', () => {
  const r = rig();
  r.sched.edit('demo', { prompt: 'Check the thing.' });
  const ours = path.join(promptsOf(r), 'demo.md');
  fs.utimesSync(ours, new Date(2026, 5, 1), new Date(2026, 5, 1));
  for (const same of ['Check the thing.', '\n  Check the thing.\n\n', 'Check the thing.\r\n']) {
    r.sched.edit('demo', { prompt: same, title: 'Same prompt' });
    assert.equal(fs.statSync(ours).mtimeMs, new Date(2026, 5, 1).getTime(), JSON.stringify(same));
  }
  assert.equal(r.demo().file, ours);
  assert.equal(r.demo().title, 'Same prompt');
  assert.equal(fs.readFileSync(r.file, 'utf8'), r.raw);
});

test('a second prompt edit overwrites GhostShell\'s copy in place and leaves no temporary file', () => {
  const r = rig();
  r.sched.edit('demo', { prompt: 'First.' });
  const ours = path.join(promptsOf(r), 'demo.md');
  const first = fs.statSync(ours).mode & 0o777;
  r.sched.edit('demo', { prompt: 'Second.' });
  assert.equal(r.demo().file, ours);
  assert.equal(fs.readFileSync(ours, 'utf8'), 'Second.\n');
  assert.deepEqual(fs.readdirSync(promptsOf(r)), ['demo.md']);
  assert.equal(first, 0o600);
  assert.equal(fs.readFileSync(r.file, 'utf8'), r.raw);
  r.sched.edit('demo', { prompt: 'Second.' });
  assert.equal(r.sched.prompt('demo').text, 'Second.');
});

test('nothing outside GhostShell\'s prompt folder is ever written', () => {
  const r = rig();
  const outside = path.join(r.state, 'elsewhere.md');
  assert.throws(() => r.store.writePrompt(outside, 'x'), /not in GhostShell's prompt folder/);
  assert.throws(() => r.store.writePrompt(path.join(promptsOf(r), '..', 'escape.md'), 'x'), /not in GhostShell's prompt folder/);
  assert.throws(() => r.store.writePrompt(path.join(promptsOf(r), 'a', 'b.md'), 'x'), /not in GhostShell's prompt folder/);
  assert.equal(fs.existsSync(outside), false);
  assert.equal(fs.existsSync(path.join(r.state, 'escape.md')), false);
  assert.throws(() => r.store.promptFile('../escape'), refused(400));
});

test('a prompt is written where its path resolves to, so a .. in it is never opened as typed', () => {
  const r = rig();
  fs.mkdirSync(promptsOf(r), { recursive: true });
  r.store.writePrompt(`${promptsOf(r)}/missing/../tidy.md`, 'Written.\n');
  assert.deepEqual(fs.readdirSync(promptsOf(r)), ['tidy.md']);
  assert.equal(fs.readFileSync(path.join(promptsOf(r), 'tidy.md'), 'utf8'), 'Written.\n');
});

test('a change of schedule counts from the save, so a fire earlier today never runs, and the next real fire does', async () => {
  const r = rig();
  const save = at(2026, 10, 16, 9);
  r.clock.t = save;
  r.store.update('demo', { skipped: { fireAt: localIso(T0), at: localIso(T0), reason: 'earlier' } });
  const out = r.sched.edit('demo', { cron: '0 8 * * 1-5' });
  assert.deepEqual([r.demo().cron, Date.parse(r.demo().armedAt), r.demo().skipped, out.armedAt], ['0 8 * * 1-5', save, null, localIso(save)]);
  await r.tickAt(save + 5000);
  await r.tickAt(at(2026, 10, 16, 15));
  assert.equal(r.calls.length, 0, 'the 08:12 fire passed an hour before the save');
  await r.tickAt(at(2026, 10, 19, 8, 12, 30));
  assert.equal(r.calls.length, 1);
  assert.match(r.logs.at(-1), /due 2026-10-19 08:12:17/);
});

test('the same edit with a title only leaves the place in the schedule alone, so the fire still counts', async () => {
  const r = rig();
  r.clock.t = at(2026, 10, 16, 9);
  const out = r.sched.edit('demo', { title: 'Renamed', cron: '30  7 * * 1-5', jitterSeconds: 737 });
  assert.equal(Date.parse(r.demo().armedAt), T0);
  assert.equal(out.title, 'Renamed');
  await r.tickAt(at(2026, 10, 16, 9, 0, 5));
  assert.equal(r.calls.length, 1, 'the 07:42 fire is caught up, as it was before the edit');
});

test('a jitter change re-arms too, and a schedule change on a routine that is off arms nothing', async () => {
  const r = rig();
  const save = at(2026, 10, 16, 9);
  r.clock.t = save;
  r.sched.edit('demo', { jitterSeconds: 60 });
  assert.equal(Date.parse(r.demo().armedAt), save);
  await r.tickAt(save + 5000);
  assert.equal(r.calls.length, 0);
  const off = rig({ enabled: false });
  off.clock.t = save;
  off.sched.edit('demo', { cron: '0 8 * * 1-5', jitterSeconds: 5 });
  assert.deepEqual([off.demo().enabled, off.demo().armedAt, off.demo().cron, off.demo().jitterSeconds], [false, null, '0 8 * * 1-5', 5]);
});

test('switching on in an edit is checked after any prompt write, arms from now and clears a skip, and switching off clears the place', async () => {
  const r = rig({ enabled: false });
  fs.unlinkSync(r.file);
  assert.throws(() => r.sched.edit('demo', { enabled: true, title: 'Not saved' }), e => e.status === 400 && /cannot be switched on\. Cannot read .*SKILL\.md/.test(e.message));
  assert.deepEqual([r.demo().enabled, r.demo().title], [false, 'Demo routine']);
  assert.equal(fs.existsSync(promptsOf(r)), false);
  r.clock.t = at(2026, 10, 16, 10);
  const on = r.sched.edit('demo', { enabled: true, prompt: 'A new prompt.' });
  assert.deepEqual([on.enabled, on.armedAt, on.problem, on.file], [true, localIso(r.clock.t), null, path.join(promptsOf(r), 'demo.md')]);
  await r.tickAt(r.clock.t + 5000);
  assert.equal(r.calls.length, 0);
  await r.tickAt(MONDAY + 5000);
  assert.equal(r.calls.length, 1);
  const off = r.sched.edit('demo', { enabled: false });
  assert.deepEqual([off.enabled, off.armedAt], [false, null]);
  assert.throws(() => r.sched.edit('demo', { enabled: 1 }), e => e.status === 400 && /true or false/.test(e.message));
  assert.ok(r.logs.includes('Routine demo: switched off'));
});

test('an edit that cannot switch the routine on is refused whole, and one that fixes the problem and switches on together works', () => {
  const r = rig({ enabled: false });
  r.store.update('demo', { cwd: '/no/such/folder' });
  const before = rawOf(r);
  assert.throws(() => r.sched.edit('demo', { enabled: true }), refused(400, ['cwd']));
  assert.throws(() => r.sched.edit('demo', { enabled: true, prompt: 'New.' }), refused(400, ['cwd']));
  assert.equal(rawOf(r), before);
  assert.equal(fs.existsSync(promptsOf(r)), false, 'a refused edit writes no prompt');
  const fixed = r.sched.edit('demo', { cwd: r.state, enabled: true });
  assert.deepEqual([fixed.enabled, fixed.cwd, fixed.problem], [true, r.state, null]);
});

test('an edit that switches on names the saved folder when it is gone, though the edit did not send it, and still refuses what is not a field', () => {
  const r = rig({ enabled: false });
  r.store.update('demo', { cwd: '/no/such/folder', model: 'bad model' });
  assert.throws(() => r.sched.edit('demo', { enabled: true }), e => refused(400, ['cwd', 'model'])(e) && /^Nothing was saved\. Check the folder and model\.$/.test(e.message) && /does not exist/.test(e.problems.cwd));
  r.store.update('demo', { cwd: r.state, model: null, file: path.join(r.state, 'gone', 'SKILL.md') });
  assert.throws(() => r.sched.edit('demo', { enabled: true }), e => e.status === 400 && e.problems === undefined && /cannot be switched on\. Cannot read/.test(e.message));
  assert.equal(r.demo().enabled, false);
});

test('a refused edit changes nothing and names every bad field it was sent, and a field it was not sent is left alone', () => {
  const r = rig();
  r.store.update('demo', { cwd: '/no/such/folder' });
  const before = rawOf(r);
  const renamed = r.sched.edit('demo', { title: 'Renamed' });
  assert.deepEqual([renamed.title, renamed.cwd], ['Renamed', '/no/such/folder']);
  const same = rawOf(r);
  assert.throws(() => r.sched.edit('demo', { title: ' ', cron: 'every day', jitterSeconds: -1, cwd: '', model: 'two words', prompt: '', mode: 7 }), refused(400, ['title', 'cron', 'jitterSeconds', 'cwd', 'model', 'mode', 'prompt']));
  assert.throws(() => r.sched.edit('demo', { cron: '0 8 * * 1-5', title: 'x'.repeat(121) }), refused(400, ['title']));
  assert.throws(() => r.sched.edit('demo', { cwd: '/no/such/folder' }), refused(400, ['cwd']));
  assert.throws(() => r.sched.edit('demo', 'nope'), e => e.status === 400);
  assert.throws(() => r.sched.edit('nope', { title: 'x' }), refused(404));
  assert.equal(rawOf(r), same);
  assert.notEqual(before, same);
  assert.equal(fs.existsSync(promptsOf(r)), false);
  assert.equal(r.sched.edit('demo', {}).title, 'Renamed');
  assert.equal(rawOf(r), same, 'an empty edit writes nothing');
  const choices = r.sched.edit('demo', { model: '', effort: null, mode: 'plan' });
  assert.deepEqual([choices.model, choices.effort, choices.mode], [null, null, 'plan']);
});

test('deleting a routine is refused while a run is starting, working or only waiting, and works once it has ended, keeping the prompt file', async () => {
  const r = rig({ enabled: false });
  const made = r.sched.add({ ...MORNING, cwd: r.state, title: 'Run me' });
  const file = made.file;
  let release;
  r.onStart = () => new Promise(done => { release = done; });
  const first = r.sched.runNow('run-me');
  await assert.rejects(Promise.resolve().then(() => r.sched.remove('run-me')), e => e.status === 409 && /Run me is still running/.test(e.message));
  release();
  const { sessionId } = await first;
  r.onStart = null;
  r.working.add(sessionId);
  assert.throws(() => r.sched.remove('run-me'), refused(409));
  r.waiting.add(sessionId);
  assert.throws(() => r.sched.remove('run-me'), refused(409));
  assert.deepEqual(r.store.read().routines.map(x => x.id), ['demo', 'run-me']);
  assert.deepEqual(r.stops, [], 'nothing is stopped');
  r.working.delete(sessionId);
  r.waiting.delete(sessionId);
  assert.equal(r.sched.remove('run-me'), 'run-me');
  assert.deepEqual(r.store.read().routines.map(x => x.id), ['demo']);
  assert.equal(fs.readFileSync(file, 'utf8'), 'Look at the board.\n', 'the prompt file is kept');
  assert.throws(() => r.sched.remove('run-me'), refused(404));
  assert.equal(r.sched.add({ ...MORNING, cwd: r.state, title: 'Run me' }).id, 'run-me-2');
  assert.ok(r.logs.includes('Routine run-me: deleted'));
});

test('a deleted routine is forgotten, so one added later with the same id starts clean', async () => {
  const r = rig({ enabled: false });
  const input = { ...MORNING, cwd: r.state, title: 'Again', cron: '0 7 * * 5', jitterSeconds: 0 };
  r.clock.t = at(2026, 10, 15, 8);
  r.sched.add(input);
  await r.tickAt(at(2026, 10, 16, 7, 0, 5));
  assert.equal(r.calls.length, 1);
  r.sched.remove('again');
  fs.renameSync(path.join(promptsOf(r), 'again.md'), path.join(promptsOf(r), 'old-again.md'));
  r.clock.t = at(2026, 10, 16, 9);
  r.sched.add(input);
  await r.tickAt(at(2026, 10, 16, 9, 0, 30));
  assert.equal(r.calls.length, 1, 'the run of the routine that was deleted does not count against the new one');
  await r.tickAt(at(2026, 10, 23, 7, 0, 5));
  assert.equal(r.calls.length, 2);
});

test('adding, editing and deleting keep a hand edit that came in between, because each write reads the file again', () => {
  const r = rig();
  const other = { id: 'other', title: 'Other', cron: '0 9 * * *', jitterSeconds: 0, file: r.file, cwd: r.state, enabled: false };
  handEdit(r, data => data.routines.push(other));
  r.sched.edit('demo', { title: 'Renamed' });
  handEdit(r, data => { data.routines.find(x => x.id === 'other').title = 'Hand edited'; });
  const added = r.sched.add({ ...MORNING, cwd: r.state });
  assert.deepEqual(r.store.read().routines.map(x => [x.id, x.title]), [['demo', 'Renamed'], ['other', 'Hand edited'], [added.id, 'Morning check']]);
  handEdit(r, data => { data.routines.find(x => x.id === 'other').cron = '0 10 * * *'; });
  r.sched.remove(added.id);
  handEdit(r, data => { data.routines.find(x => x.id === 'other').cwd = '/somewhere/else'; });
  r.sched.edit('demo', { prompt: 'New.' });
  const kept = r.store.read().routines.find(x => x.id === 'other');
  assert.deepEqual([kept.title, kept.cron, kept.cwd], ['Hand edited', '0 10 * * *', '/somewhere/else']);
  assert.deepEqual(r.store.read().routines.map(x => x.id), ['demo', 'other']);
});

test('the store adds and removes routines, and refuses an id that is there, one that is not, and a file it cannot read', () => {
  const dir = fs.mkdtempSync(path.join(base, 'store-'));
  const store = makeRoutines(dir);
  const routine = { id: 'a', title: 'A', cron: '0 0 * * *', jitterSeconds: 0, file: store.promptFile('a'), cwd: dir, model: null, effort: null, mode: null, enabled: true, armedAt: localIso(T0) };
  assert.deepEqual(store.add(routine), { ...routine, lastRunAt: null, lastSessionId: null, lastError: null, skipped: null });
  assert.throws(() => store.add(routine), refused(409));
  assert.deepEqual(store.read().routines.map(x => x.id), ['a']);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'routines.json'), 'utf8')).routines[0]).slice(0, 4), ['id', 'title', 'cron', 'jitterSeconds']);
  assert.throws(() => store.remove('b'), refused(404));
  assert.equal(store.remove('a').id, 'a');
  assert.deepEqual(fs.readdirSync(dir), ['routines.json'], 'no temporary file is left');
  assert.deepEqual(store.read().routines, []);
  assert.equal(store.ours(store.promptFile('a')), true);
  assert.equal(store.ours(path.join(dir, 'a.md')), false);
  assert.equal(store.ours(path.join(dir, 'routines', 'deeper', 'a.md')), false);
  assert.equal(store.ours(undefined), false);
  const broken = '{ not json';
  fs.writeFileSync(path.join(dir, 'routines.json'), broken);
  assert.throws(() => store.add({ ...routine, id: 'c' }), e => e.status === 500 && /cannot be read/.test(e.message));
  assert.throws(() => store.remove('a'), e => e.status === 500);
  assert.equal(fs.readFileSync(path.join(dir, 'routines.json'), 'utf8'), broken);
});

test('with a routines.json that cannot be read, adding, editing and deleting are refused, and no prompt is written', () => {
  const r = rig();
  const broken = '[]';
  fs.writeFileSync(path.join(r.state, 'routines.json'), broken);
  assert.throws(() => r.sched.add({ ...MORNING, cwd: r.state }), e => e.status === 500 && /cannot be read/.test(e.message));
  assert.throws(() => r.sched.edit('demo', { prompt: 'x' }), e => e.status === 500);
  assert.throws(() => r.sched.remove('demo'), e => e.status === 500);
  assert.equal(fs.existsSync(promptsOf(r)), false);
  assert.equal(rawOf(r), broken);
});

test('an edit never stops or changes a run that is working, and the next run uses the new values', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 5000);
  r.working.add('s1');
  const before = r.calls[0].routine;
  r.sched.edit('demo', { title: 'Renamed', cwd: r.state, model: 'opus', effort: 'high', mode: 'plan', prompt: 'A new prompt.' });
  assert.deepEqual(r.stops, []);
  assert.deepEqual([before.title, before.model, before.effort, before.mode], ['Demo routine', 'haiku', 'low', 'bypassPermissions']);
  assert.equal(r.sched.list().routines[0].running, true);
  r.working.delete('s1');
  await r.tickAt(MONDAY + 5000);
  assert.deepEqual([r.calls[1].routine.title, r.calls[1].routine.model, r.calls[1].routine.effort, r.calls[1].routine.mode], ['Renamed', 'opus', 'high', 'plan']);
  assert.ok(r.calls[1].text.includes('\nA new prompt.\n</scheduled-task>'));
});
