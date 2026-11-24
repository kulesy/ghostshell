// Run with `npm test`. The tools that archive, rename and move a session, make a project or a group, and the two that find sessions and chips, against the real server and a fake CLI:
// each write lands in layout.json the way the layout routes write it, is held to a card in every permission mode with no Always allow, and the reads run unasked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { as, cliCalls, listen, request, restart, signIn, start, until as waitFor } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }, { id: 'cg-home', name: 'Home' }];
const PROJECTS = [{ id: 'cp-side', name: 'Side' }, { id: 'cp-lab', name: 'Lab' }];
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
  const s = await start({ sessions: SESSIONS, groups: GROUPS, chips: CHIPS, claude: true, layout: { projects: PROJECTS }, ...mine });
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
  ['set_session_title', { session_id: 'loose', title: 'Fix "menus" [kid]' }, 'rename "Loose" [loose] to "Fix menus kid"'],
  ['move_session_to_group', { session_id: 'loose', group: 'home' }, 'move "Loose" [loose] to "Home" [cg-home]'],
  ['create_project', { name: 'Fresh' }, 'create the project "Fresh"'],
  ['create_group', { name: 'Shiny', project: 'side' }, 'create the group "Shiny" in the project "Side" [cp-side]'],
  ['move_group_to_project', { group: 'work', project: 'side' }, 'move the group "Work" [cg-work] to the project "Side" [cp-side]'],
  ['move_project', { project: 'side', after: 'LAB' }, 'move the project "Side" [cp-side] after "Lab" [cp-lab]'],
  ['move_project', { project: 'lab', before: 'nowhere' }, 'move the project "Lab" [cp-lab] before "nowhere"'],
  ['move_routine_to_project', { routine: 'Daily digest', project: 'side' }, 'move the routine "Daily digest" to the project "Side" [cp-side]'],
  ['move_routine_to_project', { routine: 'daily-digest' }, 'move the routine "daily-digest" to Home'],
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
  await callTool(s, token, 'top', 'set_session_title', { session_id: 'loose', title: 'Fix "menus" [kid]' });
  assert.equal(onDisk(s).titles.loose, 'Fix "menus" [kid]', 'the title keeps what its card leaves out');
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

test('archiving a parent archives its family in the one write, the reply counts the sub sessions, and unarchiving brings the batch back', async () => {
  const family = [{ id: 'boss', title: 'Boss', ago: 9 }, { id: 'bkid', title: 'Boss kid', parent: 'boss', ago: 9 }, { id: 'bgrand', title: 'Boss grand', parent: 'bkid', ago: 9 }];
  const { s, token } = await ready({ sessions: [...SESSIONS, ...family] });
  const reply = textOf(await callTool(s, token, 'top', 'archive_session', { session_id: 'boss' }));
  assert.match(reply, /^Archived "Boss" \[boss\] and the 2 sub sessions under it\. /);
  assert.deepEqual(Object.keys(onDisk(s).archived).sort(), ['bgrand', 'bkid', 'boss']);
  assert.deepEqual(onDisk(s).archivedWith, { bkid: 'boss', bgrand: 'boss' });
  const back = textOf(await callTool(s, token, 'top', 'unarchive_session', { session_id: 'boss' }));
  assert.match(back, /^Unarchived "Boss" \[boss\] and the 2 sub sessions archived with it\. /);
  assert.deepEqual(Object.keys(onDisk(s).archived), []);
});

test('archiving a parent is refused, naming how many, while a session below it is running, and nothing is written', async () => {
  const family = [{ id: 'boss', title: 'Boss', ago: 9 }, { id: 'bkid', title: 'Boss kid', parent: 'boss', ago: 9 }];
  const { s, token } = await ready({ sessions: [...SESSIONS, ...family] });
  await sendTo(s, token, 'bkid', 'keep going');
  await until(() => cliCalls(s).some(c => c.user === 'keep going'));
  const before = fs.readFileSync(s.layout, 'utf8');
  const reply = await callTool(s, token, 'top', 'archive_session', { session_id: 'boss' });
  assert.equal(reply.result.isError, true);
  assert.match(textOf(reply), /^Refused: 1 session under "Boss" \[boss\] is running a turn or waiting for the owner/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
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

test('a group\'s chat is given the layout tools and uses them, and its own chat and a section\'s cannot be changed', async () => {
  const { s, token } = await ready();
  await sendTo(s, token, WORK, 'list the tools');
  await until(() => replies(s).length === 1);
  const listed = replies(s)[0].result.tools.map(t => t.name);
  for (const name of ['list_chips', 'find_sessions', 'archive_session', 'unarchive_session', 'set_session_title', 'move_session_to_group', 'create_project', 'create_group', 'move_group_to_project', 'move_project', 'move_routine_to_project', 'send_session']) assert.ok(listed.includes(name), name);
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
  test(`when the CLI asks in ${mode} mode, every write is held to a card that names what it changes, offers no Always allow, and does nothing until it is answered, in an ordinary chat and a group's`, async () => {
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

// Asks to move a session into a group and answers 'allow' when the call went with no card, else 'card'. The card is denied, so nothing is left waiting.
async function moveBy(s, token, id, input) {
  const answers = () => cliCalls(s).filter(c => c.requestId === 'perm-move_session_to_group');
  const had = answers().length;
  const viewer = listen(s, token, id);
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, id, `ask to use move_session_to_group ${JSON.stringify(input)}`);
    const card = () => viewer.events.some(e => e.type === 'approval');
    await until(() => card() || answers().length > had);
    if (!card()) return answers().at(-1).response;
    assert.equal((await post(s, token, `/api/sessions/${id}/approve`, { requestId: 'perm-move_session_to_group', decision: 'deny' })).status, 200);
    await until(() => answers().length > had);
    return 'card';
  } finally {
    viewer.close();
  }
}

const IN_PROJECTS = [{ id: 'cg-side', name: 'In side', project: 'cp-side' }, { id: 'cg-lab', name: 'In lab', project: 'cp-lab' }, { id: 'cg-home', name: 'Home' }];
const RUNS = { projects: PROJECTS, routineProjects: { nightly: 'cp-side' } };

test('a routine run in no group moves into a group of its routine\'s project with no card, and a move to Home or another project shows one', async () => {
  for (const source of ['desktop', 'capcom']) {
    const { s, token } = await ready({ sessions: [{ id: 'run', title: 'Nightly', routine: 'nightly', source }], groups: IN_PROJECTS, chips: [], layout: RUNS });
    const moved = [];
    for (const group of ['In side', 'In lab', 'Home']) moved.push(await moveBy(s, token, 'run', { session_id: 'run', group }));
    assert.deepEqual(moved, ['allow', 'card', 'card'], source);
  }
});

test('a routine run the owner nested is in its family\'s project for a move, not its routine\'s', async () => {
  const sessions = [{ id: 'top', title: 'Top', ago: 5 }, { id: 'run', title: 'Nightly', routine: 'nightly' }];
  const { s, token } = await ready({ sessions, groups: IN_PROJECTS, chips: [], layout: { ...RUNS, parents: { run: 'top' } } });
  assert.deepEqual([await moveBy(s, token, 'run', { session_id: 'run', group: 'In side' }), await moveBy(s, token, 'run', { session_id: 'run', group: 'Home' })], ['card', 'allow']);
});

test('a routine run whose parent is archived is listed under Routines again, and is in its routine\'s project for a move', async () => {
  const sessions = [{ id: 'top', title: 'Top', ago: 5, archived: true }, { id: 'run', title: 'Nightly', routine: 'nightly' }];
  const { s, token } = await ready({ sessions, groups: IN_PROJECTS, chips: [], layout: { ...RUNS, parents: { run: 'top' } } });
  assert.deepEqual((await get(s, token, '/api/sessions')).body().routines.map(g => g.latest.id), ['run']);
  assert.deepEqual([await moveBy(s, token, 'run', { session_id: 'run', group: 'In side' }), await moveBy(s, token, 'run', { session_id: 'run', group: 'Home' })], ['allow', 'card']);
});

test('a session GhostShell started that opens with a routine\'s words is in no routine\'s project, so its move into that project shows a card', async () => {
  const { s, token } = await ready({ sessions: [{ id: 'trap', title: '<scheduled-task name="nightly">\nDo it.', source: 'capcom' }], groups: IN_PROJECTS, chips: [], layout: RUNS });
  assert.deepEqual([await moveBy(s, token, 'trap', { session_id: 'trap', group: 'In side' }), await moveBy(s, token, 'trap', { session_id: 'trap', group: 'Home' })], ['card', 'allow']);
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
  assert.equal(await card(WORK, { session_id: 'loose', group: 'Work' }), 'move "Loose" [loose] to "Work" [cg-work] (this group\'s chat can then read it)');
  assert.equal(await card('top', { session_id: 'loose', group: 'Work' }), 'move "Loose" [loose] to "Work" [cg-work]');
  assert.equal(await card('kid', { session_id: 'nobody', group: 'cg-work' }), 'move an unknown session [nobody] to "Work" [cg-work]');
});

test('moving a session with sessions under it into the group of the chat that asks names them on the card and in the reply, archived ones included', async () => {
  const family = [{ id: 'top', title: 'Top', ago: 5 }, { id: 'kid', title: 'Kid', parent: 'top', ago: 4 }, { id: 'old', title: 'Old kid', parent: 'kid', archived: true, ago: 20 }];
  const { s, token } = await ready({ sessions: family, chips: [] });
  const viewer = listen(s, token, WORK);
  try {
    await until(() => viewer.events.length);
    await sendTo(s, token, WORK, `ask to use move_session_to_group ${JSON.stringify({ session_id: 'top', group: 'Work' })}`);
    await until(() => viewer.events.some(e => e.type === 'approval'));
    assert.equal(viewer.events.find(e => e.type === 'approval').data.summary, 'move "Top" [top] to "Work" [cg-work] (this group\'s chat can then read it and the 2 sessions under it)');
  } finally {
    viewer.close();
  }
  const moved = textOf(await callTool(s, token, WORK, 'move_session_to_group', { session_id: 'top', group: 'Work' }));
  assert.match(moved, /The 2 sessions under it moved with it\./);
  assert.match(moved, /can now read it and the 2 sessions under it with read_group_session\.$/);
  const members = (await get(s, token, '/api/sessions')).body().groups.find(g => g.id === 'cg-work');
  assert.ok(members.sessions.some(r => r.id === 'top'));
});

test('find_sessions finds a session by a pull request its transcript names, from the number alone or from a url of the other repo', async () => {
  const link = n => `https://github.com/acme/web/pull/${n}`;
  const { s, token } = await ready({ sessions: [...SESSIONS, { id: 'pr', title: 'Ship uploads', ago: 3, said: [`Opened ${link(7969)}`] }] });
  await until(async () => !(await get(s, token, '/api/pull-links')).body().reading);
  assert.match(textOf(await callTool(s, token, 'top', 'find_sessions', { query: '#7969' })), /- Ship uploads \[pr\] · .* · links acme\/web#7969$/m);
  assert.match(textOf(await callTool(s, token, 'top', 'find_sessions', { query: 'https://github.com/acme/docs/pull/7969' })), /^No session has/);
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
  const writes = [...new Set(WRITES.map(([tool]) => `mcp__capcom__${tool}`))];
  assert.deepEqual(asked.find(list => !list.includes('mcp__capcom__start_group_session')), ['mcp__capcom__send_session', ...writes]);
  assert.deepEqual(asked.find(list => list.includes('mcp__capcom__start_group_session')), ['mcp__capcom__start_group_session', 'mcp__capcom__send_session', ...writes]);
});

const chipFor = (s, taskId) => Object.values(JSON.parse(fs.readFileSync(path.join(s.state, 'chips.json'), 'utf8'))).find(c => c.id === taskId);
const taskIdOf = reply => /task_id: (task_\w+)/.exec(textOf(reply))[1];
const inGroup = async (s, token, group, id) => (await get(s, token, '/api/sessions')).body().groups.find(g => g.id === group).sessions.some(r => r.id === id);

test('a session goes from no project to sitting in a new group in a new project by tools alone, moving itself with no card', async () => {
  const { s, token } = await ready({ layout: {} });
  assert.equal(onDisk(s).projects, undefined);
  const project = textOf(await callTool(s, token, 'top', 'create_project', { name: ' Side  hustle ' }));
  const projectId = /^Created the project "Side hustle" \[(cp-[\w-]+)\]\. It has no groups yet/.exec(project)?.[1];
  assert.ok(projectId, project);
  assert.deepEqual(onDisk(s).projects, [{ id: projectId, name: 'Side hustle' }]);
  const group = textOf(await callTool(s, token, 'top', 'create_group', { name: 'Shiny', project: 'SIDE hustle' }));
  const groupId = /^Created the group "Shiny" \[(cg-[\w-]+)\] in the project "Side hustle"\./.exec(group)?.[1];
  assert.ok(groupId, group);
  const written = onDisk(s).groups.find(g => g.id === groupId);
  assert.deepEqual([written.name, written.project], ['Shiny', projectId]);
  assert.match(textOf(await callTool(s, token, 'top', 'move_session_to_group', { session_id: 'top', group: 'shiny' })), /^Moved "Top" \[top\] to the group "Shiny"/);
  assert.equal(onDisk(s).assignments.top, groupId);
  const index = (await get(s, token, '/api/sessions')).body();
  assert.deepEqual(index.projects.map(p => [p.id, p.name]), [[projectId, 'Side hustle']]);
  assert.equal(index.groups.find(g => g.id === groupId).project, projectId);
  assert.equal(await inGroup(s, token, groupId, 'top'), true);
  const home = textOf(await callTool(s, token, 'top', 'create_group', { name: 'On the home screen' }));
  assert.match(home, /on Home\./);
  assert.equal(onDisk(s).groups.find(g => g.name === 'On the home screen').project, undefined);
});

test('a group moves into a project and back to Home as the route writes it, a group already there is left alone, and a section, a group\'s chat and an unknown project are refused', async () => {
  const { s, token } = await ready();
  const refusedText = async args => {
    const reply = await callTool(s, token, 'top', 'move_group_to_project', args);
    assert.equal(reply.result.isError, true, JSON.stringify(args));
    return textOf(reply);
  };
  assert.equal(textOf(await callTool(s, token, 'top', 'move_group_to_project', { group: ' WORK ', project: 'side' })), 'Moved the group "Work" [cg-work] into the project "Side" [cp-side]. Its sessions moved with it.');
  assert.deepEqual(onDisk(s).groups.map(g => [g.id, g.project]), [['cg-work', 'cp-side'], ['cg-home', undefined]]);
  assert.equal((await get(s, token, '/api/sessions')).body().groups.find(g => g.id === 'cg-work').project, 'cp-side');
  const before = fs.readFileSync(s.layout, 'utf8');
  assert.equal(textOf(await callTool(s, token, 'top', 'move_group_to_project', { group: 'cg-work', project: 'Side' })), 'The group "Work" [cg-work] is already in the project "Side" [cp-side]. Nothing changed.');
  assert.equal(textOf(await callTool(s, token, 'top', 'move_group_to_project', { group: 'home' })), 'The group "Home" [cg-home] is already on Home. Nothing changed.');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'nothing was written');
  assert.match(await refusedText({ group: 'Pinned', project: 'side' }), /^"Pinned" \[pinned\] is a section of Home, not a group, so it cannot move into a project\.$/);
  assert.equal(await refusedText({ group: WORK, project: 'side' }), 'move_group_to_project has no group called "' + WORK + '". The groups are "Work", "Home".');
  assert.equal(await refusedText({ group: 'work', project: 'Nowhere' }), 'move_group_to_project has no project called "Nowhere". The projects are "Side", "Lab".');
  assert.equal(await refusedText({ group: 'work', project: 5 }), 'Give the project as its name or its id.');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'nothing was written');
  assert.match(textOf(await callTool(s, token, 'top', 'move_group_to_project', { group: 'Work', project: null })), /^Moved the group "Work" \[cg-work\] to Home\./);
  assert.equal(onDisk(s).groups.find(g => g.id === 'cg-work').project, undefined, 'back at the top level as the route leaves it');
  assert.equal((await post(s, token, '/api/layout/group/move', { id: 'cg-work', project: 'cp-gone' })).status, 404, 'the route\'s own refusal');
});

test('a project moves before or after another as the route writes it, one already there is left alone, and the refusals list the names', async () => {
  const { s, token } = await ready({ layout: { projects: [{ id: 'cp-a', name: 'Alpha' }, { id: 'cp-b', name: 'Beta' }, { id: 'cp-c', name: 'Gamma' }] } });
  const order = () => onDisk(s).projects.map(p => p.id);
  const run = async args => textOf(await callTool(s, token, 'top', 'move_project', args));
  assert.equal(await run({ project: ' GAMMA ', before: 'alpha' }), 'Moved the project "Gamma" [cp-c] before "Alpha" [cp-a].');
  assert.deepEqual(order(), ['cp-c', 'cp-a', 'cp-b']);
  assert.deepEqual((await get(s, token, '/api/sessions')).body().projects.map(p => p.id), ['cp-c', 'cp-a', 'cp-b'], 'the server\'s own list agrees with the file');
  assert.equal(await run({ project: 'cp-c', after: 'Beta' }), 'Moved the project "Gamma" [cp-c] after "Beta" [cp-b].');
  assert.deepEqual(order(), ['cp-a', 'cp-b', 'cp-c']);
  const before = fs.readFileSync(s.layout, 'utf8');
  assert.equal(await run({ project: 'Beta', after: 'Alpha' }), 'The project "Beta" [cp-b] is already after "Alpha" [cp-a]. Nothing changed.');
  assert.equal(await run({ project: 'Beta', before: 'Gamma' }), 'The project "Beta" [cp-b] is already before "Gamma" [cp-c]. Nothing changed.');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'nothing was written');
  const refusedText = async args => {
    const reply = await callTool(s, token, 'top', 'move_project', args);
    assert.equal(reply.result.isError, true, JSON.stringify(args));
    return textOf(reply);
  };
  assert.equal(await refusedText({ project: 'Delta', after: 'alpha' }), 'move_project has no project called "Delta". The projects are "Alpha", "Beta", "Gamma".');
  assert.equal(await refusedText({ project: 'alpha', after: 'Delta' }), 'move_project has no project called "Delta". The projects are "Alpha", "Beta", "Gamma".');
  assert.equal(await refusedText({ project: 'alpha', after: 'alpha' }), 'The project "Alpha" [cp-a] cannot go after itself.');
  assert.equal(await refusedText({ project: 'alpha' }), 'Give exactly one of before or after: the project to put it before or after.');
  assert.equal(await refusedText({ project: 'alpha', before: 'beta', after: 'gamma' }), 'Give exactly one of before or after: the project to put it before or after.');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'nothing was written');
  const twins = await ready({ layout: { projects: [{ id: 'cp-1', name: 'Work' }, { id: 'cp-2', name: 'work' }, { id: 'cp-3', name: 'Other' }] } });
  const reply = await callTool(twins.s, twins.token, 'top', 'move_project', { project: 'WORK', after: 'other' });
  assert.equal(textOf(reply), 'move_project project "WORK" matches 2 projects, so it is ambiguous. Use the id of one of them instead: cp-1, cp-2.');
});

test('spawn_task\'s group and move_session_to_group find a group inside a project as they find one on Home, by name and by id, and a chip starts its session there', async () => {
  const layout = { projects: [{ id: 'cp-p', name: 'Proj' }] };
  const groups = [...GROUPS, { id: 'cg-in', name: 'Inside', project: 'cp-p' }, { id: 'cg-in2', name: 'Also inside', project: 'cp-p' }];
  const { s, token } = await ready({ layout, groups });
  const targets = [['inside', 'cg-in'], ['cg-in', 'cg-in'], ['ALSO  inside', 'cg-in2'], ['cg-in2', 'cg-in2'], ['home', 'cg-home'], ['cg-home', 'cg-home']];
  for (const [given, id] of targets) {
    const made = await callTool(s, token, 'top', 'spawn_task', { title: `Into ${given}`, prompt: 'begin a session', group: given });
    assert.notEqual(made.result.isError, true, textOf(made));
    const chip = chipFor(s, taskIdOf(made));
    assert.equal(chip.group, id, `${given} on the chip`);
    const started = await request(s, 'POST', '/api/chips/start', { headers: as(token), json: { sessionId: 'top', toolUseId: chip.toolUseId } });
    assert.equal(started.status, 200, started.text);
    const newId = started.body().id;
    assert.deepEqual([onDisk(s).assignments[newId], onDisk(s).parents[newId]], [id, null], `${given} where the session landed`);
    assert.equal(await inGroup(s, token, id, newId), true, `${given} in the list`);
    const moved = await callTool(s, token, 'top', 'move_session_to_group', { session_id: 'loose', group: given });
    assert.match(textOf(moved), /^Moved "Loose" \[loose\] to the group /, `${given} move`);
    assert.equal(onDisk(s).assignments.loose, id, `${given} move landed`);
  }
});

test('a name or project already in use is refused with the id, in any case and with extra spaces, and layout.json is left as it was, though the sidebar\'s own route still allows a twin', async () => {
  const layout = { projects: [{ id: 'cp-p', name: 'Proj' }] };
  const groups = [...GROUPS, { id: 'cg-in', name: 'Inside', project: 'cp-p' }];
  const { s, token } = await ready({ layout, groups });
  const before = fs.readFileSync(s.layout, 'utf8');
  const refusedText = async (tool, args) => {
    const reply = await callTool(s, token, 'top', tool, args);
    assert.equal(reply.result.isError, true, `${tool} ${JSON.stringify(args)}`);
    return textOf(reply);
  };
  assert.equal(await refusedText('create_project', { name: '  PROJ ' }), 'There is already a project called "Proj" [cp-p]. Nothing changed.');
  assert.equal(await refusedText('create_group', { name: ' inside' }), 'There is already a group called "Inside" [cg-in]. Nothing changed.', 'a group in a project blocks one for Home');
  assert.equal(await refusedText('create_group', { name: 'HOME', project: 'proj' }), 'There is already a group called "Home" [cg-home]. Nothing changed.', 'a group on Home blocks one for a project');
  assert.match(await refusedText('create_group', { name: 'New', project: 'Nowhere' }), /^create_group has no project called "Nowhere"\. The projects are "Proj"\.$/);
  assert.equal(await refusedText('create_project', { name: '  ' }), 'Give it a name.');
  assert.equal(await refusedText('create_group', { name: 'x'.repeat(81) }), 'Names run to 80 characters at most.');
  assert.equal(await refusedText('create_group', { name: 'New', project: 'cp-gone' }), 'create_group has no project called "cp-gone". The projects are "Proj".');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'nothing was written');
  assert.match(textOf(await callTool(s, token, 'top', 'create_group', { name: 'Proj', project: 'Proj' })), /^Created the group "Proj"/, 'a group may share a project\'s name');
  assert.equal((await post(s, token, '/api/layout/group/add', { name: 'Inside' })).status, 200, 'the owner may still make a twin');
});

// A signed-in server whose routines.json holds two made-up routines, which the tool and the route both look up.
async function withRoutines() {
  const first = await start({ sessions: SESSIONS, groups: GROUPS, chips: CHIPS, claude: true, layout: { projects: PROJECTS } });
  const work = path.join(first.home, 'work');
  const file = path.join(first.home, 'desktop', 'daily-digest', 'SKILL.md');
  fs.mkdirSync(work);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '---\nname: daily-digest\ndescription: A made-up routine\n---\n\nSummarise the board.\n');
  const routine = (id, title) => ({ id, title, cron: '30 7 * * 1-5', jitterSeconds: 0, file, cwd: work, model: null, effort: null, mode: null, enabled: false });
  fs.writeFileSync(path.join(first.state, 'routines.json'), JSON.stringify({ routines: [routine('daily-digest', 'Daily digest'), routine('weekly-recap', 'Weekly recap')] }));
  const s = await restart(first);
  return { s, ...(await signIn(s)) };
}

test('a routine moves into a project and back to Home by the tool, as the route writes it, and the page is told the project', async () => {
  const { s, token } = await withRoutines();
  const run = async args => textOf(await callTool(s, token, 'top', 'move_routine_to_project', args));
  const index = async () => (await get(s, token, '/api/sessions')).body();
  assert.equal((await index()).features.routineProjects, true);
  assert.equal(await run({ routine: ' DAILY digest ', project: 'side' }), 'Moved the routine "Daily digest" [daily-digest] into the project "Side" [cp-side]. Its runs moved with it.');
  assert.deepEqual(onDisk(s).routineProjects, { 'daily-digest': 'cp-side' });
  assert.deepEqual((await index()).routineProjects, { 'daily-digest': 'cp-side' });
  const before = fs.readFileSync(s.layout, 'utf8');
  assert.equal(await run({ routine: 'daily-digest', project: 'Side' }), 'The routine "Daily digest" [daily-digest] is already in the project "Side" [cp-side]. Nothing changed.');
  assert.equal(await run({ routine: 'weekly-recap' }), 'The routine "Weekly recap" [weekly-recap] is already on Home. Nothing changed.');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'nothing was written');
  const refused = async args => {
    const reply = await callTool(s, token, 'top', 'move_routine_to_project', args);
    assert.equal(reply.result.isError, true, JSON.stringify(args));
    return textOf(reply);
  };
  assert.equal(await refused({ routine: 'Nightly', project: 'side' }), 'move_routine_to_project has no routine called "Nightly". The routines are "Daily digest", "Weekly recap".');
  assert.equal(await refused({ routine: 'daily-digest', project: 'Nowhere' }), 'move_routine_to_project has no project called "Nowhere". The projects are "Side", "Lab".');
  assert.equal(await refused({ project: 'side' }), 'Give the routine as routine, by its title as the routines list shows it or by its id.');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'nothing was written');
  assert.match(await run({ routine: 'Daily digest', project: null }), /^Moved the routine "Daily digest" \[daily-digest\] to Home\./);
  assert.equal(onDisk(s).routineProjects, undefined, 'the last link takes the map out of the file');
  assert.equal(fs.existsSync(path.join(s.state, 'routines.json')) && JSON.parse(fs.readFileSync(path.join(s.state, 'routines.json'), 'utf8')).routines.every(r => !('project' in r)), true, 'the routines file is never written by the tool');
});

test('the routine route is a signed-in POST that refuses an unknown project or routine, clears a link for a routine that is gone, and a project delete sends its routines to Home', async () => {
  const { s, token } = await withRoutines();
  const move = body => post(s, token, '/api/layout/routine/move', body);
  assert.equal((await request(s, 'POST', '/api/layout/routine/move', { json: { id: 'daily-digest', project: 'cp-side' } })).status, 401, 'signed out');
  assert.equal((await get(s, token, '/api/layout/routine/move')).status, 404, 'GET is not a route');
  assert.equal((await move({ id: 'daily-digest', project: 'cp-none' })).status, 404);
  assert.equal((await move({ id: 'no-such-routine', project: 'cp-side' })).status, 404);
  assert.equal(onDisk(s).routineProjects, undefined, 'a refusal writes nothing');
  assert.equal((await move({ id: 'daily-digest', project: 'cp-side' })).status, 200);
  assert.equal((await move({ id: 'weekly-recap', project: 'cp-lab' })).status, 200);
  assert.deepEqual(onDisk(s).routineProjects, { 'daily-digest': 'cp-side', 'weekly-recap': 'cp-lab' });
  assert.equal((await post(s, token, '/api/layout/project/remove', { id: 'cp-side' })).status, 200);
  assert.deepEqual(onDisk(s).routineProjects, { 'weekly-recap': 'cp-lab' });
  assert.deepEqual((await get(s, token, '/api/sessions')).body().routineProjects, { 'weekly-recap': 'cp-lab' });
  assert.equal((await move({ id: 'weekly-recap', project: null })).status, 200);
  assert.equal(onDisk(s).routineProjects, undefined);
  assert.equal((await move({ id: 'long-gone', project: null })).status, 200, 'a link left by a deleted routine can still be cleared');
});

// The owner's setting for how far send_session goes with no card. Alpha and Beta are in different projects, and Me, Mate and the chat of Alpha are in Alpha.
const ALPHA = '5c2e8a41-7d3b-4e6f-8a90-1b2c3d4e5f60';
const REACH_GROUPS = [{ id: 'cg-alpha', name: 'Alpha', project: 'cp-side', session: ALPHA }, { id: 'cg-beta', name: 'Beta', project: 'cp-lab' }];
const REACH_SESSIONS = [
  { id: 'me', title: 'Me', group: 'cg-alpha', ago: 5 }, { id: 'mate', title: 'Mate', group: 'cg-alpha', ago: 6 }, { id: 'far', title: 'Far', group: 'cg-beta', ago: 7 },
  { id: 'nest', title: 'Nest', ago: 8 }, { id: 'gone', title: 'Gone', group: 'cg-alpha', archived: true, ago: 20 }, { id: 'kid', title: 'Kid', parent: 'me', group: 'cg-alpha', ago: 4 },
];
const reachReady = async mine => ready({ sessions: REACH_SESSIONS, groups: REACH_GROUPS, chips: [], ...mine });
const settings = (s, token, json, headers = { origin: s.origin }) => request(s, 'POST', '/api/settings', { headers: { ...as(token), ...headers }, json });
const setReach = async (s, token, sendReach) => assert.equal((await settings(s, token, { sendReach })).status, 200);
const sendPerms = s => cliCalls(s).filter(c => c.requestId === 'perm-send_session');
const reachFile = s => path.join(s.state, 'send-reach.json');
const counts = s => (fs.existsSync(reachFile(s)) ? JSON.parse(fs.readFileSync(reachFile(s), 'utf8')).sent : {});
// Asks as `from` to send to `to`, as an owner message does, and says whether it went with no card ('free') or was queued behind one ('card').
async function askSend(s, token, from, to, extra = {}) {
  const had = sendPerms(s).length;
  await sendTo(s, token, from, `ask to use send_session ${JSON.stringify({ session_id: to, message: 'hello', ...extra })}`);
  await until(() => sendPerms(s).length > had);
  return sendPerms(s).at(-1).response === 'allow' ? 'free' : 'card';
}
const delivered = s => cliCalls(s).filter(c => typeof c.user === 'string' && c.user.startsWith('<session-message'));

test('the settings route gives family until it is set, sets any of the three, refuses anything else, and a read never writes', async () => {
  const { s, token } = await reachReady();
  assert.deepEqual((await get(s, token, '/api/settings')).body(), { sendReach: 'family' });
  assert.equal((await get(s, token, '/api/sessions')).body().features.sendReach, true);
  assert.equal(fs.existsSync(reachFile(s)), false, 'reading writes nothing');
  for (const bad of ['', 'ANY', 'all', 5, null, ['any'], { a: 1 }, true]) assert.equal((await settings(s, token, { sendReach: bad })).status, 400, JSON.stringify(bad));
  assert.equal((await settings(s, token, {})).status, 400);
  assert.equal(fs.existsSync(reachFile(s)), false, 'a refused value writes nothing');
  for (const value of ['any', 'project', 'family']) {
    const set = await settings(s, token, { sendReach: value });
    assert.deepEqual([set.status, set.body()], [200, { sendReach: value }]);
    assert.deepEqual((await get(s, token, '/api/settings')).body(), { sendReach: value });
  }
  assert.equal(fs.statSync(reachFile(s)).mode & 0o777, 0o600);
  assert.equal((await post(s, token, '/api/settings/x', { sendReach: 'any' })).status, 404);
  for (const method of ['PUT', 'DELETE']) assert.equal((await request(s, method, '/api/settings', { headers: { ...as(token), origin: s.origin }, json: { sendReach: 'any' } })).status, 404, method);
});

test('the settings route refuses a write with no Origin, another origin or a cross-site fetch, and any request that is signed out, and none of them changes the setting', async () => {
  const { s, token } = await reachReady();
  await setReach(s, token, 'project');
  for (const headers of [{}, { origin: 'http://elsewhere.test' }, { origin: s.origin, 'sec-fetch-site': 'cross-site' }, { origin: s.origin, 'sec-fetch-site': 'same-site' }]) {
    assert.equal((await settings(s, token, { sendReach: 'any' }, headers)).status, 403, JSON.stringify(headers));
  }
  assert.equal((await request(s, 'POST', '/api/settings', { headers: { origin: s.origin }, json: { sendReach: 'any' } })).status, 401);
  assert.equal((await request(s, 'GET', '/api/settings')).status, 401);
  assert.deepEqual((await get(s, token, '/api/settings')).body(), { sendReach: 'project' });
});

test('the setting survives a restart, and a corrupt file is moved aside and reads as family', async () => {
  const first = await reachReady();
  await setReach(first.s, first.token, 'any');
  const again = await restart(first.s);
  const { token } = await signIn(again);
  assert.deepEqual((await get(again, token, '/api/settings')).body(), { sendReach: 'any' });
  fs.writeFileSync(reachFile(again), 'not json');
  const third = await restart(again);
  const signed = await signIn(third);
  assert.deepEqual((await get(third, signed.token, '/api/settings')).body(), { sendReach: 'family' });
  assert.equal(fs.readdirSync(third.state).some(n => n.startsWith('send-reach.json.bad-')), true);
});

test('by default every send outside the family asks, one within it goes, and an approved card delivers and counts for nothing', async () => {
  const { s, token } = await reachReady();
  assert.equal(await askSend(s, token, 'me', 'kid'), 'free', 'a sub session');
  for (const to of ['mate', 'far', 'nest', ALPHA]) assert.equal(await askSend(s, token, 'me', to), 'card', to);
  assert.equal(fs.existsSync(reachFile(s)), false, 'nothing was counted');
  assert.equal((await post(s, token, '/api/sessions/me/approve', { requestId: 'perm-send_session', decision: 'allow' })).status, 200);
  await until(() => delivered(s).length === 1);
  assert.equal(fs.existsSync(reachFile(s)), false, 'an approved card is not counted');
});

test('on project a send goes with no card to the same project, its group\'s chat included, and Home, another project, a section\'s chat and an archived session ask, whatever the input says', async () => {
  const { s, token } = await reachReady();
  await setReach(s, token, 'project');
  const pinned = (await post(s, token, '/api/groups/pinned/session')).body().id;
  assert.equal(await askSend(s, token, 'me', 'mate'), 'free');
  assert.equal(await askSend(s, token, 'me', ALPHA), 'free', 'the chat of Alpha, which is in its project');
  const spoof = { project: 'cp-side', group: 'cg-alpha', sendReach: 'any', reach: 'any', family: true };
  for (const to of ['far', 'nest', pinned, 'gone']) assert.equal(await askSend(s, token, 'me', to, spoof), 'card', to);
  assert.equal(await askSend(s, token, 'nest', 'me'), 'card', 'Home to a project');
  assert.equal(await askSend(s, token, 'far', 'mate'), 'card', 'one project to another');
});

test('on any a send from an ordinary chat goes with no card to any session that is not archived, and a group\'s or section\'s chat still asks for every send', async () => {
  const { s, token } = await reachReady();
  await setReach(s, token, 'any');
  const pinned = (await post(s, token, '/api/groups/pinned/session')).body().id;
  for (const to of ['mate', 'far', 'nest', ALPHA, pinned]) assert.equal(await askSend(s, token, 'me', to), 'free', to);
  assert.equal(await askSend(s, token, 'me', 'gone'), 'card', 'archived');
  assert.equal(await askSend(s, token, 'me', 'me'), 'card', 'itself');
  assert.equal(await askSend(s, token, 'me', 'nobody'), 'card', 'not a session');
  for (const from of [ALPHA, pinned]) for (const to of ['mate', 'far', 'kid']) assert.equal(await askSend(s, token, from, to), 'card', `${from} to ${to}`);
});

test('under any a rename, a move, an archive and an unarchive outside the tree still show a card, and the layout is untouched', async () => {
  const { s, token } = await reachReady();
  await setReach(s, token, 'any');
  const before = fs.readFileSync(s.layout, 'utf8');
  const viewer = listen(s, token, 'me');
  try {
    await until(() => viewer.events.length);
    for (const [tool, input] of [['set_session_title', { session_id: 'far', title: 'x' }], ['move_session_to_group', { session_id: 'far', group: 'cg-alpha' }], ['archive_session', { session_id: 'far' }], ['unarchive_session', { session_id: 'gone' }]]) {
      const had = viewer.events.filter(e => e.type === 'approval').length;
      await sendTo(s, token, 'me', `ask to use ${tool} ${JSON.stringify(input)}`);
      await until(() => viewer.events.filter(e => e.type === 'approval').length > had);
      assert.equal(viewer.events.filter(e => e.type === 'approval').at(-1).data.tool, `mcp__capcom__${tool}`);
    }
  } finally {
    viewer.close();
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('going back to family applies to the next send with no restart', async () => {
  const { s, token } = await reachReady();
  await setReach(s, token, 'any');
  assert.equal(await askSend(s, token, 'me', 'far'), 'free');
  await setReach(s, token, 'family');
  assert.equal(await askSend(s, token, 'me', 'far'), 'card');
  await setReach(s, token, 'any');
  assert.equal(await askSend(s, token, 'me', 'far'), 'free');
});

test('a send with no card counts for its sender and is persisted, and only the owner\'s own message to that session clears it, not a peer\'s message, an approved card or the owner writing elsewhere', async () => {
  const { s, token } = await reachReady();
  await setReach(s, token, 'any');
  assert.equal(await askSend(s, token, 'me', 'far'), 'free');
  assert.equal(await askSend(s, token, 'far', 'mate'), 'free');
  assert.deepEqual(counts(s), { me: 1, far: 1 }, 'each send counts for its own sender');
  assert.match(textOf(await callTool(s, token, 'nest', 'send_session', { session_id: 'me', message: 'Peer.' })), /^(Delivered|Queued)/);
  await until(() => delivered(s).length === 1);
  assert.deepEqual(counts(s), { me: 1, far: 1 }, 'a peer message to me cleared nothing');
  await setReach(s, token, 'family');
  assert.equal(await askSend(s, token, 'nest', 'me'), 'card');
  assert.equal((await post(s, token, '/api/sessions/nest/approve', { requestId: 'perm-send_session', decision: 'allow' })).status, 200);
  assert.deepEqual(counts(s), { me: 1, far: 1 }, 'an approved card to me cleared nothing');
  await sendTo(s, token, 'mate', 'begin a session');
  assert.deepEqual(counts(s), { me: 1, far: 1 }, 'the owner writing to another session cleared nothing');
  const again = await restart(s);
  assert.deepEqual(counts(again), { me: 1, far: 1 }, 'a restart keeps the counts');
  const signed = await signIn(again);
  await sendTo(again, signed.token, 'me', 'finish the turn');
  assert.deepEqual(counts(again), { far: 1 }, 'the owner\'s message to me cleared its count and no one else\'s');
});

test('a session already at the limit goes free again once the owner writes to it, which is the reset the limit relies on', async () => {
  const { s, token } = await reachReady();
  await setReach(s, token, 'any');
  fs.writeFileSync(reachFile(s), JSON.stringify({ reach: 'any', sent: { me: 10, far: 10 } }));
  const again = await restart(s);
  const signed = await signIn(again);
  assert.equal(await askSend(again, signed.token, 'me', 'mate'), 'free', 'the owner\'s message that asked cleared its 10');
  assert.deepEqual(counts(again), { me: 1, far: 10 }, 'another session\'s count is its own');
});

test('the owner\'s message route is the only place that clears a sender\'s count', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');
  assert.equal(source.match(/sendReach\.ownerSpoke\(/g).length, 1);
  assert.match(source, /if \(row\.groupSession\) groupUpdates\.ownerSpoke\(id\);\n\s*sendReach\.ownerSpoke\(id\);/);
});
