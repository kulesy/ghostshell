// Run with `npm test`. The rules of the sidebar tree that need no page: where the arrow keys go, where a group or a session can be
// moved or nested, what the list shows once a session is archived, moved or nested, which row takes the focus, which session Cmd+A
// archives, and when the turn of each running row began.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_SORT, UNTITLED } from '../public/ui/order.js';
import { withoutFamily } from '../public/ui/sub-rules.js';
import { archiveTarget, everyRow, findRow, LOOSE_HOME, LOOSE_NAMES, looseHome, moveTargets, neighbour, nestRow, nestTargets, nextStop, placeRow, rootOf, sessionTargets, sortByTitle, stampTurns, stayAbove, unnestRow, withKids, withoutRow } from '../public/ui/tree.js';

test('down and up step one stop, Home and End jump to the ends, and there is nothing past either end', () => {
  const from = (at, key) => nextStop(5, at, key);
  assert.equal(from(2, 'ArrowDown'), 3);
  assert.equal(from(2, 'ArrowUp'), 1);
  assert.equal(from(3, 'Home'), 0);
  assert.equal(from(1, 'End'), 4);
  assert.equal(from(4, 'ArrowDown'), -1);
  assert.equal(from(0, 'ArrowUp'), -1);
});

test('with no stop focused, down and up land on the start and no other key does anything', () => {
  assert.equal(nextStop(5, -1, 'ArrowDown', 3), 3);
  assert.equal(nextStop(5, -1, 'ArrowUp', 3), 3);
  assert.equal(nextStop(5, -1, 'ArrowDown'), 0);
  for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'Enter', 'a']) assert.equal(nextStop(5, -1, key), -1, key);
});

test('a key that is not for the walk goes nowhere, and neither does any key when the list has no stops', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Tab', 'constructor']) assert.equal(nextStop(5, 2, key), -1, key);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.equal(nextStop(0, -1, key), -1, key);
});

const PROJECTS = [{ id: 'cp-a', name: 'Capcom' }, { id: 'cp-b', name: 'Notes' }];

test('a group in Home can go to any project, and one in a project can also go back to Home', () => {
  assert.deepEqual(moveTargets(PROJECTS, { id: 'cg-a', project: null }), [{ label: 'Move to Capcom', project: 'cp-a' }, { label: 'Move to Notes', project: 'cp-b' }]);
  assert.deepEqual(moveTargets(PROJECTS, { id: 'cg-a', project: 'cp-a' }), [{ label: 'Move to Home', project: null }, { label: 'Move to Notes', project: 'cp-b' }]);
});

test('a group has nowhere to go with no project, and in the only project it can only leave', () => {
  assert.deepEqual(moveTargets([], { id: 'cg-a', project: null }), []);
  assert.deepEqual(moveTargets([PROJECTS[0]], { id: 'cg-a', project: 'cp-a' }), [{ label: 'Move to Home', project: null }]);
});

const PLACES = {
  projects: [{ id: 'cp-a', name: 'Capcom' }, { id: 'cp-b', name: 'Notes' }, { id: 'cp-c', name: 'Solo' }],
  groups: [
    { id: 'cg-1', name: 'Work', project: 'cp-a' },
    { id: 'cg-2', name: 'Home', project: null },
    { id: 'cg-3', name: 'Ideas', project: 'cp-b' },
    { id: 'cg-4', name: 'Review', project: 'cp-a' },
    { id: 'cg-5', name: 'Only', project: 'cp-c' },
    { id: 'cg-6', name: 'Later', project: null },
  ],
};
const WORK = { group: 'Capcom', items: [{ label: 'Work', section: 'cg-1' }, { label: 'Review', section: 'cg-4' }] };
const IDEAS = { group: 'Notes', items: [{ label: 'Ideas', section: 'cg-3' }] };
const ONLY = { group: 'Solo', items: [{ label: 'Only', section: 'cg-5' }] };
const TOP = [{ label: 'Home', section: 'cg-2' }, { label: 'Later', section: 'cg-6' }];
const PINNED = { label: 'Pinned', section: 'pinned' };
const ROUTINES = { label: 'Routines', section: 'routines' };
const targets = (extra = {}) => sessionTargets(PLACES, { id: 'x', source: 'desktop', group: null, pinned: false, routine: null, ...extra });

test('a session leaves for the loose list of the app it came from, and a routine run has no loose list', () => {
  assert.deepEqual(LOOSE_HOME, { capcom: 'started', desktop: 'ungrouped', cli: 'other' });
  assert.deepEqual(LOOSE_NAMES, { started: 'Started here', ungrouped: 'Ungrouped', other: 'Terminal and other' });
  assert.deepEqual(['capcom', 'desktop', 'cli'].map(source => looseHome({ source, routine: null })), ['started', 'ungrouped', 'other']);
  assert.equal(looseHome({ source: 'desktop', routine: 'nightly' }), null);
});

test('a loose session can go to Pinned, then each project\'s groups under the project, then the top-level groups, and not back where it is', () => {
  assert.deepEqual(targets(), [PINNED, WORK, IDEAS, ONLY, ...TOP]);
  assert.deepEqual(targets({ source: 'capcom' }), [PINNED, WORK, IDEAS, ONLY, ...TOP]);
  assert.deepEqual(targets({ source: 'cli' }), [PINNED, WORK, IDEAS, ONLY, ...TOP]);
});

test('a session in a group can go to every place but that group, and back to the loose list of the app it came from', () => {
  assert.deepEqual(targets({ group: 'cg-4' }), [PINNED, { group: 'Capcom', items: [WORK.items[0]] }, IDEAS, ONLY, ...TOP, { label: 'Ungrouped', section: 'ungrouped' }]);
  assert.deepEqual(targets({ group: 'cg-2', source: 'capcom' }), [PINNED, WORK, IDEAS, ONLY, TOP[1], { label: 'Started here', section: 'started' }]);
  assert.deepEqual(targets({ group: 'cg-6', source: 'cli' }).at(-1), { label: 'Terminal and other', section: 'other' });
});

test('a pinned session has no Pinned to go to, and can go to every group and back to its loose list', () => {
  assert.deepEqual(targets({ pinned: true }), [WORK, IDEAS, ONLY, ...TOP, { label: 'Ungrouped', section: 'ungrouped' }]);
  assert.deepEqual(targets({ pinned: true, group: 'cg-1' }), [WORK, IDEAS, ONLY, ...TOP, { label: 'Ungrouped', section: 'ungrouped' }], 'a pinned session shows in Pinned, not in the group it was left assigned to');
});

test('a project is left out when the only group it has is the session\'s own', () => {
  assert.deepEqual(targets({ group: 'cg-5', source: 'capcom' }), [PINNED, WORK, IDEAS, ...TOP, { label: 'Started here', section: 'started' }]);
});

test('a routine run in a group or pinned can also go back to Routines, which comes first, and has no loose list to go to', () => {
  assert.deepEqual(targets({ routine: 'nightly', group: 'cg-1' }), [ROUTINES, PINNED, { group: 'Capcom', items: [WORK.items[1]] }, IDEAS, ONLY, ...TOP]);
  assert.deepEqual(targets({ routine: 'nightly', pinned: true }), [ROUTINES, WORK, IDEAS, ONLY, ...TOP]);
});

test('a routine run that is neither in a group nor pinned is already under its routine', () => {
  assert.deepEqual(targets({ routine: 'nightly' }), [PINNED, WORK, IDEAS, ONLY, ...TOP]);
});

test('with no projects or groups a session can only be pinned or unpinned, and one with nowhere to go has no targets', () => {
  const bare = { projects: [], groups: [] };
  assert.deepEqual(sessionTargets(bare, { id: 'x', source: 'desktop', group: null, pinned: false, routine: null }), [PINNED]);
  assert.deepEqual(sessionTargets(bare, { id: 'x', source: 'desktop', group: null, pinned: true, routine: null }), [{ label: 'Ungrouped', section: 'ungrouped' }]);
  assert.deepEqual(sessionTargets(bare, { id: 'x', source: 'unknown', group: null, pinned: true, routine: null }), []);
});

test('the targets are plain data and the list they were made from is not changed', () => {
  const before = JSON.stringify(PLACES);
  const made = targets({ group: 'cg-1' });
  assert.deepEqual(JSON.parse(JSON.stringify(made)), made);
  assert.equal(JSON.stringify(PLACES), before);
});

const row = (id, extra = {}) => ({ id, title: id, ...extra });
// The sort the server sends for each list: Desktop's, or newest first for a list it holds none for.
const RECENT = { by: 'recency', ascending: false };
const TITLES = { by: 'alpha', ascending: false };
const SORTS = { pinned: RECENT, routines: RECENT, sessions: RECENT };
const LIST = {
  station: 'mac',
  problem: null,
  projects: [{ id: 'cp-a', name: 'Capcom' }],
  sorts: SORTS,
  pinned: [row('p1', { pinned: true }), row('p2', { pinned: true })],
  groups: [{ id: 'cg-a', name: 'Work', project: 'cp-a', sort: RECENT, sessions: [row('g1'), row('g2')] }, { id: 'cg-b', name: 'Home', project: null, sort: RECENT, sessions: [] }],
  routines: [
    { name: 'nightly', latest: row('r3'), earlier: [row('r2'), row('r1')] },
    { name: 'weekly', latest: row('w1'), earlier: [] },
  ],
  started: [row('s1'), row('s2')],
  ungrouped: [row('u1'), row('u2')],
  other: [row('o1')],
};

const idsOf = ix => [ix.pinned, ...ix.groups.map(g => g.sessions), ix.started, ix.ungrouped, ix.other].map(list => list.map(r => r.id));

test('a session is taken out of the one list it is in, and the other lists are left as they were', () => {
  for (const id of ['p2', 'g1', 's2', 'u1', 'o1']) {
    const was = idsOf(LIST);
    assert.equal(was.filter(list => list.includes(id)).length, 1, `${id} is in one list`);
    assert.deepEqual(idsOf(withoutRow(LIST, id)), was.map(list => list.filter(i => i !== id)), id);
    assert.deepEqual(withoutRow(LIST, id).routines, LIST.routines, `${id} is in no routine`);
  }
});

test('a session taken out as a family leaves with everything below it, at any depth, and a child takes its own sub sessions along', () => {
  const kids = [row('c1', { via: 'g1' }), row('c2', { via: 'c1' }), row('c3', { via: 'g1' })];
  const ix = { ...LIST, groups: [{ ...LIST.groups[0], sessions: [row('g1', { children: kids }), row('g2')] }, LIST.groups[1]] };
  assert.deepEqual(idsOf(withoutFamily(ix, 'g1')), [['p1', 'p2'], ['g2'], [], ['s1', 's2'], ['u1', 'u2'], ['o1']]);
  const [top] = withoutFamily(ix, 'c1').groups[0].sessions;
  assert.deepEqual(top.children.map(r => r.id), ['c3'], 'c2 was below c1, so it went too');
});

test('the list keeps everything else it had, and the list it was given is not changed', () => {
  const { pinned, groups, routines, started, ungrouped, other, ...rest } = withoutRow(LIST, 'u1');
  assert.deepEqual(rest, { station: 'mac', problem: null, projects: [{ id: 'cp-a', name: 'Capcom' }], sorts: SORTS });
  assert.deepEqual(groups.map(({ sessions, ...group }) => group), LIST.groups.map(({ sessions, ...group }) => group));
  assert.deepEqual(idsOf(LIST), [['p1', 'p2'], ['g1', 'g2'], [], ['s1', 's2'], ['u1', 'u2'], ['o1']]);
});

test('the latest run of a routine is replaced by the next run, and an earlier run just goes', () => {
  const [nightly, weekly] = withoutRow(LIST, 'r3').routines;
  assert.deepEqual([nightly.name, nightly.latest.id, nightly.earlier.map(r => r.id)], ['nightly', 'r2', ['r1']]);
  assert.deepEqual(weekly, LIST.routines[1]);
  const [after] = withoutRow(LIST, 'r2').routines;
  assert.deepEqual([after.latest.id, after.earlier.map(r => r.id)], ['r3', ['r1']]);
});

test('a routine with one run is gone once that run is, and a session that is not in the list changes nothing', () => {
  assert.deepEqual(withoutRow(LIST, 'w1').routines.map(g => g.name), ['nightly']);
  assert.deepEqual(withoutRow(LIST, 'nobody'), LIST);
});

const person = (id, extra = {}) => ({ id, title: id, source: 'desktop', routine: null, group: null, pinned: false, sortAt: 0, ...extra });
// A child nests under its parent unless `via` names another session of the family.
const kid = (id, parent, extra = {}) => person(id, { parent, via: parent, ...extra });
// Work holds g1 with two children, Pinned holds p1 with one, and the loose list holds two sessions with none. Work goes by title, and
// the other lists newest first.
const FAM = {
  station: 'mac',
  problem: null,
  projects: [],
  sorts: SORTS,
  pinned: [person('p1', { pinned: true, sortAt: 50, children: [kid('pk', 'p1', { pinned: true, sortAt: 40 })] })],
  groups: [
    { id: 'cg-a', name: 'Work', project: null, sort: TITLES, sessions: [person('g1', { group: 'cg-a', children: [kid('k1', 'g1', { group: 'cg-a' }), kid('k2', 'g1', { group: 'cg-a' })] }), person('g2', { group: 'cg-a' })] },
    { id: 'cg-b', name: 'Home', project: null, sort: RECENT, sessions: [] },
  ],
  routines: [{ name: 'nightly', latest: person('r1', { routine: 'nightly' }), earlier: [] }],
  started: [],
  ungrouped: [person('u1', { sortAt: 30 }), person('u2', { sortAt: 20 })],
  other: [],
};

// A list as ids, each session with its children after it in brackets.
const describe = r => (r.children ? `${r.id}[${r.children.map(c => c.id).join(',')}]` : r.id);
const shapeOf = ix => ({ pinned: ix.pinned.map(describe), groups: Object.fromEntries(ix.groups.map(g => [g.id, g.sessions.map(describe)])), ungrouped: ix.ungrouped.map(describe) });
const work = ix => shapeOf(ix).groups['cg-a'];

test('a nested session is found like any other, and its root is the session it shows under', () => {
  assert.deepEqual(everyRow(FAM).map(r => r.id).sort(), ['g1', 'g2', 'k1', 'k2', 'p1', 'pk', 'r1', 'u1', 'u2']);
  assert.deepEqual(withKids([FAM.pinned[0], person('x')]).map(r => r.id), ['p1', 'pk', 'x']);
  assert.equal(findRow(FAM, 'k1').parent, 'g1');
  assert.equal(findRow(FAM, 'nobody'), null);
  assert.equal(findRow(null, 'k1'), null);
  assert.deepEqual(['k1', 'g1', 'pk', 'u1'].map(id => rootOf(FAM, id).id), ['g1', 'g1', 'p1', 'u1']);
  assert.equal(rootOf(FAM, 'nobody'), null);
});

test('a session taken out hands the sessions nested under it to its list, in the order that list keeps', () => {
  const out = withoutRow(FAM, 'g1');
  assert.deepEqual(work(out), ['g2', 'k1', 'k2']);
  assert.deepEqual(out.groups[0].sessions.map(r => [r.parent ?? null, r.via ?? null]), [[null, null], [null, null], [null, null]]);
  assert.deepEqual(shapeOf(withoutRow(FAM, 'p1')).pinned, ['pk']);
  assert.deepEqual(work(withoutRow(FAM, 'g1', { withChildren: true })), ['g2'], 'with `withChildren` they go with it');
});

test('a nested session leaves its parent, and a parent with no child left has no children list', () => {
  const one = withoutRow(FAM, 'k1');
  assert.deepEqual(work(one), ['g1[k2]', 'g2']);
  const none = withoutRow(one, 'k2');
  assert.deepEqual(work(none), ['g1', 'g2']);
  assert.equal('children' in none.groups[0].sessions[0], false);
});

test('a dropped parent takes its children along, in the place it is dropped on', () => {
  const home = placeRow(FAM, 'g1', 'cg-b');
  assert.deepEqual(shapeOf(home).groups, { 'cg-a': ['g2'], 'cg-b': ['g1[k1,k2]'] });
  assert.deepEqual(home.groups[1].sessions[0].children.map(c => [c.group, c.pinned, c.parent]), [['cg-b', false, 'g1'], ['cg-b', false, 'g1']]);
  const pinned = placeRow(FAM, 'g1', 'pinned');
  assert.deepEqual(shapeOf(pinned).pinned, ['p1[pk]', 'g1[k1,k2]']);
  assert.deepEqual(pinned.pinned[1].children.map(c => [c.group, c.pinned]), [[null, true], [null, true]]);
});

test('a dropped nested session leaves its parent and shows in the section, even the section its family is in', () => {
  const elsewhere = placeRow(FAM, 'k1', 'cg-b');
  assert.deepEqual(shapeOf(elsewhere).groups, { 'cg-a': ['g1[k2]', 'g2'], 'cg-b': ['k1'] });
  assert.deepEqual([elsewhere.groups[1].sessions[0].parent, elsewhere.groups[1].sessions[0].group], [null, 'cg-b']);
  assert.deepEqual(work(placeRow(FAM, 'k1', 'cg-a')), ['g1[k2]', 'g2', 'k1']);
  assert.deepEqual(shapeOf(placeRow(FAM, 'k1', 'other')).ungrouped, ['u1', 'u2', 'k1'], 'a loose list sends it to the one of its own app');
});

test('a session dropped where it already is changes nothing, but a nested one is never in place', () => {
  for (const [id, section] of [['g2', 'cg-a'], ['p1', 'pinned'], ['u1', 'ungrouped'], ['nobody', 'pinned']]) assert.equal(placeRow(FAM, id, section), FAM, `${id} on ${section}`);
  for (const [id, section] of [['k1', 'cg-a'], ['pk', 'pinned']]) assert.notEqual(placeRow(FAM, id, section), FAM, `${id} on ${section}`);
});

test('a session nested under another leaves its list and joins the other\'s children, in the other\'s place', () => {
  const nested = nestRow(FAM, 'u1', 'g1');
  assert.deepEqual(shapeOf(nested), { pinned: ['p1[pk]'], groups: { 'cg-a': ['g1[k1,k2,u1]', 'g2'], 'cg-b': [] }, ungrouped: ['u2'] });
  const joined = nested.groups[0].sessions[0].children.at(-1);
  assert.deepEqual([joined.parent, joined.group, joined.pinned], ['g1', 'cg-a', false]);

  const pinned = nestRow(FAM, 'u1', 'p1');
  assert.deepEqual(shapeOf(pinned).pinned, ['p1[pk,u1]'], 'children of a pinned session go newest first');
  assert.deepEqual([pinned.pinned[0].children[1]].map(c => [c.parent, c.group, c.pinned]), [['p1', null, true]]);
});

test('a parent nests with its children, all under the new parent, and a drop on a nested session nests under that session\'s parent', () => {
  const nested = nestRow(FAM, 'g1', 'g2');
  assert.deepEqual(work(nested), ['g2[g1,k1,k2]']);
  assert.deepEqual(nested.groups[0].sessions[0].children.map(c => [c.parent, 'children' in c]), [['g2', false], ['g2', false], ['g2', false]]);
  assert.deepEqual(work(nestRow(FAM, 'u1', 'k1')), ['g1[k1,k2,u1]', 'g2']);
});

test('a nested session moves from one parent to another', () => {
  assert.deepEqual(work(nestRow(FAM, 'k1', 'g2')), ['g1[k2]', 'g2[k1]']);
});

test('nesting changes nothing when the session is nested there already, would go under itself or its own child, or is not in the list', () => {
  for (const [id, parent] of [['k1', 'g1'], ['k1', 'k2'], ['g1', 'g1'], ['g1', 'k1'], ['nobody', 'g1'], ['u1', 'nobody']]) assert.equal(nestRow(FAM, id, parent), FAM, `${id} under ${parent}`);
});

test('a session taken out of its parent shows in the list its parent is in, and one that is not nested changes nothing', () => {
  const out = unnestRow(FAM, 'k1');
  assert.deepEqual(work(out), ['g1[k2]', 'g2', 'k1']);
  assert.equal(out.groups[0].sessions[2].parent, null);
  assert.deepEqual(shapeOf(unnestRow(FAM, 'pk')).pinned, ['p1', 'pk']);
  assert.equal(unnestRow(FAM, 'g2'), FAM);
  assert.equal(unnestRow(FAM, 'nobody'), FAM);
});

// Ungrouped holds a parent with a child from each app that starts sessions, and a routine run. Started here holds one session already.
const LOOSE_FAM = {
  ...FAM,
  started: [person('s1', { source: 'capcom', sortAt: 100 })],
  ungrouped: [person('lp', { sortAt: 90, children: [
    kid('ld', 'lp', { sortAt: 80 }),
    kid('lc', 'lp', { source: 'capcom', sortAt: 70 }),
    kid('lt', 'lp', { source: 'cli', sortAt: 60 }),
    kid('lr', 'lp', { routine: 'nightly', sortAt: 50 }),
  ] })],
};
const loose = ix => ({ started: ix.started.map(describe), ungrouped: ix.ungrouped.map(describe), other: ix.other.map(describe) });

test('a session taken out of a loose parent shows in the loose list of the app it came from, which is not always its parent\'s', () => {
  assert.deepEqual(loose(unnestRow(LOOSE_FAM, 'ld')), { started: ['s1'], ungrouped: ['lp[lc,lt,lr]', 'ld'], other: [] });
  assert.deepEqual(loose(unnestRow(LOOSE_FAM, 'lc')), { started: ['s1', 'lc'], ungrouped: ['lp[ld,lt,lr]'], other: [] });
  assert.deepEqual(loose(unnestRow(LOOSE_FAM, 'lt')), { started: ['s1'], ungrouped: ['lp[ld,lc,lr]'], other: ['lt'] });
  assert.deepEqual([unnestRow(LOOSE_FAM, 'lc').started[1].parent, unnestRow(LOOSE_FAM, 'lc').started[1].source], [null, 'capcom']);
});

test('a routine run taken out of a loose parent shows in no list until the list is loaded again, and never in a wrong one', () => {
  const out = unnestRow(LOOSE_FAM, 'lr');
  assert.deepEqual(loose(out), { started: ['s1'], ungrouped: ['lp[ld,lc,lt]'], other: [] });
  assert.deepEqual(out.routines, LOOSE_FAM.routines);
  assert.equal(findRow(out, 'lr'), null);
});

test('a session taken out of a parent in a group or Pinned shows there, whatever app it came from', () => {
  const grouped = { ...FAM, groups: [{ ...FAM.groups[0], sessions: [person('g1', { group: 'cg-a', children: [kid('kc', 'g1', { group: 'cg-a', source: 'capcom' }), kid('kt', 'g1', { group: 'cg-a', source: 'cli' })] })] }, FAM.groups[1]] };
  assert.deepEqual(shapeOf(unnestRow(grouped, 'kc')).groups, { 'cg-a': ['g1[kt]', 'kc'], 'cg-b': [] });
  assert.deepEqual(shapeOf(unnestRow(grouped, 'kt')).groups, { 'cg-a': ['g1[kc]', 'kt'], 'cg-b': [] });
  const pinned = { ...FAM, pinned: [person('p1', { pinned: true, children: [kid('pc', 'p1', { pinned: true, source: 'capcom' })] })] };
  assert.deepEqual(shapeOf(unnestRow(pinned, 'pc')).pinned, ['p1', 'pc']);
  assert.deepEqual(unnestRow(pinned, 'pc').started, []);
});

test('archiving a loose parent frees each child into the loose list of its own app, and a routine run to none', () => {
  const out = withoutRow(LOOSE_FAM, 'lp');
  assert.deepEqual(loose(out), { started: ['s1', 'lc'], ungrouped: ['ld'], other: ['lt'] });
  assert.equal(findRow(out, 'lr'), null);
  assert.deepEqual([out.started[1], out.ungrouped[0], out.other[0]].map(r => r.parent), [null, null, null]);
});

test('archiving a parent in a group or Pinned frees its children into that list, whatever app they came from', () => {
  const grouped = { ...FAM, groups: [{ ...FAM.groups[0], sessions: [person('g1', { group: 'cg-a', children: [kid('kc', 'g1', { group: 'cg-a', source: 'capcom' }), kid('kt', 'g1', { group: 'cg-a', source: 'cli' })] })] }, FAM.groups[1]] };
  assert.deepEqual(shapeOf(withoutRow(grouped, 'g1')).groups, { 'cg-a': ['kc', 'kt'], 'cg-b': [] });
  const pinned = { ...FAM, pinned: [person('p1', { pinned: true, children: [kid('pc', 'p1', { pinned: true, source: 'cli' })] })] };
  assert.deepEqual(shapeOf(withoutRow(pinned, 'p1')).pinned, ['pc']);
  assert.deepEqual(withoutRow(pinned, 'p1').other, []);
});

test('a session can be nested under the other top level sessions in the list it shows in, but not a routine run, its parent or itself', () => {
  const targets = (ix, id) => nestTargets(ix, findRow(ix, id)).map(r => r.id);
  assert.deepEqual(targets(FAM, 'u1'), ['u2']);
  assert.deepEqual(targets(FAM, 'g1'), ['g2']);
  assert.deepEqual(targets(FAM, 'k1'), ['g2'], 'a nested session is offered the others beside its parent, and not its parent');
  assert.deepEqual(targets(FAM, 'p1'), []);
  assert.deepEqual(targets(FAM, 'pk'), [], 'the only other pinned session is its parent');
  assert.deepEqual(targets(FAM, 'r1'), [], 'a routine run has no list to nest in');
  const mixed = { ...FAM, groups: [{ ...FAM.groups[0], sessions: [...FAM.groups[0].sessions, person('run', { group: 'cg-a', routine: 'nightly' })] }, FAM.groups[1]] };
  assert.deepEqual(targets(mixed, 'g2'), ['g1']);
});

// The same lists with Work going newest first, and a time on every row, so each edit has an order to follow.
const NEWEST = {
  ...FAM,
  groups: [
    { ...FAM.groups[0], sort: RECENT, sessions: [
      person('g1', { group: 'cg-a', sortAt: 10, children: [kid('k1', 'g1', { group: 'cg-a', sortAt: 80 }), kid('k2', 'g1', { group: 'cg-a', sortAt: 20 })] }),
      person('g2', { group: 'cg-a', sortAt: 50 }),
    ] },
    FAM.groups[1],
  ],
  ungrouped: [person('u1', { sortAt: 60 }), person('u2', { sortAt: 20 })],
};

test('a row lands in a list where that list\'s own sort puts it, newest first or by title', () => {
  assert.deepEqual(work(NEWEST), ['g1[k1,k2]', 'g2']);
  assert.deepEqual(work(placeRow(NEWEST, 'u1', 'cg-a')), ['g1[k1,k2]', 'u1', 'g2'], 'u1 is newer than g2');
  assert.deepEqual(work(placeRow({ ...NEWEST, groups: [{ ...NEWEST.groups[0], sort: TITLES }, NEWEST.groups[1]] }, 'u1', 'cg-a')), ['g1[k1,k2]', 'g2', 'u1'], 'by title it comes last');
  assert.deepEqual(shapeOf(placeRow(NEWEST, 'g1', 'ungrouped')).ungrouped, ['g1[k1,k2]', 'u1', 'u2'], 'a family sits where its newest member does');
});

test('the sessions a parent frees, and those nested under another, follow the sort of the list they are in', () => {
  assert.deepEqual(work(withoutRow(NEWEST, 'g1')), ['k1', 'g2', 'k2']);
  assert.deepEqual(work(withoutRow(FAM, 'g1')), ['g2', 'k1', 'k2'], 'by title they sort among the rest by name');
  assert.deepEqual(work(nestRow(NEWEST, 'u1', 'g2')), ['g1[k1,k2]', 'g2[u1]']);
  assert.deepEqual(work(nestRow(NEWEST, 'u1', 'g1')), ['g1[k1,u1,k2]', 'g2']);
  assert.deepEqual(work(unnestRow(NEWEST, 'k2')), ['g1[k1]', 'g2', 'k2']);
});

test('a family is placed again when its newest member leaves, and stays where it was when an older one does', () => {
  assert.deepEqual(work(NEWEST), ['g1[k1,k2]', 'g2']);
  assert.deepEqual(work(withoutRow(NEWEST, 'k1')), ['g2', 'g1[k2]'], 'k2 is older than g2, so the family goes below it');
  assert.deepEqual(work(unnestRow(NEWEST, 'k1')), ['k1', 'g2', 'g1[k2]'], 'k1 shows where its own time puts it');
  assert.deepEqual(work(withoutRow(NEWEST, 'k2')), ['g1[k1]', 'g2']);
  assert.deepEqual(work(withoutRow(NEWEST, 'g2')), ['g1[k1,k2]']);
});

// Work holds h, with a and c under it, b under a and d under b. The server sends them depth first, and each names the session it nests under.
const DEEP = {
  ...FAM,
  groups: [
    { ...FAM.groups[0], sort: RECENT, sessions: [person('h', { group: 'cg-a', sortAt: 5, children: [
      kid('a', 'h', { group: 'cg-a', sortAt: 40 }),
      kid('b', 'h', { group: 'cg-a', via: 'a', sortAt: 30 }),
      kid('d', 'h', { group: 'cg-a', via: 'b', sortAt: 10 }),
      kid('c', 'h', { group: 'cg-a', sortAt: 20 }),
    ] })] },
    FAM.groups[1],
  ],
};
const viasOf = (ix, id) => Object.fromEntries(findRow(ix, id).children.map(c => [c.id, c.via]));

test('a family goes depth first as the server sends it, and a session that joins it nests under the head', () => {
  assert.deepEqual(work(DEEP), ['h[a,b,d,c]']);
  const joined = nestRow(DEEP, 'u1', 'd');
  assert.deepEqual(work(joined), ['h[a,b,d,u1,c]'], 'u1 sorts between a and c among the head\'s children, with a\'s own children after a');
  assert.deepEqual(viasOf(joined, 'h'), { a: 'h', b: 'a', d: 'b', u1: 'h', c: 'h' });
});

test('when a session leaves a family the ones straight under it go under the one it showed under, and the rest keep their places', () => {
  const archived = withoutRow(DEEP, 'a');
  assert.deepEqual(work(archived), ['h[b,d,c]']);
  assert.deepEqual(viasOf(archived, 'h'), { b: 'h', d: 'b', c: 'h' });

  const freed = unnestRow(DEEP, 'b');
  assert.deepEqual(work(freed), ['h[a,d,c]', 'b']);
  assert.deepEqual(viasOf(freed, 'h'), { a: 'h', d: 'a', c: 'h' });

  const dropped = placeRow(DEEP, 'd', 'cg-b');
  assert.deepEqual(shapeOf(dropped).groups, { 'cg-a': ['h[a,b,c]'], 'cg-b': ['d'] });
  assert.deepEqual(viasOf(dropped, 'h'), { a: 'h', b: 'a', c: 'h' });

  const last = withoutRow(DEEP, 'c');
  assert.deepEqual(work(last), ['h[a,b,d]'], 'nothing showed under c, so the rest stay depth first');
  assert.deepEqual(viasOf(last, 'h'), { a: 'h', b: 'a', d: 'b' });
});

test('an archived head frees each session straight under it with the ones under that session still under it', () => {
  const freed = withoutRow(DEEP, 'h');
  assert.deepEqual(work(freed), ['a[b,d]', 'c']);
  assert.deepEqual(viasOf(freed, 'a'), { b: 'a', d: 'b' });
  assert.deepEqual(['a', 'b', 'd', 'c'].map(id => findRow(freed, id).parent ?? null), [null, 'a', 'a', null]);
});

test('a session placed elsewhere nests under nothing and one nested elsewhere under its new parent, and the rest of its family stays with the head', () => {
  const moved = placeRow(DEEP, 'a', 'cg-b');
  assert.deepEqual([findRow(moved, 'a').parent, findRow(moved, 'a').via], [null, null]);
  const nested = nestRow(DEEP, 'a', 'h');
  assert.equal(nested, DEEP, 'a is under h already');
  const other = nestRow({ ...DEEP, groups: [DEEP.groups[0], { ...DEEP.groups[1], sessions: [person('z', { group: 'cg-b' })] }] }, 'a', 'z');
  assert.deepEqual(shapeOf(other).groups['cg-b'], ['z[a]']);
  assert.equal(findRow(other, 'a').via, 'z');
  assert.deepEqual(viasOf(other, 'h'), { b: 'h', d: 'b', c: 'h' });
});

test('an edit leaves the lists it was given as they were', () => {
  const before = JSON.stringify([NEWEST, DEEP]);
  for (const edit of [ix => placeRow(ix, 'u1', 'cg-a'), ix => withoutRow(ix, 'g1'), ix => nestRow(ix, 'u1', 'g2'), ix => unnestRow(ix, 'k2')]) edit(NEWEST);
  for (const edit of [ix => withoutRow(ix, 'a'), ix => unnestRow(ix, 'b'), ix => placeRow(ix, 'd', 'cg-b'), ix => nestRow(ix, 'u1', 'd')]) edit(DEEP);
  assert.equal(JSON.stringify([NEWEST, DEEP]), before);
});

test('none of these changes the list it was given', () => {
  const before = JSON.stringify(FAM);
  for (const edit of [ix => placeRow(ix, 'g1', 'cg-b'), ix => placeRow(ix, 'k1', 'pinned'), ix => nestRow(ix, 'u1', 'g1'), ix => nestRow(ix, 'g1', 'g2'), ix => unnestRow(ix, 'k1'), ix => withoutRow(ix, 'g1'), ix => withoutRow(ix, 'k1')]) edit(FAM);
  assert.equal(JSON.stringify(FAM), before);
  const loosely = JSON.stringify(LOOSE_FAM);
  for (const edit of [ix => unnestRow(ix, 'lc'), ix => unnestRow(ix, 'lr'), ix => withoutRow(ix, 'lp')]) edit(LOOSE_FAM);
  assert.equal(JSON.stringify(LOOSE_FAM), loosely);
});

// The list as the server sends it: each group in the order of the sort it holds, which is not the title order, and a title on every row.
const CREATED = { by: 'created', ascending: false };
const SERVED = {
  station: 'mac',
  problem: null,
  projects: [{ id: 'cp-a', name: 'Capcom' }],
  sorts: SORTS,
  pinned: [person('pz', { pinned: true, sortAt: 90 }), person('pa', { pinned: true, sortAt: 80 })],
  groups: [
    { id: 'cg-r', name: 'Recent', project: null, sort: RECENT, sessions: [person('blank', { group: 'cg-r', title: UNTITLED, sortAt: 40 }), person('cat', { group: 'cg-r', sortAt: 30 }), person('ant', { group: 'cg-r', sortAt: 20 }), person('bee', { group: 'cg-r', sortAt: 10 })] },
    { id: 'cg-c', name: 'Made', project: null, sort: CREATED, sessions: [person('eel', { group: 'cg-c', createdAt: 300, sortAt: 300 }), person('dog', { group: 'cg-c', createdAt: 200, sortAt: 200 }), person('cow', { group: 'cg-c', createdAt: 100, sortAt: 100 })] },
    { id: 'cg-f', name: 'Families', project: 'cp-a', sort: RECENT, sessions: [
      person('zulu', { group: 'cg-f', sortAt: 100, children: [kid('abel', 'zulu', { group: 'cg-f', sortAt: 95 }), kid('yank', 'zulu', { group: 'cg-f', sortAt: 90 }), kid('xray', 'zulu', { group: 'cg-f', sortAt: 80 }), kid('whisky', 'zulu', { group: 'cg-f', via: 'xray', sortAt: 70 })] }),
      person('mike', { group: 'cg-f', sortAt: 60 }),
      person('alfa', { group: 'cg-f', sortAt: 50 }),
    ] },
    { id: 'cg-e', name: 'Empty', project: null, sort: RECENT, sessions: [] },
  ],
  routines: [{ name: 'nightly', latest: person('r2', { routine: 'nightly', sortAt: 9 }), earlier: [person('r1', { routine: 'nightly', sortAt: 8 })] }],
  started: [person('sz', { source: 'capcom', sortAt: 40 }), person('sa', { source: 'capcom', sortAt: 30 })],
  ungrouped: [person('uz', { sortAt: 20 }), person('bun', { sortAt: 15 }), person('ua', { sortAt: 10 })],
  other: [person('oz', { source: 'cli', sortAt: 8 }), person('oa', { source: 'cli', sortAt: 7 })],
};
const groupsOf = ix => shapeOf(ix).groups;

test('every group lists its sessions A to Z by title, whatever sort it came with, and the rows with no title go last', () => {
  assert.deepEqual(groupsOf(SERVED)['cg-r'], ['blank', 'cat', 'ant', 'bee'], 'it came newest first');
  assert.deepEqual(groupsOf(SERVED)['cg-c'], ['eel', 'dog', 'cow'], 'it came by when each was made');
  const out = groupsOf(sortByTitle(SERVED));
  assert.deepEqual(out['cg-r'], ['ant', 'bee', 'cat', 'blank']);
  assert.deepEqual(out['cg-c'], ['cow', 'dog', 'eel']);
  assert.deepEqual(out['cg-e'], []);
});

test('a routine sorts by its own title, not the name its latest run was given on its own', () => {
  const run = (id, routine, title) => person(id, { routine, title });
  const routines = [
    { name: 'mail', title: 'Mail drafts', latest: run('m1', 'mail', 'Zebra, one run'), earlier: [] },
    { name: 'gone', latest: run('g1', 'gone', 'Nest'), earlier: [] },
  ];
  assert.deepEqual(sortByTitle({ ...SERVED, routines }).routines.map(g => g.name), ['mail', 'gone']);
});

test('a group that came Z to A by title goes A to Z', () => {
  const backwards = { ...SERVED, groups: [{ id: 'cg-z', name: 'Backwards', project: null, sort: { by: 'alpha', ascending: true }, sessions: ['cat', 'bee', 'ant'].map(id => person(id, { group: 'cg-z' })) }] };
  assert.deepEqual(groupsOf(sortByTitle(backwards))['cg-z'], ['ant', 'bee', 'cat']);
});

test('a family sits where its head\'s title puts it, and its children follow it by title, depth first', () => {
  assert.deepEqual(groupsOf(SERVED)['cg-f'], ['zulu[abel,yank,xray,whisky]', 'mike', 'alfa']);
  assert.deepEqual(groupsOf(sortByTitle(SERVED))['cg-f'], ['alfa', 'mike', 'zulu[abel,xray,whisky,yank]'], 'abel sorts first but does not lift its family');
});

test('a group in a project is sorted by title like one in Home', () => {
  const out = sortByTitle(SERVED);
  assert.deepEqual(out.groups.filter(g => g.project === 'cp-a').map(g => g.id), ['cg-f']);
  assert.deepEqual(out.groups.filter(g => !g.project).map(g => g.id), ['cg-r', 'cg-c', 'cg-e'], 'the groups stay in the order they came');
  assert.deepEqual(out.groups.find(g => g.project === 'cp-a').sessions.map(r => r.id), ['alfa', 'mike', 'zulu']);
});

test('Pinned and the loose lists go A to Z by title too, with the rows that have no title last', () => {
  const out = sortByTitle({ ...SERVED, pinned: [person('pz', { pinned: true, title: UNTITLED }), person('pb', { pinned: true, title: 'bee' }), person('pa', { pinned: true, title: 'ant' })] });
  assert.deepEqual(out.pinned.map(r => r.id), ['pa', 'pb', 'pz']);
  assert.deepEqual(out.started.map(r => r.id), ['sa', 'sz']);
  assert.deepEqual(out.ungrouped.map(r => r.id), ['bun', 'ua', 'uz']);
  assert.deepEqual(out.other.map(r => r.id), ['oa', 'oz']);
  const blank = sortByTitle({ ...SERVED, ungrouped: [person('x', { title: UNTITLED }), person('y', { title: 'yak' }), person('w', { title: 'wolf' })] });
  assert.deepEqual(blank.ungrouped.map(r => r.id), ['w', 'y', 'x']);
});

test('a family in a loose list sits by its head\'s title, and its children follow in title order', () => {
  const family = person('zulu', { sortAt: 100, children: [kid('yank', 'zulu', { sortAt: 90 }), kid('abel', 'zulu', { sortAt: 80 })] });
  const out = sortByTitle({ ...SERVED, started: [family, person('mike', { sortAt: 10 })] });
  assert.deepEqual(out.started.map(describe), ['mike', 'zulu[abel,yank]']);
});

test('Routines go by the title of their latest run, and each keeps its earlier runs newest first', () => {
  const routine = (name, latest, ...earlier) => ({ name, latest: person(latest, { routine: name }), earlier: earlier.map(id => person(id, { routine: name })) });
  const out = sortByTitle({ ...SERVED, routines: [routine('zed', 'rz', 'rz2', 'rz1'), routine('abe', 'ra', 'ra2', 'ra1')] });
  assert.deepEqual(out.routines.map(g => g.latest.id), ['ra', 'rz']);
  assert.deepEqual(out.routines.map(g => g.earlier.map(r => r.id)), [['ra2', 'ra1'], ['rz2', 'rz1']]);
  assert.deepEqual(out.routines.map(g => g.name), ['abe', 'zed']);
});

test('everything else in the list is left as it was', () => {
  const { groups, pinned, routines, started, ungrouped, other, sorts, ...kept } = sortByTitle(SERVED);
  const { groups: before, pinned: p, routines: r, started: s, ungrouped: u, other: o, sorts: so, ...was } = SERVED;
  assert.deepEqual(kept, was);
  assert.deepEqual(groups.map(({ sessions, sort, ...group }) => group), before.map(({ sessions, sort, ...group }) => group));
});

test('each list now holds the title sort, so a later edit follows the title order', () => {
  assert.deepEqual(TITLE_SORT, TITLES);
  assert.deepEqual(sortByTitle(SERVED).sorts, { pinned: TITLES, routines: TITLES, sessions: TITLES });
  assert.deepEqual(sortByTitle(SERVED).groups.map(g => g.sort), [TITLES, TITLES, TITLES, TITLES]);
});

test('a row dropped into a group after it was sorted lands by title, and by its time before', () => {
  assert.deepEqual(groupsOf(placeRow(sortByTitle(SERVED), 'bun', 'cg-r'))['cg-r'], ['ant', 'bee', 'bun', 'cat', 'blank']);
  assert.deepEqual(groupsOf(placeRow(SERVED, 'bun', 'cg-r'))['cg-r'], ['blank', 'cat', 'ant', 'bun', 'bee']);
});

test('a row dropped into a loose list after it was sorted lands by title', () => {
  assert.deepEqual(placeRow(sortByTitle(SERVED), 'bee', 'ungrouped').ungrouped.map(r => r.id), ['bee', 'bun', 'ua', 'uz']);
  assert.deepEqual(placeRow(sortByTitle(SERVED), 'bee', 'pinned').pinned.map(r => r.id), ['bee', 'pa', 'pz']);
});

test('sorting the groups leaves the list it was given as it was', () => {
  const before = JSON.stringify(SERVED);
  const out = sortByTitle(SERVED);
  assert.equal(JSON.stringify(SERVED), before);
  assert.notEqual(out, SERVED);
  assert.equal(JSON.stringify(sortByTitle(out)), JSON.stringify(out), 'a list that is sorted already comes back the same');
});

// The server sends a row's turn as its age (`turnMs`) and when it began by the server's clock (`turnStartedAt`), which only names the turn.
const turning = (id, turnMs, turnStartedAt, extra) => person(id, { turnMs, turnStartedAt, ...extra });
const listWith = (...sessions) => ({ ...FAM, pinned: [], groups: [{ id: 'cg-a', name: 'Work', project: null, sessions }], routines: [], ungrouped: [] });
const startOf = (ix, id) => findRow(ix, id).turnStart;

test('a row with a turn running starts that long before its list arrived, and a row with no turn gets no start', () => {
  const ix = listWith(turning('a', 4_000, 1_000), person('b'), turning('c', null, 1_000), turning('d', '4000', 1_000));
  assert.equal(stampTurns(ix, null, 100_000), ix, 'the list it was given comes back');
  assert.equal(startOf(ix, 'a'), 96_000);
  for (const id of ['b', 'c', 'd']) assert.equal('turnStart' in findRow(ix, id), false, id);
});

test('a row in the same turn keeps the earlier start it had, so a slow answer never steps the count back, and takes an earlier one', () => {
  const first = stampTurns(listWith(turning('a', 4_000, 1_000)), null, 100_000);
  const slow = stampTurns(listWith(turning('a', 9_000, 1_000)), first, 110_000);
  assert.equal(startOf(slow, 'a'), 96_000, 'this answer would start it at 101000');
  const early = stampTurns(listWith(turning('a', 20_000, 1_000)), slow, 110_000);
  assert.equal(startOf(early, 'a'), 90_000);
});

test('a row in another turn starts again from its own age, and one that had no turn running starts again too', () => {
  const first = stampTurns(listWith(turning('a', 40_000, 1_000)), null, 100_000);
  const next = stampTurns(listWith(turning('a', 2_000, 70_000)), first, 130_000);
  assert.equal(startOf(next, 'a'), 128_000);
  const idle = stampTurns(listWith(person('a')), next, 140_000);
  assert.equal('turnStart' in findRow(idle, 'a'), false, 'the time goes when the turn ends');
  assert.equal(startOf(stampTurns(listWith(turning('a', 1_000, 70_000)), idle, 150_000), 'a'), 149_000);
});

test('a nested session, a routine run and a row that moved between lists are stamped like any other', () => {
  const ix = {
    ...listWith(person('g1', { children: [kid('k1', 'g1', { turnMs: 3_000, turnStartedAt: 5 })] }), turning('m', 6_000, 1_000)),
    routines: [{ name: 'nightly', latest: turning('r1', 1_000, 6, { routine: 'nightly' }), earlier: [turning('r0', 8_000, 7, { routine: 'nightly' })] }],
  };
  const before = stampTurns({ ...listWith(), ungrouped: [turning('m', 4_000, 1_000)] }, null, 40_000);
  stampTurns(ix, before, 50_000);
  assert.deepEqual(['k1', 'r1', 'r0', 'g1'].map(id => startOf(ix, id)), [47_000, 49_000, 42_000, undefined]);
  assert.equal(startOf(ix, 'm'), 36_000, 'the earlier list had it in another place');
});

test('the focus goes to the next row, or to the one before when the row was the last', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(neighbour(ids, 'a'), 'b');
  assert.equal(neighbour(ids, 'b'), 'c');
  assert.equal(neighbour(ids, 'c'), 'b');
});

test('the focus has nowhere to go when the row was the only one or is not in the list', () => {
  assert.equal(neighbour(['a'], 'a'), null);
  assert.equal(neighbour(['a', 'b'], 'x'), null);
  assert.equal(neighbour([], 'a'), null);
});

// Pinned holds p1 with one child. Work holds a family a1 with three children, then a2 and a3. Home holds b1. The routine nightly has two
// earlier runs and weekly has none. Two sessions are loose.
const ABOVE = {
  ...FAM,
  pinned: [person('p1', { pinned: true, children: [kid('pk', 'p1', { pinned: true })] })],
  groups: [
    { id: 'cg-a', name: 'Work', project: null, sort: RECENT, sessions: [
      person('a1', { group: 'cg-a', children: [kid('c1', 'a1', { group: 'cg-a' }), kid('c2', 'a1', { group: 'cg-a' }), kid('c3', 'a1', { group: 'cg-a' })] }),
      person('a2', { group: 'cg-a' }),
      person('a3', { group: 'cg-a' }),
    ] },
    { id: 'cg-b', name: 'Home', project: null, sort: RECENT, sessions: [person('b1', { group: 'cg-b' })] },
  ],
  routines: [
    { name: 'nightly', latest: person('r3', { routine: 'nightly' }), earlier: [person('r2', { routine: 'nightly' }), person('r1', { routine: 'nightly' })] },
    { name: 'weekly', latest: person('w1', { routine: 'weekly' }), earlier: [] },
  ],
  ungrouped: [person('u1'), person('u2')],
};
const ABOVE_ORDER = ['r3', 'r2', 'r1', 'w1', 'p1', 'pk', 'a1', 'c1', 'c2', 'c3', 'a2', 'a3', 'b1', 'u1', 'u2'];
const above = (...ids) => stayAbove(ABOVE, ABOVE_ORDER, ids);

test('a nested session lands on the nested session above it, or the one below it when it is the first, and on its parent only when it was the only one', () => {
  assert.equal(above('c2'), 'c1');
  assert.equal(above('c3'), 'c2');
  assert.equal(above('c1'), 'c2');
  assert.equal(above('pk'), 'p1');
});

test('a top level session lands on the top level session above it and not inside that session\'s family', () => {
  assert.equal(above('a2'), 'a1');
  assert.equal(above('a3'), 'a2');
  assert.equal(above('u2'), 'u1');
});

test('the first top level session of a section lands on the one below it and not on its own children', () => {
  assert.equal(above('a1'), 'a2');
  assert.equal(above('u1'), 'u2');
});

test('the only top level session of a section has nowhere to land, and the section above or below it is no neighbour', () => {
  assert.equal(above('p1'), null);
  assert.equal(above('b1'), null);
});

test('the latest run of a routine lands on its next run, or on the run after when that one leaves too', () => {
  assert.equal(above('r3'), 'r2');
  assert.equal(above('r3', 'r2'), 'r1');
});

test('a routine with no run left lands on the routine above it, or below it when it is the first', () => {
  assert.equal(above('w1'), 'r3');
  assert.equal(above('r3', 'r2', 'r1'), 'w1');
  assert.equal(above('w1', 'r3', 'r2', 'r1'), null);
});

test('an earlier run lands on the earlier run above it, or the one below it when it is the first, and on the routine\'s latest run when none is left', () => {
  assert.equal(above('r1'), 'r2');
  assert.equal(above('r2'), 'r1');
  assert.equal(above('r2', 'r1'), 'r3');
});

test('several sessions land above the topmost of them, whatever order they are named in, and skip the ones leaving with it', () => {
  assert.equal(above('a3', 'a2'), 'a1');
  assert.equal(above('a2', 'a3'), 'a1');
  assert.equal(above('c3', 'c2'), 'c1');
  assert.equal(above('c3', 'c1'), 'c2');
  assert.equal(above('c1', 'c2'), 'c3');
  assert.equal(above('u2', 'a3', 'c2'), 'c1', 'the topmost is c2, whatever level the others are on');
  assert.equal(above('c1', 'c2', 'c3'), 'a1');
});

test('several sessions with the first of a section topmost land on the first one below them that stays', () => {
  assert.equal(above('a1', 'a2'), 'a3');
  assert.equal(above('a2', 'a1', 'c2'), 'a3');
  assert.equal(above('a1', 'a2', 'a3'), null);
  assert.equal(above('u1', 'u2'), null);
});

test('a row the list no longer draws is passed over, as one archived a moment ago is, but a routine\'s next run counts while its runs are folded', () => {
  assert.equal(stayAbove(ABOVE, ABOVE_ORDER.filter(id => id !== 'a2'), ['a3']), 'a1');
  assert.equal(stayAbove(ABOVE, ABOVE_ORDER.filter(id => id !== 'c1'), ['c2']), 'c3');
  assert.equal(stayAbove(ABOVE, ABOVE_ORDER.filter(id => id !== 'r2' && id !== 'r1'), ['r3']), 'r2');
});

test('a session that is not drawn lands nowhere, and nor does an id the list does not have, or none at all', () => {
  assert.equal(stayAbove(ABOVE, [], ['a2']), null);
  assert.equal(stayAbove(ABOVE, ['a1'], ['a3']), null);
  assert.equal(above('nobody'), null);
  assert.equal(above(), null);
  assert.equal(stayAbove({ ...ABOVE, routines: [] }, ABOVE_ORDER, ['r3']), null);
});

test('landing somewhere leaves the list it was given as it was', () => {
  const before = JSON.stringify(ABOVE);
  for (const ids of [['a1'], ['r3'], ['c2', 'a3'], ['r1']]) above(...ids);
  assert.equal(JSON.stringify(ABOVE), before);
});

const LISTED = ['a', 'b', 'c'];
const target = facts => archiveTarget({ listed: id => LISTED.includes(id), ...facts });

test('with nothing open the key archives the row showing the focus ring, and that row beats the open session', () => {
  assert.deepEqual(target({ ringed: 'a' }), { id: 'a' });
  assert.deepEqual(target({ ringed: 'a', current: 'b' }), { id: 'a' });
});

test('with no ring the key archives the open session', () => {
  assert.deepEqual(target({ current: 'b' }), { id: 'b' });
  assert.deepEqual(target({ ringed: null, current: 'b' }), { id: 'b' });
});

test('a row or an open session that is not listed is no target, so the browser keeps the key', () => {
  assert.equal(target({ current: 'gone' }), null);
  assert.equal(target({ ringed: 'gone', current: 'b' }), null);
});

test('with no ring and no open session there is nothing to archive and the browser keeps the key', () => {
  assert.equal(target({}), null);
  assert.equal(target({ ringed: null, current: null }), null);
});

test('a row menu names its own row, ahead of the ring and the open session', () => {
  assert.deepEqual(target({ menu: { session: 'c' }, ringed: 'a', current: 'b' }), { id: 'c' });
});

test('a header or plus menu takes the key and archives nothing, and so does a row menu whose row has gone', () => {
  assert.deepEqual(target({ menu: {}, ringed: 'a', current: 'b' }), { id: null });
  assert.deepEqual(target({ menu: { session: null }, current: 'b' }), { id: null });
  assert.deepEqual(target({ menu: { session: 'gone' }, current: 'b' }), { id: null });
});

test('a form or confirm in the list keeps the key, whatever else could be archived', () => {
  assert.equal(target({ form: true, ringed: 'a', current: 'b' }), null);
  assert.equal(target({ form: true, current: 'b' }), null);
});

test('anything modal keeps the key, even with a menu open behind it', () => {
  assert.equal(target({ modal: true, ringed: 'a', current: 'b' }), null);
  assert.equal(target({ modal: true, menu: { session: 'c' }, form: true, ringed: 'a', current: 'b' }), null);
});

test('a ring on a header or a button in the list takes the key and archives nothing, so a press too many spares the open session', () => {
  assert.deepEqual(target({ ringedOther: true, current: 'b' }), { id: null });
  assert.deepEqual(target({ ringedOther: true }), { id: null });
});

test('a menu, a form and anything modal each come before a ring on a header or a button', () => {
  assert.deepEqual(target({ menu: { session: 'c' }, ringedOther: true, current: 'b' }), { id: 'c' });
  assert.equal(target({ form: true, ringedOther: true, current: 'b' }), null);
  assert.equal(target({ modal: true, ringedOther: true, current: 'b' }), null);
});

test('two or more picked rows are archived together, ahead of a ring on a row and the open session', () => {
  assert.deepEqual(target({ picked: ['a', 'c'], ringed: 'b', current: 'b' }), { ids: ['a', 'c'] });
  assert.deepEqual(target({ picked: ['a', 'b', 'c'] }), { ids: ['a', 'b', 'c'] });
});

test('one picked row is archived as an ordinary one, so its note and Undo are the same', () => {
  assert.deepEqual(target({ picked: ['c'], ringed: 'a', current: 'b' }), { id: 'c' });
});

test('a picked row that is not listed is dropped, and a selection with none left leaves the ring and the open session in charge', () => {
  assert.deepEqual(target({ picked: ['a', 'gone', 'c'] }), { ids: ['a', 'c'] });
  assert.deepEqual(target({ picked: ['gone', 'c'] }), { id: 'c' });
  assert.deepEqual(target({ picked: ['gone'], ringed: 'a', current: 'b' }), { id: 'a' });
  assert.deepEqual(target({ picked: [], current: 'b' }), { id: 'b' });
});

test('the menu of a picked row archives the whole selection, and the menu of any other row archives its own row', () => {
  assert.deepEqual(target({ menu: { session: 'a' }, picked: ['a', 'b'], current: 'c' }), { ids: ['a', 'b'] });
  assert.deepEqual(target({ menu: { session: 'a' }, picked: ['a'], current: 'c' }), { id: 'a' });
  assert.deepEqual(target({ menu: { session: 'c' }, picked: ['a', 'b'] }), { id: 'c' });
  assert.deepEqual(target({ menu: {}, picked: ['a', 'b'] }), { id: null });
});

test('a ring on a header or a button still takes the key and archives nothing, selection or not', () => {
  assert.deepEqual(target({ ringedOther: true, picked: ['a', 'b'], current: 'c' }), { id: null });
});

test('a form or anything modal keeps the key even with rows picked', () => {
  assert.equal(target({ form: true, picked: ['a', 'b'] }), null);
  assert.equal(target({ modal: true, picked: ['a', 'b'] }), null);
  assert.equal(target({ modal: true, menu: { session: 'a' }, picked: ['a', 'b'] }), null);
});
