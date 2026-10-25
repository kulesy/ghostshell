// Run with `npm test`. Archiving from Capcom: which sessions the list and the archive show, and what wins over Desktop's flag.
// Over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, cliCalls, listen, request, signIn, start, until } from './harness.mjs';

const MINUTE = 60_000;
const minutesAgo = minutes => new Date(Date.now() - minutes * MINUTE).toISOString();
const titles = list => list.map(r => r.title);
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const index = async (s, token) => (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
const archive = async (s, token) => (await request(s, 'GET', '/api/archived', { headers: as(token) })).body().archived;
const record = (s, id) => path.join(s.home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions', 'account', 'org', `local_${id}.json`);
const records = s => fs.readdirSync(path.dirname(record(s, ''))).sort().map(name => fs.readFileSync(path.join(path.dirname(record(s, '')), name), 'utf8'));
const post = (s, token, json, headers) => request(s, 'POST', '/api/layout/archive', { headers: { ...as(token), ...headers }, json });
const send = (s, token, id, text) => request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text } });
const said = (s, text) => cliCalls(s).some(c => c.user === text);
const processes = (s, id) => cliCalls(s).filter(c => c.started?.[c.started.indexOf('--resume') + 1] === id).length;
const touched = s => cliCalls(s).filter(c => c.closed || c.control === 'interrupt' || c.response === 'deny');
const turnEnds = viewer => viewer.events.filter(e => e.type === 'turn-end').map(e => e.data);
// A chat's status as a viewer is given it on connecting, which carries the last error.
const statusOf = async (s, token, id) => {
  const viewer = listen(s, token, id);
  await until(() => viewer.events.length);
  viewer.close();
  return viewer.events[0].data;
};
const stateOf = (ix, id) => [...ix.routines.flatMap(r => [r.latest, ...r.earlier]), ...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.started, ...ix.ungrouped, ...ix.other].find(r => r.id === id)?.state;

// The titles in each place the list shows a session.
const places = ix => ({
  routines: ix.routines.map(r => r.latest.title),
  pinned: titles(ix.pinned),
  groups: Object.fromEntries(ix.groups.map(g => [g.id, titles(g.sessions)])),
  started: titles(ix.started),
  ungrouped: titles(ix.ungrouped),
  other: titles(ix.other),
});

test('the archive lists the newest first, by when Capcom archived a session or when Desktop last changed the record of one it archived', async () => {
  const s = await start({
    sessions: [
      { id: 'd-old', title: 'Desktop, a week ago', archived: true, archivedAgo: 7 * 24 * 60, ago: 1 },
      { id: 'd-new', title: 'Desktop, 2 minutes ago', archived: true, archivedAgo: 2, ago: 600 },
      { id: 'c-old', title: 'Capcom, 60 minutes ago', ago: 2 },
      { id: 'c-new', title: 'Capcom, 1 minute ago', ago: 800 },
      { id: 'started', title: 'Started here, 30 minutes ago', source: 'capcom', ago: 3 },
      { id: 'terminal', title: 'Terminal, 90 minutes ago', source: 'cli', ago: 4 },
      { id: 'kept', title: 'Not archived', ago: 5 },
    ],
    layout: { archived: { 'c-old': minutesAgo(60), 'c-new': minutesAgo(1), started: minutesAgo(30), terminal: minutesAgo(90) } },
  });
  const { token } = await signIn(s);
  const listed = await archive(s, token);
  assert.deepEqual(titles(listed), ['Capcom, 1 minute ago', 'Desktop, 2 minutes ago', 'Started here, 30 minutes ago', 'Capcom, 60 minutes ago', 'Terminal, 90 minutes ago', 'Desktop, a week ago']);
  assert.ok(listed.every(r => r.archived === true));
  const times = Object.fromEntries(listed.map(r => [r.id, r.archivedAt]));
  const kept = onDisk(s).archived;
  for (const id of ['c-old', 'c-new', 'started', 'terminal']) assert.equal(times[id], Date.parse(kept[id]), `${id} is dated by Capcom's time`);
  assert.ok(Math.abs(times['d-new'] - (Date.now() - 2 * MINUTE)) < 30_000, "and a Desktop session by its record's file time");
  assert.deepEqual(places(await index(s, token)), { routines: [], pinned: [], groups: {}, started: [], ungrouped: ['Not archived'], other: [] });
});

test("a session in neither of Capcom's lists follows Desktop's flag, and Capcom's choice wins when they differ, in either direction", async () => {
  const s = await start({
    sessions: [
      { id: 'follows-on', title: 'Archived in Desktop', archived: true, ago: 1 },
      { id: 'follows-off', title: 'Not archived in Desktop', ago: 2 },
      { id: 'hidden', title: 'Archived here, not in Desktop', ago: 3 },
      { id: 'shown', title: 'Brought back here, archived in Desktop', archived: true, ago: 4 },
      { id: 'both', title: 'Named in both lists', archived: true, ago: 5 },
    ],
    layout: { archived: { hidden: minutesAgo(5), both: minutesAgo(5) }, unarchived: ['shown', 'both'] },
  });
  const { token } = await signIn(s);
  assert.deepEqual(places(await index(s, token)).ungrouped, ['Not archived in Desktop', 'Brought back here, archived in Desktop']);
  assert.deepEqual(titles(await archive(s, token)).sort(), ['Archived here, not in Desktop', 'Archived in Desktop', 'Named in both lists']);
});

test("Capcom's choice still wins when Desktop's flag changes to the other way afterwards", async () => {
  const s = await start({
    sessions: [
      { id: 'hidden', title: 'Archived here and in Desktop', archived: true, ago: 1 },
      { id: 'shown', title: 'Brought back here, not archived in Desktop', ago: 2 },
      { id: 'follows', title: 'Follows Desktop', ago: 3 },
    ],
    layout: { archived: { hidden: minutesAgo(5) }, unarchived: ['shown'] },
  });
  const { token } = await signIn(s);
  assert.deepEqual(places(await index(s, token)).ungrouped, ['Brought back here, not archived in Desktop', 'Follows Desktop']);
  assert.deepEqual(titles(await archive(s, token)), ['Archived here and in Desktop']);

  const setFlag = (id, isArchived) => fs.writeFileSync(record(s, id), JSON.stringify({ ...JSON.parse(fs.readFileSync(record(s, id), 'utf8')), isArchived }));
  setFlag('hidden', false);
  setFlag('shown', true);
  setFlag('follows', true);
  // Desktop's records are read at most every four seconds, and the session that has no choice of Capcom's shows when they have been.
  await until(async () => (await archive(s, token)).some(r => r.id === 'follows'), 8000);
  assert.deepEqual(places(await index(s, token)).ungrouped, ['Brought back here, not archived in Desktop']);
  assert.deepEqual(titles(await archive(s, token)).sort(), ['Archived here and in Desktop', 'Follows Desktop']);
});

test('an archive time that is not a date still archives the session, dated by its last activity instead', async () => {
  const s = await start({
    sessions: [
      { id: 'odd', title: 'Hand-edited time', source: 'capcom', ago: 90 },
      { id: 'text', title: 'Time that is a word', source: 'cli', ago: 120 },
    ],
    layout: { archived: { odd: 'last Tuesday', text: true } },
  });
  const { token } = await signIn(s);
  assert.deepEqual(places(await index(s, token)), { routines: [], pinned: [], groups: {}, started: [], ungrouped: [], other: [] });
  const listed = await archive(s, token);
  assert.deepEqual(titles(listed), ['Hand-edited time', 'Time that is a word']);
  for (const [r, minutes] of [[listed[0], 90], [listed[1], 120]]) assert.ok(Math.abs(r.archivedAt - (Date.now() - minutes * MINUTE)) < 30_000, r.title);
});

const GROUPS = [{ id: 'cg-work', name: 'Work' }];
const PLACED = [
  { id: 'grouped', title: 'In a group', group: 'cg-work', ago: 1 },
  { id: 'pinned', title: 'Pinned', pinned: true, ago: 2 },
  { id: 'run', title: 'Routine run', routine: 'nightly', ago: 3 },
  { id: 'loose', title: 'In no group', ago: 4 },
  { id: 'live', title: 'Live one', group: 'cg-work', ago: 5 },
];

test('archiving takes a Desktop session that Desktop does not flag, a session Capcom started and a terminal session out of the list and into the archive', async () => {
  const s = await start({
    sessions: [
      { id: 'desktop', title: 'Desktop session', ago: 1 },
      { id: 'started', title: 'Started here', source: 'capcom', ago: 2 },
      { id: 'terminal', title: 'Terminal session', source: 'cli', ago: 3 },
      { id: 'kept', title: 'Stays in the list', ago: 4 },
    ],
  });
  const { token } = await signIn(s);
  const desktop = records(s);
  assert.deepEqual(places(await index(s, token)), { routines: [], pinned: [], groups: {}, started: ['Started here'], ungrouped: ['Desktop session', 'Stays in the list'], other: ['Terminal session'] });
  assert.deepEqual(await archive(s, token), []);

  const before = Date.now();
  for (const id of ['desktop', 'started', 'terminal']) {
    const res = await post(s, token, { id, archived: true });
    assert.equal(res.status, 200, id);
    assert.deepEqual(res.body(), { id, group: null, pinned: false, archived: true }, id);
  }
  assert.deepEqual(places(await index(s, token)), { routines: [], pinned: [], groups: {}, started: [], ungrouped: ['Stays in the list'], other: [] });
  const listed = await archive(s, token);
  assert.deepEqual(titles(listed).sort(), ['Desktop session', 'Started here', 'Terminal session']);
  for (const r of listed) assert.ok(r.archivedAt >= before && r.archivedAt <= Date.now(), r.title);
  assert.deepEqual(Object.keys(onDisk(s).archived), ['desktop', 'started', 'terminal']);
  assert.deepEqual(records(s), desktop, "Desktop's records are never written");
});

test('a session archived from Capcom keeps its group, pin and routine, and unarchiving it puts it back there', async () => {
  const s = await start({ groups: GROUPS, sessions: PLACED });
  const { token } = await signIn(s);
  const placed = places(await index(s, token));
  assert.deepEqual(placed, { routines: ['Routine run'], pinned: ['Pinned'], groups: { 'cg-work': ['In a group', 'Live one'] }, started: [], ungrouped: ['In no group'], other: [] });
  const layout = onDisk(s);

  for (const id of ['grouped', 'pinned', 'run', 'loose']) assert.equal((await post(s, token, { id, archived: true })).status, 200, id);
  assert.deepEqual(places(await index(s, token)), { routines: [], pinned: [], groups: { 'cg-work': ['Live one'] }, started: [], ungrouped: [], other: [] });
  assert.equal((await archive(s, token)).length, 4);

  const back = await post(s, token, { id: 'grouped', archived: false });
  assert.deepEqual(back.body(), { id: 'grouped', group: 'cg-work', pinned: false, archived: false });
  assert.deepEqual((await post(s, token, { id: 'pinned', archived: false })).body(), { id: 'pinned', group: null, pinned: true, archived: false });
  for (const id of ['run', 'loose']) await post(s, token, { id, archived: false });
  assert.deepEqual(places(await index(s, token)), placed);
  assert.deepEqual(await archive(s, token), []);
  assert.deepEqual({ ...onDisk(s), archived: {}, unarchived: [] }, { ...layout, projects: [], retired: [], sections: {}, titles: {}, parents: {}, archived: {}, unarchived: [] }, 'only the two lists changed');
  assert.deepEqual(onDisk(s).unarchived, ['grouped', 'pinned', 'run', 'loose']);

  await post(s, token, { id: 'loose', archived: true });
  assert.deepEqual(onDisk(s).unarchived, ['grouped', 'pinned', 'run'], 'archiving again takes it out of the unarchived list');
  assert.deepEqual(Object.keys(onDisk(s).archived), ['loose']);
});

test('unarchiving a session that Desktop archived brings it back to its group, pin or routine, and Desktop still has it archived', async () => {
  const s = await start({ groups: GROUPS, sessions: PLACED.map(p => ({ ...p, archived: p.id !== 'live' })) });
  const { token } = await signIn(s);
  const desktop = records(s);
  assert.deepEqual(places(await index(s, token)), { routines: [], pinned: [], groups: { 'cg-work': ['Live one'] }, started: [], ungrouped: [], other: [] });
  assert.equal((await archive(s, token)).length, 4);

  for (const id of ['grouped', 'pinned', 'run', 'loose']) {
    const res = await post(s, token, { id, archived: false });
    assert.equal(res.status, 200, id);
    assert.equal(res.body().archived, false, id);
  }
  assert.deepEqual(places(await index(s, token)), { routines: ['Routine run'], pinned: ['Pinned'], groups: { 'cg-work': ['In a group', 'Live one'] }, started: [], ungrouped: ['In no group'], other: [] });
  assert.deepEqual(await archive(s, token), []);
  assert.deepEqual(onDisk(s).unarchived, ['grouped', 'pinned', 'run', 'loose']);
  assert.deepEqual(onDisk(s).archived, {});
  assert.deepEqual(records(s), desktop, "Desktop's records are never written");
});

test('archiving a session that is archived already keeps the time it was archived at', async () => {
  const s = await start({ sessions: [{ id: 'one', title: 'One', ago: 1 }], layout: { archived: { one: '2026-10-17T09:30:00.000Z' } } });
  const { token } = await signIn(s);
  const res = await post(s, token, { id: 'one', archived: true });
  assert.deepEqual(res.body(), { id: 'one', group: null, pinned: false, archived: true });
  assert.deepEqual(onDisk(s).archived, { one: '2026-10-17T09:30:00.000Z' });
  assert.equal((await archive(s, token))[0].archivedAt, Date.parse('2026-10-17T09:30:00.000Z'));
});

// An old session brought back from the archive has no new message to lift it into the newest 60, so the list must keep it anyway.
for (const [source, list, how] of [['desktop', 'ungrouped', 'Desktop'], ['capcom', 'started', 'Capcom'], ['cli', 'other', 'Capcom']]) {
  test(`an old ${source} session archived by ${how} and unarchived without a message is listed last, below the 60 newest`, async () => {
    const newer = Array.from({ length: 61 }, (_, i) => ({ id: `new-${i}`, title: `Newer ${i}`, source, ago: i + 1 }));
    const s = await start({
      sessions: [...newer, { id: 'old', title: 'Old one', source, ago: 6 * 24 * 60, archived: how === 'Desktop' }],
      layout: how === 'Desktop' ? {} : { archived: { old: minutesAgo(5 * 24 * 60) } },
    });
    const { token } = await signIn(s);
    const newest = newer.slice(0, 60).map(r => r.title);
    assert.deepEqual(places(await index(s, token))[list], newest, 'the list stops at the 60 newest');
    assert.deepEqual(titles(await archive(s, token)), ['Old one']);

    assert.equal((await post(s, token, { id: 'old', archived: false })).status, 200);
    assert.deepEqual(places(await index(s, token))[list], [...newest, 'Old one'], 'the old one comes last and the 60 newest are all still there');
    assert.deepEqual(await archive(s, token), []);
  });
}

test('an old routine run unarchived without a message is kept below the 12 earlier runs the routine shows', async () => {
  const runs = Array.from({ length: 14 }, (_, i) => ({ id: `run-${i}`, title: `Run ${i}`, routine: 'nightly', ago: i + 1 }));
  const s = await start({ sessions: [...runs, { id: 'old', title: 'Old run', routine: 'nightly', ago: 6 * 24 * 60, archived: true }] });
  const { token } = await signIn(s);
  const earlier = async () => titles((await index(s, token)).routines[0].earlier);
  const newest = runs.slice(1, 13).map(r => r.title);
  assert.deepEqual(await earlier(), newest);

  assert.equal((await post(s, token, { id: 'old', archived: false })).status, 200);
  assert.deepEqual(await earlier(), [...newest, 'Old run']);
  assert.deepEqual(await archive(s, token), []);
});

test('a refused request says why and writes nothing', async () => {
  const s = await start({
    sessions: [{ id: 'one', title: 'One', ago: 1 }, { id: 'two', title: 'Two', ago: 2 }],
    layout: { archived: { two: '2026-10-17T09:30:00.000Z' }, unarchived: ['one'] },
  });
  const { token } = await signIn(s);
  const before = fs.readFileSync(s.layout, 'utf8');
  const refusals = [
    ...[undefined, null, 'true', 'false', 1, 0, '', [], [true], {}].map(archived => [{ id: 'one', archived }, 400, /Archived or not/]),
    [{ id: 'nobody', archived: true }, 404, /No session with that id/],
    [{ id: 'nobody', archived: false }, 404, /No session with that id/],
    [{ archived: true }, 400, /Which session/],
    [{ id: 7, archived: true }, 400, /Which session/],
    [{ id: '../one', archived: true }, 400, /Which session/],
  ];
  for (const [body, status, message] of refusals) {
    const res = await post(s, token, body);
    assert.equal(res.status, status, JSON.stringify(body));
    assert.match(res.body().error, message, JSON.stringify(body));
  }
  const notJson = await request(s, 'POST', '/api/layout/archive', { headers: as(token), form: { id: 'one', archived: 'true' } });
  assert.equal(notJson.status, 400);
  assert.match(notJson.body().error, /JSON/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('only a signed-in POST from this site archives anything, and a GET to the path never does', async () => {
  const s = await start({ sessions: [{ id: 'one', title: 'One', ago: 1 }] });
  const { token } = await signIn(s);
  const before = fs.readFileSync(s.layout, 'utf8');
  const body = { id: 'one', archived: true };
  assert.equal((await request(s, 'GET', '/api/layout/archive?id=one&archived=true', { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'PUT', '/api/layout/archive', { headers: as(token), json: body })).status, 404);
  assert.equal((await request(s, 'POST', '/api/layout/archive', { json: body })).status, 401, 'signed out');
  assert.equal((await post(s, token, body, { origin: 'http://evil.example' })).status, 403, 'cross-site');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.equal((await post(s, token, body, { origin: s.origin })).status, 200, 'the same origin is let through');
});

test('with a layout file that cannot be read, archiving answers with the error and leaves the file as it was', async () => {
  const s = await start({ sessions: [{ id: 'one', title: 'One', ago: 1 }] });
  const { token } = await signIn(s);
  fs.writeFileSync(s.layout, '{ not json');
  for (const archived of [true, false]) {
    const res = await post(s, token, { id: 'one', archived });
    assert.equal(res.status, 500, String(archived));
    assert.match(res.body().error, /layout\.json cannot be read/);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), '{ not json');
});

test('archiving a chat that waits on an approval denies it, interrupts the turn and closes the process, and a later message starts it again', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'busy', 'ask for approval');
  await until(async () => stateOf(await index(s, token), 'busy') === 'waiting');

  const res = await post(s, token, { id: 'busy', archived: true });
  assert.deepEqual(res.body(), { id: 'busy', group: null, pinned: false, archived: true, stopped: true });
  await until(() => cliCalls(s).some(c => c.closed));
  assert.deepEqual(cliCalls(s).filter(c => c.response || c.control === 'interrupt' || c.closed), [{ response: 'deny', requestId: 'perm-1' }, { control: 'interrupt' }, { closed: true }]);
  await until(async () => (await archive(s, token)).find(r => r.id === 'busy').state === 'idle');

  const again = await send(s, token, 'busy', 'a message after it was archived');
  assert.equal(again.body().unarchived, true);
  await until(() => processes(s, 'busy') === 2);
  assert.deepEqual(places(await index(s, token)).ungrouped, ['Busy one']);
  assert.deepEqual(await archive(s, token), []);
});

test('archiving a chat in the middle of a turn interrupts it and closes the process', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'busy', 'keep going');
  await until(() => said(s, 'keep going'));
  assert.equal(stateOf(await index(s, token), 'busy'), 'working');

  const res = await post(s, token, { id: 'busy', archived: true });
  assert.deepEqual(res.body(), { id: 'busy', group: null, pinned: false, archived: true, stopped: true });
  await until(() => cliCalls(s).some(c => c.closed));
  assert.deepEqual(cliCalls(s).filter(c => c.response || c.control === 'interrupt' || c.closed), [{ control: 'interrupt' }, { closed: true }]);
  await until(async () => (await archive(s, token)).find(r => r.id === 'busy').state === 'idle');
});

test('a turn that archiving interrupts ends with no error for a viewer or in the status, though the CLI exits without answering the interrupt', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'busy', 'keep going');
  await until(() => said(s, 'keep going'));
  const viewer = listen(s, token, 'busy');
  await until(() => viewer.events.some(e => e.type === 'status'));

  assert.equal((await post(s, token, { id: 'busy', archived: true })).status, 200);
  await until(() => viewer.events.some(e => e.type === 'exit'));
  viewer.close();
  assert.deepEqual(turnEnds(viewer), [{ error: false, message: '' }]);
  assert.equal((await statusOf(s, token, 'busy')).lastError, '');
});

test('a turn that fails after one archiving interrupted still reports its error', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'busy', 'keep going');
  await until(() => said(s, 'keep going'));
  const viewer = listen(s, token, 'busy');
  await until(() => viewer.events.some(e => e.type === 'status'));
  await post(s, token, { id: 'busy', archived: true });
  await until(() => viewer.events.some(e => e.type === 'exit'));

  await send(s, token, 'busy', 'fail the turn');
  await until(() => turnEnds(viewer).length === 2);
  viewer.close();
  assert.deepEqual(turnEnds(viewer), [{ error: false, message: '' }, { error: true, message: 'The fake turn failed.' }]);
  assert.equal((await statusOf(s, token, 'busy')).lastError, 'The fake turn failed.');
});

test('a Stop on a chat with no turn running does not hide the error of its next turn', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'calm', 'finish the turn');
  await until(async () => stateOf(await index(s, token), 'calm') === 'idle');
  const viewer = listen(s, token, 'calm');
  await until(() => viewer.events.some(e => e.type === 'status'));

  assert.equal((await request(s, 'POST', '/api/sessions/calm/stop', { headers: as(token), json: {} })).status, 200);
  await until(() => cliCalls(s).some(c => c.control === 'interrupt'));
  await send(s, token, 'calm', 'fail the turn');
  await until(() => turnEnds(viewer).length === 1);
  viewer.close();
  assert.equal(turnEnds(viewer)[0].message, 'The fake turn failed.');
  assert.equal(processes(s, 'calm'), 1, 'in the same process');
});

test('archiving an idle chat closes its process with no interrupt, and does not say it stopped anything', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'calm', 'finish the turn');
  await until(async () => stateOf(await index(s, token), 'calm') === 'idle');
  assert.deepEqual(touched(s), [], 'the process is still open');

  const res = await post(s, token, { id: 'calm', archived: true });
  assert.deepEqual(res.body(), { id: 'calm', group: null, pinned: false, archived: true });
  await until(() => cliCalls(s).some(c => c.closed));
  assert.deepEqual(cliCalls(s).filter(c => c.response || c.control === 'interrupt'), []);
  assert.deepEqual(titles(await archive(s, token)), ['Calm one']);
});

test('unarchiving a session whose chat is running leaves the process open, and the turn waiting', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'busy', 'ask for approval');
  await until(async () => stateOf(await index(s, token), 'busy') === 'waiting');
  fs.writeFileSync(s.layout, JSON.stringify({ ...onDisk(s), archived: { busy: minutesAgo(1) } }));
  assert.deepEqual(titles(await archive(s, token)), ['Busy one'], 'archived by hand, with its chat running');

  const res = await post(s, token, { id: 'busy', archived: false });
  assert.deepEqual(res.body(), { id: 'busy', group: null, pinned: false, archived: false });
  const ix = await index(s, token);
  assert.deepEqual(places(ix).ungrouped, ['Busy one']);
  assert.equal(stateOf(ix, 'busy'), 'waiting');

  const approved = await request(s, 'POST', '/api/sessions/busy/approve', { headers: as(token), json: { requestId: 'perm-1', decision: 'allow' } });
  assert.equal(approved.status, 200);
  await until(() => cliCalls(s).some(c => c.response === 'allow'));
  assert.equal(processes(s, 'busy'), 1);
  assert.deepEqual(touched(s), []);
});

test('archiving a session that Capcom has never run starts no process', async () => {
  const s = await start({
    claude: true,
    sessions: [{ id: 'quiet', title: 'Quiet one', ago: 1 }, { id: 'terminal', title: 'Terminal one', source: 'cli', ago: 2 }, { id: 'other', title: 'Other one', ago: 3 }],
  });
  const { token } = await signIn(s);
  for (const id of ['quiet', 'terminal']) assert.deepEqual((await post(s, token, { id, archived: true })).body(), { id, group: null, pinned: false, archived: true }, id);

  await send(s, token, 'other', 'finish the turn');
  await until(() => said(s, 'finish the turn'));
  assert.deepEqual(['quiet', 'terminal', 'other'].map(id => processes(s, id)), [0, 0, 1]);
  assert.deepEqual(touched(s), []);
  assert.deepEqual(titles(await archive(s, token)).sort(), ['Quiet one', 'Terminal one']);
});

test('archiving with a layout file that cannot be read stops nothing', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'busy', 'ask for approval');
  await until(async () => stateOf(await index(s, token), 'busy') === 'waiting');
  fs.writeFileSync(s.layout, '{ not json');

  const res = await post(s, token, { id: 'busy', archived: true });
  assert.equal(res.status, 500);
  assert.match(res.body().error, /layout\.json cannot be read/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), '{ not json');
  const approved = await request(s, 'POST', '/api/sessions/busy/approve', { headers: as(token), json: { requestId: 'perm-1', decision: 'allow' } });
  assert.equal(approved.status, 200);
  await until(() => cliCalls(s).some(c => c.response === 'allow'));
  assert.deepEqual(touched(s), []);
});

// The fake CLI logs what it reads in order, so once it has logged a later message, nothing sent before it is still on its way.
const flushed = async (s, token, id) => {
  const text = `flush ${cliCalls(s).length}`;
  await send(s, token, id, text);
  await until(() => said(s, text));
};

test('archiving a working chat with stop: false answers 409 and changes nothing, and the same request without it stops and archives the chat', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'busy', 'keep going');
  await until(() => said(s, 'keep going'));
  assert.equal(stateOf(await index(s, token), 'busy'), 'working');
  const before = fs.readFileSync(s.layout, 'utf8');

  const refused = await post(s, token, { id: 'busy', archived: true, stop: false });
  assert.equal(refused.status, 409);
  assert.match(refused.body().error, /running/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  await flushed(s, token, 'busy');
  assert.deepEqual(touched(s), [], 'no interrupt and no close');
  assert.equal(processes(s, 'busy'), 1);
  const ix = await index(s, token);
  assert.deepEqual(places(ix).ungrouped, ['Busy one']);
  assert.equal(stateOf(ix, 'busy'), 'working');
  assert.deepEqual(await archive(s, token), []);

  const res = await post(s, token, { id: 'busy', archived: true });
  assert.deepEqual(res.body(), { id: 'busy', group: null, pinned: false, archived: true, stopped: true });
  await until(() => cliCalls(s).some(c => c.closed));
  assert.deepEqual(touched(s), [{ control: 'interrupt' }, { closed: true }]);
  assert.deepEqual(titles(await archive(s, token)), ['Busy one']);
});

test('archiving a waiting chat with stop: false answers 409 and leaves its approval to answer, and stop: true denies it as before', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'busy', 'ask for approval');
  await until(async () => stateOf(await index(s, token), 'busy') === 'waiting');

  assert.equal((await post(s, token, { id: 'busy', archived: true, stop: false })).status, 409);
  await flushed(s, token, 'busy');
  assert.deepEqual(touched(s), [], 'the approval is not denied');
  assert.equal(stateOf(await index(s, token), 'busy'), 'waiting');
  assert.deepEqual(await archive(s, token), []);

  const res = await post(s, token, { id: 'busy', archived: true, stop: true });
  assert.deepEqual(res.body(), { id: 'busy', group: null, pinned: false, archived: true, stopped: true });
  await until(() => cliCalls(s).some(c => c.closed));
  assert.deepEqual(touched(s), [{ response: 'deny', requestId: 'perm-1' }, { control: 'interrupt' }, { closed: true }]);
});

test('archiving an idle chat with stop: false archives it and closes its process, and does not say it stopped anything', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 1 }] });
  const { token } = await signIn(s);
  await send(s, token, 'calm', 'finish the turn');
  await until(async () => stateOf(await index(s, token), 'calm') === 'idle');
  assert.deepEqual(touched(s), [], 'the process is still open');

  const res = await post(s, token, { id: 'calm', archived: true, stop: false });
  assert.deepEqual(res.body(), { id: 'calm', group: null, pinned: false, archived: true });
  await until(() => cliCalls(s).some(c => c.closed));
  assert.deepEqual(touched(s), [{ closed: true }]);
  assert.deepEqual(titles(await archive(s, token)), ['Calm one']);
});

test('archiving a session that Capcom has never run with stop: false archives it and starts no process', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'quiet', title: 'Quiet one', ago: 1 }] });
  const { token } = await signIn(s);

  const res = await post(s, token, { id: 'quiet', archived: true, stop: false });
  assert.deepEqual(res.body(), { id: 'quiet', group: null, pinned: false, archived: true });
  assert.equal(processes(s, 'quiet'), 0);
  assert.deepEqual(touched(s), []);
  assert.deepEqual(titles(await archive(s, token)), ['Quiet one']);
});

test('a stop that is not true or false is a 400 that writes nothing and leaves a running chat alone', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }, { id: 'quiet', title: 'Quiet one', ago: 2 }] });
  const { token } = await signIn(s);
  await send(s, token, 'busy', 'keep going');
  await until(() => said(s, 'keep going'));
  const before = fs.readFileSync(s.layout, 'utf8');

  for (const stop of ['no', 'false', '', 0, 1, null, [], [false], {}]) {
    for (const [id, archived] of [['busy', true], ['quiet', true], ['quiet', false]]) {
      const body = { id, archived, stop };
      const res = await post(s, token, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(res.body().error, /Stop it or not/, JSON.stringify(body));
    }
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  await flushed(s, token, 'busy');
  assert.deepEqual(touched(s), []);
  assert.equal(stateOf(await index(s, token), 'busy'), 'working');
});
