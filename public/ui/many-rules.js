// The rules for dragging and acting on a selection of sessions that need no page, so node can test them. The server holds the same rules
// for /api/layout/many, and its sentences are the ones here. See docs/adr/20261102-drag-and-act-on-a-selection.md.
import { sessions } from './pick.js';
import { descendantsOf } from './sub-rules.js';
import { everyRow, findRow, LOOSE_NAMES, looseHome, nestRow, placeRow, rootOf, unnestRow } from './tree.js';

export const NEST_SELF = 'A session cannot nest under itself or a session nested under it.';

export const NO_GROUP = 'No group';

const rowsOf = (ix, ids) => ids.map(id => findRow(ix, id)).filter(Boolean);

// The picked sessions that are not under another picked one, which archiving sends because it takes the sessions below along.
export function topmost(ix, ids) {
  const all = everyRow(ix);
  const picked = rowsOf(ix, ids);
  return picked.filter(r => !picked.some(o => o !== r && descendantsOf(all, o.id).some(d => d.id === r.id)));
}

// The picked sessions a move or a nest changes on their own: those whose parent is not picked. The others travel with it.
export function carriedOf(ix, ids) {
  const picked = new Set(ids);
  return rowsOf(ix, ids).filter(r => !picked.has(r.parent));
}

// The sentence for a nest that cannot be, or an empty string. The row it lands under is the target's top level session.
export function refuseNest(ix, ids, parentId) {
  const root = rootOf(ix, parentId);
  return ids.includes(parentId) || (root && ids.includes(root.id)) ? NEST_SELF : '';
}

// Where a row shows for Move to: Pinned, its group, or the loose list. A nested row shows nowhere, since moving it takes it out of its parent.
const placeOf = r => (r.parent ? null : r.pinned ? 'pinned' : r.group ?? 'loose');

// The loose list the rows share, as a place, or No group when their apps differ. A routine run has no loose list, so it is left out.
function looseOf(rows) {
  const homes = [...new Set(rows.filter(r => !r.routine).map(looseHome))];
  return homes.length === 1 && homes[0] ? { label: LOOSE_NAMES[homes[0]], section: homes[0] } : { label: NO_GROUP, section: 'ungrouped' };
}

// Where the picked rows can go, in the shape sessionTargets has, leaving a place out only when every one of them is there already.
export function manyTargets(ix, rows) {
  const all = place => rows.every(r => placeOf(r) === place);
  const placed = r => r.pinned || !!r.group || !!r.parent;
  const loose = rows.some(r => !r.routine && placed(r));
  const groups = list => list.filter(g => !all(g.id)).map(g => ({ label: g.name, section: g.id }));
  return [
    ...(rows.length && rows.every(r => r.routine) && rows.some(placed) ? [{ label: 'Routines', section: 'routines' }] : []),
    ...(all('pinned') ? [] : [{ label: 'Pinned', section: 'pinned' }]),
    ...ix.projects.map(p => ({ group: p.name, items: groups(ix.groups.filter(g => g.project === p.id)) })).filter(entry => entry.items.length),
    ...groups(ix.groups.filter(g => !g.project)),
    ...(loose ? [looseOf(rows)] : []),
  ];
}

// The sessions the picked ones can be nested under: the top level sessions, no routine run, that are not picked.
export function manyNestTargets(ix, ids) {
  const lists = [ix.pinned, ...ix.groups.map(g => g.sessions), ix.started, ix.ungrouped, ix.other];
  return lists.flat().filter(r => !ids.includes(r.id) && !r.routine);
}

// What a Move to place means for the server: Pinned, a group, or each session's loose list.
export const placeTo = (ix, section) => (section === 'pinned' ? { pinned: true } : { group: ix.groups.some(g => g.id === section) ? section : null });

// What the note calls the place a section stands for.
export function placeName(ix, rows, section) {
  if (section === 'pinned') return 'Pinned';
  if (section === 'routines') return 'Routines';
  return ix.groups.find(g => g.id === section)?.name ?? looseOf(rows).label;
}

// Where the picked rows show until the server's list arrives. `to` is what the server takes. A nest that cannot be leaves the list as it is.
export function guessMany(ix, ids, to) {
  const rows = carriedOf(ix, ids);
  if (to.parent) return refuseNest(ix, ids, to.parent) ? ix : rows.reduce((now, r) => nestRow(now, r.id, to.parent), ix);
  if (to.parent === null) return rows.reduce((now, r) => unnestRow(now, r.id), ix);
  return rows.reduce((now, r) => placeRow(now, r.id, to.pinned ? 'pinned' : to.group ?? looseHome(r) ?? 'ungrouped'), ix);
}

// The nested rows a Move out takes out, and the parent when they all have one: its row, else null.
export function leavers(ix, rows) {
  const nested = rows.filter(r => r.parent);
  const parents = new Set(nested.map(r => r.parent));
  return { rows: nested, parent: parents.size === 1 ? findRow(ix, [...parents][0]) : null };
}

export const movedNote = (n, where) => `Moved ${sessions(n)} to ${where}.`;
export const pinnedNote = n => `Pinned ${sessions(n)}.`;
export const nestedNote = (n, title) => `Nested ${sessions(n)} under “${title}”.`;
export const unnestedNote = n => `Moved ${sessions(n)} out of ${n === 1 ? 'its parent' : 'their parents'}.`;
export const manyUndoNote = n => `Put ${sessions(n)} back.`;
