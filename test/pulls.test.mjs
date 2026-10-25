// Run with `npm test`. The pull requests a session works on: how a pull request is summarised from gh's JSON, which addresses a transcript
// names and in what order, and how lookups are cached, shared, limited and kept to fixed gh argument lists. No gh is run and no network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPullUrl } from '../public/ui/pull-url.js';
import { makePulls, summarise } from '../lib/pulls.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-pulls-'));
const pr = n => `https://github.com/example-org/example-repo/pull/${n}`;
const FIELDS = 'state,isDraft,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,latestReviews,reviewRequests,author';
const QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}';

const raw = (extra = {}) => ({
  url: pr(12), state: 'OPEN', isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
  statusCheckRollup: [], latestReviews: [], reviewRequests: [], author: { login: 'someone' }, ...extra,
});
const run = (conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', status, conclusion });
const context = state => ({ __typename: 'StatusContext', state });

test('state is open, draft, merged or closed from what gh says', () => {
  const state = extra => summarise(raw(extra), [], 'octocat').state;
  assert.equal(state({}), 'open');
  assert.equal(state({ isDraft: true }), 'draft');
  assert.equal(state({ state: 'MERGED' }), 'merged');
  assert.equal(state({ state: 'MERGED', isDraft: true }), 'merged');
  assert.equal(state({ state: 'CLOSED' }), 'closed');
  assert.equal(state({ state: 'CLOSED', isDraft: true }), 'closed');
});

test('a pull request is named by its repo and number', () => {
  const got = summarise(raw({ url: pr(7) }), null, 'octocat');
  assert.deepEqual([got.url, got.repo, got.number], [pr(7), 'example-org/example-repo', 7]);
});

test('mine is the viewer being the author, asked is the viewer being asked to review, and a team request is not the viewer', () => {
  const requests = [{ __typename: 'User', login: 'Octocat' }, { __typename: 'Team', name: 'Core', slug: 'core' }, { __typename: 'User', login: 'hubot' }];
  const asked = summarise(raw({ reviewRequests: requests }), [], 'octocat');
  assert.deepEqual([asked.mine, asked.asked, asked.requested], [false, true, 3]);
  const mine = summarise(raw({ author: { login: 'OCTOCAT' }, reviewRequests: requests }), [], 'octocat');
  assert.deepEqual([mine.mine, mine.asked, mine.requested], [true, false, 3], 'the author is never asked');
  const teamOnly = summarise(raw({ reviewRequests: [{ __typename: 'Team', name: 'Core', slug: 'core' }] }), [], 'octocat');
  assert.deepEqual([teamOnly.mine, teamOnly.asked, teamOnly.requested], [false, false, 1]);
  const unknown = summarise(raw({ reviewRequests: requests, author: { login: 'octocat' } }), [], null);
  assert.deepEqual([unknown.mine, unknown.asked], [false, false], 'with no viewer both are false');
  assert.deepEqual([summarise(raw(), [], 'octocat').requested, summarise(raw({ reviewRequests: undefined }), [], 'octocat').requested], [0, 0]);
});

test('review follows the review decision, and with none falls back to the latest reviews, ignoring dismissed ones', () => {
  const review = extra => summarise(raw(extra), [], 'octocat').review;
  assert.equal(review({ reviewDecision: 'APPROVED' }), 'approved');
  assert.equal(review({ reviewDecision: 'CHANGES_REQUESTED' }), 'changes');
  assert.equal(review({ reviewDecision: 'REVIEW_REQUIRED' }), 'required');
  assert.equal(review({ reviewDecision: 'APPROVED', latestReviews: [{ state: 'CHANGES_REQUESTED' }] }), 'approved', 'the decision wins');
  assert.equal(review({}), 'none');
  assert.equal(review({ latestReviews: [{ state: 'APPROVED' }] }), 'approved');
  assert.equal(review({ latestReviews: [{ state: 'APPROVED' }, { state: 'CHANGES_REQUESTED' }] }), 'changes');
  assert.equal(review({ latestReviews: [{ state: 'COMMENTED' }, { state: 'DISMISSED' }] }), 'none');
  assert.equal(review({ latestReviews: [{ state: 'DISMISSED' }, { state: 'APPROVED' }] }), 'approved');
  assert.equal(review({ latestReviews: [{ state: 'DISMISSED' }] }), 'none');
  assert.equal(review({ reviewDecision: null, latestReviews: null }), 'none');
});

test('checks fail if any check failed, else run if any is unfinished, else pass if one passed, and skipped kinds say nothing', () => {
  const checks = rollup => summarise(raw({ statusCheckRollup: rollup }), [], 'octocat').checks;
  assert.equal(checks([]), 'none');
  assert.equal(checks(undefined), 'none');
  assert.equal(checks([run('SUCCESS')]), 'passing');
  assert.equal(checks([run('SUCCESS'), context('SUCCESS')]), 'passing');
  for (const conclusion of ['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED']) assert.equal(checks([run('SUCCESS'), run(conclusion)]), 'failing', conclusion);
  for (const state of ['FAILURE', 'ERROR']) assert.equal(checks([run('SUCCESS'), context(state)]), 'failing', state);
  assert.equal(checks([run('', 'IN_PROGRESS')]), 'running');
  assert.equal(checks([run('', 'QUEUED'), run('SUCCESS')]), 'running');
  assert.equal(checks([run(null, 'WAITING')]), 'running');
  assert.equal(checks([context('PENDING'), run('SUCCESS')]), 'running');
  assert.equal(checks([context('EXPECTED')]), 'running');
  assert.equal(checks([run('', 'IN_PROGRESS'), run('FAILURE')]), 'failing', 'failing wins over running');
  assert.equal(checks([context('PENDING'), context('FAILURE')]), 'failing');
  for (const conclusion of ['SKIPPED', 'NEUTRAL', 'CANCELLED', 'STALE']) {
    assert.equal(checks([run(conclusion)]), 'none', conclusion);
    assert.equal(checks([run(conclusion), run('SUCCESS')]), 'passing', conclusion);
  }
  assert.equal(checks([{ status: 'COMPLETED', conclusion: 'success' }]), 'passing', 'case does not matter');
  assert.equal(checks([{ state: 'SUCCESS' }]), 'passing', 'a status context without a type is read by its state');
});

test('conflicts, clean and threads come from the mergeable fields and the thread nodes', () => {
  const got = (extra, nodes) => summarise(raw(extra), nodes, 'octocat');
  assert.deepEqual([got({ mergeable: 'CONFLICTING' }, []).conflicts, got({ mergeable: 'MERGEABLE' }, []).conflicts, got({ mergeable: 'UNKNOWN' }, []).conflicts], [true, false, false]);
  assert.deepEqual([got({ mergeStateStatus: 'CLEAN' }, []).clean, got({ mergeStateStatus: 'BLOCKED' }, []).clean, got({ mergeStateStatus: 'DIRTY' }, []).clean], [true, false, false]);
  assert.equal(got({}, [{ isResolved: false }, { isResolved: true }, { isResolved: false }]).threads, 2);
  assert.equal(got({}, []).threads, 0);
  assert.equal(got({}, null).threads, null);
  assert.equal(got({}, undefined).threads, null);
});

test('a pull request has exactly the fields the page is promised', () => {
  assert.deepEqual(Object.keys(summarise(raw(), [], 'octocat')).sort(),
    ['asked', 'checks', 'clean', 'conflicts', 'mine', 'number', 'repo', 'requested', 'review', 'state', 'threads', 'url']);
});

// ---- which addresses a transcript names -------------------------------------------------------------------------------------------

const files = new Map();
const transcriptFor = id => files.get(id) ?? null;
const prompt = text => ({ type: 'user', message: { role: 'user', content: text } });
let sent = 0;
// A fixed width id, so two files of the same words are the same size, which a test of the kept answers relies on.
const said = text => ({ type: 'assistant', message: { id: `m${String(++sent).padStart(8, '0')}`, role: 'assistant', content: [{ type: 'text', text }] } });
const gave = (id, output) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] } });
const lines = entries => entries.map(e => `${JSON.stringify(e)}\n`).join('');

function transcript(id, entries) {
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, lines(entries));
  fs.utimesSync(file, 1_700_000_000, 1_700_000_000);
  files.set(id, { id, file });
  return file;
}

const quiet = () => {
  const told = [];
  return { told, log: message => told.push(message) };
};

test('the addresses in the latest reply come first, then the rest newest first, whatever the source', () => {
  transcript('order', [
    prompt(`Please look at ${pr(1)}`),
    said(`I opened ${pr(2)} for it.`),
    gave('t1', `Creating pull request for feature into main\n\n${pr(3)}\n`),
    prompt(`And ${pr(4)} too.`),
    said(`Now ${pr(5)} and ${pr(6)}.`),
  ]);
  const { log } = quiet();
  const pulls = makePulls({ transcriptFor, log });
  assert.deepEqual(pulls.urlsFor('order'), [pr(5), pr(6), pr(4), pr(3), pr(2)], 'capped at five');
});

test('a reply that names none leaves the rest in newest first order, and an older reply does not jump the queue', () => {
  transcript('plain-reply', [
    said(`Old: ${pr(1)}`),
    prompt(`Mine: ${pr(2)}`),
    gave('t1', `${pr(3)}\n`),
    said('Nothing to link here.'),
  ]);
  assert.deepEqual(makePulls({ transcriptFor }).urlsFor('plain-reply'), [pr(3), pr(2), pr(1)]);
});

test('an address is listed once, at its first place in the order', () => {
  transcript('twice', [said(`${pr(1)} and ${pr(2)}`), prompt(pr(2)), said(`${pr(2)} then ${pr(3)} then ${pr(2)}`)]);
  assert.deepEqual(makePulls({ transcriptFor }).urlsFor('twice'), [pr(2), pr(3), pr(1)]);
});

test('a tool result counts only when its last line is one bare address, so a listing of pull requests claims nothing', () => {
  transcript('results', [
    gave('t1', `${pr(1)}\nsome trailing text`),
    gave('t2', `12\tFix the thing\tfix\t${pr(2)}`),
    gave('t3', [20, 21, 22].map(n => `#${n}  A title  ${pr(n)}`).join('\n')),
    gave('t4', [30, 31, 32].map(n => pr(n)).join('\n')),
    gave('t5', `see ${pr(4)}`),
    gave('t6', `https://github.com/example-org/example-repo/pull/5/files\n`),
    gave('t7', ''),
    gave('t8', `Warning: 2 uncommitted changes\n\n  ${pr(8)}  \n\n`),
  ]);
  assert.deepEqual(makePulls({ transcriptFor }).urlsFor('results'), [pr(8)]);
});

test('a prompt the owner typed counts, and a session with no addresses has none', () => {
  transcript('typed', [prompt(`review ${pr(9)} please`)]);
  transcript('empty', [prompt('hello'), said('hi')]);
  const pulls = makePulls({ transcriptFor });
  assert.deepEqual(pulls.urlsFor('typed'), [pr(9)]);
  assert.deepEqual(pulls.urlsFor('empty'), []);
});

test('an address read from a file of 2 MB or more is found only if it is in the last 2 MB', () => {
  const filler = Array.from({ length: 2300 }, () => ({ type: 'summary', summary: 'x'.repeat(1000) }));
  transcript('far', [said(pr(1)), ...filler]);
  transcript('near', [...filler, said(pr(2))]);
  const pulls = makePulls({ transcriptFor });
  assert.deepEqual([pulls.urlsFor('far'), pulls.urlsFor('near')], [[], [pr(2)]]);
});

test('an address is found in a long transcript past the first chunk', () => {
  const filler = Array.from({ length: 400 }, () => ({ type: 'summary', summary: 'x'.repeat(1000) }));
  transcript('deep', [prompt(pr(1)), ...filler, said('No links.')]);
  assert.deepEqual(makePulls({ transcriptFor }).urlsFor('deep'), [pr(1)]);
});

test('addresses are kept until the file changes, and read again once it does', () => {
  const file = transcript('kept', [said(`Is ${pr(11)}`)]);
  const pulls = makePulls({ transcriptFor });
  assert.deepEqual(pulls.urlsFor('kept'), [pr(11)]);
  fs.writeFileSync(file, lines([said(`Is ${pr(22)}`)]));
  fs.utimesSync(file, 1_700_000_000, 1_700_000_000);
  assert.deepEqual(pulls.urlsFor('kept'), [pr(11)], 'the same size and time is not read again');
  fs.appendFileSync(file, lines([said(`Now ${pr(33)}`)]));
  assert.deepEqual(pulls.urlsFor('kept'), [pr(33), pr(22)], 'an appended line is');
  const got = pulls.urlsFor('kept');
  got.push('x');
  assert.deepEqual(pulls.urlsFor('kept'), [pr(33), pr(22)], 'the kept list cannot be changed by a caller');
});

test('a session with no transcript, or one that cannot be read, has no addresses and never throws, and a problem is told once', () => {
  const { told, log } = quiet();
  files.set('gone', { id: 'gone', file: path.join(dir, 'gone.jsonl') });
  files.set('folder', { id: 'folder', file: dir });
  const pulls = makePulls({ transcriptFor, log });
  assert.deepEqual([pulls.urlsFor('nobody'), pulls.urlsFor('gone')], [[], []]);
  assert.deepEqual(told, []);
  assert.deepEqual([pulls.urlsFor('folder'), pulls.urlsFor('folder')], [[], []]);
  assert.equal(told.length, 1);
});

// ---- looking the pull requests up --------------------------------------------------------------------------------------------------

const GH = 'gh-for-the-test';

// What the fake gh answers: the viewer's login, and for each pull request a pr view and its review threads. `answer` is replaced to change them.
function fake(options = {}) {
  const calls = [];
  const answer = options.answer ?? ((file, args) => {
    if (args[0] === 'api' && args[1] === 'user') return `${options.login ?? 'octocat'}\n`;
    if (args[0] === 'pr') return JSON.stringify(raw({ state: 'OPEN', reviewRequests: [{ login: 'octocat' }] }));
    if (args[0] === 'api' && args[1] === 'graphql') return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] } } } } });
    throw new Error(`unexpected ${args.join(' ')}`);
  });
  const run = async (file, args) => {
    calls.push({ file, args });
    return answer(file, args);
  };
  const of = kind => calls.filter(c => (kind === 'view' ? c.args[0] === 'pr' : kind === 'threads' ? c.args[1] === 'graphql' : c.args[1] === 'user'));
  return { run, calls, of };
}

function maker(extra = {}) {
  const clock = { at: 1_000_000 };
  const out = quiet();
  const f = extra.fake ?? fake();
  const pulls = makePulls({ transcriptFor, gh: GH, run: f.run, now: () => clock.at, log: out.log, waitMs: 2000, ...extra.options });
  return { pulls, clock, f, told: out.told };
}

test('a lookup runs the three fixed gh calls, with the exact argument lists, and gives the summarised pull request', async () => {
  const { pulls, f } = maker();
  const { found, settling } = await pulls.lookup([pr(12)]);
  assert.equal(settling, false);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.of('view').map(c => c.args), [['pr', 'view', pr(12), '--json', FIELDS]]);
  assert.deepEqual(f.of('threads').map(c => c.args), [['api', 'graphql', '-f', `query=${QUERY}`, '-f', 'owner=example-org', '-f', 'name=example-repo', '-F', 'number=12', '--hostname', 'github.com']]);
  assert.deepEqual(f.of('user').map(c => c.args), [['api', 'user', '--jq', '.login', '--hostname', 'github.com']]);
  assert.deepEqual([...found.keys()], [pr(12)]);
  assert.deepEqual(found.get(pr(12)), {
    url: pr(12), repo: 'example-org/example-repo', number: 12, state: 'open', mine: false, asked: true, requested: 1,
    review: 'none', checks: 'none', conflicts: false, clean: false, threads: 1,
  });
});

test('every gh call is made on the configured command with an argument array, no address is passed that failed the check, and no auth command is run', async () => {
  const { pulls, f } = maker();
  await pulls.lookup([pr(1), pr(2), pr(3)]);
  assert.equal(f.calls.length, 7);
  for (const { file, args } of f.calls) {
    assert.equal(file, GH);
    assert.ok(Array.isArray(args) && args.every(a => typeof a === 'string'));
    assert.equal(args.includes('auth'), false);
    assert.equal(args.includes('token'), false);
    for (const a of args.filter(a => a.startsWith('http'))) assert.equal(isPullUrl(a), true, a);
  }
});

test('an address that is not the plain form is dropped before anything is run', async () => {
  const { pulls, f } = maker();
  const lookalikes = [
    'https://github.com.evil.com/o/r/pull/1', 'http://github.com/o/r/pull/1', 'https://github.com@evil.com/o/r/pull/1',
    `${pr(1)}/files`, `${pr(1)}\n--help`, '--web', 'gh pr list', '', null, undefined, 5, { toString: () => pr(1) },
  ];
  assert.deepEqual(await pulls.lookup(lookalikes), { found: new Map(), settling: false });
  assert.deepEqual(await pulls.lookup('not a list'), { found: new Map(), settling: false });
  assert.equal(f.calls.length, 0);
});

test('a second lookup inside the time to live runs nothing, and one after it runs the pull request calls again but not the login', async () => {
  const { pulls, clock, f } = maker();
  await pulls.lookup([pr(1)]);
  assert.equal(f.calls.length, 3);
  clock.at += 119_999;
  const again = await pulls.lookup([pr(1)]);
  assert.equal(f.calls.length, 3);
  assert.equal(again.found.size, 1);
  clock.at += 2;
  await pulls.lookup([pr(1)]);
  assert.equal(f.calls.length, 5);
  assert.equal(f.of('user').length, 1);
});

test('the login is asked for once an hour, and shared by lookups that start together', async () => {
  const { pulls, clock, f } = maker();
  await Promise.all([pulls.lookup([pr(1)]), pulls.lookup([pr(2)]), pulls.lookup([pr(3)])]);
  assert.equal(f.of('user').length, 1);
  clock.at += 3_599_000;
  await pulls.lookup([pr(4)]);
  assert.equal(f.of('user').length, 1);
  clock.at += 2_000;
  await pulls.lookup([pr(5)]);
  assert.equal(f.of('user').length, 2);
});

test('a login that cannot be found still gives pull requests, with mine and asked false, and is told once and tried again after the failure time', async () => {
  const base = fake();
  const f = { ...base, run: async (file, args) => {
    if (args[1] !== 'user') return base.run(file, args);
    base.calls.push({ file, args });
    throw Object.assign(new Error('Command failed: gh api user'), { stderr: 'not logged in\nmore\n' });
  } };
  const { pulls, clock, told } = maker({ fake: f });
  const { found } = await pulls.lookup([pr(1)]);
  assert.deepEqual([found.get(pr(1)).mine, found.get(pr(1)).asked], [false, false]);
  clock.at += 61_000;
  await pulls.lookup([pr(2)]);
  assert.equal(base.of('user').length, 2);
  assert.deepEqual(told, ['Could not find the GitHub login: not logged in']);
});

test('lookups for one address that overlap share one set of calls', async () => {
  const { pulls, f } = maker();
  const [a, b, c] = await Promise.all([pulls.lookup([pr(1)]), pulls.lookup([pr(1), pr(1)]), pulls.lookup([pr(1)])]);
  assert.equal(f.of('view').length, 1);
  assert.equal(f.of('threads').length, 1);
  assert.deepEqual([a.found.size, b.found.size, c.found.size], [1, 1, 1]);
});

// A fake gh whose calls wait until they are let go, to see how many run at once.
function gated() {
  const held = [];
  const base = fake();
  const seen = { active: 0, peak: 0 };
  const run = (file, args) => {
    base.calls.push({ file, args });
    seen.active++;
    seen.peak = Math.max(seen.peak, seen.active);
    return new Promise(resolve => held.push(() => {
      seen.active--;
      resolve(args[1] === 'user' ? 'octocat' : args[0] === 'pr' ? JSON.stringify(raw()) : JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }));
    }));
  };
  const release = () => held.splice(0).forEach(go => go());
  return { ...base, run, seen, release, held };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
async function drive(promise, g) {
  let done = false;
  promise.then(() => { done = true; });
  while (!done) {
    g.release();
    await turn();
  }
  return promise;
}

test('at most four gh calls run at once across every lookup', async () => {
  const g = gated();
  const { pulls } = maker({ fake: g, options: { waitMs: 5000 } });
  const urls = [1, 2, 3, 4, 5, 6, 7, 8].map(pr);
  const got = await drive(Promise.all([pulls.lookup(urls.slice(0, 4)), pulls.lookup(urls.slice(4))]), g);
  assert.equal(g.seen.peak, 4);
  assert.deepEqual(got.map(x => x.found.size), [4, 4]);
  assert.equal(g.calls.length, 8 * 2 + 1);
});

test('the number of calls at once follows the slots given', async () => {
  const g = gated();
  const { pulls } = maker({ fake: g, options: { slots: 1, waitMs: 5000 } });
  await drive(pulls.lookup([1, 2, 3].map(pr)), g);
  assert.equal(g.seen.peak, 1);
});

test('lookups beyond the slots and the queue are skipped without being kept, and the answer says it is still settling', async () => {
  const g = gated();
  const { pulls } = maker({ fake: g, options: { slots: 1, queueMax: 1, waitMs: 150 } });
  const first = await pulls.lookup([pr(1), pr(2), pr(3)]);
  assert.deepEqual([first.found.size, first.settling], [0, true]);
  assert.equal(g.of('view').length, 1, 'only the first has started, the second waits for a slot, the third was skipped');
  await drive(pulls.lookup([pr(1), pr(2)]), g);
  const done = await drive(pulls.lookup([pr(1), pr(2), pr(3)]), g);
  assert.equal(done.settling, false, 'once there is room the skipped one is looked up');
  assert.deepEqual([...done.found.keys()].sort(), [pr(1), pr(2), pr(3)]);
});

test('a lookup waits no longer than the time given, and what was still going fills the cache for the next ask', async () => {
  const g = gated();
  const { pulls } = maker({ fake: g, options: { waitMs: 30 } });
  const late = await pulls.lookup([pr(1)]);
  assert.deepEqual([late.found.size, late.settling], [0, true]);
  const calls = g.calls.length;
  for (let i = 0; i < 10; i++) {
    g.release();
    await turn();
  }
  const next = await pulls.lookup([pr(1)]);
  assert.deepEqual([next.found.size, next.settling], [1, false]);
  assert.equal(g.calls.length, calls, 'the second ask used what the first left behind');
});

test('of several addresses, the ones that were ready in time are answered and the rest are left out', async () => {
  const base = fake();
  const held = [];
  const f = { ...base, run: (file, args) => {
    if (args[0] === 'pr' && args[2] === pr(2)) return new Promise(resolve => held.push(() => resolve(JSON.stringify(raw()))));
    return base.run(file, args);
  } };
  const { pulls } = maker({ fake: f, options: { waitMs: 30 } });
  const got = await pulls.lookup([pr(1), pr(2)]);
  assert.deepEqual([[...got.found.keys()], got.settling], [[pr(1)], true]);
  held.forEach(go => go());
});

test('an address that differs only in case is answered for each spelling, from one read', async () => {
  const { pulls, f } = maker();
  const upper = pr(7).replace('example-org', 'Example-Org');
  const { found } = await pulls.lookup([pr(7), upper]);
  assert.deepEqual([...found.keys()].sort(), [pr(7), upper].sort());
  assert.equal(found.get(upper), found.get(pr(7)));
  assert.equal(f.of('view').length, 1);
});

test('while an expired answer is read again, the last good answer is kept and the lookup says it is settling', async () => {
  const base = fake();
  const held = [];
  let slow = false;
  const f = { ...base, run: (file, args) => {
    if (slow && args[0] === 'pr') return new Promise(resolve => held.push(() => resolve(JSON.stringify(raw({ state: 'OPEN' })))));
    return base.run(file, args);
  } };
  const { pulls, clock } = maker({ fake: f, options: { waitMs: 30 } });
  assert.equal((await pulls.lookup([pr(1)])).found.size, 1);
  clock.at += 121_000;
  slow = true;
  const during = await pulls.lookup([pr(1)]);
  assert.deepEqual([[...during.found.keys()], during.settling], [[pr(1)], true]);
  held.forEach(go => go());
  await new Promise(resolve => setTimeout(resolve, 20));
  const after = await pulls.lookup([pr(1)]);
  assert.deepEqual([after.found.size, after.settling], [1, false]);
});

test('an expired answer left for the queue limit is still given, and the lookup says it is settling', async () => {
  const base = fake();
  const held = [];
  let slow = false;
  const f = { ...base, run: (file, args) => {
    if (slow && args[0] === 'pr' && args[2] === pr(2)) return new Promise(resolve => held.push(() => resolve(JSON.stringify(raw()))));
    return base.run(file, args);
  } };
  const { pulls, clock } = maker({ fake: f, options: { slots: 1, queueMax: 0, waitMs: 30 } });
  assert.equal((await pulls.lookup([pr(1)])).found.size, 1);
  clock.at += 121_000;
  slow = true;
  const got = await pulls.lookup([pr(2), pr(1)]);
  assert.deepEqual([[...got.found.keys()], got.settling], [[pr(1)], true]);
  held.forEach(go => go());
});

test('a pull request that gh cannot show is left out, told once with the first line of what gh said, and tried again after the failure time', async () => {
  let broken = true;
  const base = fake();
  const f = { ...base, run: async (file, args) => {
    if (broken && args[0] === 'pr') {
      base.calls.push({ file, args });
      throw Object.assign(new Error(`Command failed: ${file} ${args.join(' ')}`), { stderr: `\nGraphQL: Could not resolve to a PullRequest (${'x'.repeat(300)})\nsecond line\n`, code: 1 });
    }
    return base.run(file, args);
  } };
  const { pulls, clock, told } = maker({ fake: f });
  const first = await pulls.lookup([pr(1), pr(2)]);
  assert.deepEqual([first.found.size, first.settling], [0, false]);
  assert.equal(told.length, 2);
  assert.ok(told.every(t => t.length < 400 && !t.includes('second line') && !t.includes('--json') && !t.includes(GH)), told.join('\n'));
  assert.ok(told[0].startsWith(`Could not read ${pr(1)}: GraphQL: Could not resolve`));
  const views = base.calls.filter(c => c.args[0] === 'pr').length;
  clock.at += 59_000;
  await pulls.lookup([pr(1)]);
  assert.equal(base.calls.filter(c => c.args[0] === 'pr').length, views, 'a failure is kept for the failure time');
  clock.at += 2_000;
  await pulls.lookup([pr(1)]);
  assert.equal(base.calls.filter(c => c.args[0] === 'pr').length, views + 1);
  assert.equal(told.length, 2, 'still told once');
  broken = false;
  clock.at += 61_000;
  assert.equal((await pulls.lookup([pr(1)])).found.size, 1);
  broken = true;
  clock.at += 200_000;
  assert.equal((await pulls.lookup([pr(1)])).found.size, 0);
  assert.equal(told.length, 3, 'told again once it had worked and then failed');
});

test('a gh that is missing, times out, prints nonsense or throws at once gives no pull requests, and the lookup does not throw', async () => {
  const kinds = [
    () => { throw Object.assign(new Error(`spawn ${GH} ENOENT`), { code: 'ENOENT' }); },
    () => Promise.reject(Object.assign(new Error('Command failed: gh pr view'), { killed: true })),
    () => 'this is not json',
    () => { throw 'a string, not an error'; },
    () => Promise.reject(undefined),
  ];
  for (const kind of kinds) {
    const { pulls, told } = maker({ fake: fake({ answer: kind }) });
    const got = await pulls.lookup([pr(1)]);
    assert.deepEqual([got.found.size, got.settling], [0, false]);
    assert.equal(told.filter(t => t.startsWith(`Could not read ${pr(1)}`)).length, 1);
  }
});

test('a failed read of the review threads still gives the pull request, with threads null, and is told once', async () => {
  const base = fake();
  const f = { ...base, run: async (file, args) => {
    if (args[1] === 'graphql') {
      base.calls.push({ file, args });
      throw Object.assign(new Error('Command failed'), { stderr: 'rate limited\n' });
    }
    return base.run(file, args);
  } };
  const { pulls, clock, told } = maker({ fake: f });
  const got = await pulls.lookup([pr(1)]);
  assert.equal(got.found.get(pr(1)).threads, null);
  clock.at += 200_000;
  await pulls.lookup([pr(1)]);
  assert.deepEqual(told, [`Could not read the review threads of ${pr(1)}: rate limited`]);
});

test('a thread answer with no nodes is a failed read of the threads', async () => {
  const base = fake();
  const f = { ...base, run: async (file, args) => (args[1] === 'graphql' ? (base.calls.push({ file, args }), JSON.stringify({ data: { repository: null }, errors: [{}] })) : base.run(file, args)) };
  const { pulls } = maker({ fake: f });
  assert.equal((await pulls.lookup([pr(1)])).found.get(pr(1)).threads, null);
});
