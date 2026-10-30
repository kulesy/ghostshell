// Run with `npm test`. The rules every search shares, for the parts that need no page: the order a search lists what it finds in,
// how the words typed match, what Ctrl+K shows for each chip, and what the Move to and Nest under menus find.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UNTITLED } from '../public/ui/order.js';
import { emptyText, findPlaces, findSessions, hasWords, RANKS, ranked, rankOfRow, sectionsFor, wordsOf } from '../public/ui/search-rules.js';
import { sessionTargets } from '../public/ui/tree.js';

const WEB = 'cp-web';
const APP = 'cp-app';
const NEW = 'Ctrl+N';

const row = (id, extra = {}) => ({ id, title: id, cwd: `/Users/me/${id}`, branch: '', state: 'idle', lastActivityAt: 0, parent: null, ...extra });
const group = (id, name, project, sessions, extra = {}) => ({ id, name, project, sessions, ...extra });

// Home's groups come first in the sidebar whatever their place in the list, then each project's in the order of the projects.
const list = (extra = {}) => ({
  projects: [{ id: WEB, name: 'Website' }, { id: APP, name: 'Mobile app' }],
  pinned: [],
  groups: [
    group('cg-checkout', 'Checkout', WEB, [row('web-1', { lastActivityAt: 40, children: [row('web-1-kid', { lastActivityAt: 90, parent: 'web-1' })] }), row('web-2', { lastActivityAt: 30 })]),
    group('cg-store', 'Store', APP, [row('app-1', { lastActivityAt: 20 })]),
    group('cg-notes', 'Notes', null, [row('home-1', { lastActivityAt: 10 })]),
    group('cg-web-notes', 'Web notes', null, []),
  ],
  routines: [{ name: 'Nightly', latest: row('run-3', { routine: 'Nightly', lastActivityAt: 70 }), earlier: [row('run-2', { routine: 'Nightly', lastActivityAt: 60 })] }],
  started: [row('started-1', { lastActivityAt: 80 })],
  ungrouped: [],
  other: [],
  ...extra,
});

const keys = sections => sections.filter(s => s.items.length).map(s => s.key);
const titles = sections => sections.filter(s => s.items.length).map(s => s.title);
const ids = section => section.items.map(it => it.key);
const sectionOf = (sections, key) => sections.find(s => s.key === key);

test('the rank is project, then group, then session, then sub session', () => {
  assert.deepEqual(RANKS, ['project', 'group', 'session', 'sub']);
  const items = [{ n: 'sub', rank: 'sub' }, { n: 'session', rank: 'session' }, { n: 'group', rank: 'group' }, { n: 'project', rank: 'project' }];
  assert.deepEqual(ranked(items).map(it => it.n), ['project', 'group', 'session', 'sub']);
});

test('within a rank the items keep the order they came in, and ranking takes nothing out and changes nothing it was given', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => ({ n, rank: ['sub', 'group', 'sub', 'project', 'group', 'sub'][i] }));
  const before = items.map(it => it.n).join('');
  assert.deepEqual(ranked(items).map(it => it.n), ['d', 'b', 'e', 'a', 'c', 'f']);
  assert.equal(items.map(it => it.n).join(''), before);
  assert.deepEqual(ranked([]), []);
});

test('a stable order holds for a long list too, where a sort that is not stable would shuffle the ties', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ i, rank: RANKS[i % 2 ? 2 : 3] }));
  const result = ranked(items);
  const sessions = result.filter(it => it.rank === 'session').map(it => it.i);
  assert.deepEqual(sessions, [...sessions].sort((a, b) => a - b));
  assert.equal(result.length, 200);
});

test('an item with a rank that is not one of the four is refused', () => {
  assert.throws(() => ranked([{ rank: 'folder' }]), /folder is not a rank/);
});

test('a session nested under another is a sub session and any other is a session', () => {
  assert.equal(rankOfRow(row('a')), 'session');
  assert.equal(rankOfRow(row('b', { parent: 'a' })), 'sub');
});

test('the words are the lower case pieces of what was typed, and every one must be in the text', () => {
  assert.deepEqual(wordsOf('  Fix  LOGIN\tbug '), ['fix', 'login', 'bug']);
  assert.deepEqual(wordsOf('   '), []);
  assert.ok(hasWords('Fix the Login bug', ['login', 'fix']));
  assert.ok(!hasWords('Fix the Login bug', ['login', 'logout']));
  assert.ok(hasWords('anything', []));
});

test('with words typed, All lists projects, then groups, then sessions, then sub sessions, and Archived last', () => {
  const ix = list();
  const archived = [row('old-web', { title: 'web old', archived: true }), row('old-web-kid', { title: 'web old kid', parent: 'old-web', archived: true })];
  const all = sectionsFor('all', ix, archived, 'web', NEW);
  assert.deepEqual(all.map(s => s.key), ['project', 'group', 'session', 'sub', 'archived']);
  assert.deepEqual(all.map(s => s.title), ['Projects', 'Groups', 'Sessions', 'Sub sessions', 'Archived']);
  assert.deepEqual(ids(all[0]), ['view:cp-web']);
  assert.deepEqual(ids(all[1]), ['group:cg-web-notes']);
  assert.deepEqual(ids(all[2]), ['web-1', 'web-2']);
  assert.deepEqual(ids(all[3]), ['web-1-kid']);
  assert.deepEqual(ids(all[4]), ['old-web', 'old-web-kid']);
});

test('the sessions in a rank keep the newest first order, and Archived keeps its own order with the top level ones before the nested', () => {
  const ix = list();
  const archived = [row('n1', { title: 'web a', parent: 'x' }), row('t1', { title: 'web b' }), row('n2', { title: 'web c', parent: 'x' }), row('t2', { title: 'web d' })];
  const all = sectionsFor('all', ix, archived, 'web', NEW);
  assert.deepEqual(ids(sectionOf(all, 'archived')), ['t1', 't2', 'n1', 'n2']);
  const sessions = sectionsFor('sessions', ix, [], 'web', NEW);
  assert.deepEqual(sessions.map(s => s.key), ['session', 'sub']);
  assert.deepEqual(ids(sessions[0]), ['web-1', 'web-2']);
});

test('a group is found by its name and not by its project\'s, and its result says which project and how many sessions it holds', () => {
  const ix = list();
  const found = sectionOf(sectionsFor('all', ix, [], 'check', NEW), 'group').items;
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].group, { id: 'cg-checkout', name: 'Checkout', view: WEB, meta: 'Group in Website', lamp: null, count: 3 });
  assert.deepEqual(ids(sectionOf(sectionsFor('all', ix, [], 'website', NEW), 'group') ?? { items: [] }), []);
  assert.deepEqual(sectionOf(sectionsFor('all', ix, [], 'notes', NEW), 'group').items.map(it => it.group.meta), ['Group in Home', 'Group in Home']);
});

test('a group whose project is gone is a group in Home, as the list shows it', () => {
  const ix = list({ groups: [group('cg-lost', 'Lost', 'cp-deleted', [row('x')])] });
  const [hit] = sectionsFor('groups', ix, [], '', NEW)[0].items;
  assert.deepEqual([hit.group.view, hit.group.meta], [null, 'Group in Home']);
});

test('a group\'s lamp is waiting when a session in it waits or its own chat does, working when one works, and otherwise none', () => {
  const lampFor = g => sectionsFor('groups', list({ groups: [g] }), [], '', NEW)[0].items[0].group.lamp;
  assert.equal(lampFor(group('g', 'G', null, [row('a'), row('b', { state: 'working' })])), 'working');
  assert.equal(lampFor(group('g', 'G', null, [row('a'), row('b', { state: 'waiting' })])), 'waiting');
  assert.equal(lampFor(group('g', 'G', null, [row('a', { state: 'working' })], { session: { id: 's', state: 'waiting' } })), 'waiting');
  assert.equal(lampFor(group('g', 'G', null, [row('a')], { session: { id: 's', state: 'working' } })), 'working');
  assert.equal(lampFor(group('g', 'G', null, [row('a', { children: [row('kid', { state: 'waiting', parent: 'a' })] })])), 'waiting');
  assert.equal(lampFor(group('g', 'G', null, [row('a')], { session: { id: 's', state: 'idle' } })), null);
  assert.equal(lampFor(group('g', 'G', null, [])), null);
});

test('the Groups chip lists every group with nothing typed, Home\'s first and then each project\'s in the order of the projects', () => {
  const ix = list();
  const [only] = sectionsFor('groups', ix, [], '', NEW);
  assert.equal(only.title, 'Groups');
  assert.deepEqual(ids(only), ['group:cg-notes', 'group:cg-web-notes', 'group:cg-checkout', 'group:cg-store']);
  assert.deepEqual(ids(sectionsFor('groups', ix, [], 'NOTES', NEW)[0]), ['group:cg-notes', 'group:cg-web-notes']);
  assert.deepEqual(sectionsFor('groups', ix, [], 'nothing like it', NEW)[0].items, []);
});

test('a project listed after another in the projects comes after it in the Groups chip, whatever the order of the groups in the list', () => {
  const ix = list({ projects: [{ id: APP, name: 'Mobile app' }, { id: WEB, name: 'Website' }] });
  assert.deepEqual(ids(sectionsFor('groups', ix, [], '', NEW)[0]), ['group:cg-notes', 'group:cg-web-notes', 'group:cg-store', 'group:cg-checkout']);
});

test('the Projects chip lists Home and the projects whose names match, and a project is a result with a count', () => {
  const ix = list();
  const [only] = sectionsFor('projects', ix, [], '', NEW);
  assert.deepEqual(ids(only), ['view:home', 'view:cp-web', 'view:cp-app']);
  assert.deepEqual(ids(sectionsFor('projects', ix, [], 'mobile', NEW)[0]), ['view:cp-app']);
  assert.equal(only.items[1].view.count, 3);
});

test('the Sessions chip with words lists sessions and then sub sessions, and leaves out a routine\'s runs', () => {
  const ix = list();
  const found = sectionsFor('sessions', ix, [], 'run', NEW);
  assert.deepEqual(found.map(s => s.items.length), [0, 0]);
  const withKids = sectionsFor('sessions', ix, [], 'web', NEW);
  assert.deepEqual(withKids.map(s => [s.title, ids(s)]), [['Sessions', ['web-1', 'web-2']], ['Sub sessions', ['web-1-kid']]]);
});

test('the Sessions chip with nothing typed is the newest first list of every session, nested ones among them, as before', () => {
  const [only] = sectionsFor('sessions', list(), [], '', NEW);
  assert.equal(only.title, 'Sessions');
  assert.deepEqual(ids(only), ['web-1-kid', 'started-1', 'web-1', 'web-2', 'app-1', 'home-1']);
});

test('the Sessions chip shows no more than 50 of each rank', () => {
  const many = Array.from({ length: 120 }, (_, i) => row(`s${i}`, { lastActivityAt: i }));
  const ix = list({ groups: [group('g', 'G', null, many)] });
  assert.equal(sectionsFor('sessions', ix, [], '', NEW)[0].items.length, 50);
  assert.equal(sectionOf(sectionsFor('all', ix, [], 's', NEW), 'session').items.length, 50);
  assert.equal(sectionsFor('sessions', ix, [], '', NEW)[0].items[0].key, 's119');
});

test('with nothing typed All is Recents, Projects and Actions, with no groups and no sub session section', () => {
  const ix = list();
  const all = sectionsFor('all', ix, [{ ...row('old'), archived: true }], '', NEW);
  assert.deepEqual(all.map(s => s.title), ['Recents', 'Projects', 'Actions']);
  assert.deepEqual(ids(all[0]), ['web-1-kid', 'started-1', 'run-3', 'run-2', 'web-1', 'web-2', 'app-1', 'home-1']);
  assert.deepEqual(ids(all[1]), ['view:home', 'view:cp-web', 'view:cp-app']);
  assert.deepEqual(all[2].items, [{ key: 'new', action: 'New session', hint: NEW, hash: '#/new' }]);
});

test('with no project All leaves the Projects section out, with words typed or not, and the Projects chip lists Home alone', () => {
  const ix = list({ projects: [], groups: [group('g', 'Notes', null, [row('a')])] });
  assert.deepEqual(sectionsFor('all', ix, [], '', NEW).map(s => s.title), ['Recents', 'Actions']);
  assert.deepEqual(titles(sectionsFor('all', ix, [], 'notes', NEW)), ['Groups']);
  assert.deepEqual(ids(sectionsFor('projects', ix, [], '', NEW)[0]), ['view:home']);
});

test('the Scheduled chip has the two actions and then the entries Home shows, and the words filter both', () => {
  const ix = list();
  const sched = [
    { id: 'b', title: 'Write the notes', at: '2026-11-02T09:00:00+10:00', status: 'pending' },
    { id: 'a', title: 'Nightly look', at: '2026-11-01T09:00:00+10:00', status: 'pending' },
    { id: 'c', title: 'Missed one', at: '2026-10-20T09:00:00+10:00', status: 'skipped', reason: 'late' },
    { id: 'd', title: 'Done fine', at: '2026-10-19T09:00:00+10:00', status: 'started', sessionId: 's1' },
  ];
  assert.deepEqual(sectionsFor('scheduled', ix, [], '', NEW).map(ids), [['manage-scheduled', 'new-scheduled'], []]);
  const [actions, entries] = sectionsFor('scheduled', ix, [], '', NEW, sched);
  assert.deepEqual(ids(actions), ['manage-scheduled', 'new-scheduled']);
  assert.equal(entries.title, 'Scheduled');
  assert.deepEqual(ids(entries), ['scheduled:a', 'scheduled:b', 'scheduled:c']);
  assert.deepEqual(entries.items.map(it => it.hash), ['#/scheduled/a', '#/scheduled/b', '#/scheduled']);
  assert.ok(entries.items.every(it => it.hint));
  assert.deepEqual(sectionsFor('scheduled', ix, [], 'schedule a', NEW, sched).map(ids), [['new-scheduled'], []]);
  assert.deepEqual(sectionsFor('scheduled', ix, [], 'notes', NEW, sched).map(ids), [[], ['scheduled:b']]);
  assert.deepEqual(sectionsFor('scheduled', ix, [], 'nightly', NEW).map(ids), [[], []]);
  assert.deepEqual(actions.items.map(it => it.hash), ['#/scheduled', '#/scheduled/new']);
});

test('the Routines chip lists the latest run of each routine with its number of runs, and the words filter by title or routine', () => {
  const ix = list();
  const [manage, runs] = sectionsFor('routines', ix, [], '', NEW);
  assert.deepEqual(ids(manage), ['manage-routines']);
  assert.equal(runs.title, 'Routines');
  assert.deepEqual(runs.items.map(it => [it.key, it.r.runs]), [['run-3', 2]]);
  assert.deepEqual(sectionsFor('routines', ix, [], 'nightly', NEW).map(ids), [['run-3']]);
  assert.deepEqual(sectionsFor('routines', ix, [], 'weekly', NEW).map(ids), [[]]);
  assert.deepEqual(sectionsFor('routines', ix, [], 'manage', NEW).map(ids), [['manage-routines'], []]);
});

test('the Archived chip keeps most recently archived first with nothing typed and ranks top level before nested once words are typed', () => {
  const archived = [row('n1', { title: 'x one', parent: 'p' }), row('t1', { title: 'x two' })];
  assert.deepEqual(ids(sectionsFor('archived', list(), archived, '', NEW)[0]), ['n1', 't1']);
  assert.deepEqual(ids(sectionsFor('archived', list(), archived, 'x', NEW)[0]), ['t1', 'n1']);
});

test('a session is found by its title, folder, branch or routine, and every word must be in one of them', () => {
  const ix = list({ started: [row('a', { title: 'Fix login', cwd: '/Users/me/shop', branch: 'feature/cart' }), row('b', { title: 'Docs', cwd: '/Users/me/site', branch: 'main' })], groups: [], routines: [] });
  const found = words => ids(sectionOf(sectionsFor('all', ix, [], words, NEW), 'session'));
  assert.deepEqual(found('login'), ['a']);
  assert.deepEqual(found('shop'), ['a']);
  assert.deepEqual(found('cart'), ['a']);
  assert.deepEqual(found('login cart'), ['a']);
  assert.deepEqual(found('login docs'), []);
});

// What sessionTargets gives a row in a list with two projects and Home's groups.
const placesFor = (row, ix) => sessionTargets(ix, row);
const placed = () => {
  const ix = list({
    pinned: [],
    groups: [
      group('cg-checkout', 'Checkout', WEB, [row('web-1')]),
      group('cg-release', 'Release notes', WEB, []),
      group('cg-store', 'Store', APP, []),
      group('cg-notes', 'Website ideas', null, []),
    ],
  });
  return { ix, targets: placesFor(row('s', { source: 'capcom' }), ix) };
};

test('a renamed group is found by its new name in the search and in Move to, and no longer by the old one', () => {
  const rename = ix => ({ ...ix, groups: ix.groups.map(g => (g.id === 'cg-store' ? { ...g, name: 'Shop front' } : g)) });
  const ix = rename(list());
  const found = words => ids(sectionOf(sectionsFor('all', ix, [], words, NEW), 'group') ?? { items: [] });
  assert.deepEqual(found('shop front'), ['group:cg-store']);
  assert.deepEqual(found('store'), []);
  const targets = placesFor(row('s', { source: 'capcom' }), rename(placed().ix));
  assert.deepEqual(findPlaces(targets, 'shop front').map(p => p.label), ['Shop front']);
  assert.deepEqual(findPlaces(targets, 'store'), []);
});

test('Move to finds a place by its own name or by its project\'s name, and a project\'s name ranks its places ahead of a name that matches only the place', () => {
  const { targets } = placed();
  const found = findPlaces(targets, 'website');
  assert.deepEqual(found.map(p => [p.label, p.rank, p.value]), [['Checkout', 'project', 'Website'], ['Release notes', 'project', 'Website'], ['Website ideas', 'group', 'Home']]);
  assert.deepEqual(findPlaces(targets, 'store').map(p => [p.label, p.rank, p.value]), [['Store', 'group', 'Mobile app']]);
});

test('Move to ranks a project\'s name ahead of a group\'s own name whichever comes first in the menu', () => {
  const targets = [
    { label: 'Pinned', section: 'pinned' },
    { group: 'Docs', items: [{ label: 'Plans', section: 'cg-1' }] },
    { group: 'Mobile app', items: [{ label: 'Docs sync', section: 'cg-2' }, { label: 'Other', section: 'cg-3' }] },
    { label: 'Docs', section: 'cg-4' },
  ];
  const found = findPlaces(targets, 'docs');
  assert.deepEqual(found.map(p => [p.label, p.rank]), [['Plans', 'project'], ['Docs sync', 'group'], ['Docs', 'group']]);
});

test('Move to shows each place with the project it is in, Home for a place outside projects when projects have places, and nothing for Pinned and Routines', () => {
  const targets = [
    { label: 'Routines', section: 'routines' },
    { label: 'Pinned', section: 'pinned' },
    { group: 'Website', items: [{ label: 'Checkout', section: 'cg-1' }] },
    { label: 'Notes', section: 'cg-2' },
    { label: 'Started here', section: 'started' },
  ];
  const by = Object.fromEntries(findPlaces(targets, '').map(p => [p.label, p.value]));
  assert.deepEqual(by, { Routines: null, Pinned: null, Checkout: 'Website', Notes: 'Home', 'Started here': 'Home' });
});

test('Move to gives no value to a place when no project has one, because the menu has no Home heading then either', () => {
  const targets = [{ label: 'Pinned', section: 'pinned' }, { label: 'Notes', section: 'cg-2' }];
  assert.deepEqual(findPlaces(targets, 'n').map(p => [p.label, p.value]), [['Pinned', null], ['Notes', null]]);
});

test('Move to names a place in the note as the menu does, with its project for a place in one', () => {
  const { targets } = placed();
  assert.deepEqual(findPlaces(targets, '').map(p => p.where), ['Pinned', 'Checkout in Website', 'Release notes in Website', 'Store in Mobile app', 'Website ideas']);
});

test('Move to matches words across a place and its project, and finds nothing for words that are in neither', () => {
  const { targets } = placed();
  assert.deepEqual(findPlaces(targets, 'web check').map(p => p.label), ['Checkout']);
  assert.deepEqual(findPlaces(targets, 'zebra'), []);
  assert.deepEqual(findPlaces(targets, 'checkout zebra'), []);
});

test('Move to takes the word Home as the project of the places outside any, and ranks them as one', () => {
  const targets = [
    { group: 'Website', items: [{ label: 'Home page', section: 'cg-1' }] },
    { label: 'Notes', section: 'cg-2' },
  ];
  assert.deepEqual(findPlaces(targets, 'home').map(p => [p.label, p.rank]), [['Notes', 'project'], ['Home page', 'group']]);
});

test('Move to finds a word in a project\'s name only at the start of a word in it, so "me" does not find the places in Home but does find Meetings', () => {
  const targets = [
    { group: 'Website', items: [{ label: 'Meetings', section: 'cg-1' }] },
    { label: 'Notes', section: 'cg-2' },
    { label: 'Started here', section: 'started' },
  ];
  assert.deepEqual(findPlaces(targets, 'me').map(p => [p.label, p.rank]), [['Meetings', 'group']]);
  assert.deepEqual(findPlaces(targets, 'ho').map(p => [p.label, p.rank]), [['Notes', 'project'], ['Started here', 'project']]);
  assert.deepEqual(findPlaces(targets, 'site').map(p => p.label), []);
  assert.deepEqual(findPlaces(targets, 'web').map(p => [p.label, p.rank]), [['Meetings', 'project']]);
});

test('Move to takes the start of any word in a project\'s name, and a place\'s own name matches inside a word as Ctrl+K does', () => {
  const targets = [
    { group: 'Mobile app', items: [{ label: 'Store', section: 'cg-1' }] },
    { group: 'Website', items: [{ label: 'Homepage', section: 'cg-2' }] },
  ];
  assert.deepEqual(findPlaces(targets, 'app').map(p => [p.label, p.rank]), [['Store', 'project']]);
  assert.deepEqual(findPlaces(targets, 'mobile app').map(p => [p.label, p.rank]), [['Store', 'project']]);
  assert.deepEqual(findPlaces(targets, 'bile').map(p => p.label), []);
  assert.deepEqual(findPlaces(targets, 'epage').map(p => [p.label, p.rank]), [['Homepage', 'group']]);
  assert.deepEqual(findPlaces(targets, 'web epage').map(p => [p.label, p.rank]), [['Homepage', 'group']]);
});

test('Move to keeps the order of the menu within a rank, and the place a result runs for is its own section', () => {
  const targets = [
    { group: 'Website', items: [{ label: 'B', section: 'cg-b' }, { label: 'A', section: 'cg-a' }] },
    { group: 'Web', items: [{ label: 'C', section: 'cg-c' }] },
  ];
  const found = findPlaces(targets, 'web');
  assert.deepEqual(found.map(p => [p.label, p.section, p.rank]), [['B', 'cg-b', 'project'], ['A', 'cg-a', 'project'], ['C', 'cg-c', 'project']]);
});

test('Nest under finds sessions by title, all as sessions, in the order of the menu, and an untitled one by the word Untitled', () => {
  const rows = [row('a', { title: 'Fix the login' }), row('b', { title: 'Docs' }), row('c', { title: 'Login page' }), row('d', { title: '' })];
  const found = findSessions(rows, 'LOGIN');
  assert.deepEqual(found.map(f => [f.row.id, f.rank]), [['a', 'session'], ['c', 'session']]);
  assert.deepEqual(findSessions(rows, 'fix login').map(f => f.row.id), ['a']);
  assert.deepEqual(findSessions(rows, 'untitled').map(f => f.row.id), ['d']);
  assert.deepEqual(findSessions(rows, 'zebra'), []);
  assert.equal(UNTITLED.toLowerCase().includes('untitled'), true);
});

test('Nest under matches the title only, not the folder or the branch', () => {
  const rows = [row('a', { title: 'Docs', cwd: '/Users/me/shop', branch: 'login' })];
  assert.deepEqual(findSessions(rows, 'shop'), []);
  assert.deepEqual(findSessions(rows, 'login'), []);
});

test('the Groups chip with nothing typed says there are no groups yet, and anything else with no result says nothing matches', () => {
  assert.equal(emptyText('groups', ''), 'No groups yet.');
  assert.equal(emptyText('groups', '   '), 'No groups yet.');
  assert.equal(emptyText('groups', 'zebra'), 'Nothing matches.');
  assert.equal(emptyText('all', ''), 'Nothing matches.');
  assert.equal(emptyText('sessions', ''), 'Nothing matches.');
});
