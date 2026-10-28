// Run with `npm test`. A group's session over HTTP against the real server and a fake CLI: booking its id, how its chat is started, what its
// tools can reach, the card for starting a session, and a chip it makes. The library parts have their own tests in group-tools.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { as, cliCalls, listen, request, restart, signIn, start, until as waitFor } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOT_HERE = 'That session is not in this group. Use list_group_sessions to see the ones you can reach.';
const SESSIONS = [
  { id: 'a', title: 'Member A', group: 'cg-work', ago: 5 },
  { id: 'old', title: 'Archived member', group: 'cg-work', archived: true, ago: 20 },
  { id: 'away', title: 'Member of another group', group: 'cg-home', ago: 6 },
  { id: 'loose', title: 'In no group', ago: 7 },
];
const GROUPS = [{ id: 'cg-work', name: 'Work' }, { id: 'cg-home', name: 'Home' }];
// Each test starts several CLIs, which a busy machine can be slow to launch, so these wait longer than the harness does.
const until = (check, ms = 20_000) => waitFor(check, ms);

const get = async (s, token, route) => (await request(s, 'GET', route, { headers: as(token) })).body();
const post = (s, token, route, json) => request(s, 'POST', route, { headers: as(token), json: json ?? {} });
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const startsOf = s => cliCalls(s).filter(c => c.started);
const flagOf = (argv, name) => argv[argv.indexOf(name) + 1];

async function ready(mine) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true, ...mine });
  return { s, ...(await signIn(s)) };
}

// A group whose session is booked already, as it is once its owner has opened it.
const booked = mine => ready({ groups: [{ id: 'cg-work', name: 'Work', session: WORK }, GROUPS[1]], ...mine });

const sendTo = async (s, token, id, text) => {
  const res = await post(s, token, `/api/sessions/${id}/send`, { text });
  assert.equal(res.status, 200, res.text);
  return res;
};

// What the fake CLI answered to the calls of Capcom's tools so far, in order.
const replies = s => cliCalls(s).filter(c => c.mcp).map(c => c.mcp);
async function callTool(s, token, id, tool, args) {
  const before = replies(s).length;
  await sendTo(s, token, id, `call ${tool} ${JSON.stringify(args)}`);
  await until(() => replies(s).length > before);
  return replies(s)[before];
}
const textOf = reply => reply.result.content[0].text;

test('opening a group books its session once, makes its folder 0700, starts nothing, and a GET or an unknown group or a signed-out caller changes nothing', async () => {
  const { s, token } = await ready();
  const folder = path.join(s.state, 'groups', 'cg-work');
  const before = fs.readFileSync(s.layout, 'utf8');
  assert.equal((await request(s, 'GET', '/api/groups/cg-work/session', { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'POST', '/api/groups/cg-work/session', { json: {} })).status, 401);
  assert.deepEqual([(await post(s, token, '/api/groups/cg-none/session')).status, (await post(s, token, '/api/groups/cg-none/session')).body()], [404, { error: 'Unknown group.' }]);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(s.state, 'groups')), false, 'no folder was made');

  const both = await Promise.all([post(s, token, '/api/groups/cg-work/session'), post(s, token, '/api/groups/cg-work/session')]);
  assert.deepEqual(both.map(r => r.status), [200, 200]);
  const [{ id }, again] = [both[0].body(), both[1].body()];
  assert.match(id, UUID);
  assert.equal(again.id, id, 'two bookings at once give one id');
  assert.equal((await post(s, token, '/api/groups/cg-work/session')).body().id, id, 'a later one gives it too');
  assert.equal(onDisk(s).groups.find(g => g.id === 'cg-work').session, id);
  assert.equal(onDisk(s).groups.find(g => g.id === 'cg-home').session, undefined);
  assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
  assert.deepEqual(startsOf(s), [], 'no CLI was started by booking');
  assert.deepEqual((await get(s, token, '/api/sessions')).groups.find(g => g.id === 'cg-work').session, { id, state: 'idle' });
});

test('the first message to a group\'s session starts the CLI with --session-id, the group\'s guide, the start tool asked about, and the group\'s own folder, and a restart resumes it', async () => {
  const { s, token } = await ready();
  const { id } = (await post(s, token, '/api/groups/cg-work/session')).body();
  await sendTo(s, token, id, 'begin a session');
  await until(() => startsOf(s).length === 1);
  const [{ started, cwd }] = startsOf(s);
  assert.equal(flagOf(started, '--session-id'), id);
  assert.equal(started.includes('--resume'), false);
  assert.match(flagOf(started, '--append-system-prompt'), /^You are the session for the group "Work" in GhostShell\./);
  assert.deepEqual(JSON.parse(flagOf(started, '--settings')).permissions.ask.slice(-8), ['mcp__capcom__start_group_session', 'mcp__capcom__send_session', 'Bash', 'Monitor', 'Write', 'Edit', 'NotebookEdit', 'SendMessage']);
  assert.equal(flagOf(started, '--setting-sources'), 'user');
  assert.equal(fs.realpathSync(cwd), fs.realpathSync(path.join(s.state, 'groups', 'cg-work')));

  const mode = flagOf(started, '--permission-mode');
  const fresh = (await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' })).body().id;
  assert.equal(fresh, 'begun-by-the-fake');
  await until(() => startsOf(s).length === 2);
  const ordinary = startsOf(s)[1].started;
  assert.equal(flagOf(ordinary, '--permission-mode'), mode, 'it starts in the mode a new session in its folder gets');
  for (const flag of ['--session-id', '--append-system-prompt', '--setting-sources']) assert.equal(ordinary.includes(flag), false, `an ordinary session has no ${flag}`);
  assert.deepEqual(JSON.parse(flagOf(ordinary, '--settings') ?? '{"permissions":{"ask":[]}}').permissions.ask.filter(rule => rule !== 'mcp__claude-in-chrome'), ['mcp__capcom__send_session'], 'an ordinary session asks only about sending to a sub session');

  const again = await restart(s);
  const second = await signIn(again);
  await sendTo(again, second.token, id, 'hello again');
  await until(() => startsOf(again).length === 3);
  const resumed = startsOf(again)[2].started;
  assert.equal(flagOf(resumed, '--resume'), id, 'its transcript exists now, so it is resumed');
  assert.equal(resumed.includes('--session-id'), false);
  assert.match(flagOf(resumed, '--append-system-prompt'), /group "Work"/, 'the guide goes with every spawn');
});

test('a renamed group\'s session is titled with the new name, and its guide names the group so from the next spawn on', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  await until(() => startsOf(s).length === 1);
  assert.match(flagOf(startsOf(s)[0].started, '--append-system-prompt'), /group "Work" in GhostShell/);

  assert.equal((await post(s, token, '/api/layout/group/rename', { id: 'cg-work', name: 'Reviews' })).status, 200);
  const ix = await get(s, token, '/api/sessions');
  assert.equal(ix.groups.find(g => g.id === 'cg-work').name, 'Reviews');
  assert.equal((await get(s, token, `/api/sessions/${WORK}/messages`)).session.title, 'Reviews');

  const again = await restart(s);
  const second = await signIn(again);
  await sendTo(again, second.token, WORK, 'hello again');
  await until(() => startsOf(again).length === 2);
  const guide = flagOf(startsOf(again)[1].started, '--append-system-prompt');
  assert.match(guide, /^You are the session for the group "Reviews" in GhostShell\./);
  assert.equal(guide.includes('"Work"'), false);
});

test('the page\'s stream finds the transcript of a group\'s session once its first message has been sent', async () => {
  const { s, token } = await booked();
  const viewer = listen(s, token, WORK);
  try {
    await until(() => viewer.events.length);
    await new Promise(done => setTimeout(done, 2000));
    assert.equal(viewer.events.some(e => e.type === 'changed'), false, 'nothing is looked for before a chat of ours exists');
    await sendTo(s, token, WORK, 'begin a session');
    await until(() => viewer.events.some(e => e.type === 'changed'));
  } finally {
    viewer.close();
  }
});

test('the tools of a group\'s chat reach its own sessions, archived ones included, and refuse another group\'s, one in no group, its own and an unknown id alike', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  await until(() => startsOf(s).length === 1);

  const list = textOf(await callTool(s, token, WORK, 'list_group_sessions', { include_archived: true }));
  assert.match(list, /^Group "Work": 1 session, 1 archived/);
  assert.match(list, /Member A \[a\]/);
  assert.match(list, /Archived member \[old\]/);
  for (const hidden of ['Member of another group', 'In no group', WORK]) assert.equal(list.includes(hidden), false, hidden);

  for (const id of ['a', 'old']) {
    const reply = await callTool(s, token, WORK, 'read_group_session', { session_id: id });
    assert.equal(reply.result.isError, undefined, id);
    assert.match(textOf(reply), new RegExp(`\\[${id}\\]`));
  }
  for (const id of ['away', 'loose', WORK, 'nobody']) {
    const reply = await callTool(s, token, WORK, 'read_group_session', { session_id: id });
    assert.deepEqual(reply.result, { content: [{ type: 'text', text: NOT_HERE }], isError: true }, id);
  }
});

test('the group tools are offered to a group\'s chat and to no other, and an ordinary chat that calls one is refused', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  await sendTo(s, token, WORK, 'list the tools');
  await until(() => replies(s).length === 1);
  assert.ok(['list_group_sessions', 'read_group_session', 'start_group_session'].every(n => replies(s)[0].result.tools.some(t => t.name === n)));

  const made = (await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' })).body().id;
  await sendTo(s, token, made, 'list the tools');
  await until(() => replies(s).length === 2);
  assert.equal(replies(s)[1].result.tools.some(t => t.name.endsWith('_group_session') || t.name === 'list_group_sessions'), false);
  const refused = await callTool(s, token, made, 'read_group_session', { session_id: 'a' });
  assert.ok(refused.error || refused.result?.isError, JSON.stringify(refused));
});

test('a group\'s chat is allowed to list and read with no card, while starting a session shows a card with no Always allow, and an ordinary chat gets a card for the read tool', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  await sendTo(s, token, WORK, 'ask to list the group');
  await until(() => cliCalls(s).some(c => c.requestId === 'perm-list'));
  assert.equal(cliCalls(s).find(c => c.requestId === 'perm-list').response, 'allow');
  const viewer = listen(s, token, WORK);
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, WORK, 'ask to start a session');
    await until(() => viewer.events.some(e => e.type === 'approval'));
    assert.deepEqual(viewer.events.filter(e => e.type === 'approval').map(e => [e.data.tool, e.data.always]), [['mcp__capcom__start_group_session', false]]);
    const answered = await post(s, token, `/api/sessions/${WORK}/approve`, { requestId: 'perm-start', decision: 'always' });
    assert.equal(answered.status, 200);
    await until(() => cliCalls(s).some(c => c.requestId === 'perm-start'));
    const reply = cliCalls(s).find(c => c.requestId === 'perm-start');
    assert.equal(reply.response, 'allow');
    assert.equal(reply.rules, undefined, 'no rule is kept for it');
  } finally {
    viewer.close();
  }

  const made = (await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' })).body().id;
  const other = listen(s, token, made);
  try {
    await until(() => other.events.length);
    await sendTo(s, token, made, 'ask to list the group');
    await until(() => other.events.some(e => e.type === 'approval'));
    assert.deepEqual(other.events.filter(e => e.type === 'approval').map(e => e.data.tool), ['mcp__capcom__list_group_sessions']);
  } finally {
    other.close();
  }
});

const resumed = (s, id) => startsOf(s).filter(c => c.started.includes('--resume') && flagOf(c.started, '--resume') === id);
const delivered = s => cliCalls(s).filter(c => typeof c.user === 'string' && c.user.startsWith('<session-message'));

test('a group\'s chat offers send_session, and a send to an idle member with no process resumes it and arrives as a message from the group\'s chat', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  await sendTo(s, token, WORK, 'list the tools');
  await until(() => replies(s).length === 1);
  assert.ok(replies(s)[0].result.tools.some(t => t.name === 'send_session'));
  assert.equal(resumed(s, 'a').length, 0);
  const text = textOf(await callTool(s, token, WORK, 'send_session', { session_id: 'a', message: 'Josh left review comments.' }));
  assert.equal(text, 'Delivered to "Member A" [a]. It was idle, so it has started a turn to read your message. This call did not wait for a reply: use read_group_session later to see it.');
  await until(() => resumed(s, 'a').length === 1 && delivered(s).length === 1);
  assert.equal(delivered(s)[0].user, `<session-message from="${WORK}" from-name="Work (another session)">\nJosh left review comments.\n</session-message>`);
});

test('a group\'s chat can send to a session outside the group, is refused an archived member, and a member can send back to the group\'s chat', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  const away = textOf(await callTool(s, token, WORK, 'send_session', { session_id: 'away', message: 'Hello.' }));
  assert.match(away, /^Delivered to "Member of another group" \[away\]\..*read_group_session reaches only this group's sessions, so you cannot read it\./);
  const old = await callTool(s, token, WORK, 'send_session', { session_id: 'old', message: 'hi' });
  assert.deepEqual([old.result.isError, textOf(old)], [true, 'Refused: "Archived member" [old] is archived. Ask the owner to unarchive it, then send again.']);
  await until(() => resumed(s, 'away').length === 1 && delivered(s).length === 1);
  assert.equal(resumed(s, 'old').length, 0);

  await sendTo(s, token, WORK, 'finish the turn');
  await sendTo(s, token, 'a', 'begin a session');
  const back = textOf(await callTool(s, token, 'a', 'send_session', { session_id: WORK, message: 'Comments addressed.' }));
  assert.match(back, /^(Delivered to|Queued for) "Work" \[[0-9a-f-]+\]\./);
  await until(() => delivered(s).some(c => c.user.includes('Comments addressed.')));
  assert.match(delivered(s).find(c => c.user.includes('Comments addressed.')).user, /^<session-message from="a" from-name="Member A \(another session\)">/);
});

test('a send from a group\'s chat shows a card naming the member, with no Always allow, and the CLI is not answered until the owner decides', async () => {
  const { s, token } = await booked({ sessions: [...SESSIONS, { id: 'kid', title: 'Own PR 4546', group: 'cg-work', ago: 4 }] });
  await sendTo(s, token, WORK, 'begin a session');
  const viewer = listen(s, token, WORK);
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, WORK, 'ask to send to a sub');
    await until(() => viewer.events.some(e => e.type === 'approval'));
    const [card] = viewer.events.filter(e => e.type === 'approval').map(e => e.data);
    assert.deepEqual([card.tool, card.always, card.summary], ['mcp__capcom__send_session', false, 'to "Own PR 4546": Please rebase']);
    assert.equal(cliCalls(s).some(c => c.requestId === 'perm-send'), false);
  } finally {
    viewer.close();
  }
});

test('a session started by the group\'s chat runs in the folder it gave, with its prompt, and lands in the group, and a bad folder is refused', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  await until(() => startsOf(s).length === 1);
  const folder = s.home;
  for (const [cwd, why] of [['relative/path', /absolute folder/], [path.join(s.home, 'missing'), /does not exist/], [s.state, /belongs to GhostShell/], [path.join(s.state, 'groups', 'cg-work'), /belongs to GhostShell/]]) {
    const reply = await callTool(s, token, WORK, 'start_group_session', { cwd, prompt: 'begin a session' });
    assert.equal(reply.result.isError, true, cwd);
    assert.match(textOf(reply), why, cwd);
  }
  assert.equal(startsOf(s).length, 1, 'a refused call starts nothing');

  const reply = await callTool(s, token, WORK, 'start_group_session', { cwd: folder, prompt: 'begin a session', title: 'Look at the bug' });
  assert.match(textOf(reply), /^Started session \[begun-by-the-fake\] in .* called "Look at the bug"\. It is in the group "Work" and running now\./);
  await until(() => startsOf(s).length === 2);
  assert.equal(fs.realpathSync(startsOf(s)[1].cwd), fs.realpathSync(folder));
  const ix = await get(s, token, '/api/sessions');
  assert.deepEqual(ix.groups.find(g => g.id === 'cg-work').sessions.map(r => r.id).sort(), ['a', 'begun-by-the-fake']);
  assert.equal(onDisk(s).assignments['begun-by-the-fake'], 'cg-work');
});

test('a chip made by a group\'s session starts its session in that group, and a chip made by an ordinary session does not', async () => {
  const { s, token } = await booked();
  const chip = (sessionId, toolUseId) => post(s, token, '/api/chips/start', { sessionId, toolUseId, title: 'Follow up', prompt: 'begin a session', cwd: s.home, confirmCwd: s.home });
  const fromGroup = await chip(WORK, 'toolu_group');
  assert.equal(fromGroup.status, 200, fromGroup.text);
  assert.equal(fromGroup.body().id, 'begun-by-the-fake');
  assert.equal(onDisk(s).assignments['begun-by-the-fake'], 'cg-work');
  const ix = await get(s, token, '/api/sessions');
  assert.ok(ix.groups.find(g => g.id === 'cg-work').sessions.some(r => r.id === 'begun-by-the-fake'), 'it shows in the group, not at the top level');
  assert.equal(ix.started.some(r => r.id === 'begun-by-the-fake'), false);

  const plain = await ready();
  const fromLoose = await post(plain.s, plain.token, '/api/chips/start', { sessionId: 'loose', toolUseId: 'toolu_loose', title: 'Follow up', prompt: 'begin a session', cwd: plain.s.home });
  assert.equal(fromLoose.status, 200, fromLoose.text);
  assert.equal(onDisk(plain.s).assignments['begun-by-the-fake'], undefined);
});

// A chip's folder is text the model chose, so a group's chat can name one in Capcom's state folder, where its tokens are.
const caseBlind = fs.existsSync(os.tmpdir().toUpperCase());

test('a chip made by a group\'s session is refused when it names no folder, a folder in Capcom\'s state folder or no confirmed folder, and starts nothing', async () => {
  const { s, token } = await booked({ chips: [{ sessionId: WORK, toolUseId: 'toolu_bare', prompt: 'begin a session' }] });
  const own = path.join(s.state, 'groups', 'cg-work');
  fs.mkdirSync(own, { recursive: true });
  const link = path.join(s.home, 'link-to-state');
  fs.symlinkSync(s.state, link);
  const start = (toolUseId, json) => post(s, token, '/api/chips/start', { sessionId: WORK, toolUseId, title: 'Follow up', prompt: 'begin a session', ...json });
  const inState = [s.state, own, link, path.join(link, 'groups'), `${s.state}/../${path.basename(s.state)}/groups`];
  if (caseBlind) inState.push(s.state.toUpperCase(), own.toUpperCase());
  for (const [n, cwd] of inState.entries()) {
    const res = await start(`toolu_state${n}`, { cwd, confirmCwd: cwd });
    assert.deepEqual([res.status, res.body().error], [400, 'That folder belongs to GhostShell. Pick the folder the work is in.'], cwd);
  }
  const bare = await start('toolu_none', {});
  assert.deepEqual([bare.status, bare.body().error], [400, 'This chip names no folder, and a group\'s session has none of its own. Ask it to suggest the task again with a folder.']);
  const stored = await start('toolu_bare', {});
  assert.equal(stored.status, 400, 'a chip the tool stored without a folder is no different');
  const ask = await start('toolu_ask', { cwd: s.home });
  assert.match(ask.body().error, /Check the folder on the card/, 'the folder must be confirmed even though it is not the group\'s own');
  const elsewhere = await post(s, token, '/api/chips/start', { sessionId: 'loose', toolUseId: 'toolu_bare', title: 'Follow up', prompt: 'begin a session' });
  assert.equal(elsewhere.status, 400, 'naming another session does not lift the rule, as the chip belongs to the group\'s session');
  assert.deepEqual(startsOf(s), [], 'nothing was started');
  assert.deepEqual((await get(s, token, `/api/sessions/${WORK}/chips`)).chips.map(c => c.status), ['open'], 'the stored chip is still open');
});

test('a chip made by a group\'s session starts in the folder as the disk names it, once that folder is confirmed', async () => {
  const { s, token } = await booked();
  const folder = fs.mkdtempSync(path.join(s.home, 'work-'));
  const res = await post(s, token, '/api/chips/start', { sessionId: WORK, toolUseId: 'toolu_ok', title: 'Follow up', prompt: 'begin a session', cwd: `${folder}/../${path.basename(folder)}`, confirmCwd: `${folder}/../${path.basename(folder)}` });
  assert.equal(res.status, 200, res.text);
  await until(() => startsOf(s).length === 1);
  assert.equal(startsOf(s)[0].cwd, fs.realpathSync.native(folder));
});

test('spawn_task in a group\'s chat refuses a folder in Capcom\'s state folder, and makes no chip', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  await until(() => startsOf(s).length === 1);
  for (const cwd of [s.state, path.join(s.state, 'groups', 'cg-work')]) {
    const reply = await callTool(s, token, WORK, 'spawn_task', { title: 'Follow up', prompt: 'begin a session', cwd });
    assert.equal(reply.result.isError, true, cwd);
    assert.match(textOf(reply), /belongs to GhostShell/, cwd);
  }
  assert.deepEqual((await get(s, token, `/api/sessions/${WORK}/chips`)).chips, []);
  const ok = await callTool(s, token, WORK, 'spawn_task', { title: 'Follow up', prompt: 'begin a session', cwd: s.home });
  assert.match(textOf(ok), /^Chip created/);
});

test('a group deleted by hand while its chat runs takes its tools with it', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  await until(() => startsOf(s).length === 1);
  assert.match(textOf(await callTool(s, token, WORK, 'list_group_sessions', {})), /^Group "Work"/);
  // Looking for the transcript brings the shared index up to date, so the session can be found as an ordinary one once its group is gone.
  assert.equal((await get(s, token, `/api/sessions/${WORK}/messages`)).items.length, 1);
  fs.writeFileSync(s.layout, JSON.stringify({ ...onDisk(s), groups: [GROUPS[1]] }));
  const reply = await callTool(s, token, WORK, 'list_group_sessions', {});
  assert.deepEqual(reply.result, { content: [{ type: 'text', text: 'This group no longer exists.' }], isError: true });
});

const removeGroup = (s, token, id) => post(s, token, '/api/layout/group/remove', { id });

test('after its group is deleted, a send to the group\'s chat is refused as no session, and its chat cannot send either', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'begin a session');
  await sendTo(s, token, WORK, 'finish the turn');
  assert.equal((await removeGroup(s, token, 'cg-work')).status, 200);
  assert.ok(onDisk(s).retired.some(g => g.session === WORK));
  assert.match(textOf(await callTool(s, token, 'loose', 'send_session', { session_id: WORK, message: 'hi' })), /^No session with that id on this Mac\./);
  assert.equal(textOf(await callTool(s, token, WORK, 'send_session', { session_id: 'loose', message: 'hi' })), 'This group no longer exists.');
  assert.equal(delivered(s).length, 0);
});
const stateOfWork = async (s, token) => (await get(s, token, '/api/sessions')).groups.find(g => g.id === 'cg-work').session.state;
const touched = s => cliCalls(s).filter(c => c.response || c.control === 'interrupt' || c.closed);
// The layout as the fake CLI found it when the interrupt reached it, which shows whether the server had written it by then.
const layoutAtInterrupt = s => JSON.parse(fs.readFileSync(path.join(s.home, 'layout-at-interrupt.json'), 'utf8'));
const RETIRED = [{ id: 'cg-work', name: 'Work', session: WORK }];

test('deleting a group whose chat is mid-turn writes the layout, then interrupts and closes the chat, and the chat is retired, not archived', async () => {
  const { s, token } = await booked();
  await sendTo(s, token, WORK, 'keep going');
  await until(() => cliCalls(s).some(c => c.user === 'keep going'));
  assert.equal(await stateOfWork(s, token), 'working');

  const res = await removeGroup(s, token, 'cg-work');
  assert.deepEqual(res.body(), { id: 'cg-work', name: 'Work', session: WORK, stopped: true });
  await until(() => cliCalls(s).some(c => c.closed));
  assert.deepEqual(touched(s), [{ control: 'interrupt' }, { closed: true }]);
  const atInterrupt = layoutAtInterrupt(s);
  assert.deepEqual([atInterrupt.groups.map(g => g.id), atInterrupt.retired], [['cg-home'], RETIRED], 'the layout was already written when the interrupt arrived');
  const layout = onDisk(s);
  assert.deepEqual([layout.groups.map(g => g.id), layout.retired, layout.archived, layout.titles], [['cg-home'], RETIRED, {}, {}]);
  assert.equal(JSON.stringify((await get(s, token, '/api/archived')).archived).includes(WORK), false, 'it is not in the archive');
  assert.equal(fs.existsSync(path.join(s.state, 'groups', 'cg-work')), true, 'the group\'s folder is left');
});

test('deleting a group whose chat waits on an approval denies it first, and one whose chat is idle closes it and says it stopped nothing', async () => {
  const waiting = await booked();
  await sendTo(waiting.s, waiting.token, WORK, 'ask to run a write');
  await until(async () => (await stateOfWork(waiting.s, waiting.token)) === 'waiting');
  assert.equal((await removeGroup(waiting.s, waiting.token, 'cg-work')).body().stopped, true);
  await until(() => cliCalls(waiting.s).some(c => c.closed));
  assert.deepEqual(touched(waiting.s), [{ response: 'deny', requestId: 'perm-1' }, { control: 'interrupt' }, { closed: true }]);
  assert.deepEqual(layoutAtInterrupt(waiting.s).retired, RETIRED, 'the layout was written before the interrupt here too');

  const calm = await booked();
  await sendTo(calm.s, calm.token, WORK, 'finish the turn');
  await until(async () => (await stateOfWork(calm.s, calm.token)) === 'idle' && cliCalls(calm.s).some(c => c.user === 'finish the turn'));
  assert.deepEqual((await removeGroup(calm.s, calm.token, 'cg-work')).body(), { id: 'cg-work', name: 'Work', session: WORK });
  await until(() => cliCalls(calm.s).some(c => c.closed));
  assert.deepEqual(touched(calm.s), [{ closed: true }], 'no interrupt');
});

test('deleting a group that was booked but never talked to, or has no session, starts and stops nothing, and retires only a session there is', async () => {
  const { s, token } = await booked();
  assert.deepEqual((await removeGroup(s, token, 'cg-work')).body(), { id: 'cg-work', name: 'Work', session: WORK });
  assert.deepEqual((await removeGroup(s, token, 'cg-home')).body(), { id: 'cg-home', name: 'Home' });
  assert.deepEqual(cliCalls(s), []);
  const layout = onDisk(s);
  assert.deepEqual([layout.groups, layout.retired, layout.archived, layout.titles], [[], RETIRED, {}, {}]);
});

test('after its group is deleted, a chat that is sent a message after a restart still starts with the group chat\'s folder, settings sources and approvals, and its group tools refuse', async () => {
  const first = await booked();
  await sendTo(first.s, first.token, WORK, 'begin a session');
  await until(() => startsOf(first.s).length === 1);
  assert.equal((await removeGroup(first.s, first.token, 'cg-work')).status, 200);
  await until(() => cliCalls(first.s).some(c => c.closed));

  const s = await restart(first.s);
  const { token } = await signIn(s);
  const reply = await callTool(s, token, WORK, 'list_group_sessions', {});
  assert.equal(startsOf(s).length, 2);
  const { started, cwd } = startsOf(s)[1];
  assert.equal(flagOf(started, '--resume'), WORK, 'its transcript is kept, so it resumes');
  assert.equal(flagOf(started, '--setting-sources'), 'user', 'a settings file in its folder is still never loaded');
  assert.deepEqual(JSON.parse(flagOf(started, '--settings')).permissions.ask.slice(-8), ['mcp__capcom__start_group_session', 'mcp__capcom__send_session', 'Bash', 'Monitor', 'Write', 'Edit', 'NotebookEdit', 'SendMessage']);
  assert.match(flagOf(started, '--append-system-prompt'), /^You are the session for the group "Work" in GhostShell\./);
  assert.equal(fs.realpathSync(cwd), fs.realpathSync(path.join(s.state, 'groups', 'cg-work')));
  assert.deepEqual(reply.result, { content: [{ type: 'text', text: 'This group no longer exists.' }], isError: true });
  const bare = await post(s, token, '/api/chips/start', { sessionId: WORK, toolUseId: 'toolu_gone', title: 'Follow up', prompt: 'begin a session' });
  assert.deepEqual([bare.status, bare.body().error], [400, 'This chip names no folder, and a group\'s session has none of its own. Ask it to suggest the task again with a folder.'], 'a chip from it never falls back to its folder');
});
