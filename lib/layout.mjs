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
const EMPTY = { seededAt: null, projects: [], groups: [], retired: [], sections: {}, pinned: [], assignments: {}, unarchived: [], archived: {}, archivedWith: {}, titles: {}, parents: {}, accounts: {} };

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const refuse = (status, message) => Object.assign(new Error(message), { status });
const without = (byId, id) => Object.fromEntries(Object.entries(byId).filter(([key]) => key !== id));
const withoutAll = (byId, ids) => Object.fromEntries(Object.entries(byId).filter(([key]) => !ids.includes(key)));
const withoutProject = ({ project, ...group }) => group;
const withLinks = (layout, links) => ({ ...layout, parents: { ...layout.parents, ...links } });

// What layout.json holds for each of `ids` that a change to their links and places touches: the `parent` entry (false for none, which
// follows Desktop, and null for a take-out), the `group` (null for none) and whether it is `pinned`.
const entriesOf = (layout, ids) => Object.fromEntries(ids.map(id => [id, {
  parent: Object.hasOwn(layout.parents, id) ? layout.parents[id] : false,
  group: layout.assignments[id] ?? null,
  pinned: layout.pinned.includes(id),
}]));

const ID = /^[\w-]+$/;
const isId = value => typeof value === 'string' && ID.test(value);

// The changes to one session's place and links as pure steps, so one call can apply many of them in a single write. `relink` maps sessions
// to the parent to link them to as well, and `unlink` takes the session out of its parent.
const knownGroup = (layout, group) => {
  if (group !== null && !layout.groups.some(g => g.id === group)) throw refuse(400, 'Unknown group.');
};

function moveStep(layout, id, group, { unlink = false, relink = {} } = {}) {
  knownGroup(layout, group);
  const assignments = without(layout.assignments, id);
  const placed = { ...layout, pinned: layout.pinned.filter(p => p !== id), assignments: group ? { ...assignments, [id]: group } : assignments };
  return withLinks(placed, { ...relink, ...(unlink && { [id]: null }) });
}

function pinStep(layout, id, pinned, { unlink = false, relink = {} } = {}) {
  if (typeof pinned !== 'boolean') throw refuse(400, 'Pinned or not?');
  const placed = {
    ...layout,
    pinned: [...layout.pinned.filter(p => p !== id), ...(pinned ? [id] : [])],
    assignments: pinned ? without(layout.assignments, id) : layout.assignments,
  };
  return withLinks(placed, { ...relink, ...(unlink && { [id]: null }) });
}

function nestStep(layout, id, parent, { relink = {} } = {}) {
  if (typeof parent !== 'string' || !parent || parent === id) throw refuse(400, 'Nest it under another session.');
  return withLinks({ ...layout, pinned: layout.pinned.filter(p => p !== id), assignments: without(layout.assignments, id) }, { ...relink, [id]: parent });
}

function unnestStep(layout, id, { group = null, pinned = false, relink = {} } = {}) {
  knownGroup(layout, group);
  const assignments = without(layout.assignments, id);
  return withLinks({
    ...layout,
    pinned: [...layout.pinned.filter(p => p !== id), ...(pinned ? [id] : [])],
    assignments: group && !pinned ? { ...assignments, [id]: group } : assignments,
  }, { ...relink, [id]: null });
}

const STEPS = {
  move: (layout, { id, group, ...options }) => moveStep(layout, id, group, options),
  pin: (layout, { id, pinned, ...options }) => pinStep(layout, id, pinned, options),
  nest: (layout, { id, parent, ...options }) => nestStep(layout, id, parent, options),
  unnest: (layout, { id, ...options }) => unnestStep(layout, id, options),
};

// The entries of `before` that can be put back, as [session, entry] pairs.
const entriesIn = before => Object.entries(isObject(before) ? before : {}).filter(([session, entry]) => isId(session) && isObject(entry));

// The parents, assignments and pins with each session in `entries` put back exactly as its entry says, and those of `clear` taken away.
// A group that has gone since leaves its session ungrouped.
function putBack(layout, entries, clear = []) {
  const undone = new Set([...clear, ...entries.map(([session]) => session)]);
  const parents = Object.fromEntries(Object.entries(layout.parents).filter(([session]) => !undone.has(session)));
  const assignments = Object.fromEntries(Object.entries(layout.assignments).filter(([session]) => !undone.has(session)));
  const pinned = layout.pinned.filter(p => !undone.has(p));
  for (const [session, entry] of entries) {
    if (entry.parent === null || isId(entry.parent)) parents[session] = entry.parent;
    if (isId(entry.group) && layout.groups.some(g => g.id === entry.group)) assignments[session] = entry.group;
    if (entry.pinned === true) pinned.push(session);
  }
  return { parents, assignments, pinned };
}

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

export function nameOf(value, max = MAX_NAME) {
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
      const { seededAt = null, projects = [], groups = [], retired = [], sections = {}, pinned = [], assignments = {}, unarchived = [], archived = {}, archivedWith = {}, titles = {}, parents = {}, accounts = {}, overflow = {}, routineProjects = {}, ...rest } = data ?? {};
      if (!isObject(data) || ![projects, groups, retired, pinned, unarchived].every(Array.isArray) || ![sections, assignments, archived, archivedWith, titles, parents, accounts, overflow, routineProjects].every(isObject)) throw new Error('expected projects, groups, retired, pinned and unarchived as lists and sections, assignments, archived, archivedWith, titles, parents, accounts, overflow and routineProjects as objects');
      const spill = Object.entries(overflow).filter(([, account]) => typeof account === 'string' && account);
      const homed = Object.entries(routineProjects).filter(([, project]) => typeof project === 'string' && project);
      const links = Object.entries(parents).filter(([, parent]) => parent === null || (typeof parent === 'string' && parent));
      const kept = withSessions(groups.filter(g => g?.id));
      const gone = retired.filter(g => g?.id && isUuid(g.session));
      const taken = [...kept.map(g => g.session), ...gone.map(g => g.session)];
      return { ...rest, seededAt, projects: projects.filter(p => p?.id), groups: kept, retired: gone, sections: withSectionSessions(sections, taken), pinned, assignments, unarchived, archived, archivedWith: Object.fromEntries(Object.entries(archivedWith).filter(([, root]) => typeof root === 'string' && root)), titles, parents: Object.fromEntries(links), accounts: Object.fromEntries(Object.entries(accounts).filter(([, account]) => typeof account === 'string' && account)), ...(spill.length && { overflow: Object.fromEntries(spill) }), ...(homed.length && { routineProjects: Object.fromEntries(homed) }) };
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
    move(id, group, options) {
      write(moveStep(editable(), id, group, options));
    },

    // Applies many changes in one read and one write: each step is { kind: 'move' | 'pin' | 'nest' | 'unnest', id, ...what that call takes },
    // with its own `unlink` and `relink`. Any step that is refused leaves the file as it was. It returns `before`, the entries of every session
    // the steps touched, links they moved included, which restore() puts back.
    many(steps) {
      const layout = editable();
      const before = entriesOf(layout, [...new Set(steps.flatMap(step => [step.id, ...Object.keys(step.relink ?? {})]))]);
      write(steps.reduce((now, step) => STEPS[step.kind](now, step), layout));
      return { before };
    },

    // Puts back the entries many() returned, exactly, in one write.
    restore(before) {
      const layout = editable();
      write({ ...layout, ...putBack(layout, entriesIn(before)) });
    },

    // Desktop's archive flag is read only, so Capcom keeps its own choice here, and that choice wins over the flag. `under` is the sessions below `id`
    // at any depth: those not archived yet go with it in the same write, and `archivedWith` records which batch took them. A child keeps its place in
    // `unarchived`, which the archive outranks, so bringing it back leaves Desktop's flag overridden exactly as it was. Resolves with the ids archived.
    archive(id, { under = [] } = {}) {
      const layout = editable();
      if (Object.hasOwn(layout.archived, id)) return [];
      const at = new Date().toISOString();
      const taken = [id, ...new Set(under)].filter(m => m === id || !Object.hasOwn(layout.archived, m));
      const batch = Object.fromEntries(taken.slice(1).map(m => [m, id]));
      write({
        ...layout,
        archived: { ...layout.archived, ...Object.fromEntries(taken.map(m => [m, at])) },
        archivedWith: { ...withoutAll(layout.archivedWith, taken), ...batch },
        unarchived: layout.unarchived.filter(u => u !== id),
      });
      return taken;
    },

    // Brings `id` back with the sessions in `under` that were archived in its batch, which is the one `id` joined, or the one it started. The root
    // takes every session that records it, even one no longer in `under`. A session the owner archived on its own earlier stays archived. Only `id`
    // goes on `unarchived`, since the owner chose it. Resolves with the ids brought back.
    unarchive(id, { under = [] } = {}) {
      const layout = editable();
      const batch = layout.archivedWith[id] ?? id;
      const owned = batch === id ? Object.keys(layout.archivedWith).filter(m => layout.archivedWith[m] === id) : [];
      const back = [id, ...new Set([...under, ...owned])].filter(m => m === id || (layout.archivedWith[m] === batch && Object.hasOwn(layout.archived, m)));
      const listed = layout.unarchived.includes(id);
      if (back.length === 1 && listed && !Object.hasOwn(layout.archived, id) && !Object.hasOwn(layout.archivedWith, id)) return [];
      write({ ...layout, archived: withoutAll(layout.archived, back), archivedWith: withoutAll(layout.archivedWith, back), unarchived: listed ? layout.unarchived : [...layout.unarchived, id] });
      return back;
    },

    // Capcom's own title, shown in Capcom only. Desktop's record and the CLI's transcript are not Capcom's to write.
    rename(id, title) {
      const layout = editable();
      const name = nameOf(title, MAX_TITLE);
      write({ ...layout, titles: { ...layout.titles, [id]: name } });
      return name;
    },

    // Pinning takes the session out of its group, as Desktop does.
    pin(id, pinned, options) {
      write(pinStep(editable(), id, pinned, options));
    },

    // A child shows in its family's place, so its own pin and group go. The caller has resolved `parent` to a top level session.
    nest(id, parent, options) {
      write(nestStep(editable(), id, parent, options));
    },

    // A new parent for several sessions in one write: its title and place, and `links`, each session's new parent. The sessions in `moved`
    // link straight to it, so their own pin and group go as nest() drops them. The caller has worked out the links and checked them for a
    // loop. It returns the title and `before`, the entries it changed, which restoreParent puts back.
    newParent(id, { title, group = null, pinned = false, links, moved }) {
      const layout = editable();
      const name = nameOf(title, MAX_TITLE);
      if (typeof pinned !== 'boolean') throw refuse(400, 'Pinned or not?');
      if (group !== null && !layout.groups.some(g => g.id === group)) throw refuse(400, 'Unknown group.');
      const left = new Set(moved);
      const before = entriesOf(layout, [...new Set([...Object.keys(links), ...moved])]);
      const kept = Object.entries(layout.assignments).filter(([session]) => session !== id && !left.has(session));
      write(withLinks({
        ...layout,
        titles: { ...layout.titles, [id]: name },
        pinned: [...layout.pinned.filter(p => p !== id && !left.has(p)), ...(pinned ? [id] : [])],
        assignments: Object.fromEntries(group && !pinned ? [...kept, [id, group]] : kept),
      }, links));
      return { title: name, before };
    },

    // Puts back the entries newParent changed, exactly, and takes the new parent's title and place away, in one write. A session nested
    // under the parent since, which `before` knows nothing of, is taken out to the parent's place. A group that has gone since leaves
    // its session ungrouped.
    restoreParent(id, before) {
      const layout = editable();
      const entries = entriesIn(before);
      const undone = new Set([id, ...entries.map(([session]) => session)]);
      const later = Object.entries(layout.parents).filter(([session, parent]) => parent === id && !undone.has(session)).map(([session]) => session);
      const { parents, assignments, pinned } = putBack(layout, entries, [id]);
      const place = layout.pinned.includes(id) ? null : layout.assignments[id];
      for (const session of later) {
        parents[session] = null;
        if (layout.pinned.includes(id)) pinned.push(session);
        else if (place) assignments[session] = place;
      }
      write({ ...layout, titles: without(layout.titles, id), parents, assignments, pinned });
    },

    // Takes a session out of its parent, Capcom's or Desktop's, and leaves it in `group` or Pinned, where its family showed it.
    unnest(id, options) {
      write(unnestStep(editable(), id, options));
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

    // Its groups and routines go back to the top level. No group, routine or session is deleted.
    removeProject(id) {
      const layout = editable();
      const project = known(layout.projects, id, 'project');
      const { routineProjects: homed = {}, ...rest } = layout;
      const kept = Object.fromEntries(Object.entries(homed).filter(([, held]) => held !== id));
      write({ ...rest, projects: layout.projects.filter(p => p.id !== id), groups: layout.groups.map(g => (g.project === id ? withoutProject(g) : g)), ...(Object.keys(kept).length && { routineProjects: kept }) });
      return project;
    },

    // A routine's project is kept here and not in routines.json, which decides what runs. A project of null means Home, and a project that is not
    // in the list is refused. The routine itself is not looked up, so a link left by a deleted routine is harmless.
    moveRoutine(id, project) {
      const layout = editable();
      if (!isId(id)) throw refuse(400, 'Unknown routine.');
      if (project !== null) known(layout.projects, project, 'project');
      const { routineProjects: homed = {}, ...rest } = layout;
      const next = project ? { ...homed, [id]: project } : without(homed, id);
      write({ ...rest, ...(Object.keys(next).length && { routineProjects: next }) });
      return { id, project };
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

    orderProject(id, { before, after } = {}) {
      const layout = editable();
      const named = [before, after].filter(name => name != null);
      if (named.length !== 1 || typeof named[0] !== 'string') throw refuse(400, 'Put it before or after one other project.');
      const project = known(layout.projects, id, 'project');
      const beside = known(layout.projects, named[0], 'project');
      if (beside.id === id) throw refuse(400, 'Put it before or after another project.');
      const rest = layout.projects.filter(p => p.id !== id);
      const at = rest.findIndex(p => p.id === beside.id) + (after != null ? 1 : 0);
      write({ ...layout, projects: [...rest.slice(0, at), project, ...rest.slice(at)] });
      return project;
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

    // Pins a session, group or project to an account id, or clears the pin with null. The caller has checked the ids against the accounts it lists.
    // `overflow` is the account that takes the work while the pinned one is out of usage: an id sets it, null clears it and undefined keeps the one there.
    // Clearing the pin clears it, and so does a pin changed to the overflow's own account. A session's pin stays when the session goes, as its title and place do.
    setAccount(kind, id, account, overflow = undefined) {
      const layout = editable();
      if (account !== null && (typeof account !== 'string' || !account)) throw refuse(400, 'Name an account, or null to clear the pin.');
      if (overflow !== undefined && overflow !== null && (typeof overflow !== 'string' || !overflow)) throw refuse(400, 'Name an account, or null to clear the overflow.');
      if (overflow && overflow === account) throw refuse(400, 'The overflow must be another account than the pin.');
      const next = held => (account === null ? null : overflow !== undefined ? overflow : held && held !== account ? held : null);
      if (kind === 'session') {
        if (!isId(id)) throw refuse(400, 'Unknown session.');
        const { overflow: held = {}, ...rest } = layout;
        const spill = next(held[id]);
        const kept = spill ? { ...held, [id]: spill } : without(held, id);
        write({ ...rest, accounts: account ? { ...layout.accounts, [id]: account } : without(layout.accounts, id), ...(Object.keys(kept).length && { overflow: kept }) });
        return account;
      }
      if (kind !== 'group' && kind !== 'project') throw refuse(400, 'Pin a session, a group or a project.');
      const list = kind === 'group' ? 'groups' : 'projects';
      const item = known(layout[list], id, kind);
      const spill = next(item.overflow);
      const { account: _, overflow: __, ...rest } = item;
      write({ ...layout, [list]: layout[list].map(i => (i.id === id ? { ...rest, ...(account && { account }), ...(spill && { overflow: spill }) } : i)) });
      return account;
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
