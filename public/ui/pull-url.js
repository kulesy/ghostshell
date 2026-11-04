// What counts as a GitHub pull request address, for the server and the page alike, with no imports so node can test it.
// The server hands an address to `gh` and the page makes it a link, so only the plain https://github.com/<owner>/<repo>/pull/<n> form passes.
const OWNER = '[A-Za-z0-9][A-Za-z0-9-]{0,38}';
const REPO = '(?!\\.{1,2}/)[A-Za-z0-9._-]{1,100}';
const NUMBER = '[1-9][0-9]{0,8}';
const BODY = `https://github\\.com/(${OWNER})/(${REPO})/pull/(${NUMBER})`;

export const PULL_URL = new RegExp(`^${BODY}$`);
// An issue address is the same plain form with /issues/ for /pull/.
export const ISSUE_URL = new RegExp(`^https://github\\.com/(${OWNER})/(${REPO})/issues/(${NUMBER})$`);

// In prose an address must not sit inside a longer one (a web archive link, a user@host) or run into more of a word (/pull/12abc, /pull/12.html).
const IN_TEXT = new RegExp(`(?<![\\w/.@-])${BODY}(?![\\w-])(?!\\.\\w)`, 'g');

export const isPullUrl = s => typeof s === 'string' && PULL_URL.test(s);
export const isIssueUrl = s => typeof s === 'string' && ISSUE_URL.test(s);

// The pull request addresses in some text, as the plain form, in the order they first appear. GitHub ignores case in a name, so two spellings count once.
export function pullUrlsIn(text) {
  if (typeof text !== 'string' || !text.includes('github.com/')) return [];
  const seen = new Set();
  const urls = [];
  for (const [, owner, repo, number] of text.matchAll(IN_TEXT)) {
    const url = `https://github.com/${owner}/${repo}/pull/${number}`;
    if (!seen.has(url.toLowerCase())) {
      seen.add(url.toLowerCase());
      urls.push(url);
    }
  }
  return urls;
}

const REFERENCE = new RegExp(`^(?:#|pull/)?(${NUMBER})$`, 'i');
const ADDRESS = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${OWNER})/(${REPO})/pull/(${NUMBER})(?:/[^?#]*)?(?:[?#].*)?$`, 'i');

// A search word read as a pull request: 7969, #7969 and pull/7969 give a number alone, and an address in any of the forms people paste gives its
// repo too. Anything else is null, and so is a number that is not the shape of one (0, 007, 12abc).
export function pullReference(word) {
  if (typeof word !== 'string') return null;
  const bare = REFERENCE.exec(word);
  if (bare) return { number: Number(bare[1]), repo: null };
  const address = ADDRESS.exec(word);
  return address ? { number: Number(address[3]), repo: `${address[1]}/${address[2]}` } : null;
}

// Whether a link in the form owner/repo#7969 is the pull request the reference names. The number must be the same and not a part of it, and an address
// also needs the same repo, without regard to case.
export function linkMatches(link, { number, repo }) {
  const at = link.lastIndexOf('#');
  return link.slice(at + 1) === String(number) && (repo === null || link.slice(0, at).toLowerCase() === repo.toLowerCase());
}
