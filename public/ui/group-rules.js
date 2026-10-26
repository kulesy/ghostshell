// How a group's sessions fall into the parts of its status panel and of the list_group_sessions tool, as rules that need no page, so
// node can test them and the server shares them. The rows are the server's, as they sit in the index.
import { sectionById, sectionSessions, supportsSections } from './sections.js';
import { withKids } from './tree.js';

// A session that is not archived, waiting or working counts as recent when it was written to within this long.
export const RECENT_MS = 24 * 3600_000;

export const BUCKETS = [
  { key: 'needs', label: 'Needs you' },
  { key: 'working', label: 'Working' },
  { key: 'recent', label: 'Recent activity' },
  { key: 'idle', label: 'Idle' },
  { key: 'archived', label: 'Archived' },
];

// The sessions of a group as the index lists them, with those nested under each. The archived ones are not in it.
export const membersOf = group => withKids(group.sessions);

// A session needs the owner while it waits on an approval, and when its mark says it is awaiting, as a Desktop session's does after a turn that ended in a question.
export function bucketOf(row, now = Date.now()) {
  if (row.archived) return 'archived';
  if (row.state === 'waiting' || row.dot === 'awaiting') return 'needs';
  if (row.state === 'working') return 'working';
  return row.state === 'active' || now - row.lastActivityAt < RECENT_MS ? 'recent' : 'idle';
}

// `rows` is a flat list. Each bucket goes newest first.
export function bucketsOf(rows, now = Date.now()) {
  const buckets = Object.fromEntries(BUCKETS.map(b => [b.key, []]));
  for (const row of rows) buckets[bucketOf(row, now)].push(row);
  for (const list of Object.values(buckets)) list.sort((a, b) => (b.lastActivityAt - a.lastActivityAt) || (a.id < b.id ? -1 : 1));
  return buckets;
}

// "2 need you · 3 working · 12 recent · 140 more", leaving out a part that is empty. Idle and archived sessions are the more, and
// `archived` is given when the archived rows are not in `buckets`, as in the index.
export function summaryOf(buckets, archived = buckets.archived.length) {
  const more = buckets.idle.length + archived;
  const parts = [
    buckets.needs.length && `${buckets.needs.length} ${buckets.needs.length === 1 ? 'needs' : 'need'} you`,
    buckets.working.length && `${buckets.working.length} working`,
    buckets.recent.length && `${buckets.recent.length} recent`,
    more && `${more} more`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No sessions yet';
}

// A server that can run group sessions says so on the list. An older one cannot, so the page shows nothing for them until it does.
export const supportsGroups = ix => !!ix?.features?.groupSessions;

// A server that can delete and order groups says so too. Against an older one the group menu keeps only its moves between projects.
export const supportsGroupEdits = ix => !!ix?.features?.groupEdits;
export const supportsGroupRename = ix => !!ix?.features?.groupRename;

// A built-in section as a group-shaped object over the sidebar's own lists, kept per list so renders see the same object. Only a list
// with `sections` has one, which an older server's does not.
const made = new WeakMap();

function sectionGroup(ix, id) {
  const entry = ix?.sections?.find(s => s.id === id);
  if (!entry || !sectionById(id)) return null;
  if (!made.has(ix)) made.set(ix, new Map());
  const byId = made.get(ix);
  if (!byId.has(id)) byId.set(id, { id, name: sectionById(id).name, session: entry.session, archived: entry.archived, sessions: sectionSessions(ix, id), section: true });
  return byId.get(id);
}

export const groupById = (ix, id) => (sectionById(id) ? sectionGroup(ix, id) : ix?.groups.find(g => g.id === id) ?? null);

// The address of the new session page, with the group the session will start in when one is chosen.
export const newRoute = group => (group ? `#/new/${encodeURIComponent(group)}` : '#/new');

// The new session page an address names, as { group }, or null when it is another page. A group id that cannot be decoded is no group.
export function parseNewRoute(hash) {
  if (hash === '#/new') return { group: null };
  if (!hash.startsWith('#/new/')) return null;
  try { return { group: decodeURIComponent(hash.slice(6)) || null }; } catch { return { group: null }; }
}

// The group a new session starts in: the one the address names while it is a group the owner made. Before the list has loaded the
// address is taken as it stands, and a built-in section never counts.
export function draftGroup(ix, id) {
  if (!id || sectionById(id)) return null;
  return !ix || ix.groups.some(g => g.id === id) ? id : null;
}

// The group or section whose own session this is, or null. A link to that session opens it.
export function groupOfSession(ix, id) {
  if (!id) return null;
  const entry = ix?.sections?.find(s => s.session?.id === id);
  return entry ? sectionGroup(ix, entry.id) : ix?.groups.find(g => g.session?.id === id) ?? null;
}

// What a group's pane shows: its chat when the list has the group, and else why not. A section needs a server that knows them as well.
export function paneOf(ix, id) {
  if (!ix) return 'unloaded';
  if (!supportsGroups(ix) || (sectionById(id) && !supportsSections(ix))) return 'unsupported';
  return groupById(ix, id) ? 'ready' : 'missing';
}

// The state that lights a group's button in the sidebar: its session at work or waiting for the owner, else none.
export const litState = session => (session?.state === 'working' || session?.state === 'waiting' ? session.state : null);

// What the question before a group is deleted says: where its sessions go, what happens to its chat, and that nothing is deleted. The
// count is the one the group's header shows.
export function deleteDetail(group) {
  const count = membersOf(group).length;
  const lit = litState(group.session);
  return [
    count ? `${count === 1 ? '1 session becomes' : `${count} sessions become`} ungrouped.` : 'It has no sessions.',
    ...(group.session ? [lit ? `Its chat is ${lit === 'waiting' ? 'waiting for you' : 'working'}, so it stops, and is hidden with its transcript kept.` : 'Its chat is hidden, and its transcript is kept.'] : []),
    ...(count || group.session ? ['No session is deleted.'] : []),
  ].join(' ');
}

// A fold kept per group: a group is in the map only while it is not in its usual state, so the browser keeps no entry for the rest.
export function flipped(all, id) {
  const { [id]: was, ...rest } = all;
  return was ? rest : { ...rest, [id]: true };
}
