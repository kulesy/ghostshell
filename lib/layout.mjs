// Capcom's own projects, groups, pins, nesting and session titles, in layout.json in its state folder. Desktop writes over its files, so
// Capcom copies Desktop's layout once and owns the copy. See docs/adr/20261015-own-session-layout-seeded-from-desktop.md.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SECTION_IDS } from '../public/ui/sections.js';

const MAX_NAME = 80;
// The length readHead in lib/transcripts.mjs cuts a first prompt to. Desktop's titles and the CLI's custom titles are not cut, so a
// longer one shows as it is until it is renamed here. The page keeps its own copy of this limit in public/ui/tree.js.
export const MAX_TITLE = 120;
const EMPTY = { seededAt: null, projects: [], groups: [], retired: [], sections: {}, pinned: [], assignments: {}, unarchived: [], archived: {}, titles: {}, parents: {} };

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const refuse = (status, message) => Object.assign(new Error(message), { status });
const without = (byId, id) => Object.fromEntries(Object.entries(byId).filter(([key]) => key !== id));
const withoutProject = ({ project, ...group }) => group;
const withLinks = (layout, links) => ({ ...layout, parents: { ...layout.parents, ...links } });

// A group's session is its own and no other's, so a link that is not a UUID, or that an earlier group holds, is dropped and the group stays.
function withSessions(groups) {
  const held = new Set();
  return groups.map(({ session, ...group }) => {
    if (!isUuid(session) || held.has(session)) return group;
    held.add(session);
    return { ...group, session };
  });
}

// A built-in section's chat is its own too: only the five sections count, and a link that is not a UUID, or that a group, a retired group or
// an earlier section holds, is dropped and the rest stay.
function withSectionSessions(sections, taken) {
  const held = new Set(taken);
  return Object.fromEntries(SECTION_IDS.flatMap(id => {
    const session = sections[id];
    if (!isUuid(session) || held.has(session)) return [];
    held.add(session);
    return [[id, session]];
  }));
}

const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/gu;
const SHOWS_NOTHING = /^[\p{Default_Ignorable_Code_Point}\s\u2800]*$/u;

// One line of text, whatever was typed or pasted. Markup in it stays text, since the page only ever shows a name as text.
export const cleanName = value => (typeof value === 'string' ? value.replace(BIDI_CONTROLS, '').replace(/[\p{Cc}\s]+/gu, ' ').trim() : '');
// A name that draws nothing is refused, but the invisible characters inside emoji (joiners, variation selectors) stay.
export const showsNothing = name => SHOWS_NOTHING.test(name);

function nameOf(value, max = MAX_NAME) {
  const name = cleanName(value);
  if (showsNothing(name)) throw refuse(400, 'Give it a name.');
  if ([...name].length > max) throw refuse(400, `Names run to ${max} characters at most.`);
  return name;
}

function known(list, id, what) {
  const found = list.find(item => item.id === id);
  if (!found) throw refuse(404, `Unknown ${what}.`);
  return found;
}

// Desktop's groups, memberships and pins keyed by CLI session id, the id Capcom uses everywhere. Desktop shows a session
// that is both pinned and in a group as pinned only, so it is copied as pinned only.
function fromDesktop(desk) {
  const byCli = new Map(desk.sessions.map(r => [r.id, r]));
  const cliId = new Map([...byCli.values()].map(r => [r.localId, r.id]));
  const pinned = [...new Set(desk.pinned.map(local => cliId.get(local)).filter(Boolean))];
  const pins = new Set(pinned);
  const known = new Set(desk.groups.map(g => g.id));
  const assignments = {};
  for (const r of byCli.values()) {
    const group = desk.assignments[r.localId];
    if (known.has(group) && !pins.has(r.id)) assignments[r.id] = group;
  }
  return { groups: desk.groups.map(({ id, name }) => ({ id, name })), pinned, assignments };
}

export function makeLayout(stateDir) {
  const file = path.join(stateDir, 'layout.json');

  // Read from disk each time, so a hand edit shows on the next refresh. A missing file is an empty layout. A file that
  // cannot be read is reported and left alone, so a typo is never written over.
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const { seededAt = null, projects = [], groups = [], retired = [], sections = {}, pinned = [], assignments = {}, unarchived = [], archived = {}, titles = {}, parents = {}, ...rest } = data ?? {};
      if (!isObject(data) || ![projects, groups, retired, pinned, unarchived].every(Array.isArray) || ![sections, assignments, archived, titles, parents].every(isObject)) throw new Error('expected projects, groups, retired, pinned and unarchived as lists and sections, assignments, archived, titles and parents as objects');
      const links = Object.entries(parents).filter(([, parent]) => parent === null || (typeof parent === 'string' && parent));
      const kept = withSessions(groups.filter(g => g?.id));
      const gone = retired.filter(g => g?.id && isUuid(g.session));
      const taken = [...kept.map(g => g.session), ...gone.map(g => g.session)];
      return { ...rest, seededAt, projects: projects.filter(p => p?.id), groups: kept, retired: gone, sections: withSectionSessions(sections, taken), pinned, assignments, unarchived, archived, titles, parents: Object.fromEntries(links) };
    } catch (e) {
      return e.code === 'ENOENT' ? EMPTY : { ...EMPTY, problem: `layout.json cannot be read: ${e.message}` };
    }
  }

  function write(layout) {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(layout, null, 2)}\n`);
    fs.renameSync(temp, file);
  }

  function editable() {
    const layout = read();
    if (layout.problem) throw refuse(500, layout.problem);
    return layout;
  }

  return {
    read,

    // Copies Desktop's groups, memberships and pins in, once. It returns the new layout, or null when it did nothing:
    // already copied, Desktop unreadable, or layout.json unreadable. Anything placed here before the copy keeps its place.
    seed(desk) {
      const have = read();
      if (have.problem || have.seededAt || desk.problem) return null;
      const from = fromDesktop(desk);
      const taken = new Set([...have.pinned, ...Object.keys(have.assignments)]);
      const layout = {
        ...have,
        seededAt: new Date().toISOString(),
        groups: [...have.groups, ...from.groups.filter(g => !have.groups.some(h => h.id === g.id))],
        pinned: [...have.pinned, ...from.pinned.filter(id => !taken.has(id))],
        assignments: { ...Object.fromEntries(Object.entries(from.assignments).filter(([id]) => !taken.has(id))), ...have.assignments },
      };
      write(layout);
      return layout;
    },

    // A session is in one place: a group, Pinned or neither. A group of null means ungrouped. Either way it leaves Pinned. With
    // `unlink` it also leaves its parent, which only the caller can tell, since it alone knows the session's link.
    // `relink` maps sessions to the parent to link them to in the same write, here and on `pin`, `nest` and `unnest`.
    move(id, group, { unlink = false, relink = {} } = {}) {
      const layout = editable();
      if (group !== null && !layout.groups.some(g => g.id === group)) throw refuse(400, 'Unknown group.');
      const assignments = without(layout.assignments, id);
      const placed = { ...layout, pinned: layout.pinned.filter(p => p !== id), assignments: group ? { ...assignments, [id]: group } : assignments };
      write(withLinks(placed, { ...relink, ...(unlink && { [id]: null }) }));
    },

    // Desktop's archive flag is read only, so Capcom keeps its own choice here, and that choice wins over the flag.
    archive(id) {
      const layout = editable();
      if (Object.hasOwn(layout.archived, id)) return;
      write({ ...layout, archived: { ...layout.archived, [id]: new Date().toISOString() }, unarchived: layout.unarchived.filter(u => u !== id) });
    },

    unarchive(id) {
      const layout = editable();
      const listed = layout.unarchived.includes(id);
      if (listed && !Object.hasOwn(layout.archived, id)) return;
      write({ ...layout, archived: without(layout.archived, id), unarchived: listed ? layout.unarchived : [...layout.unarchived, id] });
    },

    // Capcom's own title, shown in Capcom only. Desktop's record and the CLI's transcript are not Capcom's to write.
    rename(id, title) {
      const layout = editable();
      const name = nameOf(title, MAX_TITLE);
      write({ ...layout, titles: { ...layout.titles, [id]: name } });
      return name;
    },

    // Pinning takes the session out of its group, as Desktop does.
    pin(id, pinned, { unlink = false, relink = {} } = {}) {
      const layout = editable();
      if (typeof pinned !== 'boolean') throw refuse(400, 'Pinned or not?');
      const placed = {
        ...layout,
        pinned: [...layout.pinned.filter(p => p !== id), ...(pinned ? [id] : [])],
        assignments: pinned ? without(layout.assignments, id) : layout.assignments,
      };
      write(withLinks(placed, { ...relink, ...(unlink && { [id]: null }) }));
    },

    // A child shows in its family's place, so its own pin and group go. The caller has resolved `parent` to a top level session.
    nest(id, parent, { relink = {} } = {}) {
      const layout = editable();
      if (typeof parent !== 'string' || !parent || parent === id) throw refuse(400, 'Nest it under another session.');
      write(withLinks({ ...layout, pinned: layout.pinned.filter(p => p !== id), assignments: without(layout.assignments, id) }, { ...relink, [id]: parent }));
    },

    // Takes a session out of its parent, Capcom's or Desktop's, and leaves it in `group` or Pinned, where its family showed it.
    unnest(id, { group = null, pinned = false, relink = {} } = {}) {
      const layout = editable();
      if (group !== null && !layout.groups.some(g => g.id === group)) throw refuse(400, 'Unknown group.');
      const assignments = without(layout.assignments, id);
      write(withLinks({
        ...layout,
        pinned: [...layout.pinned.filter(p => p !== id), ...(pinned ? [id] : [])],
        assignments: group && !pinned ? { ...assignments, [id]: group } : assignments,
      }, { ...relink, [id]: null }));
    },

    // A project holds groups, in the order of `projects`. A group is in at most one, named by its `project`. A group with none,
    // or whose project is gone, is at the top level. Each of these returns the project or group it made or changed.
    addProject(name) {
      const layout = editable();
      const project = { id: `cp-${randomUUID()}`, name: nameOf(name) };
      write({ ...layout, projects: [...layout.projects, project] });
      return project;
    },

    renameProject(id, name) {
      const layout = editable();
      const project = { ...known(layout.projects, id, 'project'), name: nameOf(name) };
      write({ ...layout, projects: layout.projects.map(p => (p.id === id ? project : p)) });
      return project;
    },

    // Its groups go back to the top level. No group and no session is deleted.
    removeProject(id) {
      const layout = editable();
      const project = known(layout.projects, id, 'project');
      write({ ...layout, projects: layout.projects.filter(p => p.id !== id), groups: layout.groups.map(g => (g.project === id ? withoutProject(g) : g)) });
      return project;
    },

    addGroup(name, project = null) {
      const layout = editable();
      if (project !== null) known(layout.projects, project, 'project');
      const group = { id: `cg-${randomUUID()}`, name: nameOf(name), ...(project && { project }) };
      write({ ...layout, groups: [...layout.groups, group] });
      return group;
    },

    // Books the session id of a group or built-in section on the first call and returns the same one after. `mint` makes the id, and it is
    // called only when there is none. This is one synchronous read and write, so two callers in the process cannot book two.
    claimGroupSession(id, mint) {
      const layout = editable();
      const section = SECTION_IDS.includes(id);
      const held = section ? layout.sections[id] : known(layout.groups, id, 'group').session;
      if (held) return held;
      const session = mint();
      const taken = [...layout.groups, ...layout.retired].map(g => g.session).concat(Object.values(layout.sections));
      if (!isUuid(session) || taken.includes(session)) throw refuse(500, 'That is not a new session id.');
      write(section ? { ...layout, sections: { ...layout.sections, [id]: session } } : { ...layout, groups: layout.groups.map(g => (g.id === id ? { ...g, session } : g)) });
      return session;
    },

    renameGroup(id, name) {
      const layout = editable();
      const group = { ...known(layout.groups, id, 'group'), name: nameOf(name) };
      write({ ...layout, groups: layout.groups.map(g => (g.id === id ? group : g)) });
      return group;
    },

    // A group keeps its place in `groups` when it moves. A project of null means the top level.
    moveGroup(id, project) {
      const layout = editable();
      const group = known(layout.groups, id, 'group');
      if (project !== null) known(layout.projects, project, 'project');
      const moved = project ? { ...group, project } : withoutProject(group);
      write({ ...layout, groups: layout.groups.map(g => (g.id === id ? moved : g)) });
      return moved;
    },

    // Only the order inside one view changes. The groups of other views sit among them in `groups` and keep their own order.
    orderGroup(id, { before, after } = {}) {
      const layout = editable();
      const named = [before, after].filter(name => name != null);
      if (named.length !== 1 || typeof named[0] !== 'string') throw refuse(400, 'Put it before or after one other group.');
      const group = known(layout.groups, id, 'group');
      const beside = known(layout.groups, named[0], 'group');
      if (beside.id === id) throw refuse(400, 'Put it before or after another group.');
      const viewOf = g => (layout.projects.some(p => p.id === g.project) ? g.project : null);
      if (viewOf(group) !== viewOf(beside)) throw refuse(400, 'Groups in different views cannot be ordered against each other.');
      const rest = layout.groups.filter(g => g.id !== id);
      const at = rest.findIndex(g => g.id === beside.id) + (after != null ? 1 : 0);
      write({ ...layout, groups: [...rest.slice(0, at), group, ...rest.slice(at)] });
      return group;
    },

    // Its sessions become ungrouped, as if each was dragged out. Nothing is deleted. Its own chat is retired and not archived, so it stays
    // a group's session, with the same protections, and is in no list.
    removeGroup(id) {
      const layout = editable();
      const group = known(layout.groups, id, 'group');
      const { name, session } = group;
      write({
        ...layout,
        groups: layout.groups.filter(g => g.id !== id),
        assignments: Object.fromEntries(Object.entries(layout.assignments).filter(([, held]) => held !== id)),
        ...(session && { retired: [...layout.retired, { id, name, session }] }),
      });
      return group;
    },
  };
}
