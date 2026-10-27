// What a session's pull requests and issues say on its card and in its header, and when they put the session in the owner's court, as rules that
// need no page, so node can test them. An item is the shape lib/pulls.mjs answers with.
import { ISSUE_URL, kindOfUrl, PULL_URL } from './pull-url.js';
import { countedRows, stampOf } from './sub-panel-rules.js';

// How long an answer is trusted before the page asks again, and the most sessions the page asks about.
export const FRESH_MS = 60_000;
export const MOST_SESSIONS = 120;

// The items of a session's list the page may link to, whatever else a server said: a pull request or an issue at its plain address.
export const itemsOf = list => (Array.isArray(list) ? list : []).filter(item => kindOfUrl(item?.url));

// The pull requests gh could read. Only these go to statusOf and needsOwner, which have nothing to say of an issue or of an item that could not be read.
const pullsIn = list => itemsOf(list).filter(item => kindOfUrl(item.url) === 'pull' && item.state !== 'unknown');

const phrase = n => `the ${n} unresolved comment${n === 1 ? '' : 's'}`;
const joined = parts => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]);
const status = (you, text, tone, word) => ({ you, text, tone, word });

// A session another app is running its turn in is as busy as one Capcom runs.
const busy = row => row?.state === 'working' || row?.state === 'active';

// What the owner has to do about a pull request, or who the session waits on, as { you, text, tone, word }, where `word` is the short status a
// badge shows. `row` is the session's, and the first rule that fits wins. A null `mine` (the viewer is unknown) says nothing of what is asked of them.
export function statusOf(pull, row) {
  if (pull.state === 'merged') return status(false, 'Merged, nothing to do', 'ready', 'Merged');
  if (pull.state === 'closed') return status(false, 'Closed, nothing to do', 'quiet', 'Closed');
  if (pull.asked) return status(true, 'Review the pull request', 'needs', 'Review asked');
  const mine = typeof pull.mine === 'boolean' ? pull.mine : null;
  const approved = pull.review === 'approved';
  const blocked = pull.checks === 'failing';
  const mergeable = pull.state === 'open' && pull.clean && !blocked && pull.checks !== 'running';
  if (mine && approved && mergeable) return status(true, 'Merge the pull request', 'needs', 'Ready to merge');
  const work = [
    pull.review === 'changes' && ['the requested changes', 'Changes asked'],
    pull.conflicts && ['the conflicts', 'Conflicts'],
    pull.threads > 0 && [phrase(pull.threads), 'Comments'],
    blocked && ['the failing checks', 'Checks failing'],
  ].filter(Boolean);
  if (mine && work.length) {
    const list = joined(work.map(([words]) => words));
    const [, word] = work[0];
    if (busy(row)) return status(false, `The session is dealing with ${list}`, 'working', word);
    return status(true, `Ask the session to deal with ${list}`, blocked ? 'error' : 'needs', word);
  }
  if (pull.checks === 'running') return status(false, 'Waiting on checks to finish', 'working', 'Checks running');
  if (approved) {
    if (!mergeable) return status(false, 'Approved, but it cannot merge yet', 'quiet', 'Approved');
    return status(false, mine === false ? 'Approved, nothing asked of you' : 'Approved', 'quiet', 'Approved');
  }
  if (pull.requested > 0 || pull.review === 'required') return status(false, 'Waiting on a reviewer', 'quiet', 'In review');
  if (pull.state === 'draft') return status(false, 'Still a draft', 'quiet', 'Draft');
  if (mine === null) return status(false, 'Open', 'quiet', 'Open');
  return status(false, mine ? 'Open, no review asked for yet' : 'Open, nothing asked of you', 'quiet', 'Open');
}
export const needsOwner = (items, row) => pullsIn(items).some(pull => statusOf(pull, row).you);

// The pull request a card speaks of: the first in the session's list that waits on the owner, or else the first. Issues and items gh could not
// read are never it.
export function leadPull(list, row) {
  const pulls = pullsIn(list);
  return pulls.find(pull => statusOf(pull, row).you) ?? pulls[0] ?? null;
}

// An issue's short status and tone. A closed issue is Done when it was completed and Not planned when it was not.
const ISSUE_WORDS = { open: ['Open', 'quiet'], completed: ['Done', 'ready'], not_planned: ['Not planned', 'quiet'] };
const UNREADABLE = ["Can't read", 'error'];
export const issueWord = issue => ISSUE_WORDS[issue?.state] ?? UNREADABLE;

// What a badge shows for an item, from its address and its answer: its kind, `ref` (`repo#n`), short status word and tone, the sentence of a pull request
// (the card's own), and the title. Its `name` is short for a screen reader, and its `tip` holds the rest for the pointer and the keyboard.
export function badgeOf(item, row) {
  const kind = kindOfUrl(item.url);
  const [, , repo, number] = (kind === 'issue' ? ISSUE_URL : PULL_URL).exec(item.url);
  const label = kind === 'issue' ? 'Issue' : 'Pull request';
  const read = item.state !== 'unknown';
  const said = !read ? null : kind === 'issue' ? issueWord(item) : statusOf(item, row);
  const [word, tone] = !read ? UNREADABLE : kind === 'issue' ? said : [said.word, said.tone];
  const title = read && typeof item.title === 'string' ? item.title : '';
  const sentence = read && kind === 'pull' ? said.text : '';
  return {
    kind, label, word, tone, title, sentence, url: item.url, ref: `${repo}#${number}`, attached: item.attached === true,
    name: `${repo}#${number}, ${word}`,
    tip: [title, sentence, item.url].filter(Boolean).join('. '),
  };
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
