// Run with `npm test`. The rules for dragging and acting on a selection that need no page: which picked sessions a drop carries, where the
// picked sessions can go, what a nest refuses, the list as it is guessed to be after a drop, and the notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carriedOf, guessMany, leavers, manyNestTargets, manyTargets, manyUndoNote, movedNote, NEST_SELF, nestedNote, NO_GROUP, pinnedNote, placeTo, refuseNest, topmost, unnestedNote } from '../public/ui/many-rules.js';
import { everyRow } from '../public/ui/tree.js';

const row = (id, extra = {}) => ({ id, title: id, source: 'capcom', group: null, pinned: false, parent: null, via: null, routine: null, ...extra });
const SORT = { by: 'recency', ascending: false };
// Boss (Work) holds Mid and Kid, and Leaf is nested under Mid. Peer is in Work, Fixed is pinned, and three sit loose.
const boss = row('boss', { group: 'cg-work', children: [row('mid', { group: 'cg-work', parent: 'boss', via: 'boss' }), row('kid', { group: 'cg-work', parent: 'boss', via: 'boss' }), row('leaf', { group: 'cg-work', parent: 'boss', via: 'mid' })] });
const IX = {
  projects: [{ id: 'cp-a', name: 'Capcom' }],
  sorts: { pinned: SORT, routines: SORT, sessions: SORT },
  pinned: [row('fixed', { pinned: true }), row('fixed2', { pinned: true })],
  groups: [
    { id: 'cg-work', name: 'Work', project: null, sort: SORT, sessions: [boss, row('peer', { group: 'cg-work' })] },
    { id: 'cg-spare', name: 'Spare', project: null, sort: SORT, sessions: [] },
    { id: 'cg-in', name: 'Inside', project: 'cp-a', sort: SORT, sessions: [] },
  ],
  routines: [{ name: 'nightly', latest: row('run', { routine: 'nightly' }), earlier: [] }],
  started: [row('mine'), row('mine2')],
  ungrouped: [row('desk', { source: 'desktop' })],
  other: [row('term', { source: 'cli' })],
};
const rows = (...ids) => ids.map(id => everyRow(IX).find(r => r.id === id));
const ids = list => list.map(r => r.id);

test('carriedOf leaves out a picked session whose nearest shown parent is picked, and keeps the picked ones in screen order', () => {
  assert.deepEqual(ids(carriedOf(IX, ['boss', 'kid', 'mine'])), ['boss', 'mine']);
  assert.deepEqual(ids(carriedOf(IX, ['kid', 'mine'])), ['kid', 'mine']);
  assert.deepEqual(ids(carriedOf(IX, ['boss', 'leaf'])), ['boss', 'leaf'], 'mid is between them and is not picked, so leaf is changed on its own');
  assert.deepEqual(carriedOf(IX, ['nobody']), []);
});

test('topmost leaves out a picked session under another picked one at any depth, as archiving takes the family along', () => {
  assert.deepEqual(ids(topmost(IX, ['boss', 'leaf', 'kid', 'mine'])), ['boss', 'mine']);
  assert.deepEqual(ids(topmost(IX, ['leaf', 'kid'])), ['leaf', 'kid']);
});

test('a nest is refused when the row it lands under is picked or nested under a picked row, and only then', () => {
  assert.equal(refuseNest(IX, ['boss', 'mine'], 'boss'), NEST_SELF);
  assert.equal(refuseNest(IX, ['boss', 'mine'], 'leaf'), NEST_SELF, 'leaf is in boss\'s family');
  assert.equal(refuseNest(IX, ['mine'], 'mine'), NEST_SELF);
  assert.equal(refuseNest(IX, ['mine', 'mine2'], 'peer'), '');
  assert.equal(refuseNest(IX, ['mid', 'leaf'], 'kid'), '', 'boss is not picked');
  assert.equal(refuseNest(IX, ['mine'], 'nobody'), '');
});

test('the places for a selection leave one out only when every picked session is there already', () => {
  const labels = list => list.map(t => t.label ?? `${t.group}: ${t.items.map(i => i.label).join(', ')}`);
  assert.deepEqual(labels(manyTargets(IX, rows('peer', 'mine'))), ['Pinned', 'Capcom: Inside', 'Work', 'Spare', 'Started here']);
  assert.deepEqual(labels(manyTargets(IX, rows('peer', 'boss'))), ['Pinned', 'Capcom: Inside', 'Spare', 'Started here'], 'both are in Work, so it is left out');
  assert.deepEqual(labels(manyTargets(IX, rows('fixed', 'fixed2'))), ['Capcom: Inside', 'Work', 'Spare', 'Started here'], 'both are pinned, so Pinned is left out');
  assert.deepEqual(labels(manyTargets(IX, rows('mine', 'mine2'))), ['Pinned', 'Capcom: Inside', 'Work', 'Spare'], 'both are loose, so there is no loose entry');
});

test('the loose entry names the loose list the picked sessions share, and is No group when they have different ones', () => {
  const loose = list => list.at(-1);
  assert.deepEqual(loose(manyTargets(IX, rows('peer', 'boss'))), { label: 'Started here', section: 'started' });
  assert.deepEqual(loose(manyTargets(IX, rows('peer', 'fixed', 'boss'))), { label: 'Started here', section: 'started' });
  assert.deepEqual(loose(manyTargets(IX, rows('kid'))), { label: 'Started here', section: 'started' }, 'a nested session can be taken out to the loose list');
  const desk = [row('a', { group: 'cg-work', source: 'desktop' }), row('b', { group: 'cg-work', source: 'cli' })];
  assert.deepEqual(loose(manyTargets(IX, desk)), { label: NO_GROUP, section: 'ungrouped' });
});

test('a nested session is not in its family\'s group for Move to, since moving it takes it out of its parent', () => {
  const sections = list => list.flatMap(t => t.items ?? [t]).map(t => t.section);
  assert.equal(sections(manyTargets(IX, rows('peer'))).includes('cg-work'), false);
  assert.equal(sections(manyTargets(IX, rows('kid'))).includes('cg-work'), true);
  assert.equal(sections(manyTargets(IX, rows('peer', 'kid'))).includes('cg-work'), true);
});

test('Routines is offered only when every picked session is a routine run and one is placed', () => {
  const placed = { ...IX, routines: [{ name: 'nightly', latest: row('run', { routine: 'nightly', group: 'cg-work' }), earlier: [] }] };
  assert.equal(manyTargets(placed, [placed.routines[0].latest]).some(t => t.section === 'routines'), true);
  assert.equal(manyTargets(placed, [placed.routines[0].latest, row('mine')]).some(t => t.section === 'routines'), false);
  assert.equal(manyTargets(IX, [IX.routines[0].latest]).some(t => t.section === 'routines'), false, 'it is not placed');
});

test('the sessions a selection can nest under are the top level ones that are not picked, with no routine run', () => {
  assert.deepEqual(ids(manyNestTargets(IX, ['boss', 'mine'])), ['fixed', 'fixed2', 'peer', 'mine2', 'desk', 'term']);
  assert.deepEqual(ids(manyNestTargets(IX, [])).includes('run'), false);
});

test('a Move to place is a group, Pinned, or each session\'s loose list for the server', () => {
  assert.deepEqual(placeTo(IX, 'pinned'), { pinned: true });
  assert.deepEqual(placeTo(IX, 'cg-spare'), { group: 'cg-spare' });
  for (const section of ['started', 'ungrouped', 'other', 'routines']) assert.deepEqual(placeTo(IX, section), { group: null }, section);
});

test('guessing a move puts every carried session in the place, and a rider goes with its parent', () => {
  const groupOf = (ix, id) => ix.groups.find(g => g.sessions.some(r => r.id === id))?.id;
  const moved = guessMany(IX, ['boss', 'kid', 'mine', 'fixed'], { group: 'cg-spare' });
  assert.deepEqual(moved.groups.find(g => g.id === 'cg-spare').sessions.map(r => r.id).sort(), ['boss', 'fixed', 'mine']);
  assert.deepEqual(moved.groups.find(g => g.id === 'cg-spare').sessions.find(r => r.id === 'boss').children.map(r => r.id).sort(), ['kid', 'leaf', 'mid']);
  assert.equal(groupOf(moved, 'peer'), 'cg-work');
  const pinned = guessMany(IX, ['mine', 'peer'], { pinned: true });
  assert.deepEqual(ids(pinned.pinned).sort(), ['fixed', 'fixed2', 'mine', 'peer']);
  const loose = guessMany(IX, ['peer', 'fixed', 'term'], { group: null });
  assert.deepEqual([ids(loose.started).includes('peer'), ids(loose.started).includes('fixed'), ids(loose.other)], [true, true, ['term']]);
});

test('guessing a nest puts the carried sessions under the target\'s top level session, and a refused one changes nothing', () => {
  const nested = guessMany(IX, ['mine', 'mine2'], { parent: 'kid' });
  assert.deepEqual(ids(nested.groups[0].sessions.find(r => r.id === 'boss').children).sort(), ['kid', 'leaf', 'mid', 'mine', 'mine2']);
  assert.equal(guessMany(IX, ['boss', 'mine'], { parent: 'kid' }), IX);
});

test('guessing a take-out brings nested sessions to their family\'s place, and leaves the others alone', () => {
  const out = guessMany(IX, ['kid', 'mine'], { parent: null });
  assert.deepEqual(ids(out.groups[0].sessions).sort(), ['boss', 'kid', 'peer']);
  assert.deepEqual(ids(out.started), ['mine', 'mine2']);
});

test('Move out names the parent when the nested sessions share one, and covers only the nested ones', () => {
  assert.deepEqual([ids(leavers(IX, rows('kid', 'mid', 'mine')).rows), leavers(IX, rows('kid', 'mid', 'mine')).parent.id], [['kid', 'mid'], 'boss']);
  assert.equal(leavers(IX, rows('kid', 'mine')).parent.id, 'boss');
  assert.deepEqual(leavers(IX, rows('mine', 'peer')), { rows: [], parent: null });
  const two = { ...IX, started: [row('c', { parent: 'mine', via: 'mine' })] };
  assert.equal(leavers(two, [two.started[0], ...rows('kid')]).parent, null, 'two different parents');
});

test('the notes say how many sessions went where, in the voice of the archive notes', () => {
  assert.equal(movedNote(3, 'Review'), 'Moved 3 sessions to Review.');
  assert.equal(movedNote(1, 'Review in Capcom'), 'Moved 1 session to Review in Capcom.');
  assert.equal(pinnedNote(2), 'Pinned 2 sessions.');
  assert.equal(nestedNote(3, 'Login'), 'Nested 3 sessions under “Login”.');
  assert.equal(unnestedNote(2), 'Moved 2 sessions out of their parents.');
  assert.equal(unnestedNote(1), 'Moved 1 session out of its parent.');
  assert.equal(manyUndoNote(3), 'Put 3 sessions back.');
});
