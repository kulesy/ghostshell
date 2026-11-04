// Run with `npm test`. What counts as a pull request address: the full string, and the ones found inside prose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isIssueUrl, isPullUrl, ISSUE_URL, linkMatches, PULL_URL, pullReference, pullUrlsIn } from '../public/ui/pull-url.js';

const PR = 'https://github.com/example-org/example-repo/pull/12';

test('the plain https address of a pull request passes, with the shapes of owner, repo and number GitHub allows', () => {
  for (const url of [
    PR,
    'https://github.com/a/b/pull/1',
    'https://github.com/A1/repo.name_x-y/pull/999999999',
    `https://github.com/${'a'.repeat(39)}/r/pull/5`,
    `https://github.com/o/${'r'.repeat(100)}/pull/5`,
    'https://github.com/o/.github/pull/5',
    'https://github.com/o/...x/pull/5',
    'https://github.com/o-p/r/pull/10',
  ]) {
    assert.equal(isPullUrl(url), true, url);
    assert.equal(PULL_URL.test(url), true, url);
  }
});

test('anything but the plain form is refused: another scheme or host, a port, userinfo, a different path, a bad number or name', () => {
  for (const url of [
    'http://github.com/o/r/pull/1',
    'https://github.com.evil.com/o/r/pull/1',
    'https://github.com@evil.com/o/r/pull/1',
    'https://user@github.com/o/r/pull/1',
    'https://github.com:8443/o/r/pull/1',
    'https://www.github.com/o/r/pull/1',
    'https://GitHub.com/o/r/pull/1',
    'HTTPS://github.com/o/r/pull/1',
    'https://github.com/o/r/pulls/1',
    'https://github.com/o/r/issues/1',
    'https://github.com/o/r/pull/0',
    'https://github.com/o/r/pull/01',
    'https://github.com/o/r/pull/1234567890',
    'https://github.com/o/r/pull/',
    'https://github.com/o/r/pull',
    'https://github.com/-o/r/pull/1',
    `https://github.com/${'a'.repeat(40)}/r/pull/1`,
    `https://github.com/o/${'r'.repeat(101)}/pull/1`,
    'https://github.com/o/./pull/1',
    'https://github.com/o/../pull/1',
    'https://github.com/o/r/pull/1/files',
    'https://github.com/o/r/pull/1?x=1',
    'https://github.com/o/r/pull/1#c',
    'https://github.com/o/r/pull/1 ',
    ' https://github.com/o/r/pull/1',
    'https://github.com/o/r/pull/1\n',
    'https://github.com/o/r/pull/12abc',
    'https://github.com/o/r/pull/-1',
    'https://github.com/o/r r/pull/1',
    'https://github.com//r/pull/1',
    '',
    null,
    undefined,
    12,
    {},
  ]) assert.equal(isPullUrl(url), false, String(url));
});

test('addresses in prose are found in the order they appear, once each, in the plain form', () => {
  const text = `See https://github.com/a/b/pull/3 and https://github.com/c/d/pull/1, then ${PR} again, and https://github.com/a/b/pull/3.`;
  assert.deepEqual(pullUrlsIn(text), ['https://github.com/a/b/pull/3', 'https://github.com/c/d/pull/1', PR]);
  assert.deepEqual(pullUrlsIn('https://github.com/A/B/pull/3 https://github.com/a/b/pull/3'), ['https://github.com/A/B/pull/3'], 'two spellings of one name count once');
  assert.deepEqual(pullUrlsIn(''), []);
  assert.deepEqual(pullUrlsIn('no address here, only github.com/o/r/pull/1'), []);
  for (const bad of [null, undefined, 3, {}, ['x']]) assert.deepEqual(pullUrlsIn(bad), []);
});

test('an address is found in a markdown link, in brackets and quotes, and at the end of a sentence', () => {
  for (const text of [
    `[the PR](${PR})`,
    `(${PR})`,
    `[${PR}]`,
    `<${PR}>`,
    `"${PR}"`,
    `'${PR}'`,
    `\`${PR}\``,
    `PR: ${PR}`,
    `Opened ${PR}.`,
    `Opened ${PR}!`,
    `Opened ${PR}?`,
    `Opened ${PR}, ready.`,
    `Opened ${PR}; ready.`,
    `Opened ${PR}: ready.`,
    `Opened (${PR}).`,
    `${PR}\nnext line`,
    `${PR}\tx`,
    `${PR}#issuecomment-1`,
    `${PR}?notification_referrer_id=1`,
    `${PR}/files`,
    `${PR}/commits/abc`,
    `${PR}/`,
    `- ${PR}`,
    `=${PR}`,
    `see:${PR}`,
  ]) assert.deepEqual(pullUrlsIn(text), [PR], text);
});

test('an address that sits inside a longer one, or runs into more of a word, is refused', () => {
  for (const text of [
    `x${PR}`,
    `a.${PR}`,
    `a-${PR}`,
    `a_${PR}`,
    `me@${PR}`,
    `/${PR}`,
    `https://web.archive.org/web/1/${PR}`,
    `https://evil.example/${PR}`,
    `${PR}abc`,
    `${PR}-x`,
    `${PR}_x`,
    `${PR}.html`,
    `${PR}.x`,
    'https://github.com/o/r/pull/1234567890',
    'https://github.com/o/r/pull/0',
    'https://github.com/o/r/pull/01',
    'https://github.com/o/r/pulls/1',
    'https://github.com/o/r/issues/1',
    'https://github.com/o/r/pull/',
    'http://github.com/o/r/pull/1',
    'https://github.com.evil.com/o/r/pull/1',
    'https://github.com@evil.com/o/r/pull/1',
    'https://github.com:8443/o/r/pull/1',
    'https://www.github.com/o/r/pull/1',
    'https://GITHUB.com/o/r/pull/1',
    'https://github.com/-o/r/pull/1',
    `https://github.com/${'a'.repeat(40)}/r/pull/1`,
  ]) assert.deepEqual(pullUrlsIn(text), [], text);
});

test('a refused address beside a good one does not hide it', () => {
  assert.deepEqual(pullUrlsIn(`https://github.com.evil.com/o/r/pull/1 then ${PR}`), [PR]);
  assert.deepEqual(pullUrlsIn(`${PR}.html and ${PR} too`), [PR]);
  assert.deepEqual(pullUrlsIn(`https://web.archive.org/web/1/${PR} ${PR}`), [PR]);
});

test('a long text of near misses is read quickly', () => {
  const text = 'https://github.com/o/'.repeat(50_000) + PR;
  const started = Date.now();
  assert.deepEqual(pullUrlsIn(text), []);
  assert.ok(Date.now() - started < 1000);
});

test('the plain https address of an issue passes, with the same owner, repo and number rules as a pull request', () => {
  for (const url of [
    'https://github.com/example-org/example-repo/issues/12',
    'https://github.com/A1/repo.name_x-y/issues/999999999',
    `https://github.com/${'a'.repeat(39)}/r/issues/5`,
    'https://github.com/o/.github/issues/5',
  ]) {
    assert.equal(isIssueUrl(url), true, url);
    assert.equal(ISSUE_URL.test(url), true, url);
    assert.equal(isPullUrl(url), false, url);
  }
  assert.equal(isPullUrl(PR), true);
  assert.equal(isIssueUrl(PR), false);
});

test('anything but the plain form of an issue is refused', () => {
  for (const url of [
    'http://github.com/o/r/issues/1',
    'https://github.com.evil.com/o/r/issues/1',
    'https://github.com@evil.com/o/r/issues/1',
    'https://github.com:8443/o/r/issues/1',
    'https://www.github.com/o/r/issues/1',
    'https://github.com/o/r/issue/1',
    'https://github.com/o/r/issues/0',
    'https://github.com/o/r/issues/01',
    'https://github.com/o/r/issues/1234567890',
    'https://github.com/o/r/issues/',
    'https://github.com/o/r/issues/1/',
    'https://github.com/o/r/issues/1#issuecomment-5',
    'https://github.com/o/r/issues/1?x=1',
    'https://github.com/o/r/issues/1\n',
    'https://github.com/o/r/pull/1',
    '',
    null,
    undefined,
    5,
  ]) assert.equal(isIssueUrl(url), false, String(url));
});

test('an issue address does not count as a pull request address in text', () => {
  assert.deepEqual(pullUrlsIn('See https://github.com/o/r/issues/4 and https://github.com/o/r/pull/5.'), ['https://github.com/o/r/pull/5']);
});

test('a number, #number and pull/number read as a pull request with no repo', () => {
  for (const word of ['7969', '#7969', 'pull/7969', 'PULL/7969']) assert.deepEqual(pullReference(word), { number: 7969, repo: null }, word);
});

test('an address reads as a pull request with its repo, whatever its scheme, www, case, ending or query', () => {
  for (const word of [
    'https://github.com/acme/web/pull/7969',
    'http://github.com/acme/web/pull/7969',
    'github.com/acme/web/pull/7969',
    'https://www.github.com/acme/web/pull/7969',
    'HTTPS://GitHub.com/acme/web/PULL/7969',
    'https://github.com/acme/web/pull/7969/',
    'https://github.com/acme/web/pull/7969/files',
    'https://github.com/acme/web/pull/7969/commits',
    'https://github.com/acme/web/pull/7969/changes',
    'https://github.com/acme/web/pull/7969/files/',
    'https://github.com/acme/web/pull/7969/commits/0a1b2c3',
    'https://github.com/acme/web/pull/7969/files/0a1b2c3..4d5e6f7',
    'https://github.com/acme/web/pull/7969/checks',
    'https://github.com/acme/web/pull/7969/checks?check_run_id=1',
    'https://github.com/acme/web/pull/7969?diff=split',
    'https://github.com/acme/web/pull/7969/files?w=1#diff-abc',
    'https://github.com/acme/web/pull/7969#discussion_r123',
  ]) {
    const { number, repo } = pullReference(word);
    assert.deepEqual([number, repo.toLowerCase()], [7969, 'acme/web'], word);
  }
  assert.equal(pullReference('https://github.com/Acme/Web/pull/7969').repo, 'Acme/Web', 'the repo keeps its case');
});

test('anything else is not a pull request reference, and a number must have the shape of one', () => {
  for (const word of [
    '', 'login', 'acme', '0', '007', '12abc', '#0', '#', 'pull/', 'pull/0', 'pull/12abc', 'pulls/12', '1234567890', '79 69', '#79#', 'acme/web#7969',
    'https://github.com/acme/web/issues/7969', 'https://github.com/acme/web/pull/', 'https://github.com/acme/web/pull/007', 'https://github.com/acme/web/pull/12abc',
    'https://github.com.evil.com/acme/web/pull/7969', 'https://gitlab.com/acme/web/pull/7969', 'https://github.com/acme/pull/7969',
    null, undefined, 7969, {},
  ]) assert.equal(pullReference(word), null, String(word));
});

test('a link matches the number exactly, never a part of it, and an address also needs the same repo without regard to case', () => {
  const link = 'Acme/Web#7969';
  assert.equal(linkMatches(link, pullReference('7969')), true);
  assert.equal(linkMatches(link, pullReference('#7969')), true);
  assert.equal(linkMatches(link, pullReference('pull/7969')), true);
  for (const word of ['796', '969', '79', '17969', '79690']) assert.equal(linkMatches(link, pullReference(word)), false, word);
  assert.equal(linkMatches(link, pullReference('https://github.com/acme/web/pull/7969')), true, 'case of the repo is ignored');
  assert.equal(linkMatches('acme/web#7969', pullReference('https://github.com/ACME/WEB/pull/7969/files')), true);
  assert.equal(linkMatches(link, pullReference('https://github.com/acme/docs/pull/7969')), false, 'another repo');
  assert.equal(linkMatches(link, pullReference('https://github.com/acme/web/pull/7970')), false, 'another number');
  assert.equal(linkMatches('acme/web-app#7969', pullReference('https://github.com/acme/web/pull/7969')), false, 'a repo that only starts with the name');
});
