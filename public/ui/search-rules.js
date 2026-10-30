// What every search shares, as rules that need no page, so node can test them: the order a search lists what it finds in, how the words
// typed match, what Ctrl+K shows for a chip, and what the Move to and Nest under menus find. See docs/adr/20261016-projects-above-groups.md.
import { UNTITLED } from './order.js';
import { groupLamp, groupsIn, HOME_VIEW, viewIn, viewsNamed } from './scopes.js';
import { everyRow, withKids } from './tree.js';

// A project comes first, then a group, then a session, then a session nested under another. A rank is the name of one of these.
export const RANKS = ['project', 'group', 'session', 'sub'];

const TITLES = { project: 'Projects', group: 'Groups', session: 'Sessions', sub: 'Sub sessions' };

// The items in rank order. A sort is stable, so within a rank they keep the order they came in.
export function ranked(items) {
  const at = item => {
    const n = RANKS.indexOf(item.rank);
    if (n < 0) throw new Error(`${item.rank} is not a rank`);
    return n;
  };
  return items.map((item, i) => [item, at(item), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([item]) => item);
}

export const wordsOf = query => query.toLowerCase().split(/\s+/).filter(Boolean);

// Whether every one of the lower case words is in the text. No words match anything.
export const hasWords = (text, words) => {
  const lower = text.toLowerCase();
  return words.every(w => lower.includes(w));
};

// A session matches on its title, folder, branch or routine.
const sessionMatcher = words => r => hasWords(`${r.title} ${r.cwd} ${r.branch} ${r.routine || ''}`, words);

export const rankOfRow = r => (r.parent ? 'sub' : 'session');

const RECENT = 8;
const SHOWN = 50;

function newestFirst(ix) {
  const seen = new Set();
  return everyRow(ix).filter(r => !seen.has(r.id) && seen.add(r.id)).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

const sessionItem = r => ({ key: r.id, r, rank: rankOfRow(r) });
const viewItem = v => ({ key: `view:${v.id ?? 'home'}`, view: v, rank: 'project' });

// Home's groups first and then each project's, as the sidebar and the list show them.
const orderedGroups = ix => [HOME_VIEW, ...ix.projects.map(p => p.id)].flatMap(view => groupsIn(ix, view));

function groupItem(ix, g) {
  const view = viewIn(ix, g.project);
  const where = view === HOME_VIEW ? 'Home' : ix.projects.find(p => p.id === view).name;
  return { key: `group:${g.id}`, rank: 'group', group: { id: g.id, name: g.name, view, meta: `Group in ${where}`, lamp: groupLamp(g), count: withKids(g.sessions).length } };
}

const section = (key, title, items) => ({ key, title, items });

// The icon is named, not drawn, because these rules load without the page.
const MANAGE_ROUTINES = { key: 'manage-routines', action: 'Manage routines', icon: 'calendarClock', hash: '#/routines' };
const SCHEDULED_ACTIONS = [
  { key: 'manage-scheduled', action: 'Scheduled sessions', icon: 'calendarClock', hash: '#/scheduled' },
  { key: 'new-scheduled', action: 'Schedule a session', icon: 'calendarPlus', hash: '#/scheduled/new' },
];

// One section for each rank, in the order of RANKS, with no more than SHOWN sessions in a section.
const byRank = hits => RANKS.map(rank => {
  const items = hits.filter(it => it.rank === rank);
  return section(rank, TITLES[rank], rank === 'session' || rank === 'sub' ? items.slice(0, SHOWN) : items);
});

// The sections the spotlight shows for a chip and a query. With words typed they follow RANKS and Archived comes last, because those
// sessions are out of the list. With none it is browsing: All is recents, projects and actions, and Sessions is newest first.
export function sectionsFor(chip, ix, archived, query, newHint) {
  const words = wordsOf(query);
  const keep = words.length ? sessionMatcher(words) : () => true;
  const live = newestFirst(ix);
  const asked = words.length > 0;
  const old = list => list.filter(keep).map(sessionItem);
  if (chip === 'archived') return [section('archived', 'Archived', asked ? ranked(old(archived)) : old(archived))];
  if (chip === 'routines') {
    const manage = hasWords(MANAGE_ROUTINES.action, words) ? [section('actions', 'Actions', [MANAGE_ROUTINES])] : [];
    return [...manage, section('routines', 'Routines', ix.routines.map(g => ({ ...g.latest, runs: g.earlier.length + 1 })).filter(keep).map(r => ({ key: r.id, r })))];
  }
  if (chip === 'scheduled') return [section('actions', 'Actions', SCHEDULED_ACTIONS.filter(a => hasWords(a.action, words)))];
  if (chip === 'sessions') {
    if (!asked) return [section('session', 'Sessions', old(live.filter(r => !r.routine)).slice(0, SHOWN))];
    return byRank(ranked(old(live.filter(r => !r.routine)))).filter(s => s.key === 'session' || s.key === 'sub');
  }
  const views = viewsNamed(ix, words).map(viewItem);
  const groups = orderedGroups(ix).filter(g => hasWords(g.name, words)).map(g => groupItem(ix, g));
  if (chip === 'projects') return [section('project', 'Projects', views)];
  if (chip === 'groups') return [section('group', 'Groups', groups)];
  // With no project Home is the only view, and there is nothing to choose between, so All leaves the section out.
  const projects = ix.projects.length ? views : [];
  if (!asked) {
    return [
      section('recents', 'Recents', live.slice(0, RECENT).map(sessionItem)),
      ...(projects.length ? [section('project', 'Projects', projects)] : []),
      section('actions', 'Actions', [{ key: 'new', action: 'New session', hint: newHint, hash: '#/new' }]),
    ];
  }
  return [
    ...byRank(ranked([...projects, ...groups, ...old(live)])),
    section('archived', 'Archived', ranked(old(archived)).slice(0, SHOWN)),
  ];
}

const FIXED = ['pinned', 'routines'];

// Whether the lower case word starts a word in the text, so "ho" finds Home and "me" does not.
const startsWord = (text, word) => {
  const lower = text.toLowerCase();
  for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) if (at === 0 || !/[\p{L}\p{N}]/u.test(lower[at - 1])) return true;
  return false;
};

// The places Move to offers that the words find, ranked, from sessionTargets's `targets`. A word is found anywhere in a place's own name or
// at the start of a word in its project's (Home for one outside a project), and a project's name ranks it as a project. `value` is where
// it is, `where` its note.
export function findPlaces(targets, query) {
  const words = wordsOf(query);
  const home = targets.some(t => t.group) ? 'Home' : null;
  const places = targets.flatMap(t => (t.group
    ? t.items.map(i => ({ label: i.label, section: i.section, value: t.group, where: `${i.label} in ${t.group}` }))
    : [{ label: t.label, section: t.section, value: FIXED.includes(t.section) ? null : home, where: t.label }]));
  const inProject = (p, w) => p.value !== null && startsWord(p.value, w);
  const found = places
    .filter(p => words.every(w => hasWords(p.label, [w]) || inProject(p, w)))
    .map(p => ({ ...p, rank: words.length && words.every(w => inProject(p, w)) ? 'project' : 'group' }));
  return ranked(found);
}

// The sessions Nest under offers that the words find in their titles, ranked, each as { row, rank }.
export const findSessions = (rows, query) => {
  const words = wordsOf(query);
  return ranked(rows.filter(r => hasWords(r.title || UNTITLED, words)).map(row => ({ row, rank: 'session' })));
};

// What a search with no result says. The Groups chip with nothing typed is empty only when there is no group.
export const emptyText = (chip, query) => (chip === 'groups' && !query.trim() ? 'No groups yet.' : 'Nothing matches.');
