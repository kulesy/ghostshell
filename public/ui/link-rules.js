// What the badge after a pull request or issue link in a reply says, what its card shows, and when the page asks the server about a link, as rules
// that need no page, so node can test them. A link is the shape lib/pulls.mjs answers api/links with.
import { isIssueUrl, isPullUrl } from './pull-url.js';
import { FRESH_MS, statusOf } from './pull-rules.js';
import { batchesOf } from './sub-panel-rules.js';

// The most links the server answers in one ask.
export const MOST_LINKS = 40;

export const isLinkUrl = s => isPullUrl(s) || isIssueUrl(s);

// The word, tone and mark for each state, in the sub session cards' tones. An open link is plain, because amber means the owner has to act.
const PULL_BADGES = {
  open: { word: 'Open', tone: 'working', mark: 'pull' },
  draft: { word: 'Draft', tone: 'quiet', mark: 'draft' },
  merged: { word: 'Merged', tone: 'ready', mark: 'merge' },
  closed: { word: 'Closed', tone: 'error', mark: 'closed' },
};
const ISSUE_BADGES = {
  open: { word: 'Open', tone: 'working', mark: 'issue' },
  completed: { word: 'Closed', tone: 'ready', mark: 'done' },
  not_planned: { word: 'Not planned', tone: 'quiet', mark: 'skip' },
  duplicate: { word: 'Duplicate', tone: 'quiet', mark: 'skip' },
};

const REVIEWS = { approved: 'Approved', changes: 'Changes requested', required: 'Review required', none: 'No review yet' };
const CHECKS = { passing: 'Passing', failing: 'Failing', running: 'Running', none: 'No checks' };

// The answer for an address when it is a link of the kind the address names, and one the badge can say something of, else null.
export function usable(url, link) {
  if (!link || typeof link !== 'object' || typeof link.url !== 'string' || link.url.toLowerCase() !== String(url).toLowerCase()) return null;
  if (link.kind !== (isPullUrl(url) ? 'pull' : 'issue') || !badgeOf(link)) return null;
  return link;
}

// { word, tone, mark } for the badge of a link, or null when its state is not one the page knows.
export function badgeOf(link) {
  if (link?.kind === 'pull') return PULL_BADGES[link.state] ?? null;
  if (link?.kind === 'issue') return ISSUE_BADGES[link.state === 'open' ? 'open' : link.state === 'closed' ? link.reason : ''] ?? null;
  return null;
}

// What the card shows for a link: the title, the repo and number, the state, a pull request's review and checks, and for a pull request the
// next step from the same rules as the sub session cards. Null when the link has no badge.
export function cardOf(link) {
  const badge = badgeOf(link);
  if (!badge) return null;
  const pull = link.kind === 'pull';
  const facts = pull ? [['Review', REVIEWS[link.review]], ['Checks', CHECKS[link.checks]]].filter(([, word]) => word) : [];
  const next = pull ? statusOf(link, null) : null;
  return {
    label: `${pull ? 'Pull request' : 'Issue'} ${link.repo} #${link.number}`,
    title: typeof link.title === 'string' && link.title ? link.title : 'Untitled',
    repo: `${link.repo} #${link.number}`,
    state: badge,
    facts,
    next: next && { text: next.text, tone: next.tone },
  };
}

// Whether the answer kept for a link (a map of url to { at, link, settling }) is missing, was unfinished, or is old.
export const wantsLink = (kept, now = Date.now()) => !kept || kept.settling === true || now - kept.at > FRESH_MS;

// The addresses in `urls` to ask the server about, each once, in batches the server will answer.
export function linksToAsk(urls, known, now = Date.now()) {
  const wanted = [...new Set(urls)].filter(url => isLinkUrl(url) && wantsLink(known.get(url), now));
  return batchesOf(wanted, MOST_LINKS);
}
