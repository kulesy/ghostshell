// Run with `npm test`. The tools that archive, rename and move a session, and the two that find sessions and chips, against the real server and a fake CLI:
// each write lands in layout.json the way the layout routes write it, is held to a card in every permission mode with no Always allow, and the reads run unasked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { as, cliCalls, listen, request, signIn, start, until as waitFor } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }, { id: 'cg-home', name: 'Home' }];
const SESSIONS = [
  { id: 'top', title: 'Top', ago: 5 },
  { id: 'kid', title: 'Fix the first line of the prompt', ago: 4 },
  { id: 'loose', title: 'Loose', ago: 8 },
  { id: 'gone', title: 'Gone', archived: true, ago: 20 },
  { id: 'member', title: 'Member', group: 'cg-work', ago: 6 },
  { id: 'desk', title: 'Desktop work', ago: 0.5 },
];
const CHIPS = [{ sessionId: 'top', startedId: 'kid', status: 'started', title: 'Review - dialogs', id: 'task_one', at: Date.now() - 60_000 }];
const until = (check, ms = 20_000) => waitFor(check, ms);

const get = (s, token, route) => request(s, 'GET', route, { headers: as(token) });
const post = (s, token, route, json) => request(s, 'POST', route, { headers: as(token), json: json ?? {} });
const ready = async mine => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, chips: CHIPS, claude: true, ...mine });
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
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const WRITES = [
  ['archive_session', { session_id: 'loose' }, 'archive "Loose" [loose]'],
  ['unarchive_session', { session_id: 'gone' }, 'unarchive "Gone" [gone]'],
  ['set_session_title', { session_id: 'loose', title: 'Renamed' }, 'rename "Loose" [loose] to "Renamed"'],
  ['move_session_to_group', { session_id: 'loose', group: 'home' }, 'move "Loose" [loose] to "Home"'],
];

test('each write lands in layout.json as the layout route writes it, and the server lists the session as changed', async () => {
  const { s, token } = await ready();
  assert.match(textOf(await callTool(s, token, 'top', 'set_session_title', { session_id: 'loose', title: '  ✅  Renamed  ' })), /^Renamed "Loose" \[loose\] to "✅ Renamed"/);
  assert.equal(onDisk(s).titles.loose, '✅ Renamed');
  assert.match(textOf(await callTool(s, token, 'top', 'move_session_to_group', { session_id: 'loose', group: 'HOME' })), /^Moved "✅ Renamed" \[loose\] to the group "Home"/);
  assert.equal(onDisk(s).assignments.loose, 'cg-home');
  const home = (await get(s, token, '/api/sessions')).body().groups.find(g => g.id === 'cg-home');
  assert.deepEqual(home.sessions.map(r => [r.id, r.title]), [['loose', '✅ Renamed']], 'the server\'s own list agrees with the file');
  assert.match(textOf(await callTool(s, token, 'top', 'archive_session', { session_id: 'loose' })), /^Archived /);
  assert.ok(onDisk(s).archived.loose);
  assert.equal((await get(s, token, '/api/archived')).body().archived.some(r => r.id === 'loose'), true);
  assert.match(textOf(await callTool(s, token, 'top', 'unarchive_session', { session_id: 'loose' })), /^Unarchived /);
  assert.equal(onDisk(s).archived.loose, undefined);
  assert.match(textOf(await callTool(s, token, 'top', 'archive_session', { session_id: 'gone' })), /already archived/);
});

test('a session retitles itself, and the refusals are the routes\': a group\'s chat, an unknown id, the caller itself, and a running session that is left running', async () => {
  const { s, token } = await ready();
  assert.match(textOf(await callTool(s, token, 'top', 'set_session_title', { session_id: 'top', title: '💬 Working' })), /^Renamed "Top" \[top\] to "💬 Working"/);
  const refusedText = async (tool, args) => {
    const reply = await callTool(s, token, 'top', tool, args);
    assert.equal(reply.result.isError, true, `${tool} ${JSON.stringify(args)}`);
    return textOf(reply);
  };
  for (const tool of ['archive_session', 'unarchive_session']) assert.equal(await refusedText(tool, { session_id: WORK }), "A group's session stays with its group.");
  assert.equal(await refusedText('set_session_title', { session_id: WORK, title: 'x' }), "A group's session stays with its group.");
  assert.equal(await refusedText('move_session_to_group', { session_id: WORK, group: 'Home' }), "A group's session stays with its group.");
  assert.equal(await refusedText('archive_session', { session_id: 'nobody' }), 'No session with that id on this Mac.');
  assert.equal(await refusedText('archive_session', { session_id: 'top' }), 'A session cannot archive itself. Ask the owner to archive it.');
  assert.match(await refusedText('move_session_to_group', { session_id: 'loose', group: 'Nowhere' }), /^move_session_to_group has no group called "Nowhere"\. The groups are "Work", "Home"\.$/);
  const before = fs.readFileSync(s.layout, 'utf8');

  await sendTo(s, token, 'kid', 'begin a session');
  await until(() => cliCalls(s).some(c => c.started?.includes('--resume') && c.started.includes('kid')));
  assert.match(await refusedText('archive_session', { session_id: 'kid' }), /^Refused: "Review - dialogs" \[kid\] is running a turn or waiting for the owner to approve something/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'nothing was written');
  assert.equal(cliCalls(s).some(c => c.control === 'interrupt' || c.closed), false, 'the running chat was left running');
});

test('a session another app is running is refused for archiving, as send_session refuses it, and is left in the list', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  const archived = await callTool(s, token, 'top', 'archive_session', { session_id: 'desk' });
  assert.equal(archived.result.isError, true);
  assert.match(textOf(archived), /^Refused: "Desktop work" \[desk\] looks to be running in another app/);
  assert.doesNotMatch(textOf(archived), /chat is closed/);
  const sent = await callTool(s, token, 'top', 'send_session', { session_id: 'desk', message: 'hi' });
  assert.match(textOf(sent), /^Refused: "Desktop work" \[desk\] looks to be running in another app/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'nothing was written');
  assert.equal((await post(s, token, '/api/layout/archive', { id: 'desk', archived: true })).status, 200, 'the owner can still archive it from the app');
});

test('archiving stops an idle chat the way the route does, and an archived session that send_session refused can be unarchived and then sent to', async () => {
  const { s, token } = await ready();
  const refused = await callTool(s, token, 'top', 'send_session', { session_id: 'gone', message: 'hi' });
  assert.equal(textOf(refused), 'Refused: "Gone" [gone] is archived. Unarchive it with unarchive_session, which the owner approves, then send again.');
  assert.match(textOf(await callTool(s, token, 'top', 'unarchive_session', { session_id: 'gone' })), /^Unarchived "Gone" \[gone\]/);
  assert.match(textOf(await callTool(s, token, 'top', 'send_session', { session_id: 'gone', message: 'hi' })), /^Delivered to "Gone" \[gone\]/);
  const unknown = await callTool(s, token, 'top', 'send_session', { session_id: 'nobody', message: 'hi' });
  assert.equal(textOf(unknown), 'No session with that id on this Mac. Use find_sessions to look one up by its title.');
});

test('find_sessions and list_chips read the real index and chips, a group\'s chat and archived sessions included', async () => {
  const { s, token } = await ready();
  const found = textOf(await callTool(s, token, 'top', 'find_sessions', { query: 'G' }));
  assert.match(found, /- Gone \[gone\] · archived · /);
  assert.match(found, /- Review - dialogs \[kid\] · idle · /, 'a session a chip started goes by the chip\'s title');
  assert.equal(textOf(await callTool(s, token, 'top', 'find_sessions', { query: 'gone', include_archived: false })), 'No session has "gone" in its title (archived sessions left out).');
  assert.match(textOf(await callTool(s, token, 'top', 'find_sessions', { query: 'work' })), /- Work \[3b1f6c0e-[\w-]+\] · idle · .* · the chat of a group$/m);
  assert.match(textOf(await callTool(s, token, 'top', 'find_sessions', { query: 'member' })), /- Member \[member\] · .* · group "Work"/);
  const chips = textOf(await callTool(s, token, 'top', 'list_chips'));
  assert.match(chips, /^1 chip, the newest first\n\n- Review - dialogs \[task_one\] · started · started session \[kid\] · made by \[top\] · /);
});

test('a group\'s chat is given the six tools and uses them, and its own chat and a section\'s cannot be changed', async () => {
  const { s, token } = await ready();
  await sendTo(s, token, WORK, 'list the tools');
  await until(() => replies(s).length === 1);
  const listed = replies(s)[0].result.tools.map(t => t.name);
  for (const name of ['list_chips', 'find_sessions', 'archive_session', 'unarchive_session', 'set_session_title', 'move_session_to_group', 'send_session']) assert.ok(listed.includes(name), name);
  const moved = textOf(await callTool(s, token, WORK, 'move_session_to_group', { session_id: 'loose', group: 'Work' }));
  assert.match(moved, /^Moved "Loose" \[loose\] to the group "Work"/);
  assert.match(moved, /This group's chat can now read it with read_group_session\.$/);
  assert.doesNotMatch(textOf(await callTool(s, token, 'top', 'move_session_to_group', { session_id: 'member', group: 'Home' })), /read it/);
  assert.equal(onDisk(s).assignments.loose, 'cg-work');
  const own = await callTool(s, token, WORK, 'archive_session', { session_id: WORK });
  assert.equal(textOf(own), 'A session cannot archive itself. Ask the owner to archive it.');
  const pinned = (await post(s, token, '/api/groups/pinned/session')).body().id;
  const section = await callTool(s, token, WORK, 'set_session_title', { session_id: pinned, title: 'x' });
  assert.equal(textOf(section), "A section's session stays with its section.");
});

for (const mode of ['manual', 'bypassPermissions', 'auto']) {
  // The fake CLI raises the request in every mode, so this shows that Capcom never auto-allows a write. That the real CLI asks in Bypass and Auto rests on the ask rules.
  test(`when the CLI asks in ${mode} mode, every write is held to a card that names the session, offers no Always allow, and does nothing until it is answered, in an ordinary chat and a group's`, async () => {
    const { s, token } = await ready();
    const before = fs.readFileSync(s.layout, 'utf8');
    for (const id of ['top', WORK]) {
      assert.equal((await post(s, token, `/api/sessions/${id}/mode`, { mode })).status, 200);
      const viewer = listen(s, token, id);
      try {
        await until(() => viewer.events.length);
        for (const [tool, input, summary] of WRITES) {
          const before = viewer.events.filter(e => e.type === 'approval').length;
          await sendTo(s, token, id, `ask to use ${tool} ${JSON.stringify(input)}`);
          await until(() => viewer.events.filter(e => e.type === 'approval').length > before);
          const card = viewer.events.filter(e => e.type === 'approval').at(-1).data;
          assert.deepEqual([card.tool, card.always, card.summary], [`mcp__capcom__${tool}`, false, summary], `${id} ${tool}`);
          const answered = () => cliCalls(s).filter(c => c.requestId === `perm-${tool}`).length;
          const had = answered();
          await new Promise(resolve => setTimeout(resolve, 150));
          assert.equal(answered(), had, 'the CLI is not answered until the owner decides');
          const decision = tool === 'archive_session' ? 'deny' : 'always';
          assert.equal((await post(s, token, `/api/sessions/${id}/approve`, { requestId: `perm-${tool}`, decision })).status, 200);
          await until(() => answered() > had);
          const answer = cliCalls(s).findLast(c => c.requestId === `perm-${tool}`);
          assert.equal(answer.response, decision === 'deny' ? 'deny' : 'allow');
          assert.equal(answer.rules, undefined, 'Always allow keeps no rule');
        }
      } finally {
        viewer.close();
      }
    }
    assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'asking changed nothing');
  });
}

test('a rename or move of the caller, its parent or a sub session goes with no card from the server\'s own nesting, and an archive of a sub session still shows one', async () => {
  const { s, token } = await ready();
  const allowed = [['top', 'set_session_title', { session_id: 'top', title: 'Mine' }], ['top', 'set_session_title', { session_id: 'kid', title: 'Below' }], ['kid', 'set_session_title', { session_id: 'top', title: 'Above' }], ['top', 'move_session_to_group', { session_id: 'kid', group: 'Home' }]];
  const viewers = ['top', 'kid'].map(id => listen(s, token, id));
  try {
    await until(() => viewers.every(v => v.events.length));
    for (const [id, tool, input] of allowed) {
      const had = cliCalls(s).filter(c => c.requestId === `perm-${tool}`).length;
      await sendTo(s, token, id, `ask to use ${tool} ${JSON.stringify(input)}`);
      await until(() => cliCalls(s).filter(c => c.requestId === `perm-${tool}`).length > had);
      assert.equal(cliCalls(s).findLast(c => c.requestId === `perm-${tool}`).response, 'allow', `${id} ${tool} ${input.session_id}`);
    }
    await sendTo(s, token, 'top', 'ask to use archive_session {"session_id":"kid"}');
    await until(() => viewers[0].events.some(e => e.type === 'approval'));
    assert.deepEqual(viewers.flatMap(v => v.events.filter(e => e.type === 'approval').map(e => e.data.tool)), ['mcp__capcom__archive_session'], 'only the archive raised a card');
  } finally {
    for (const v of viewers) v.close();
  }
});

test('the card for a move into the group of the chat that asks says that chat can then read the session, and a move for another chat or into another group does not', async () => {
  const { s, token } = await ready();
  const card = async (id, input) => {
    const viewer = listen(s, token, id);
    try {
      await until(() => viewer.events.length);
      await sendTo(s, token, id, `ask to use move_session_to_group ${JSON.stringify(input)}`);
      await until(() => viewer.events.some(e => e.type === 'approval'));
      return viewer.events.filter(e => e.type === 'approval').at(-1).data.summary;
    } finally {
      viewer.close();
    }
  };
  assert.equal(await card(WORK, { session_id: 'loose', group: 'Work' }), 'move "Loose" [loose] to "Work" (this group\'s chat can then read it)');
  assert.equal(await card('top', { session_id: 'loose', group: 'Work' }), 'move "Loose" [loose] to "Work"');
  assert.equal(await card('kid', { session_id: 'nobody', group: 'cg-work' }), 'move an unknown session [nobody] to "Work"');
});

test('moving a session with sessions under it into the group of the chat that asks names them on the card and in the reply, archived ones included', async () => {
  const family = [{ id: 'top', title: 'Top', ago: 5 }, { id: 'kid', title: 'Kid', parent: 'top', ago: 4 }, { id: 'old', title: 'Old kid', parent: 'kid', archived: true, ago: 20 }];
  const { s, token } = await ready({ sessions: family, chips: [] });
  const viewer = listen(s, token, WORK);
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, WORK, `ask to use move_session_to_group ${JSON.stringify({ session_id: 'top', group: 'Work' })}`);
    await until(() => viewer.events.some(e => e.type === 'approval'));
    assert.equal(viewer.events.find(e => e.type === 'approval').data.summary, 'move "Top" [top] to "Work" (this group\'s chat can then read it and the 2 sessions under it)');
  } finally {
    viewer.close();
  }
  const moved = textOf(await callTool(s, token, WORK, 'move_session_to_group', { session_id: 'top', group: 'Work' }));
  assert.match(moved, /The 2 sessions under it moved with it\./);
  assert.match(moved, /can now read it and the 2 sessions under it with read_group_session\.$/);
  const members = (await get(s, token, '/api/sessions')).body().groups.find(g => g.id === 'cg-work');
  assert.ok(members.sessions.some(r => r.id === 'top'));
});

test('find_sessions and list_chips are allowed with no card, in an ordinary chat and a group\'s, and never in a chat that has no callbacks for them', async () => {
  const { s, token } = await ready();
  for (const id of ['top', WORK]) {
    for (const tool of ['find_sessions', 'list_chips']) {
      await sendTo(s, token, id, `ask to use ${tool} {}`);
      await until(() => cliCalls(s).some(c => c.requestId === `perm-${tool}`));
      assert.equal(cliCalls(s).findLast(c => c.requestId === `perm-${tool}`).response, 'allow', `${id} ${tool}`);
    }
  }
  const viewer = listen(s, token, 'top');
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, 'top', 'ask to use archive_session {"session_id":"loose"}');
    await until(() => viewer.events.some(e => e.type === 'approval'));
    assert.deepEqual(viewer.events.filter(e => e.type === 'approval').map(e => e.data.tool), ['mcp__capcom__archive_session'], 'the reads raised no card');
  } finally {
    viewer.close();
  }
});

test('an ordinary chat and a group\'s start with an ask rule for each write, beside the one for sending', async () => {
  const { s, token } = await ready();
  await sendTo(s, token, 'top', 'begin a session');
  await sendTo(s, token, WORK, 'begin a session');
  await until(() => cliCalls(s).filter(c => c.started).length >= 2);
  const asked = cliCalls(s).filter(c => c.started).map(c => JSON.parse(c.started[c.started.indexOf('--settings') + 1]).permissions.ask.filter(r => r.startsWith('mcp__capcom__')));
  const writes = WRITES.map(([tool]) => `mcp__capcom__${tool}`);
  assert.deepEqual(asked.find(list => !list.includes('mcp__capcom__start_group_session')), ['mcp__capcom__send_session', ...writes]);
  assert.deepEqual(asked.find(list => list.includes('mcp__capcom__start_group_session')), ['mcp__capcom__start_group_session', 'mcp__capcom__send_session', ...writes]);
});
