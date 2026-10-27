// Run with `npm test`. The route that answers the pull requests each session works on, over HTTP against the real server and a fake gh that never
// leaves the machine. The route for the links in a reply is in links-api.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, request, signIn, start } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const SESSIONS = [
  { id: 'top', title: 'Top', ago: 5 },
  { id: 'kid', title: 'Kid', parent: 'top', ago: 4 },
  { id: 'gone', title: 'Gone', archived: true, ago: 20 },
  { id: 'quiet', title: 'Quiet', ago: 8 },
  { id: WORK, title: 'Talk about the work', source: 'cli', ago: 1, group: 'cg-work' },
];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }];
const pr = n => `https://github.com/example-org/example-repo/pull/${n}`;

const get = (s, token, route) => request(s, 'GET', route, { headers: as(token) });
const pullsOf = async (s, token, ids) => (await get(s, token, `/api/pulls?ids=${ids}`)).body();

async function ready(gh = true) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, gh });
  return { s, ...(await signIn(s)) };
}

const says = (s, id, text) => fs.appendFileSync(path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`),
  `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}-${Math.random()}`, role: 'assistant', content: [{ type: 'text', text }] } })}\n`);

const raw = (extra = {}) => ({
  state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }], latestReviews: [],
  reviewRequests: [], author: { login: 'octocat' }, title: 'Fix the thing', ...extra,
});
const state = (s, value) => fs.writeFileSync(path.join(s.home, 'gh-state.json'), JSON.stringify(value));
const ghCalls = s => (fs.existsSync(s.ghLog) ? fs.readFileSync(s.ghLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);

test('the pulls route is for a signed-in caller who names between 1 and 60 sessions, and anything else is a 400 that names nothing', async () => {
  const { s, token } = await ready();
  assert.equal((await request(s, 'GET', '/api/pulls?ids=top')).status, 401);
  const wrong = [['', 'Name the sessions in ids.'], ['?ids=', 'Name the sessions in ids.'], ['?ids=,,%20,', 'Name the sessions in ids.']];
  for (const [query, error] of wrong) {
    const res = await get(s, token, `/api/pulls${query}`);
    assert.deepEqual([res.status, res.body()], [400, { error }], query);
  }
  const ids = n => Array.from({ length: n }, (_, i) => `none-${i}`).join(',');
  const over = await get(s, token, `/api/pulls?ids=${ids(61)}`);
  assert.deepEqual([over.status, over.body()], [400, { error: 'Ask for at most 60 sessions at a time.' }]);
  const edge = await get(s, token, `/api/pulls?ids=${ids(60)}`);
  assert.deepEqual([edge.status, edge.body()], [200, { pulls: {}, settling: false }]);
  const repeated = await get(s, token, `/api/pulls?ids=${Array(100).fill('top').join(',')}`);
  assert.deepEqual([repeated.status, Object.keys(repeated.body().pulls)], [200, ['top']]);
});

test('an id that is no session, or is a group\'s chat, is left out without a word, an archived session is answered, and one with no pull requests has an empty list', async () => {
  const { s, token } = await ready();
  const body = await pullsOf(s, token, `nobody,${WORK},top,../top,quiet,gone`);
  assert.deepEqual(body, { pulls: { top: [], quiet: [], gone: [] }, settling: false });
  assert.equal(JSON.stringify(body).includes(WORK), false);
  assert.deepEqual(ghCalls(s), [], 'nothing to look up, nothing run');
});

test('a session gets the one pull request its latest reply names, with its status, a sweep gets none, and a repeat ask runs gh no more', async () => {
  const { s, token } = await ready();
  state(s, {
    pulls: { [pr(1)]: raw(), [pr(2)]: raw({ isDraft: true, author: { login: 'hubot' }, reviewRequests: [{ login: 'octocat' }], reviewDecision: '', mergeStateStatus: 'BLOCKED' }) },
    threads: { [pr(1)]: [false, true, false] },
  });
  says(s, 'kid', `Opened ${pr(2)}.`);
  says(s, 'top', `Also ${pr(1)}, and https://github.com.evil.com/o/r/pull/9.`);
  says(s, 'gone', `Opened ${pr(3)} which GitHub does not know.`);
  says(s, 'quiet', `Compared ${pr(1)} and ${pr(2)}.`);
  const ids = 'kid,top,gone,quiet';
  const body = await pullsOf(s, token, ids);
  assert.equal(body.settling, false);
  assert.deepEqual(Object.keys(body.pulls), ['kid', 'top', 'gone', 'quiet']);
  assert.deepEqual(body.pulls.kid.map(p => p.url), [pr(2)]);
  assert.deepEqual(body.pulls.top.map(p => p.url), [pr(1)], 'a look-alike is never read');
  assert.deepEqual(body.pulls.gone, [], 'an address gh cannot show is left out');
  assert.deepEqual(body.pulls.quiet, [], 'two pull requests in one reply is a sweep, which has no main one');
  assert.deepEqual(body.pulls.top[0], {
    kind: 'pull', url: pr(1), title: 'Fix the thing', repo: 'example-org/example-repo', number: 1, state: 'open', mine: true, asked: false, requested: 0,
    review: 'approved', checks: 'passing', conflicts: false, clean: true, threads: 2,
  });
  assert.deepEqual([body.pulls.kid[0].state, body.pulls.kid[0].mine, body.pulls.kid[0].asked, body.pulls.kid[0].review, body.pulls.kid[0].threads], ['draft', false, true, 'none', 0]);
  const calls = ghCalls(s);
  const views = calls.filter(a => a[0] === 'pr');
  assert.deepEqual(views.map(a => a[2]).sort(), [pr(1), pr(2), pr(3)], 'each address is read once');
  assert.deepEqual(calls.filter(a => a[1] === 'user'), [['api', 'user', '--jq', '.login', '--hostname', 'github.com']]);
  assert.equal(calls.some(a => a.includes('auth')), false);
  assert.deepEqual(await pullsOf(s, token, ids), body);
  assert.equal(ghCalls(s).length, calls.length, 'the second ask came from the cache');
});

test('a gh that fails, or is not there, gives a 200 with empty lists', async () => {
  for (const gh of [true, 'missing']) {
    const { s, token } = await ready(gh);
    state(s, { fail: true });
    says(s, 'kid', `Opened ${pr(1)}.`);
    const res = await get(s, token, '/api/pulls?ids=kid,quiet');
    assert.deepEqual([res.status, res.body()], [200, { pulls: { kid: [], quiet: [] }, settling: false }], String(gh));
  }
});

test('the session list says the server answers pull request status', async () => {
  const { s, token } = await ready();
  const res = await get(s, token, '/api/sessions');
  assert.equal(res.body().features.pullStatus, true);
});
