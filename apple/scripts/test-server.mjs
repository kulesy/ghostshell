#!/usr/bin/env node
// A scratch GhostShell server for the Swift tests: its own state folder, home and port, and a password written to a file.
// As a command it prints one JSON line with the address and where the password file is, runs until SIGINT, SIGTERM or the
// time limit, then stops the server. The other scripts import startScratch instead. It never touches port 4310 or the real state.
//
//   node apple/scripts/test-server.mjs [--empty] [--claude] [--minutes 30]
//
// --empty seeds no sessions. --claude lets a real `claude` run chats in the test folder, through a wrapper that keeps Chrome out of it.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// A folder of its own inside the shared test folder, so its transcripts are only this app's chats.
export const TEST_CWD = '/private/tmp/claude-501/capcom-test-cwd/swift-app';
const TITLES = [
  'Fix the flaky upload test', 'Plan the release notes', 'Review the sign-in change', 'Tidy the settings page',
  'Add dark mode to the chart', 'Investigate slow startup', 'Write the migration guide', 'Check the nightly build',
];
const folderName = cwd => cwd.replace(/[/.]/g, '-');

const freePort = () => new Promise(resolve => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// Transcripts the server lists as sessions, newest first, with no model behind them.
function seed(projects, cwd, count = TITLES.length) {
  const folder = path.join(projects, folderName(cwd));
  fs.mkdirSync(folder, { recursive: true });
  const now = Date.now();
  TITLES.slice(0, count).forEach((title, i) => {
    const file = path.join(folder, `${crypto.randomUUID()}.jsonl`);
    const stamp = new Date(now - (i * 37 + 3) * 60_000).toISOString();
    const lines = [
      { type: 'user', cwd, gitBranch: 'main', timestamp: stamp, message: { role: 'user', content: title }, uuid: crypto.randomUUID() },
      { type: 'assistant', cwd, timestamp: stamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }, uuid: crypto.randomUUID() },
    ];
    fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    const when = new Date(now - (i * 37 + 3) * 60_000);
    fs.utimesSync(file, when, when);
  });
}

// Runs the real claude with the real home, so a test chat is a real Haiku chat, and keeps the real Chrome out of it.
function wrapper(file) {
  const real = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(file, `#!/bin/sh
export HOME=${JSON.stringify(os.homedir())}
[ "$1" = "--claude-in-chrome-mcp" ] && exit 0
n=$#
i=0
while [ $i -lt $n ]; do a=$1; shift; i=$((i+1)); [ "$a" = "--chrome" ] || set -- "$@" "$a"; done
exec ${JSON.stringify(real)} "$@"
`, { mode: 0o755 });
}

export async function startScratch({ empty = false, claude = false, base = '/private/tmp/claude-501/gs-scratch' } = {}) {
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'run-'));
  const home = path.join(dir, 'home');
  const state = path.join(dir, 'state');
  const projects = path.join(home, '.claude', 'projects');
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  fs.mkdirSync(projects, { recursive: true });
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'), { recursive: true });
  const password = crypto.randomBytes(18).toString('base64url');
  const passwordFile = path.join(dir, 'password.txt');
  fs.writeFileSync(passwordFile, password + '\n', { mode: 0o600 });
  const { writePassword } = await import(path.join(ROOT, 'lib', 'auth.mjs'));
  writePassword(state, password);

  const seedCwd = path.join(dir, 'seed-cwd');
  fs.mkdirSync(seedCwd);
  if (!empty) seed(projects, seedCwd);

  const stub = path.join(dir, 'stub');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const cli = path.join(dir, 'claude-wrapper');
  if (claude) {
    wrapper(cli);
    // Only the test folder's transcripts are shown, so none of the real sessions ever appear.
    fs.mkdirSync(TEST_CWD, { recursive: true });
    const real = path.join(os.homedir(), '.claude', 'projects', folderName(TEST_CWD));
    fs.mkdirSync(real, { recursive: true });
    fs.symlinkSync(real, path.join(projects, folderName(TEST_CWD)));
  }

  const port = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CAPCOM_|CLAUDECODE|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|PORT$)/.test(k)));
  Object.assign(env, {
    HOME: home, PORT: String(port), CAPCOM_STATE: state, CAPCOM_CLAUDE: claude ? cli : stub, CAPCOM_SECURITY: stub, CAPCOM_OPEN: stub,
    CAPCOM_GH: stub, CAPCOM_UPDATE_ROOT: path.join(dir, 'update-root'), CAPCOM_AUTO_TITLE: '0', CAPCOM_SURVEY_DELAY_MS: '2000000000',
    CAPCOM_UPDATE_DELAY_MS: '2000000000', CAPCOM_RETIRE_QUIET_MS: '300',
  });
  fs.mkdirSync(env.CAPCOM_UPDATE_ROOT);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', c => { errors += c; });
  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`The scratch server did not start. ${errors}`)); }, 20_000);
    child.stdout.on('data', c => { out += c; if (out.includes('Capcom on')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`The scratch server exited with ${code}. ${errors}`)); });
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGCONT');
    await new Promise(resolve => {
      const hard = setTimeout(() => child.kill('SIGKILL'), 5_000);
      child.once('exit', () => { clearTimeout(hard); resolve(); });
      child.kill('SIGTERM');
    });
  };
  return { dir, home, state, port, pid: child.pid, address: `http://localhost:${port}`, passwordFile, testCwd: TEST_CWD, stop, errors: () => errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const minutes = Number(args[args.indexOf('--minutes') + 1]) || 30;
  const server = await startScratch({ empty: args.includes('--empty'), claude: args.includes('--claude') });
  const done = async () => { await server.stop(); process.exit(0); };
  process.on('SIGINT', done);
  process.on('SIGTERM', done);
  setTimeout(done, minutes * 60_000).unref();
  console.log(JSON.stringify({ address: server.address, passwordFile: server.passwordFile, pid: process.pid, serverPid: server.pid, dir: server.dir }));
  setInterval(() => {}, 1 << 30);
}
