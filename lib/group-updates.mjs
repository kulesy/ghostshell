// The ranked list a group's chat is asked for when its sessions change. The pieces here are pure: what a session looks like at one look, what
// changed between two, whether an update may go now, and its text. makeGroupUpdates runs them against callbacks the server gives it, so nothing
// here imports the server or the runner. See docs/adr/20261023-a-session-for-each-group.md, the amendment of 2026-10-27.
import fs from 'node:fs';
import path from 'node:path';
import { mainPull, statusOf } from '../public/ui/pull-rules.js';
import { pendingLine } from '../public/ui/sub-panel-rules.js';
import { BUCKETS, bucketOf } from '../public/ui/group-rules.js';
import { ago, oneLine } from './groups.mjs';
import { sessionMessage } from './subs.mjs';

export const TIMING = {
  tick: 30_000,
  settle: 3 * 60_000,
  maxWait: 15 * 60_000,
  gap: 10 * 60_000,
  typing: 30_000,
  ownerQuiet: 2 * 60_000,
  stall: 20 * 60_000,
  warm: 55 * 60_000,
  pulls: 5 * 60_000,
  opened: 24 * 3600_000,
};
export const DAILY_LIMIT = 40;
export const LISTED = 30;

// For a test instance only: every wait but the 24 hours is divided by `scale`, so a run takes seconds.
export const scaled = scale => (scale > 1 ? Object.fromEntries(Object.entries(TIMING).map(([k, v]) => [k, k === 'opened' ? v : Math.max(1, Math.round(v / scale))])) : TIMING);

const lowerFirst = text => text.charAt(0).toLowerCase() + text.slice(1);
const minutes = ms => Math.floor(ms / 60_000);
const quoted = title => `"${title}"`;
const pad = n => String(n).padStart(2, '0');
export const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clock = ms => { const d = new Date(ms); return `${dayKey(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ---- one look at a session -------------------------------------------------------------------------

// `row` is the session's index row with its mark in `dot`. `pending` is what it waits on as { tool, summary }, `said` the first sentence of its
// latest reply and `pull` its main pull request. `prKey` is the pull request's line with the session taken as idle, so a session starting or
// ending a turn on it does not read as the pull request changing.
export function snapshotOf(row, { pending = [], said = '', pull = null } = {}, now, timing = TIMING) {
  const waiting = row.state === 'waiting' || row.dot === 'awaiting';
  const running = !waiting && (row.state === 'working' || row.dot === 'running');
  return {
    id: row.id,
    title: oneLine(row.title, 80) || 'Untitled',
    bucket: bucketOf(row, now),
    waiting,
    working: running,
    error: !waiting && row.dot === 'error',
    pending,
    activeAt: row.lastActivityAt,
    idleMs: Math.max(0, now - row.lastActivityAt),
    stalled: running && now - row.lastActivityAt >= timing.stall,
    said: oneLine(said, 200),
    pr: pull ? statusOf(pull, row).text : null,
    prKey: pull ? statusOf(pull, { state: 'idle' }).text : null,
  };
}

// ---- what changed between two looks ----------------------------------------------------------------

// `prev` and `next` are maps of session id to snapshot. A session new in `next` has nothing to change from, and one gone from it is not counted.
export function changesBetween(prev, next) {
  const changes = [];
  for (const [id, now] of next) {
    const was = prev.get(id);
    if (!was) continue;
    const add = (kind, text) => changes.push({ id, kind, text });
    const name = quoted(now.title);
    if (now.waiting && !was.waiting) {
      const waits = pendingLine(now.pending);
      add('waiting', `${name} is ${waits ? lowerFirst(waits) : 'waiting on you'}.`);
    }
    if (now.error && !was.error) add('error', `${name} ended its turn with an error.`);
    if (was.working && !now.working && !now.waiting && !now.error) add('finished', `${name} finished its turn.`);
    if (now.stalled && !was.stalled) add('stalled', `${name} has had no new activity for ${minutes(now.idleMs)} minutes.`);
    if (was.prKey && now.prKey && now.prKey !== was.prKey) add('pull', `${name} has a pull request that changed: ${now.prKey}.`);
  }
  return changes;
}

// ---- whether an update may go now ------------------------------------------------------------------

export const todayCount = (entry, now) => (entry && entry.day === dayKey(now) ? entry.count : 0);

// Trigger rules 3 to 7. Null when an update may go, else the word for the rule that holds it. `batch` is { first, last, size } of the changes
// kept since the last update, `lastAt` when the chat last got one, `typedAt` and `ownerAt` when the owner last typed and last sent a message
// to it, and `lastCallAt` when the chat's model was last called.
export function holdFor({ now, batch, lastAt = 0, idle, typedAt = 0, ownerAt = 0, lastCallAt = 0, viewing, today = 0 }, timing = TIMING) {
  if (!batch.size) return 'nothing';
  if (now - batch.last < timing.settle && now - batch.first < timing.maxWait) return 'settling';
  if (now - lastAt < timing.gap) return 'gap';
  if (!idle) return 'busy';
  if (now - typedAt < timing.typing) return 'typing';
  if (now - ownerAt < timing.ownerQuiet) return 'owner';
  if (!viewing && now - lastCallAt >= timing.warm) return 'cold';
  if (today >= DAILY_LIMIT) return 'capped';
  return null;
}

// ---- the text --------------------------------------------------------------------------------------

function stateWords(s) {
  if (s.waiting) return lowerFirst(pendingLine(s.pending) || 'Waiting on you');
  if (s.error) return 'ended its last turn with an error';
  if (s.working) return s.stalled ? `working, with no new activity for ${minutes(s.idleMs)} minutes` : 'working';
  return 'idle';
}

function memberLine(s, now) {
  const parts = [`${quoted(s.title)} [${s.id}]: ${stateWords(s)}, last moved ${ago(s.activeAt, now)}.`];
  if (s.pr) parts.push(`Pull request: ${s.pr}.`);
  if (s.said) parts.push(`Last said: "${s.said}"`);
  return `- ${parts.join(' ')}`;
}

// `members` are snapshots in the order they are listed, `changes` what changed, and `rules` the ranking rules, given on a chat's first update.
// The wrapper escapes a closing tag in the body, so a title cannot end the message early.
export function updateText({ name, now, changes, members, rules = '' }) {
  const shown = members.slice(0, LISTED);
  const more = members.length - shown.length;
  const body = [
    `Status update for the group "${oneLine(name, 80)}", ${clock(now)}.`,
    changes.length ? `Changed since the last update:\n${[...changes.slice(0, LISTED).map(c => `- ${c.text}`), changes.length > LISTED && `- … and ${changes.length - LISTED} more.`].filter(Boolean).join('\n')}` : '',
    `Live sessions (${members.length}):\n${[...shown.map(s => memberLine(s, now)), more > 0 && `… and ${more} more`].filter(Boolean).join('\n')}`,
    rules,
    'Rank these sessions by the ranking rules in your instructions and reply with the numbered list only.',
  ].filter(Boolean).join('\n\n');
  return sessionMessage('ghostshell', 'GhostShell', body);
}

// The sessions in the panel's order: those that need the owner, those working, recent ones, then idle ones, each newest first.
export const inPanelOrder = snapshots => [...snapshots].sort((a, b) => (BUCKETS.findIndex(x => x.key === a.bucket) - BUCKETS.findIndex(x => x.key === b.bucket)) || (b.activeAt - a.activeAt) || (a.id < b.id ? -1 : 1));

// ---- what was sent, kept across restarts -------------------------------------------------------------

// group-updates.json in the state folder: for each chat, `at` when it last got an update, `day` and `count` for the updates it got that day,
// and `rules` once the ranking rules have gone to it. A file that cannot be read counts as empty, as the marks do.
export function makeUpdateStore(stateDir) {
  const file = path.join(stateDir, 'group-updates.json');
  const read = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch { return {}; }
  };
  return {
    read,
    set(chatId, entry) {
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify({ ...read(), [chatId]: entry }, null, 2)}\n`);
      fs.renameSync(temp, file);
    },
  };
}

// ---- the scheduler ---------------------------------------------------------------------------------

// Every callback is the server's. `candidates()` gives the groups that have a chat as { groupId, chatId } and leaves out retired groups and
// the built-in sections. `members(groupId)` gives { name, rows } for the group's live sessions, each with its mark in `dot`, or null when the
// group is gone. `pulls(rows)` gives a map of session id to its main pull request, null for none and undefined for one it could not read.
export function makeGroupUpdates({ now = Date.now, timing = TIMING, enabled, candidates, openedAt, transcript, members, details, pulls, chatIdle, viewing, send, rules, store, log = console.error }) {
  const watched = new Map();
  const typed = new Map();
  const spoke = new Map();
  let running = false;

  async function visit({ groupId, chatId }) {
    const at = now();
    // Rule 2: a page has opened the chat in the last day, and the owner has written to it. The transcript is asked after the page, which is cheaper.
    if (at - openedAt(chatId) >= timing.opened) return watched.delete(chatId);
    const t = transcript(chatId);
    if (!t) return watched.delete(chatId);
    const found = members(groupId);
    if (!found) return watched.delete(chatId);
    const watch = watched.get(chatId) ?? { prev: null, batch: { first: 0, last: 0, changes: new Map() }, pulls: new Map(), pullsAt: 0 };
    watched.set(chatId, watch);
    if (at - watch.pullsAt >= timing.pulls) {
      watch.pullsAt = at;
      const got = await pulls(found.rows);
      for (const [id, pull] of got) if (pull !== undefined) watch.pulls.set(id, pull);
    }
    const next = new Map(found.rows.map(row => [row.id, snapshotOf(row, { ...details(row), pull: watch.pulls.get(row.id) ?? null }, at, timing)]));
    const prev = watch.prev;
    watch.prev = next;
    // The first look after a start is only a baseline.
    if (!prev) return;
    const { batch } = watch;
    for (const c of changesBetween(prev, next)) {
      if (!batch.changes.size) batch.first = at;
      batch.last = at;
      batch.changes.delete(`${c.id} ${c.kind}`);
      batch.changes.set(`${c.id} ${c.kind}`, c);
    }
    const entry = store.read()[chatId];
    const hold = holdFor({ now: at, batch: { first: batch.first, last: batch.last, size: batch.changes.size }, lastAt: entry?.at, idle: chatIdle(chatId), typedAt: typed.get(chatId), ownerAt: spoke.get(chatId), lastCallAt: t.mtime, viewing: viewing(chatId), today: todayCount(entry, at) }, timing);
    if (hold) return;
    const text = updateText({ name: found.name, now: at, changes: [...batch.changes.values()], members: inPanelOrder([...next.values()]), rules: entry?.rules ? '' : rules() });
    await send(chatId, text);
    batch.changes.clear();
    store.set(chatId, { at, day: dayKey(at), count: todayCount(entry, at) + 1, rules: true });
  }

  return {
    // A typing ping from a page, or the owner's own message, for the chat of a group.
    typing: chatId => typed.set(chatId, now()),
    ownerSpoke: chatId => spoke.set(chatId, now()),
    // The server runs one at a time, so a slow `gh` never has two looks at once.
    async tick() {
      if (running) return;
      if (!enabled()) return watched.clear();
      running = true;
      try {
        for (const g of candidates()) {
          try { await visit(g); } catch (e) { log(`Group update for ${g.groupId} failed: ${e.message}`); }
        }
      } finally { running = false; }
    },
    watching: chatId => watched.has(chatId),
  };
}

// The main pull request of each of `rows`, for the scheduler's `pulls`. `urlsFor(id, cwd)` and `lookup(urls)` are the pulls instance's.
export async function pullsOf(rows, { urlsFor, lookup }) {
  const urls = new Map(rows.map(row => [row.id, urlsFor(row.id, row.cwd)]));
  const { found } = await lookup([...new Set([...urls.values()].flat())]);
  return new Map(rows.map(row => {
    const list = urls.get(row.id);
    if (!list.length) return [row.id, null];
    return [row.id, mainPull(list.filter(url => found.has(url)).map(url => found.get(url))) ?? undefined];
  }));
}
