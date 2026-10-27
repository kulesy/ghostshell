// Asks the CLI for a session's title: one short process with no tools, no hooks and none of the owner's settings, which is a few hundred
// tokens a title. It writes no session file and runs in a neutral folder, so no project's instructions load.
// See docs/adr/20261027-name-sessions-from-their-first-turn.md.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { NO_HOOKS } from './commands.mjs';
import { TITLE_SYSTEM } from './titler.mjs';

const MODEL = 'claude-haiku-5-5';

// NOTE: [27 Oct 2026] EK - --setting-sources '' is what drops the owner's CLAUDE.md, skills and plugins from the request (7,060 tokens down to 701
// on CLI 2.1.311). Not --bare, which skips the OAuth sign-in. --no-session-persistence keeps the run out of lib/restart.mjs's chat count.
const ARGS = ['-p', '--model', MODEL, '--effort', 'low', '--no-session-persistence', '--strict-mcp-config', '--settings', NO_HOOKS, '--tools', '',
  '--setting-sources', '', '--system-prompt', TITLE_SYSTEM, '--output-format', 'json'];

export function askClaude(claude, { timeoutMs = 45_000 } = {}) {
  return (prompt, { signal } = {}) => new Promise((resolve, reject) => {
    const proc = spawn(claude, ARGS, { cwd: os.tmpdir(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let killer;
    // A process that ignores SIGTERM is killed 5 seconds later, so a stuck one cannot outlive its ask.
    const stop = () => {
      proc.kill('SIGTERM');
      killer ??= setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
    };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    // A write to a process that has already exited fails with EPIPE, which would crash the server unhandled. The close below says why it stopped.
    proc.stdin.on('error', () => {});
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err = (err + d).slice(-2000); });
    proc.on('error', e => { clearTimeout(timer); clearTimeout(killer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer);
      clearTimeout(killer);
      signal?.removeEventListener('abort', stop);
      let answer;
      try { answer = JSON.parse(out); } catch { /* no JSON, reported below */ }
      if (code === 0 && answer && !answer.is_error && typeof answer.result === 'string') resolve(answer.result);
      else reject(new Error(err.trim().split('\n').pop() || `Claude stopped (exit ${code}) before it answered.`));
    });
    proc.stdin.end(prompt);
  });
}
