// The tools that move, rename, archive and unarchive another session, make a project or a group, and the two that look up sessions and chips. Each write goes through a callback
// the server hands the chat in `subs`, which is the code the layout routes run, so the server's state and layout.json cannot disagree.
import { linkMatches, pullReference } from '../public/ui/pull-url.js';
import { sectionById } from '../public/ui/sections.js';
import { cleanName } from './layout.mjs';
import { descendantsOf } from '../public/ui/sub-rules.js';
import { ago, count, listLine, LIST_LIMIT, oneLine, refusal, whole } from './groups.mjs';

const CHIP_LIMIT = { min: 1, max: 200, fallback: 50 };
export const CHIP_STATUSES = ['open', 'started', 'dismissed'];

const matches = (title, query) => cleanName(title).toLowerCase().includes(query);
const searchOf = value => (typeof value === 'string' ? cleanName(value).toLowerCase() : '');
// A title keeps no quote or bracket, or it could close its own quotes and pass off an id of its own on a card.
const shown = title => oneLine(title, 80).replace(/["[\]]/g, '').trim();
const plain = title => shown(title) || 'Untitled';
const named = (row, id) => (row ? `"${plain(row.title)}" [${row.id}]` : `[${id}]`);
// The sessions under one, archived ones included, which move with it and are read by the group it moves into.
const underCount = (subs, id, { live = false } = {}) => { try { return descendantsOf(subs.lookup({ archived: true }).rows, id).filter(r => !live || !r.archived).length; } catch { return 0; } };
const reach = (n, lead) => `${lead} ${n ? `it and the ${count(n, 'session')} under it` : 'it'}`;

// What showsNothing in lib/layout.mjs counts as invisible, other than spaces, plus the format characters a card drops.
const UNSEEN = /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu;
// The one rule for whether two names are the same, so the check a new name passes is the match a lookup makes later. It compares what a person
// can see, or an invisible character, a stray quote or a decomposed accent would make a twin that neither a card nor the sidebar can tell from the original.
const nameKey = name => shown(String(name ?? '').replace(UNSEEN, '')).normalize('NFC').toLowerCase();

// The group or project a name or an id points at, or a refusal that lists the names. Two can share a name, so that is refused too.
function lookUp(kind, value, list, tool, ambiguous) {
  const byId = list.find(item => item.id === value);
  if (byId) return { [kind]: byId };
  const want = nameKey(value);
  const found = want ? list.filter(item => nameKey(item.name) === want) : [];
  if (found.length === 1) return { [kind]: found[0] };
  const names = list.map(item => `"${item.name}"`).join(', ');
  if (found.length) return { refusal: `${tool} ${kind} "${value}" matches ${found.length} ${kind}s, so it is ambiguous. ${ambiguous(found)}` };
  return { refusal: `${tool} has no ${kind} called "${value}". ${names ? `The ${kind}s are ${names}.` : `There are no ${kind}s.`}` };
}

const idsOf = found => `Use the id of one of them instead: ${found.map(item => item.id).join(', ')}.`;

export const groupNamed = (group, groups, tool, ambiguous = () => 'Leave the group out, or ask the owner to rename one.') => lookUp('group', group, groups, tool, ambiguous);
export const projectNamed = (project, projects, tool, ambiguous = idsOf) => lookUp('project', project, projects, tool, ambiguous);

function idOf(args) {
  if (typeof args.session_id !== 'string' || !args.session_id.trim()) throw refusal('Give the id of the session as session_id.');
  return args.session_id.trim();
}

// The server's 400 and 404 sentences say what is wrong with the session and pass on as refusals. Anything else is a failure.
function changed(run) {
  try {
    return run();
  } catch (err) {
    throw err.status ? refusal(err.message) : err;
  }
}

const rowOf = (subs, id) => subs.lookup({ archived: true }).rows.find(r => r.id === id);

export function archiveSession(args, subs) {
  const id = idOf(args);
  const { self, rows } = subs.lookup({ archived: true });
  if (self?.id === id) throw refusal('A session cannot archive itself. Ask the owner to archive it.');
  const row = rows.find(r => r.id === id);
  if (row?.archived) return `${named(row)} is already archived. Nothing changed.`;
  const { was, archivedSubs: n, self: itself, subs: below } = changed(() => subs.archive(id));
  // On a refusal the server says whether the session itself stands in the way and how many sessions under it do.
  const who = below ? `${itself ? `${named(row, id)} and ` : ''}${count(below, 'session')} under ${itself ? 'it' : named(row, id)}` : named(row, id);
  const many = below + (itself ? 1 : 0) > 1;
  if (was === 'running') throw refusal(`Refused: ${who} ${many ? 'are' : 'is'} running a turn or waiting for the owner to approve something, and archiving ${many ? 'them' : 'it'} would stop ${many ? 'them' : 'it'}. Try again once ${many ? 'they are' : 'it is'} idle, or tell the owner to archive it from the app.`);
  if (was === 'elsewhere') throw refusal(`Refused: ${who} ${many ? 'look' : 'looks'} to be running in another app, which archiving cannot stop from here. Try again once ${many ? 'they have' : 'it has'} stopped, or tell the owner to archive it from the app.`);
  return `Archived ${named(row, id)}${n ? ` and the ${count(n, 'sub session')} under it` : ''}. ${n ? 'Their chats are' : 'Its chat is'} closed and ${n ? 'they are' : 'it is'} out of the sidebar's lists. unarchive_session brings ${n ? 'them' : 'it'} back.`;
}

export function unarchiveSession(args, subs) {
  const id = idOf(args);
  const row = rowOf(subs, id);
  if (row && !row.archived && !row.groupSession) return `${named(row)} is not archived. Nothing changed.`;
  const n = changed(() => subs.unarchive(id)) || 0;
  return `Unarchived ${named(row, id)}${n ? ` and the ${count(n, 'sub session')} archived with it` : ''}. ${n ? 'They are' : 'It is'} back in ${n ? 'their places' : 'its place'} in the sidebar with no process running, and send_session starts ${n ? 'each' : 'it'}.`;
}

export function setSessionTitle(args, subs) {
  const id = idOf(args);
  if (typeof args.title !== 'string') throw refusal('Give the new title as title.');
  const row = rowOf(subs, id);
  const title = changed(() => subs.rename(id, args.title));
  return `Renamed ${named(row, id)} to "${oneLine(title, 120)}". The title shows in GhostShell only.`;
}

// `own` is the id of the group whose chat is calling, if one is: a session moved into it is one that chat can read.
export function moveSession(args, subs, groups, own) {
  const id = idOf(args);
  if (typeof args.group !== 'string' || !cleanName(args.group)) throw refusal('Give the group as group, by its name as the sidebar shows it or by its id.');
  const picked = groupNamed(args.group, groups, 'move_session_to_group', idsOf);
  if (picked.refusal) throw refusal(picked.refusal);
  const row = rowOf(subs, id);
  const under = underCount(subs, id);
  changed(() => subs.move(id, picked.group.id));
  const notes = [under && `The ${count(under, 'session')} under it moved with it.`, row?.archived && 'It is still archived.', picked.group.id === own && `${reach(under, 'This group\'s chat can now read')} with read_group_session.`].filter(Boolean);
  return [`Moved ${named(row, id)} to the group "${oneLine(picked.group.name, 80)}". It is no longer pinned or nested under another session.`, ...notes].join(' ');
}

const nameGiven = args => {
  if (typeof args.name !== 'string') throw refusal('Give the name as name.');
  if (!nameKey(args.name)) throw refusal('Give it a name.');
  // A card shows some of these as a space and the key drops them, so a new name holds none: its card text and its key then cannot part. Emoji keep their joiners.
  if (args.name.replace(/\p{RGI_Emoji}/gv, '').search(UNSEEN) >= 0) throw refusal('The name holds a character that draws nothing, so a card could not show it. Send the name without it.');
  return args.name;
};

// Tools look a group up by name across every project and Home, so a new group is held to the same match. The sidebar's own routes allow duplicates.
const taken = (kind, list, name) => {
  const same = list.filter(item => nameKey(item.name) === nameKey(name));
  if (same.length) throw refusal(`There is already a ${kind} called "${plain(same[0].name)}" [${same.map(item => item.id).join(', ')}]. Nothing changed.`);
};

// Home for a project left out or blank, as a blank group on spawn_task means none. The card and the call both resolve it here, so they cannot disagree.
function projectTarget(value, subs) {
  if (value == null || (typeof value === 'string' && !cleanName(value))) return {};
  if (typeof value !== 'string') return { refusal: 'Give the project as its name or its id.' };
  return projectNamed(value, subs.projects(), 'create_group');
}

export function createProject(args, subs) {
  const name = nameGiven(args);
  taken('project', subs.projects(), name);
  const project = changed(() => subs.addProject(name));
  return `Created the project "${plain(project.name)}" [${project.id}]. It has no groups yet: create_group with project set to its name or id adds one.`;
}

export function createGroup(args, subs, groups) {
  const name = nameGiven(args);
  const target = projectTarget(args.project, subs);
  if (target.refusal) throw refusal(target.refusal);
  taken('group', groups, name);
  const group = changed(() => subs.addGroup(name, target.project?.id ?? null));
  return `Created the group "${plain(group.name)}" [${group.id}] ${target.project ? `in the project "${plain(target.project.name)}"` : 'on Home'}. move_session_to_group and spawn_task's group can now use it by name or id.`;
}

// What the approval card shows for each write: which session, and what happens to it.
const SUMMARIES = {
  archive_session: (session, input, groups, own, under, fresh) => `archive ${session}${fresh ? ` and its ${count(fresh, 'sub session')}` : ''}`,
  unarchive_session: (session, input, groups, own, under, fresh, back) => `unarchive ${session}${back ? ` and its ${count(back, 'sub session')}` : ''}`,
  set_session_title: (session, input) => `rename ${session} to "${oneLine(input.title, 120)}"`,
  move_session_to_group: (session, input, groups, own, under) => {
    const group = typeof input.group === 'string' ? groupNamed(input.group, groups, '').group : null;
    return `move ${session} to "${oneLine(group?.name ?? input.group, 80)}"${group && group.id === own ? ` (${reach(under, 'this group\'s chat can then read')})` : ''}`;
  },
};

// The sessions an unarchive of `row` brings back with it: those recorded as archived with it, under it unless it is the one that started the batch.
const archivedWithCount = (rows, row) => {
  const key = row.archivedWith ?? row.id;
  const under = descendantsOf(rows, row.id).map(r => r.id);
  return rows.filter(r => r.id !== row.id && r.archived && r.archivedWith === key && (key === row.id || under.includes(r.id))).length;
};

// What a move to another account adds to its card, from the callback the server gives a chat. A context without one adds nothing.
function accountNote(subs, id, group) {
  const moved = subs.moveAccount?.(id, group);
  if (!moved?.changes || !moved.to) return '';
  return `, which runs it on ${moved.active ? `the active account, now ${moved.to}` : moved.to}${moved.below ? `, and the ${count(moved.below, 'session')} under it can change account too` : ''}`;
}

// The tools that make a project or group reach no session, so their card lines are made before any session is looked up.
const quoted = value => `"${typeof value === 'string' && cleanName(value) ? plain(value) : ''}"`;
const CREATES = {
  create_project: input => `create the project ${quoted(input.name)}`,
  create_group(input, subs) {
    let target;
    try { target = projectTarget(input.project, subs); } catch { target = { refusal: true }; }
    const where = target.project ? `in the project ${quoted(target.project.name)}` : target.refusal ? `in the project ${quoted(String(input.project))}` : 'on Home';
    return `create the group ${quoted(input.name)} ${where}`;
  },
};

// A session the card names as the reply does, or as unknown when no session has the id, which the call will then refuse.
export function layoutSummary(tool, input, subs, groups, own) {
  const asked = input && typeof input === 'object' ? input : {};
  if (Object.hasOwn(CREATES, tool)) return CREATES[tool](asked, subs);
  const id = typeof asked.session_id === 'string' ? oneLine(asked.session_id, 80) : '';
  let row;
  try { row = rowOf(subs, id); } catch {}
  const session = row ? named(row) : `an unknown session${id ? ` [${id}]` : ''}`;
  const back = row?.archived ? archivedWithCount(subs.lookup({ archived: true }).rows, row) : 0;
  const line = SUMMARIES[tool]?.(session, asked, groups, own, row ? underCount(subs, row.id) : 0, row && !row.archived ? underCount(subs, row.id, { live: true }) : 0, back) ?? '';
  return line + (tool === 'move_session_to_group' ? accountNote(subs, id, asked.group) : '');
}

// Every session in the index, a group's or section's own chat included, by part of its title, or by a pull request it links when the query reads as one
// (7969, #7969, pull/7969 or an address). Archived ones are listed unless include_archived is false, since the owner of a session is often found in the archive.
export function findSessions(args, subs, groups, now = Date.now()) {
  const query = searchOf(args.query);
  if (!query) throw refusal('Give part of a title or a pull request number to look for as query.');
  const archived = args.include_archived !== false;
  const ref = pullReference(query);
  const { links, reading } = ref ? subs.pullLinks() : { links: {}, reading: false };
  const linked = row => (ref ? (links[row.id] ?? []).filter(link => linkMatches(link, ref)) : []);
  const found = subs.lookup({ archived }).rows.filter(r => matches(r.title, query) || linked(r).length).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  const left = archived ? '' : ' (archived sessions left out)';
  const quoted = `"${oneLine(query, 80)}"`;
  if (!found.length) {
    const wait = ref && reading ? ' Pull request links are still being read, so try again shortly.' : '';
    return `No session has ${quoted} in its title${ref ? ' or links that pull request' : ''}${left}.${wait}`;
  }
  const limit = whole(args.limit, LIST_LIMIT);
  const lines = found.slice(0, limit).map(row => {
    const home = groups.find(g => g.id === row.group)?.name;
    const note = row.groupSession ? ` · the chat of a ${sectionById(row.groupSession) ? 'section' : 'group'}` : home ? ` · group "${oneLine(home, 80)}"` : '';
    const matched = linked(row);
    return `${listLine(row, now)}${note}${matched.length ? ` · links ${matched.join(', ')}` : ''}`;
  });
  const more = found.length - lines.length;
  return [`${count(found.length, 'session')} with ${quoted} in the title${ref ? ' or linking that pull request' : ''}${left}, the latest first`, lines.join('\n'), more && `… and ${more} more, past the limit of ${limit}.`].filter(Boolean).join('\n\n');
}

// The chips in chips.json, newest first, with the session each started and the one that made it.
export function listChips(args, chips, now = Date.now()) {
  if (args.status != null && !CHIP_STATUSES.includes(args.status)) throw refusal(`status must be one of ${CHIP_STATUSES.join(', ')}.`);
  const query = searchOf(args.query);
  const maker = typeof args.session_id === 'string' ? args.session_id.trim() : '';
  const found = chips.list()
    .filter(c => (!args.status || c.status === args.status) && (!query || matches(c.title ?? '', query)) && (!maker || c.sessionId === maker))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!found.length) return 'No chips match.';
  const limit = whole(args.limit, CHIP_LIMIT);
  const lines = found.slice(0, limit).map(c => [
    `- ${oneLine(c.title, 80) || 'Untitled'}${c.id ? ` [${c.id}]` : ''}`,
    c.status || 'open',
    c.startedId && `started session [${c.startedId}]`,
    c.sessionId && `made by [${c.sessionId}]`,
    Number.isFinite(c.at) && c.at > 0 ? `${new Date(c.at).toISOString()} (${ago(c.at, now)})` : 'time unknown',
  ].filter(Boolean).join(' · '));
  const more = found.length - lines.length;
  return [`${count(found.length, 'chip')}, the newest first`, lines.join('\n'), more && `… and ${more} more, past the limit of ${limit}.`].filter(Boolean).join('\n\n');
}
