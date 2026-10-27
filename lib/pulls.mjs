// The GitHub pull requests a session is working on, found in its transcript, and their live status from the `gh` CLI. GhostShell never reads
// or sends a GitHub token itself: `gh` holds the sign-in, and only fixed argument lists are run, never a shell.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { completeEnd, readBefore } from './transcripts.mjs';
import { isIssueUrl, isPullUrl, ISSUE_URL, PULL_URL, pullUrlsIn } from '../public/ui/pull-url.js';

const FIRST_CHUNK = 64 * 1024;
const READ_LIMIT = 2 * 1024 * 1024;
const VIEWER_TTL_MS = 60 * 60_000;
const KEPT = 500;
const REASON_CHARS = 200;
const TITLE_CHARS = 300;
const HOST = 'github.com';

const FIELDS = 'state,isDraft,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,latestReviews,reviewRequests,author,title';
const ISSUE_FIELDS = 'title,state,stateReason';
const THREADS_QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}';

// The environment gh sees, without the variables that move it to another host or repository or make it print what it sends.
function environment() {
  const { GH_HOST, GH_REPO, GH_DEBUG, ...rest } = process.env;
  return rest;
}

export const defaultRun = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...environment(), GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', GH_PAGER: 'cat' },
  }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
});

const clip = (text, max) => (text.length > max ? text.slice(0, max) : text);
const firstLine = text => String(text ?? '').split('\n').map(line => line.trim()).find(Boolean) ?? '';
const titleOf = raw => clip(String(raw ?? '').replace(/\s+/g, ' ').trim(), TITLE_CHARS);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const upper = value => (typeof value === 'string' ? value.toUpperCase() : '');

// Why a `gh` call failed, in a line that carries no command line, output or environment.
function reasonOf(err) {
  const said = firstLine(err?.stderr)
    || (err?.code === 'ENOENT' ? 'gh was not found' : err?.killed ? 'gh timed out' : /^Command failed/.test(err?.message ?? '') ? `gh exited with ${err.code}` : firstLine(err?.message));
  return clip(said || 'unknown error', REASON_CHARS);
}

const REVIEWS = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' };
const STATES = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };
const BROKEN = new Set(['FAILURE', 'TIMED_OUT', 'ERROR', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);

function reviewOf(raw) {
  const decided = REVIEWS[upper(raw.reviewDecision)];
  if (decided) return decided;
  const states = (Array.isArray(raw.latestReviews) ? raw.latestReviews : []).map(r => upper(r?.state));
  return states.includes('CHANGES_REQUESTED') ? 'changes' : states.includes('APPROVED') ? 'approved' : 'none';
}

// A check run has `status` and `conclusion`, a status context has `state`. Failing wins over running, and a check that was skipped,
// cancelled, neutral or stale says nothing either way.
function checksOf(rollup) {
  let running = false;
  let passed = 0;
  for (const c of Array.isArray(rollup) ? rollup : []) {
    const context = c?.__typename === 'StatusContext' || (c?.status === undefined && c?.state !== undefined);
    const outcome = context ? upper(c.state) : upper(c?.conclusion);
    if (BROKEN.has(outcome)) return 'failing';
    if (context ? outcome === 'PENDING' || outcome === 'EXPECTED' : upper(c?.status) !== 'COMPLETED') running = true;
    else if (outcome === 'SUCCESS') passed++;
  }
  return running ? 'running' : passed ? 'passing' : 'none';
}

// A pull request as the page shows it, from `gh pr view --json` and the review threads (null when they could not be read).
// `mine` and `asked` are null when the viewer's login is unknown, so nothing is read as "not yours".
export function summarise(raw, threadNodes, viewer) {
  const [, owner, name, number] = PULL_URL.exec(raw.url ?? '') ?? [];
  const requests = Array.isArray(raw.reviewRequests) ? raw.reviewRequests : [];
  const known = typeof viewer === 'string' && viewer !== '';
  const mine = known ? same(raw.author?.login, viewer) : null;
  const state = STATES[upper(raw.state)] ?? 'closed';
  return {
    kind: 'pull',
    url: raw.url,
    title: titleOf(raw.title),
    repo: `${owner}/${name}`,
    number: Number(number),
    state: state === 'open' && raw.isDraft ? 'draft' : state,
    mine,
    asked: known ? !mine && requests.some(r => same(r?.login, viewer)) : null,
    requested: requests.length,
    review: reviewOf(raw),
    checks: checksOf(raw.statusCheckRollup),
    conflicts: raw.mergeable === 'CONFLICTING',
    clean: raw.mergeStateStatus === 'CLEAN',
    threads: Array.isArray(threadNodes) ? threadNodes.filter(n => n?.isResolved === false).length : null,
  };
}

const REASONS = { COMPLETED: 'completed', NOT_PLANNED: 'not_planned', DUPLICATE: 'duplicate' };

// An issue as the page shows it, from `gh issue view --json`, or null when gh did not say open or closed. gh answers MERGED for a pull request
// opened through an issues address, and that is not an issue. A closed issue with no reason, as the oldest are, counts as completed.
export function summariseIssue(raw) {
  const [, owner, name, number] = ISSUE_URL.exec(raw.url ?? '') ?? [];
  const state = upper(raw.state);
  if (state !== 'OPEN' && state !== 'CLOSED') return null;
  return {
    kind: 'issue',
    url: raw.url,
    title: titleOf(raw.title),
    repo: `${owner}/${name}`,
    number: Number(number),
    state: state === 'OPEN' ? 'open' : 'closed',
    reason: state === 'OPEN' ? null : REASONS[upper(raw.stateReason)] ?? 'completed',
  };
}

// Pull request addresses in the transcript item, in the order they appear. A tool result counts only when its last line is one bare address,
// as `gh pr create` prints, so a listing of pull requests does not make the session claim them all.
function urlsOfItem(item) {
  if (item.kind === 'assistant' || item.kind === 'user') return pullUrlsIn(item.text);
  if (item.kind !== 'result' || typeof item.output !== 'string') return [];
  const last = item.output.split('\n').map(line => line.trim()).findLast(Boolean);
  return isPullUrl(last) && pullUrlsIn(item.output).length === 1 ? [last] : [];
}

const unique = urls => {
  const seen = new Set();
  return urls.filter(url => !seen.has(url.toLowerCase()) && seen.add(url.toLowerCase()));
};

// The session's main pull request: the one address in the newest item that names any. An item that names several is a sweep, so there is none.
// The file is read backwards from its last whole line in chunks that double, to the read limit, and no further once an item decides.
function scan(t, cwd) {
  const end = completeEnd(t, READ_LIMIT);
  const floor = Math.max(0, end - READ_LIMIT);
  let start = end;
  for (let chunk = FIRST_CHUNK; start > floor; chunk *= 2) {
    const got = readBefore(t, start, chunk, cwd, Infinity, undefined, floor);
    for (const item of got.items.reverse()) {
      const urls = unique(urlsOfItem(item));
      if (urls.length) return urls.length === 1 ? urls : [];
    }
    start = got.start;
  }
  return [];
}

// `transcriptFor(id)` gives a session's transcript. `run(file, args)` gives the output of one `gh` call, and is replaced in tests.
// At most `slots` calls run at once. A lookup that would be beyond `slots` running and `queueMax` waiting is skipped, and left to the next ask.
export function makePulls({ transcriptFor, gh = 'gh', run = defaultRun, now = Date.now, ttlMs = 120_000, failTtlMs = 60_000, slots = 4, queueMax = 40, waitMs = 8000, log = console.error }) {
  const told = new Set();
  const tell = message => {
    if (told.has(message)) return;
    told.add(message);
    log(message);
  };

  const kept = new Map();
  function urlsFor(id, cwd = '') {
    try {
      const t = transcriptFor(id);
      if (!t) return [];
      const { size, mtimeMs } = fs.statSync(t.file);
      const known = kept.get(id);
      if (known?.file === t.file && known.size === size && known.mtimeMs === mtimeMs) return [...known.urls];
      const urls = scan(t, cwd);
      kept.delete(id);
      kept.set(id, { file: t.file, size, mtimeMs, urls });
      while (kept.size > KEPT) kept.delete(kept.keys().next().value);
      return [...urls];
    } catch (err) {
      if (err.code !== 'ENOENT') tell(`Could not look for pull requests in ${id}: ${reasonOf(err)}`);
      return [];
    }
  }

  let running = 0;
  const waiting = [];
  async function call(args) {
    if (running >= slots) await new Promise(resolve => waiting.push(resolve));
    else running++;
    try {
      return await run(gh, args);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  }

  let viewer = null;
  let viewerFailed = false;
  function viewerLogin() {
    if (viewer?.promise) return viewer.promise;
    if (viewer && now() < viewer.until) return Promise.resolve(viewer.login);
    const record = { login: null, until: 0, promise: null };
    viewer = record;
    // NOTE: [26 Oct 2026] EK - Ask for the login only. `gh auth token` and `gh auth status` can print the token, which must never be read or logged here.
    record.promise = call(['api', 'user', '--jq', '.login', '--hostname', HOST]).then(out => {
      const login = firstLine(out);
      if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(login)) throw new Error('gh gave no login');
      record.login = login;
      record.until = now() + VIEWER_TTL_MS;
      viewerFailed = false;
    }).catch(err => {
      record.until = now() + failTtlMs;
      if (!viewerFailed) log(`Could not find the GitHub login: ${reasonOf(err)}`);
      viewerFailed = true;
    }).then(() => {
      record.promise = null;
      return record.login;
    });
    return record.promise;
  }

  const failed = new Set();
  const threadsFailed = new Set();
  async function readPull(url) {
    const [, owner, name, number] = PULL_URL.exec(url);
    try {
      const [raw, nodes, who] = await Promise.all([
        call(['pr', 'view', url, '--json', FIELDS]).then(JSON.parse),
        // NOTE: [26 Oct 2026] EK - Send owner and name with -f, not -F: -F reads a value that starts with @ as a file.
        call(['api', 'graphql', '-f', `query=${THREADS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`, '--hostname', HOST])
          .then(out => {
            const nodes = JSON.parse(out)?.data?.repository?.pullRequest?.reviewThreads?.nodes;
            if (!Array.isArray(nodes)) throw new Error('gh gave no review threads');
            threadsFailed.delete(url);
            return nodes;
          })
          .catch(err => {
            if (!threadsFailed.has(url)) log(`Could not read the review threads of ${url}: ${reasonOf(err)}`);
            threadsFailed.add(url);
            return null;
          }),
        viewerLogin(),
      ]);
      const pull = summarise({ ...raw, url }, nodes, who);
      failed.delete(url);
      return pull;
    } catch (err) {
      if (!failed.has(url)) log(`Could not read ${url}: ${reasonOf(err)}`);
      failed.add(url);
      return null;
    }
  }

  async function readIssue(url) {
    try {
      const issue = summariseIssue({ ...JSON.parse(await call(['issue', 'view', url, '--json', ISSUE_FIELDS])), url });
      if (!issue) throw new Error('gh gave something that is not an open or closed issue');
      failed.delete(url);
      return issue;
    } catch (err) {
      if (!failed.has(url)) log(`Could not read ${url}: ${reasonOf(err)}`);
      failed.add(url);
      return null;
    }
  }

  const read = url => (isIssueUrl(url) ? readIssue(url) : readPull(url));

  // Each address has one record: the lookup in flight if there is one, and the answer (null for a failure) until `until`.
  const records = new Map();
  let inflight = 0;
  function fetchOne(url) {
    const known = records.get(url);
    if (known?.promise) return known.promise;
    if (known && now() < known.until) return Promise.resolve(known.pull);
    if (inflight >= slots + queueMax) return null;
    inflight++;
    const record = { promise: null, pull: null, until: 0, prior: known?.pull ?? null };
    records.delete(url);
    records.set(url, record);
    record.promise = read(url).then(pull => {
      record.pull = pull;
      record.prior = null;
      record.until = now() + (pull ? ttlMs : failTtlMs);
      record.promise = null;
      inflight--;
      return pull;
    });
    for (const [key, r] of records) {
      if (records.size <= KEPT) break;
      if (!r.promise) records.delete(key);
    }
    return record.promise;
  }

  // The last good answer for an address whose refresh is out or was left for the queue limit, so a card does not blink out while it refreshes.
  const stale = url => {
    const record = records.get(url);
    return record?.pull ?? record?.prior ?? null;
  };

  // The pull requests and issues for some addresses that have passed isPullUrl or isIssueUrl, waiting no longer than `waitMs`. What is not ready yet, or was left
  // for the queue limit, sets `settling` and is in `found` only as its last good answer. Lookups that are still going fill the cache for the next ask.
  async function lookup(urls) {
    const given = (Array.isArray(urls) ? urls : []).filter(url => isPullUrl(url) || isIssueUrl(url));
    const wanted = unique(given);
    const asked = [];
    const found = new Map();
    let settling = false;
    for (const url of wanted) {
      const task = fetchOne(url);
      if (!task) {
        settling = true;
        const last = stale(url);
        if (last) found.set(url, last);
        continue;
      }
      const entry = { url, done: false, pull: null };
      entry.promise = task.then(pull => {
        entry.done = true;
        entry.pull = pull;
      });
      asked.push(entry);
    }
    let timer;
    try {
      await Promise.race([Promise.all(asked.map(e => e.promise)), new Promise(resolve => { timer = setTimeout(resolve, waitMs); })]);
    } finally {
      clearTimeout(timer);
    }
    for (const e of asked) {
      if (e.done) {
        if (e.pull) found.set(e.url, e.pull);
        continue;
      }
      settling = true;
      const last = stale(e.url);
      if (last) found.set(e.url, last);
    }
    // An address that differs only in case is the same pull request or issue, and GitHub answers to either.
    const lowered = new Map([...found].map(([url, pull]) => [url.toLowerCase(), pull]));
    for (const url of given) if (!found.has(url) && lowered.has(url.toLowerCase())) found.set(url, lowered.get(url.toLowerCase()));
    return { found, settling };
  }

  return { urlsFor, lookup };
}
