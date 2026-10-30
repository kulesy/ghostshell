// How the sessions below a session add up, as rules that need no page, so node can test them and the server shares them. The rows are the
// index's as a flat list (`withKids` flattens a list that nests them), and a row's `via` names the nearest session it shows under.
import { BUCKETS, bucketOf } from './group-rules.js';
import { everyRow, withKids, withoutRow } from './tree.js';

// The marks a row can show, least urgent first, so a mark's place in the list is its rank.
const DOTS = [null, 'ready', 'running', 'error', 'awaiting'];
const STATE_DOT = { waiting: 'awaiting', working: 'running' };

// A row with no mark yet, as the server's rows are before the list puts one on, ranks by its state.
export const rankOf = row => (row.archived ? 0 : Math.max(DOTS.indexOf(row.dot ?? null), DOTS.indexOf(STATE_DOT[row.state] ?? null), 0));

const mostUrgent = rows => DOTS[rows.reduce((top, row) => Math.max(top, rankOf(row)), 0)];

export const subsOf = (rows, id) => rows.filter(row => row.via === id);

function underVia(rows) {
  const under = new Map();
  for (const row of rows) {
    if (row.via == null) continue;
    if (under.has(row.via)) under.get(row.via).push(row);
    else under.set(row.via, [row]);
  }
  return under;
}

// Every session below `id` at any depth, nearest first. A session is met once, so a loop in the links ends the walk.
export function descendantsOf(rows, id) {
  const under = underVia(rows);
  const seen = new Set([id]);
  const found = [];
  for (const queue = [id]; queue.length;) {
    for (const row of under.get(queue.shift()) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      found.push(row);
      queue.push(row.id);
    }
  }
  return found;
}

// The list with a session and everything below it taken out, as archiving takes a family.
export const withoutFamily = (ix, id) => [...descendantsOf(everyRow(ix), id).map(r => r.id), id].reduce((list, gone) => withoutRow(list, gone, { withChildren: true }), ix);

const BUCKET_ORDER = BUCKETS.map(b => b.key);

// The place in the panel's order of the most urgent session among a line and everything under it.
export const placeOf = (node, now) => Math.min(BUCKET_ORDER.indexOf(bucketOf(node.row, now)), ...(node.subs ?? []).map(sub => placeOf(sub, now)));

// Lines are { row, subs }. Those that need you come first, then those working, recent and idle, judged by the most urgent session in the
// line and under it, and in each part the newest goes first and a tie goes by id.
export function orderLines(nodes, now = Date.now()) {
  const places = new Map(nodes.map(node => [node, placeOf(node, now)]));
  return [...nodes].sort((a, b) => (places.get(a) - places.get(b)) || (b.row.lastActivityAt - a.row.lastActivityAt) || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
}

export function treeOf(rows, id, now = Date.now()) {
  const under = underVia(rows);
  const seen = new Set([id]);
  const build = parent => {
    const found = [];
    for (const row of under.get(parent) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      found.push(row);
    }
    return orderLines(found.map(row => ({ row, subs: build(row.id) })), now);
  };
  return build(id);
}

// How a list of sessions adds up. Archived ones are left out of the counts. `dot` is the most urgent mark among the rest, or null.
export function tally(rows, now = Date.now()) {
  const live = rows.filter(row => !row.archived);
  const roll = { total: live.length, needs: 0, working: 0, recent: 0, idle: 0, dot: mostUrgent(live) };
  for (const row of live) roll[bucketOf(row, now)]++;
  return roll;
}

// The sessions below `id`, at any depth, added up.
export const rollupOf = (rows, id, now = Date.now()) => tally(descendantsOf(rows, id), now);

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// "3 sub sessions, 2 waiting on you, 1 working", leaving out a part with nothing in it. A group's chat counts "session" in place of "sub session".
export const rollupLine = ({ total, needs, working }, noun = 'sub session') => (total ? [plural(total, noun), needs && `${needs} waiting on you`, working && `${working} working`].filter(Boolean).join(', ') : '');

// What a folded family's row shows: the most urgent mark among its head and the sessions nested under it.
export const familyDot = row => mostUrgent(withKids([row]));
