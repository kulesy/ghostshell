// The tools that move, rename, archive and unarchive another session, and the two that look up sessions and chips. Each write goes through a callback
// the server hands the chat in `subs`, which is the code the layout routes run, so the server's state and layout.json cannot disagree.
import { sectionById } from '../public/ui/sections.js';
import { cleanName } from './layout.mjs';
import { descendantsOf } from '../public/ui/sub-rules.js';
import { ago, count, listLine, LIST_LIMIT, oneLine, refusal, whole } from './groups.mjs';

const CHIP_LIMIT = { min: 1, max: 200, fallback: 50 };
export const CHIP_STATUSES = ['open', 'started', 'dismissed'];

const matches = (title, query) => cleanName(title).toLowerCase().includes(query);
const searchOf = value => (typeof value === 'string' ? cleanName(value).toLowerCase() : '');
// A title keeps no quote or bracket, or it could close its own quotes and pass off an id of its own on a card.
const plain = title => oneLine(title, 80).replace(/["[\]]/g, '').trim() || 'Untitled';
const named = (row, id) => (row ? `"${plain(row.title)}" [${row.id}]` : `[${id}]`);
// The sessions under one, archived ones included, which move with it and are read by the group it moves into.
const underCount = (subs, id) => { try { return descendantsOf(subs.lookup({ archived: true }).rows, id).length; } catch { return 0; } };
const reach = (n, lead) => `${lead} ${n ? `it and the ${count(n, 'session')} under it` : 'it'}`;

// The group a name or an id points at, or a refusal that lists the names. Groups can share a name, so that is refused too.
export function groupNamed(group, groups, tool, ambiguous = () => 'Leave the group out, or ask the owner to rename one.') {
  const byId = groups.find(g => g.id === group);
  if (byId) return { group: byId };
  const want = cleanName(group).toLowerCase();
  const found = groups.filter(g => cleanName(g.name).toLowerCase() === want);
  if (found.length === 1) return { group: found[0] };
  const names = groups.map(g => `"${g.name}"`).join(', ');
  if (found.length) return { refusal: `${tool} group "${group}" matches ${found.length} groups, so it is ambiguous. ${ambiguous(found)}` };
  return { refusal: `${tool} has no group called "${group}". ${names ? `The groups are ${names}.` : 'There are no groups.'}` };
}

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
  const was = changed(() => subs.archive(id));
  if (was === 'running') throw refusal(`Refused: ${named(row, id)} is running a turn or waiting for the owner to approve something, and archiving it would stop it. Try again once it is idle, or tell the owner to archive it from the app.`);
  if (was === 'elsewhere') throw refusal(`Refused: ${named(row, id)} looks to be running in another app, which archiving cannot stop from here. Try again once it has stopped, or tell the owner to archive it from the app.`);
  return `Archived ${named(row, id)}. Its chat is closed and it is out of the sidebar's lists. unarchive_session brings it back.`;
}

export function unarchiveSession(args, subs) {
  const id = idOf(args);
  const row = rowOf(subs, id);
  if (row && !row.archived && !row.groupSession) return `${named(row)} is not archived. Nothing changed.`;
  changed(() => subs.unarchive(id));
  return `Unarchived ${named(row, id)}. It is back in its place in the sidebar with no process running, and send_session starts it.`;
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
  const picked = groupNamed(args.group, groups, 'move_session_to_group', found => `Use the id of one of them instead: ${found.map(g => g.id).join(', ')}.`);
  if (picked.refusal) throw refusal(picked.refusal);
  const row = rowOf(subs, id);
  const under = underCount(subs, id);
  changed(() => subs.move(id, picked.group.id));
  const notes = [under && `The ${count(under, 'session')} under it moved with it.`, row?.archived && 'It is still archived.', picked.group.id === own && `${reach(under, 'This group\'s chat can now read')} with read_group_session.`].filter(Boolean);
  return [`Moved ${named(row, id)} to the group "${oneLine(picked.group.name, 80)}". It is no longer pinned or nested under another session.`, ...notes].join(' ');
}

// What the approval card shows for each write: which session, and what happens to it.
const SUMMARIES = {
  archive_session: session => `archive ${session}`,
  unarchive_session: session => `unarchive ${session}`,
  set_session_title: (session, input) => `rename ${session} to "${oneLine(input.title, 120)}"`,
  move_session_to_group: (session, input, groups, own, under) => {
    const group = typeof input.group === 'string' ? groupNamed(input.group, groups, '').group : null;
    return `move ${session} to "${oneLine(group?.name ?? input.group, 80)}"${group && group.id === own ? ` (${reach(under, 'this group\'s chat can then read')})` : ''}`;
  },
};

// A session the card names as the reply does, or as unknown when no session has the id, which the call will then refuse.
export function layoutSummary(tool, input, subs, groups, own) {
  const asked = input && typeof input === 'object' ? input : {};
  const id = typeof asked.session_id === 'string' ? oneLine(asked.session_id, 80) : '';
  let row;
  try { row = rowOf(subs, id); } catch {}
  const session = row ? named(row) : `an unknown session${id ? ` [${id}]` : ''}`;
  return SUMMARIES[tool]?.(session, asked, groups, own, row ? underCount(subs, row.id) : 0) ?? '';
}

// Every session in the index, a group's or section's own chat included, by part of its title. Archived ones are listed unless include_archived is false,
// since the owner of a session is often found in the archive.
export function findSessions(args, subs, groups, now = Date.now()) {
  const query = searchOf(args.query);
  if (!query) throw refusal('Give part of a title to look for as query.');
  const archived = args.include_archived !== false;
  const found = subs.lookup({ archived }).rows.filter(r => matches(r.title, query)).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  const left = archived ? '' : ' (archived sessions left out)';
  if (!found.length) return `No session has "${oneLine(query, 80)}" in its title${left}.`;
  const limit = whole(args.limit, LIST_LIMIT);
  const lines = found.slice(0, limit).map(row => {
    const home = groups.find(g => g.id === row.group)?.name;
    const note = row.groupSession ? ` · the chat of a ${sectionById(row.groupSession) ? 'section' : 'group'}` : home ? ` · group "${oneLine(home, 80)}"` : '';
    return `${listLine(row, now)}${note}`;
  });
  const more = found.length - lines.length;
  return [`${count(found.length, 'session')} with "${oneLine(query, 80)}" in the title${left}, the latest first`, lines.join('\n'), more && `… and ${more} more, past the limit of ${limit}.`].filter(Boolean).join('\n\n');
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
