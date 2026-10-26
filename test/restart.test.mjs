// Run with `npm test`. `npm run restart`: the rules for arguments, chats, idle transcripts and the uptime guard, then the real script in
// --foreground against a fake server, fake chats and a fake launchctl. Nothing here touches the real launchd job or port.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatsOf, guard, isChat, isIdle, labelOf, lastTurnEntry, parseArgs, parseEtime, parsePs, projectDirName, resumeId } from '../lib/restart.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('arguments default to waiting 30 minutes for the standard label, and each flag is read', () => {
  assert.deepEqual(parseArgs([]), { now: false, foreground: false, wait: 30, label: null });
  assert.deepEqual(parseArgs(['--now', '--foreground', '--wait', '0.05', '--label=com.example.x']), { now: true, foreground: true, wait: 0.05, label: 'com.example.x' });
  assert.equal(parseArgs(['--wait=2']).wait, 2);
});

test('bad arguments come back as an error', () => {
  for (const bad of [['--wait'], ['--wait', '0'], ['--wait', 'soon'], ['--wait', '-1'], ['--label'], ['--label', '../x'], ['--now=1'], ['--nope'], ['stray']]) {
    assert.ok(parseArgs(bad).error, bad.join(' '));
  }
});

test('elapsed time reads as seconds', () => {
  assert.deepEqual(['05', '01:05', '02:01:05', '3-02:01:05'].map(parseEtime), [null, 65, 7265, 266465]);
  assert.equal(parseEtime('nonsense'), null);
});

test('ps lines are split into pid, parent, seconds and command', () => {
  const rows = parsePs('  101     1   10:00 node server.mjs\n 202   101 01:05 /bin/claude -p --resume abc-1\n\ngarbage\n');
  assert.deepEqual(rows, [
    { pid: 101, ppid: 1, seconds: 600, command: 'node server.mjs' },
    { pid: 202, ppid: 101, seconds: 65, command: '/bin/claude -p --resume abc-1' },
  ]);
});

test('a chat is a claude -p process, and the slash menu probe is not one', () => {
  assert.ok(isChat('/Users/x/.local/bin/claude -p --output-format stream-json --resume abc'));
  assert.ok(isChat('/usr/bin/node /tmp/dir/claude -p'));
  assert.ok(!isChat('/Users/x/.local/bin/claude -p --no-session-persistence --resume abc'));
  assert.ok(!isChat('/Users/x/.local/bin/claude'));
  assert.ok(!isChat('node server.mjs -p 4310'));
});

test('only direct children of the server that are chats are counted', () => {
  const rows = parsePs([
    '10 1 05:00 node server.mjs', '11 10 04:00 claude -p --resume a', '12 10 04:00 claude -p --no-session-persistence',
    '13 11 04:00 claude -p --resume b', '14 10 04:00 zsh', '15 99 04:00 claude -p --resume c',
  ].join('\n'));
  assert.deepEqual(chatsOf(rows, 10).map(r => r.pid), [11]);
});

test('the resume id is read from the command, and a path-like one is refused', () => {
  assert.equal(resumeId('claude -p --resume 1234-abcd --model x'), '1234-abcd');
  assert.equal(resumeId('claude -p'), null);
  assert.equal(resumeId('claude -p --resume ../../etc/passwd'), null);
});

test('a new chat finds its folder from its working directory', () => {
  assert.equal(projectDirName('/Users/a b/my.proj_x'), '-Users-a-b-my-proj-x');
});

const line = (type, extra = {}) => JSON.stringify({ type, message: { role: type, ...extra } });

test('a chat is idle only when the last user or assistant entry is an assistant end_turn', () => {
  const idle = entries => isIdle(lastTurnEntry(entries.join('\n') + '\n', false));
  assert.equal(idle([line('user'), line('assistant', { stop_reason: 'end_turn' })]), true);
  assert.equal(idle([line('assistant', { stop_reason: 'end_turn' }), JSON.stringify({ type: 'system' }), JSON.stringify({ type: 'summary' })]), true);
  assert.equal(idle([line('assistant', { stop_reason: 'tool_use' })]), false);
  assert.equal(idle([line('assistant', { stop_reason: 'end_turn' }), line('user')]), false, 'a tool result or new message is last');
  assert.equal(idle([line('assistant', { stop_reason: null })]), false);
  assert.equal(idle([]), false);
});

test('a half-written last line is skipped, and the cut first line of a long file is dropped', () => {
  const done = line('assistant', { stop_reason: 'end_turn' });
  assert.equal(isIdle(lastTurnEntry(`${done}\n{"type":"assis`, false)), true);
  const cut = `ssistant","message":{"stop_reason":"end_turn"}}\n${line('user')}\n`;
  assert.equal(lastTurnEntry(cut, true).type, 'user');
  assert.equal(lastTurnEntry('ssistant","message":{"stop_reason":"end_turn"}}', true), null);
});

test('the guard refuses a server that has been up under the minimum and says how long to wait', () => {
  assert.match(guard(20), /Wait 40 more seconds/);
  assert.equal(guard(60), null);
  assert.equal(guard(3600), null);
  assert.equal(guard(null), null);
  assert.equal(guard(0, 0), null);
});

// The script itself, in --foreground. A fake server owns the port and fake chats, and a fake launchctl records its arguments and swaps the server.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-restart-'));
const live = new Set();
after(() => { for (const pid of live) { try { process.kill(pid, 'SIGKILL'); } catch {} } fs.rmSync(dir, { recursive: true, force: true }); });

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (check, ms = 10_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (check()) return true; return false; };

// Listens on PORT, writes its pid to pids, and starts one fake chat per argument. A fake chat leaves when its parent does.
fs.writeFileSync(path.join(dir, 'server.mjs'), `
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const here = path.dirname(new URL(import.meta.url).pathname);
http.createServer((q, r) => r.end('login')).listen(Number(process.env.PORT), '127.0.0.1', () => fs.appendFileSync(path.join(here, 'pids'), process.pid + '\\n'));
for (const id of process.argv.slice(2)) spawn(path.join(here, 'bin', 'claude'), ['-p', '--resume', id], { stdio: 'ignore' }).unref();
`);
fs.mkdirSync(path.join(dir, 'bin'));
fs.writeFileSync(path.join(dir, 'bin', 'claude'), `#!${process.execPath}
const parent = process.ppid;
setInterval(() => { try { process.kill(parent, 0); } catch { process.exit(0); } }, 200);
setTimeout(() => process.exit(0), 60000);
`, { mode: 0o755 });
// Records its arguments, then stops the old server and starts a new one without chats, as launchd would.
fs.writeFileSync(path.join(dir, 'launchctl'), `#!${process.execPath}
const fs = require('node:fs'); const { spawn } = require('node:child_process');
const here = ${JSON.stringify(dir)};
fs.appendFileSync(here + '/launchctl.log', process.argv.slice(2).join(' ') + '\\n');
const pids = fs.readFileSync(here + '/pids', 'utf8').trim().split('\\n');
try { process.kill(Number(pids.at(-1)), 'SIGKILL'); } catch {}
spawn(process.execPath, [here + '/server.mjs'], { detached: true, stdio: 'ignore' }).unref();
`, { mode: 0o755 });

async function scenario(name, { chats = ['chat-1'], transcript = 'tool_use' } = {}) {
  const home = path.join(dir, name, 'home');
  const state = path.join(dir, name, 'state');
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'p'), { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  const write = reason => fs.writeFileSync(path.join(home, '.claude', 'projects', 'p', 'chat-1.jsonl'),
    `${line('user')}\n${line('assistant', { stop_reason: reason })}\n`);
  write(transcript);
  const port = await freePort();
  const here = path.join(dir, name);
  fs.mkdirSync(here, { recursive: true });
  const env = { ...process.env, HOME: home, PORT: String(port), CAPCOM_STATE: state, CAPCOM_LAUNCHCTL: path.join(dir, 'launchctl'),
    CAPCOM_RESTART_MIN_UPTIME_MS: '0', CAPCOM_RESTART_POLL_MS: '100' };
  fs.rmSync(path.join(dir, 'pids'), { force: true });
  fs.rmSync(path.join(dir, 'launchctl.log'), { force: true });
  const server = spawn(process.execPath, [path.join(dir, 'server.mjs'), ...chats], { env, stdio: 'ignore' });
  live.add(server.pid);
  assert.ok(await until(() => fs.existsSync(path.join(dir, 'pids'))), 'the fake server listens');
  await sleep(500);
  const restart = (...args) => new Promise(resolve => {
    execFile(process.execPath, [path.join(ROOT, 'bin', 'restart.mjs'), '--foreground', '--label', 'com.example.capcom', ...args], { env, timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, out: stdout + stderr });
    });
  });
  const calls = () => (fs.existsSync(path.join(dir, 'launchctl.log')) ? fs.readFileSync(path.join(dir, 'launchctl.log'), 'utf8').trim().split('\n') : []);
  const pids = () => fs.readFileSync(path.join(dir, 'pids'), 'utf8').trim().split('\n').map(Number);
  return { env, restart, calls, write, state, pids, track: () => pids().forEach(p => live.add(p)) };
}
const kickstart = `kickstart -k gui/${process.getuid()}/com.example.capcom`;

test('a stopped turn and a synthetic reply are idle, and --session-id names the transcript', () => {
  const stopped = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
  const limit = JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>', stop_reason: 'stop_sequence' } });
  const asked = JSON.stringify({ type: 'user', message: { role: 'user', content: 'go on' } });
  assert.equal(isIdle(lastTurnEntry(stopped, false)), true);
  assert.equal(isIdle(lastTurnEntry(limit, false)), true);
  assert.equal(isIdle(lastTurnEntry(asked, false)), false);
  assert.equal(resumeId('claude -p --session-id 1234-abcd'), '1234-abcd');
});

test('the label is the launchd job whose pid is the server or its parent', () => {
  const listing = 'PID\tStatus\tLabel\n-\t0\tcom.example.idle\n927\t0\tcom.example.capcom\n1865\t0\tcom.example.ntfy';
  assert.equal(labelOf(listing, [929, 927]), 'com.example.capcom');
  assert.equal(labelOf(listing, [929, 928]), null);
  assert.equal(labelOf('', [1]), null);
});

test('a busy chat is waited for, and the service restarts once when its transcript shows end_turn', async () => {
  const s = await scenario('flip');
  const done = s.restart();
  await sleep(1000);
  assert.deepEqual(s.calls(), [], 'nothing is restarted while the chat is mid-turn');
  s.write('end_turn');
  const { code, out } = await done;
  s.track();
  assert.equal(code, 0, out);
  assert.deepEqual(s.calls(), [kickstart]);
  assert.match(out, /answering on port \d+ \(new pid \d+\)/);
  assert.equal(fs.existsSync(path.join(s.state, 'restart.lock')), false, 'the lock is removed');
});

test('waiting past the limit exits non-zero, names the chat and never calls launchctl', async () => {
  const s = await scenario('busy');
  const { code, out } = await s.restart('--wait', '0.03');
  s.track();
  assert.equal(code, 1);
  assert.match(out, /Still running: pid \d+/);
  assert.deepEqual(s.calls(), []);
});

test('--now restarts with a chat still running', async () => {
  const s = await scenario('now');
  const { code, out } = await s.restart('--now');
  s.track();
  assert.equal(code, 0, out);
  assert.deepEqual(s.calls(), [kickstart]);
});

test('a chat whose transcript is missing counts as running', async () => {
  const s = await scenario('missing', { chats: ['no-such-chat'] });
  const { code } = await s.restart('--wait', '0.03');
  s.track();
  assert.equal(code, 1);
  assert.deepEqual(s.calls(), []);
});

test('a server up under the minimum is refused, even with --now', async () => {
  const s = await scenario('young');
  s.env.CAPCOM_RESTART_MIN_UPTIME_MS = '3600000';
  const { code, out } = await s.restart('--now');
  s.track();
  assert.equal(code, 1);
  assert.match(out, /Wait \d+ more seconds/);
  assert.deepEqual(s.calls(), []);
});

test('a live lock refuses a second restart, and no run ever submits a job', async () => {
  const s = await scenario('locked', { transcript: 'end_turn' });
  fs.writeFileSync(path.join(s.state, 'restart.lock'), String(process.pid));
  const { code, out } = await s.restart();
  s.track();
  assert.equal(code, 1);
  assert.match(out, /already under way/);
  assert.deepEqual(s.calls(), []);
  assert.ok(!/submit/.test(fs.readFileSync(path.join(ROOT, 'bin', 'restart.mjs'), 'utf8').replace(/\/\/.*$/gm, '')));
});

test('without --foreground the command returns at once and one detached worker does the restart and logs it', async () => {
  const s = await scenario('detached', { transcript: 'end_turn' });
  const { code, out } = await new Promise(resolve => {
    execFile(process.execPath, [path.join(ROOT, 'bin', 'restart.mjs'), '--label', 'com.example.capcom'], { env: s.env, timeout: 5000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr }));
  });
  assert.equal(code, 0, out);
  assert.match(out, /restart\.log/);
  assert.ok(await until(() => s.calls().length === 1), 'the worker restarts it');
  assert.ok(await until(() => /answering on port/.test(fs.readFileSync(path.join(s.state, 'restart.log'), 'utf8'))));
  s.track();
  assert.deepEqual(s.calls(), [kickstart]);
});
