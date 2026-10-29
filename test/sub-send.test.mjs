// Run with `npm test`. Sending to a sub session over HTTP against the real server and a fake CLI: a chip starts a session, its process stops, and the
// chat above it wakes it with send_session. The wording, the refusals and the card rules have their own tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findRow } from '../public/ui/tree.js';
import { as, cliCalls, listen, request, signIn, start, until as waitFor } from './harness.mjs';

const NOT_BELOW = 'That session is not one of the sub sessions of this session. Use list_sub_sessions to see the ones you can reach.';
//   top
//     kid (started by a chip titled "Review - dialogs", idle, no process)
//       grand
//     gone (archived)
//   loose
const SESSIONS = [
  { id: 'top', title: 'Top', ago: 5 },
  { id: 'kid', title: 'Fix the first line of the prompt', ago: 4 },
  { id: 'grand', title: 'Grand', parent: 'kid', ago: 3 },
  { id: 'gone', title: 'Gone', parent: 'top', archived: true, ago: 20 },
  { id: 'loose', title: 'Loose', ago: 8 },
];
const CHIPS = [{ sessionId: 'top', startedId: 'kid', status: 'started', title: 'Review - dialogs' }];
const until = (check, ms = 20_000) => waitFor(check, ms);

const get = (s, token, route) => request(s, 'GET', route, { headers: as(token) });
const post = (s, token, route, json) => request(s, 'POST', route, { headers: as(token), json: json ?? {} });
const ready = async mine => {
  const s = await start({ sessions: SESSIONS, chips: CHIPS, claude: true, ...mine });
  return { s, ...(await signIn(s)) };
};
const sendTo = async (s, token, id, text) => assert.equal((await post(s, token, `/api/sessions/${id}/send`, { text })).status, 200);
const replies = s => cliCalls(s).filter(c => c.mcp).map(c => c.mcp);
const textOf = reply => reply.result.content[0].text;
async function callTool(s, token, id, tool, args = {}) {
  const before = replies(s).length;
  await sendTo(s, token, id, `call ${tool} ${JSON.stringify(args)}`);
  await until(() => replies(s).length > before);
  return replies(s)[before];
}
const resumed = (s, id) => cliCalls(s).filter(c => c.started?.includes('--resume') && c.started[c.started.indexOf('--resume') + 1] === id);
const delivered = s => cliCalls(s).filter(c => typeof c.user === 'string' && c.user.startsWith('<session-message'));

test('the list and the read name a sub session by the chip title, and a rename by the owner wins over it', async () => {
  const { s, token } = await ready();
  assert.match(textOf(await callTool(s, token, 'top', 'list_sub_sessions')), /- Review - dialogs \[kid\]/);
  assert.match(textOf(await callTool(s, token, 'top', 'read_sub_session', { session_id: 'kid' })), /^Session "Review - dialogs" \[kid\]/);
  assert.equal((await post(s, token, '/api/layout/rename', { id: 'kid', title: 'My name' })).status, 200);
  assert.match(textOf(await callTool(s, token, 'top', 'list_sub_sessions')), /- My name \[kid\]/);
});

test('a message to an idle sub session with no process resumes it and arrives as a message from its parent, at any depth', async () => {
  const { s, token } = await ready();
  assert.equal(resumed(s, 'kid').length, 0);
  const text = textOf(await callTool(s, token, 'top', 'send_session', { session_id: 'kid', message: 'Please rebase.' }));
  assert.match(text, /^Delivered to "Review - dialogs" \[kid\]\./);
  await until(() => resumed(s, 'kid').length === 1 && delivered(s).length === 1);
  assert.equal(delivered(s)[0].user, '<session-message from="top" from-name="Top (your parent session)">\nPlease rebase.\n</session-message>');
  assert.match(textOf(await callTool(s, token, 'top', 'send_session', { session_id: 'grand', message: 'And you.' })), /^Delivered to "Grand" \[grand\]\./);
  await until(() => resumed(s, 'grand').length === 1);
});

test('a message to a session that is running a turn or waiting on its owner is queued, and the session is not interrupted', async () => {
  const { s, token } = await ready();
  await sendTo(s, token, 'kid', 'begin a session');
  await until(() => resumed(s, 'kid').length === 1);
  assert.match(textOf(await callTool(s, token, 'top', 'send_session', { session_id: 'kid', message: 'One.' })), /^Queued for "Review - dialogs" \[kid\]\. It is running a turn/);
  await sendTo(s, token, 'kid', 'ask for approval');
  await until(() => cliCalls(s).some(c => c.user === 'ask for approval'));
  const viewer = listen(s, token, 'kid');
  try {
    await until(() => viewer.events.some(e => e.type === 'approval' || (e.type === 'status' && e.data.pending?.length)));
    assert.match(textOf(await callTool(s, token, 'top', 'send_session', { session_id: 'kid', message: 'Two.' })), /^Queued for "Review - dialogs" \[kid\]\. It is waiting for its owner to approve something/);
    assert.equal(cliCalls(s).some(c => c.control === 'interrupt'), false, 'nothing was interrupted');
    assert.equal(resumed(s, 'kid').length, 1, 'no second process was started');
    await until(() => delivered(s).length === 2);
  } finally {
    viewer.close();
  }
});

test('an archived session, itself and an id that is no session are refused, and any other session in the index is sent to as another session', async () => {
  const { s, token } = await ready();
  const archived = await callTool(s, token, 'top', 'send_session', { session_id: 'gone', message: 'hi' });
  assert.equal(archived.result.isError, true);
  assert.equal(textOf(archived), 'Refused: "Gone" [gone] is archived. Ask the owner to unarchive it, then send again.');
  assert.equal(textOf(await callTool(s, token, 'top', 'send_session', { session_id: 'top', message: 'hi' })), 'A session cannot send a message to itself.');
  assert.match(textOf(await callTool(s, token, 'top', 'send_session', { session_id: 'nobody', message: 'hi' })), /^No session with that id on this Mac\./);
  assert.equal((await callTool(s, token, 'top', 'read_sub_session', { session_id: 'loose' })).result.content[0].text, NOT_BELOW, 'a read still reaches only sub sessions');
  assert.equal((await get(s, token, '/api/sessions?archived=1')).body().features.subStatus, true);
  assert.equal(delivered(s).length, 0);
  assert.equal(resumed(s, 'gone').length, 0);
  const text = textOf(await callTool(s, token, 'top', 'send_session', { session_id: 'loose', message: 'Hello.' }));
  assert.match(text, /^Delivered to "Loose" \[loose\]\..*read_sub_session reaches only sub sessions/);
  await until(() => delivered(s).length === 1);
  assert.equal(delivered(s)[0].user, '<session-message from="top" from-name="Top (another session)">\nHello.\n</session-message>');
  assert.equal(resumed(s, 'loose').length, 1);
});

test('a send within the sender\'s own tree goes with no card, from the parent down and from a sub session up', async () => {
  const { s, token } = await ready();
  const viewer = listen(s, token, 'top');
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, 'top', 'ask to send to a sub');
    await until(() => cliCalls(s).some(c => c.requestId === 'perm-send'));
    assert.equal(cliCalls(s).find(c => c.requestId === 'perm-send').response, 'allow');
    await sendTo(s, token, 'grand', 'ask to send to kid');
    await until(() => cliCalls(s).filter(c => c.requestId === 'perm-send').length === 2);
    assert.equal(viewer.events.some(e => e.type === 'approval'), false);
  } finally {
    viewer.close();
  }
});

test('a send outside the sender\'s own tree asks first, in every mode, with a card that names the recipient, and nothing is sent until it is approved', async () => {
  const { s, token } = await ready();
  assert.equal((await post(s, token, '/api/sessions/top/mode', { mode: 'bypassPermissions' })).status, 200);
  const viewer = listen(s, token, 'top');
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, 'top', 'ask to send to loose');
    await until(() => viewer.events.some(e => e.type === 'approval'));
    const [card] = viewer.events.filter(e => e.type === 'approval').map(e => e.data);
    assert.deepEqual([card.tool, card.always, card.summary], ['mcp__capcom__send_session', false, 'to "Loose": Please rebase']);
    assert.equal(cliCalls(s).some(c => c.requestId === 'perm-send'), false, 'the CLI is not answered until the owner decides');
    assert.equal((await post(s, token, '/api/sessions/top/approve', { requestId: 'perm-send', decision: 'always' })).status, 200);
    await until(() => cliCalls(s).some(c => c.requestId === 'perm-send'));
    const answer = cliCalls(s).find(c => c.requestId === 'perm-send');
    assert.equal(answer.response, 'allow');
    assert.equal(answer.rules, undefined, 'Always allow keeps no rule');
  } finally {
    viewer.close();
  }
});

test('a session a chip started goes idle and loses its process, and the chat above wakes it with a message that it answers', async () => {
  const { s, token } = await ready({ sessions: [{ id: 'top', title: 'Top', ago: 5 }], chips: [] });
  const made = await callTool(s, token, 'top', 'spawn_task', { title: 'Review - dialogs', prompt: 'begin a session', cwd: s.home });
  assert.match(textOf(made), /^Chip created/);
  const [chip] = (await get(s, token, '/api/sessions/top/chips')).body().chips;
  const started = (await post(s, token, '/api/chips/start', { sessionId: 'top', toolUseId: chip.toolUseId, title: chip.title, prompt: 'begin a session', cwd: s.home, confirmCwd: s.home })).body();
  assert.equal(started.id, 'begun-by-the-fake');
  await sendTo(s, token, started.id, 'finish the turn');
  await until(async () => findRow((await get(s, token, '/api/sessions?archived=1')).body(), started.id)?.state === 'idle');
  assert.match(textOf(await callTool(s, token, 'top', 'list_sub_sessions')), /- Review - dialogs \[begun-by-the-fake\] · /);

  // Archiving stops the process, and unarchiving puts the session back below its parent with no process.
  assert.equal((await post(s, token, '/api/layout/archive', { id: started.id, archived: true })).status, 200);
  await until(() => cliCalls(s).some(c => c.closed));
  assert.equal((await post(s, token, '/api/layout/archive', { id: started.id, archived: false })).status, 200);
  const before = cliCalls(s).filter(c => c.started).length;

  const text = textOf(await callTool(s, token, 'top', 'send_session', { session_id: started.id, message: 'Please rebase.' }));
  assert.match(text, /^Delivered to "Review - dialogs" \[begun-by-the-fake\]\. It was idle/);
  await until(() => cliCalls(s).filter(c => c.started).length === before + 1 && delivered(s).length === 1);
  assert.equal(resumed(s, started.id).length, 1, 'a new process resumed the session');
  assert.match(delivered(s)[0].user, /^<session-message from="top" from-name="Top \(your parent session\)">\nPlease rebase\.\n<\/session-message>$/);
});
