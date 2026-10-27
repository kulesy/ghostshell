// What counts as a GitHub pull request or issue address, for the server and the page alike, with no imports so node can test it.
// The server hands an address to `gh` and the page makes it a link, so only the plain https://github.com/<owner>/<repo>/pull/<n> and .../issues/<n> forms pass.
const OWNER = '[A-Za-z0-9][A-Za-z0-9-]{0,38}';
const REPO = '(?!\\.{1,2}/)[A-Za-z0-9._-]{1,100}';
const NUMBER = '[1-9][0-9]{0,8}';
const body = word => `https://github\\.com/(${OWNER})/(${REPO})/${word}/(${NUMBER})`;

export const PULL_URL = new RegExp(`^${body('pull')}$`);
export const ISSUE_URL = new RegExp(`^${body('issues')}$`);

// In prose an address must not sit inside a longer one (a web archive link, a user@host) or run into more of a word (/pull/12abc, /pull/12.html).
const inText = word => new RegExp(`(?<![\\w/.@-])${body(word)}(?![\\w-])(?!\\.\\w)`, 'g');
const PULL_IN_TEXT = inText('pull');
const ISSUE_IN_TEXT = inText('issues');

export const isPullUrl = s => typeof s === 'string' && PULL_URL.test(s);
export const isIssueUrl = s => typeof s === 'string' && ISSUE_URL.test(s);

// 'pull' or 'issue' for a plain address of either kind, else null.
export const kindOfUrl = s => (isPullUrl(s) ? 'pull' : isIssueUrl(s) ? 'issue' : null);

// The addresses in some text, as the plain form, in the order they first appear. GitHub ignores case in a name, so two spellings count once.
function urlsMatching(text, pattern, word) {
  if (typeof text !== 'string' || !text.includes('github.com/')) return [];
  const seen = new Set();
  const urls = [];
  for (const [, owner, repo, number] of text.matchAll(pattern)) {
    const url = `https://github.com/${owner}/${repo}/${word}/${number}`;
    if (!seen.has(url.toLowerCase())) {
      seen.add(url.toLowerCase());
      urls.push(url);
    }
  }
  return urls;
}

export const pullUrlsIn = text => urlsMatching(text, PULL_IN_TEXT, 'pull');
export const issueUrlsIn = text => urlsMatching(text, ISSUE_IN_TEXT, 'issues');

// What may follow the number and be cut off: a tab such as /files or /commits/<sha>, and a trailing slash. A query or fragment is cut first.
const TAIL = /^(?:\/[A-Za-z][\w-]*(?:\/[\w.-]*)*)?\/?$/;

// A pasted address as { kind, url } in the plain form, or null when it is not a GitHub pull request or issue address.
export function normaliseUrl(pasted) {
  if (typeof pasted !== 'string') return null;
  const text = pasted.trim();
  if (!text || /\s/.test(text) || text.length > 500) return null;
  const cut = text.split(/[?#]/, 1)[0];
  const match = /^(https:\/\/github\.com\/[^/]+\/[^/]+\/(?:pull|issues)\/[0-9]+)(\/.*)?$/.exec(cut);
  if (!match || !TAIL.test(match[2] ?? '')) return null;
  const url = match[1];
  const kind = kindOfUrl(url);
  return kind ? { kind, url } : null;
}
