// Run with `npm test`. Which sessions each view of the list holds, which view a session is in, how a view's lamp and count are
// worked out, and which views a search finds, for the rules that need no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countOf, EVERY_VIEW, groupLamp, groupsIn, HOME_VIEW, holder, lampOf, NO_VIEW, othersWaiting, viewIn, viewsNamed, viewsOf } from '../public/ui/scopes.js';

const row = (id, state = 'idle') => ({ id, title: id, state });
const group = (id, project, sessions) => ({ id, name: id, project, sessions });
const WEB = 'cp-web';
const APP = 'cp-app';

const list = (extra = {}) => ({
  projects: [{ id: WEB, name: 'Website' }, { id: APP, name: 'Mobile app' }],
  pinned: [],
  groups: [
    group('cg-checkout', WEB, [row('web-1'), row('web-2')]),
    group('cg-release', WEB, [row('web-3')]),
    group('cg-store', APP, [row('app-1')]),
    group('cg-notes', null, [row('home-1')]),
    group('cg-empty', null, []),
  ],
  routines: [{ name: 'Nightly', latest: row('run-3'), earlier: [row('run-2'), row('run-1')] }],
  started: [row('started-1')],
  ungrouped: [row('loose-1')],
  other: [row('terminal-1')],
  ...extra,
});

const withGroups = (...groups) => list({ groups });

test('the view in use is the one chosen while the list still has that project, and Home when nothing is chosen or the project is gone', () => {
  const ix = list();
  assert.equal(viewIn(ix, WEB), WEB);
  assert.equal(viewIn(ix, APP), APP);
  assert.equal(viewIn(ix, null), HOME_VIEW);
  assert.equal(viewIn(ix, 'cp-deleted'), HOME_VIEW);
  assert.equal(viewIn(list({ projects: [] }), WEB), HOME_VIEW);
});

test('Home shows the groups outside any project, a project shows its own, and a group whose project is gone shows in Home', () => {
  const ix = withGroups(group('cg-a', WEB, []), group('cg-b', null, []), group('cg-c', 'cp-deleted', []), group('cg-d', WEB, []), group('cg-e', APP, []));
  const ids = view => groupsIn(ix, view).map(g => g.id);
  assert.deepEqual(ids(HOME_VIEW), ['cg-b', 'cg-c']);
  assert.deepEqual(ids(WEB), ['cg-a', 'cg-d']);
  assert.deepEqual(ids(APP), ['cg-e']);
  assert.deepEqual(ids('cp-deleted'), []);
});

test('a session in a project group is held by that project, and one in a top-level group by Home', () => {
  const ix = list();
  assert.equal(holder(ix, 'web-1'), WEB);
  assert.equal(holder(ix, 'web-3'), WEB);
  assert.equal(holder(ix, 'app-1'), APP);
  assert.equal(holder(ix, 'home-1'), HOME_VIEW);
});

test('a session in a group whose project is gone is held by Home', () => {
  const ix = withGroups(group('cg-lost', 'cp-deleted', [row('lost-1')]));
  assert.equal(holder(ix, 'lost-1'), HOME_VIEW);
});

test('every run of a routine and every loose session is held by Home', () => {
  const ix = list();
  for (const id of ['run-3', 'run-2', 'run-1', 'started-1', 'loose-1', 'terminal-1']) assert.equal(holder(ix, id), HOME_VIEW, id);
});

test('a pinned session is held by every view, whatever its state, and a session the list does not have is held by none', () => {
  const ix = list({ pinned: [row('pin-1'), row('pin-2', 'waiting')] });
  assert.equal(holder(ix, 'pin-1'), EVERY_VIEW);
  assert.equal(holder(ix, 'pin-2'), EVERY_VIEW);
  assert.equal(holder(ix, 'archived-1'), NO_VIEW);
  assert.equal(holder(ix, ''), NO_VIEW);
  assert.notEqual(EVERY_VIEW, NO_VIEW);
  assert.notEqual(EVERY_VIEW, HOME_VIEW);
  assert.notEqual(NO_VIEW, HOME_VIEW);
});

test('a view is waiting if any of its chats needs you, else working if any is running, else it has no lamp', () => {
  const ix = withGroups(
    group('cg-a', WEB, [row('a-1', 'working'), row('a-2', 'waiting'), row('a-3')]),
    group('cg-b', APP, [row('b-1', 'working'), row('b-2', 'active')]),
    group('cg-c', null, [row('c-1', 'idle')]),
  );
  const quiet = { ...ix, routines: [], started: [], ungrouped: [], other: [] };
  assert.equal(lampOf(quiet, WEB), 'waiting');
  assert.equal(lampOf(quiet, APP), 'working');
  assert.equal(lampOf(quiet, HOME_VIEW), null);
});

test('a view that has no group or no session has no lamp', () => {
  assert.equal(lampOf(list(), WEB), null);
  assert.equal(lampOf(list(), HOME_VIEW), null);
  assert.equal(lampOf(list({ groups: [] }), APP), null);
  assert.equal(lampOf(list(), 'cp-deleted'), null);
});

test('pinned sessions give no view a lamp, because they show in all of them', () => {
  const ix = list({ pinned: [row('pin-1', 'waiting'), row('pin-2', 'working')] });
  for (const view of [HOME_VIEW, WEB, APP]) assert.equal(lampOf(ix, view), null, String(view));
  assert.equal(othersWaiting(ix, HOME_VIEW), false);
  assert.equal(othersWaiting(ix, WEB), false);
});

test('Home counts every run of a routine, the latest and the earlier ones, and the sessions that are loose', () => {
  const earlier = list({ routines: [{ name: 'Nightly', latest: row('run-3'), earlier: [row('run-2'), row('run-1', 'waiting')] }] });
  assert.equal(lampOf(earlier, HOME_VIEW), 'waiting');
  const latest = list({ routines: [{ name: 'Nightly', latest: row('run-3', 'working'), earlier: [row('run-2')] }] });
  assert.equal(lampOf(latest, HOME_VIEW), 'working');
  for (const key of ['started', 'ungrouped', 'other']) assert.equal(lampOf(list({ [key]: [row('x', 'waiting')] }), HOME_VIEW), 'waiting', key);
});

test('Home counts the sessions in a group whose project is gone, and a project does not count its neighbours', () => {
  const ix = withGroups(group('cg-lost', 'cp-deleted', [row('lost-1', 'working')]), group('cg-web', WEB, [row('web-1', 'waiting')]));
  const plain = { ...ix, routines: [], started: [], ungrouped: [], other: [] };
  assert.equal(lampOf(plain, HOME_VIEW), 'working');
  assert.equal(lampOf(plain, WEB), 'waiting');
  assert.equal(lampOf(plain, APP), null);
});

test('waiting beats working in the same view, wherever each comes from', () => {
  const ix = list({ routines: [{ name: 'Nightly', latest: row('run-3', 'working'), earlier: [] }], other: [row('terminal-1', 'waiting')] });
  assert.equal(lampOf(ix, HOME_VIEW), 'waiting');
});

test('a group has the lamp of its sessions, nested ones and its own chat, and waiting beats working', () => {
  assert.equal(groupLamp(group('g', WEB, [row('a'), row('b', 'working')])), 'working');
  assert.equal(groupLamp(group('g', WEB, [row('a', 'working'), row('b', 'waiting')])), 'waiting');
  assert.equal(groupLamp(group('g', WEB, [{ ...row('a'), children: [{ ...row('kid', 'waiting'), parent: 'a' }] }])), 'waiting');
  assert.equal(groupLamp({ ...group('g', WEB, [row('a')]), session: row('chat', 'working') }), 'working');
  assert.equal(groupLamp({ ...group('g', WEB, [row('a', 'working')]), session: row('chat', 'waiting') }), 'waiting');
  assert.equal(groupLamp(group('g', WEB, [row('a'), row('b', 'active')])), null);
  assert.equal(groupLamp(group('g', WEB, [])), null);
});

test('a project counts the sessions in its groups, and nothing else', () => {
  const ix = list({ pinned: [row('pin-1')] });
  assert.equal(countOf(ix, WEB), 3);
  assert.equal(countOf(ix, APP), 1);
  assert.equal(countOf(withGroups(group('cg-a', WEB, [])), WEB), 0);
  assert.equal(countOf(list({ groups: [] }), WEB), 0);
  assert.equal(countOf(ix, 'cp-deleted'), 0);
});

test('a project does not count the sessions of a group that has gone to Home', () => {
  const ix = withGroups(group('cg-a', WEB, [row('a-1')]), group('cg-b', 'cp-deleted', [row('b-1'), row('b-2')]));
  assert.equal(countOf(ix, WEB), 1);
});

test('from Home, another view is waiting when a project has a chat that needs you', () => {
  const ix = withGroups(group('cg-a', WEB, [row('a-1', 'waiting')]), group('cg-b', null, [row('b-1', 'waiting')]));
  const plain = { ...ix, routines: [], started: [], ungrouped: [], other: [] };
  assert.equal(othersWaiting(plain, HOME_VIEW), true);
  assert.equal(othersWaiting({ ...plain, groups: [group('cg-b', null, [row('b-1', 'waiting')])] }, HOME_VIEW), false, 'only Home is waiting');
});

test('from a project, another view is waiting when Home or another project has a chat that needs you, and its own does not count', () => {
  const homeWaits = list({ other: [row('terminal-1', 'waiting')] });
  assert.equal(othersWaiting(homeWaits, WEB), true);
  assert.equal(othersWaiting(homeWaits, HOME_VIEW), false);

  const appWaits = withGroups(group('cg-a', APP, [row('a-1', 'waiting')]));
  assert.equal(othersWaiting({ ...appWaits, routines: [], started: [], ungrouped: [], other: [] }, WEB), true);
  assert.equal(othersWaiting({ ...appWaits, routines: [], started: [], ungrouped: [], other: [] }, APP), false);
});

test('a chat that is only working, or a list with nothing in it, makes no other view waiting', () => {
  const working = list({ other: [row('terminal-1', 'working')], groups: [group('cg-a', WEB, [row('a-1', 'working')])] });
  for (const view of [HOME_VIEW, WEB, APP]) assert.equal(othersWaiting(working, view), false, String(view));
  const empty = list({ groups: [], routines: [], started: [], ungrouped: [], other: [], projects: [] });
  assert.equal(othersWaiting(empty, HOME_VIEW), false);
});

test('the views are Home first and then each project in the list\'s order, with its lamp and count, and Home has no count', () => {
  const ix = list({ groups: [group('cg-a', WEB, [row('a-1', 'waiting'), row('a-2')]), group('cg-b', APP, [row('b-1', 'working')]), group('cg-c', null, [row('c-1')])], routines: [], started: [], ungrouped: [], other: [] });
  assert.deepEqual(viewsOf(ix), [
    { id: HOME_VIEW, name: 'Home', lamp: null },
    { id: WEB, name: 'Website', lamp: 'waiting', count: 2 },
    { id: APP, name: 'Mobile app', lamp: 'working', count: 1 },
  ]);
  assert.equal('count' in viewsOf(ix)[0], false);
});

test('with no project the only view is Home, and Home takes the lamp of what is outside the projects', () => {
  const ix = list({ projects: [], groups: [], other: [row('terminal-1', 'waiting')] });
  assert.deepEqual(viewsOf(ix), [{ id: HOME_VIEW, name: 'Home', lamp: 'waiting' }]);
});

test('a project order change in the list changes the order of the views, and a deleted project is not a view', () => {
  const ix = list({ projects: [{ id: APP, name: 'Mobile app' }, { id: WEB, name: 'Website' }] });
  assert.deepEqual(viewsOf(ix).map(v => v.id), [HOME_VIEW, APP, WEB]);
  assert.deepEqual(viewsOf(list({ projects: [{ id: APP, name: 'Mobile app' }] })).map(v => v.id), [HOME_VIEW, APP]);
});

test('a search with no words finds every view', () => {
  assert.deepEqual(viewsNamed(list(), []).map(v => v.id), [HOME_VIEW, WEB, APP]);
});

test('a search finds the views whose name has every word, in any case and anywhere in the name', () => {
  const ix = list();
  assert.deepEqual(viewsNamed(ix, ['web']).map(v => v.id), [WEB]);
  assert.deepEqual(viewsNamed(ix, ['bile', 'app']).map(v => v.id), [APP]);
  assert.deepEqual(viewsNamed(ix, ['app', 'mobile']).map(v => v.id), [APP]);
  assert.deepEqual(viewsNamed(ix, ['site']).map(v => v.id), [WEB]);
  assert.deepEqual(viewsNamed(ix, ['web', 'app']), []);
  assert.deepEqual(viewsNamed(ix, ['nothing']), []);
});

test('a search matches the name of a view and nothing else, so Home is found by its name and no project by the word Project', () => {
  const ix = list();
  assert.deepEqual(viewsNamed(ix, ['ho']).map(v => v.id), [HOME_VIEW]);
  assert.deepEqual(viewsNamed(ix, ['home']).map(v => v.id), [HOME_VIEW]);
  assert.deepEqual(viewsNamed(ix, ['project']), []);
});

test('a search keeps each found view\'s lamp and count', () => {
  const ix = list({ groups: [group('cg-a', WEB, [row('a-1', 'waiting'), row('a-2')])] });
  assert.deepEqual(viewsNamed(ix, ['website']), [{ id: WEB, name: 'Website', lamp: 'waiting', count: 2 }]);
});

// A session with the sessions nested under it, as the server's list has them.
const holding = (id, kids, state = 'idle') => ({ ...row(id, state), children: kids.map(k => ({ ...k, parent: id })) });

test('a nested session is held by the view its parent is in', () => {
  const ix = list({
    pinned: [holding('pin-1', [row('pin-kid')])],
    groups: [group('cg-checkout', WEB, [holding('web-1', [row('web-kid')])]), group('cg-notes', null, [holding('home-1', [row('home-kid')])])],
    ungrouped: [holding('loose-1', [row('loose-kid')])],
  });
  assert.deepEqual(['web-kid', 'home-kid', 'loose-kid'].map(id => holder(ix, id)), [WEB, HOME_VIEW, HOME_VIEW]);
  assert.equal(holder(ix, 'pin-kid'), EVERY_VIEW);
  assert.equal(holder(ix, 'web-1'), WEB);
});

test('a nested session lights its view\'s lamp, and a pinned one lights none', () => {
  const ix = list({
    groups: [group('cg-a', WEB, [holding('a-1', [row('a-kid', 'waiting')])]), group('cg-b', APP, [holding('b-1', [row('b-kid', 'working')])])],
    routines: [], started: [], ungrouped: [holding('u-1', [row('u-kid', 'waiting')])], other: [],
  });
  assert.deepEqual([WEB, APP, HOME_VIEW].map(view => lampOf(ix, view)), ['waiting', 'working', 'waiting']);
  const pinned = list({ pinned: [holding('pin-1', [row('pin-kid', 'waiting')])] });
  for (const view of [HOME_VIEW, WEB, APP]) assert.equal(lampOf(pinned, view), null, String(view));
});

test('a project counts the sessions nested in its groups, and the views carry that count', () => {
  const ix = list({ groups: [group('cg-a', WEB, [holding('a-1', [row('a-2'), row('a-3')]), row('a-4')]), group('cg-b', APP, [row('b-1')])] });
  assert.equal(countOf(ix, WEB), 4);
  assert.equal(countOf(ix, APP), 1);
  assert.deepEqual(viewsOf(ix).map(v => v.count), [undefined, 4, 1]);
});

test('another view is waiting when a session nested in it needs you', () => {
  const ix = list({ groups: [group('cg-a', APP, [holding('a-1', [row('a-kid', 'waiting')])])], routines: [], started: [], ungrouped: [], other: [] });
  assert.equal(othersWaiting(ix, WEB), true);
  assert.equal(othersWaiting(ix, APP), false);
});

test('a group\'s own session is in no list, but it lights its view\'s lamp while it works or waits, and moves with the group', () => {
  const grouped = (state, project = WEB) => ({ ...withGroups({ ...group('cg-a', project, [row('a-1')]), session: { id: 'chat-a', state } }), routines: [], started: [], ungrouped: [], other: [] });
  assert.equal(lampOf(grouped('waiting'), WEB), 'waiting');
  assert.equal(lampOf(grouped('working'), WEB), 'working');
  assert.equal(lampOf(grouped('idle'), WEB), null);
  assert.equal(lampOf(grouped('waiting'), APP), null, 'a project does not light for its neighbour\'s group');
  assert.equal(lampOf(grouped('waiting', null), HOME_VIEW), 'waiting');
  const both = { ...grouped('working'), groups: [{ ...group('cg-a', WEB, [row('a-1', 'waiting')]), session: { id: 'chat-a', state: 'working' } }] };
  assert.equal(lampOf(both, WEB), 'waiting', 'waiting beats the group\'s own working');
  assert.equal(othersWaiting(grouped('waiting'), HOME_VIEW), true);
  assert.equal(othersWaiting(grouped('waiting'), WEB), false);
});

test('the view that holds a group\'s own session is the view of its group, and a group with none holds nothing', () => {
  const ix = withGroups({ ...group('cg-a', WEB, [row('a-1')]), session: { id: 'chat-a', state: 'idle' } }, { ...group('cg-b', null, []), session: { id: 'chat-b', state: 'idle' } }, { ...group('cg-c', APP, []), session: null });
  assert.equal(holder(ix, 'chat-a'), WEB);
  assert.equal(holder(ix, 'chat-b'), HOME_VIEW);
  assert.equal(holder(ix, 'a-1'), WEB);
  assert.equal(holder(ix, 'chat-c'), NO_VIEW);
  assert.equal(holder(ix, undefined), NO_VIEW);
});

const withSections = (states, extra) => ({
  ...list({ routines: [], started: [], ungrouped: [], other: [], groups: [], ...extra }),
  sections: ['routines', 'pinned', 'started', 'ungrouped', 'other'].map(id => ({ id, session: states[id] ? { id: `chat-${id}`, state: states[id] } : null, archived: 0 })),
});

test('a built-in section\'s own session is in no list, but it lights Home\'s lamp while it works or waits, and no project\'s', () => {
  for (const id of ['routines', 'started', 'ungrouped', 'other']) {
    assert.equal(lampOf(withSections({ [id]: 'waiting' }), HOME_VIEW), 'waiting', id);
    assert.equal(lampOf(withSections({ [id]: 'working' }), HOME_VIEW), 'working', id);
    assert.equal(lampOf(withSections({ [id]: 'idle' }), HOME_VIEW), null, id);
    assert.equal(lampOf(withSections({ [id]: 'waiting' }), WEB), null, `${id} lights no project`);
    assert.equal(othersWaiting(withSections({ [id]: 'waiting' }), WEB), true, `${id} makes Home another view that is waiting`);
    assert.equal(othersWaiting(withSections({ [id]: 'waiting' }), HOME_VIEW), false);
  }
  assert.equal(lampOf(withSections({ other: 'working', started: 'waiting' }), HOME_VIEW), 'waiting', 'waiting beats working');
  assert.deepEqual(viewsOf(withSections({ other: 'waiting' })).map(v => [v.name, v.lamp]), [['Home', 'waiting'], ['Website', null], ['Mobile app', null]]);
});

test('the Pinned chat lights no view, as the pinned sessions do, since they show in all of them', () => {
  for (const view of [HOME_VIEW, WEB, APP]) assert.equal(lampOf(withSections({ pinned: 'waiting' }), view), null, String(view));
});

test('a list with no sections, as an older server\'s, lights the lamp as it did', () => {
  assert.equal(lampOf(list({ routines: [], started: [], ungrouped: [], other: [], groups: [] }), HOME_VIEW), null);
  assert.equal(lampOf({ ...withSections({ other: 'waiting' }), sections: undefined }, HOME_VIEW), null);
});

test('the view that holds a built-in section\'s own session is every view for Pinned and Home for the rest, and a section with none holds nothing', () => {
  const ix = withSections({ routines: 'idle', pinned: 'idle', started: 'idle', other: 'idle' });
  assert.equal(holder(ix, 'chat-pinned'), EVERY_VIEW);
  for (const id of ['routines', 'started', 'other']) assert.equal(holder(ix, `chat-${id}`), HOME_VIEW, id);
  assert.equal(holder(ix, 'chat-ungrouped'), NO_VIEW, 'a section with no chat holds nothing');
  assert.equal(holder({ ...ix, sections: undefined }, 'chat-pinned'), NO_VIEW);
});

