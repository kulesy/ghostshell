// Run with `npm test`. Sub session status over HTTP against the real server and a fake CLI: the route that summarises sessions, the flag that tells the
// page it is there, and the tools of an ordinary chat that reach the sessions nested under it. The rules and the tools have their own tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findRow } from '../public/ui/tree.js';
import { as, cliCalls, listen, request, signIn, start, until as waitFor } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const LAYOUT_TOOLS = ['list_chips', 'find_sessions', 'archive_session', 'unarchive_session', 'set_session_title', 'move_session_to_group'];
const NOT_BELOW = 'That session is not a sub session of this session, nor one its chips started beside it. Use list_sub_sessions to see the ones you can reach.';
//   top
//     kid
//       grand
//     gone (archived)
//       under-gone
//   peer
//     peer-kid
const SESSIONS = [
  { id: 'top', title: 'Top', ago: 5 },
  { id: 'kid', title: 'Kid', parent: 'top', ago: 4 },
  { id: 'grand', title: 'Grand', parent: 'kid', ago: 3 },
  { id: 'gone', title: 'Gone', parent: 'top', archived: true, ago: 20 },
  { id: 'under-gone', title: 'Under gone', parent: 'gone', ago: 21 },
  { id: 'peer', title: 'Peer', ago: 6 },
  { id: 'peer-kid', title: 'Peer kid', parent: 'peer', ago: 7 },
  { id: 'loose', title: 'Loose', ago: 8 },
  { id: WORK, title: 'Talk about the work', source: 'cli', ago: 1, group: 'cg-work' },
];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }];
// Each test starts a CLI, which a busy machine can be slow to launch, so these wait longer than the harness does.
const until = (check, ms = 20_000) => waitFor(check, ms);

const get = (s, token, route) => request(s, 'GET', route, { headers: as(token) });
const post = (s, token, route, json) => request(s, 'POST', route, { headers: as(token), json: json ?? {} });
const summaries = async (s, token, ids, more = '') => (await get(s, token, `/api/summaries?ids=${ids}${more}`)).body().summaries;

async function ready(mine) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true, ...mine });
  return { s, ...(await signIn(s)) };
}

const sendTo = async (s, token, id, text) => {
  const res = await post(s, token, `/api/sessions/${id}/send`, { text });
  assert.equal(res.status, 200, res.text);
};

// The fake CLI's transcripts are in one folder, and a session that has said something has an assistant line at the end of its file.
const says = (s, id, text, timestamp) => fs.appendFileSync(path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`),
  `${JSON.stringify({ type: 'assistant', ...(timestamp && { timestamp }), message: { id: `m-${id}-${Math.random()}`, role: 'assistant', content: [{ type: 'text', text }] } })}\n`);

// What the fake CLI answered to the calls of Capcom's tools so far, in order.
const replies = s => cliCalls(s).filter(c => c.mcp).map(c => c.mcp);
async function callTool(s, token, id, tool, args = {}) {
  const before = replies(s).length;
  await sendTo(s, token, id, `call ${tool} ${JSON.stringify(args)}`);
  await until(() => replies(s).length > before);
  return replies(s)[before];
}
const textOf = reply => reply.result.content[0].text;
const refusal = { content: [{ type: 'text', text: NOT_BELOW }], isError: true };

test('the summaries route is for a signed-in caller who names between 1 and 60 sessions, and anything else is a 400 that names nothing', async () => {
  const { s, token } = await ready();
  assert.equal((await request(s, 'GET', '/api/summaries?ids=top')).status, 401);
  const wrong = [['', 'Name the sessions in ids.'], ['?ids=', 'Name the sessions in ids.'], ['?ids=,,%20,', 'Name the sessions in ids.']];
  for (const [query, error] of wrong) {
    const res = await get(s, token, `/api/summaries${query}`);
    assert.deepEqual([res.status, res.body()], [400, { error }], query);
  }
  const ids = n => Array.from({ length: n }, (_, i) => `none-${i}`).join(',');
  const over = await get(s, token, `/api/summaries?ids=${ids(61)}`);
  assert.deepEqual([over.status, over.body()], [400, { error: 'Ask for at most 60 sessions at a time.' }]);
  const edge = await get(s, token, `/api/summaries?ids=${ids(60)}`);
  assert.deepEqual([edge.status, edge.body()], [200, { summaries: {} }]);
  const repeated = await get(s, token, `/api/summaries?ids=${Array(100).fill('top').join(',')}`);
  assert.deepEqual([repeated.status, Object.keys(repeated.body().summaries)], [200, ['top']], 'the same id many times counts once');
  assert.deepEqual(Object.keys(await summaries(s, token, '%20top%20,%20kid%20')), ['top', 'kid'], 'spaces around an id are dropped');
});

test('an id that is no session, or is a group\'s chat, is left out without a word, and the sessions that are there are answered', async () => {
  const { s, token } = await ready();
  const found = await summaries(s, token, `nobody,${WORK},top,../top,kid,gone`);
  assert.deepEqual(Object.keys(found).sort(), ['gone', 'kid', 'top'], 'an archived session is answered too');
  const alone = await get(s, token, `/api/summaries?ids=nobody,${WORK}`);
  assert.deepEqual([alone.status, alone.body()], [200, { summaries: {} }]);
  assert.equal(JSON.stringify(alone.body()).includes(WORK), false);
});

test('a session with nothing said yet is an empty line and no time, and one that has said something gives the first sentence of its latest reply, what it asks and when', async () => {
  const { s, token } = await ready();
  assert.deepEqual(await summaries(s, token, 'top'), { top: { line: '', ask: '', at: null, pending: [] } });
  says(s, 'kid', 'Old news. Not this one.', '2026-10-23T04:00:00.000Z');
  says(s, 'kid', 'The tests pass. Merging next.\n\nShall I merge it?', '2026-10-23T05:00:00.000Z');
  assert.deepEqual(await summaries(s, token, 'kid'), { kid: { line: 'The tests pass.', ask: 'Shall I merge it?', at: Date.parse('2026-10-23T05:00:00.000Z'), pending: [] } });
  says(s, 'kid', '**All** merged. Done.');
  const later = await summaries(s, token, 'kid');
  assert.deepEqual([later.kid.line, later.kid.ask, later.kid.at], ['All merged.', '', null], 'a changed transcript is read again, and a reply with no time has none');
});

test('detail adds the reply itself to each answer, and only with detail=1', async () => {
  const { s, token } = await ready();
  says(s, 'kid', 'The tests pass.\n\nMerging next, then the release.', '2026-10-23T05:00:00.000Z');
  for (const more of ['', '&detail=0', '&detail=true', '&detail=']) {
    assert.equal(Object.hasOwn((await summaries(s, token, 'kid,top', more)).kid, 'reply'), false, more || 'no detail');
  }
  const full = await summaries(s, token, 'kid,top', '&detail=1');
  assert.equal(full.kid.reply, 'The tests pass.\n\nMerging next, then the release.');
  assert.equal(full.kid.line, 'The tests pass.');
  assert.deepEqual(full.top, { line: '', ask: '', at: null, pending: [], reply: '' });
  const cut = 'word '.repeat(2000);
  says(s, 'grand', cut);
  const clipped = (await summaries(s, token, 'grand', '&detail=1')).grand.reply;
  assert.ok(clipped.length <= 4001 && clipped.endsWith('…'), `${clipped.length} characters`);
});

test('what a session waits on shows in its summary while its chat is waiting, with the tool and what it would do, and not once it is answered', async () => {
  const { s, token } = await ready();
  const viewer = listen(s, token, 'kid');
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, 'kid', 'ask for approval');
    await until(() => viewer.events.some(e => e.type === 'approval'));
    const waiting = await summaries(s, token, 'kid,top');
    assert.deepEqual(waiting.kid.pending, [{ tool: 'Bash', summary: 'ls' }]);
    assert.deepEqual(waiting.top.pending, []);
    assert.deepEqual(Object.keys(waiting.kid.pending[0]), ['tool', 'summary'], 'no request id, input or rule is sent');
    const answered = await post(s, token, '/api/sessions/kid/approve', { requestId: 'perm-1', decision: 'deny' });
    assert.equal(answered.status, 200);
    await until(async () => (await summaries(s, token, 'kid')).kid.pending.length === 0);
  } finally {
    viewer.close();
  }
});

test('the index tells the page this server knows sub session status, and puts the sessions the tools reach under their head', async () => {
  const { s, token } = await ready();
  const ix = (await get(s, token, '/api/sessions?archived=1')).body();
  assert.equal(ix.features.subStatus, true);
  assert.deepEqual(findRow(ix, 'top').children.map(r => [r.id, r.via]).sort(), [['gone', 'top'], ['grand', 'kid'], ['kid', 'top'], ['under-gone', 'gone']]);
});

test('an ordinary chat is offered the sub session tools after the ones every chat has, and a group\'s chat is not', async () => {
  const { s, token } = await ready();
  await sendTo(s, token, 'top', 'list the tools');
  await until(() => replies(s).length === 1);
  const names = replies(s)[0].result.tools.map(t => t.name);
  assert.deepEqual(names.slice(-9), ['list_sub_sessions', 'read_sub_session', 'send_session', ...LAYOUT_TOOLS]);
  assert.ok(names.length > 2);
  assert.equal(names.some(n => n.endsWith('_group_session') || n === 'list_group_sessions'), false);

  await sendTo(s, token, WORK, 'list the tools');
  await until(() => replies(s).length === 2);
  const group = replies(s)[1].result.tools.map(t => t.name);
  assert.deepEqual(group.filter(n => n.endsWith('sub_session') || n.endsWith('sub_sessions')), []);
  assert.ok(['list_group_sessions', 'read_group_session', 'start_group_session'].every(n => group.includes(n)));
  const refused = await callTool(s, token, WORK, 'list_sub_sessions');
  assert.deepEqual(refused.result, { content: [{ type: 'text', text: 'GhostShell has no tool called list_sub_sessions.' }], isError: true });
});

test('a chat lists the sessions under it at any depth, archived ones only when asked and the sessions under them either way, and reads any of them', async () => {
  const { s, token } = await ready();
  says(s, 'grand', 'The grandchild is done. Nothing else.');
  const list = textOf(await callTool(s, token, 'top', 'list_sub_sessions'));
  assert.match(list, /^Session "Top": 3 sub sessions\n\n/);
  assert.match(list, /\n- Kid \[kid\] · idle ·.*\n {2}1 sub session\n {2}- Grand \[grand\] · (?:idle|active) ·.*\n {4}"The grandchild is done\."/);
  assert.match(list, /\[under-gone\]/, 'the session under an archived one shows straight under this one');
  assert.doesNotMatch(list, /\[gone\]|\[peer\]|\[peer-kid\]|\[loose\]|\[top\]/);
  const all = textOf(await callTool(s, token, 'top', 'list_sub_sessions', { include_archived: true }));
  assert.match(all, /^Session "Top": 3 sub sessions, 1 archived\n/);
  assert.match(all, /\n- Gone \[gone\] · archived ·.*\n {2}1 sub session\n {2}- Under gone \[under-gone\]/);

  for (const id of ['kid', 'grand', 'gone', 'under-gone']) {
    const reply = await callTool(s, token, 'top', 'read_sub_session', { session_id: id });
    assert.equal(reply.result.isError, undefined, id);
    assert.match(textOf(reply), new RegExp(`^Session "[^"]+" \\[${id}\\]`), id);
  }
  assert.match(textOf(await callTool(s, token, 'top', 'read_sub_session', { session_id: 'grand' })), /\nClaude: The grandchild is done\. Nothing else\.$/);
});

test('a chat is refused every session that is not under it with one sentence, however it asks, and reaches no more than its own subtree', async () => {
  const { s, token } = await ready();
  for (const id of ['top', 'peer', 'peer-kid', 'loose', WORK, 'nobody', '', '../top', 'kid ']) {
    const reply = await callTool(s, token, 'top', 'read_sub_session', { session_id: id });
    assert.deepEqual(reply.result, refusal, JSON.stringify(id));
  }
  assert.deepEqual((await callTool(s, token, 'top', 'read_sub_session', {})).result, refusal);
  assert.deepEqual((await callTool(s, token, 'top', 'read_sub_session', { session_id: ['kid'] })).result, refusal);

  const own = textOf(await callTool(s, token, 'kid', 'list_sub_sessions'));
  assert.match(own, /^Session "Kid": 1 sub session\n/);
  assert.match(own, /\[grand\]/);
  assert.doesNotMatch(own, /\[gone\]|\[top\]|\[under-gone\]/);
  for (const id of ['top', 'gone', 'under-gone', 'kid']) assert.deepEqual((await callTool(s, token, 'kid', 'read_sub_session', { session_id: id })).result, refusal, id);
  assert.equal((await callTool(s, token, 'kid', 'read_sub_session', { session_id: 'grand' })).result.isError, undefined);
  assert.equal(textOf(await callTool(s, token, 'grand', 'list_sub_sessions')), 'Session "Grand" has no sub sessions.');
});

test('each call looks the index up again, so a session archived or nested after the chat started is seen as it is now', async () => {
  const { s, token } = await ready();
  assert.match(textOf(await callTool(s, token, 'top', 'list_sub_sessions')), /^Session "Top": 3 sub sessions\n/);
  assert.equal((await post(s, token, '/api/layout/nest', { id: 'loose', parent: 'grand' })).status, 200);
  assert.match(textOf(await callTool(s, token, 'top', 'list_sub_sessions')), /^Session "Top": 4 sub sessions\n[^]*\[loose\]/);
  assert.equal((await callTool(s, token, 'top', 'read_sub_session', { session_id: 'loose' })).result.isError, undefined);
  assert.equal((await post(s, token, '/api/layout/archive', { id: 'grand', archived: true })).status, 200);
  const after = textOf(await callTool(s, token, 'top', 'list_sub_sessions'));
  assert.match(after, /^Session "Top": 3 sub sessions\n/, 'an archived one drops out of the count, and the one under it stays');
  assert.match(after, /\[loose\]/);
  assert.doesNotMatch(after, /\[grand\]/);
});

// Made is the session a chip of Kid started beside it, so it sits under Top, Kid's parent.
const MADE = {
  sessions: [...SESSIONS, { id: 'made', title: 'Made', ago: 1 }],
  chips: [{ sessionId: 'kid', toolUseId: 'toolu_made', status: 'started', startedId: 'made', nestUnder: 'top' }],
};
const archivedIds = async (s, token) => (await get(s, token, '/api/archived')).body().archived.map(r => r.id);

test('a chat lists and reads the session its chip started beside it, archiving the maker leaves that session alone, and archiving the parent takes both', async () => {
  const { s, token } = await ready(MADE);
  const list = textOf(await callTool(s, token, 'kid', 'list_sub_sessions'));
  assert.match(list, /^Session "Kid": 1 sub session, 1 started beside it\n[^]*\n\nStarted from this session's chips, beside it:\n- Made \[made\]/);
  assert.equal((await callTool(s, token, 'kid', 'read_sub_session', { session_id: 'made' })).result.isError, undefined);
  assert.match(textOf(await callTool(s, token, 'top', 'list_sub_sessions')), /\[made\]/, 'the parent has it below');

  assert.equal((await post(s, token, '/api/layout/archive', { id: 'kid', archived: true })).status, 200);
  const afterKid = await archivedIds(s, token);
  assert.ok(afterKid.includes('kid') && afterKid.includes('grand'));
  assert.equal(afterKid.includes('made'), false, 'it is not below its maker');
  assert.equal((await post(s, token, '/api/layout/archive', { id: 'top', archived: true })).status, 200);
  const afterTop = await archivedIds(s, token);
  assert.ok(['top', 'kid', 'made'].every(id => afterTop.includes(id)), afterTop.join());
});

test('a chat no longer reaches the session its chip started once the owner has put that session somewhere else', async () => {
  const { s, token } = await ready(MADE);
  assert.equal((await callTool(s, token, 'kid', 'read_sub_session', { session_id: 'made' })).result.isError, undefined);
  assert.equal((await post(s, token, '/api/layout/nest', { id: 'made', parent: 'peer' })).status, 200);
  assert.deepEqual((await callTool(s, token, 'kid', 'read_sub_session', { session_id: 'made' })).result, refusal);
  assert.equal(textOf(await callTool(s, token, 'kid', 'list_sub_sessions')).includes('[made]'), false);
});

test('what a sub session waits on shows when the chat above it reads it', async () => {
  const { s, token } = await ready();
  const viewer = listen(s, token, 'kid');
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, 'kid', 'ask for approval');
    await until(() => viewer.events.some(e => e.type === 'approval'));
    assert.match(textOf(await callTool(s, token, 'top', 'read_sub_session', { session_id: 'kid' })), /\nWaiting for the owner to approve: Bash ls\n/);
  } finally {
    viewer.close();
  }
});

test('the sub session tools are allowed with no card in an ordinary chat, and a group\'s chat gets a card for them', async () => {
  const { s, token } = await ready();
  const viewer = listen(s, token, 'top');
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, 'top', 'ask to list the subs');
    await until(() => cliCalls(s).some(c => c.requestId === 'perm-subs'));
    assert.equal(cliCalls(s).find(c => c.requestId === 'perm-subs').response, 'allow');
    assert.equal(viewer.events.some(e => e.type === 'approval'), false);
  } finally {
    viewer.close();
  }

  const group = listen(s, token, WORK);
  try {
    await until(() => group.events.length);
    await sendTo(s, token, WORK, 'ask to list the subs');
    await until(() => group.events.some(e => e.type === 'approval'));
    assert.deepEqual(group.events.filter(e => e.type === 'approval').map(e => e.data.tool), ['mcp__capcom__list_sub_sessions']);
    assert.equal(cliCalls(s).some(c => c.requestId === 'perm-subs' && c.response !== 'allow'), false);
  } finally {
    group.close();
  }
});

test('a chat that is only just started has the tools too, and reaches its sessions under the id the CLI gives it', async () => {
  const { s, token } = await ready();
  const made = (await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' })).body().id;
  assert.equal(made, 'begun-by-the-fake');
  await sendTo(s, token, made, 'list the tools');
  await until(() => replies(s).length === 1);
  assert.deepEqual(replies(s)[0].result.tools.map(t => t.name).slice(-9), ['list_sub_sessions', 'read_sub_session', 'send_session', ...LAYOUT_TOOLS]);
  assert.match(textOf(await callTool(s, token, made, 'list_sub_sessions')), /has no sub sessions\.$/);

  assert.equal((await post(s, token, '/api/layout/nest', { id: 'loose', parent: made })).status, 200);
  const list = textOf(await callTool(s, token, made, 'list_sub_sessions'));
  assert.match(list, /: 1 sub session\n\n- Loose \[loose\]/);
  assert.equal((await callTool(s, token, made, 'read_sub_session', { session_id: 'loose' })).result.isError, undefined);
  assert.deepEqual((await callTool(s, token, made, 'read_sub_session', { session_id: 'peer' })).result, refusal);
});
