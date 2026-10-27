// Run with `npm test`. What the badge after a pull request or issue link says and what its card shows, and which links the page asks the server about,
// with no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeOf, cardOf, isLinkUrl, linksToAsk, MOST_LINKS, usable, wantsLink } from '../public/ui/link-rules.js';
import { FRESH_MS, statusOf } from '../public/ui/pull-rules.js';

const NOW = Date.parse('2026-10-27T01:00:00.000Z');
const pr = n => `https://github.com/example-org/example-repo/pull/${n}`;
const issue = n => `https://github.com/example-org/example-repo/issues/${n}`;

const pull = (extra = {}) => ({
  kind: 'pull', url: pr(12), title: 'Fix the thing', repo: 'example-org/example-repo', number: 12, state: 'open', mine: true, asked: false, requested: 0,
  review: 'none', checks: 'none', conflicts: false, clean: false, threads: 0, ...extra,
});
const bug = (extra = {}) => ({ kind: 'issue', url: issue(3), title: 'Crash on start', repo: 'example-org/example-repo', number: 3, state: 'open', reason: null, ...extra });

test('a pull request badge says Open, Draft, Merged or Closed, each with a tone and a mark of its own', () => {
  const said = state => badgeOf(pull({ state }));
  assert.deepEqual(said('open'), { word: 'Open', tone: 'working', mark: 'pull' });
  assert.deepEqual(said('draft'), { word: 'Draft', tone: 'quiet', mark: 'draft' });
  assert.deepEqual(said('merged'), { word: 'Merged', tone: 'ready', mark: 'merge' });
  assert.deepEqual(said('closed'), { word: 'Closed', tone: 'error', mark: 'closed' });
  assert.equal(said('something new'), null);
});

test('an issue badge says Open, Closed, Not planned or Duplicate by the reason it was closed', () => {
  assert.deepEqual(badgeOf(bug()), { word: 'Open', tone: 'working', mark: 'issue' });
  assert.deepEqual(badgeOf(bug({ state: 'closed', reason: 'completed' })), { word: 'Closed', tone: 'ready', mark: 'done' });
  assert.deepEqual(badgeOf(bug({ state: 'closed', reason: 'not_planned' })), { word: 'Not planned', tone: 'quiet', mark: 'skip' });
  assert.deepEqual(badgeOf(bug({ state: 'closed', reason: 'duplicate' })), { word: 'Duplicate', tone: 'quiet', mark: 'skip' });
  assert.equal(badgeOf(bug({ state: 'closed', reason: 'unheard of' })), null);
  assert.equal(badgeOf(bug({ state: 'closed', reason: null })), null);
  assert.equal(badgeOf(bug({ state: 'draft', reason: 'completed' })), null, 'an issue is never a draft');
});

test('nothing that is not a link has a badge', () => {
  for (const link of [null, undefined, 5, 'open', {}, { kind: 'pull' }, { kind: 'discussion', state: 'open' }]) assert.equal(badgeOf(link), null);
});

test('an answer is used only for the address it names and of the kind the address is', () => {
  assert.deepEqual(usable(pr(12), pull()), pull());
  assert.deepEqual(usable(issue(3), bug()), bug());
  assert.deepEqual(usable(pr(12).replace('example-org', 'Example-Org'), pull()), pull(), 'GitHub ignores case');
  assert.equal(usable(pr(13), pull()), null, 'another address');
  assert.equal(usable(pr(12), bug({ url: pr(12) })), null, 'an issue answer for a pull request address');
  assert.equal(usable(issue(3), pull({ url: issue(3) })), null, 'a pull request answer for an issue address');
  assert.equal(usable(pr(12), pull({ state: 'weird' })), null);
  assert.equal(usable(pr(12), pull({ url: 'javascript:alert(1)' })), null);
  assert.equal(usable(pr(12), null), null);
  assert.equal(usable(pr(12), 'open'), null);
});

test('the card of a pull request has its title, repo, state, review, checks and the next step from the sub session rules', () => {
  const link = pull({ review: 'approved', checks: 'passing', clean: true });
  assert.deepEqual(cardOf(link), {
    label: 'Pull request example-org/example-repo #12',
    title: 'Fix the thing',
    repo: 'example-org/example-repo #12',
    state: { word: 'Open', tone: 'working', mark: 'pull' },
    facts: [['Review', 'Approved'], ['Checks', 'Passing']],
    next: { text: 'Merge the pull request', tone: 'needs' },
  });
  const rule = statusOf(link, null);
  assert.deepEqual(cardOf(link).next, { text: rule.text, tone: rule.tone });
});

test('the card words each review and each checks result, and a pull request that is done says so in its next step', () => {
  const facts = extra => cardOf(pull(extra)).facts;
  assert.deepEqual(facts({ review: 'changes', checks: 'failing' }), [['Review', 'Changes requested'], ['Checks', 'Failing']]);
  assert.deepEqual(facts({ review: 'required', checks: 'running' }), [['Review', 'Review required'], ['Checks', 'Running']]);
  assert.deepEqual(facts({ review: 'none', checks: 'none' }), [['Review', 'No review yet'], ['Checks', 'No checks']]);
  assert.deepEqual(facts({ review: undefined, checks: 'odd' }), [], 'a word the page does not know is left out');
  assert.deepEqual(cardOf(pull({ state: 'merged' })).next, { text: 'Merged, nothing to do', tone: 'ready' });
  assert.deepEqual(cardOf(pull({ state: 'closed' })).next, { text: 'Closed, nothing to do', tone: 'quiet' });
});

test('the card of an issue has a title, repo and state and no review, checks or next step', () => {
  assert.deepEqual(cardOf(bug({ state: 'closed', reason: 'not_planned' })), {
    label: 'Issue example-org/example-repo #3',
    title: 'Crash on start',
    repo: 'example-org/example-repo #3',
    state: { word: 'Not planned', tone: 'quiet', mark: 'skip' },
    facts: [],
    next: null,
  });
});

test('a card with no title says Untitled, and a link with no badge has no card', () => {
  assert.equal(cardOf(pull({ title: '' })).title, 'Untitled');
  assert.equal(cardOf(pull({ title: undefined })).title, 'Untitled');
  assert.equal(cardOf(pull({ state: 'odd' })), null);
  assert.equal(cardOf(null), null);
});

test('only the plain address of a pull request or issue is a link', () => {
  assert.equal(isLinkUrl(pr(1)), true);
  assert.equal(isLinkUrl(issue(1)), true);
  for (const url of [`${pr(1)}/files`, `${issue(1)}#issuecomment-1`, 'https://github.com/o/r', 'https://example.com/o/r/pull/1', '', null, undefined]) assert.equal(isLinkUrl(url), false, String(url));
});

test('an answer is wanted when it is missing, was unfinished, or is older than a minute', () => {
  assert.equal(wantsLink(undefined, NOW), true);
  assert.equal(wantsLink({ at: NOW, link: pull(), settling: false }, NOW), false);
  assert.equal(wantsLink({ at: NOW - FRESH_MS, link: pull(), settling: false }, NOW), false);
  assert.equal(wantsLink({ at: NOW - FRESH_MS - 1, link: pull(), settling: false }, NOW), true);
  assert.equal(wantsLink({ at: NOW, link: pull(), settling: true }, NOW), true);
  assert.equal(wantsLink({ at: NOW, link: null, settling: false }, NOW), false, 'a link that could not be read waits out the minute too');
});

test('the links to ask about are the ones missing or stale, each once, and nothing that is not a link', () => {
  const known = new Map([[pr(1), { at: NOW, link: pull(), settling: false }], [pr(2), { at: NOW - 2 * FRESH_MS, link: pull(), settling: false }], [issue(4), { at: NOW, link: null, settling: false }]]);
  assert.deepEqual(linksToAsk([pr(1), pr(2), pr(3), pr(3), issue(4), issue(5), 'https://example.com/x', `${pr(1)}/files`], known, NOW), [[pr(2), pr(3), issue(5)]]);
  assert.deepEqual(linksToAsk([pr(1)], known, NOW), []);
  assert.deepEqual(linksToAsk([], known, NOW), []);
});

test('the links to ask about come in batches of no more than the server answers', () => {
  const urls = Array.from({ length: MOST_LINKS * 2 + 5 }, (_, at) => issue(at + 1));
  const batches = linksToAsk(urls, new Map(), NOW);
  assert.deepEqual(batches.map(batch => batch.length), [MOST_LINKS, MOST_LINKS, 5]);
  assert.deepEqual(batches.flat(), urls);
});
