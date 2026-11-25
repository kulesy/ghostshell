// Run with `npm test`. What the tools that archive, rename and move a session, make a project or a group, and the two that look sessions and chips up, say and refuse. The server
// gives each chat callbacks, so here they are fakes. The wording of the server's own refusals is not under test here, layout-tools-api.test.mjs has them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveSession, createGroup, createProject, findSessions, groupNamed, layoutSummary, listChips, moveGroupToProject, moveProject, moveRoutineToProject, moveSession, projectNamed, setSessionTitle, unarchiveSession, unnestSession } from '../lib/layout-tools.mjs';
import { showsNothing } from '../lib/layout.mjs';
import { descendantsOf } from '../public/ui/sub-rules.js';
import { nestApproval, nestLines, nestSession, nestSummary, unnestSummary } from '../lib/nest-tool.mjs';
import { handleMcp, LAYOUT_READ_NAMES, LAYOUT_WRITE_NAMES, SEND_NAME, SUB_READ_NAMES, TOOL_NAMES, TREE_WRITE_NAMES } from '../lib/tools.mjs';

const NOW = Date.parse('2026-10-28T06:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const row = (id, extra) => ({ id, title: `Session ${id}`, cwd: `/work/${id}`, branch: 'main', state: 'idle', archived: false, group: null, lastActivityAt: NOW - 2 * DAY, ...extra });
const ROWS = [
  row('top', { lastActivityAt: NOW - 5 * MINUTE }),
  row('desk', { state: 'active', title: 'Desktop work' }),
  row('busy', { state: 'working', lastActivityAt: NOW - MINUTE, group: 'cg-a' }),
  row('old', { archived: true, title: 'Old review of dialogs', lastActivityAt: NOW - 9 * DAY }),
  row('review', { title: 'Review - dialogs', group: 'cg-a', lastActivityAt: NOW - 3 * DAY }),
  row('chat', { title: 'Needs Review', groupSession: 'cg-a', lastActivityAt: NOW - DAY }),
  row('section', { title: 'Pinned', groupSession: 'pinned' }),
];
const GROUPS = [{ id: 'cg-a', name: 'Needs Review' }, { id: 'cg-b', name: 'Backlog' }, { id: 'cg-c', name: 'backlog' }, { id: 'cg-d', name: 'Reviewing' }];

const WORK_CHAT = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const PROJECTS = [{ id: 'cp-w', name: 'Work' }, { id: 'cp-h', name: 'Home lab' }];
// Routines as the routines store lists them, with the title as the name. Two share a title apart from its case.
const ROUTINES = [{ id: 'daily-digest', name: 'Daily digest' }, { id: 'weekly-report', name: 'Weekly report' }, { id: 'lost-link', name: 'Lost link' }, { id: 'tidy-1', name: 'Tidy up' }, { id: 'tidy-2', name: 'tidy UP' }];
// The server's name rules: a blank name and one over 80 characters are 400s.
const nameOf = value => {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw status(400, 'Give it a name.');
  if ([...name].length > 80) throw status(400, 'Names run to 80 characters at most.');
  return name;
};

const refused = (run, expected) => assert.throws(run, { refusal: true, message: expected });
const status = (code, message) => Object.assign(new Error(message), { status: code });

// The fakes answer as the server's do: an error with a status for a session that cannot change, and for an archive { was: 'done', archivedSubs } or, for 'running' and 'elsewhere', whether the session itself and how many below it stand in the way as { self, subs }.
function subsFor({ self = 'top', rows = ROWS, pulls = { links: {}, reading: false }, projects = PROJECTS, placed = { 'daily-digest': 'cp-w', 'lost-link': 'cp-gone' } } = {}) {
  const calls = [];
  const editable = id => {
    const found = rows.find(r => r.id === id);
    if (!found) throw status(404, 'No session with that id on this Mac.');
    if (found.groupSession) throw status(400, `A ${found.groupSession === 'pinned' ? 'section' : 'group'}'s session stays with its ${found.groupSession === 'pinned' ? 'section' : 'group'}.`);
    return found;
  };
  return {
    calls,
    pullLinks: () => pulls,
    lookup: ({ archived }) => ({ self: rows.find(r => r.id === self) ?? null, rows: rows.filter(r => archived || !r.archived) }),
    archive(id) {
      const root = editable(id);
      const below = descendantsOf(rows, id).filter(r => !r.archived);
      const away = below.filter(r => r.state === 'active').length;
      if (away || root.state === 'active') return { was: 'elsewhere', self: root.state === 'active', subs: away };
      const busy = below.filter(r => r.state !== 'idle').length;
      if (busy || root.state !== 'idle') return { was: 'running', self: root.state !== 'idle', subs: busy };
      calls.push(['archive', id]);
      return { was: 'done', archivedSubs: below.length };
    },
    unarchive(id) {
      editable(id);
      calls.push(['unarchive', id]);
      return rows.filter(r => r.archived && r.parent === id).length;
    },
    rename(id, title) {
      editable(id);
      if (!String(title).trim()) throw status(400, 'Give it a name.');
      calls.push(['rename', id, title]);
      return String(title).replace(/\s+/g, ' ').trim();
    },
    move(id, group) { editable(id); calls.push(['move', id, group]); },
    projects: () => projects,
    addProject(name) {
      const clean = nameOf(name);
      calls.push(['addProject', clean]);
      return { id: `cp-${clean}`, name: clean };
    },
    addGroup(name, project) {
      if (project && !projects.some(p => p.id === project)) throw status(404, 'Unknown project.');
      const clean = nameOf(name);
      calls.push(['addGroup', clean, project]);
      return { id: `cg-${clean}`, name: clean, ...(project && { project }) };
    },
    moveGroup(id, project) {
      if (!PLACED.some(g => g.id === id)) throw status(404, 'Unknown group.');
      if (project !== null && !projects.some(p => p.id === project)) throw status(404, 'Unknown project.');
      calls.push(['moveGroup', id, project]);
    },
    routines: () => ROUTINES,
    routineProject: id => placed[id] ?? null,
    moveRoutine(id, project) {
      if (project !== null && !projects.some(p => p.id === project)) throw status(404, 'Unknown project.');
      calls.push(['moveRoutine', id, project]);
    },
    orderProject(id, side) {
      if (!projects.some(p => p.id === id)) throw status(404, 'Unknown project.');
      calls.push(['orderProject', id, side]);
    },
  };
}

test('archiving a session goes through the server and says what happened, and one already archived is answered plainly with nothing written', () => {
  const subs = subsFor();
  assert.equal(archiveSession({ session_id: 'review' }, subs), 'Archived "Review - dialogs" [review]. Its chat is closed and it is out of the sidebar\'s lists. unarchive_session brings it back.');
  assert.deepEqual(subs.calls, [['archive', 'review']]);
  assert.equal(archiveSession({ session_id: 'old' }, subs), '"Old review of dialogs" [old] is already archived. Nothing changed.');
  assert.equal(subs.calls.length, 1);
});

test('archiving is refused for the session itself, a running or waiting one, one another app runs, a group\'s or section\'s chat and an id that is no session, and nothing is written', () => {
  const subs = subsFor();
  refused(() => archiveSession({ session_id: 'top' }, subs), 'A session cannot archive itself. Ask the owner to archive it.');
  refused(() => archiveSession({ session_id: 'busy' }, subs), /^Refused: "Session busy" \[busy\] is running a turn or waiting for the owner/);
  refused(() => archiveSession({ session_id: 'desk' }, subs), /^Refused: "Desktop work" \[desk\] looks to be running in another app/);
  refused(() => archiveSession({ session_id: 'chat' }, subs), "A group's session stays with its group.");
  refused(() => archiveSession({ session_id: 'section' }, subs), "A section's session stays with its section.");
  refused(() => archiveSession({ session_id: 'nobody' }, subs), 'No session with that id on this Mac.');
  for (const session_id of [undefined, null, '', '  ', 5, ['review']]) refused(() => archiveSession({ session_id }, subs), 'Give the id of the session as session_id.');
  assert.deepEqual(subs.calls, []);
});

const FAMILY = [
  row('top'),
  row('boss', { title: 'Boss' }),
  row('kid', { title: 'Kid', parent: 'boss' }),
  row('grand', { title: 'Grand', parent: 'kid', state: 'idle' }),
  row('stale', { title: 'Stale', parent: 'boss', archived: true }),
];

test('archiving a parent says how many sub sessions went with it, and one with nothing below it says what it always did', () => {
  const subs = subsFor({ rows: FAMILY });
  assert.equal(archiveSession({ session_id: 'boss' }, subs), 'Archived "Boss" [boss] and the 2 sub sessions under it. Their chats are closed and they are out of the sidebar\'s lists. unarchive_session brings them back.');
  assert.equal(archiveSession({ session_id: 'grand' }, subs), 'Archived "Grand" [grand]. Its chat is closed and it is out of the sidebar\'s lists. unarchive_session brings it back.');
  assert.match(archiveSession({ session_id: 'kid' }, subs), /^Archived "Kid" \[kid\] and the 1 sub session under it\. /);
  assert.deepEqual(subs.calls, [['archive', 'boss'], ['archive', 'grand'], ['archive', 'kid']]);
});

test('archiving is refused when a session below the parent is running or in another app, and the refusal names how many', () => {
  const busy = subsFor({ rows: FAMILY.map(r => (r.id === 'grand' ? { ...r, state: 'working' } : r)) });
  refused(() => archiveSession({ session_id: 'boss' }, busy), 'Refused: 1 session under "Boss" [boss] is running a turn or waiting for the owner to approve something, and archiving it would stop it. Try again once it is idle, or tell the owner to archive it from the app.');
  const many = subsFor({ rows: FAMILY.map(r => (['kid', 'grand'].includes(r.id) ? { ...r, state: 'waiting' } : r)) });
  refused(() => archiveSession({ session_id: 'boss' }, many), /^Refused: 2 sessions under "Boss" \[boss\] are running a turn or waiting for the owner to approve something, and archiving them would stop them\. Try again once they are idle/);
  const away = subsFor({ rows: FAMILY.map(r => (r.id === 'kid' ? { ...r, state: 'active' } : r)) });
  refused(() => archiveSession({ session_id: 'boss' }, away), /^Refused: 1 session under "Boss" \[boss\] looks to be running in another app/);
  const both = subsFor({ rows: FAMILY.map(r => (['boss', 'kid'].includes(r.id) ? { ...r, state: 'working' } : r)) });
  refused(() => archiveSession({ session_id: 'boss' }, both), /^Refused: "Boss" \[boss\] and 1 session under it are running a turn or waiting for the owner to approve something, and archiving them would stop them\./);
  const alone = subsFor({ rows: FAMILY.map(r => (r.id === 'boss' ? { ...r, state: 'working' } : r)) });
  refused(() => archiveSession({ session_id: 'boss' }, alone), /^Refused: "Boss" \[boss\] is running a turn or waiting for the owner/);
  assert.deepEqual([busy, many, away, both, alone].flatMap(subs => subs.calls), []);
});

test('unarchiving says how many sub sessions came back with the session', () => {
  const rows = [row('boss', { archived: true, title: 'Boss' }), row('kid', { archived: true, parent: 'boss' }), row('grand', { archived: true, parent: 'boss' })];
  assert.equal(unarchiveSession({ session_id: 'boss' }, subsFor({ rows })), 'Unarchived "Boss" [boss] and the 2 sub sessions archived with it. They are back in their places in the sidebar with no process running, and send_session starts each.');
});

test('unarchiving brings a session back, answers plainly for one that is not archived, and refuses a group\'s chat and an unknown id', () => {
  const subs = subsFor();
  assert.equal(unarchiveSession({ session_id: 'old' }, subs), 'Unarchived "Old review of dialogs" [old]. It is back in its place in the sidebar with no process running, and send_session starts it.');
  assert.equal(unarchiveSession({ session_id: 'review' }, subs), '"Review - dialogs" [review] is not archived. Nothing changed.');
  refused(() => unarchiveSession({ session_id: 'chat' }, subs), "A group's session stays with its group.");
  refused(() => unarchiveSession({ session_id: 'nobody' }, subs), 'No session with that id on this Mac.');
  assert.deepEqual(subs.calls, [['unarchive', 'old']]);
});

test('a title is set through the server and the cleaned title comes back, on this session too, and a group\'s chat, a blank title and a title that is not text are refused', () => {
  const subs = subsFor();
  assert.equal(setSessionTitle({ session_id: 'review', title: '  Review\n dialogs  ' }, subs), 'Renamed "Review - dialogs" [review] to "Review dialogs". The title shows in GhostShell only.');
  assert.match(setSessionTitle({ session_id: 'top', title: '✅ Done' }, subs), /^Renamed "Session top" \[top\] to "✅ Done"\./);
  refused(() => setSessionTitle({ session_id: 'chat', title: 'x' }, subs), "A group's session stays with its group.");
  refused(() => setSessionTitle({ session_id: 'review', title: '   ' }, subs), 'Give it a name.');
  for (const title of [undefined, null, 5, ['x']]) refused(() => setSessionTitle({ session_id: 'review', title }, subs), 'Give the new title as title.');
  assert.deepEqual(subs.calls.map(c => c.slice(0, 2)), [['rename', 'review'], ['rename', 'top']]);
});

test('a session moves to a group by its name as the sidebar shows it, without regard to case, or by its id', () => {
  const subs = subsFor();
  assert.equal(moveSession({ session_id: 'review', group: ' reviewing ' }, subs, GROUPS), 'Moved "Review - dialogs" [review] to the group "Reviewing". It is no longer pinned or nested under another session.');
  assert.match(moveSession({ session_id: 'review', group: 'cg-b' }, subs, GROUPS), /to the group "Backlog"\./);
  assert.match(moveSession({ session_id: 'top', group: 'NEEDS   review' }, subs, GROUPS), /to the group "Needs Review"\./);
  assert.deepEqual(subs.calls, [['move', 'review', 'cg-d'], ['move', 'review', 'cg-b'], ['move', 'top', 'cg-a']]);
});

test('a move says when the session is still archived, and when the calling group\'s chat can now read it, which a move into another group does not', () => {
  const subs = subsFor();
  assert.match(moveSession({ session_id: 'old', group: 'cg-d' }, subs, GROUPS), /It is still archived\./);
  assert.doesNotMatch(moveSession({ session_id: 'review', group: 'cg-d' }, subs, GROUPS), /archived|read it/);
  assert.match(moveSession({ session_id: 'review', group: 'cg-d' }, subs, GROUPS, 'cg-a'), /^Moved .* to the group "Reviewing"\. [^]*$/);
  assert.doesNotMatch(moveSession({ session_id: 'review', group: 'cg-d' }, subs, GROUPS, 'cg-a'), /read it/, 'a move into another group gives the caller no new reach');
  assert.match(moveSession({ session_id: 'review', group: 'cg-a' }, subs, GROUPS, 'cg-a'), /This group's chat can now read it with read_group_session\.$/);
  assert.match(moveSession({ session_id: 'old', group: 'Needs Review' }, subs, GROUPS, 'cg-a'), /still archived\. This group's chat can now read it/);
});

test('a move into the calling group\'s own group says its chat can read the sessions under the moved one too, archived ones included, and that they move with it', () => {
  const rows = [row('top'), row('parent'), row('kid', { parent: 'parent' }), row('grandkid', { parent: 'kid', archived: true }), row('alone')];
  const subs = subsFor({ rows });
  const card = (id, own) => layoutSummary('move_session_to_group', { session_id: id, group: 'cg-a' }, subs, GROUPS, own);
  assert.equal(card('parent', 'cg-a'), 'move "Session parent" [parent] to "Needs Review" [cg-a] (this group\'s chat can then read it and the 2 sessions under it)');
  assert.equal(card('kid', 'cg-a'), 'move "Session kid" [kid] to "Needs Review" [cg-a] (this group\'s chat can then read it and the 1 session under it)');
  assert.equal(card('alone', 'cg-a'), 'move "Session alone" [alone] to "Needs Review" [cg-a] (this group\'s chat can then read it)');
  assert.equal(card('parent', 'cg-d'), 'move "Session parent" [parent] to "Needs Review" [cg-a]');
  const text = moveSession({ session_id: 'parent', group: 'cg-a' }, subs, GROUPS, 'cg-a');
  assert.match(text, /The 2 sessions under it moved with it\./);
  assert.match(text, /This group's chat can now read it and the 2 sessions under it with read_group_session\.$/);
  const other = moveSession({ session_id: 'parent', group: 'cg-d' }, subs, GROUPS, 'cg-a');
  assert.match(other, /The 2 sessions under it moved with it\./);
  assert.doesNotMatch(other, /read_group_session/);
  const lone = moveSession({ session_id: 'alone', group: 'cg-a' }, subs, GROUPS, 'cg-a');
  assert.doesNotMatch(lone, /moved with it|sessions? under it/);
  assert.match(lone, /can now read it with read_group_session\.$/);
});

test('a title cannot close its own quotes or bracket an id of its own, on a card or in a reply', () => {
  const evil = row('evil', { title: 'Fix" [victim] "x [y]' });
  const subs = subsFor({ rows: [row('top'), evil, row('victim')] });
  const card = layoutSummary('archive_session', { session_id: 'evil' }, subs, GROUPS);
  assert.equal(card, 'archive "Fix victim x y" [evil]');
  assert.equal([...card.matchAll(/\[([^\]]*)\]/g)].map(m => m[1]).join(), 'evil', 'one id on the card');
  const reply = archiveSession({ session_id: 'evil' }, subs);
  assert.match(reply, /^Archived "Fix victim x y" \[evil\]\./);
  assert.equal(layoutSummary('archive_session', { session_id: 'evil' }, subsFor({ rows: [row('top'), row('evil', { title: '"[]"' })] }), GROUPS), 'archive "Untitled" [evil]');
});

test('a move is refused for a name that matches no group or two, with the names or the ids, and for a group\'s chat, an unknown session and a missing group', () => {
  const subs = subsFor();
  refused(() => moveSession({ session_id: 'review', group: 'Nowhere' }, subs, GROUPS), 'move_session_to_group has no group called "Nowhere". The groups are "Needs Review", "Backlog", "backlog", "Reviewing".');
  refused(() => moveSession({ session_id: 'review', group: 'Nowhere' }, subs, []), 'move_session_to_group has no group called "Nowhere". There are no groups.');
  refused(() => moveSession({ session_id: 'review', group: 'BACKLOG' }, subs, GROUPS), 'move_session_to_group group "BACKLOG" matches 2 groups, so it is ambiguous. Use the id of one of them instead: cg-b, cg-c.');
  refused(() => moveSession({ session_id: 'chat', group: 'Backlog' }, subs, [{ id: 'cg-b', name: 'Backlog' }]), "A group's session stays with its group.");
  refused(() => moveSession({ session_id: 'nobody', group: 'Reviewing' }, subs, GROUPS), 'No session with that id on this Mac.');
  for (const group of [undefined, null, '', '   ', 5]) refused(() => moveSession({ session_id: 'review', group }, subs, GROUPS), /^Give the group as group/);
  assert.deepEqual(subs.calls, []);
});

test('a chip names its group the way a move does, and keeps its own refusal wording', () => {
  assert.deepEqual(groupNamed('reviewing', GROUPS, 'spawn_task'), { group: GROUPS[3] });
  assert.equal(groupNamed('backlog', GROUPS, 'spawn_task').refusal, 'spawn_task group "backlog" matches 2 groups, so it is ambiguous. Leave the group out, or ask the owner to rename one.');
  assert.match(groupNamed('x', GROUPS, 'spawn_task').refusal, /^spawn_task has no group called "x"\./);
  assert.deepEqual(groupNamed('cg-d', GROUPS, 'spawn_task'), { group: GROUPS[3] }, 'an id works too');
  for (const ctx of [{ subs: subsFor() }, { subs: subsFor(), group: { lookup: () => null } }]) {
    const spawn = rpc('tools/list', {}, ctx).result.tools.find(t => t.name === 'spawn_task');
    assert.match(spawn.inputSchema.properties.group.description, /or its id\./);
  }
  const typed = rpc('tools/call', { name: 'spawn_task', arguments: { title: 't', prompt: 'p', group: 5 } }, { subs: subsFor(), chips: chipsOf([]) }).result;
  assert.equal(typed.content[0].text, 'spawn_task group must be the name of a group or its id.');
});

test('the archive card says it also archives the sub sessions below, but counts only those not archived already', () => {
  const subs = subsFor({ rows: FAMILY });
  const card = id => layoutSummary('archive_session', { session_id: id }, subs, GROUPS);
  assert.equal(card('boss'), 'archive "Boss" [boss] and its 2 sub sessions');
  assert.equal(card('kid'), 'archive "Kid" [kid] and its 1 sub session');
  assert.equal(card('grand'), 'archive "Grand" [grand]');
  assert.equal(layoutSummary('unarchive_session', { session_id: 'boss' }, subs, GROUPS), 'unarchive "Boss" [boss]');
});

test('the unarchive card counts the sessions that come back with it: those archived with it, and under it unless it started the batch', () => {
  const rows = [
    row('top'),
    row('boss', { title: 'Boss', archived: true }),
    row('kid', { title: 'Kid', parent: 'boss', archived: true, archivedWith: 'boss' }),
    row('grand', { title: 'Grand', parent: 'kid', archived: true, archivedWith: 'boss' }),
    row('apart', { title: 'Apart', parent: 'boss', archived: true }),
    row('moved', { title: 'Moved', archived: true, archivedWith: 'boss' }),
  ];
  const card = id => layoutSummary('unarchive_session', { session_id: id }, subsFor({ rows }), GROUPS);
  assert.equal(card('boss'), 'unarchive "Boss" [boss] and its 3 sub sessions');
  assert.equal(card('kid'), 'unarchive "Kid" [kid] and its 1 sub session');
  assert.equal(card('apart'), 'unarchive "Apart" [apart]');
});

test('the card for each write names the session by its title and id and says what is done to it, shows an id that is no session as unknown, and says when a group\'s chat can read what it moves', () => {
  const subs = subsFor();
  const card = (tool, input, own) => layoutSummary(tool, input, subs, GROUPS, own);
  assert.equal(card('archive_session', { session_id: 'review' }), 'archive "Review - dialogs" [review]');
  assert.equal(card('unarchive_session', { session_id: 'old' }), 'unarchive "Old review of dialogs" [old]');
  assert.equal(card('set_session_title', { session_id: 'review', title: 'New\nname' }), 'rename "Review - dialogs" [review] to "New name"');
  assert.equal(card('move_session_to_group', { session_id: 'review', group: 'cg-d' }), 'move "Review - dialogs" [review] to "Reviewing" [cg-d]');
  assert.equal(card('move_session_to_group', { session_id: 'review', group: 'backlog' }), 'move "Review - dialogs" [review] to "backlog"', 'an ambiguous name shows as given');
  assert.equal(card('archive_session', { session_id: 'nobody' }), 'archive an unknown session [nobody]');
  assert.equal(card('archive_session', undefined), 'archive an unknown session');
  assert.equal(card('set_session_title', { session_id: 'nobody', title: 'x' }), 'rename an unknown session [nobody] to "x"');
  assert.equal(layoutSummary('archive_session', { session_id: 'review' }, { lookup() { throw new Error('index broke'); } }, GROUPS), 'archive an unknown session [review]');
  assert.equal(card('move_session_to_group', { session_id: 'review', group: 'cg-a' }, 'cg-a'), 'move "Review - dialogs" [review] to "Needs Review" [cg-a] (this group\'s chat can then read it)');
  assert.equal(card('move_session_to_group', { session_id: 'review', group: 'Needs review' }, 'cg-a'), 'move "Review - dialogs" [review] to "Needs Review" [cg-a] (this group\'s chat can then read it)', 'a name reaches the same group as its id');
  assert.equal(card('move_session_to_group', { session_id: 'review', group: 'cg-d' }, 'cg-a'), 'move "Review - dialogs" [review] to "Reviewing" [cg-d]');
  assert.equal(card('move_session_to_group', { session_id: 'review', group: 'cg-a' }, undefined), 'move "Review - dialogs" [review] to "Needs Review" [cg-a]');
  assert.doesNotMatch(card('archive_session', { session_id: 'review' }, 'cg-a'), /read it/);
});

test('the rename card shows the new title without quotes or brackets, look-alikes included, so it cannot pass off a second id', () => {
  const card = (title, id = 'review') => layoutSummary('set_session_title', { session_id: id, title }, subsFor(), GROUPS);
  assert.equal(card('Fix "menus" [busy]'), 'rename "Review - dialogs" [review] to "Fix menus busy"');
  for (const [open, shut, quote] of ['[]"', '［］＂', '【】”', '〔〕“', '⟦⟧„', '❲❳»', '⁅⁆〞', '「」‟']) {
    assert.equal(card(`x${quote} ${open}busy${shut} ${quote}y`), 'rename "Review - dialogs" [review] to "x busy y"');
  }
  const kept = '✅ Done - 🛡️ The owner’s menus (part 2): café, {a} & b/c? #7 <ok> ‘yes’!';
  assert.equal(card(kept), `rename "Review - dialogs" [review] to "${kept}"`, 'emoji and other punctuation show');
  assert.equal(card(`"${'x'.repeat(118)}"`), `rename "Review - dialogs" [review] to "${'x'.repeat(118)}"`, 'a title of 120 characters is not cut');
  assert.equal(card('"[]"'), 'rename "Review - dialogs" [review] to "Untitled"');
  assert.equal(card(' '), 'rename "Review - dialogs" [review] to ""');
  assert.equal(card('x', 'no] "Session busy" [busy'), 'rename an unknown session [no Session busy busy] to "x"');
});

test('find_sessions matches part of a title without regard to case, latest first, archived ones included unless they are left out, and marks a group\'s chat and the group', () => {
  const subs = subsFor();
  const text = findSessions({ query: 'REVIEW' }, subs, GROUPS, NOW);
  assert.match(text, /^3 sessions with "review" in the title, the latest first\n\n/);
  const lines = text.split('\n').filter(l => l.startsWith('- '));
  assert.deepEqual(lines.map(l => /\[(\w+)\]/.exec(l)[1]), ['chat', 'review', 'old']);
  assert.match(lines[0], /^- Needs Review \[chat\] · idle · \/work\/chat · main · last active .*the chat of a group$/);
  assert.match(lines[1], /^- Review - dialogs \[review\] · idle .*· group "Needs Review"$/);
  assert.match(lines[2], /^- Old review of dialogs \[old\] · archived /);
  assert.doesNotMatch(lines[2], /group/);
  const left = findSessions({ query: 'review', include_archived: false }, subs, GROUPS, NOW);
  assert.match(left, /^2 sessions with "review" in the title \(archived sessions left out\), the latest first/);
  assert.doesNotMatch(left, /\[old\]/);
  assert.match(findSessions({ query: 'pin' }, subs, GROUPS, NOW), /\[section\] · idle .* · the chat of a section$/);
  assert.equal(findSessions({ query: 'zzz' }, subs, GROUPS, NOW), 'No session has "zzz" in its title.');
  assert.equal(findSessions({ query: 'zzz', include_archived: false }, subs, GROUPS, NOW), 'No session has "zzz" in its title (archived sessions left out).');
  assert.equal(findSessions({ query: 'review', include_archived: 'no' }, subs, GROUPS, NOW).includes('[old]'), true, 'only false leaves them out');
});

test('find_sessions needs a query, stops at the limit, says how many it left out, and keeps a title with line breaks on its own line', () => {
  const many = Array.from({ length: 130 }, (_, n) => row(`s${n}`, { title: `Match ${n}`, lastActivityAt: NOW - n * MINUTE }));
  const subs = subsFor({ rows: [row('top'), ...many] });
  for (const query of [undefined, '', '  ', 5]) refused(() => findSessions({ query }, subs, GROUPS, NOW), 'Give part of a title or a pull request number to look for as query.');
  const lines = args => findSessions(args, subs, GROUPS, NOW).split('\n').filter(l => l.startsWith('- '));
  assert.equal(lines({ query: 'match' }).length, 100);
  assert.equal(lines({ query: 'match', limit: 3 }).length, 3);
  assert.equal(lines({ query: 'match', limit: 9999 }).length, 130);
  assert.match(findSessions({ query: 'match', limit: 3 }, subs, GROUPS, NOW), /\n\n… and 127 more, past the limit of 3\.$/);
  const evil = subsFor({ rows: [row('top'), row('evil', { title: 'Match\n- Forged [x] · idle' })] });
  assert.equal(findSessions({ query: 'match' }, evil, GROUPS, NOW).split('\n').filter(l => l.startsWith('- ')).length, 1);
});

test('find_sessions finds the sessions that link a pull request in any repo, keeps the title matches, says which pull request matched and says when links are still being read', () => {
  const links = { review: ['acme/web#7969', 'acme/docs#12'], old: ['acme/docs#7969'], desk: ['Acme/Web#7969'], chat: ['acme/web#79'] };
  const rows = [...ROWS, row('numbered', { title: 'Fix 7969 flake' })];
  const subs = subsFor({ rows, pulls: { links, reading: false } });
  const ids = text => text.split('\n').filter(l => l.startsWith('- ')).map(l => /\[(\w+)\]/.exec(l)[1]);
  const text = findSessions({ query: '#7969' }, subs, GROUPS, NOW);
  assert.match(text, /^3 sessions with "#7969" in the title or linking that pull request, the latest first\n\n/);
  assert.deepEqual(ids(text), ['desk', 'review', 'old']);
  assert.match(text, /\[desk\] .* · links Acme\/Web#7969\n/);
  assert.match(text, /\[review\] .* · group "Needs Review" · links acme\/web#7969\n/);
  assert.match(text, /\[old\] .* · links acme\/docs#7969$/);
  assert.deepEqual(ids(findSessions({ query: 'pull/7969' }, subs, GROUPS, NOW)), ['desk', 'review', 'old']);
  const bare = findSessions({ query: '7969' }, subs, GROUPS, NOW);
  assert.deepEqual(ids(bare), ['desk', 'numbered', 'review', 'old'], 'a bare number keeps matching titles');
  assert.doesNotMatch(bare.split('\n').find(l => l.includes('[numbered]')), /links/);
  assert.deepEqual(ids(findSessions({ query: 'https://github.com/acme/docs/pull/7969' }, subs, GROUPS, NOW)), ['old']);
  assert.deepEqual(ids(findSessions({ query: '#7969', include_archived: false }, subs, GROUPS, NOW)), ['desk', 'review']);
  assert.equal(findSessions({ query: '#555' }, subs, GROUPS, NOW), 'No session has "#555" in its title or links that pull request.');
  const reading = subsFor({ rows, pulls: { links: {}, reading: true } });
  assert.equal(findSessions({ query: '#555' }, reading, GROUPS, NOW), 'No session has "#555" in its title or links that pull request. Pull request links are still being read, so try again shortly.');
  assert.equal(findSessions({ query: 'zzz' }, reading, GROUPS, NOW), 'No session has "zzz" in its title.');
  assert.deepEqual(ids(findSessions({ query: '7969' }, subsFor({ rows }), GROUPS, NOW)), ['numbered'], 'with no links known a number still finds titles');
});

test('a project is made with the cleaned name and the reply gives its id and says it has no groups', () => {
  const subs = subsFor();
  assert.equal(createProject({ name: '  Side\n  work ' }, subs), 'Created the project "Side work" [cp-Side work]. It has no groups yet: create_group with project set to its name or id adds one.');
  assert.deepEqual(subs.calls, [['addProject', 'Side work']]);
});

test('a project name that is missing, not text, blank or over 80 characters is refused and nothing is made', () => {
  const subs = subsFor();
  for (const name of [undefined, null, 5, ['x']]) refused(() => createProject({ name }, subs), 'Give the name as name.');
  for (const name of ['', '   ', '\n']) refused(() => createProject({ name }, subs), 'Give it a name.');
  refused(() => createProject({ name: 'x'.repeat(81) }, subs), 'Names run to 80 characters at most.');
  assert.equal(createProject({ name: 'x'.repeat(80) }, subs).startsWith('Created'), true);
  assert.deepEqual(subs.calls.length, 1);
});

test('a project name already in use is refused with the existing id, ignoring case and extra spaces, and with no add call', () => {
  const subs = subsFor();
  for (const name of ['work', ' WORK ', 'Home   lab']) refused(() => createProject({ name }, subs), /^There is already a project called "(Work|Home lab)" \[cp-[wh]\]\. Nothing changed\.$/);
  assert.deepEqual(subs.calls, []);
  assert.equal(createProject({ name: 'Backlog' }, subs).startsWith('Created'), true, 'a group\'s name does not block a project');
});

test('a group is made on Home, with a blank or missing project meaning Home, and the reply gives its id and says the other tools can use it', () => {
  const subs = subsFor();
  assert.equal(createGroup({ name: 'Fresh' }, subs, GROUPS), 'Created the group "Fresh" [cg-Fresh] on Home. move_session_to_group and spawn_task\'s group can now use it by name or id.');
  for (const project of [null, '', '   ']) assert.match(createGroup({ name: `G${project}`.trim(), project }, subs, GROUPS), /on Home\./);
  assert.deepEqual(subs.calls.map(c => c[2]), [null, null, null, null]);
});

test('a group goes into a project by its name in any case, or by its id, and the reply names the project', () => {
  const subs = subsFor();
  assert.match(createGroup({ name: 'A', project: ' work ' }, subs, GROUPS), /^Created the group "A" \[cg-A\] in the project "Work"\./);
  assert.match(createGroup({ name: 'B', project: 'cp-h' }, subs, GROUPS), /in the project "Home lab"\./);
  assert.match(createGroup({ name: 'C', project: 'HOME LAB' }, subs, GROUPS), /in the project "Home lab"\./);
  assert.deepEqual(subs.calls, [['addGroup', 'A', 'cp-w'], ['addGroup', 'B', 'cp-h'], ['addGroup', 'C', 'cp-h']]);
});

test('a project that is unknown is refused with the names, two with the same name are refused with their ids, and one that is not text is refused', () => {
  const subs = subsFor();
  refused(() => createGroup({ name: 'A', project: 'Nowhere' }, subs, GROUPS), 'create_group has no project called "Nowhere". The projects are "Work", "Home lab".');
  refused(() => createGroup({ name: 'A', project: 'x' }, subsFor({ projects: [] }), GROUPS), 'create_group has no project called "x". There are no projects.');
  const twin = subsFor({ projects: [{ id: 'cp-1', name: 'Work' }, { id: 'cp-2', name: 'work' }] });
  refused(() => createGroup({ name: 'A', project: 'WORK' }, twin, GROUPS), 'create_group project "WORK" matches 2 projects, so it is ambiguous. Use the id of one of them instead: cp-1, cp-2.');
  assert.match(createGroup({ name: 'A', project: 'cp-2' }, twin, GROUPS), /in the project "work"\./);
  for (const project of [5, true, ['Work'], {}]) refused(() => createGroup({ name: 'A', project }, subs, GROUPS), 'Give the project as its name or its id.');
  assert.deepEqual([subs.calls, twin.calls.length], [[], 1]);
});

test('a group name is checked against every group, on Home and in every project, as a person would read it, and a project\'s name does not block it', () => {
  const subs = subsFor();
  const groups = [...GROUPS, { id: 'cg-in', name: 'Deep   Work', project: 'cp-w' }];
  for (const project of [undefined, 'Work', 'Home lab']) {
    refused(() => createGroup({ name: 'deep work', project }, subs, groups), /^There is already a group called "Deep Work" \[cg-in\]\. Nothing changed\.$/);
    refused(() => createGroup({ name: ' reviewing', project }, subs, groups), /^There is already a group called "Reviewing" \[cg-d\]/);
  }
  refused(() => createGroup({ name: 'backlog' }, subs, groups), /\[cg-b, cg-c\]/);
  for (const twin of ['Review"ing', '[Reviewing]']) refused(() => createGroup({ name: twin }, subs, groups), /^There is already a group called "Reviewing" \[cg-d\]/);
  refused(() => createGroup({ name: 'Cafe\u0301' }, subs, [{ id: 'cg-e', name: 'Caf\u00E9' }]), /^There is already a group called "Caf\u00E9" \[cg-e\]/);
  refused(() => createGroup({ name: 'Caf\u00E9' }, subs, [{ id: 'cg-e', name: 'Cafe"\u0301' }]), /\[cg-e\]/);
  assert.deepEqual(subs.calls, []);
  assert.match(createGroup({ name: 'Work', project: 'Work' }, subs, groups), /^Created the group "Work" \[cg-Work\] in the project "Work"\./);
  assert.match(createGroup({ name: 'Home lab' }, subs, groups), /on Home\./);
});

test('no one character, wherever it sits, gets a new name past the duplicate check with the same card as a group that exists', () => {
  const subs = subsFor();
  const groups = [{ id: 'cg-s', name: 'Dep loy' }, { id: 'cg-p', name: 'Deploy' }];
  const cards = groups.map(group => layoutSummary('create_group', { name: group.name }, subs, groups));
  for (let point = 0; point <= 0x10FFFF; point++) {
    if (point >= 0xD800 && point <= 0xDFFF) continue;
    const one = String.fromCodePoint(point);
    for (const name of [`Dep${one}loy`, `Dep loy${one}`, `Deploy${one}`, `De${one}ploy`]) {
      if (!cards.includes(layoutSummary('create_group', { name }, subs, groups))) continue;
      assert.throws(() => createGroup({ name }, subs, groups), undefined, `U+${point.toString(16)} in ${JSON.stringify(name)}`);
    }
    if (showsNothing(one) && !/\s/u.test(one)) refused(() => createGroup({ name: `A${one}B` }, subs, groups), /draws nothing/);
  }
  assert.deepEqual(subs.calls, []);
});

test('a group whose name holds a character that draws nothing, as the sidebar can make, blocks a new name that reads the same with that character as a space or gone', () => {
  const subs = subsFor();
  const blank = new Set(['\u2800', '\u3164']);
  for (let point = 0; point <= 0x10FFFF; point++) {
    if (point >= 0xD800 && point <= 0xDFFF) continue;
    const one = String.fromCodePoint(point);
    const groups = [{ id: 'cg-x', name: `Dep${one}loy` }];
    const card = layoutSummary('create_group', { name: groups[0].name }, subs, groups);
    for (const name of ['Dep loy', 'Deploy']) {
      const looks = layoutSummary('create_group', { name }, subs, groups) === card || (blank.has(one) && name === 'Dep loy');
      if (looks) assert.throws(() => createGroup({ name }, subs, groups), /\[cg-x\]/, `U+${point.toString(16)} against ${name}`);
    }
  }
  assert.deepEqual(subs.calls, []);
});

test('a group whose name mixes characters that draw nothing blocks a new name with the same letters, wherever they sit', () => {
  const subs = subsFor();
  const unseen = [];
  for (let point = 0; point <= 0x10FFFF; point++) if ((point < 0xD800 || point > 0xDFFF) && /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u.test(String.fromCodePoint(point))) unseen.push(String.fromCodePoint(point));
  const sample = unseen.filter((_, i) => i % 97 === 0).concat('\u034F', '\uFE0F', '\u200B', '\u00AD', '\u2800', '\u3164');
  for (const a of sample) for (const b of sample) {
    const groups = [{ id: 'cg-x', name: `D${a}ep loy`.replace(' ', b) }, { id: 'cg-y', name: `Dep${a}lo${b}y` }];
    for (const group of groups) for (const name of ['Dep loy', 'Deploy', 'De ploy']) assert.throws(() => createGroup({ name }, subs, [group]), /\[cg-[xy]\]/, `${JSON.stringify(group.name)} against ${name}`);
  }
  assert.deepEqual(subs.calls, []);
});

test('a move card and its reply show a group name without its quotes and brackets, so a name cannot pass itself off as another group with its id', () => {
  const subs = subsFor();
  const groups = [{ id: 'cg-dep', name: 'Deploy' }, { id: 'cg-n', name: 'Deploy" [cg-dep' }];
  const card = layoutSummary('move_session_to_group', { session_id: 'review', group: 'cg-n' }, subs, groups);
  assert.match(card, /to "Deploy cg-dep" \[cg-n\]$/);
  assert.match(moveSession({ session_id: 'review', group: 'cg-n' }, subs, groups), /to the group "Deploy cg-dep"\./);
});

test('two groups or projects of one name give cards that read differently, since each card shows the id the call resolved', () => {
  const subs = subsFor({ projects: [{ id: 'cp-1', name: 'Work' }, { id: 'cp-2', name: 'Work' }] });
  const groups = [{ id: 'cg-1', name: 'Deploy' }, { id: 'cg-2', name: 'Deploy' }];
  const move = group => layoutSummary('move_session_to_group', { session_id: 'review', group }, subs, groups);
  assert.equal(move('cg-1'), 'move "Review - dialogs" [review] to "Deploy" [cg-1]');
  assert.equal(move('cg-2'), 'move "Review - dialogs" [review] to "Deploy" [cg-2]');
  assert.equal(move('Deploy'), 'move "Review - dialogs" [review] to "Deploy"', 'an ambiguous name shows as given, with no id');
  const create = project => layoutSummary('create_group', { name: 'Fresh', project }, subs, groups);
  assert.equal(create('cp-1'), 'create the group "Fresh" in the project "Work" [cp-1]');
  assert.equal(create('cp-2'), 'create the group "Fresh" in the project "Work" [cp-2]');
  assert.equal(create('Work'), 'create the group "Fresh" in the project "Work"', 'an ambiguous name shows as given, with no id');
});

test('an emoji joined into one picture blocks the same emoji written apart', () => {
  const subs = subsFor();
  const groups = [{ id: 'cg-f', name: 'Family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}' }];
  refused(() => createGroup({ name: 'Family \u{1F468} \u{1F469} \u{1F467}' }, subs, groups), /\[cg-f\]/);
  refused(() => createGroup({ name: 'Family \u{1F468}\u{1F469}\u{1F467}' }, subs, groups), /\[cg-f\]/);
  assert.deepEqual(subs.calls, []);
});

test('a new name may hold only letters, marks, numbers, punctuation, spaces, symbols that are not pictures and emoji, so no character can draw a blank on a card', () => {
  const subs = subsFor();
  const plainly = /^[\p{L}\p{M}\p{N}\p{P}\p{Sm}\p{Sc}\p{Sk}\s]$/u;
  const unseen = /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\uFFFC]/u;
  for (let point = 0; point <= 0x10FFFF; point++) {
    if (point >= 0xD800 && point <= 0xDFFF) continue;
    const one = String.fromCodePoint(point);
    let made = false;
    try { made = createGroup({ name: `A${one}B` }, subs, []).startsWith('Created'); } catch { /* refused */ }
    if (made) assert.ok((plainly.test(one) && !unseen.test(one)) || /^\p{RGI_Emoji}$/v.test(one), `U+${point.toString(16)} was let in`);
  }
  for (const blank of ['\uFFFC', '\u2800', '\u3164']) refused(() => createGroup({ name: `Deploy${blank}Prod` }, subs, []), /draws nothing/);
});

test('ordinary names still pass the list of what draws plainly', () => {
  const subs = subsFor();
  for (const name of ['Needs Review', 'Q3 plan (draft)', 'Caf\u00E9', '\u65E5\u672C\u8A9E', 'Ops & Infra', '#123 fix', '50% off', '\u{1F4E9} Review', 'C++/C#', 'a = b + c', '$5 cap', 'v1.2-beta']) {
    assert.match(createGroup({ name }, subs, []), /^Created/, name);
  }
});

test('a group whose name holds U+FFFC, as the sidebar can make, blocks a new name with a space there', () => {
  const subs = subsFor();
  refused(() => createGroup({ name: 'Deploy Prod' }, subs, [{ id: 'cg-o', name: 'Deploy\uFFFCProd' }]), /\[cg-o\]/);
  assert.deepEqual(subs.calls, []);
});

test('a new name is stored and carded in its composed form, so a compatibility ideograph cannot draw as a blank on the card', () => {
  const subs = subsFor();
  assert.equal(layoutSummary('create_group', { name: 'Team \uFA2E' }, subs, []), 'create the group "Team \u90DE" on Home');
  createGroup({ name: 'Team \uFA2E' }, subs, []);
  assert.deepEqual(subs.calls, [['addGroup', 'Team \u90DE', null]]);
});

test('a new name keeps the joiners inside an emoji', () => {
  const subs = subsFor();
  for (const name of ['\u{1F9D1}\u200D\u{1F4BB} Dev', '\u2699\uFE0F Ops']) assert.equal(createGroup({ name }, subs, []).startsWith('Created'), true);
  refused(() => createGroup({ name: 'Ops\uFE0F' }, subs, []), /draws nothing/);
  assert.equal(subs.calls.length, 2);
});

test('a group name that is missing, not text, blank or over 80 characters is refused, and so is a project name the server cannot find', () => {
  const subs = subsFor();
  for (const name of [undefined, null, 5]) refused(() => createGroup({ name }, subs, GROUPS), 'Give the name as name.');
  for (const name of ['  ', '\u200B', '""', '[]']) refused(() => createGroup({ name }, subs, GROUPS), 'Give it a name.');
  refused(() => createGroup({ name: 'x'.repeat(81) }, subs, GROUPS), 'Names run to 80 characters at most.');
  const gone = { ...subs, projects: () => PROJECTS, addGroup() { throw status(404, 'Unknown project.'); } };
  refused(() => createGroup({ name: 'A', project: 'Work' }, gone, GROUPS), 'Unknown project.');
  assert.deepEqual(subs.calls, []);
});

test('the card for a new project or group names it, says where it goes, and cannot be forged by quotes or brackets in a name', () => {
  const subs = subsFor();
  const card = (tool, input) => layoutSummary(tool, input, subs, GROUPS);
  assert.equal(card('create_project', { name: 'Side work' }), 'create the project "Side work"');
  assert.equal(card('create_group', { name: 'Fresh' }), 'create the group "Fresh" on Home');
  assert.equal(card('create_group', { name: 'Fresh', project: '' }), 'create the group "Fresh" on Home');
  assert.equal(card('create_group', { name: 'Fresh', project: 'cp-w' }), 'create the group "Fresh" in the project "Work" [cp-w]');
  assert.equal(card('create_group', { name: 'Fresh', project: 'home LAB' }), 'create the group "Fresh" in the project "Home lab" [cp-h]', 'a name reaches the project the call writes into');
  assert.equal(card('create_group', { name: 'Fresh', project: 'Nowhere' }), 'create the group "Fresh" in the project "Nowhere"', 'a project that does not resolve shows as given');
  assert.equal(card('create_group', { name: 'Fresh', project: 5 }), 'create the group "Fresh" in the project "5"');
  assert.equal(card('create_project', { name: 'a" and "b' }), 'create the project "a and b"');
  assert.equal(card('create_group', { name: 'x" on Home', project: '[evil] "y"' }), 'create the group "x on Home" in the project "evil y"');
  assert.equal(card('create_project', {}), 'create the project ""');
  assert.equal(card('create_group', undefined), 'create the group "" on Home');
});

test('the card for a new group says the project when its list cannot be read, and never throws', () => {
  const broken = { projects() { throw new Error('layout broke'); } };
  assert.equal(layoutSummary('create_group', { name: 'G', project: 'Work' }, broken, GROUPS), 'create the group "G" in the project "Work"');
  assert.equal(layoutSummary('create_group', { name: 'G' }, broken, GROUPS), 'create the group "G" on Home');
  assert.equal(layoutSummary('create_project', { name: 'P' }, undefined, GROUPS), 'create the project "P"');
});

test('a project is named the way a group is, by id first, and a group and a project may share a name', () => {
  assert.deepEqual(projectNamed('cp-h', PROJECTS, 'create_group'), { project: PROJECTS[1] });
  assert.deepEqual(projectNamed(' WORK ', PROJECTS, 'create_group'), { project: PROJECTS[0] });
  assert.deepEqual(groupNamed('Work', [{ id: 'g', name: 'Work' }], 'move_session_to_group'), { group: { id: 'g', name: 'Work' } });
  assert.deepEqual(groupNamed('Cafe\u0301', [{ id: 'g', name: 'Caf\u00E9' }], 'spawn_task').group?.id, 'g', 'a lookup makes the same match the duplicate check does');
  for (const value of ['"', '[', '\u200B']) assert.match(groupNamed(value, [{ id: 'g', name: '[]' }], 'spawn_task').refusal, /has no group called/, 'a name with nothing to read matches nothing');
});

test('create_project and create_group answer through the tool call, with the project looked up from the callbacks', () => {
  const subs = subsFor();
  const groups = () => PLACED;
  const call = (name, args) => rpc('tools/call', { name, arguments: args }, { subs, groups }).result;
  assert.match(call('create_project', { name: 'New one' }).content[0].text, /^Created the project "New one" \[cp-New one\]/);
  assert.match(call('create_group', { name: 'Fresh', project: 'work' }).content[0].text, /^Created the group "Fresh" \[cg-Fresh\] in the project "Work"/);
  assert.deepEqual(call('create_group', { name: 'backlog' }), { content: [{ type: 'text', text: 'There is already a group called "Backlog" [cg-b, cg-c]. Nothing changed.' }], isError: true });
  assert.equal(call('create_project', { name: 'Work' }).isError, true);
  assert.match(call('move_group_to_project', { group: 'inside', project: 'home lab' }).content[0].text, /^Moved the group "Inside" \[cg-in\] into the project "Home lab" \[cp-h\]/);
  assert.equal(call('move_group_to_project', { group: 'Pinned' }).isError, true);
  assert.equal(call('move_project', { project: 'home lab', before: 'work' }).content[0].text, 'Moved the project "Home lab" [cp-h] before "Work" [cp-w].');
  assert.equal(call('move_project', { project: 'home lab' }).isError, true);
  assert.match(call('move_routine_to_project', { routine: 'weekly report', project: 'home lab' }).content[0].text, /^Moved the routine "Weekly report" \[weekly-report\] into the project "Home lab" \[cp-h\]/);
  assert.equal(call('move_routine_to_project', { routine: 'nothing' }).isError, true);
});

// Where each group sits: Inside is in Work, Orphan names a project that is gone and so shows on Home, the others are on Home.
const PLACED = [...GROUPS, { id: 'cg-in', name: 'Inside', project: 'cp-w' }, { id: 'cg-orphan', name: 'Orphan', project: 'cp-gone' }];

test('a group moves into a project by its name in any case or by id, and back to Home with a missing, null or blank project, and the reply gives names and ids', () => {
  const subs = subsFor();
  assert.equal(moveGroupToProject({ group: ' needs REVIEW ', project: 'work' }, subs, PLACED), 'Moved the group "Needs Review" [cg-a] into the project "Work" [cp-w]. Its sessions moved with it.');
  assert.match(moveGroupToProject({ group: 'cg-d', project: 'cp-h' }, subs, PLACED), /^Moved the group "Reviewing" \[cg-d\] into the project "Home lab" \[cp-h\]\./);
  for (const project of [undefined, null, '', '  ']) assert.equal(moveGroupToProject({ group: 'inside', project }, subs, PLACED), 'Moved the group "Inside" [cg-in] to Home. Its sessions moved with it.');
  assert.deepEqual(subs.calls, [['moveGroup', 'cg-a', 'cp-w'], ['moveGroup', 'cg-d', 'cp-h'], ...Array(4).fill(['moveGroup', 'cg-in', null])]);
});

test('a group already where it is asked to go is answered with nothing written, and one in a project that is gone is on Home', () => {
  const subs = subsFor();
  assert.equal(moveGroupToProject({ group: 'inside', project: 'WORK' }, subs, PLACED), 'The group "Inside" [cg-in] is already in the project "Work" [cp-w]. Nothing changed.');
  assert.equal(moveGroupToProject({ group: 'reviewing' }, subs, PLACED), 'The group "Reviewing" [cg-d] is already on Home. Nothing changed.');
  assert.match(moveGroupToProject({ group: 'orphan', project: null }, subs, PLACED), /already on Home/);
  assert.deepEqual(subs.calls, []);
  assert.match(moveGroupToProject({ group: 'orphan', project: 'work' }, subs, PLACED), /^Moved the group "Orphan"/);
});

test('moving a group is refused for an unknown or ambiguous group or project with the names, a section, a non-text group or project, and the route\'s own refusals pass through', () => {
  const subs = subsFor();
  refused(() => moveGroupToProject({ group: 'Nowhere', project: 'work' }, subs, PLACED), 'move_group_to_project has no group called "Nowhere". The groups are "Needs Review", "Backlog", "backlog", "Reviewing", "Inside", "Orphan".');
  refused(() => moveGroupToProject({ group: 'BACKLOG' }, subs, PLACED), 'move_group_to_project group "BACKLOG" matches 2 groups, so it is ambiguous. Use the id of one of them instead: cg-b, cg-c.');
  refused(() => moveGroupToProject({ group: 'inside', project: 'Nowhere' }, subs, PLACED), 'move_group_to_project has no project called "Nowhere". The projects are "Work", "Home lab".');
  const twin = subsFor({ projects: [{ id: 'cp-1', name: 'Work' }, { id: 'cp-2', name: 'work' }] });
  refused(() => moveGroupToProject({ group: 'cg-d', project: 'WORK' }, twin, PLACED), 'move_group_to_project project "WORK" matches 2 projects, so it is ambiguous. Use the id of one of them instead: cp-1, cp-2.');
  for (const group of ['Pinned', ' routines ', 'pinned', 'ungrouped']) refused(() => moveGroupToProject({ group, project: 'work' }, subs, PLACED), /^"[A-Za-z ]+" \[(pinned|routines|started|ungrouped|other)\] is a section of Home, not a group, so it cannot move into a project\.$/);
  refused(() => moveGroupToProject({ group: WORK_CHAT, project: 'work' }, subs, PLACED), /^move_group_to_project has no group called/);
  for (const group of [undefined, null, '', '  ', 5, ['Reviewing']]) refused(() => moveGroupToProject({ group, project: 'work' }, subs, PLACED), 'Give the group as group, by its name as the sidebar shows it or by its id.');
  for (const project of [5, true, ['Work'], {}]) refused(() => moveGroupToProject({ group: 'cg-d', project }, subs, PLACED), 'Give the project as its name or its id.');
  refused(() => moveGroupToProject({ group: 'ghost', project: 'work' }, subs, [{ id: 'cg-ghost', name: 'Ghost' }]), 'Unknown group.');
  assert.deepEqual(subs.calls, []);
});

test('a group with the same name as a section is moved, not refused as a section', () => {
  const subs = subsFor();
  assert.match(moveGroupToProject({ group: 'Pinned', project: 'work' }, subs, [{ id: 'cg-d', name: 'Pinned' }]), /^Moved the group "Pinned" \[cg-d\] into the project/);
});

test('the card for moving a group names it and where it goes, shows an unresolved name as given without quotes or brackets, and cannot say Home for a project the call writes into', () => {
  const subs = subsFor();
  const card = input => layoutSummary('move_group_to_project', input, subs, PLACED);
  assert.equal(card({ group: 'needs review', project: 'WORK' }), 'move the group "Needs Review" [cg-a] to the project "Work" [cp-w]');
  assert.equal(card({ group: 'cg-in', project: 'cp-h' }), 'move the group "Inside" [cg-in] to the project "Home lab" [cp-h]');
  for (const project of [undefined, null, '']) assert.equal(card({ group: 'inside', project }), 'move the group "Inside" [cg-in] to Home');
  assert.equal(card({ group: 'Nobody', project: 'Nowhere' }), 'move the group "Nobody" to the project "Nowhere"');
  assert.equal(card({ group: 'x" [evil] to Home', project: '[evil] "y"' }), 'move the group "x evil to Home" to the project "evil y"');
  assert.equal(card({ group: 'pinned', project: 'work' }), 'move the group "pinned" to the project "Work" [cp-w]');
  assert.equal(card({ group: 'inside', project: 5 }), 'move the group "Inside" [cg-in] to the project "5"');
  assert.equal(card({ group: 5 }), 'move the group "" to Home');
  assert.equal(layoutSummary('move_group_to_project', undefined, subs, PLACED), 'move the group "" to Home');
});

test('the card for moving a group says which account its sessions will run on, or that they may change account, and adds nothing when it stays the same', () => {
  const card = answer => layoutSummary('move_group_to_project', { group: 'inside', project: 'work' }, { ...subsFor(), groupAccount: (id, project) => { assert.deepEqual([id, project], ['cg-in', 'cp-w']); return answer; } }, PLACED);
  assert.equal(card({ changes: false }), 'move the group "Inside" [cg-in] to the project "Work" [cp-w]');
  assert.equal(card({ changes: true, to: 'Team', active: false }), 'move the group "Inside" [cg-in] to the project "Work" [cp-w], which runs its sessions on Team');
  assert.equal(card({ changes: true, to: 'Main', active: true }), 'move the group "Inside" [cg-in] to the project "Work" [cp-w], which runs its sessions on the active account, now Main');
  assert.equal(card({ changes: true, to: 'Team', spills: true, overflow: null }), 'move the group "Inside" [cg-in] to the project "Work" [cp-w], which runs its sessions on Team, with no overflow account');
  assert.equal(card({ changes: true }), 'move the group "Inside" [cg-in] to the project "Work" [cp-w], which may change the account its sessions run on');
  assert.equal(layoutSummary('move_group_to_project', { group: 'inside', project: 'Nowhere' }, { ...subsFor(), groupAccount: () => assert.fail('no account for a project that does not resolve') }, PLACED), 'move the group "Inside" [cg-in] to the project "Nowhere"');
});

test('the card for moving a group still reads when the project list cannot be read, and never throws', () => {
  const broken = { projects() { throw new Error('layout broke'); } };
  assert.equal(layoutSummary('move_group_to_project', { group: 'inside', project: 'Work' }, broken, PLACED), 'move the group "Inside" [cg-in] to the project "Work"');
  assert.equal(layoutSummary('move_group_to_project', { group: 'inside' }, broken, PLACED), 'move the group "Inside" [cg-in] to Home');
});

test('a routine moves into a project by its title in any case or by id, and back to Home with a missing, null or blank project, and the reply gives names and ids', () => {
  const subs = subsFor();
  assert.equal(moveRoutineToProject({ routine: ' weekly REPORT ', project: 'work' }, subs), 'Moved the routine "Weekly report" [weekly-report] into the project "Work" [cp-w]. Its runs moved with it.');
  assert.match(moveRoutineToProject({ routine: 'daily-digest', project: 'cp-h' }, subs), /^Moved the routine "Daily digest" \[daily-digest\] into the project "Home lab" \[cp-h\]\./);
  for (const project of [undefined, null, '', '  ']) assert.equal(moveRoutineToProject({ routine: 'daily digest', project }, subs), 'Moved the routine "Daily digest" [daily-digest] to Home. Its runs moved with it.');
  assert.deepEqual(subs.calls, [['moveRoutine', 'weekly-report', 'cp-w'], ['moveRoutine', 'daily-digest', 'cp-h'], ...Array(4).fill(['moveRoutine', 'daily-digest', null])]);
});

test('a routine already where it is asked to go is answered with nothing written, and one linked to a project that is gone is on Home', () => {
  const subs = subsFor();
  assert.equal(moveRoutineToProject({ routine: 'daily digest', project: 'WORK' }, subs), 'The routine "Daily digest" [daily-digest] is already in the project "Work" [cp-w]. Nothing changed.');
  assert.equal(moveRoutineToProject({ routine: 'weekly report' }, subs), 'The routine "Weekly report" [weekly-report] is already on Home. Nothing changed.');
  assert.match(moveRoutineToProject({ routine: 'lost link', project: null }, subs), /already on Home/);
  assert.deepEqual(subs.calls, []);
  assert.match(moveRoutineToProject({ routine: 'lost link', project: 'work' }, subs), /^Moved the routine "Lost link"/);
});

test('moving a routine is refused for an unknown or ambiguous routine or project with the names, a non-text routine or project, and the route\'s own refusals pass through', () => {
  const subs = subsFor();
  refused(() => moveRoutineToProject({ routine: 'Nowhere', project: 'work' }, subs), 'move_routine_to_project has no routine called "Nowhere". The routines are "Daily digest", "Weekly report", "Lost link", "Tidy up", "tidy UP".');
  refused(() => moveRoutineToProject({ routine: 'TIDY up', project: 'work' }, subs), 'move_routine_to_project routine "TIDY up" matches 2 routines, so it is ambiguous. Use the id of one of them instead: tidy-1, tidy-2.');
  refused(() => moveRoutineToProject({ routine: 'daily digest', project: 'Nowhere' }, subs), 'move_routine_to_project has no project called "Nowhere". The projects are "Work", "Home lab".');
  const twin = subsFor({ projects: [{ id: 'cp-1', name: 'Work' }, { id: 'cp-2', name: 'work' }] });
  refused(() => moveRoutineToProject({ routine: 'daily digest', project: 'WORK' }, twin), 'move_routine_to_project project "WORK" matches 2 projects, so it is ambiguous. Use the id of one of them instead: cp-1, cp-2.');
  for (const routine of [undefined, null, '', '  ', 5, ['Daily digest']]) refused(() => moveRoutineToProject({ routine, project: 'work' }, subs), 'Give the routine as routine, by its title as the routines list shows it or by its id.');
  for (const project of [5, true, ['Work'], {}]) refused(() => moveRoutineToProject({ routine: 'daily digest', project }, subs), 'Give the project as its name or its id.');
  refused(() => moveRoutineToProject({ routine: 'daily digest', project: 'home lab' }, { ...subs, moveRoutine() { throw status(404, 'Unknown routine.'); } }), 'Unknown routine.');
  assert.deepEqual(subs.calls, []);
});

test('the card for moving a routine names it and where it goes with ids, shows an unresolved name as given without quotes or brackets, and still reads when the lists cannot be read', () => {
  const subs = subsFor();
  const card = input => layoutSummary('move_routine_to_project', input, subs, []);
  assert.equal(card({ routine: 'daily DIGEST', project: 'WORK' }), 'move the routine "Daily digest" [daily-digest] to the project "Work" [cp-w]');
  assert.equal(card({ routine: 'weekly-report', project: 'cp-h' }), 'move the routine "Weekly report" [weekly-report] to the project "Home lab" [cp-h]');
  for (const project of [undefined, null, '']) assert.equal(card({ routine: 'weekly report', project }), 'move the routine "Weekly report" [weekly-report] to Home');
  assert.equal(card({ routine: 'Nobody', project: 'Nowhere' }), 'move the routine "Nobody" to the project "Nowhere"');
  assert.equal(card({ routine: 'x" [evil] to Home', project: '[evil] "y"' }), 'move the routine "x evil to Home" to the project "evil y"');
  assert.equal(card({ routine: 'tidy up', project: 'work' }), 'move the routine "tidy up" to the project "Work" [cp-w]');
  assert.equal(card({ routine: 5 }), 'move the routine "" to Home');
  assert.equal(layoutSummary('move_routine_to_project', undefined, subs, []), 'move the routine "" to Home');
  const broken = { projects() { throw new Error('layout broke'); }, routines() { throw new Error('routines broke'); } };
  assert.equal(layoutSummary('move_routine_to_project', { routine: 'daily digest', project: 'Work' }, broken, []), 'move the routine "daily digest" to the project "Work"');
});

const CHIPS = [
  { id: 'task_a', toolUseId: 't1', sessionId: 'top', title: 'Review - dialogs', status: 'started', startedId: 'review', at: NOW - 2 * DAY },
  { id: 'task_b', toolUseId: 't2', sessionId: 'top', title: 'Fix the footer', status: 'open', at: NOW - 5 * MINUTE },
  { id: 'task_c', toolUseId: 't3', sessionId: 'busy', title: 'Review - menus', status: 'dismissed', at: NOW - DAY },
  { toolUseId: 't4', title: 'From Desktop', status: 'started', startedId: 'old' },
];
const chipsOf = list => ({ list: () => list });

test('list_chips gives the newest first, each with its task id, status, the session it started, the session that made it and when, and a chip with no time last', () => {
  const text = listChips({}, chipsOf(CHIPS), NOW);
  assert.match(text, /^4 chips, the newest first\n\n/);
  const lines = text.split('\n').filter(l => l.startsWith('- '));
  assert.deepEqual(lines.map(l => /^- (.*?)( \[task_\w+\])? ·/.exec(l)[1]), ['Fix the footer', 'Review - menus', 'Review - dialogs', 'From Desktop']);
  assert.match(lines[0], /\[task_b\] · open · made by \[top\] · 2026-10-28T05:55:00\.000Z \(5 minutes ago\)$/);
  assert.match(lines[2], /\[task_a\] · started · started session \[review\] · made by \[top\]/);
  assert.match(lines[3], / · started · started session \[old\] · time unknown$/);
});

test('list_chips filters by title, status and the session that made the chip, which combine, and stops at the limit, 50 unless another is asked for', () => {
  const ids = args => listChips(args, chipsOf(CHIPS), NOW).split('\n').filter(l => l.startsWith('- ')).map(l => /\[(task_\w+)\]/.exec(l)?.[1] ?? 'none');
  assert.deepEqual(ids({ query: 'REVIEW' }), ['task_c', 'task_a']);
  assert.deepEqual(ids({ status: 'started' }), ['task_a', 'none']);
  assert.deepEqual(ids({ session_id: 'top' }), ['task_b', 'task_a']);
  assert.deepEqual(ids({ session_id: 'top', status: 'started', query: 'dialogs' }), ['task_a']);
  assert.equal(listChips({ query: 'nothing' }, chipsOf(CHIPS), NOW), 'No chips match.');
  assert.equal(listChips({}, chipsOf([]), NOW), 'No chips match.');
  refused(() => listChips({ status: 'done' }, chipsOf(CHIPS), NOW), 'status must be one of open, started, dismissed.');
  const many = Array.from({ length: 230 }, (_, n) => ({ id: `task_${n}`, title: `Chip ${n}`, status: 'open', at: NOW - n * MINUTE }));
  assert.equal(ids({}).length, 4);
  const count = args => listChips(args, chipsOf(many), NOW).split('\n').filter(l => l.startsWith('- ')).length;
  assert.deepEqual([count({}), count({ limit: 7 }), count({ limit: 9999 })], [50, 7, 200]);
  assert.match(listChips({ limit: 7 }, chipsOf(many), NOW), /\n\n… and 223 more, past the limit of 7\.$/);
});

const rpc = (method, params, ctx) => handleMcp({ jsonrpc: '2.0', id: 7, method, params }, ctx);
const names = reply => reply.result.tools.map(t => t.name);
const LAYOUT = ['list_chips', 'find_sessions', 'archive_session', 'unarchive_session', 'set_session_title', 'move_session_to_group', 'nest_session', 'unnest_session', 'create_project', 'create_group', 'move_group_to_project', 'move_project', 'move_routine_to_project'];

test('the thirteen tools are listed to every chat that is given callbacks, an ordinary one, a group\'s and a section\'s, and to none that is not', () => {
  const subs = subsFor();
  const group = { lookup: () => null };
  const section = { section: { id: 'pinned', name: 'Pinned', place: 'pin' }, lookup: () => null };
  assert.deepEqual(names(rpc('tools/list', {}, { subs })).slice(-13), LAYOUT);
  assert.deepEqual(names(rpc('tools/list', {}, { subs, group })).slice(-13), LAYOUT);
  assert.deepEqual(names(rpc('tools/list', {}, { subs, group: section })).slice(-13), LAYOUT);
  for (const ctx of [{}, { group }, { group: section }]) assert.deepEqual(names(rpc('tools/list', {}, ctx)).filter(n => LAYOUT.includes(n)), [], 'no callbacks, no tools');
});

test('each write says when the owner approves it, every description is short and plain, and the send tools point at find_sessions', () => {
  const tools = rpc('tools/list', {}, { subs: subsFor() }).result.tools;
  const inTree = /owner approves it unless it is this session, your parent, a sibling or a session below this one\./;
  for (const tool of tools.filter(t => LAYOUT.includes(t.name))) {
    assert.ok(tool.description.length < 420, `${tool.name} is sent with every request, so its description stays short`);
    assert.doesNotMatch(tool.description, /[–—]|Capcom/);
    assert.equal(/owner approves every call/.test(tool.description), ['archive_session', 'unarchive_session', 'nest_session', 'create_project', 'create_group', 'move_group_to_project', 'move_project', 'move_routine_to_project'].includes(tool.name), tool.name);
    assert.equal(inTree.test(tool.description), ['set_session_title', 'move_session_to_group', 'unnest_session'].includes(tool.name), tool.name);
  }
  for (const group of [{ lookup: () => null }, { section: { id: 'pinned', name: 'Pinned', place: 'pin' }, lookup: () => null }]) {
    for (const tool of rpc('tools/list', {}, { subs: subsFor(), group }).result.tools.filter(t => LAYOUT_WRITE_NAMES.includes(`mcp__capcom__${t.name}`))) {
      assert.match(tool.description, /owner approves every call/, `a group's or section's ${tool.name} asks every time`);
      assert.doesNotMatch(tool.description, inTree, tool.name);
    }
  }
  const send = tools.find(t => t.name === 'send_session');
  assert.match(send.description, /find_sessions/);
  assert.match(send.description, /unarchive_session/);
  assert.doesNotMatch(send.description, /No tool lists/);
  const group = rpc('tools/list', {}, { subs: subsFor(), group: { lookup: () => null } }).result.tools.find(t => t.name === 'send_session');
  assert.match(group.description, /find_sessions/);
  assert.doesNotMatch(group.description, /No tool lists/);
  const find = tools.find(t => t.name === 'find_sessions');
  assert.deepEqual(find.inputSchema.required, ['query']);
  assert.match(find.inputSchema.properties.include_archived.description, /^Defaults to true/);
  assert.deepEqual(tools.find(t => t.name === 'list_chips').inputSchema.properties.status.enum, ['open', 'started', 'dismissed']);
  assert.deepEqual(tools.find(t => t.name === 'move_session_to_group').inputSchema.required, ['session_id', 'group']);
});

test('the writes are named for the runner to hold for a card, the reads are named to run without one, and none is a tool every chat is allowed', () => {
  assert.deepEqual(LAYOUT_WRITE_NAMES, ['archive_session', 'unarchive_session', 'set_session_title', 'move_session_to_group', 'nest_session', 'unnest_session', 'create_project', 'create_group', 'move_group_to_project', 'move_project', 'move_routine_to_project'].map(n => `mcp__capcom__${n}`));
  assert.deepEqual(TREE_WRITE_NAMES, ['set_session_title', 'move_session_to_group', 'unnest_session'].map(n => `mcp__capcom__${n}`), 'archiving, unarchiving and making a project or group ask for every target');
  assert.deepEqual(LAYOUT_READ_NAMES, ['list_chips', 'find_sessions'].map(n => `mcp__capcom__${n}`));
  for (const name of [...LAYOUT_WRITE_NAMES, ...LAYOUT_READ_NAMES]) {
    assert.equal(TOOL_NAMES.includes(name), false, `${name} would be allowed in a chat that has no callbacks`);
    assert.equal(SUB_READ_NAMES.includes(name) || name === SEND_NAME, false);
  }
});

test('the tool call gives the outcome as text and a refusal as an error, and a chat with no callbacks has no such tool', () => {
  const subs = subsFor();
  const groups = () => GROUPS;
  const call = (ctx, name, args) => rpc('tools/call', { name, arguments: args }, ctx).result;
  assert.match(call({ subs }, 'archive_session', { session_id: 'review' }).content[0].text, /^Archived "Review - dialogs"/);
  assert.deepEqual(call({ subs }, 'archive_session', { session_id: 'top' }), { content: [{ type: 'text', text: 'A session cannot archive itself. Ask the owner to archive it.' }], isError: true });
  assert.match(call({ subs, groups }, 'move_session_to_group', { session_id: 'review', group: 'Reviewing' }).content[0].text, /^Moved /);
  assert.match(call({ subs, groups }, 'move_session_to_group', { session_id: 'review', group: 'backlog' }).content[0].text, /ambiguous/);
  assert.match(call({ subs }, 'find_sessions', { query: 'dialogs' }).content[0].text, /^2 sessions with "dialogs"/);
  assert.match(call({ chips: chipsOf(CHIPS) }, 'list_chips', {}).content[0].text, /^GhostShell has no tool called list_chips\./);
  assert.match(call({ subs, chips: chipsOf(CHIPS) }, 'list_chips', {}).content[0].text, /^4 chips/);
  assert.equal(call({}, 'archive_session', { session_id: 'review' }).content[0].text, 'GhostShell has no tool called archive_session.');
  const broken = { ...subs, archive() { throw new Error('/secret/path broke'); } };
  const failed = call({ subs: broken }, 'archive_session', { session_id: 'review' });
  assert.deepEqual(failed, { content: [{ type: 'text', text: 'archive_session could not finish (error).' }], isError: true });
});

test('a project moves before or after another by name in any case or by id, and the call is the one the route runs', () => {
  const subs = subsFor({ projects: [...PROJECTS, { id: 'cp-x', name: 'Extra' }] });
  assert.equal(moveProject({ project: ' extra ', before: 'WORK' }, subs), 'Moved the project "Extra" [cp-x] before "Work" [cp-w].');
  assert.equal(moveProject({ project: 'cp-w', after: 'cp-x' }, subs), 'Moved the project "Work" [cp-w] after "Extra" [cp-x].');
  assert.deepEqual(subs.calls, [['orderProject', 'cp-x', { before: 'cp-w' }], ['orderProject', 'cp-w', { after: 'cp-x' }]]);
});

test('a project already where it is asked to go is answered with nothing written', () => {
  const subs = subsFor({ projects: [...PROJECTS, { id: 'cp-x', name: 'Extra' }] });
  assert.equal(moveProject({ project: 'work', before: 'home lab' }, subs), 'The project "Work" [cp-w] is already before "Home lab" [cp-h]. Nothing changed.');
  assert.equal(moveProject({ project: 'work', before: 'extra' }, subs), 'Moved the project "Work" [cp-w] before "Extra" [cp-x].');
  assert.equal(moveProject({ project: 'extra', after: 'home lab' }, subs), 'The project "Extra" [cp-x] is already after "Home lab" [cp-h]. Nothing changed.');
  assert.equal(subs.calls.length, 1);
});

test('moving a project is refused for an unknown or ambiguous name with the names, a missing or doubled side, itself and a name that is not text', () => {
  const subs = subsFor();
  refused(() => moveProject({ project: 'Nowhere', before: 'work' }, subs), 'move_project has no project called "Nowhere". The projects are "Work", "Home lab".');
  refused(() => moveProject({ project: 'work', after: 'Nowhere' }, subs), 'move_project has no project called "Nowhere". The projects are "Work", "Home lab".');
  refused(() => moveProject({ project: 'work', after: 'x' }, subsFor({ projects: [] })), 'move_project has no project called "work". There are no projects.');
  const twin = subsFor({ projects: [{ id: 'cp-1', name: 'Work' }, { id: 'cp-2', name: 'work' }, { id: 'cp-3', name: 'Other' }] });
  refused(() => moveProject({ project: 'other', before: 'WORK' }, twin), 'move_project project "WORK" matches 2 projects, so it is ambiguous. Use the id of one of them instead: cp-1, cp-2.');
  refused(() => moveProject({ project: 'work', before: 'work' }, subs), 'The project "Work" [cp-w] cannot go before itself.');
  refused(() => moveProject({ project: 'work', after: 'cp-w' }, subs), 'The project "Work" [cp-w] cannot go after itself.');
  for (const args of [{ project: 'work' }, { project: 'work', before: 'home lab', after: 'home lab' }]) refused(() => moveProject(args, subs), 'Give exactly one of before or after: the project to put it before or after.');
  for (const project of [undefined, null, '', '  ', 5]) refused(() => moveProject({ project, before: 'work' }, subs), 'Give project as a project\'s name or its id.');
  for (const before of ['', 5, ['work']]) refused(() => moveProject({ project: 'work', before }, subs), 'Give before as a project\'s name or its id.');
  assert.deepEqual(subs.calls, []);
});

test('the approval card names both projects with their ids, and echoes a name that matches nothing', () => {
  const subs = subsFor();
  assert.equal(layoutSummary('move_project', { project: 'WORK', after: 'home lab' }, subs, PLACED), 'move the project "Work" [cp-w] after "Home lab" [cp-h]');
  assert.equal(layoutSummary('move_project', { project: 'work', before: 'nope' }, subs, PLACED), 'move the project "Work" [cp-w] before "nope"');
  assert.equal(layoutSummary('move_project', { project: 5 }, subs, PLACED), 'move the project "5" before "undefined"');
});

// The plan is what the server's nestPlan answers: ids and outcomes only. The card's lines and the key both come from it.
const NEST_ROWS = [
  row('top'),
  row('boss', { title: 'Boss', group: 'cg-a' }),
  row('kid', { title: 'Kid', group: 'cg-b' }),
  row('under1', { title: 'Below one', parent: 'kid' }),
  row('under2', { title: 'Below two', parent: 'kid', archived: true }),
  row('mate', { title: 'Mate', parent: 'boss' }),
  row('chipped', { title: 'From a chip' }),
  row('chat', { title: 'Needs Review', groupSession: 'cg-a' }),
];
const PLAN = {
  moved: 'kid', given: 'boss', root: 'boss', redirected: false, parent: null,
  before: { group: 'cg-b', pinned: false, section: null, project: null },
  after: { group: 'cg-a', pinned: false, section: null, project: null },
  account: { changes: false }, under: [], lost: [], reads: [], chats: [['group:cg-a', ['kid']]], sends: [], shifted: [], openProject: false, family: ['boss', 'mate'], caller: null, callerChat: null,
};
const FULL = {
  ...PLAN, given: 'mate', redirected: true, parent: 'top', under: ['under1', 'under2'], lost: ['under1'], chats: [['group:cg-a', ['kid', 'under1', 'under2']]], sends: [['chipped', 'boss']], caller: 'family', callerChat: 'cg-a',
  before: { group: 'cg-b', pinned: true, section: 'pinned', project: 'cp-h' },
  after: { group: 'cg-a', pinned: false, section: null, project: 'cp-w' },
  account: { changes: true, to: 'Work', active: false, below: 2 },
};

// A nest as the server does it, for a plan: the plan is answered for the one nest it was made for, and a refusal or any other error can be given instead.
function nestSubs({ plan = PLAN, fail, rows = NEST_ROWS } = {}) {
  const subs = subsFor({ rows });
  subs.nestPlan = (id, parent) => {
    subs.calls.push(['plan', id, parent]);
    if (fail) throw fail;
    return plan;
  };
  subs.nest = (id, parent) => { subs.calls.push(['nest', id, parent]); return { parent: plan.root }; };
  subs.unnest = id => { subs.calls.push(['unnest', id]); return rows.find(r => r.id === id)?.parent ? { nested: true, from: rows.find(r => r.id === id).parent, place: PLAN.before } : { nested: false }; };
  return subs;
}
const ofCalls = (subs, kind) => subs.calls.filter(c => c[0] === kind);
// What the runner holds for a call: the key of the card the owner approved, handed over once.
const approvals = (key, id = 'use-1') => {
  const held = new Map(key === undefined ? [] : [[id, key]]);
  return { takeNest: useId => { const got = held.get(useId); held.delete(useId); return got; }, toolUseId: id, held };
};

test('the card for a nest has the action first and then one line for each consequence that applies', () => {
  const lines = nestLines(PLAN, nestSubs(), GROUPS);
  assert.deepEqual(lines, [
    'nest "Kid" [kid] under "Boss" [boss]',
    '"Boss" [boss] can then read it.',
    'It, "Boss" [boss] and the 1 other session in that family can then message, rename, move and take out one another with no card.',
    'It leaves the group "Backlog" [cg-b] and shows under "Boss" [boss] in the group "Needs Review" [cg-a].',
    'The chat of the group "Needs Review" [cg-a] can then read it.',
    'Archiving "Boss" [boss] archives it.',
  ]);
});

test('the card says every consequence a nest has: the redirect, who reads what, what is lost, the place and project, the account, the chips and the caller', () => {
  const lines = nestLines(FULL, nestSubs(), GROUPS);
  assert.equal(lines[0], 'nest "Kid" [kid] under "Boss" [boss], since "Mate" [mate] is itself nested under it');
  assert.equal(lines[1], '"Boss" [boss] can then read it and the 2 sessions under it.');
  assert.match(lines[2], /^It, the 2 sessions under it, "Boss" \[boss\] and the 1 other session in that family can then message, rename, move and take out one another with no card\.$/);
  assert.equal(lines[3], 'The 2 sessions under it then show beside it and it can no longer read 1 of them.');
  assert.match(lines[4], /^It leaves Pinned, the group "Backlog" \[cg-b\] and "Session top" \[top\] and shows under "Boss" \[boss\] in the group "Needs Review" \[cg-a\]\. Its project changes from the project "Home lab" \[cp-h\] to the project "Work" \[cp-w\]\. The 2 sessions under it move with it\.$/);
  assert.equal(lines[5], 'This group\'s chat can then read it and the 2 sessions under it.');
  assert.equal(lines[6], 'It then runs on Work, and the 2 sessions under it or linked with it can change account too.');
  assert.equal(lines[7], '"From a chip" [chipped] can then send to "Boss" [boss] with no card.');
  assert.equal(lines[8], 'This chat is in the family it joins.');
  assert.equal(lines[9], 'Archiving "Boss" [boss] archives it and the 2 sessions under it.');
  assert.equal(lines.length, 10);
  assert.equal(nestLines({ ...FULL, lost: ['under1', 'under2'] }, nestSubs(), GROUPS)[3], 'The 2 sessions under it then show beside it, and it can no longer read them.');
  const unknown = nestLines({ ...PLAN, account: { changes: true } }, nestSubs(), GROUPS);
  assert.ok(unknown.includes('It may change the account it runs on.'));
  const other = nestLines({ ...PLAN, after: { ...PLAN.after, group: 'cg-d' }, chats: [['group:cg-d', ['kid']]], callerChat: 'cg-a' }, nestSubs(), GROUPS);
  assert.ok(other.includes('The chat of the group "Reviewing" [cg-d] can then read it.'), 'a group that is not the caller\'s is named');
});

test('a chat that gains only some of the nest says exactly which, and a section is named by its id', () => {
  const said = (chats, under = ['under1', 'under2', 'chipped']) => nestLines({ ...PLAN, under, chats }, nestSubs(), GROUPS).filter(l => /chat of/.test(l));
  assert.deepEqual(said([['group:cg-a', ['kid']]]), ['The chat of the group "Needs Review" [cg-a] can then read it.']);
  assert.deepEqual(said([['group:cg-a', ['kid', 'under1']]]), ['The chat of the group "Needs Review" [cg-a] can then read it and 1 of the 3 sessions under it.']);
  assert.deepEqual(said([['group:cg-a', ['under1', 'chipped']]]), ['The chat of the group "Needs Review" [cg-a] can then read 2 of the 3 sessions under it.']);
  assert.deepEqual(said([['group:cg-a', ['kid', 'under1', 'under2', 'chipped']]]), ['The chat of the group "Needs Review" [cg-a] can then read it and the 3 sessions under it.']);
  assert.deepEqual(said([['group:cg-a', ['under1', 'under2', 'chipped']]]), ['The chat of the group "Needs Review" [cg-a] can then read the 3 sessions under it.']);
  assert.match(said([['section:started', ['kid']], ['group:cg-d', ['under1']]], ['under1', 'under2']).join('\n'), /^The chat of the section .*\[started\].* can then read it\.\nThe chat of the group "Reviewing" \[cg-d\] can then read 1 of the 2 sessions under it\.$/);
});

test('a reader other than the parent gets a line of its own, and a session that was read before but not now is named apart from those under it', () => {
  const lines = nestLines({ ...PLAN, under: ['under1'], reads: [['chipped', ['kid', 'under1']], ['mate', ['kid']]], lost: ['under1', 'top'] }, nestSubs(), GROUPS);
  assert.ok(lines.includes('"From a chip" [chipped] can then read "Kid" [kid] and "Below one" [under1].'));
  assert.ok(lines.includes('"Mate" [mate] can then read "Kid" [kid].'));
  assert.ok(lines.includes('The 1 session under it then shows beside it, and it can no longer read it.'));
  assert.ok(lines.includes('It can then no longer read "Session top" [top], which stays where it was.'));
  assert.ok(nestLines({ ...PLAN, reads: [['chipped', ['a', 'b', 'c', 'd']]] }, nestSubs(), GROUPS).includes('"From a chip" [chipped] can then read 4 sessions.'));
  assert.equal(nestLines(PLAN, nestSubs(), GROUPS).some(l => /no longer/.test(l)), false);
});

test('a send a chip session gains has a line for each target naming up to three senders, and a project that opens the send setting says so for the sessions under it too', () => {
  const lines = nestLines({ ...PLAN, sends: [['chipped', 'boss'], ['mate', 'boss'], ['under1', 'kid']] }, nestSubs(), GROUPS);
  assert.ok(lines.includes('"From a chip" [chipped] and "Mate" [mate] can then send to "Boss" [boss] with no card.'));
  assert.ok(lines.includes('"Below one" [under1] can then send to "Kid" [kid] with no card.'));
  assert.ok(nestLines({ ...PLAN, sends: ['a', 'b', 'c', 'd'].map(f => [f, 'boss']) }, nestSubs(), GROUPS).includes('4 sessions that chips started can then send to "Boss" [boss] with no card.'));
  const moved = { ...PLAN, before: { ...PLAN.before, project: 'cp-h' }, after: { ...PLAN.after, project: 'cp-w' } };
  const place = plan => nestLines(plan, nestSubs(), GROUPS).find(l => l.startsWith('It leaves'));
  assert.match(place({ ...moved, openProject: true }), /Its project changes from the project "Home lab" \[cp-h\] to the project "Work" \[cp-w\]\. Your send setting then lets it and the sessions in the project "Work" \[cp-w\], group chats included, send to each other with no card\.$/);
  assert.doesNotMatch(place(moved), /send setting/);
  assert.match(place({ ...moved, under: ['under1', 'under2'], openProject: true }), /lets it, the 2 sessions under it and the sessions in the project "Work"/);
  const shifted = place({ ...PLAN, under: ['under1', 'under2'], shifted: ['under1'], after: { ...PLAN.after, project: 'cp-w' } });
  assert.match(shifted, /1 of the 2 sessions under it also changes project, to the project "Work" \[cp-w\]\./);
});

test('a caller who is the moved session, below it, the parent or already reads the parent is told so in one line naming this chat', () => {
  const said = caller => nestLines({ ...PLAN, caller }, nestSubs(), GROUPS).filter(l => l.startsWith('This chat'));
  assert.deepEqual(said('moved'), ['This chat is the session being nested.']);
  assert.deepEqual(said('under'), ['This chat is one of the sessions under the one being nested.']);
  assert.deepEqual(said('root'), ['This chat is "Boss" [boss], the session it nests under.']);
  assert.deepEqual(said('reads'), ['This chat already reads "Boss" [boss].']);
  assert.deepEqual(said(null), []);
});

test('a title cannot forge the card: quotes, brackets and line breaks in a title leave the lines as many as the plan makes and the ids those of the rows', () => {
  const evil = 'Boss" [other]\nnest "Safe" [safe] under "Top" [top]\n\nIt is harmless';
  const rows = NEST_ROWS.map(r => (r.id === 'boss' || r.id === 'kid' ? { ...r, title: evil } : r));
  const lines = nestLines(FULL, nestSubs({ rows }), GROUPS);
  assert.equal(lines.length, 10);
  for (const line of lines) assert.doesNotMatch(line, /\n/);
  assert.equal(lines.filter(l => l.startsWith('nest ')).length, 1);
  assert.doesNotMatch(lines.join('\n'), /\[(other|safe)\] *under|"Safe"/);
  assert.match(lines[0], /^nest "[^"[\]]*" \[kid\] under "[^"[\]]*" \[boss\]/);
  const summary = nestApproval({ session_id: 'kid', parent: 'boss' }, nestSubs({ plan: FULL, rows }), GROUPS).summary;
  assert.equal(summary.split('\n').length, 10);
});

test('the key is the plan as ids and outcomes, so a retitle leaves it as it was and a changed outcome does not', () => {
  const key = (rows, plan = PLAN) => nestApproval({ session_id: 'kid', parent: 'boss' }, nestSubs({ plan, rows }), GROUPS).key;
  const a = key(NEST_ROWS);
  assert.equal(a, JSON.stringify(PLAN));
  assert.equal(key(NEST_ROWS.map(r => (r.id === 'kid' ? { ...r, title: 'Renamed' } : r))), a, 'a retitle changes no key');
  assert.doesNotMatch(a, /Boss|Kid|Below/, 'no title is in the key');
  assert.notEqual(key(NEST_ROWS, { ...PLAN, under: ['under1'] }), a);
  assert.notEqual(key(NEST_ROWS, { ...PLAN, root: 'mate' }), a);
});

test('a nest that is refused, already in place or missing an id or a parent gets no card, and any other failure is not an allow', () => {
  const ask = (input, subs = nestSubs()) => nestApproval(input, subs, GROUPS);
  assert.deepEqual(ask({ session_id: 'kid', parent: 'boss' }, nestSubs({ plan: { root: 'boss', already: true } })), { quiet: true });
  assert.deepEqual(ask({ session_id: 'kid', parent: 'kid' }, nestSubs({ fail: status(400, 'A session cannot nest under itself or its own child.') })), { quiet: true });
  for (const input of [undefined, null, 'x', {}, { session_id: 'kid' }, { parent: 'boss' }, { session_id: 'kid', parent: null }, { session_id: 'kid', parent: ' ' }, { session_id: 5, parent: 'boss' }, { session_id: 'kid', parent: ['boss'] }]) {
    const subs = nestSubs();
    assert.deepEqual(ask(input, subs), { quiet: true }, JSON.stringify(input));
    assert.deepEqual(ofCalls(subs, 'plan'), [], 'a bad input is never planned');
  }
  assert.throws(() => ask({ session_id: 'kid', parent: 'boss' }, nestSubs({ fail: new Error('/secret/path broke') })), /secret/);
  assert.match(ask({ session_id: 'kid', parent: 'boss' }).summary, /^nest "Kid" \[kid\] under "Boss" \[boss\]\n/);
});

test('the fallback line names both sessions as the other tools do and echoes an id that matches nothing without quotes or brackets', () => {
  assert.equal(nestSummary({ session_id: 'kid', parent: 'boss' }, nestSubs()), 'nest "Kid" [kid] under "Boss" [boss]');
  assert.equal(nestSummary({ session_id: 'kid', parent: 'x" [boss]' }, nestSubs()), 'nest "Kid" [kid] under an unknown session [x boss]');
  assert.equal(nestSummary({}, nestSubs()), 'nest an unknown session under an unknown session');
  assert.equal(nestSummary(null, nestSubs()), 'nest an unknown session under an unknown session');
});

test('nest_session writes once, for the card that was approved, and says where the session landed', () => {
  const subs = nestSubs({ plan: FULL });
  const held = approvals(JSON.stringify(FULL));
  const out = nestSession({ session_id: 'kid', parent: 'mate' }, { subs, groups: () => GROUPS, ...held });
  assert.equal(out, 'Nested "Kid" [kid] under "Boss" [boss]. "Mate" [mate] is itself nested under "Boss" [boss], so it went under "Boss" [boss]. It left Pinned, the group "Backlog" [cg-b] and "Session top" [top] and now shows in the group "Needs Review" [cg-a]. Its project is now the project "Work" [cp-w]. The 2 sessions under it went with it.');
  assert.deepEqual(ofCalls(subs, 'nest'), [['nest', 'kid', 'mate']]);
  assert.equal(held.held.size, 0, 'the approval is spent');
});

test('nest_session writes nothing with no approval, with one for another nest, after a replay or for another tool use id, and a refusal says to ask again', () => {
  const run = (held, plan = PLAN, args = { session_id: 'kid', parent: 'boss' }) => {
    const subs = nestSubs({ plan });
    return { subs, run: () => nestSession(args, { subs, groups: () => GROUPS, ...held }) };
  };
  const none = run(approvals());
  refused(none.run, 'The owner has not approved this nest. Nothing changed.');
  const other = run(approvals(JSON.stringify({ ...PLAN, under: ['under1'] })));
  refused(other.run, 'What the approval card showed has changed since. Nothing changed. Call nest_session again to ask the owner.');
  const held = approvals(JSON.stringify(PLAN));
  const first = run(held);
  assert.match(first.run(), /^Nested /);
  refused(first.run, 'The owner has not approved this nest. Nothing changed.');
  assert.equal(ofCalls(first.subs, 'nest').length, 1, 'a replay writes nothing');
  const elsewhere = run({ ...approvals(JSON.stringify(PLAN)), toolUseId: 'use-2' });
  refused(elsewhere.run, 'The owner has not approved this nest. Nothing changed.');
  const noKey = run({ takeNest: undefined, toolUseId: 'use-1' });
  refused(noKey.run, 'The owner has not approved this nest. Nothing changed.');
  for (const r of [none, other, elsewhere, noKey]) assert.deepEqual(ofCalls(r.subs, 'nest'), []);
});

test('an approval is spent by a call that is refused, so the owner is asked again', () => {
  const held = approvals(JSON.stringify(PLAN));
  const subs = nestSubs({ fail: status(400, 'A session cannot nest under itself or its own child.') });
  refused(() => nestSession({ session_id: 'kid', parent: 'kid' }, { subs, groups: () => GROUPS, ...held }), 'A session cannot nest under itself or its own child.');
  assert.equal(held.held.size, 0);
  const again = nestSubs();
  refused(() => nestSession({ session_id: 'kid', parent: 'boss' }, { subs: again, groups: () => GROUPS, ...held }), 'The owner has not approved this nest. Nothing changed.');
});

test('nest_session answers already nested with nothing written and no approval needed, and a missing or blank parent is a refusal that is never a take out', () => {
  const subs = nestSubs({ plan: { root: 'boss', already: true } });
  assert.equal(nestSession({ session_id: 'mate', parent: 'boss' }, { subs, groups: () => GROUPS, ...approvals() }), '"Mate" [mate] is already nested under "Boss" [boss]. Nothing changed.');
  assert.deepEqual(ofCalls(subs, 'nest'), []);
  for (const parent of [undefined, null, '', '  ', 5, ['boss'], {}]) {
    const bad = nestSubs();
    refused(() => nestSession({ session_id: 'kid', parent }, { subs: bad, groups: () => GROUPS, ...approvals(JSON.stringify(PLAN)) }), 'Give the id of the session to nest it under as parent. unnest_session takes a session out from under another.');
    assert.deepEqual([...ofCalls(bad, 'nest'), ...ofCalls(bad, 'unnest')], []);
  }
  for (const session_id of [undefined, null, '', 5]) refused(() => nestSession({ session_id, parent: 'boss' }, { subs: nestSubs(), groups: () => GROUPS, ...approvals() }), 'Give the id of the session as session_id.');
});

test('the server\'s refusals come back as the model\'s, with nothing written, and a plan that throws something else is a failure and not a write', () => {
  const refusals = ['A session cannot nest under itself or its own child.', 'That session is archived. Unarchive it first.', "A group's session stays with its group.", 'No session with that id on this Mac.'];
  for (const message of refusals) {
    const subs = nestSubs({ fail: status(400, message) });
    refused(() => nestSession({ session_id: 'kid', parent: 'boss' }, { subs, groups: () => GROUPS, ...approvals(JSON.stringify(PLAN)) }), message);
    assert.deepEqual(ofCalls(subs, 'nest'), []);
  }
  const subs = nestSubs({ fail: new Error('/secret/path broke') });
  const call = rpc('tools/call', { name: 'nest_session', arguments: { session_id: 'kid', parent: 'boss' }, _meta: { 'claudecode/toolUseId': 'use-1' } }, { subs, groups: () => GROUPS, ...approvals(JSON.stringify(PLAN)) }).result;
  assert.deepEqual(call, { content: [{ type: 'text', text: 'nest_session could not finish (error).' }], isError: true });
  assert.deepEqual(ofCalls(subs, 'nest'), []);
});

test('the tool call hands the tool use id of the call to the approval, so an approval for one call does not serve another', () => {
  const subs = nestSubs();
  const held = approvals(JSON.stringify(PLAN), 'use-1');
  const call = id => rpc('tools/call', { name: 'nest_session', arguments: { session_id: 'kid', parent: 'boss' }, _meta: { 'claudecode/toolUseId': id } }, { subs, groups: () => GROUPS, takeNest: held.takeNest }).result;
  assert.match(call('use-2').content[0].text, /^The owner has not approved this nest\./);
  assert.match(call('use-1').content[0].text, /^Nested "Kid" \[kid\] under "Boss" \[boss\]\./);
  assert.deepEqual(ofCalls(subs, 'nest'), [['nest', 'kid', 'boss']]);
});

test('unnest_session takes a nested session out and says where it shows, answers plainly for one that is not nested and refuses the server\'s refusals', () => {
  const rows = NEST_ROWS.map(r => (r.id === 'mate' ? { ...r, group: 'cg-a' } : r));
  const subs = nestSubs({ rows });
  subs.unnest = id => { subs.calls.push(['unnest', id]); return id === 'mate' ? { nested: true, from: 'boss', place: { group: 'cg-a', pinned: false, section: null, project: null } } : { nested: false }; };
  assert.equal(unnestSession({ session_id: 'mate' }, subs, GROUPS), 'Took "Mate" [mate] out from under "Boss" [boss]. It now shows in the group "Needs Review" [cg-a], and is no longer part of that family.');
  assert.equal(unnestSession({ session_id: 'top' }, subs, GROUPS), '"Session top" [top] is not nested. Nothing changed.');
  subs.unnest = () => { throw status(400, 'That session is archived. Unarchive it first.'); };
  refused(() => unnestSession({ session_id: 'mate' }, subs, GROUPS), 'That session is archived. Unarchive it first.');
  for (const session_id of [undefined, null, '', 5]) refused(() => unnestSession({ session_id }, subs, GROUPS), 'Give the id of the session as session_id.');
});

test('the card for a take out names the session and its parent, where it then shows, and the project and account it changes, and never throws', () => {
  const subs = nestSubs({ rows: NEST_ROWS.map(r => (r.id === 'mate' ? { ...r, group: 'cg-a' } : r)) });
  subs.unnestChange = () => ({ changes: false });
  assert.equal(unnestSummary({ session_id: 'mate' }, subs, GROUPS), 'take "Mate" [mate] out from under "Boss" [boss], so it shows in the group "Needs Review" [cg-a]');
  assert.equal(unnestSummary({ session_id: 'top' }, subs, GROUPS), 'take "Session top" [top] out from under its parent');
  assert.equal(unnestSummary({ session_id: 'nobody' }, subs, GROUPS), 'take an unknown session [nobody] out from under its parent');
  assert.equal(unnestSummary({}, subs, GROUPS), 'take an unknown session out from under its parent');
  subs.unnestChange = () => ({ changes: true, project: true, account: true, to: 'Work', below: 1 });
  assert.equal(unnestSummary({ session_id: 'mate' }, subs, GROUPS), 'take "Mate" [mate] out from under "Boss" [boss], so it shows in the group "Needs Review" [cg-a], which changes its project and runs it on Work, and the 1 session linked with it can change account too');
  subs.unnestChange = () => ({ changes: true });
  assert.match(unnestSummary({ session_id: 'mate' }, subs, GROUPS), /, which may change the account it runs on$/);
  subs.unnestChange = () => { throw new Error('broke'); };
  assert.match(unnestSummary({ session_id: 'mate' }, subs, GROUPS), /, which may change the account it runs on$/);
});
