// Run with `npm test`. How a group's sessions fall into the parts of its panel and of the list tool, and the summary line over them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUCKETS, bucketOf, bucketsOf, deleteDetail, flipped, groupById, groupOfSession, litState, membersOf, paneOf, RECENT_MS, summaryOf, supportsGroupEdits, supportsGroups } from '../public/ui/group-rules.js';
import { supportsSections } from '../public/ui/sections.js';

const NOW = Date.parse('2026-10-23T06:00:00.000Z');
const row = (id, state, ago, extra) => ({ id, state, lastActivityAt: NOW - ago, ...extra });
const ids = list => list.map(r => r.id);

test('a session that needs you, one that is working, a recent one and an idle one each fall in their own part, and an archived one in the last', () => {
  assert.deepEqual(BUCKETS.map(b => b.key), ['needs', 'working', 'recent', 'idle', 'archived']);
  assert.deepEqual(
    [row('w', 'waiting', 5), row('k', 'working', 5), row('r', 'idle', 60_000), row('a', 'active', RECENT_MS * 3), row('i', 'idle', RECENT_MS + 1), row('x', 'idle', 0, { archived: true }), row('xw', 'waiting', 0, { archived: true })].map(r => bucketOf(r, NOW)),
    ['needs', 'working', 'recent', 'recent', 'idle', 'archived', 'archived'],
  );
});

test('a session whose mark is awaiting needs you whatever its state, as a Desktop session does when its turn ended in a question, unless it is archived', () => {
  assert.equal(bucketOf(row('q', 'idle', 5, { dot: 'awaiting' }), NOW), 'needs');
  assert.equal(bucketOf(row('q', 'active', RECENT_MS * 3, { dot: 'awaiting' }), NOW), 'needs');
  assert.equal(bucketOf(row('x', 'idle', 5, { dot: 'awaiting', archived: true }), NOW), 'archived');
  for (const dot of ['ready', 'running', 'error', null, undefined]) assert.equal(bucketOf(row('d', 'idle', 5, { dot }), NOW), 'recent', `a ${dot} mark does not need you`);
  assert.deepEqual(ids(bucketsOf([row('q', 'idle', 5, { dot: 'awaiting' }), row('w', 'waiting', 4), row('i', 'idle', 3)], NOW).needs), ['w', 'q']);
});

test('each part goes newest first, a tie goes by id, and the parts come back in the panel\'s order', () => {
  const out = bucketsOf([row('b', 'idle', 10), row('c', 'idle', 5), row('a', 'idle', 10), row('z', 'waiting', 1), row('y', 'working', 1)], NOW);
  assert.deepEqual(Object.keys(out), ['needs', 'working', 'recent', 'idle', 'archived']);
  assert.deepEqual(ids(out.recent), ['c', 'a', 'b']);
  assert.deepEqual([ids(out.needs), ids(out.working), ids(out.idle), ids(out.archived)], [['z'], ['y'], [], []]);
});

test('the sessions nested under a member count as members, one after the one they are under', () => {
  const group = { sessions: [row('p', 'idle', 1, { children: [row('c1', 'working', 2), row('c2', 'idle', 3)] }), row('q', 'idle', 4)] };
  assert.deepEqual(ids(membersOf(group)), ['p', 'c1', 'c2', 'q']);
  assert.deepEqual(ids(bucketsOf(membersOf(group), NOW).working), ['c1']);
});

test('the summary counts what needs you, what is working, what is recent and the rest as more, and leaves out a part with nothing in it', () => {
  const rows = [row('a', 'waiting', 1), row('b', 'waiting', 1), row('c', 'working', 1), row('d', 'working', 1), row('e', 'working', 1), row('f', 'idle', 1000), ...Array.from({ length: 11 }, (_, n) => row(`r${n}`, 'idle', 1000 + n)), row('o', 'idle', RECENT_MS * 2), row('p', 'idle', RECENT_MS * 2)];
  const out = bucketsOf(rows, NOW);
  assert.equal(summaryOf(out), '2 need you · 3 working · 12 recent · 2 more');
  assert.equal(summaryOf(out, 140), '2 need you · 3 working · 12 recent · 142 more', 'the archived ones the index counts but does not list are in the more');
  assert.equal(summaryOf(bucketsOf([row('a', 'waiting', 1)], NOW)), '1 needs you');
  assert.equal(summaryOf(bucketsOf([row('a', 'idle', RECENT_MS * 2)], NOW)), '1 more');
  assert.equal(summaryOf(bucketsOf([], NOW)), 'No sessions yet');
  assert.equal(summaryOf(bucketsOf([], NOW), 3), '3 more');
});

const WORK = { id: 'cg-work', name: 'Work', session: { id: 's-work', state: 'idle' }, sessions: [] };
const HOME = { id: 'cg-home', name: 'Home', session: null, sessions: [] };
const ix = (features, ...groups) => ({ features, groups });

test('a server says it can run group sessions on the list, and one that does not say so cannot', () => {
  assert.equal(supportsGroups(ix({ groupSessions: true })), true);
  for (const features of [undefined, {}, { groupSessions: false }]) assert.equal(supportsGroups(ix(features)), false);
  assert.equal(supportsGroups(null), false);
});

test('a server says it can delete and order groups on the list, and one that does not say so cannot, whatever else it says', () => {
  assert.equal(supportsGroupEdits(ix({ groupEdits: true })), true);
  assert.equal(supportsGroupEdits(ix({ groupSessions: true, groupEdits: true })), true);
  for (const features of [undefined, {}, { groupSessions: true }, { groupEdits: false }]) assert.equal(supportsGroupEdits(ix(features)), false);
  assert.equal(supportsGroupEdits(null), false);
});

test('the question before a group is deleted counts the sessions its header counts, nested ones included, and says what becomes of its chat', () => {
  const kid = row('k', 'idle', 1);
  const members = (...rows) => ({ sessions: rows });
  assert.equal(deleteDetail({ ...members(), session: null }), 'It has no sessions.');
  assert.equal(deleteDetail({ ...members(row('a', 'idle', 1)), session: null }), '1 session becomes ungrouped. No session is deleted.');
  assert.equal(deleteDetail({ ...members(row('a', 'idle', 1, { children: [kid, kid] }), row('b', 'idle', 2)), session: null }), '4 sessions become ungrouped. No session is deleted.');
  assert.equal(deleteDetail({ ...members(row('a', 'idle', 1)), session: { id: 's', state: 'idle' } }), '1 session becomes ungrouped. Its chat is hidden, and its transcript is kept. No session is deleted.');
  assert.equal(deleteDetail({ ...members(), session: { id: 's', state: 'active' } }), 'It has no sessions. Its chat is hidden, and its transcript is kept. No session is deleted.');
});

test('the question says a chat that works or waits stops, and says nothing of it for a chat that does not', () => {
  const group = state => ({ sessions: [row('a', 'idle', 1), row('b', 'idle', 2)], session: { id: 's', state } });
  assert.equal(deleteDetail(group('working')), '2 sessions become ungrouped. Its chat is working, so it stops, and is hidden with its transcript kept. No session is deleted.');
  assert.equal(deleteDetail(group('waiting')), '2 sessions become ungrouped. Its chat is waiting for you, so it stops, and is hidden with its transcript kept. No session is deleted.');
  for (const state of ['idle', 'active']) assert.doesNotMatch(deleteDetail(group(state)), /stops/);
});

test('a group is found by its id, and the group whose own session an id is by that session', () => {
  const list = ix({ groupSessions: true }, WORK, HOME);
  assert.equal(groupById(list, 'cg-home'), HOME);
  assert.equal(groupById(list, 'cg-gone'), null);
  assert.equal(groupById(null, 'cg-home'), null);
  assert.equal(groupOfSession(list, 's-work'), WORK);
  assert.equal(groupOfSession(list, 'a-member'), null);
  assert.equal(groupOfSession(list, undefined), null, 'a group with no session of its own is not held by no id');
});

test('the pane of a group is its chat when the list has the group, and else says why not', () => {
  assert.equal(paneOf(null, 'cg-work'), 'unloaded');
  assert.equal(paneOf(ix(undefined, WORK), 'cg-work'), 'unsupported', 'an older server is asked nothing, whatever it lists');
  assert.equal(paneOf(ix({ groupSessions: true }, WORK), 'cg-work'), 'ready');
  assert.equal(paneOf(ix({ groupSessions: true }, WORK), 'cg-gone'), 'missing');
});

test('the group button is lit while the group\'s session works or waits, and otherwise is not', () => {
  assert.equal(litState({ id: 'x', state: 'working' }), 'working');
  assert.equal(litState({ id: 'x', state: 'waiting' }), 'waiting');
  for (const state of ['idle', 'active', 'starting', undefined]) assert.equal(litState({ id: 'x', state }), null, String(state));
  assert.equal(litState(null), null);
  assert.equal(litState(undefined), null);
});

test('a fold flips on and off by group, and leaves the others as they were', () => {
  const opened = flipped({ 'cg-a': true }, 'cg-b');
  assert.deepEqual(opened, { 'cg-a': true, 'cg-b': true });
  assert.deepEqual(flipped(opened, 'cg-a'), { 'cg-b': true });
  assert.deepEqual(flipped({}, 'cg-a'), { 'cg-a': true });
  assert.deepEqual(flipped({ 'cg-a': true }, 'cg-a'), {}, 'a fold that is off is not kept');
  assert.deepEqual(opened, { 'cg-a': true, 'cg-b': true }, 'the stored object is not changed');
});

const SECTION_LIST = (features = { groupSessions: true, sectionSessions: true }) => ({
  features,
  groups: [WORK],
  pinned: [row('p-1', 'idle', 1, { children: [row('p-kid', 'working', 1)] })],
  routines: [{ name: 'nightly', latest: row('run-3', 'idle', 1), earlier: [row('run-2', 'idle', 2), row('run-1', 'idle', 3)] }, { name: 'weekly', latest: row('wk-1', 'idle', 1), earlier: [] }],
  started: [row('st-1', 'idle', 1)],
  ungrouped: [row('un-1', 'idle', 1)],
  other: [],
  sections: [
    { id: 'routines', session: null, archived: 2 },
    { id: 'pinned', session: { id: 'chat-pinned', state: 'working' }, archived: 0 },
    { id: 'started', session: { id: 'chat-started', state: 'idle' }, archived: 1 },
    { id: 'ungrouped', session: null, archived: 0 },
    { id: 'other', session: { id: 'chat-other', state: 'waiting' }, archived: 0 },
  ],
});

test('a section is a group-shaped object made from the sidebar\'s own lists, the same one for as long as the list is, and no group of the list', () => {
  const list = SECTION_LIST();
  const pinned = groupById(list, 'pinned');
  assert.deepEqual({ ...pinned, sessions: ids(pinned.sessions) }, { id: 'pinned', name: 'Pinned', session: { id: 'chat-pinned', state: 'working' }, archived: 0, sessions: ['p-1'], section: true });
  assert.equal(groupById(list, 'pinned'), pinned, 'the same object between renders');
  assert.deepEqual(ids(groupById(list, 'routines').sessions), ['run-3', 'run-2', 'run-1', 'wk-1'], 'a routine\'s runs flattened, the latest first');
  assert.deepEqual(groupById(list, 'ungrouped').session, null);
  assert.equal(groupById(list, 'other').name, 'Terminal and other');
  assert.notEqual(groupById(SECTION_LIST(), 'pinned'), pinned, 'a new list makes new objects');
  assert.equal(groupById(list, 'cg-work'), WORK, 'a group is found as before');
  assert.deepEqual(ids(membersOf(pinned)), ['p-1', 'p-kid'], 'the nested sessions are members');
  assert.equal(list.groups.some(g => g.section), false);
});

test('an index with no sections, or no such section, finds none, whatever else it has', () => {
  const older = { ...SECTION_LIST(), sections: undefined };
  for (const id of ['routines', 'pinned', 'started', 'ungrouped', 'other']) assert.equal(groupById(older, id), null, id);
  assert.equal(groupById({ ...SECTION_LIST(), sections: [] }, 'pinned'), null);
  assert.equal(groupById(null, 'pinned'), null);
  assert.equal(groupById(SECTION_LIST(), 'constructor'), null);
});

test('the section whose own session an id is is found by that session, beside the groups, and a section with none holds nothing', () => {
  const list = SECTION_LIST();
  assert.equal(groupOfSession(list, 'chat-pinned'), groupById(list, 'pinned'));
  assert.equal(groupOfSession(list, 'chat-other').id, 'other');
  assert.equal(groupOfSession(list, 's-work'), WORK);
  assert.equal(groupOfSession(list, 'p-1'), null, 'a member is no chat');
  assert.equal(groupOfSession({ ...list, sections: undefined }, 'chat-pinned'), null);
  assert.equal(groupOfSession(list, undefined), null);
});

test('the pane of a section needs a server that knows sections as well, and is missing when the list has none', () => {
  assert.equal(paneOf(null, 'pinned'), 'unloaded');
  assert.equal(paneOf(SECTION_LIST(), 'pinned'), 'ready');
  assert.equal(paneOf(SECTION_LIST({ groupSessions: true }), 'pinned'), 'unsupported', 'a server of groups only is asked nothing for a section');
  assert.equal(paneOf(SECTION_LIST({ sectionSessions: true }), 'pinned'), 'unsupported');
  assert.equal(paneOf(SECTION_LIST({}), 'pinned'), 'unsupported');
  assert.equal(paneOf({ ...SECTION_LIST(), sections: [] }, 'pinned'), 'missing');
  assert.equal(paneOf(SECTION_LIST({ groupSessions: true }), 'cg-work'), 'ready', 'a group is as it was');
  assert.equal(supportsSections(SECTION_LIST()), true);
  for (const features of [undefined, {}, { sectionSessions: false }, { groupSessions: true }]) assert.equal(supportsSections({ features }), false);
  assert.equal(supportsSections(null), false);
});

test('a section\'s button lights as a group\'s does, from its chat\'s state', () => {
  const list = SECTION_LIST();
  assert.deepEqual(['pinned', 'started', 'ungrouped', 'other'].map(id => litState(groupById(list, id).session)), ['working', null, null, 'waiting']);
});

