// When Claude's sign-in ends, and signing in again from the page. The server learns one date from the CLI's keychain entry and keeps nothing
// else of it. Output of the CLI is never read or kept beyond one boolean. See docs/adr/20261102-banners-for-sign-in-and-updates.md.
import { execFile, spawn } from 'node:child_process';
import os from 'node:os';

const DAY = 86_400_000;
export const SOON_MS = 5 * DAY;
export const REFRESH_MS = 6 * 3_600_000;
export const AUTH_GAP_MS = 60_000;
export const SIGN_IN_LIMIT_MS = 10 * 60_000;
export const TIMED_OUT = 'Timed out waiting for the sign-in page to be approved.';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

// Desktop's CLAUDE_CODE_* and ANTHROPIC_BASE_URL variables break `claude auth`, so it gets only what it needs to find its login.
export const cleanEnv = (env = process.env) => Object.fromEntries(['HOME', 'USER', 'PATH', 'TERM'].filter(k => env[k] !== undefined).map(k => [k, env[k]]));

// Resolves with the end of the sign-in in epoch milliseconds, or null when the entry is missing, unreadable or has no usable date.
// An error is dropped unread: execFile's carries the output and a JSON.parse error quotes the input, and both hold the secret.
export function readLoginEnd({ security = 'security', user = os.userInfo().username } = {}) {
  return new Promise(resolve => {
    // NOTE: [2 Nov 2026] EK - Reads the CLI's private keychain entry only for claudeAiOauth.refreshTokenExpiresAt (epoch ms, checked on CLI 2.1.316).
    // The rest of the entry is a secret: it is never logged, kept or sent. See docs/adr/20261102-banners-for-sign-in-and-updates.md.
    execFile(security, ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', user, '-w'], { timeout: 10_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      let end = null;
      try { end = Number(JSON.parse(stdout)?.claudeAiOauth?.refreshTokenExpiresAt); } catch { end = null; }
      resolve(Number.isFinite(end) && end > 0 ? end : null);
    });
  });
}

// Resolves true or false for `loggedIn`, or null when the CLI said nothing usable. A signed out CLI may exit non-zero and still print the
// answer, so the output is read on an error too.
export function authStatus({ claude }) {
  return new Promise(resolve => {
    execFile(claude, ['auth', 'status', '--json'], { timeout: 15_000, maxBuffer: 1024 * 1024, env: cleanEnv() }, (err, stdout) => {
      let loggedIn = null;
      try { loggedIn = JSON.parse(stdout)?.loggedIn; } catch { loggedIn = null; }
      resolve(typeof loggedIn === 'boolean' ? loggedIn : null);
    });
  });
}

// Starts `claude auth login --claudeai`, which opens a page on the Mac that must be approved there. Its output is never read. Resolves
// `exited` with the exit code, or null when it was stopped or never started.
export function startSignIn({ claude }) {
  const child = spawn(claude, ['auth', 'login', '--claudeai'], { env: cleanEnv(), stdio: ['pipe', 'ignore', 'ignore'] });
  const exited = new Promise(resolve => {
    child.once('error', () => resolve(null));
    child.once('exit', code => resolve(code));
  });
  child.stdin.on('error', () => {});
  return { exited, stop: () => child.kill() };
}

const failedWords = code => (code === null ? 'The sign-in did not finish, and Claude is still signed out.' : `The sign-in ended with exit code ${code}, and Claude is still signed out.`);

// readEnd, authStatus and startSignIn are the parts that touch the machine, passed in so a test can use fakes.
export function makeLogin({ readEnd, authStatus: statusOf, startSignIn: begin, now = Date.now, limitMs = SIGN_IN_LIMIT_MS }) {
  let endsAt = null;
  let signedOut = false;
  let stage = 'idle';
  let problem = '';
  let lastFailureCheck = -Infinity;
  let active = null;

  const refresh = async ({ force = false } = {}) => {
    endsAt = await readEnd();
    const past = endsAt !== null && endsAt <= now();
    const loggedIn = force || endsAt === null || past ? await statusOf() : null;
    // The CLI's own answer wins over a date, since a stale entry can sit beside another way of being signed in.
    signedOut = loggedIn !== null ? !loggedIn : past;
  };

  const finish = async (exited, timedOut) => {
    const code = await exited;
    clearTimeout(active.timer);
    if (timedOut()) problem = TIMED_OUT;
    else if (await statusOf() === true) {
      await refresh();
      stage = 'done';
      problem = '';
      active = null;
      return;
    } else problem = failedWords(code);
    stage = 'failed';
    active = null;
  };

  return {
    refresh,
    // A chat reported authentication_failed: ask the CLI, at most once a minute.
    async authFailed() {
      if (now() - lastFailureCheck < AUTH_GAP_MS) return;
      lastFailureCheck = now();
      await refresh({ force: true });
    },
    state() {
      // A date already past with the CLI still signed in is not an ending, since another way of signing in can sit beside a stale entry.
      const soon = endsAt !== null && endsAt > now() && endsAt - now() <= SOON_MS;
      return { visible: signedOut || soon || stage === 'waiting', signedOut, endsAt, stage, problem };
    },
    // One sign-in at a time. Resolves once it has started, not when it ends.
    signIn() {
      if (active) return;
      stage = 'waiting';
      problem = '';
      let stopped = false;
      const running = begin();
      active = { stop: running.stop, timer: setTimeout(() => { stopped = true; running.stop(); }, limitMs) };
      active.timer.unref();
      finish(running.exited, () => stopped).catch(() => { stage = 'failed'; problem = failedWords(null); active = null; });
    },
    stop() {
      if (!active) return;
      clearTimeout(active.timer);
      active.stop();
    },
  };
}
