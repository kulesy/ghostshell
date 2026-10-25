// What a session's pull requests say on its card and when they put the session in the owner's court, as rules that need no page, so node can test them.
// A pull request is the shape lib/pulls.mjs answers with.
import { isPullUrl } from './pull-url.js';
import { countedRows, stampOf } from './sub-panel-rules.js';

// The most facts one pull request shows.
export const SHOWN = 3;

// How long an answer is trusted before the page asks again, and the most sessions the page asks about.
export const FRESH_MS = 60_000;
export const MOST_SESSIONS = 120;

// Most urgent first. A fact's place here is its rank, and `ready` and `approved` never both apply, nor do `waiting` and `open`.
const ORDER = ['review', 'changes', 'conflicts', 'comments', 'failing', 'running', 'ready', 'approved', 'waiting', 'open', 'draft', 'merged', 'closed'];

export const WORDS = {
  review: 'Needs your review',
  changes: 'Changes requested',
  conflicts: 'Has conflicts',
  failing: 'Checks failing',
  running: 'Checks running',
  ready: 'Ready to merge',
  approved: 'Approved',
  waiting: 'Waiting for review',
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

export const commentsWords = n => `Has ${n} unresolved comment${n === 1 ? '' : 's'}`;

const TONES = {
  review: 'needs', changes: 'needs', conflicts: 'needs', comments: 'needs', failing: 'error', running: 'working', ready: 'ready',
  approved: 'ready', merged: 'ready', waiting: 'quiet', open: 'quiet', draft: 'quiet', closed: 'quiet',
};

const fact = (key, text = WORDS[key]) => ({ key, text, tone: TONES[key] });

// The facts of one pull request as [{ key, text, tone }], most urgent first and at most `limit` of them.
export function factsOf(pull, limit = SHOWN) {
  if (pull.state === 'merged' || pull.state === 'closed') return [fact(pull.state)];
  const draft = pull.state === 'draft';
  const found = [];
  if (pull.asked) found.push(fact('review'));
  if (pull.review === 'changes') found.push(fact('changes'));
  if (pull.conflicts) found.push(fact('conflicts'));
  if (pull.threads > 0) found.push(fact('comments', commentsWords(pull.threads)));
  if (pull.checks === 'failing') found.push(fact('failing'));
  if (pull.checks === 'running') found.push(fact('running'));
  if (pull.review === 'approved') found.push(fact(!draft && pull.clean && pull.checks !== 'failing' && pull.checks !== 'running' ? 'ready' : 'approved'));
  if (!found.length) {
    if (pull.requested > 0 || pull.review === 'required') found.push(fact('waiting'));
    else if (!draft) found.push(fact('open'));
  }
  if (draft) found.push(fact('draft'));
  return found.slice(0, limit);
}

const rankOf = pull => ORDER.indexOf(factsOf(pull, 1)[0]?.key);

// A session's pull requests, the one with the most urgent fact first, and those with the same keeping the order the server gave.
export const orderPulls = list => list.map((pull, at) => ({ pull, at, rank: rankOf(pull) })).sort((a, b) => (a.rank - b.rank) || (a.at - b.at)).map(entry => entry.pull);

// The pull requests a card draws, in order, leaving out any whose address the page may not link to.
export const cardPulls = list => orderPulls((Array.isArray(list) ? list : []).filter(pull => isPullUrl(pull?.url)));

const OWN_WORK = new Set(['changes', 'conflicts', 'comments', 'failing']);

// Whether a pull request waits on the owner: a review asked of them, theirs that is ready to merge, or theirs with work to do
// while the session is idle, since a working session is on its own failing checks and comments.
export function needsOwner(pulls, row) {
  return (Array.isArray(pulls) ? pulls : []).some(pull => {
    const keys = factsOf(pull, Infinity).map(f => f.key);
    if (keys.includes('review')) return true;
    if (!pull.mine) return false;
    return keys.includes('ready') || (row?.state !== 'working' && keys.some(key => OWN_WORK.has(key)));
  });
}

// The ids of the sessions in `rows` that wait on the owner for a pull request, from what the page last heard (a map of id to { pulls }).
export const needsOf = (rows, known) => new Set(rows.filter(row => needsOwner(known.get(row.id)?.pulls, row)).map(row => row.id));

// Whether the answer kept for a session (a map of id to { stamp, at, pulls, settling }) is missing, was read at another stamp, is old, or was unfinished.
export function wantsPulls(row, known, now = Date.now()) {
  const kept = known.get(row.id);
  return !kept || kept.stamp !== stampOf(row) || kept.settling === true || now - kept.at > FRESH_MS;
}

// The ids of `rows` to ask the server about, each once.
export const pullsToAsk = (rows, known, now = Date.now()) => [...new Set(rows.filter(row => wantsPulls(row, known, now)).map(row => row.id))];

// The sessions to ask about for the chat `id`: every live one the header button counts, which is more than the cards drawn, the most recent first.
export const scopeOf = (ix, id, max = MOST_SESSIONS) => countedRows(ix, id).filter(row => !row.archived).sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, max);
