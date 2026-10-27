// Run with `npm test`. The route that answers the status of the pull requests and issues a reply links to, over HTTP against the real server and a
// fake gh that never leaves the machine: the shape of the answer, the refusals, the cap, what is left out, and the feature flag that tells a page to ask.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, request, signIn, start } from './harness.mjs';

const pr = n => `https://github.com/example-org/example-repo/pull/${n}`;
const issue = n => `https://github.com/example-org/example-repo/issues/${n}`;

const get = (s, token, route) => request(s, 'GET', route, { headers: as(token) });
const query = urls => `/api/links?${urls.map(url => `url=${encodeURIComponent(url)}`).join('&')}`;
const state = (s, value) => fs.writeFileSync(path.join(s.home, 'gh-state.json'), JSON.stringify(value));
const ghCalls = s => (fs.existsSync(s.ghLog) ? fs.readFileSync(s.ghLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);

const raw = (extra = {}) => ({
  state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }], latestReviews: [],
  reviewRequests: [], author: { login: 'octocat' }, title: 'Fix the thing', ...extra,
});

async function ready(gh = true) {
  const s = await start({ sessions: [{ id: 'top', title: 'Top', ago: 5 }], gh });
  return { s, ...(await signIn(s)) };
}

test('the session list says the server answers the status of links', async () => {
  const { s, token } = await ready();
  assert.equal((await get(s, token, '/api/sessions')).body().features.linkStatus, true);
});

test('a pull request and an issue are answered under their addresses with their title and status, and a repeat ask runs gh no more', async () => {
  const { s, token } = await ready();
  state(s, {
    pulls: { [pr(1)]: raw() },
    issues: { [issue(2)]: { title: 'Crash on start', state: 'CLOSED', stateReason: 'NOT_PLANNED' }, [issue(3)]: { title: 'Slow', state: 'OPEN', stateReason: '' } },
    threads: { [pr(1)]: [false] },
  });
  const urls = [pr(1), issue(2), issue(3)];
  const res = await get(s, token, query(urls));
  assert.equal(res.status, 200);
  const body = res.body();
  assert.equal(body.settling, false);
  assert.deepEqual(Object.keys(body.links), urls);
  assert.deepEqual(body.links[issue(2)], { kind: 'issue', url: issue(2), title: 'Crash on start', repo: 'example-org/example-repo', number: 2, state: 'closed', reason: 'not_planned' });
  assert.deepEqual(body.links[issue(3)], { kind: 'issue', url: issue(3), title: 'Slow', repo: 'example-org/example-repo', number: 3, state: 'open', reason: null });
  assert.deepEqual(body.links[pr(1)], {
    kind: 'pull', url: pr(1), title: 'Fix the thing', repo: 'example-org/example-repo', number: 1, state: 'open', mine: true, asked: false, requested: 0,
    review: 'approved', checks: 'passing', conflicts: false, clean: true, threads: 1,
  });
  const calls = ghCalls(s);
  assert.deepEqual(calls.filter(a => a[0] === 'issue').map(a => a[2]).sort(), [issue(2), issue(3)]);
  assert.deepEqual(calls.filter(a => a[0] === 'pr').map(a => a[2]), [pr(1)]);
  assert.equal(calls.some(a => a.includes('auth')), false);
  assert.deepEqual((await get(s, token, query(urls))).body(), body);
  assert.equal(ghCalls(s).length, calls.length, 'the second ask came from the cache');
});

test('an address gh cannot show is left out, and so is an issues address that is a merged pull request', async () => {
  const { s, token } = await ready();
  state(s, { pulls: { [pr(1)]: raw() }, issues: { [issue(2)]: { title: 'A pull request', state: 'MERGED', stateReason: '' } } });
  const res = await get(s, token, query([pr(1), pr(9), issue(2), issue(9)]));
  assert.deepEqual([res.status, Object.keys(res.body().links), res.body().settling], [200, [pr(1)], false]);
});

test('a gh that fails, or is not there, gives a 200 with no links', async () => {
  for (const gh of [true, 'missing']) {
    const { s, token } = await ready(gh);
    state(s, { fail: true });
    const res = await get(s, token, query([pr(1), issue(2)]));
    assert.deepEqual([res.status, res.body()], [200, { links: {}, settling: false }], String(gh));
  }
});

test('an address repeated is read once, and answered once', async () => {
  const { s, token } = await ready();
  state(s, { issues: { [issue(2)]: { title: 'Slow', state: 'OPEN', stateReason: '' } } });
  const res = await get(s, token, query([issue(2), issue(2), issue(2)]));
  assert.deepEqual(Object.keys(res.body().links), [issue(2)]);
  assert.equal(ghCalls(s).filter(a => a[0] === 'issue').length, 1);
});

test('no address, or one that is not the plain address of a pull request or issue, is a 400 and nothing is run', async () => {
  const { s, token } = await ready();
  for (const route of [
    '/api/links',
    '/api/links?url=',
    `/api/links?ids=top`,
    query(['javascript:alert(1)']),
    query(['https://github.com.evil.com/o/r/pull/1']),
    query(['http://github.com/o/r/issues/1']),
    query([`${pr(1)}/files`]),
    query([`${issue(1)}#issuecomment-5`]),
    query(['https://github.com/o/r/discussions/1']),
    query(['--web']),
    query([pr(1), 'https://github.com/o/r/issues/0']),
    query([issue(1), 'not an address']),
  ]) {
    const res = await get(s, token, route);
    assert.equal(res.status, 400, route);
    assert.equal(typeof res.body().error, 'string', route);
  }
  assert.deepEqual(ghCalls(s), []);
});

test('at most 40 distinct links are answered in one ask', async () => {
  const { s, token } = await ready();
  const many = n => Array.from({ length: n }, (_, at) => issue(at + 1));
  state(s, { issues: Object.fromEntries(many(41).map(url => [url, { title: 'Slow', state: 'OPEN', stateReason: '' }])) });
  const over = await get(s, token, query(many(41)));
  assert.equal(over.status, 400);
  assert.deepEqual(ghCalls(s), []);
  const at = await get(s, token, query(many(40)));
  assert.equal(at.status, 200);
  assert.equal(Object.keys(at.body().links).length, 40);
  const repeated = await get(s, token, query([...many(40), ...many(40)]));
  assert.equal(repeated.status, 200, 'the same 40 twice is 40');
});

test('a request that is not signed in is refused', async () => {
  const { s } = await ready();
  const res = await request(s, 'GET', query([pr(1)]));
  assert.notEqual(res.status, 200);
  assert.deepEqual(ghCalls(s), []);
});
