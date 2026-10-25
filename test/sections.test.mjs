// Run with `npm test`. The five built-in sections of Home, each with a chat of its own as a group has: which sessions each holds, the index's
// account of them, how their chats are booked and started, what their tools reach and refuse, where a session they start goes, and that none of
// the layout's edits can touch a chat. Over HTTP against the real server and a fake CLI, with the rules and the guide tested on their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ELSEWHERE, guideFor, listGroupSessions, readGroupSession, startGroupSession, startRefusal } from '../lib/groups.mjs';
import { handleMcp } from '../lib/tools.mjs';
import { SECTION_IDS, SECTIONS, sectionById, sectionOf, sectionSessions } from '../public/ui/sections.js';
import { everyRow, withKids } from '../public/ui/tree.js';
import { as, cliCalls, request, signIn, start, until as waitFor } from './harness.mjs';

const CHATS = {
  routines: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c01',
  pinned: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c02',
  started: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c03',
  ungrouped: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c04',
  other: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c05',
};
const GROUP_CHAT = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c09';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ARCHIVED_AT = '2026-10-20T00:00:00.000Z';
const GROUPS = [{ id: 'cg-work', name: 'Work', session: GROUP_CHAT }];

// A session in every place a session can be, with a session nested under one in each list. Archiving a Desktop session is its own flag, and
// that of any other is the layout's.
//   Pinned: a Desktop one, a terminal one, a routine run, and a terminal session nested under the Desktop one.
//   Routines: a routine with 15 runs, so 2 are past the 12 earlier runs a routine shows, and a routine with an archived run.
//   Started here: 64 started from here, so 4 are past the 60 a list keeps, and a Desktop session nested under the newest.
//   Ungrouped and Terminal and other: two each, a session nested under the first of Ungrouped, and an archived one.
//   Families that cross apps once archived: a Desktop session with a capcom-started child, both archived (Ungrouped); a capcom-started row with
//   a routine run nested under it, both archived (Started here); a Desktop holder archived with a live terminal child; and an archived capcom
//   session under a live terminal session under an archived Desktop one. The archive and the count follow the holder in every case.
const STARTED = Array.from({ length: 64 }, (_, n) => ({ id: `st-${String(n).padStart(2, '0')}`, title: `Started ${n}`, source: 'capcom', ago: 30 + n }));
const SESSIONS = [
  { id: 'pin-desk', title: 'Pinned Desktop', pinned: true, ago: 5 },
  { id: 'pin-cli', title: 'Pinned terminal', source: 'cli', pinned: true, ago: 6 },
  { id: 'pin-run', title: 'Pinned run', source: 'capcom', routine: 'nightly', pinned: true, ago: 7 },
  { id: 'pin-kid', title: 'Under a pin', source: 'cli', ago: 8 },
  { id: 'pin-old', title: 'Archived pin', pinned: true, archived: true, ago: 9 },
  { id: 'grp-desk', title: 'Group Desktop', group: 'cg-work', ago: 10 },
  { id: 'grp-kid', title: 'Under a group member', source: 'capcom', ago: 11 },
  { id: 'grp-old', title: 'Archived group member', group: 'cg-work', archived: true, ago: 12 },
  ...Array.from({ length: 15 }, (_, n) => ({ id: `daily-${String(n).padStart(2, '0')}`, title: `Daily ${n}`, source: 'capcom', routine: 'daily', ago: 20 + n })),
  { id: 'weekly-0', title: 'Weekly', source: 'capcom', routine: 'weekly', ago: 40 },
  { id: 'weekly-old', title: 'Weekly archived', source: 'capcom', routine: 'weekly', ago: 41 },
  ...STARTED,
  { id: 'st-kid', title: 'Under a started session', ago: 100 },
  { id: 'un-0', title: 'Ungrouped one', ago: 50 },
  { id: 'un-1', title: 'Ungrouped two', ago: 51 },
  { id: 'un-kid', title: 'Under an ungrouped session', source: 'cli', ago: 52 },
  { id: 'un-old', title: 'Archived ungrouped', archived: true, ago: 53 },
  { id: 'ot-0', title: 'Terminal one', source: 'cli', ago: 60 },
  { id: 'ot-1', title: 'Terminal two', source: 'cli', ago: 61 },
  { id: 'ot-old', title: 'Archived terminal', source: 'cli', ago: 62 },
  { id: 'ar-desk', title: 'Archived Desktop parent', archived: true, ago: 70 },
  { id: 'ar-kid', title: 'Archived capcom child', source: 'capcom', ago: 71 },
  { id: 'rn-par', title: 'Archived started parent', source: 'capcom', ago: 72 },
  { id: 'rn-run', title: 'Archived run under it', source: 'capcom', routine: 'nightly', ago: 73 },
  { id: 'hold-old', title: 'Archived holder', archived: true, ago: 74 },
  { id: 'hold-live', title: 'Live child of an archived holder', source: 'cli', ago: 75 },
  { id: 'chain-a', title: 'Archived top', archived: true, ago: 76 },
  { id: 'chain-b', title: 'Live middle', source: 'cli', ago: 77 },
  { id: 'chain-c', title: 'Archived bottom', source: 'capcom', ago: 78 },
];
const LAYOUT = {
  archived: Object.fromEntries(['weekly-old', 'ot-old', 'ar-kid', 'rn-par', 'rn-run', 'chain-c'].map(id => [id, ARCHIVED_AT])),
  parents: { 'pin-kid': 'pin-desk', 'grp-kid': 'grp-desk', 'st-kid': 'st-00', 'un-kid': 'un-0', 'ar-kid': 'ar-desk', 'rn-run': 'rn-par', 'hold-live': 'hold-old', 'chain-b': 'chain-a', 'chain-c': 'chain-b' },
};
const NOT_HERE = name => `That session is not in this ${name}. Use list_group_sessions to see the ones you can reach.`;
const until = (check, ms = 20_000) => waitFor(check, ms);

const get = async (s, token, route) => (await request(s, 'GET', route, { headers: as(token) })).body();
const post = (s, token, route, json) => request(s, 'POST', route, { headers: as(token), json: json ?? {} });
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const startsOf = s => cliCalls(s).filter(c => c.started);
const flagOf = (argv, name) => argv[argv.indexOf(name) + 1];

// `booked` are the sections whose chats are booked already, as they are once their owner has opened them.
async function ready({ booked = SECTION_IDS, ...mine } = {}) {
  const sections = Object.fromEntries(booked.map(id => [id, CHATS[id]]));
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true, ...mine, layout: { ...LAYOUT, sections, ...mine.layout } });
  return { s, ...(await signIn(s)) };
}

const sendTo = async (s, token, id, text) => {
  const res = await post(s, token, `/api/sessions/${id}/send`, { text });
  assert.equal(res.status, 200, res.text);
};

const replies = s => cliCalls(s).filter(c => c.mcp).map(c => c.mcp);
async function callTool(s, token, id, tool, args) {
  const before = replies(s).length;
  await sendTo(s, token, id, `call ${tool} ${JSON.stringify(args)}`);
  await until(() => replies(s).length > before);
  return replies(s)[before];
}
const textOf = reply => reply.result.content[0].text;

// The chat of `id` started, so it can be asked to call a tool.
async function begin(s, token, id) {
  const before = startsOf(s).length;
  await sendTo(s, token, CHATS[id], 'begin a session');
  await until(() => startsOf(s).length > before);
}

// The ids a list says it holds, in the order it lists them.
const idsIn = text => [...text.matchAll(/^- .* \[([^\]]+)\] · /gm)].map(m => m[1]);

// What each section lists in the sidebar, nested sessions included, from the index with the archive left out.
const sidebar = (ix, id) => withKids(sectionSessions(ix, id)).map(r => r.id);

// ---- the rules ----------------------------------------------------------------------------------

test('the table has the five sections in sidebar order, named as the sidebar names them, and each says where a session started from its chat goes', () => {
  assert.deepEqual(SECTIONS.map(s => [s.id, s.name, s.place]), [
    ['routines', 'Routines', null],
    ['pinned', 'Pinned', 'pin'],
    ['started', 'Started here', 'loose'],
    ['ungrouped', 'Ungrouped', 'loose'],
    ['other', 'Terminal and other', null],
  ]);
  assert.deepEqual(SECTION_IDS, ['routines', 'pinned', 'started', 'ungrouped', 'other']);
  assert.equal(sectionById('pinned').name, 'Pinned');
  assert.equal(sectionById('cg-work'), null);
  assert.equal(sectionById(undefined), null);
  for (const s of SECTIONS) assert.doesNotMatch(`${s.name} ${s.holds}`, /[–—]/, s.id);
});

test('sectionOf puts pinned first, then a group, then a routine, then the loose section of the app, and a nested row follows the row it shows under', () => {
  const row = (id, extra) => ({ id, source: 'desktop', group: null, pinned: false, routine: null, parent: null, ...extra });
  const rows = new Map([
    row('pin', { pinned: true, group: 'cg-a', routine: 'r' }),
    row('grp', { group: 'cg-a', routine: 'r' }),
    row('run', { routine: 'r', source: 'capcom' }),
    row('cap', { source: 'capcom' }),
    row('desk'),
    row('cli', { source: 'cli' }),
    row('odd', { source: 'unknown' }),
    row('under-cap', { parent: 'cap' }),
    row('under-pin', { parent: 'pin', source: 'cli' }),
    row('under-grp', { parent: 'grp', source: 'cli' }),
    row('orphan', { parent: 'gone', source: 'cli' }),
  ].map(r => [r.id, r]));
  const sections = Object.fromEntries([...rows.keys()].map(id => [id, sectionOf(rows.get(id), rows)]));
  assert.deepEqual(sections, { pin: 'pinned', grp: null, run: 'routines', cap: 'started', desk: 'ungrouped', cli: 'other', odd: null, 'under-cap': 'started', 'under-pin': 'pinned', 'under-grp': null, orphan: 'other' });
});

test('sectionSessions gives the lists the sidebar draws, a routine\'s runs flattened latest first, and nothing for a name that is no section', () => {
  const ix = { pinned: ['p'], started: ['s'], ungrouped: ['u'], other: ['o'], routines: [{ latest: 'a1', earlier: ['a2', 'a3'] }, { latest: 'b1', earlier: [] }], groups: [{ id: 'cg-a', sessions: ['g'] }] };
  assert.deepEqual(sectionSessions(ix, 'routines'), ['a1', 'a2', 'a3', 'b1']);
  assert.deepEqual(['pinned', 'started', 'ungrouped', 'other'].map(id => sectionSessions(ix, id)), [['p'], ['s'], ['u'], ['o']]);
  for (const id of ['cg-a', 'groups', 'rows', 'sorts', 'constructor', undefined]) assert.deepEqual(sectionSessions(ix, id), [], String(id));
});

const guideOf = id => guideFor(sectionById(id).name, id);

test('a section\'s guide opens by saying it is one of GhostShell\'s sections, what it holds and that it cannot be renamed or removed, and keeps the owner\'s rules of a group\'s', () => {
  for (const id of ['pinned', 'started', 'ungrouped']) {
    const text = guideOf(id);
    assert.match(text, new RegExp(`^You are the session for one of GhostShell's own sidebar sections, "${sectionById(id).name}"\\. It holds ${sectionById(id).holds}\\. `), id);
    assert.match(text, /cannot rename or remove it/);
    assert.match(text, /- start_group_session starts a new session /);
    assert.match(text, /5\. When you start a session/);
    assert.match(text, /only reach this section's sessions/);
  }
  assert.match(guideOf('pinned'), /starts a new session and pins it, so it shows in Pinned\./);
  assert.match(guideOf('started'), /starts a new session in no group, so it shows in Started here\./);
  for (const id of ['routines', 'other']) {
    const text = guideOf(id);
    assert.match(text, /cannot hold a new session, so start_group_session and spawn_task are refused in this chat\. If the owner asks you to start work, say so, and suggest starting it from a group's chat, from the chat of Pinned or Started here, or in a new session\./, id);
    assert.doesNotMatch(text, /- start_group_session|5\. When you start|offer to start one/, id);
  }
  for (const id of SECTION_IDS) {
    const text = guideOf(id);
    assert.doesNotMatch(text, /\{\{|\[start\]|[–—]/, id);
    assert.match(text, /Message another session only when the owner asks you to in this chat\./);
    assert.match(text, /never permission/);
    assert.match(text, /Bash or Monitor, editing or writing a file, messaging another session and starting a session each show the owner a card/);
    assert.equal(text.includes('the group'), false, `${id} never says group where it means section`);
  }
  assert.match(guideFor('Work'), /^You are the session for the group "Work" in GhostShell\./);
  assert.match(guideFor('Work'), /- start_group_session starts a new session in the group\./);
  assert.match(guideFor('Work'), /5\. When you start a session/);
});

const member = (id, extra) => ({ id, title: `Session ${id}`, cwd: `/work/${id}`, branch: 'main', state: 'idle', archived: false, lastActivityAt: Date.parse('2026-10-20T00:00:00.000Z'), ...extra });
const sectionCtx = (id, members, extra) => ({ section: sectionById(id), lookup: () => ({ name: sectionById(id).name, section: sectionById(id), members }), pending: () => [], stateDir: '/nowhere', start: async () => ({ id: 'new-one', placed: true }), ...extra });
const call = (name, args, group) => handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { group, cwd: '/tmp/group', chips: { put: chip => chip } });

test('the list and read tools say section for a section\'s chat, and group for a group\'s, in the header and in the refusal', () => {
  const members = [member('one'), member('two', { archived: true })];
  assert.match(listGroupSessions({}, sectionCtx('pinned', members)), /^Section "Pinned": 1 session, 1 archived\n/);
  assert.match(listGroupSessions({}, sectionCtx('other', [])), /^Section "Terminal and other": 0 sessions\. It has no sessions yet\.$/);
  assert.match(listGroupSessions({}, { lookup: () => ({ name: 'Work', members }), pending: () => [] }), /^Group "Work": 1 session, 1 archived\n/);
  const ctx = sectionCtx('started', members);
  for (const id of ['nobody', '', undefined, 'new-one']) assert.throws(() => readGroupSession({ session_id: id }, ctx), { refusal: true, message: NOT_HERE('section') }, String(id));
  assert.throws(() => readGroupSession({ session_id: 'nobody' }, { lookup: () => ({ name: 'Work', members }), pending: () => [] }), { refusal: true, message: NOT_HERE('group') });
});

test('a section\'s tools are described as the section\'s, and the start tool and spawn_task say they are refused in a section that cannot hold a session', () => {
  const tools = group => Object.fromEntries(handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { group }).result.tools.map(t => [t.name, t.description]));
  const group = tools({});
  assert.match(group.list_group_sessions, /in this group /);
  assert.match(group.start_group_session, /in this group, in the folder/);
  for (const id of ['pinned', 'started', 'ungrouped']) {
    const found = tools(sectionCtx(id, []));
    assert.match(found.list_group_sessions, /in this section /, id);
    assert.match(found.read_group_session, /outside this section is refused/, id);
    assert.match(found.start_group_session, /from this section, in the folder/, id);
    assert.doesNotMatch(found.start_group_session, /Refused/, id);
    assert.doesNotMatch(found.spawn_task, /Refused/, id);
  }
  for (const id of ['routines', 'other']) {
    const found = tools(sectionCtx(id, []));
    assert.match(found.start_group_session, /^Refused in this chat: this section cannot hold a new session/, id);
    assert.match(found.spawn_task, /^Refused in this chat/, id);
    for (const said of [found.start_group_session, found.spawn_task, startRefusal(sectionById(id)), guideOf(id)]) assert.ok(said.includes(ELSEWHERE), `${id} says where to start instead, in the one wording`);
  }
  for (const found of [group, ...SECTION_IDS.map(id => tools(sectionCtx(id, [])))]) for (const [name, description] of Object.entries(found)) assert.ok(description.length < 420, `${name} is sent with every request, so its description stays short`);
});

test('a section that cannot hold a new session refuses the start tool and spawn_task with one sentence for the model, and starts and makes nothing', async () => {
  let started = 0;
  let made = 0;
  for (const id of ['routines', 'other']) {
    const ctx = sectionCtx(id, [], { start: async () => { started++; return { id: 'x', placed: true }; } });
    const expected = `${sectionById(id).name} cannot hold a new session, so none can be started from its chat. Say so to the owner, and suggest starting the work from a group's chat, from the chat of Pinned or Started here, or in a new session.`;
    await assert.rejects(startGroupSession({ cwd: '/tmp', prompt: 'x' }, ctx), { refusal: true, message: expected });
    const reply = await call('start_group_session', { cwd: '/tmp', prompt: 'x' }, ctx);
    assert.deepEqual(reply.result, { content: [{ type: 'text', text: expected }], isError: true });
    const chip = handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spawn_task', arguments: { title: 't', prompt: 'p', cwd: '/tmp' } } }, { group: ctx, chips: { put: () => { made++; return {}; } }, cwd: '/x' });
    assert.deepEqual(chip.result, { content: [{ type: 'text', text: expected }], isError: true });
  }
  assert.deepEqual([started, made], [0, 0]);
});

test('a section that can start a session says where the new one went: pinned, or in no group and in Started here, and says so when it could not place it', async () => {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'sections-start-'));
  const state = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'sections-state-'));
  const text = (id, placed = true) => startGroupSession({ cwd: folder, prompt: 'go', title: 'A job' }, sectionCtx(id, [], { stateDir: state, start: async () => ({ id: 'new-one', placed }) }));
  assert.match(await text('pinned'), /^Started session \[new-one\] in .* called "A job"\. It is pinned, so it shows in Pinned, and it is running now\. Use read_group_session/);
  assert.match(await text('started'), /It is in no group, so it shows in Started here, and it is running now\./);
  assert.match(await text('ungrouped'), /It is in no group, so it shows in Started here and not in Ungrouped, and it is running now\./);
  assert.match(await text('pinned', false), /It is running, but GhostShell could not pin it, so tell the owner\./);
  const group = await startGroupSession({ cwd: folder, prompt: 'go' }, { lookup: () => ({ name: 'Work', members: [] }), stateDir: state, start: async () => ({ id: 'new-one', placed: true }) });
  assert.match(group, /It is in the group "Work" and running now\./);
});

// ---- the index ----------------------------------------------------------------------------------

test('the index says the server knows sections, and lists the five with each chat\'s session and state and a count of the archived sessions, and keeps them out of groups', async () => {
  const { s, token } = await ready({ booked: ['pinned', 'other'] });
  const ix = await get(s, token, '/api/sessions');
  assert.equal(ix.features.sectionSessions, true);
  assert.equal(ix.features.groupSessions, true);
  assert.deepEqual(ix.sections, [
    { id: 'routines', session: null, archived: 1 },
    { id: 'pinned', session: { id: CHATS.pinned, state: 'idle' }, archived: 1 },
    { id: 'started', session: null, archived: 2 },
    { id: 'ungrouped', session: null, archived: 6 },
    { id: 'other', session: { id: CHATS.other, state: 'idle' }, archived: 1 },
  ]);
  assert.deepEqual(ix.groups.map(g => g.id), ['cg-work'], 'a section is no group');
  assert.deepEqual((await get(s, token, '/api/sessions?archived=1')).sections.map(x => x.archived), [1, 1, 2, 6, 1], 'the count is the same with the archive listed');
  for (const name of ['rows', 'groupSessions']) assert.equal(Object.hasOwn(ix, name), false, name);
});

test('each section\'s archived count is what api/archived?group= lists for it, the archived sessions of that section and no other', async () => {
  const { s, token } = await ready({ booked: [] });
  const ix = await get(s, token, '/api/sessions');
  // A family archived across apps counts with its holder: the capcom child with the Desktop parent, the run with the started row it is under, and the
  // archived bottom of a chain through a live row with the archived top of it.
  const archived = {
    routines: ['weekly-old'],
    pinned: ['pin-old'],
    started: ['rn-par', 'rn-run'],
    ungrouped: ['ar-desk', 'ar-kid', 'chain-a', 'chain-c', 'hold-old', 'un-old'],
    other: ['ot-old'],
  };
  for (const id of SECTION_IDS) {
    const listed = (await get(s, token, `/api/archived?group=${id}`)).archived;
    assert.deepEqual(listed.map(r => r.id).sort(), archived[id], id);
    assert.equal(ix.sections.find(x => x.id === id).archived, archived[id].length, id);
    assert.ok(listed.every(r => r.archived === true && Number.isFinite(r.archivedAt)), id);
  }
  assert.deepEqual((await get(s, token, '/api/archived?group=cg-work')).archived.map(r => r.id), ['grp-old'], 'a group\'s list is as it was');
  assert.deepEqual((await get(s, token, '/api/archived?group=nope')).archived, []);
  assert.equal((await get(s, token, '/api/archived')).archived.length, 12, 'with no group it lists them all');
});

test('sectionOf agrees with the lists the index builds for every row, in the live index and in the one with the archive', async () => {
  const { s, token } = await ready({ booked: [] });
  for (const route of ['/api/sessions', '/api/sessions?archived=1']) {
    const ix = await get(s, token, route);
    const rows = new Map(everyRow(ix).map(r => [r.id, r]));
    let checked = 0;
    for (const id of SECTION_IDS) {
      for (const row of withKids(sectionSessions(ix, id))) {
        assert.equal(sectionOf(row, rows), id, `${row.id} in ${id} (${route})`);
        checked++;
      }
    }
    for (const g of ix.groups) for (const row of withKids(g.sessions)) assert.equal(sectionOf(row, rows), null, `${row.id} in the group ${g.id} (${route})`);
    assert.equal(checked, [...rows.values()].filter(r => !r.group || r.pinned).length, 'every row outside a group was in a section\'s list');
  }
});

test('sectionOf agrees with api/archived?group= for every archived row of the index with the archive, whichever app its family crosses', async () => {
  const { s, token } = await ready({ booked: [] });
  const ix = await get(s, token, '/api/sessions?archived=1');
  const rows = new Map(everyRow(ix).map(r => [r.id, r]));
  const listedIn = new Map();
  for (const id of [...SECTION_IDS, 'cg-work']) for (const r of (await get(s, token, `/api/archived?group=${id}`)).archived) {
    assert.equal(listedIn.has(r.id), false, `${r.id} is listed for ${listedIn.get(r.id)} and ${id}`);
    listedIn.set(r.id, id);
  }
  const archived = [...rows.values()].filter(r => r.archived);
  assert.equal(archived.length, listedIn.size, 'every archived row is listed for one section or group');
  for (const r of archived) assert.equal(sectionOf(r, rows) ?? r.group, listedIn.get(r.id), r.id);
  for (const [id, holder] of [['ar-kid', 'ungrouped'], ['rn-run', 'started'], ['chain-c', 'ungrouped'], ['hold-old', 'ungrouped']]) assert.equal(listedIn.get(id), holder, id);
});

test('a section lists what the sidebar does, with the caps and the families: 60 loose sessions, 12 earlier runs, nested sessions under their parents, and no session twice', async () => {
  const { s, token } = await ready({ booked: [] });
  const ix = await get(s, token, '/api/sessions');
  assert.equal(ix.started.length, 60);
  assert.deepEqual(ix.started.map(r => r.id).filter(id => id > 'st-59'), [], 'the newest 60 are listed');
  assert.deepEqual(ix.started[0].children.map(r => r.id), ['st-kid']);
  const daily = ix.routines.find(g => g.name === 'daily');
  assert.equal(daily.earlier.length, 12);
  assert.deepEqual(sidebar(ix, 'routines').filter(id => id.startsWith('daily')).length, 13);
  assert.deepEqual(sidebar(ix, 'pinned').sort(), ['pin-cli', 'pin-desk', 'pin-kid', 'pin-run']);
  assert.deepEqual(sidebar(ix, 'ungrouped').sort(), ['un-0', 'un-1', 'un-kid']);
  assert.deepEqual(sidebar(ix, 'other').sort(), ['chain-b', 'hold-live', 'ot-0', 'ot-1']);
  const all = SECTION_IDS.flatMap(id => sidebar(ix, id));
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.some(id => id.startsWith('grp-')), false, 'a group\'s sessions are in no section');
});

// ---- booking and the chat ----------------------------------------------------------------------

test('opening a section books its session once, makes its folder 0700, starts nothing, and an unknown name, a GET or a signed-out caller changes nothing', async () => {
  const { s, token } = await ready({ booked: [] });
  const before = fs.readFileSync(s.layout, 'utf8');
  assert.equal((await request(s, 'GET', '/api/groups/pinned/session', { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'POST', '/api/groups/pinned/session', { json: {} })).status, 401);
  for (const name of ['Pinned', 'section', 'cg-none']) assert.deepEqual([(await post(s, token, `/api/groups/${name}/session`)).status, (await post(s, token, `/api/groups/${name}/session`)).body()], [404, { error: 'Unknown group.' }], name);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(s.state, 'groups')), false, 'no folder was made');

  for (const id of SECTION_IDS) {
    const both = await Promise.all([post(s, token, `/api/groups/${id}/session`), post(s, token, `/api/groups/${id}/session`)]);
    assert.deepEqual(both.map(r => r.status), [200, 200], id);
    const { id: session } = both[0].body();
    assert.match(session, UUID);
    assert.equal(both[1].body().id, session, `two bookings of ${id} at once give one id`);
    assert.equal((await post(s, token, `/api/groups/${id}/session`)).body().id, session, 'a later one gives it too');
    assert.equal(onDisk(s).sections[id], session);
    assert.equal(fs.statSync(path.join(s.state, 'groups', id)).mode & 0o777, 0o700, id);
  }
  const ids = Object.values(onDisk(s).sections);
  assert.equal(new Set(ids).size, 5, 'each section has an id of its own');
  assert.deepEqual(startsOf(s), [], 'no CLI was started by booking');
  assert.deepEqual(onDisk(s).groups, [{ id: 'cg-work', name: 'Work', session: GROUP_CHAT }], 'no group was touched');
  const ix = await get(s, token, '/api/sessions');
  assert.deepEqual(ix.sections.map(x => x.session?.id), ids);
});

test('a section\'s chat is in no list, family, count, search, archive or folder, however old its transcript, and is found by id with the section\'s name and folder', async () => {
  const old = 40 * 24 * 60;
  const { s, token } = await ready({ sessions: [...SESSIONS, ...SECTION_IDS.map(id => ({ id: CHATS[id], title: `Talk ${id}`, source: 'cli', ago: old }))] });
  const ix = await get(s, token, '/api/sessions?archived=1');
  const text = JSON.stringify({ ...ix, sections: undefined });
  for (const id of SECTION_IDS) {
    assert.equal(text.includes(CHATS[id]), false, id);
    assert.equal(everyRow(ix).some(r => r.id === CHATS[id]), false, id);
    const talk = await get(s, token, `/api/sessions/${CHATS[id]}/messages`);
    assert.deepEqual([talk.session.title, talk.session.cwd, talk.session.source, talk.terminal], [sectionById(id).name, path.join(s.state, 'groups', id), 'capcom', false], id);
    assert.equal(talk.items.length, 1, 'its transcript is kept');
  }
  assert.equal(JSON.stringify(await get(s, token, '/api/archived')).includes(CHATS.pinned), false);
  const folders = JSON.stringify(await get(s, token, '/api/folders'));
  assert.deepEqual([folders.includes(CHATS.pinned), folders.includes(path.join(s.state, 'groups'))], [false, false]);
  assert.deepEqual(ix.sections.map(x => x.session.id), SECTION_IDS.map(id => CHATS[id]));
});

test('even when the layout pins it, files it in a group, archives it, links it or gives it a title, a section\'s chat stays out of every list and every section', async () => {
  const { s, token } = await ready({ layout: { pinned: ['pin-desk', 'pin-cli', 'pin-run', 'pin-old', CHATS.started], assignments: { 'grp-desk': 'cg-work', 'grp-old': 'cg-work', [CHATS.pinned]: 'cg-work' }, archived: { ...LAYOUT.archived, [CHATS.other]: ARCHIVED_AT }, titles: { [CHATS.ungrouped]: 'Mine' }, parents: { ...LAYOUT.parents, [CHATS.routines]: 'pin-desk', 'ot-0': CHATS.pinned } } });
  const ix = await get(s, token, '/api/sessions?archived=1');
  for (const id of SECTION_IDS) assert.equal(JSON.stringify({ ...ix, sections: undefined }).includes(CHATS[id]), false, id);
  assert.deepEqual(sidebar(ix, 'pinned').sort(), ['pin-cli', 'pin-desk', 'pin-kid', 'pin-old', 'pin-run']);
  assert.ok(sidebar(ix, 'other').includes('ot-0'), 'a session linked to a section\'s chat is an ordinary session');
});

test('the layout\'s edits refuse a section\'s chat as they do a group\'s, with the word section, and write nothing', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  const STAYS = 'A section\'s session stays with its section.';
  for (const id of SECTION_IDS) {
    const chat = CHATS[id];
    for (const [route, json, error] of [
      ['move', { id: chat, group: 'cg-work' }, STAYS],
      ['move', { id: chat, group: null }, STAYS],
      ['pin', { id: chat, pinned: true }, STAYS],
      ['rename', { id: chat, title: 'Mine' }, STAYS],
      ['archive', { id: chat, archived: true }, STAYS],
      ['archive', { id: chat, archived: false }, STAYS],
      ['nest', { id: chat, parent: 'un-0' }, STAYS],
      ['nest', { id: chat, parent: null }, STAYS],
      ['nest', { id: 'un-0', parent: chat }, 'A section\'s session cannot hold sessions.'],
    ]) {
      const res = await post(s, token, `/api/layout/${route}`, json);
      assert.deepEqual([res.status, res.body()], [400, { error }], `${route} ${JSON.stringify(json)}`);
    }
    const terminal = await get(s, token, `/api/sessions/${chat}/terminal`);
    assert.deepEqual(terminal, { error: 'A section\'s session has no terminal.' }, id);
    for (const step of ['run', 'input', 'stop', 'clear']) {
      const res = await request(s, 'POST', `/api/sessions/${chat}/terminal/${step}`, { headers: { ...as(token), origin: s.origin }, json: { command: 'ls' } });
      assert.deepEqual([res.status, res.body()], [400, { error: 'A section\'s session has no terminal.' }], `${id} ${step}`);
    }
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  const group = await post(s, token, '/api/layout/move', { id: GROUP_CHAT, group: null });
  assert.equal(group.body().error, 'A group\'s session stays with its group.', 'a group\'s chat keeps its own words');
});

test('a section\'s chat starts the CLI with --session-id, the section\'s guide, the start tool asked about, and the section\'s own folder', async () => {
  const { s, token } = await ready({ booked: [] });
  const { id } = (await post(s, token, '/api/groups/pinned/session')).body();
  const routines = (await post(s, token, '/api/groups/routines/session')).body().id;
  await sendTo(s, token, id, 'begin a session');
  await sendTo(s, token, routines, 'begin a session');
  await until(() => startsOf(s).length === 2);
  const calls = startsOf(s);
  const ofChat = chat => calls.find(c => flagOf(c.started, '--session-id') === chat);
  const [pinned, refused] = [ofChat(id), ofChat(routines)];
  assert.equal(flagOf(pinned.started, '--session-id'), id);
  assert.match(flagOf(pinned.started, '--append-system-prompt'), /^You are the session for one of GhostShell's own sidebar sections, "Pinned"\. It holds the sessions the owner pinned/);
  assert.match(flagOf(refused.started, '--append-system-prompt'), /"Routines"\. It holds the runs of the routines/);
  assert.match(flagOf(refused.started, '--append-system-prompt'), /start_group_session and spawn_task are refused in this chat/);
  for (const { started } of [pinned, refused]) {
    assert.deepEqual(JSON.parse(flagOf(started, '--settings')).permissions.ask.slice(-7), ['mcp__capcom__start_group_session', 'Bash', 'Monitor', 'Write', 'Edit', 'NotebookEdit', 'SendMessage']);
    assert.equal(flagOf(started, '--setting-sources'), 'user');
  }
  assert.equal(fs.realpathSync(pinned.cwd), fs.realpathSync(path.join(s.state, 'groups', 'pinned')));
  assert.equal(fs.realpathSync(refused.cwd), fs.realpathSync(path.join(s.state, 'groups', 'routines')));
});

// ---- what the tools reach -----------------------------------------------------------------------

test('each section\'s chat lists and reads exactly the sessions the sidebar draws for it, with its archived ones, and refuses every other section\'s, a group\'s and a non-member alike', async () => {
  const { s, token } = await ready();
  for (const id of SECTION_IDS) await begin(s, token, id);
  const ix = await get(s, token, '/api/sessions');
  const refusal = { content: [{ type: 'text', text: NOT_HERE('section') }], isError: true };
  for (const id of SECTION_IDS) {
    const live = sidebar(ix, id);
    const archived = (await get(s, token, `/api/archived?group=${id}`)).archived.map(r => r.id);
    assert.ok(live.length > 0, `${id} has sessions`);
    const list = textOf(await callTool(s, token, CHATS[id], 'list_group_sessions', { include_archived: true, limit: 200 }));
    assert.match(list, new RegExp(`^Section "${sectionById(id).name}": ${live.length} sessions?`), id);
    assert.deepEqual(idsIn(list).sort(), [...live, ...archived].sort(), `${id} lists what the sidebar draws and its archive`);
    assert.equal(/, (\d+) archived\n/.exec(list)?.[1] ?? '0', String(archived.length), id);
    const others = SECTION_IDS.filter(other => other !== id);
    const foreign = [...others.flatMap(other => sidebar(ix, other).slice(0, 2)), 'grp-desk', 'grp-kid', 'grp-old', GROUP_CHAT, ...others.map(other => CHATS[other]), CHATS[id], 'nobody'];
    for (const hidden of foreign) assert.equal(list.includes(`[${hidden}]`), false, `${id} does not list ${hidden}`);

    const readable = [live[0], live.at(-1), ...archived];
    for (const session of readable) {
      const reply = await callTool(s, token, CHATS[id], 'read_group_session', { session_id: session });
      assert.equal(reply.result.isError, undefined, `${id} reads ${session}`);
      assert.match(textOf(reply), new RegExp(`\\[${session}\\]`));
    }
    for (const hidden of foreign) assert.deepEqual((await callTool(s, token, CHATS[id], 'read_group_session', { session_id: hidden })).result, refusal, `${id} refuses ${hidden}`);
  }
});

test('the nested sessions of every section are listed with it and readable from it, though no list holds them at the top', async () => {
  const { s, token } = await ready({ booked: ['pinned', 'started', 'ungrouped'] });
  for (const id of ['pinned', 'started', 'ungrouped']) await begin(s, token, id);
  for (const [id, kid] of [['pinned', 'pin-kid'], ['started', 'st-kid'], ['ungrouped', 'un-kid']]) {
    const list = textOf(await callTool(s, token, CHATS[id], 'list_group_sessions', { limit: 200 }));
    assert.ok(idsIn(list).includes(kid), `${id} lists ${kid}`);
    assert.match(textOf(await callTool(s, token, CHATS[id], 'read_group_session', { session_id: kid })), new RegExp(`\\[${kid}\\]`));
  }
});

test('a section\'s tools follow the sidebar as it changes: a session pinned leaves Started here for Pinned, and an archived one leaves for the archive', async () => {
  const { s, token } = await ready({ booked: ['pinned', 'started'] });
  await begin(s, token, 'pinned');
  await begin(s, token, 'started');
  const listed = async id => idsIn(textOf(await callTool(s, token, CHATS[id], 'list_group_sessions', { include_archived: true, limit: 200 })));
  assert.ok((await listed('started')).includes('st-05'));
  assert.equal((await post(s, token, '/api/layout/pin', { id: 'st-05', pinned: true })).status, 200);
  assert.deepEqual([(await listed('started')).includes('st-05'), (await listed('pinned')).includes('st-05')], [false, true]);
  assert.equal((await post(s, token, '/api/layout/archive', { id: 'st-05', archived: true })).status, 200);
  assert.deepEqual([(await listed('started')).includes('st-05'), (await listed('pinned')).includes('st-05')], [false, true], 'a pinned session that is archived is still Pinned\'s');
  const reply = await callTool(s, token, CHATS.pinned, 'list_group_sessions', { include_archived: true, limit: 200 });
  assert.match(textOf(reply), /\[st-05\] · archived ·/);
});

test('the group tools are offered to a section\'s chat, worded for the section, and an ordinary chat that calls one is refused', async () => {
  const { s, token } = await ready({ booked: ['pinned'] });
  await begin(s, token, 'pinned');
  await sendTo(s, token, CHATS.pinned, 'list the tools');
  await until(() => replies(s).length === 1);
  const tools = replies(s)[0].result.tools;
  assert.ok(['list_group_sessions', 'read_group_session', 'start_group_session'].every(n => tools.some(t => t.name === n)));
  assert.match(tools.find(t => t.name === 'list_group_sessions').description, /in this section /);
  const made = (await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' })).body().id;
  const refused = await callTool(s, token, made, 'read_group_session', { session_id: 'pin-desk' });
  assert.ok(refused.error || refused.result?.isError, JSON.stringify(refused));
});

test('a section\'s chat lists and reads with no card, while starting a session shows a card with no Always allow', async () => {
  const { s, token } = await ready({ booked: ['pinned'] });
  await begin(s, token, 'pinned');
  await sendTo(s, token, CHATS.pinned, 'ask to list the group');
  await until(() => cliCalls(s).some(c => c.requestId === 'perm-list'));
  assert.equal(cliCalls(s).find(c => c.requestId === 'perm-list').response, 'allow');
  await sendTo(s, token, CHATS.pinned, 'ask to start a session');
  const status = async () => (await get(s, token, `/api/sessions/${CHATS.pinned}/messages`)) && post(s, token, `/api/sessions/${CHATS.pinned}/approve`, { requestId: 'perm-start', decision: 'always' });
  await until(async () => (await status()).status === 200);
  await until(() => cliCalls(s).some(c => c.requestId === 'perm-start'));
  const reply = cliCalls(s).find(c => c.requestId === 'perm-start');
  assert.equal(reply.response, 'allow');
  assert.equal(reply.rules, undefined, 'no rule is kept for it');
});

// ---- starting a session from a section ----------------------------------------------------------

const folderIn = s => fs.mkdtempSync(path.join(s.home, 'work-'));

test('Pinned starts a session in the folder it is given and pins it, and the session shows in Pinned and nowhere else', async () => {
  const { s, token } = await ready({ booked: ['pinned'] });
  await begin(s, token, 'pinned');
  const reply = await callTool(s, token, CHATS.pinned, 'start_group_session', { cwd: folderIn(s), prompt: 'begin a session', title: 'Look at the bug' });
  assert.match(textOf(reply), /^Started session \[begun-by-the-fake\] in .* called "Look at the bug"\. It is pinned, so it shows in Pinned, and it is running now\./);
  await until(() => startsOf(s).length === 2);
  assert.ok(onDisk(s).pinned.includes('begun-by-the-fake'));
  assert.equal(onDisk(s).assignments['begun-by-the-fake'], undefined);
  const ix = await get(s, token, '/api/sessions');
  assert.ok(ix.pinned.some(r => r.id === 'begun-by-the-fake'));
  assert.equal(ix.started.some(r => r.id === 'begun-by-the-fake'), false);
});

test('Started here and Ungrouped start a session in no group, which the sidebar lists in Started here, and their replies say so', async () => {
  const { s, token } = await ready({ booked: ['started', 'ungrouped'] });
  await begin(s, token, 'started');
  const reply = await callTool(s, token, CHATS.started, 'start_group_session', { cwd: folderIn(s), prompt: 'begin a session' });
  assert.match(textOf(reply), /It is in no group, so it shows in Started here, and it is running now\./);
  await until(() => startsOf(s).length === 2);
  const layout = onDisk(s);
  assert.deepEqual([layout.pinned.includes('begun-by-the-fake'), layout.assignments['begun-by-the-fake']], [false, undefined]);
  assert.ok((await get(s, token, '/api/sessions')).started.some(r => r.id === 'begun-by-the-fake'));

  const second = await ready({ booked: ['ungrouped'] });
  await begin(second.s, second.token, 'ungrouped');
  const other = await callTool(second.s, second.token, CHATS.ungrouped, 'start_group_session', { cwd: folderIn(second.s), prompt: 'begin a session' });
  assert.match(textOf(other), /It is in no group, so it shows in Started here and not in Ungrouped, and it is running now\./);
  const ix = await get(second.s, second.token, '/api/sessions');
  assert.deepEqual([ix.started.some(r => r.id === 'begun-by-the-fake'), ix.ungrouped.some(r => r.id === 'begun-by-the-fake')], [true, false]);
});

test('Routines and Terminal and other refuse the start tool and spawn_task, name where to start instead, and start and make nothing', async () => {
  for (const id of ['routines', 'other']) {
    const { s, token } = await ready({ booked: [id] });
    await begin(s, token, id);
    const expected = `${sectionById(id).name} cannot hold a new session, so none can be started from its chat. Say so to the owner, and suggest starting the work from a group's chat, from the chat of Pinned or Started here, or in a new session.`;
    const startReply = await callTool(s, token, CHATS[id], 'start_group_session', { cwd: s.home, prompt: 'begin a session' });
    assert.deepEqual(startReply.result, { content: [{ type: 'text', text: expected }], isError: true }, id);
    const spawnReply = await callTool(s, token, CHATS[id], 'spawn_task', { title: 'Follow up', prompt: 'begin a session', cwd: s.home });
    assert.deepEqual(spawnReply.result, { content: [{ type: 'text', text: expected }], isError: true }, id);
    assert.equal(startsOf(s).length, 1, 'only the chat itself was started');
    assert.deepEqual((await get(s, token, `/api/sessions/${CHATS[id]}/chips`)).chips, []);
  }
});

test('a chip from a section that cannot hold a session is refused at Start, whatever the card says, and starts nothing', async () => {
  for (const id of ['routines', 'other']) {
    const { s, token } = await ready({ booked: [id], chips: [{ sessionId: CHATS[id], toolUseId: 'toolu_chip', prompt: 'begin a session', cwd: undefined }] });
    const start = (toolUseId, json) => post(s, token, '/api/chips/start', { sessionId: CHATS[id], toolUseId, title: 'Follow up', prompt: 'begin a session', cwd: s.home, confirmCwd: s.home, ...json });
    const expected = `${sectionById(id).name} cannot hold a new session, so a chip from its chat cannot start one. Start the work from a group's chat, from the chat of Pinned or Started here, or in a new session.`;
    for (const res of [await start('toolu_new'), await start('toolu_chip'), await start('toolu_chip', { sessionId: 'un-0' })]) {
      assert.deepEqual([res.status, res.body().error], [400, expected], id);
    }
    assert.deepEqual(startsOf(s), [], 'nothing was started');
    assert.deepEqual((await get(s, token, `/api/sessions/${CHATS[id]}/chips`)).chips.map(c => c.status), ['open']);
    assert.equal((await post(s, token, '/api/chips/dismiss', { sessionId: CHATS[id], toolUseId: 'toolu_chip', title: 'Follow up' })).status, 200, 'a card can still be dismissed');
  }
});

test('a chip from Pinned starts a session and pins it, and one from Started here or Ungrouped leaves it in no group, once the folder is confirmed', async () => {
  const { s, token } = await ready({ booked: ['pinned'] });
  const chip = (sessionId, toolUseId, json) => post(s, token, '/api/chips/start', { sessionId, toolUseId, title: 'Follow up', prompt: 'begin a session', cwd: s.home, ...json });
  const unconfirmed = await chip(CHATS.pinned, 'toolu_ask');
  assert.match(unconfirmed.body().error, /Check the folder on the card/);
  const pinned = await chip(CHATS.pinned, 'toolu_pin', { confirmCwd: s.home });
  assert.equal(pinned.status, 200, pinned.text);
  assert.ok(onDisk(s).pinned.includes('begun-by-the-fake'));
  assert.ok((await get(s, token, '/api/sessions')).pinned.some(r => r.id === 'begun-by-the-fake'));

  for (const id of ['started', 'ungrouped']) {
    const fresh = await ready({ booked: [id] });
    const res = await post(fresh.s, fresh.token, '/api/chips/start', { sessionId: CHATS[id], toolUseId: `toolu_${id}`, title: 'Follow up', prompt: 'begin a session', cwd: fresh.s.home, confirmCwd: fresh.s.home });
    assert.equal(res.status, 200, res.text);
    const layout = onDisk(fresh.s);
    assert.deepEqual([layout.pinned.includes('begun-by-the-fake'), layout.assignments['begun-by-the-fake']], [false, undefined], id);
    const ix = await get(fresh.s, fresh.token, '/api/sessions');
    assert.ok(ix.started.some(r => r.id === 'begun-by-the-fake'), `${id}'s chip shows in Started here`);
  }
});

test('the folder fence of a group holds in a section\'s chat: no relative, missing or GhostShell folder, none by default, and a chip needs its folder confirmed', async () => {
  const { s, token } = await ready({ booked: ['pinned'], chips: [{ sessionId: CHATS.pinned, toolUseId: 'toolu_bare', prompt: 'begin a session' }] });
  await begin(s, token, 'pinned');
  for (const [cwd, why] of [['relative/path', /absolute folder/], [path.join(s.home, 'missing'), /does not exist/], [s.state, /belongs to GhostShell/], [path.join(s.state, 'groups', 'pinned'), /belongs to GhostShell/]]) {
    for (const tool of ['start_group_session', 'spawn_task']) {
      const reply = await callTool(s, token, CHATS.pinned, tool, { cwd, title: 'T', prompt: 'begin a session' });
      assert.equal(reply.result.isError, true, `${tool} ${cwd}`);
      assert.match(textOf(reply), why, `${tool} ${cwd}`);
    }
  }
  const none = await callTool(s, token, CHATS.pinned, 'spawn_task', { title: 'T', prompt: 'p' });
  assert.match(textOf(none), /^spawn_task needs a cwd in a section session\./);
  const post_ = (toolUseId, json) => post(s, token, '/api/chips/start', { sessionId: CHATS.pinned, toolUseId, title: 'Follow up', prompt: 'begin a session', ...json });
  for (const cwd of [s.state, path.join(s.state, 'groups', 'pinned')]) {
    const res = await post_('toolu_state', { cwd, confirmCwd: cwd });
    assert.deepEqual([res.status, res.body().error], [400, 'That folder belongs to GhostShell. Pick the folder the work is in.'], cwd);
  }
  const bare = await post_('toolu_bare', {});
  assert.deepEqual([bare.status, bare.body().error], [400, 'This chip names no folder, and a section\'s session has none of its own. Ask it to suggest the task again with a folder.']);
  assert.equal(startsOf(s).length, 1, 'nothing was started but the chat');
  assert.deepEqual(onDisk(s).pinned.filter(id => !SESSIONS.some(x => x.id === id)), []);
});

test('a session started from a section\'s chat asks for the owner\'s approval: the start tool is in the chat\'s ask list, and nothing starts by itself', async () => {
  const { s, token } = await ready({ booked: ['started'] });
  await begin(s, token, 'started');
  const { started } = startsOf(s)[0];
  assert.ok(JSON.parse(flagOf(started, '--settings')).permissions.ask.includes('mcp__capcom__start_group_session'));
  assert.equal(startsOf(s).length, 1);
});
