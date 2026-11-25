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
  ['nest_session', { session_id: 'loose', parent: 'member' }, [
    'nest "Loose" [loose] under "Member" [member]',
    '"Member" [member] can then read it.',
    'It and "Member" [member] can then message, rename, move and take out one another with no card.',
    'It shows under "Member" [member] in the group "Work" [cg-work].',
    (id) => (id === WORK ? 'This group\'s chat can then read it.' : 'The chat of the group "Work" [cg-work] can then read it.'),
    'Archiving "Member" [member] archives it.',
  ]],
  ['unnest_session', { session_id: 'loose' }, 'take "Loose" [loose] out from under its parent'],
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
  for (const name of ['list_chips', 'find_sessions', 'archive_session', 'unarchive_session', 'set_session_title', 'move_session_to_group', 'nest_session', 'unnest_session', 'create_project', 'create_group', 'move_group_to_project', 'move_project', 'move_routine_to_project', 'send_session']) assert.ok(listed.includes(name), name);
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
          assert.deepEqual([card.tool, card.always, card.summary], [`mcp__capcom__${tool}`, false, Array.isArray(summary) ? summary.map(line => (typeof line === 'function' ? line(id) : line)).join('\n') : summary], `${id} ${tool}`);
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

// Nesting: a card the owner approves for one tool use id, then the call that carries that id. The fake CLI raises `ask to use as <id>` as the can_use_tool request and `call as <id>` as the tool call.
const FAMILY = [
  { id: 'top', title: 'Top', ago: 5 },
  { id: 'boss', title: 'Boss', ago: 6 },
  { id: 'loose', title: 'Loose', ago: 8 },
  { id: 'other', title: 'Other', ago: 9 },
  { id: 'gone', title: 'Gone', archived: true, ago: 20 },
  { id: 'member', title: 'Member', group: 'cg-work', ago: 6 },
];
const readyNest = mine => ready({ sessions: FAMILY, chips: [], ...mine });
const answersTo = (s, requestId) => cliCalls(s).filter(c => c.requestId === requestId);
// Asks to use a tool as the call `useId` and answers with the card it raised, or with the CLI's answer when it went with no card.
async function askAs(s, token, id, useId, tool, input) {
  const requestId = `perm-${useId}`;
  const viewer = listen(s, token, id);
  try {
    await until(() => viewer.events.length);
    const had = answersTo(s, requestId).length;
    await sendTo(s, token, id, `ask to use as ${useId} ${tool} ${JSON.stringify(input)}`);
    const card = () => viewer.events.find(e => e.type === 'approval' && e.data.requestId === requestId)?.data;
    await until(() => card() || answersTo(s, requestId).length > had);
    return card() ? { card: card() } : { answer: answersTo(s, requestId).at(-1).response };
  } finally {
    viewer.close();
  }
}
const decide = async (s, token, id, useId, decision) => {
  const had = answersTo(s, `perm-${useId}`).length;
  assert.equal((await post(s, token, `/api/sessions/${id}/approve`, { requestId: `perm-${useId}`, decision })).status, 200);
  await until(() => answersTo(s, `perm-${useId}`).length > had);
  return answersTo(s, `perm-${useId}`).at(-1);
};
async function callAs(s, token, id, useId, tool, args) {
  const before = replies(s).length;
  await sendTo(s, token, id, `call as ${useId} ${tool} ${JSON.stringify(args)}`);
  await until(() => replies(s).length > before);
  return replies(s)[before];
}
const NEST = { session_id: 'loose', parent: 'member' };
const refusedAs = (reply, text) => {
  assert.equal(reply.result.isError, true, textOf(reply));
  assert.match(textOf(reply), text);
};

test('a nest shows a card of what it grants, writes nothing until the owner approves, and then writes once, for that call', async () => {
  const { s, token } = await readyNest();
  const before = fs.readFileSync(s.layout, 'utf8');
  const { card } = await askAs(s, token, 'top', 'use-1', 'nest_session', NEST);
  assert.deepEqual([card.tool, card.always], ['mcp__capcom__nest_session', false]);
  assert.deepEqual(card.summary.split('\n'), [
    'nest "Loose" [loose] under "Member" [member]',
    '"Member" [member] can then read it.',
    'It and "Member" [member] can then message, rename, move and take out one another with no card.',
    'It shows under "Member" [member] in the group "Work" [cg-work].',
    'The chat of the group "Work" [cg-work] can then read it.',
    'Archiving "Member" [member] archives it.',
  ]);
  assert.equal(JSON.stringify(card).includes('"key"'), false, 'the page is given no key');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'a card writes nothing');
  refusedAs(await callAs(s, token, 'top', 'use-1', 'nest_session', NEST), /^The owner has not approved this nest\. Nothing changed\.$/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'a call before the owner decides writes nothing');
  assert.equal((await decide(s, token, 'top', 'use-1', 'allow')).response, 'allow');
  const done = await callAs(s, token, 'top', 'use-1', 'nest_session', NEST);
  assert.equal(textOf(done), 'Nested "Loose" [loose] under "Member" [member]. It now shows in the group "Work" [cg-work].');
  assert.equal(onDisk(s).parents.loose, 'member');
  const after = fs.readFileSync(s.layout, 'utf8');
  assert.equal(textOf(await callAs(s, token, 'top', 'use-1', 'nest_session', NEST)), '"Loose" [loose] is already nested under "Member" [member]. Nothing changed.');
  assert.equal((await post(s, token, '/api/layout/nest', { id: 'loose', parent: null })).status, 200);
  const out = fs.readFileSync(s.layout, 'utf8');
  refusedAs(await callAs(s, token, 'top', 'use-1', 'nest_session', NEST), /^The owner has not approved this nest\. Nothing changed\.$/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), out, 'a replay after a move out writes nothing and needs a new card');
});

// A call with no card to approve: the CLI is answered at once, the call then says why, and layout.json is as it was.
async function refusedNest(s, token, id, useId, input, text) {
  const before = fs.readFileSync(s.layout, 'utf8');
  const asked = await askAs(s, token, id, useId, 'nest_session', input);
  assert.equal(asked.card, undefined, `no card for ${JSON.stringify(input)}`);
  assert.equal(asked.answer, 'allow');
  const reply = await callAs(s, token, id, useId, 'nest_session', input);
  refusedAs(reply, text);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, `${JSON.stringify(input)} wrote nothing`);
}

test('every nest the sidebar refuses is refused by the tool with no card and nothing written, a group\'s or section\'s chat or an archived session on either side included', async () => {
  const sessions = [...FAMILY, { id: 'kid', title: 'Kid', parent: 'boss', ago: 4 }, { id: 'run', title: 'Nightly', routine: 'nightly', ago: 3 }];
  const { s, token } = await readyNest({ sessions, layout: { projects: PROJECTS, routineProjects: { nightly: 'cp-side' } } });
  const cases = [
    [{ session_id: 'loose', parent: 'loose' }, /^A session cannot nest under itself or its own child\.$/],
    [{ session_id: 'boss', parent: 'kid' }, /^A session cannot nest under itself or its own child\.$/],
    [{ session_id: 'loose', parent: 'gone' }, /^That session is archived\.$/],
    [{ session_id: 'gone', parent: 'boss' }, /^That session is archived\. Unarchive it first\.$/],
    [{ session_id: 'loose', parent: WORK }, /^A group's session cannot hold sessions\.$/],
    [{ session_id: WORK, parent: 'boss' }, /^A group's session stays with its group\.$/],
    [{ session_id: 'loose', parent: 'run' }, /^A routine run cannot hold sessions\.$/],
    [{ session_id: 'loose', parent: 'nobody' }, /^No session with that id on this Mac\.$/],
    [{ session_id: 'nobody', parent: 'boss' }, /^No session with that id on this Mac\.$/],
  ];
  for (const [i, [input, text]] of cases.entries()) await refusedNest(s, token, 'top', `refuse-${i}`, input, text);
  const pinned = (await post(s, token, '/api/groups/pinned/session')).body().id;
  await refusedNest(s, token, 'top', 'refuse-section', { session_id: 'loose', parent: pinned }, /^A section's session cannot hold sessions\.$/);
  await refusedNest(s, token, 'top', 'refuse-section-2', { session_id: pinned, parent: 'boss' }, /^A section's session stays with its section\.$/);
});

test('a nest with a bad session_id or parent is refused with no card, and a missing parent is never read as a take out', async () => {
  const { s, token } = await readyNest({ sessions: [...FAMILY, { id: 'kid', title: 'Kid', parent: 'boss', ago: 4 }] });
  const parentText = /^Give the id of the session to nest it under as parent\. unnest_session takes a session out from under another\.$/;
  const idText = /^Give the id of the session as session_id\.$/;
  const bad = [undefined, null, '', '   ', ['boss'], { toString: 'boss' }, 5, true];
  for (const [i, parent] of bad.entries()) await refusedNest(s, token, 'top', `parent-${i}`, { session_id: 'kid', parent }, parentText);
  for (const [i, session_id] of bad.entries()) await refusedNest(s, token, 'top', `id-${i}`, { session_id, parent: 'boss' }, idText);
  for (const [i, input] of [{}, { session_id: 'kid' }, { parent: 'boss' }].entries()) await refusedNest(s, token, 'top', `missing-${i}`, input, /^Give the id of the session/);
  for (const [i, id] of ['__proto__', 'constructor', 'a b', 'x'.repeat(5000), 'boss/../kid'].entries()) {
    await refusedNest(s, token, 'top', `odd-parent-${i}`, { session_id: 'kid', parent: id }, /^No session with that id on this Mac\.$/);
    await refusedNest(s, token, 'top', `odd-id-${i}`, { session_id: id, parent: 'boss' }, /^No session with that id on this Mac\.$/);
  }
  assert.equal(onDisk(s).parents?.kid, undefined, 'kid was never taken out or moved');
});

test('nesting a session that is nested already under that parent, or a sibling of it, is answered with nothing written and no card', async () => {
  const { s, token } = await readyNest({ sessions: [...FAMILY, { id: 'kid', title: 'Kid', parent: 'boss', ago: 4 }, { id: 'twin', title: 'Twin', parent: 'boss', ago: 4 }] });
  const before = fs.readFileSync(s.layout, 'utf8');
  for (const [i, parent] of ['boss', 'twin'].entries()) {
    const input = { session_id: 'kid', parent };
    assert.equal((await askAs(s, token, 'top', `same-${i}`, 'nest_session', input)).answer, 'allow');
    assert.equal(textOf(await callAs(s, token, 'top', `same-${i}`, 'nest_session', input)), '"Kid" [kid] is already nested under "Boss" [boss]. Nothing changed.');
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

// Each is a change the owner or another session makes while the card waits, as the routes make it.
const WHILE_WAITING = [
  ['the parent is nested under another session', s => ({ route: '/api/layout/nest', body: { id: 'member', parent: 'other' } })],
  ['the parent moves to another group', () => ({ route: '/api/layout/move', body: { id: 'member', group: 'cg-home' } })],
  ['the parent is archived', () => ({ route: '/api/layout/archive', body: { id: 'member', archived: true } })],
  ['the session gains a sub session', () => ({ route: '/api/layout/nest', body: { id: 'other', parent: 'loose' } })],
  ['the parent\'s group moves to another project', () => ({ route: '/api/layout/group/move', body: { id: 'cg-work', project: 'cp-side' } })],
  ['the session itself is nested under another', () => ({ route: '/api/layout/nest', body: { id: 'loose', parent: 'boss' } })],
];

test('a nest whose plan changes while the card waits is refused when the call comes, with nothing written, and a retitle alone does not refuse it', async () => {
  for (const [what, change] of WHILE_WAITING) {
    const { s, token } = await readyNest();
    const { card } = await askAs(s, token, 'top', 'use-1', 'nest_session', NEST);
    assert.ok(card, what);
    const { route, body } = change();
    assert.equal((await post(s, token, route, body)).status, 200, what);
    await decide(s, token, 'top', 'use-1', 'allow');
    const during = fs.readFileSync(s.layout, 'utf8');
    const reply = await callAs(s, token, 'top', 'use-1', 'nest_session', NEST);
    assert.equal(reply.result.isError, true, `${what}: ${textOf(reply)}`);
    assert.match(textOf(reply), /^(What the approval card showed has changed since\. Nothing changed\. Call nest_session again to ask the owner\.|That session is archived\.)$/, what);
    assert.equal(fs.readFileSync(s.layout, 'utf8'), during, `${what}: nothing was written`);
  }
  const { s, token } = await readyNest();
  await askAs(s, token, 'top', 'use-1', 'nest_session', NEST);
  assert.equal((await post(s, token, '/api/layout/rename', { id: 'member', title: 'Renamed while waiting' })).status, 200);
  await decide(s, token, 'top', 'use-1', 'allow');
  assert.match(textOf(await callAs(s, token, 'top', 'use-1', 'nest_session', NEST)), /^Nested "Loose" \[loose\] under "Renamed while waiting" \[member\]\./);
});

test('an approval belongs to one call: another tool use id, other arguments, a denied card or a chat that was not asked cannot use it, and a refused call spends it', async () => {
  const { s, token } = await readyNest();
  const other = { session_id: 'other', parent: 'member' };
  await askAs(s, token, 'top', 'use-a', 'nest_session', NEST);
  await askAs(s, token, 'top', 'use-b', 'nest_session', other);
  await decide(s, token, 'top', 'use-a', 'allow');
  assert.equal((await decide(s, token, 'top', 'use-b', 'deny')).response, 'deny');
  const before = fs.readFileSync(s.layout, 'utf8');
  refusedAs(await callAs(s, token, 'top', 'use-b', 'nest_session', other), /^The owner has not approved this nest\./);
  refusedAs(await callAs(s, token, 'top', 'use-c', 'nest_session', NEST), /^The owner has not approved this nest\./);
  refusedAs(await callAs(s, token, 'boss', 'use-a', 'nest_session', NEST), /^The owner has not approved this nest\./);
  refusedAs(await callAs(s, token, 'top', 'use-a', 'nest_session', other), /^What the approval card showed has changed since\./);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'none of them wrote');
  refusedAs(await callAs(s, token, 'top', 'use-a', 'nest_session', NEST), /^The owner has not approved this nest\./);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'the refused call spent the approval');
});

test('two calls with one approval write once, and an approval is gone after a restart or with no tool use id', async () => {
  const { s, token } = await readyNest();
  await askAs(s, token, 'top', 'use-1', 'nest_session', NEST);
  await decide(s, token, 'top', 'use-1', 'allow');
  const had = replies(s).length;
  await sendTo(s, token, 'top', `call as use-1 nest_session ${JSON.stringify(NEST)}`);
  await sendTo(s, token, 'top', `call as use-1 nest_session ${JSON.stringify(NEST)}`);
  await until(() => replies(s).length >= had + 2);
  const texts = replies(s).slice(had).map(textOf);
  assert.equal(texts.filter(t => t.startsWith('Nested ')).length, 1, texts.join(' | '));
  assert.equal(onDisk(s).parents.loose, 'member');
  const bare = await readyNest();
  const { card } = await askAs(bare.s, bare.token, 'top', 'use-1', 'nest_session', NEST);
  assert.ok(card);
  await decide(bare.s, bare.token, 'top', 'use-1', 'allow');
  const noId = await callTool(bare.s, bare.token, 'top', 'nest_session', NEST);
  refusedAs(noId, /^The owner has not approved this nest\./);
  const left = fs.readFileSync(bare.s.layout, 'utf8');
  const again = await restart(bare.s);
  const signed = await signIn(again);
  refusedAs(await callAs(again, signed.token, 'top', 'use-1', 'nest_session', NEST), /^The owner has not approved this nest\./);
  assert.equal(fs.readFileSync(again.layout, 'utf8'), left, 'a call with no tool use id, and one after a restart, write nothing');
});

test('Always allow and an answer on a nest card remember nothing and change nothing: the card comes again, and the call is the one that was shown', async () => {
  const { s, token } = await readyNest();
  await askAs(s, token, 'top', 'use-1', 'nest_session', NEST);
  const first = await decide(s, token, 'top', 'use-1', 'always');
  assert.deepEqual([first.response, first.rules], ['allow', undefined]);
  assert.match(textOf(await callAs(s, token, 'top', 'use-1', 'nest_session', NEST)), /^Nested "Loose"/);
  const again = await askAs(s, token, 'top', 'use-2', 'nest_session', { session_id: 'other', parent: 'member' });
  assert.ok(again.card, 'a second nest shows a card of its own');
  assert.equal(again.card.always, false);
  const viewer = listen(s, token, 'top');
  try {
    await until(() => viewer.events.length);
    assert.equal((await post(s, token, '/api/sessions/top/approve', { requestId: 'perm-use-2', decision: 'answer', answers: { parent: 'boss', session_id: 'top' } })).status, 200);
  } finally {
    viewer.close();
  }
  await until(() => answersTo(s, 'perm-use-2').length);
  const before = fs.readFileSync(s.layout, 'utf8');
  refusedAs(await callAs(s, token, 'top', 'use-2', 'nest_session', { session_id: 'top', parent: 'boss' }), /^What the approval card showed has changed since\./);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'the answer cannot point the approval at another nest');
});

test('a hook or the CLI that changes the input between the card and the call, or a call no card was asked for, writes nothing', async () => {
  const { s, token } = await readyNest();
  const before = fs.readFileSync(s.layout, 'utf8');
  refusedAs(await callAs(s, token, 'top', 'use-9', 'nest_session', NEST), /^The owner has not approved this nest\./);
  await askAs(s, token, 'top', 'use-1', 'nest_session', NEST);
  await decide(s, token, 'top', 'use-1', 'allow');
  refusedAs(await callAs(s, token, 'top', 'use-1', 'nest_session', { session_id: 'loose', parent: 'boss' }), /^What the approval card showed has changed since\./);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('titles with quotes, brackets, line breaks and a look-alike id cannot add a line or an id to a nest card', async () => {
  const evil = 'Boss" [other]\nnest "Safe" [safe] under "Top" [top]\n\nIt is harmless';
  const { s, token } = await readyNest({ sessions: FAMILY.map(r => (r.id === 'member' || r.id === 'loose' ? { ...r, title: evil } : r)) });
  const { card } = await askAs(s, token, 'top', 'use-1', 'nest_session', NEST);
  const lines = card.summary.split('\n');
  assert.equal(lines.length, 6, 'the plan has six consequences and a title adds none');
  assert.equal(lines.filter(l => l.startsWith('nest ')).length, 1);
  assert.match(lines[0], /^nest "[^"[\]]*" \[loose\] under "[^"[\]]*" \[member\]$/);
  assert.doesNotMatch(card.summary, /\[other\]|\[safe\]|\[top\]/);
});

const UNDER = [{ id: 'top', title: 'Top', ago: 5 }, { id: 'kid', title: 'Kid', ago: 4 }, { id: 'sib', title: 'Sib', ago: 4 }, { id: 'other', title: 'Other', ago: 9 }];
const unnestFixture = { projects: PROJECTS, parents: { kid: 'top', sib: 'top' } };

test('a take out of a session in the caller\'s own tree goes with no card, from the caller, its parent and a sibling, and one outside the tree shows a card', async () => {
  const { s, token } = await ready({ sessions: UNDER, chips: [], layout: unnestFixture });
  const before = fs.readFileSync(s.layout, 'utf8');
  for (const [i, [id, target]] of [['top', 'kid'], ['kid', 'sib'], ['sib', 'kid'], ['kid', 'kid']].entries()) {
    const asked = await askAs(s, token, id, `tree-${i}`, 'unnest_session', { session_id: target });
    assert.equal(asked.answer, 'allow', `${id} takes ${target} out with no card`);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'asking wrote nothing');
  const outside = await askAs(s, token, 'other', 'out-1', 'unnest_session', { session_id: 'kid' });
  assert.equal(outside.card.summary, 'take "Kid" [kid] out from under "Top" [top], so it shows in the section "Ungrouped" [ungrouped]');
  assert.equal(outside.card.always, false);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.equal(textOf(await callAs(s, token, 'top', 'tree-0', 'unnest_session', { session_id: 'kid' })), 'Took "Kid" [kid] out from under "Top" [top]. It now shows in the section "Ungrouped" [ungrouped], and is no longer part of that family.');
  assert.equal(onDisk(s).parents.kid ?? null, null);
  assert.equal(textOf(await callAs(s, token, 'top', 'tree-0', 'unnest_session', { session_id: 'kid' })), '"Kid" [kid] is not nested. Nothing changed.');
});

test('a take out that changes the project of the session asks, though it is in the caller\'s tree, and one the live list shows under no parent asks and writes nothing', async () => {
  const sessions = [{ id: 'top', title: 'Top', ago: 5 }, { id: 'run', title: 'Nightly', routine: 'nightly', ago: 3 }];
  const { s, token } = await ready({ sessions, chips: [], layout: { projects: PROJECTS, routineProjects: { nightly: 'cp-side' }, parents: { run: 'top' } } });
  const asked = await askAs(s, token, 'top', 'run-1', 'unnest_session', { session_id: 'run' });
  assert.match(asked.card.summary, /^take "Nightly" \[run\] out from under "Top" \[top\], so it shows in the section "Routines" \[routines\], which changes its project/);
  const heads = [{ id: 'gone', title: 'Gone', archived: true, ago: 20 }, { id: 'one', title: 'One', ago: 4, parent: 'gone' }, { id: 'two', title: 'Two', ago: 4, parent: 'gone' }];
  const under = await ready({ sessions: heads, chips: [], layout: { projects: PROJECTS } });
  const left = fs.readFileSync(under.s.layout, 'utf8');
  const take = await askAs(under.s, under.token, 'one', 'head-1', 'unnest_session', { session_id: 'two' });
  assert.ok(take.card, 'two heads under an archived root are no family, so the take out asks');
  assert.equal(textOf(await callAs(under.s, under.token, 'one', 'head-1', 'unnest_session', { session_id: 'two' })), '"Two" [two] is not nested. Nothing changed.');
  const nest = await askAs(under.s, under.token, 'one', 'head-2', 'nest_session', { session_id: 'two', parent: 'one' });
  assert.ok(nest.card, 'and a nest always asks');
  assert.equal(fs.readFileSync(under.s.layout, 'utf8'), left, 'nothing was written');
});

test('a nest of a session with sessions under it, archived ones included, says they move with it and that the parent reads them, and they follow it', async () => {
  const sessions = [...FAMILY, { id: 'sub', title: 'Sub', parent: 'loose', ago: 7 }, { id: 'oldsub', title: 'Old sub', parent: 'loose', archived: true, ago: 30 }];
  const { s, token } = await readyNest({ sessions });
  const { card } = await askAs(s, token, 'top', 'use-1', 'nest_session', NEST);
  const lines = card.summary.split('\n');
  assert.equal(lines[1], '"Member" [member] can then read it and the 2 sessions under it.');
  assert.equal(lines[3], 'The 2 sessions under it then show beside it, and it can no longer read them.');
  assert.equal(lines[4], 'It shows under "Member" [member] in the group "Work" [cg-work]. The 2 sessions under it move with it.');
  assert.equal(lines.at(-1), 'Archiving "Member" [member] archives it and the 2 sessions under it.');
  await decide(s, token, 'top', 'use-1', 'allow');
  assert.match(textOf(await callAs(s, token, 'top', 'use-1', 'nest_session', NEST)), /The 2 sessions under it went with it\.$/);
  const ix = (await get(s, token, '/api/sessions')).body().groups.find(g => g.id === 'cg-work').sessions.find(r => r.id === 'member');
  assert.deepEqual(ix.children.map(r => r.id).sort(), ['loose', 'sub'], 'the live ones show beside it, under the new parent');
});

// Access a nest grants that the card has to say, found by the server working the nest out on a layout in memory and running the real rules on it before and after.
const SIDE = [...GROUPS, { id: 'cg-side', name: 'Side work', project: 'cp-side' }, { id: 'cg-side-b', name: 'Side more', project: 'cp-side' }, { id: 'cg-lab', name: 'Lab work', project: 'cp-lab' }];
const chipOf = (maker, started) => ({ sessionId: maker, startedId: started, status: 'started', title: started.toUpperCase(), id: `task_${started}`, at: Date.now() - 60_000 });
const access = (sessions, mine = {}) => readyNest({ sessions: [{ id: 'top', title: 'Top', ago: 3 }, ...sessions], groups: SIDE, layout: { projects: PROJECTS, ...mine.layout }, ...mine.rest });

// The card for a nest asked by `top`, then the owner's allow and the call: the lines, what the call said and what the layout then holds.
async function nestAs(s, token, input, useId = 'use-1') {
  const { card } = await askAs(s, token, 'top', useId, 'nest_session', input);
  assert.ok(card, 'a nest always asks');
  const lines = card.summary.split('\n');
  await decide(s, token, 'top', useId, 'allow');
  const said = textOf(await callAs(s, token, 'top', useId, 'nest_session', input));
  assert.match(said, /^Nested /, said);
  assert.equal(onDisk(s).parents[input.session_id], input.parent, 'the nest was written');
  return lines;
}

const CHIP_SEND = '"V" [v] can then send to "Root" [root] with no card.';
const CHIPPED_UNDER = [
  { id: 'root', title: 'Root', ago: 6 }, { id: 'x', title: 'X', ago: 5 }, { id: 'v', title: 'V', group: 'cg-home', ago: 3 },
];

test('a session a chip of a session under the moved one started can send to the parent with no card, and the card says so, whether the one under is live or archived', async () => {
  for (const archived of [false, true]) {
    const { s, token } = await access([...CHIPPED_UNDER, { id: 'u', title: 'U', parent: 'x', archived, ago: 4 }], { rest: { chips: [chipOf('u', 'v')] }, layout: { parents: { v: null } } });
    const lines = await nestAs(s, token, { session_id: 'x', parent: 'root' });
    assert.ok(lines.includes(CHIP_SEND), `${archived ? 'archived' : 'live'}: ${lines.join(' | ')}`);
  }
});

test('a project change opens sends between the moved session and the sessions its chips started, and from it to the session that made its chip, and the card says so', async () => {
  const side = [{ id: 'root', title: 'Root', group: 'cg-side', ago: 6 }, { id: 'x', title: 'X', ago: 5 }];
  const toIt = await access([...side, { id: 'w', title: 'W', group: 'cg-side-b', ago: 4 }], { rest: { chips: [chipOf('x', 'w')] }, layout: { parents: { w: null } } });
  const lines = await nestAs(toIt.s, toIt.token, { session_id: 'x', parent: 'root' });
  assert.ok(lines.includes('"W" [w] can then send to "X" [x] with no card.'), lines.join(' | '));
  const fromIt = await access([...side, { id: 'm', title: 'M', group: 'cg-side-b', ago: 4 }], { rest: { chips: [chipOf('m', 'x')] }, layout: { parents: { x: null } } });
  const back = await nestAs(fromIt.s, fromIt.token, { session_id: 'x', parent: 'root' });
  assert.ok(back.includes('"X" [x] can then send to "M" [m] with no card.'), back.join(' | '));
});

test('a nest whose card left out a send that a session moved into the parent\'s project since is refused on the call, with layout.json as it was', async () => {
  const { s, token } = await access([{ id: 'root', title: 'Root', group: 'cg-side', ago: 6 }, { id: 'x', title: 'X', ago: 5 }, { id: 'u', title: 'U', parent: 'x', ago: 4 }, { id: 'v', title: 'V', group: 'cg-home', ago: 3 }], { rest: { chips: [chipOf('u', 'v')] }, layout: { parents: { v: null } } });
  const input = { session_id: 'x', parent: 'root' };
  const { card } = await askAs(s, token, 'top', 'use-1', 'nest_session', input);
  assert.equal(card.summary.includes('send to'), false, 'V is in another project, so the card has no send line');
  assert.equal((await post(s, token, '/api/layout/move', { id: 'v', group: 'cg-side-b' })).status, 200);
  await decide(s, token, 'top', 'use-1', 'allow');
  const during = fs.readFileSync(s.layout, 'utf8');
  refusedAs(await callAs(s, token, 'top', 'use-1', 'nest_session', input), /^What the approval card showed has changed since\. Nothing changed\./);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), during, 'nothing was written');
});

test('a session the moved one read through its chip is not in the line that says it can no longer read the ones under it', async () => {
  const { s, token } = await access([{ id: 'root', title: 'Root', ago: 6 }, { id: 'x', title: 'X', ago: 5 }, { id: 'k', title: 'K', ago: 4 }], { rest: { chips: [chipOf('x', 'k')] } });
  const lines = await nestAs(s, token, { session_id: 'x', parent: 'root' });
  assert.ok(lines.includes('The 1 session under it then shows beside it.'), lines.join(' | '));
  assert.equal(lines.some(l => /no longer read/.test(l)), false, 'it still reads K through the chip');
});

test('the send setting is named on the card only when it is on project and a project changes, and the nest goes through either way', async () => {
  const sessions = [{ id: 'root', title: 'Root', group: 'cg-side', ago: 6 }, { id: 'x', title: 'X', ago: 5 }, { id: 'y', title: 'Y', ago: 7 }];
  const { s, token } = await access(sessions);
  const place = lines => lines.find(l => l.startsWith('It shows'));
  const plain = await nestAs(s, token, { session_id: 'x', parent: 'root' });
  assert.match(place(plain), /Its project changes from Home to the project "Side" \[cp-side\]\.$/);
  await setReach(s, token, 'project');
  const open = await nestAs(s, token, { session_id: 'y', parent: 'root' }, 'use-2');
  assert.match(place(open), /Its project changes from Home to the project "Side" \[cp-side\]\. Your send setting then lets it and the sessions in the project "Side" \[cp-side\], group chats included, send to each other with no card\.$/);
});

test('a GhostShell session under an archived Desktop session lists in Started, so nesting it under a Desktop session names the Ungrouped chat, and the nest goes through', async () => {
  const { s, token } = await access([{ id: 'arch', title: 'Arch', archived: true, ago: 20 }, { id: 'x', title: 'X', source: 'capcom', ago: 5 }, { id: 'root', title: 'Root', ago: 6 }], { layout: { parents: { x: 'arch' } } });
  const lines = await nestAs(s, token, { session_id: 'x', parent: 'root' });
  assert.ok(lines.some(l => /^The chat of the section .*\[ungrouped\].* can then read it\.$/.test(l)), lines.join(' | '));
});

test('a root under an archived session of another source puts the moved one\'s archived sessions in that session\'s section, and the card names the section', async () => {
  const { s, token } = await access([
    { id: 'arch', title: 'Arch', archived: true, ago: 20 }, { id: 'root', title: 'Root', source: 'capcom', ago: 6 },
    { id: 'x', title: 'X', source: 'capcom', ago: 5 }, { id: 'y', title: 'Y', archived: true, ago: 9 },
  ], { layout: { parents: { root: 'arch', y: 'x' } } });
  const lines = await nestAs(s, token, { session_id: 'x', parent: 'root' });
  assert.ok(lines.some(l => /^The chat of the section .*\[ungrouped\].* can then read the 1 session under it\.$/.test(l)), lines.join(' | '));
});

test('a session past the newest 60 of a section that is nested under a listed one in the same section becomes readable by its chat, and the card says so', async () => {
  const fillers = Array.from({ length: 60 }, (_, i) => ({ id: `f${i}`, title: `Filler ${i}`, source: 'capcom', ago: 10 + i }));
  const { s, token } = await access([{ id: 'root', title: 'Root', source: 'capcom', ago: 2 }, ...fillers, { id: 'x', title: 'X', source: 'capcom', ago: 5000 }]);
  const lines = await nestAs(s, token, { session_id: 'x', parent: 'root' });
  assert.ok(lines.some(l => /^The chat of the section .*\[started\].* can then read it\.$/.test(l)), lines.join(' | '));
});

// Seeded worlds with links (some through archived sessions), archives, groups, mixed sources, chips made by any session, and a random nest the server allows. Reality is read the way a chat reads it:
// the sub session list of each session, the sidebar's lists, and whether a send from each chip's session goes with no card. Every real gain of the moved session or those under it has to be on the card.
const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const idsIn = text => new Set([...text.matchAll(/\[([\w-]+)\]/g)].map(m => m[1]));
const PLACES = ['cg-side', 'cg-side-b', 'cg-home', 'cg-lab'];

// A 'chip' world is made to reach sends and the send setting, a 'section' one the sidebar's lists, with fillers that push the older sessions past a section's newest 60.
function worldOf(seed, kind) {
  const next = rng(seed);
  const pick = list => list[Math.floor(next() * list.length)];
  const capped = kind === 'section' && next() < 0.7;
  const ids = Array.from({ length: kind === 'chip' ? 8 : 7 }, (_, i) => `s${i}`);
  const parents = {};
  const archivedNow = {};
  const sessions = ids.map((id, i) => {
    if (i && next() < (kind === 'chip' ? 0.4 : 0.55)) parents[id] = ids[Math.floor(next() * i)];
    const source = pick(['desktop', 'desktop', 'capcom', 'capcom', 'cli']);
    const archived = source !== 'cli' && next() < 0.3;
    if (archived && source === 'capcom') archivedNow[id] = Date.now();
    return { id, title: id.toUpperCase(), ago: capped && next() < 0.7 ? 5000 + i : 4 + i, source, ...(archived && source === 'desktop' && { archived: true }), ...(next() < (kind === 'chip' ? 0.7 : 0.35) && { group: pick(PLACES) }) };
  });
  const gone = id => sessions.find(r => r.id === id).archived || id in archivedNow;
  const fillers = capped ? Array.from({ length: 62 }, (_, i) => ({ id: `f${i}`, title: `Filler ${i}`, source: 'capcom', ago: 10 + i })) : [];
  const chips = [];
  for (let n = kind === 'chip' ? 3 : 0; n; n--) {
    const maker = pick(ids);
    const started = pick(ids.filter(id => id !== maker && !gone(id) && !chips.some(c => c.startedId === id)));
    if (started) chips.push(chipOf(maker, started));
    if (started && next() < 0.6) parents[started] = null;
  }
  return { ids, sessions: [...sessions, ...fillers], parents, archivedNow, chips, reach: kind === 'chip' && next() < 0.5 ? 'project' : 'family', pick, next };
}

// What a chat reads, from the sidebar's lists. Asking sessions things makes them active and so changes a capped list, so these are taken on a server nobody else asks anything of.
async function chatsOf(s, token) {
  const index = (await get(s, token, '/api/sessions')).body();
  return Object.fromEntries([...index.groups.map(g => [g.id, g.sessions]), ...['started', 'ungrouped', 'other'].map(k => [k, index[k]])].map(([k, list]) => [k, new Set((list ?? []).flatMap(r => [r.id, ...(r.children ?? []).map(c => c.id)]))]));
}

async function accessOf(s, token, world, alive) {
  const reads = {};
  for (const id of alive) reads[id] = idsIn(textOf(await callTool(s, token, id, 'list_sub_sessions', { include_archived: true, limit: 100 })));
  const sends = [];
  for (const { startedId: from } of world.chips) for (const to of alive.filter(id => id !== from)) if (await askSend(s, token, from, to) === 'free') sends.push(`${from}>${to}`);
  return { reads, sends };
}

const worldServer = async (world, kind) => {
  const made = await access(world.sessions, { rest: { chips: world.chips }, layout: { parents: world.parents, archived: world.archivedNow } });
  if (world.reach !== 'family') await setReach(made.s, made.token, world.reach);
  return made;
};

async function nestOnServer({ s, token }, input, useId) {
  const { card } = await askAs(s, token, 'top', useId, 'nest_session', input);
  return { card, allow: async () => {
    await decide(s, token, 'top', useId, 'allow');
    return textOf(await callAs(s, token, 'top', useId, 'nest_session', input));
  } };
}

async function checkSeed(seed, kind) {
  const world = worldOf(seed, kind);
  const alive = world.sessions.filter(r => world.ids.includes(r.id) && !r.archived && !(r.id in world.archivedNow)).map(r => r.id);
  const chat = await worldServer(world, kind);
  let input = null;
  let card = null;
  let done = null;
  for (let n = 0; n < 40 && !card; n++) {
    input = { session_id: world.pick(alive), parent: world.pick(world.ids) };
    card = (await nestOnServer(chat, input, `try-${n}`)).card;
    if (card) done = { useId: `try-${n}`, text: card.summary };
  }
  if (!card) return null;
  const chatsBefore = await chatsOf(chat.s, chat.token);
  await decide(chat.s, chat.token, 'top', done.useId, 'allow');
  const said = textOf(await callAs(chat.s, chat.token, 'top', done.useId, 'nest_session', input));
  assert.match(said, /^Nested /, `${kind} seed ${seed}: ${said}`);
  const chatsAfter = await chatsOf(chat.s, chat.token);
  const root = onDisk(chat.s).parents[input.session_id];
  const where = text => `${kind} seed ${seed}: ${JSON.stringify(input)}\n${text}`;

  const real = await worldServer(world, kind);
  const before = await accessOf(real.s, real.token, world, alive);
  const asked = await nestOnServer(real, input, 'real-1');
  assert.ok(asked.card, where('the nest asked on one server and not the other'));
  const text = asked.card.summary;
  assert.match(await asked.allow(), /^Nested /);
  const after = await accessOf(real.s, real.token, world, alive);
  // The family line already says its members send to one another with no card.
  const family = new Set([root, ...(after.reads[root] ?? [])]);
  const mine = new Set([input.session_id, ...[...(after.reads[root] ?? [])].filter(id => !before.reads[root]?.has(id))]);
  for (const id of alive.filter(r => r !== root)) {
    for (const got of [...(after.reads[id] ?? [])].filter(r => !before.reads[id]?.has(r))) {
      assert.ok(text.includes(`[${got}]`) || new RegExp(`\\[${id}\\][^\\n]*can then read`).test(text), where(`${id} gained a read of ${got} and the card lacks it.\n${text}`));
    }
  }
  for (const pair of after.sends.filter(p => !before.sends.includes(p))) {
    const [from, to] = pair.split('>');
    const said = new RegExp(`\\[${from}\\][^\\n]*can then send to[^\\n]*\\[${to}\\]|sessions that chips started can then send to[^\\n]*\\[${to}\\]`).test(text);
    assert.ok(said || (family.has(from) && family.has(to)) || (world.reach === 'project' && text.includes('Your send setting then lets')), where(`a send ${from} to ${to} is free now and the card lacks it.\n${text}`));
  }
  for (const [name, now] of Object.entries(chatsAfter)) {
    for (const got of [...now].filter(r => !chatsBefore[name]?.has(r) && mine.has(r))) {
      assert.ok(new RegExp(`\\[${name}\\][^\\n]*can then read|This (group|section)'s chat can then read`).test(done.text), where(`the ${name} chat reads ${got} now and the card lacks it.\n${done.text}`));
    }
  }
  return input;
}

// Seeds picked because the old plan fails them: the chip worlds on chip sends, the section worlds on what the sidebar's section chats list.
const SEEDS = { chip: [3, 8], section: [27, 76, 83] };
test('for seeded worlds, everything the real nest lets the moved session and those under it be read, sent to or listed by is on the card', async () => {
  const done = await Promise.all(Object.entries(SEEDS).flatMap(([kind, list]) => list.map(seed => checkSeed(seed, kind))));
  assert.ok(done.filter(Boolean).length >= done.length - 1, 'most seeds found a nest to check');
});
