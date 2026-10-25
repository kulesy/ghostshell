// What counts as a GitHub pull request address, for the server and the page alike, with no imports so node can test it.
// The server hands an address to `gh` and the page makes it a link, so only the plain https://github.com/<owner>/<repo>/pull/<n> form passes.
const OWNER = '[A-Za-z0-9][A-Za-z0-9-]{0,38}';
const REPO = '(?!\\.{1,2}/)[A-Za-z0-9._-]{1,100}';
const NUMBER = '[1-9][0-9]{0,8}';
const BODY = `https://github\\.com/(${OWNER})/(${REPO})/pull/(${NUMBER})`;

export const PULL_URL = new RegExp(`^${BODY}$`);

// In prose an address must not sit inside a longer one (a web archive link, a user@host) or run into more of a word (/pull/12abc, /pull/12.html).
const IN_TEXT = new RegExp(`(?<![\\w/.@-])${BODY}(?![\\w-])(?!\\.\\w)`, 'g');

export const isPullUrl = s => typeof s === 'string' && PULL_URL.test(s);

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
