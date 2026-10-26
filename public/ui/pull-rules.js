// What a session's pull requests say on its card and when they put the session in the owner's court, as rules that need no page, so node can test them.
// A pull request is the shape lib/pulls.mjs answers with.
import { isPullUrl } from './pull-url.js';
import { countedRows, stampOf } from './sub-panel-rules.js';

// How long an answer is trusted before the page asks again, and the most sessions the page asks about.
export const FRESH_MS = 60_000;
export const MOST_SESSIONS = 120;

// The session's main pull request from its list: the first the page may link to.
export const mainPull = list => (Array.isArray(list) ? list : []).find(pull => isPullUrl(pull?.url)) ?? null;

const phrase = n => `the ${n} unresolved comment${n === 1 ? '' : 's'}`;
const joined = parts => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]);
const status = (you, text, tone) => ({ you, text, tone });

// A session another app is running its turn in is as busy as one Capcom runs.
const busy = row => row?.state === 'working' || row?.state === 'active';

// What the owner has to do about a pull request, or who the session waits on, as { you, text, tone }. `row` is the session's, whose state says
// whether it is working on the pull request itself. The first rule that fits wins. A null `mine` (the viewer is unknown) says nothing of
// what is asked of them.
export function statusOf(pull, row) {
  if (pull.state === 'merged') return status(false, 'Merged, nothing to do', 'ready');
  if (pull.state === 'closed') return status(false, 'Closed, nothing to do', 'quiet');
  if (pull.asked) return status(true, 'Review the pull request', 'needs');
  const mine = typeof pull.mine === 'boolean' ? pull.mine : null;
  const approved = pull.review === 'approved';
  const blocked = pull.checks === 'failing';
  const mergeable = pull.state === 'open' && pull.clean && !blocked && pull.checks !== 'running';
  if (mine && approved && mergeable) return status(true, 'Merge the pull request', 'needs');
  const work = [pull.review === 'changes' && 'the requested changes', pull.conflicts && 'the conflicts', pull.threads > 0 && phrase(pull.threads), blocked && 'the failing checks'].filter(Boolean);
  if (mine && work.length) {
    const list = joined(work);
    if (busy(row)) return status(false, `The session is dealing with ${list}`, 'working');
    return status(true, `Ask the session to deal with ${list}`, blocked ? 'error' : 'needs');
  }
  if (pull.checks === 'running') return status(false, 'Waiting on checks to finish', 'working');
  if (approved) {
    if (!mergeable) return status(false, 'Approved, but it cannot merge yet', 'quiet');
    return status(false, mine === false ? 'Approved, nothing asked of you' : 'Approved', 'quiet');
  }
  if (pull.requested > 0 || pull.review === 'required') return status(false, 'Waiting on a reviewer', 'quiet');
  if (pull.state === 'draft') return status(false, 'Still a draft', 'quiet');
  if (mine === null) return status(false, 'Open', 'quiet');
  return status(false, mine ? 'Open, no review asked for yet' : 'Open, nothing asked of you', 'quiet');
}
export const needsOwner = (pulls, row) => (Array.isArray(pulls) ? pulls : []).some(pull => statusOf(pull, row).you);

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
