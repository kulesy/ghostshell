// The five built-in sections of the Home list, each of which has a chat of its own as a group does. The server and the page share this file, so
// the chat sees exactly the sessions the sidebar draws. See docs/adr/20261023-a-session-for-each-group.md.
import { LOOSE_NAMES, looseHome } from './tree.js';

// In sidebar order. `holds` is what the section's guide says it lists. `place` is where a session started from its chat goes: 'pin' pins it,
// 'loose' leaves it in no group, and null means the section cannot hold a new session, so its chat cannot start one.
export const SECTIONS = [
  { id: 'routines', name: 'Routines', holds: 'the runs of the routines GhostShell schedules, the latest run of each with its earlier ones', place: null },
  { id: 'pinned', name: 'Pinned', holds: 'the sessions the owner pinned, from any app', place: 'pin' },
  { id: 'started', name: LOOSE_NAMES.started, holds: 'the sessions started from GhostShell that are in no group and not pinned', place: 'loose' },
  { id: 'ungrouped', name: LOOSE_NAMES.ungrouped, holds: 'the Claude Desktop sessions that are in no group and not pinned', place: 'loose' },
  { id: 'other', name: LOOSE_NAMES.other, holds: 'the sessions started in a terminal with the Claude CLI that are in no group and not pinned', place: null },
];

export const SECTION_IDS = SECTIONS.map(s => s.id);

export const sectionById = id => SECTIONS.find(s => s.id === id) ?? null;

// A server that can run section chats says so on the list. An older one cannot, so the page shows nothing for them until it does.
export const supportsSections = ix => !!ix?.features?.sectionSessions;

// The section a row shows in, or null when it is in a group. Pinned wins over a group, a group over a routine, and a nested row follows the
// row it shows under, because the index lists a family in its holder's place. `rows` maps ids to the index's rows.
export function sectionOf(row, rows) {
  const holder = (row.parent && rows.get(row.parent)) || row;
  if (holder.pinned) return 'pinned';
  if (holder.group) return null;
  if (holder.routine) return 'routines';
  return looseHome(holder) ?? null;
}

// The top level rows of a section, from an index shaped like the sidebar's lists, so a chat sees what the sidebar draws, with the same caps
// and the same families. A routine's runs come latest first, flattened.
export function sectionSessions(ix, id) {
  if (id === 'routines') return ix.routines.flatMap(g => [g.latest, ...g.earlier]);
  return SECTION_IDS.includes(id) ? ix[id] ?? [] : [];
}
