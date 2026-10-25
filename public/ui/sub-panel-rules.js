// What the Sub sessions tab, the header button that opens it and a folded family's row decide, as rules that need no page, so node can test them.
// The rows are the index's, and `ix` is the page's whole list.
import { fullToolLabel, plural } from './format.js';
import { BUCKETS, groupOfSession, membersOf } from './group-rules.js';
import { descendantsOf, familyDot, orderLines, placeOf, rankOf, rollupLine, rollupOf, tally, treeOf } from './sub-rules.js';
import { everyRow, withKids } from './tree.js';

// The most ids the server's summaries route answers at once.
export const MAX_IDS = 60;

export const WAITING = 'waiting on you';

// A server that can summarise sessions says so on the list. An older one has no tab to show.
export const subStatusOn = ix => !!ix?.features?.subStatus;

// Whether the chat `id` has a Sub sessions tab: a group's chat always has one, and any other chat once a session shows under it.
export function subsOffered(ix, id) {
  if (!id || !subStatusOn(ix)) return false;
  return !!groupOfSession(ix, id) || everyRow(ix).some(row => row.via === id);
}

// A session whose pull request waits on the owner counts as waiting on them, which is how a mark that says so reads everywhere. `needs` is a
// set of session ids, and without one a row is as it came.
export const withPulls = (row, needs) => (needs?.has(row.id) && !row.archived ? { ...row, dot: 'awaiting' } : row);

const overlaid = (rows, needs) => (needs?.size ? rows.map(row => withPulls(row, needs)) : rows);

// The sessions the header button counts, as the index lists them: all the sessions below the chat, or all of a group's.
export function countedRows(ix, id, needs) {
  const group = groupOfSession(ix, id);
  return overlaid(group ? membersOf(group) : descendantsOf(everyRow(ix), id), needs);
}

// The lines at the top of the tab, each { row, subs }, the ones that need the owner first. A group's chat lists the group's own sessions,
// each with its family under it, and any other chat the sessions nested under it.
export function linesOf(ix, id, now = Date.now(), needs) {
  const rows = overlaid(everyRow(ix), needs);
  const group = groupOfSession(ix, id);
  return group ? orderLines(group.sessions.map(row => ({ row: withPulls(row, needs), subs: treeOf(rows, row.id, now) })), now) : treeOf(rows, id, now);
}

// The part of the tab a line falls in, by the most urgent session in the line and under it.
export const partOf = (node, now = Date.now()) => BUCKETS[placeOf(node, now)]?.key ?? 'idle';

// Lines into the parts of the tab, each part keeping the order the lines came in.
export function partsOf(nodes, now = Date.now()) {
  const parts = { needs: [], working: [], recent: [], idle: [] };
  for (const node of nodes) (parts[partOf(node, now)] ?? parts.idle).push(node);
  return parts;
}

// How many sessions the header button counts and how many of those wait on the owner: all the sessions below the chat, or all of a group's.
export function subsStatus(ix, id, now = Date.now(), needs) {
  if (!ix) return { total: 0, needs: 0 };
  const { total, needs: waiting } = tally(countedRows(ix, id, needs), now);
  return { total, needs: waiting };
}

export const subsButtonName = ({ total, needs }) => `Sub sessions: ${total}${needs ? `, ${needs} ${WAITING}` : ''}`;

// The line at the top of the tab: the roll-up of the sessions below the chat, or of a group's live sessions at every depth, which it calls "session".
export function summaryLine(ix, id, now = Date.now(), needs) {
  return rollupLine(tally(countedRows(ix, id, needs), now), groupOfSession(ix, id) ? 'session' : undefined);
}

// What a session waits on, from the summaries route's `pending`: "Waiting for you to approve Bash: npm test", or "Waiting for your
// answer" for a question. More than one reads as the first and a count of the rest. Nothing pending reads as nothing.
export function pendingLine(pending) {
  const [first, ...rest] = Array.isArray(pending) ? pending : [];
  if (!first) return '';
  const more = rest.length ? ` (and ${rest.length} more)` : '';
  if (first.tool === 'AskUserQuestion') return `Waiting for your answer${more}`;
  const what = [fullToolLabel(first.tool || ''), first.summary].filter(Boolean).join(': ');
  return `Waiting for you to approve ${what || 'a request'}${more}`;
}

// The pill a card shows for a session's state: its words and the tone the page colours it by.
export function pillOf(row) {
  if (row.state === 'waiting' || row.dot === 'awaiting') return { label: 'Waiting on you', tone: 'needs' };
  if (row.dot === 'error') return { label: 'Failed', tone: 'error' };
  if (row.state === 'working') return { label: 'Working', tone: 'working' };
  if (row.dot === 'ready') return { label: 'Unread', tone: 'ready' };
  return { label: 'Idle', tone: 'idle' };
}

// A session's summary is read again when it has moved or changed state, since what it waits on goes with its state.
export const stampOf = row => `${row.lastActivityAt}:${row.state}`;

// The most summaries the page keeps.
export const KEPT = 300;

// Drops the oldest entries of `kept`, a map in the order they were stored, until it holds `max`. An id in `drawn` is never dropped: a
// summary that is on screen and goes would be asked for again, and asking for it would drop another.
export function trim(kept, drawn, max = KEPT) {
  for (const id of kept.keys()) {
    if (kept.size <= max) return;
    if (!drawn.has(id)) kept.delete(id);
  }
}

// The ids of `rows` whose summary is not in `kept` (a map of id to { stamp }) or was read at another stamp, each once.
export const staleIds = (rows, kept) => [...new Set(rows.filter(row => kept.get(row.id)?.stamp !== stampOf(row)).map(row => row.id))];

// The sessions a list of lines draws: the lines, and the lines inside each that is opened, at every depth.
export const drawnRows = (nodes, open) => nodes.flatMap(({ row, subs }) => [row, ...(open[row.id] ? drawnRows(subs, open) : [])]);

export function batchesOf(ids, size = MAX_IDS) {
  const batches = [];
  for (let at = 0; at < ids.length; at += size) batches.push(ids.slice(at, at + size));
  return batches;
}

// A text cut around "waiting on you", so the page can colour those words: [before, the words or '', after].
export function splitWaiting(text) {
  const at = text.indexOf(WAITING);
  return at < 0 ? [text, '', ''] : [text.slice(0, at), WAITING, text.slice(at + WAITING.length)];
}

const TAIL = {
  awaiting: roll => `${roll.needs} ${WAITING}`,
  running: roll => (roll.working ? `${roll.working} working` : 'some working'),
  error: () => 'some failed',
  ready: () => 'some unread',
};

// What a folded family's row shows in place of its own: the family's mark, when a session nested under the head is more urgent than the
// head, and the words for the fold button to match. Null when the head already shows the most urgent mark.
export function familyNote(head, now = Date.now()) {
  const kids = head.children ?? [];
  const dot = kids.length ? familyDot(head) : null;
  if (!dot || rankOf({ dot }) <= rankOf(head)) return null;
  const roll = rollupOf(withKids([head]), head.id, now);
  return { dot, label: `${plural(kids.length, 'nested session')}, ${TAIL[dot](roll)}` };
}
