// Merged changes waiting on origin/main, and updating the checkout GhostShell runs from. Git does the work in `root`; the restart is the
// existing helper (`npm run restart`), which waits for every chat to finish. See docs/adr/20261102-banners-for-sign-in-and-updates.md.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { guard } from './restart.mjs';

export const CHECK_EVERY_MS = 30 * 60_000;
export const MAX_WAIT_MINUTES = 30;
export const RESTART_NOTE_MS = 15_000;
export const REREAD_EVERY_MS = 60_000;
// The server looks this often for a moment to apply what a check found, and asks the helper to wait at most 5 minutes, which covers its two clear polls.
export const APPLY_EVERY_MS = 5000;
export const APPLY_WAIT_MINUTES = 5;
export const APPLY_UPTIME_S = 30 * 60;
const LISTED = 50;
const WINDOW_START = 7 * 60;
const WINDOW_END = 9 * 60 + 45;
export const QUIET_REASON = 'Restarts wait until 09:45 on weekdays.';
export const CHANGED_REASON = 'New changes arrived, so nothing ran. Check the banner and press again.';

const weekday = d => d.getDay() >= 1 && d.getDay() <= 5;

// Weekdays 07:00 to 09:45 in the server's time zone, when the owner is at the Mac and a restart would cut what they are doing.
export function inQuietWindow(at) {
  const minutes = at.getHours() * 60 + at.getMinutes();
  return weekday(at) && minutes >= WINDOW_START && minutes < WINDOW_END;
}

// Whole minutes a restart may wait without reaching the next 07:00 on a weekday, at most 30. Under 1 means no restart is safe now.
// A minute is kept back because the helper restarts a few seconds after its deadline when the chats go idle just before it.
export function waitMinutes(at) {
  for (let day = 0; day < 8; day++) {
    const start = new Date(at.getFullYear(), at.getMonth(), at.getDate() + day, 7, 0, 0, 0);
    if (weekday(start) && start > at) return Math.max(0, Math.min(MAX_WAIT_MINUTES, Math.floor((start - at - 60_000) / 60_000)));
  }
  return MAX_WAIT_MINUTES;
}

export const restartRefused = at => (inQuietWindow(at) || waitMinutes(at) < 1 ? QUIET_REASON : '');

// "Title (#34)" is a squash merge's subject. Anything else keeps its whole subject.
export function parseSubject(subject, repo) {
  const m = /^(.*\S)\s+\(#(\d+)\)$/.exec(subject);
  return m ? { title: m[1], url: repo ? `${repo}/pull/${m[2]}` : null } : { title: subject, url: null };
}

// https://github.com/owner/name for a GitHub remote in the ssh or https form, or null for any other host.
export function repoUrl(remote) {
  const m = /^(?:git@github\.com:|(?:https?|ssh):\/\/(?:[^@/]+@)?github\.com[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(remote).trim());
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

// Files the server loads once and keeps, so a change to one needs a restart. The page files it does not import load from disk on each request.
export const needsRestart = (file, imported) => file === 'server.mjs' || file === 'package.json' || file === 'config.json' || file.startsWith('lib/') || imported.has(file);

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;

// Every file the server at `commit` loads by relative import, found by following the specifiers from server.mjs through git, so a file
// since deleted or renamed is still counted.
export async function importedAt(show, commit) {
  const seen = new Set();
  const queue = ['server.mjs'];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let source;
    // Without server.mjs nothing is known, and a partial set would let a server change through as page only.
    try { source = await show(commit, file); } catch (e) { if (file === 'server.mjs') throw e; continue; }
    for (const [, spec] of source.matchAll(SPECIFIER)) {
      const next = path.posix.join(path.posix.dirname(file), spec);
      if (/\.m?js$/.test(next) && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

const run = (root, args, timeout) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd: root, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

// Runs `npm run restart` from the npm that sits beside this node, with that folder first on PATH, because launchd's PATH has neither.
// Resolves with a problem when it could not start, since an unheard spawn error would end the server and every chat with it.
// `minutes` null is --now --take-over, which restarts at once or tells a helper that is already waiting to stop.
export function spawnRestart(root, minutes) {
  const bin = path.dirname(process.execPath);
  const child = spawn(path.join(bin, 'npm'), ['run', 'restart', '--', ...(minutes === null ? ['--now', '--take-over'] : ['--wait', String(minutes)])], {
    cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
  });
  child.unref();
  return new Promise(resolve => {
    child.once('spawn', () => resolve(''));
    child.on('error', () => resolve('Could not start the restart helper.'));
  });
}

// git, restart, locked, busy, now and uptime (seconds) are the parts that touch the machine, passed in so a test can use fakes. `log` is the helper's log file.
// `auto` is the autoUpdate setting, `service` says whether launchd runs this server, `signingIn` whether a sign-in waits on the Mac and `announce` hears of each
// automatic step. See docs/adr/20261124-apply-merged-changes-without-a-press.md.
export function makeUpdate({ root, git = (args, timeout = 20_000) => run(root, args, timeout), restart = spawnRestart, locked = () => false, busy = () => 0, now = () => new Date(), uptime = process.uptime, log = null, graceMs = RESTART_NOTE_MS, auto = false, service = async () => false, signingIn = () => false, announce = () => {} }) {
  const clean = async args => (await git(args)).trim();
  const started = clean(['rev-parse', 'HEAD']).catch(() => null);
  let found = null;
  let importedCache = null;
  let working = false;
  let restartedAt = 0;
  let forced = false;
  let refreshedAt = 0;
  let isService = false;
  let failure = '';
  let round = 0;
  let spent = -1;

  const kindOf = f => (!f || !f.count ? null : f.toMerge ? 'update' : f.restart ? 'pulled' : null);
  const active = () => auto && isService;

  // Why this checkout must not move or restart, or ''. The press looks only when changes need merging. The automatic path always looks, and a commit of
  // its own then counts even with nothing to merge. --no-optional-locks keeps the page's poll from taking index.lock in a checkout someone works in.
  async function checkoutProblem(f, always = false) {
    if (!always && !f.toMerge) return '';
    if (await clean(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') return 'This checkout is not on main.';
    if (await clean(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no'])) return 'This checkout has uncommitted changes.';
    return f.ahead ? 'This checkout has diverged from main.' : '';
  }

  const imported = () => (importedCache ??= started.then(from => importedAt((commit, file) => git(['show', `${commit}:${file}`]), from)).catch(e => { importedCache = null; throw e; }));

  // Fetches, then works out what origin/main holds that this server does not, and resolves with whether it could read the checkout. A failed
  // fetch still reads the local refs, because a pull by hand moves them. Any other failure leaves the last result in place.
  async function check({ fetch = true } = {}) {
    const from = await started;
    if (!from) return false;
    try {
      if (fetch && auto && !isService) isService = await service().catch(() => false);
      if (fetch) await git(['fetch', '--quiet', 'origin', 'main'], 60_000).catch(() => {});
      const [head, origin, remote] = await Promise.all([clean(['rev-parse', 'HEAD']), clean(['rev-parse', 'origin/main']), clean(['remote', 'get-url', 'origin']).catch(() => '')]);
      const [ahead, behind] = (await clean(['rev-list', '--left-right', '--count', `${head}...${origin}`])).split(/\s+/).map(Number);
      const repo = repoUrl(remote);
      const commits = (await git(['log', '--first-parent', '--format=%H%x09%s', `${from}..${origin}`])).split('\n').filter(Boolean);
      const files = (await git(['diff', '--name-only', from, origin])).split('\n').filter(Boolean);
      const set = await imported();
      const next = {
        origin,
        count: commits.length,
        changes: commits.slice(0, LISTED).map(line => parseSubject(line.slice(line.indexOf('\t') + 1), repo)),
        toMerge: behind > 0,
        ahead: ahead > 0,
        restart: files.some(f => needsRestart(f, set)),
      };
      if (active() && kindOf(next)) next.hold = await checkoutProblem(next, true);
      found = next;
      return true;
    } catch {
      return false;
    }
  }

  // For the page's poll: a pull by hand shows soon, for a few local git reads a minute and no fetch.
  function refresh() {
    const at = now().getTime();
    if (working || at - refreshedAt < REREAD_EVERY_MS) return undefined;
    refreshedAt = at;
    return check({ fetch: false });
  }

  // The helper takes a moment to write its lock, so a restart just asked for counts as under way.
  const under = () => locked() || Date.now() - restartedAt < graceMs;

  // The helper writes its reason for giving up as the last line of its log, which is shown only if it wrote it for the restart asked for here.
  function gaveUp() {
    try {
      if (!log || !restartedAt || fs.statSync(log).mtimeMs < restartedAt) return '';
      return fs.readFileSync(log, 'utf8').trim().split('\n').pop().replace(/^\S+\s/, '').slice(0, 200);
    } catch { return ''; }
  }

  function state() {
    const f = found;
    const kind = kindOf(f);
    if (!kind) return { show: false };
    const restarting = under();
    const going = restarting && forced;
    return {
      show: true, kind, stage: working ? 'updating' : restarting ? 'restarting' : 'idle', count: f.count, changes: f.changes, restart: f.restart,
      blocked: f.restart ? restartRefused(now()) : '', busy: going ? 0 : restarting || f.restart ? busy() : 0, problem: restarting ? '' : (active() ? f.hold || failure : '') || gaveUp(),
      force: f.restart && !working && !going,
    };
  }

  // Moves main to the commit that was checked, not origin/main, which a fetch since may have moved past changes that need a restart. Resolves with a problem.
  async function merge(f) {
    try { await git(['merge', '--ff-only', f.origin]); } catch { return 'Could not move main forward.'; }
    await check({ fetch: false });
    return '';
  }

  // Resolves with the helper's problem, or '' once it has started.
  async function startRestart(minutes, force) {
    restartedAt = Date.now();
    forced = force;
    const failed = await restart(root, minutes);
    if (failed) { restartedAt = 0; forced = false; }
    return failed;
  }

  // Resolves with { problem } when it refused and changed nothing, or {} when it went ahead. A force skips the quiet window and the wait for
  // chats, and may start while a helper is waiting, which it tells to go now.
  async function update({ force = false } = {}) {
    if (working) return { problem: 'An update is already under way.' };
    if (under() && (!force || forced)) return { problem: 'A restart is already under way.' };
    const offered = found;
    working = true;
    failure = '';
    try {
      // The last check can be 30 minutes old, and the checkout may have moved since.
      const read = await check();
      const f = found;
      if (!f || !f.count) return { problem: 'There is nothing to update.' };
      if (!read) return { problem: 'Could not read this checkout.' };
      if (force && !f.restart) return { problem: 'Nothing waiting needs a restart.' };
      if (force) {
        const young = guard(Math.floor(uptime()));
        if (young) return { problem: young };
      } else if (f.restart && restartRefused(now())) return { problem: QUIET_REASON };
      // The press agreed to what the banner offered, and the server's sign-in guard read that same older result.
      if ((f.restart && !offered?.restart) || (f.toMerge && !offered?.toMerge)) return { problem: CHANGED_REASON };
      if (f.toMerge) {
        const refused = await checkoutProblem(f);
        if (refused) return { problem: refused };
        const failed = await merge(f);
        if (failed) return { problem: failed };
      }
      if (f.restart) {
        // The git steps can take long enough to cross 07:00.
        const at = now();
        if (!force && restartRefused(at)) return { problem: QUIET_REASON };
        const failed = await startRestart(force ? null : waitMinutes(at), force);
        if (failed) return { problem: failed };
      }
      return {};
    } finally {
      working = false;
    }
  }

  // The part of ADR conditions 1 to 7 that the last result and the machine answer with no git. Each scheduled check allows one attempt.
  const notYet = f => !active() || !kindOf(f) || !!f.hold || under() || (!!f.restart && restartNotYet());
  const restartNotYet = () => busy() > 0 || restartRefused(now()) !== '' || uptime() < APPLY_UPTIME_S || signingIn();

  const fail = text => { failure = text; announce(`Automatic update stopped: ${text}`); };

  // Called every few seconds. Costs no git until every cheap condition holds, then fetches, tests all of them again on the fresh result and goes ahead.
  // A "not yet" after the fetch gives the round back, so a chat that starts during it does not delay the release to the next check. A failed read,
  // a failed merge and a helper that was asked for keep it used.
  async function apply() {
    let mine = false;
    try {
      if (working || spent === round || notYet(found)) return;
      spent = round;
      mine = working = true;
      failure = '';
      if (!(await check())) return;
      const f = found;
      const wait = () => { spent = -1; };
      if (notYet(f)) return wait();
      const refused = await checkoutProblem(f, true);
      if (refused) { f.hold = refused; return wait(); }
      if (f.toMerge) {
        const failed = await merge(f);
        if (failed) return fail(failed);
        announce('Merged the changes into the checkout.');
      }
      if (f.restart) {
        // The merge can take long enough to cross 07:00 or let a chat start, and the checks and the restart request below have no await between them.
        if (restartNotYet() || under()) return wait();
        const failed = await startRestart(Math.min(APPLY_WAIT_MINUTES, waitMinutes(now())), false);
        if (failed) return fail(failed);
        announce('Asked for a restart.');
      }
    } catch {
      spent = round;
      fail('Could not read this checkout.');
    } finally {
      if (mine) working = false;
    }
  }

  // The 30 minute check. It starts a new round, and each round allows one automatic attempt.
  const scheduled = () => { round++; return check(); };

  return { check, scheduled, refresh, state, update, apply, commit: () => started };
}
