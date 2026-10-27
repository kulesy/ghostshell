// Run with `npm test`. The route that answers the pull requests each session works on, over HTTP against the real server and a fake gh that never
// leaves the machine.
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
const is = n => `https://github.com/example-org/example-repo/issues/${n}`;

const get = (s, token, route) => request(s, 'GET', route, { headers: as(token) });
const pullsOf = async (s, token, ids) => (await get(s, token, `/api/pulls?ids=${ids}`)).body();

async function ready(gh = true) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, gh });
  return { s, ...(await signIn(s)) };
}

const says = (s, id, text) => fs.appendFileSync(path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`),
  `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}-${Math.random()}`, role: 'assistant', content: [{ type: 'text', text }] } })}\n`);

const raw = (extra = {}) => ({
  title: 'Fix the thing', state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }], latestReviews: [],
  reviewRequests: [], author: { login: 'octocat' }, ...extra,
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
    url: pr(1), kind: 'pull', repo: 'example-org/example-repo', number: 1, title: 'Fix the thing', state: 'open', mine: true, asked: false, requested: 0,
    review: 'approved', checks: 'passing', conflicts: false, clean: true, threads: 2, attached: false,
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
  assert.equal(res.body().features.attachLinks, true);
});

// ---- attaching pull requests and issues ----------------------------------------------------------------------------------------

const ISSUE = (extra = {}) => ({ title: 'Something is broken', state: 'OPEN', stateReason: '', ...extra });
const attach = (s, token, body, headers = {}) => request(s, 'POST', '/api/links', { headers: { ...as(token), ...headers }, json: body });
const linksFile = s => path.join(s.state, 'links.json');
const saved = s => JSON.parse(fs.readFileSync(linksFile(s), 'utf8'));
const listOf = async (s, token, id) => (await pullsOf(s, token, id)).pulls[id].map(i => [i.url, i.kind, i.state, i.attached]);
const created = (s, id, output) => fs.appendFileSync(path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`),
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t-${Math.random()}`, content: output }] } })}\n`);

test('the links route is a signed-in, same-origin write for one real session with a JSON body, and it refuses a group\'s session', async () => {
  const { s, token } = await ready();
  const ok = { id: 'top', url: pr(1), attached: true };
  assert.equal((await request(s, 'POST', '/api/links', { json: ok })).status, 401);
  assert.equal((await request(s, 'GET', '/api/links', { headers: as(token) })).status, 404);
  const cross = await attach(s, token, ok, { origin: 'https://evil.example' });
  assert.deepEqual([cross.status, cross.body()], [403, { error: 'Cross-site request refused.' }]);
  const bad = await request(s, 'POST', '/api/links', { headers: { ...as(token), 'content-type': 'application/json' } });
  assert.equal(bad.status, 400, 'a body with nothing in it names no session');
  const cases = [
    [{ ...ok, id: undefined }, 400, 'Which session?'],
    [{ ...ok, id: '../top' }, 400, 'Which session?'],
    [{ ...ok, id: 'nobody' }, 404, 'No session with that id on this Mac.'],
    [{ ...ok, id: WORK }, 400, 'A group\'s session stays with its group.'],
    [{ ...ok, url: 'https://github.com/example-org/example-repo' }, 400, 'Paste the address of a GitHub pull request or issue.'],
    [{ ...ok, url: 'https://github.com.evil.com/o/r/pull/1' }, 400, 'Paste the address of a GitHub pull request or issue.'],
    [{ ...ok, url: 5 }, 400, 'Paste the address of a GitHub pull request or issue.'],
    [{ ...ok, attached: 'yes' }, 400, 'Attach it or remove it?'],
    [{ id: 'top', url: pr(1) }, 400, 'Attach it or remove it?'],
  ];
  for (const [body, status, error] of cases) {
    const res = await attach(s, token, body);
    assert.deepEqual([res.status, res.body()], [status, { error }], JSON.stringify(body));
  }
  assert.equal(fs.existsSync(linksFile(s)), false, 'nothing was written');
});

test('an added pull request or issue comes back after the found ones, in the order added, with its status and attached true, and its tail is cut off', async () => {
  const { s, token } = await ready();
  state(s, { pulls: { [pr(1)]: raw(), [pr(2)]: raw({ isDraft: true }) }, issues: { [is(5)]: ISSUE(), [is(6)]: ISSUE({ state: 'CLOSED', stateReason: 'NOT_PLANNED' }) }, threads: {} });
  says(s, 'kid', `Opened ${pr(1)}.`);
  assert.deepEqual(await listOf(s, token, 'kid'), [[pr(1), 'pull', 'open', false]]);
  const added = [`${is(5)}#issuecomment-77`, `${pr(2)}/files`, `${is(6)}?x=1`];
  for (const url of added) assert.deepEqual((await attach(s, token, { id: 'kid', url, attached: true })).body(), { id: 'kid' });
  assert.deepEqual(await listOf(s, token, 'kid'), [[pr(1), 'pull', 'open', false], [is(5), 'issue', 'open', true], [pr(2), 'pull', 'draft', true], [is(6), 'issue', 'not_planned', true]]);
  assert.deepEqual(saved(s), { kid: { added: [is(5), pr(2), is(6)], hidden: [] } });
  const issue = (await pullsOf(s, token, 'kid')).pulls.kid[1];
  assert.deepEqual(issue, { url: is(5), kind: 'issue', repo: 'example-org/example-repo', number: 5, title: 'Something is broken', state: 'open', attached: true });
  await attach(s, token, { id: 'kid', url: is(5).toUpperCase().replace('HTTPS://GITHUB.COM', 'https://github.com'), attached: true });
  await attach(s, token, { id: 'kid', url: pr(1), attached: true });
  assert.deepEqual(saved(s).kid.added, [is(5), pr(2), is(6)], 'the same address again, in any case, or one already found, adds nothing');
  assert.deepEqual((await listOf(s, token, 'top')), [], 'another session is not touched');
});

test('removing an added item drops it, and an item gh cannot read stays visible as unknown until it is removed', async () => {
  const { s, token } = await ready();
  state(s, { pulls: {}, issues: { [is(5)]: ISSUE() }, threads: {} });
  await attach(s, token, { id: 'kid', url: is(5), attached: true });
  await attach(s, token, { id: 'kid', url: is(404), attached: true });
  await attach(s, token, { id: 'kid', url: pr(404), attached: true });
  assert.deepEqual(await listOf(s, token, 'kid'), [[is(5), 'issue', 'open', true], [is(404), 'issue', 'unknown', true], [pr(404), 'pull', 'unknown', true]]);
  const unknown = (await pullsOf(s, token, 'kid')).pulls.kid[1];
  assert.deepEqual(unknown, { url: is(404), kind: 'issue', repo: 'example-org/example-repo', number: 404, state: 'unknown', attached: true });
  await attach(s, token, { id: 'kid', url: is(404), attached: false });
  await attach(s, token, { id: 'kid', url: is(5), attached: false });
  assert.deepEqual(await listOf(s, token, 'kid'), [[pr(404), 'pull', 'unknown', true]]);
  await attach(s, token, { id: 'kid', url: pr(404), attached: false });
  assert.deepEqual(saved(s), {}, 'a session with nothing left has no entry');
  assert.deepEqual((await attach(s, token, { id: 'kid', url: is(9), attached: false })).status, 200, 'removing what is not there is not an error');
});

test('removing a found item hides it for good, adding it again shows it, and a hidden pull request lets no other take its place', async () => {
  const { s, token } = await ready();
  state(s, { pulls: { [pr(1)]: raw(), [pr(2)]: raw() }, issues: { [is(5)]: ISSUE(), [is(6)]: ISSUE(), [is(7)]: ISSUE() }, threads: {} });
  says(s, 'kid', `Opened ${pr(1)}.`);
  created(s, 'kid', `Creating issue\n\n${is(5)}\n`);
  created(s, 'kid', is(6));
  assert.deepEqual(await listOf(s, token, 'kid'), [[pr(1), 'pull', 'open', false], [is(5), 'issue', 'open', false], [is(6), 'issue', 'open', false]]);
  await attach(s, token, { id: 'kid', url: is(5), attached: false });
  await attach(s, token, { id: 'kid', url: pr(1), attached: false });
  assert.deepEqual(saved(s), { kid: { added: [], hidden: [is(5), pr(1)] } });
  assert.deepEqual(await listOf(s, token, 'kid'), [[is(6), 'issue', 'open', false]]);
  says(s, 'kid', `And ${pr(1)} again.`);
  created(s, 'kid', is(7));
  assert.deepEqual((await listOf(s, token, 'kid')).map(i => i[0]), [is(6), is(7)], 'a hidden item stays hidden after the scan runs again');
  await attach(s, token, { id: 'kid', url: is(5), attached: true });
  assert.deepEqual(saved(s), { kid: { added: [], hidden: [pr(1)] } }, 'unhiding adds nothing to the added items');
  assert.deepEqual((await listOf(s, token, 'kid')).map(i => [i[0], i[3]]), [[is(5), false], [is(6), false], [is(7), false]]);
});

test('the issues a session made or edited are found, the newest 3 of them, and one it only mentions is not', async () => {
  const { s, token } = await ready();
  const issues = Object.fromEntries([1, 2, 3, 4, 5].map(n => [is(n), ISSUE({ title: `Issue ${n}` })]));
  state(s, { pulls: {}, issues, threads: {} });
  says(s, 'quiet', `Please look at ${is(5)} and ${is(4)}.`);
  for (const n of [1, 2, 3, 4]) created(s, 'quiet', `${is(n)}\n`);
  assert.deepEqual((await listOf(s, token, 'quiet')).map(i => i[0]), [is(2), is(3), is(4)]);
  created(s, 'quiet', `${is(2)}\n`);
  assert.deepEqual((await listOf(s, token, 'quiet')).map(i => i[0]), [is(3), is(4), is(2)], 'an issue edited again is the newest');
});

test('a session holds at most 20 added items, and removing one makes room', async () => {
  const { s, token } = await ready();
  for (let n = 1; n <= 20; n++) assert.equal((await attach(s, token, { id: 'kid', url: is(n), attached: true })).status, 200, String(n));
  const over = await attach(s, token, { id: 'kid', url: is(21), attached: true });
  assert.deepEqual([over.status, over.body()], [400, { error: 'A session holds at most 20 added items.' }]);
  assert.equal(saved(s).kid.added.length, 20);
  assert.equal((await attach(s, token, { id: 'kid', url: is(1), attached: true })).status, 200, 'one already there is not over the limit');
  assert.equal((await attach(s, token, { id: 'top', url: is(21), attached: true })).status, 200, 'the limit is per session');
  await attach(s, token, { id: 'kid', url: is(3), attached: false });
  assert.equal((await attach(s, token, { id: 'kid', url: is(21), attached: true })).status, 200);
});

test('links.json is read again on every write, so a session\'s change keeps the others\' and an edited file cannot put a bad address on the page', async () => {
  const { s, token } = await ready();
  await attach(s, token, { id: 'kid', url: is(1), attached: true });
  fs.writeFileSync(linksFile(s), JSON.stringify({ ...saved(s), top: { added: [is(2), 'https://evil.example/x', 'javascript:alert(1)', 5, is(2).toUpperCase().replace('HTTPS://GITHUB.COM', 'https://github.com')], hidden: 'nope' }, quiet: 'broken' }));
  await attach(s, token, { id: 'kid', url: is(3), attached: true });
  assert.deepEqual(saved(s).top.added, [is(2), 'https://evil.example/x', 'javascript:alert(1)', 5, is(2).toUpperCase().replace('HTTPS://GITHUB.COM', 'https://github.com')], 'another session\'s entry is left as it was');
  assert.deepEqual(saved(s).kid.added, [is(1), is(3)]);
  const list = await listOf(s, token, 'top');
  assert.deepEqual(list.map(i => i[0]), [is(2)], 'only a plain address is listed, once');
  assert.deepEqual(await listOf(s, token, 'quiet'), []);
  fs.writeFileSync(linksFile(s), 'not json');
  assert.deepEqual(await listOf(s, token, 'kid'), []);
  await attach(s, token, { id: 'kid', url: is(4), attached: true });
  assert.deepEqual(saved(s), { kid: { added: [is(4)], hidden: [] } }, 'a broken file is replaced by the next write');
});
