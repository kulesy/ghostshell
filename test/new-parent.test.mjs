// Run with `npm test`. A new parent for several sessions: the booked session it makes, the links and place it gives, the folder it works
// in, what it refuses, the Undo, and the first message to it. Over HTTP against the real server with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { everyRow } from '../public/ui/tree.js';
import { as, cliCalls, request, restart, signIn, start, until } from './harness.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GROUP_CHAT = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const GROUPS = [{ id: 'cg-work', name: 'Work' }, { id: 'cg-home', name: 'Home', session: GROUP_CHAT }];
const SESSIONS = [
  { id: 'boss', title: 'Boss', group: 'cg-work', ago: 5 },
  { id: 'mid', title: 'Mid', parent: 'boss', ago: 4 },
  { id: 'leaf', title: 'Leaf', parent: 'mid', ago: 3 },
  { id: 'kid', title: 'Kid', parent: 'boss', ago: 2 },
  { id: 'peer', title: 'Peer', group: 'cg-work', ago: 6 },
  { id: 'loner', title: 'Loner', ago: 7 },
  { id: 'other', title: 'Other loner', ago: 8 },
  { id: 'pin', title: 'Pinned one', pinned: true, ago: 9 },
  { id: 'run', title: 'Nightly', routine: 'nightly', ago: 10 },
  { id: 'gone', title: 'Archived one', archived: true, ago: 11 },
  { id: 'mine', title: 'Started here', source: 'capcom', ago: 12 },
];

const post = (s, token, route, json, headers) => request(s, 'POST', route, { headers: { ...as(token), ...headers }, json });
const make = (s, token, json, headers) => post(s, token, '/api/layout/parent', json, headers);
const undo = (s, token, json) => post(s, token, '/api/layout/parent/undo', json);
const read = file => fs.readFileSync(file, 'utf8');
const onDisk = s => JSON.parse(read(s.layout));
const startedFile = s => path.join(s.state, 'started.json');
const booked = s => JSON.parse(read(startedFile(s))).filter(e => e.booked);
const index = async (s, token) => (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
const rowOf = (ix, id) => everyRow(ix).find(r => r.id === id);
const titles = list => list.map(r => r.title);
const startsOf = s => cliCalls(s).filter(c => c.started);
const flagOf = (argv, name) => argv[argv.indexOf(name) + 1];
const transcripts = s => path.join(s.home, '.claude', 'projects');
const hasFile = (s, id) => fs.readdirSync(transcripts(s)).some(dir => fs.existsSync(path.join(transcripts(s), dir, `${id}.jsonl`)));

async function ready(mine) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true, ...mine });
  return { s, ...(await signIn(s)) };
}

// Every file a refusal must leave as it found it.
const snapshot = s => [s.layout, startedFile(s)].map(file => read(file));

test('a new parent is booked: it has an id, a title of its own, no process and no transcript, and the sessions nest under it in its place', async () => {
  const { s, token } = await ready();
  const res = await make(s, token, { ids: ['loner', 'other'], title: '  Login   work ' });
  assert.equal(res.status, 200, res.text);
  const made = res.body();
  assert.match(made.id, UUID);
  assert.deepEqual([made.title, made.count, made.group, made.pinned], ['Login work', 2, null, false]);
  assert.deepEqual(booked(s), [{ id: made.id, cwd: booked(s)[0].cwd, at: booked(s)[0].at, title: 'Login work', booked: true }]);
  assert.deepEqual(onDisk(s).titles, { [made.id]: 'Login work' });
  assert.deepEqual(onDisk(s).parents, { loner: made.id, other: made.id });
  const ix = await index(s, token);
  assert.deepEqual(ix.features.newParent, true);
  const parent = ix.started.find(r => r.id === made.id);
  assert.deepEqual([parent.title, parent.source, parent.renamed, titles(parent.children)], ['Login work', 'capcom', true, ['Loner', 'Other loner']]);
  assert.deepEqual(ix.ungrouped.map(r => r.id), []);
  assert.equal(hasFile(s, made.id), false, 'no transcript');
  assert.deepEqual(cliCalls(s), [], 'no process started, so no tokens spent');
});

test('the answer carries a snapshot of every entry the write changed, and the booking is one session in started.json beside the others', async () => {
  const { s, token } = await ready({ layout: { parents: { loner: null } } });
  const made = (await make(s, token, { ids: ['loner', 'pin'], title: 'Two', place: { group: null, pinned: false } })).body();
  assert.deepEqual(made.before, { loner: { parent: null, group: null, pinned: false }, pin: { parent: false, group: null, pinned: true } });
  assert.deepEqual(JSON.parse(read(startedFile(s))).map(e => e.id), ['mine', made.id]);
});

test('when the sessions are all in one place the parent goes there: a group, Pinned, or the loose list', async () => {
  const { s, token } = await ready();
  const inGroup = (await make(s, token, { ids: ['boss', 'peer'], title: 'In work' })).body();
  assert.deepEqual([inGroup.group, inGroup.pinned], ['cg-work', false]);
  const pinned = (await make(s, token, { ids: ['pin', 'run'], title: 'Pinned parent', place: { group: null, pinned: true } })).body();
  assert.equal(pinned.pinned, true);
  const loose = (await make(s, token, { ids: ['loner', 'other'], title: 'Loose parent' })).body();
  assert.deepEqual([loose.group, loose.pinned], [null, false]);
  const ix = await index(s, token);
  assert.deepEqual(ix.groups.find(g => g.id === 'cg-work').sessions.map(r => r.id), [inGroup.id], 'the group lists the parent and the family follows it');
  assert.deepEqual(ix.pinned.map(r => r.id), [pinned.id]);
  assert.deepEqual(ix.started.map(r => r.id).sort(), [loose.id, 'mine'].sort());
  assert.deepEqual(titles(rowOf(ix, inGroup.id).children).sort(), ['Boss', 'Leaf', 'Kid', 'Mid', 'Peer'].sort());
});

test('a pinned selection gives a pinned parent when no place is sent, and a family\'s members count by their family\'s place', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['pin', 'kid'], title: 'Different' }));
  assert.deepEqual([made.status, made.body().error], [400, 'The sessions are in different places. Choose where it goes.'], 'kid shows in Work with its parent');
  const together = (await make(s, token, { ids: ['kid', 'peer'], title: 'Same family place' })).body();
  assert.deepEqual([together.group, together.pinned], ['cg-work', false]);
});

test('sessions in different places need a place: it is refused without one, and the one sent is used, a group, Pinned or loose', async () => {
  const { s, token } = await ready();
  const before = snapshot(s);
  const none = await make(s, token, { ids: ['boss', 'loner'], title: 'Mixed' });
  assert.deepEqual([none.status, none.body().error], [400, 'The sessions are in different places. Choose where it goes.']);
  assert.deepEqual(snapshot(s), before);
  for (const place of [{ group: 'cg-home', pinned: false }, { group: null, pinned: true }, { group: null, pinned: false }]) {
    const res = await make(s, token, { ids: ['peer', 'other'], title: `To ${JSON.stringify(place)}`, place });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body().group, res.body().pinned], [place.group, place.pinned]);
    await undo(s, token, { id: res.body().id, before: res.body().before });
  }
});

test('a place that is not a place, or names a group that is gone, is refused and writes nothing', async () => {
  const { s, token } = await ready();
  const before = snapshot(s);
  for (const place of [5, 'pinned', { group: 'cg-work' }, { pinned: true }, { group: 5, pinned: false }, { group: null, pinned: 'yes' }]) {
    const res = await make(s, token, { ids: ['boss', 'loner'], title: 'Odd', place });
    assert.deepEqual([res.status, res.body().error], [400, 'Where should it go?'], JSON.stringify(place));
  }
  const gone = await make(s, token, { ids: ['boss', 'loner'], title: 'Gone', place: { group: 'cg-gone', pinned: false } });
  assert.deepEqual([gone.status, gone.body().error], [400, 'Unknown group.']);
  assert.deepEqual(snapshot(s), before);
});

test('a selection that holds a session and its child keeps the link between them, and only the session links to the new parent', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['boss', 'kid'], title: 'Boss and kid' })).body();
  assert.deepEqual(onDisk(s).parents, { boss: made.id });
  const ix = await index(s, token);
  assert.deepEqual(titles(rowOf(ix, made.id).children).sort(), ['Boss', 'Kid', 'Leaf', 'Mid'], 'the family follows its head');
  assert.equal(rowOf(ix, 'kid').via, 'boss');
  assert.equal(rowOf(ix, 'boss').via, made.id);
});

test('a session whose parent is not picked links straight to the new parent, and the parent keeps its other children', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['kid', 'peer'], title: 'Kid and peer' })).body();
  assert.deepEqual(onDisk(s).parents, { kid: made.id, peer: made.id });
  const ix = await index(s, token);
  assert.deepEqual(titles(rowOf(ix, made.id).children), ['Kid', 'Peer']);
  assert.deepEqual(titles(rowOf(ix, 'boss').children).sort(), ['Leaf', 'Mid'], 'Boss keeps Mid, and Leaf with it');
  assert.equal(rowOf(ix, 'boss').parent, null);
});

test('a session that already had a parent outside the selection is relinked straight to the new parent, and its own group and pin go', async () => {
  const { s, token } = await ready({ layout: { parents: { loner: 'peer' } } });
  const made = (await make(s, token, { ids: ['loner', 'pin'], title: 'Moved', place: { group: 'cg-work', pinned: false } })).body();
  const now = onDisk(s);
  assert.deepEqual([now.parents.loner, now.parents.pin], [made.id, made.id]);
  assert.equal(now.pinned.includes('pin'), false, 'the pin goes with the nest');
  assert.equal(now.assignments[made.id], 'cg-work');
});

test('an unselected child under a selected nested session stays with the session it showed under, as a nest does', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['mid', 'peer'], title: 'Mid and peer' })).body();
  assert.deepEqual(onDisk(s).parents, { leaf: 'boss', mid: made.id, peer: made.id });
  assert.deepEqual(made.before.leaf, { parent: false, group: null, pinned: false }, 'the relinked child is in the snapshot');
  const ix = await index(s, token);
  assert.deepEqual(titles(rowOf(ix, 'boss').children).sort(), ['Kid', 'Leaf']);
  assert.deepEqual(titles(rowOf(ix, made.id).children), ['Mid', 'Peer']);
});

test('a selected child of a selected nested session rides along with it, and the rule for an unselected one is dropped for it', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['mid', 'leaf', 'peer'], title: 'Mid, leaf and peer' })).body();
  assert.deepEqual(onDisk(s).parents, { mid: made.id, peer: made.id });
  assert.equal(rowOf(await index(s, token), 'leaf').via, 'mid');
});

test('a selected child whose parent is not picked is linked straight to the new parent and not back to the one it showed under', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['mid', 'leaf'], title: 'Mid and leaf' })).body();
  assert.deepEqual(onDisk(s).parents, { mid: made.id }, 'leaf rides with mid');
  const second = (await make(s, token, { ids: ['leaf', 'peer'], title: 'Leaf and peer' })).body();
  assert.deepEqual([onDisk(s).parents.leaf, onDisk(s).parents.peer], [second.id, second.id]);
});

test('a routine run can be nested, as it can be by a drop', async () => {
  const { s, token } = await ready();
  const res = await make(s, token, { ids: ['run', 'loner'], title: 'With a run' });
  assert.equal(res.status, 200, res.text);
});

test('the parent works in the repo its sessions share, whichever worktree each is in', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-repo-'));
  for (const name of ['one', 'two']) fs.mkdirSync(path.join(repo, '.claude', 'worktrees', name), { recursive: true });
  const { s, token } = await ready({ sessions: [
    { id: 'a', title: 'A', ago: 1, fields: { cwd: path.join(repo, '.claude', 'worktrees', 'one') } },
    { id: 'b', title: 'B', ago: 2, fields: { cwd: path.join(repo, '.claude', 'worktrees', 'two') } },
    { id: 'c', title: 'C', ago: 3, fields: { cwd: repo } },
  ] });
  await make(s, token, { ids: ['a', 'b', 'c'], title: 'One repo' });
  assert.equal(booked(s)[0].cwd, repo);
});

test('sessions in different repos give the parent the repo of the one that ran last, and a folder that is gone falls to the next, then home', async () => {
  const repos = ['x', 'y', 'z'].map(name => fs.mkdtempSync(path.join(os.tmpdir(), `capcom-repo-${name}-`)));
  fs.mkdirSync(path.join(repos[0], '.claude', 'worktrees', 'w'), { recursive: true });
  const { s, token } = await ready({ sessions: [
    { id: 'a', title: 'A', ago: 5, fields: { cwd: path.join(repos[0], '.claude', 'worktrees', 'w') } },
    { id: 'b', title: 'B', ago: 1, fields: { cwd: repos[1] } },
    { id: 'c', title: 'C', ago: 9, fields: { cwd: repos[2] } },
  ] });
  const first = (await make(s, token, { ids: ['a', 'b', 'c'], title: 'Mixed' })).body();
  assert.equal(booked(s).find(e => e.id === first.id).cwd, repos[1], 'B ran last');
  await undo(s, token, { id: first.id, before: first.before });
  fs.rmSync(repos[1], { recursive: true });
  const second = (await make(s, token, { ids: ['a', 'b', 'c'], title: 'Mixed again' })).body();
  assert.equal(booked(s).find(e => e.id === second.id).cwd, repos[0], 'B is gone, so A, the next to have run');
  await undo(s, token, { id: second.id, before: second.before });
  fs.rmSync(repos[0], { recursive: true });
  fs.rmSync(repos[2], { recursive: true });
  const third = (await make(s, token, { ids: ['a', 'b', 'c'], title: 'None left' })).body();
  assert.equal(booked(s).find(e => e.id === third.id).cwd, s.home, 'none of them is on this Mac, so home');
});

test('every refusal is one short sentence and writes nothing', async () => {
  const { s, token } = await ready();
  const before = snapshot(s);
  const cases = [
    [{ ids: ['loner'], title: 'One' }, 400, 'Pick at least two sessions.'],
    [{ ids: [], title: 'None' }, 400, 'Pick at least two sessions.'],
    [{ title: 'No ids' }, 400, 'Pick at least two sessions.'],
    [{ ids: 'loner,other', title: 'Text' }, 400, 'Pick at least two sessions.'],
    [{ ids: ['loner', '../etc'], title: 'Bad id' }, 400, 'Which sessions?'],
    [{ ids: ['loner', 5], title: 'Not text' }, 400, 'Which sessions?'],
    [{ ids: ['loner', 'nobody'], title: 'Unknown' }, 404, 'No session with that id on this Mac.'],
    [{ ids: ['loner', GROUP_CHAT], title: 'A chat' }, 400, 'A group\'s session stays with its group.'],
    [{ ids: ['loner', 'gone'], title: 'Archived' }, 400, 'An archived session cannot be nested.'],
    [{ ids: ['loner', 'other', 'loner'], title: 'Twice' }, 400, 'Each session can be picked once.'],
    [{ ids: ['loner', 'other'] }, 400, 'Give it a name.'],
    [{ ids: ['loner', 'other'], title: '   ' }, 400, 'Give it a name.'],
    [{ ids: ['loner', 'other'], title: 5 }, 400, 'Give it a name.'],
    [{ ids: ['loner', 'other'], title: 'x'.repeat(121) }, 400, 'Names run to 120 characters at most.'],
  ];
  for (const [json, status, error] of cases) {
    const res = await make(s, token, json);
    assert.deepEqual([res.status, res.body().error], [status, error], JSON.stringify(json));
  }
  assert.deepEqual(snapshot(s), before);
  assert.equal(fs.existsSync(path.join(s.home, 'claude.log')), false);
});

test('a section\'s chat is refused like a group\'s', async () => {
  const sections = { pinned: '4c2a7d1f-9b3e-4a68-8d25-e38f61b7c9d2' };
  const { s, token } = await ready({ layout: { sections } });
  const res = await make(s, token, { ids: ['loner', sections.pinned], title: 'A chat' });
  assert.deepEqual([res.status, res.body().error], [400, 'A section\'s session stays with its section.']);
});

test('the route needs a sign-in, the same origin and a JSON body, as the other layout routes do', async () => {
  const { s, token } = await ready();
  const before = snapshot(s);
  const body = { ids: ['loner', 'other'], title: 'Nope' };
  assert.equal((await request(s, 'POST', '/api/layout/parent', { json: body })).status, 401);
  assert.equal((await request(s, 'POST', '/api/layout/parent/undo', { json: { id: 'x', before: {} } })).status, 401);
  assert.equal((await make(s, token, body, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(s, 'GET', '/api/layout/parent', { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'POST', '/api/layout/parent', { headers: { ...as(token), 'content-type': 'application/json' }, form: undefined })).status, 400);
  assert.deepEqual(snapshot(s), before);
});

test('Undo with no message in the parent restores the layout exactly and takes the booking out, so the parent leaves the list', async () => {
  const { s, token } = await ready({ layout: { parents: { loner: null } } });
  const files = snapshot(s);
  const kept = file => ({ parents: {}, assignments: {}, pinned: [], titles: {}, ...Object.fromEntries(['parents', 'assignments', 'pinned', 'titles'].filter(k => k in JSON.parse(file)).map(k => [k, JSON.parse(file)[k]])) });
  const made = (await make(s, token, { ids: ['boss', 'mid', 'loner', 'pin'], title: 'Everything', place: { group: 'cg-home', pinned: false } })).body();
  assert.notDeepEqual(snapshot(s), files);
  const res = await undo(s, token, { id: made.id, before: made.before });
  assert.deepEqual([res.status, res.body()], [200, { id: made.id, removed: true }]);
  assert.deepEqual(kept(snapshot(s)[0]), kept(files[0]), 'the layout is as it was');
  assert.equal(booked(s).length, 0);
  assert.equal(rowOf(await index(s, token), made.id), undefined);
  assert.equal((await undo(s, token, { id: made.id, before: made.before })).status, 404, 'a second Undo finds nothing');
});

test('Undo after the owner wrote in the parent archives it and restores the links', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['loner', 'other'], title: 'Worked in' })).body();
  assert.equal((await post(s, token, `/api/sessions/${made.id}/send`, { text: 'begin a session' })).status, 200);
  await until(() => hasFile(s, made.id));
  const res = await undo(s, token, { id: made.id, before: made.before });
  assert.deepEqual([res.status, res.body().archived], [200, true]);
  const now = onDisk(s);
  assert.deepEqual([now.parents, now.titles, Object.keys(now.archived)], [{}, {}, [made.id]]);
  const ix = await index(s, token);
  assert.equal(rowOf(ix, made.id), undefined);
  assert.deepEqual(ix.started.map(r => r.id), ['mine']);
  assert.deepEqual(ix.ungrouped.map(r => r.id).sort(), ['loner', 'other'].sort(), 'the sessions are back where they were');
  assert.equal(booked(s).length, 1, 'the booking stays for a session that has messages');
});

test('Undo refuses an undo that this server could not have made, a session that is not a booked parent, and an id that is not one', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['loner', 'other'], title: 'Mine' })).body();
  const before = snapshot(s);
  const fine = { parent: false, group: null, pinned: false };
  for (const bad of [undefined, null, [], { 'a b': fine }, { loner: { ...fine, pinned: 'yes' } }, { loner: { ...fine, extra: 1 } }, { loner: { parent: 5, group: null, pinned: false } }, { loner: 'x' }]) {
    const res = await undo(s, token, { id: made.id, before: bad });
    assert.deepEqual([res.status, res.body().error], [400, 'That undo is not one this server made.'], JSON.stringify(bad));
  }
  assert.equal((await undo(s, token, { id: 'loner', before: made.before })).status, 404, 'an ordinary session is not undone');
  assert.equal((await undo(s, token, { id: 'mine', before: made.before })).status, 404, 'nor is one started here');
  assert.equal((await undo(s, token, { id: '../x', before: made.before })).status, 400);
  assert.equal((await undo(s, token, { before: made.before })).status, 400);
  assert.deepEqual(snapshot(s), before);
});

test('a booked parent stays in the list after ten minutes with no transcript, and across a restart, where an ordinary started session would be dropped', async () => {
  const { s, token } = await ready({ sessions: [...SESSIONS, { id: 'ghost', title: 'Ghost', source: 'capcom', ago: 1 }] });
  const made = (await make(s, token, { ids: ['loner', 'other'], title: 'Patient' })).body();
  const entries = JSON.parse(read(startedFile(s)));
  const old = Date.now() - 30 * 60_000;
  fs.writeFileSync(startedFile(s), JSON.stringify(entries.map(e => ({ ...e, at: e.id === made.id || e.id === 'ghost' ? old : e.at }))));
  fs.unlinkSync(path.join(transcripts(s), '-test-folder', 'ghost.jsonl'));
  const seen = async server => (await index(server, (await signIn(server)).token)).started.map(r => r.id);
  assert.ok((await seen(s)).includes(made.id));
  const again = await restart(s);
  assert.deepEqual((await seen(again)).sort(), [made.id, 'mine'].sort());
  assert.equal(rowOf(await index(again, (await signIn(again)).token), made.id).state, 'idle');
});

test('the first message to a booked parent starts the CLI with --session-id and its own folder, and a later one resumes it', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['loner', 'other'], title: 'First message' })).body();
  assert.equal((await post(s, token, `/api/sessions/${made.id}/send`, { text: 'begin a session' })).status, 200);
  await until(() => startsOf(s).length === 1);
  const [first] = startsOf(s);
  assert.equal(flagOf(first.started, '--session-id'), made.id);
  assert.equal(first.started.includes('--resume'), false);
  assert.equal(fs.realpathSync(first.cwd), fs.realpathSync(booked(s)[0].cwd));
  await until(() => hasFile(s, made.id));
  assert.equal((await post(s, token, '/api/layout/archive', { id: made.id, archived: true })).status, 200, 'archiving stops the process');
  assert.equal((await post(s, token, `/api/sessions/${made.id}/send`, { text: 'begin a session' })).status, 200);
  await until(() => startsOf(s).length === 2);
  const second = startsOf(s)[1].started;
  assert.deepEqual([second.includes('--session-id'), flagOf(second, '--resume')], [false, made.id]);
  assert.deepEqual(onDisk(s).titles, { [made.id]: 'First message' }, 'the title the owner gave is the one the list keeps');
});

test('the tools of a parent that has only just been written in already list its children, with nothing sent to name them', async () => {
  const { s, token } = await ready();
  const made = (await make(s, token, { ids: ['loner', 'other'], title: 'Has kids' })).body();
  assert.equal((await post(s, token, `/api/sessions/${made.id}/send`, { text: 'call list_sub_sessions {}' })).status, 200);
  await until(() => cliCalls(s).some(c => c.mcp));
  const text = cliCalls(s).find(c => c.mcp).mcp.result.content[0].text;
  assert.match(text, /Session "Has kids": 2 sub sessions/);
  assert.match(text, /- Loner \[loner\]/);
  assert.match(text, /- Other loner \[other\]/);
});

test('a title the owner gives is never replaced by the auto-titler', async () => {
  const { s, token } = await ready({ autoTitle: true });
  const made = (await make(s, token, { ids: ['loner', 'other'], title: 'Mine to keep' })).body();
  await post(s, token, `/api/sessions/${made.id}/send`, { text: 'begin a session' });
  await until(() => hasFile(s, made.id));
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(cliCalls(s).some(c => c.titled), false, 'the titler asked nothing');
  assert.equal(rowOf(await index(s, token), made.id).title, 'Mine to keep');
});
