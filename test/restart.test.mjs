// Run with `npm test`. `npm run restart`: the rules for arguments, chats, idle transcripts and the uptime guard, then the real script in
// --foreground against a fake server, fake chats and a fake launchctl. Nothing here touches the real launchd job or port.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerOf, chatsOf, cleanTitle, dropToken, guard, holdOf, holdWords, isChat, isIdle, labelOf, lastTurnEntry, lockHolder, OLD, parseArgs, parseEtime, parsePs, projectDirName, resumeId, tokenAllows, UNREAD, writeToken } from '../lib/restart.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('arguments default to waiting 30 minutes for the standard label, and each flag is read', () => {
  assert.deepEqual(parseArgs([]), { now: false, takeOver: false, foreground: false, wait: 30, label: null });
  assert.deepEqual(parseArgs(['--now', '--foreground', '--wait', '0.05', '--label=com.example.x']), { now: true, takeOver: false, foreground: true, wait: 0.05, label: 'com.example.x' });
  assert.equal(parseArgs(['--now', '--take-over']).takeOver, true);
  assert.equal(parseArgs(['--wait=2']).wait, 2);
});

test('the lock is held by a live pid other than the caller, and by no one when the file is missing, empty, stale or the caller\'s own', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-lock-test-'));
  const lock = path.join(dir, 'restart.lock');
  assert.equal(lockHolder(lock), null, 'no file');
  fs.writeFileSync(lock, '');
  assert.equal(lockHolder(lock), null, 'no pid');
  fs.writeFileSync(lock, 'soon');
  assert.equal(lockHolder(lock), null, 'not a pid');
  fs.writeFileSync(lock, String(process.ppid));
  assert.equal(lockHolder(lock), process.ppid, 'a live process');
  assert.equal(lockHolder(lock, process.ppid), null, 'the caller\'s own pid');
  const gone = spawnSync(process.execPath, ['-e', '0']);
  fs.writeFileSync(lock, String(gone.pid));
  assert.equal(lockHolder(lock), null, 'a pid that has exited');
});

test('bad arguments come back as an error', () => {
  for (const bad of [['--wait'], ['--wait', '0'], ['--wait', 'soon'], ['--wait', '-1'], ['--label'], ['--label', '../x'], ['--now=1'], ['--take-over'], ['--take-over=1', '--now'], ['--nope'], ['stray']]) {
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
// Like a server from before /restart-wait it answers every path with an HTML page, unless the file WAIT_FILE holds { chats: { <id>: { jobs, title } } },
// or { status, type, raw } for an answer as it stands, or { hang: true }. The tokens it was sent go to SEEN_FILE.
fs.writeFileSync(path.join(dir, 'server.mjs'), `
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const here = path.dirname(new URL(import.meta.url).pathname);
const kids = {};
const page = r => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('login'); };
http.createServer((q, r) => {
  const w = q.url === '/restart-wait' && process.env.WAIT_FILE && fs.existsSync(process.env.WAIT_FILE) ? JSON.parse(fs.readFileSync(process.env.WAIT_FILE, 'utf8')) : null;
  if (!w) return page(r);
  fs.appendFileSync(process.env.SEEN_FILE, (q.headers['x-capcom-restart'] ?? '') + '\\n');
  if (w.hang) return;
  r.writeHead(w.status ?? 200, { 'content-type': w.type ?? 'application/json' });
  r.end(w.raw ?? JSON.stringify({ chats: Object.entries(w.chats).map(([id, c]) => ({ pid: kids[id], ...c })) }));
}).listen(Number(process.env.PORT), '127.0.0.1', () => fs.appendFileSync(path.join(here, 'pids'), process.pid + '\\n'));
for (const id of process.argv.slice(2)) { const kid = spawn(path.join(here, 'bin', 'claude'), ['-p', '--resume', id], { stdio: 'ignore' }); kid.unref(); kids[id] = kid.pid; }
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
    CAPCOM_RESTART_MIN_UPTIME_MS: '0', CAPCOM_RESTART_POLL_MS: '100', WAIT_FILE: path.join(here, 'wait.json'), SEEN_FILE: path.join(here, 'seen') };
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
  const setWait = answer => fs.writeFileSync(env.WAIT_FILE, JSON.stringify(answer));
  const seen = () => (fs.existsSync(env.SEEN_FILE) ? fs.readFileSync(env.SEEN_FILE, 'utf8').trim().split('\n') : []);
  return { env, restart, calls, write, setWait, seen, state, pids, track: () => pids().forEach(p => live.add(p)) };
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
  assert.match(out, /Gave up after 0\.03 minutes without restarting\. Still running: pid \d+ \(mid-turn\)\./);
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

test('--now --take-over beside a waiting worker tells it to go now, and the one restart is the waiter\'s', async () => {
  const s = await scenario('takeover');
  const waiter = s.restart('--wait', '5');
  assert.ok(await until(() => fs.existsSync(path.join(s.state, 'restart.lock'))), 'the worker holds the lock');
  await sleep(500);
  assert.deepEqual(s.calls(), [], 'the worker waits while the chat is mid-turn');
  const forced = await s.restart('--now', '--take-over');
  assert.equal(forced.code, 0, forced.out);
  assert.match(forced.out, /Told the waiting restart worker \(pid \d+\) to restart now/);
  const done = await waiter;
  s.track();
  assert.equal(done.code, 0, done.out);
  assert.match(done.out, /Told to stop waiting, so restarting now/);
  assert.deepEqual(s.calls(), [kickstart]);
  assert.equal(fs.existsSync(path.join(s.state, 'restart.lock')), false, 'the lock is removed');
});

test('plain --now beside a waiting worker refuses and leaves it waiting', async () => {
  const s = await scenario('now-refused');
  const waiter = s.restart('--wait', '5');
  assert.ok(await until(() => fs.existsSync(path.join(s.state, 'restart.lock'))));
  const second = await s.restart('--now');
  assert.equal(second.code, 1);
  assert.match(second.out, /already under way/);
  await sleep(500);
  assert.deepEqual(s.calls(), [], 'the worker is still waiting');
  s.write('end_turn');
  const done = await waiter;
  s.track();
  assert.equal(done.code, 0, done.out);
  assert.doesNotMatch(done.out, /Told to stop waiting/);
  assert.deepEqual(s.calls(), [kickstart]);
});

test('a --wait run beside a waiting worker still refuses and signals nothing', async () => {
  const s = await scenario('wait-refused');
  const waiter = s.restart('--wait', '5');
  assert.ok(await until(() => fs.existsSync(path.join(s.state, 'restart.lock'))));
  const second = await s.restart('--wait', '5');
  assert.equal(second.code, 1);
  assert.match(second.out, /already under way/);
  s.write('end_turn');
  const done = await waiter;
  s.track();
  assert.equal(done.code, 0, done.out);
  assert.doesNotMatch(done.out, /Told to stop waiting/);
  assert.deepEqual(s.calls(), [kickstart]);
});

test('--now --take-over with a lock that names a live process that is not a restart worker does not signal it', async () => {
  const s = await scenario('stale-lock', { transcript: 'end_turn' });
  const other = spawn('sleep', ['60'], { stdio: 'ignore' });
  live.add(other.pid);
  try {
    fs.writeFileSync(path.join(s.state, 'restart.lock'), String(other.pid));
    const { code, out } = await s.restart('--now', '--take-over');
    s.track();
    assert.equal(code, 1);
    assert.match(out, /already under way/);
    assert.equal(other.exitCode === null && other.signalCode === null, true, 'the other process is untouched');
    assert.doesNotThrow(() => process.kill(other.pid, 0));
    assert.deepEqual(s.calls(), []);
  } finally {
    other.kill('SIGKILL');
  }
});

// What a background job holds. The rule is pure, so these are plain data.
test('a background job only adds a reason to wait: the transcript, an unreadable answer and an unlisted chat each hold, and only a count of 0 clears', () => {
  const waits = entries => new Map(Object.entries(entries).map(([pid, v]) => [Number(pid), v]));
  assert.deepEqual(holdOf(7, true, OLD), { reason: 'turn', title: undefined });
  assert.equal(holdOf(7, false, OLD), null, 'a server without the route leaves the transcript to decide');
  assert.deepEqual(holdOf(7, true, waits({ 7: { jobs: 0, title: 'T' } })), { reason: 'turn', title: 'T' }, 'a server that says 0 jobs cannot clear a chat whose transcript says running');
  assert.deepEqual(holdOf(7, true, waits({ 7: { jobs: 2, title: 'T' } })), { reason: 'turn', title: 'T' }, 'mid-turn wins over jobs');
  assert.deepEqual(holdOf(7, false, waits({ 7: { jobs: 2, title: 'T' } })), { reason: 'jobs', jobs: 2, title: 'T' });
  assert.equal(holdOf(7, false, waits({ 7: { jobs: 0, title: 'T' } })), null);
  assert.deepEqual(holdOf(7, false, waits({ 8: { jobs: 0, title: 'T' } })), { reason: 'unread' }, 'a chat the server does not list has no count');
  assert.deepEqual(holdOf(7, false, UNREAD), { reason: 'unread' });
  assert.deepEqual(holdOf(7, true, UNREAD), { reason: 'turn', title: undefined }, 'mid-turn wins over an unreadable answer');
  assert.deepEqual(holdOf(7, true, waits({ 8: { jobs: 0, title: 'T' } })), { reason: 'turn', title: undefined });
});

test('the server\'s answer is read only as a complete JSON list, and an HTML page with 200 or 503 is a server without the route', () => {
  const json = chats => answerOf(200, 'application/json; charset=utf-8', JSON.stringify({ chats }));
  assert.deepEqual([...json([{ pid: 4, jobs: 1, title: 'A' }, { pid: 5, jobs: 0, title: '' }])], [[4, { jobs: 1, title: 'A' }], [5, { jobs: 0, title: '' }]]);
  assert.equal(json([]).size, 0);
  assert.equal(answerOf(200, 'text/html; charset=utf-8', 'login'), OLD);
  assert.equal(answerOf(503, 'text/html; charset=utf-8', 'setup'), OLD);
  for (const [status, type] of [[404, 'text/html'], [403, 'text/html'], [500, 'text/html'], [302, 'text/html'], [403, 'application/json'], [200, 'text/plain'], [200, undefined]]) {
    assert.equal(answerOf(status, type, '{"chats":[]}'), UNREAD, `${status} ${type}`);
  }
  for (const bad of ['', 'nope', '[]', '{}', '{"chats":{}}', '{"chats":[null]}', '{"chats":[{"pid":0,"jobs":0,"title":""}]}', '{"chats":[{"pid":1.5,"jobs":0,"title":""}]}',
    '{"chats":[{"pid":"4","jobs":0,"title":""}]}', '{"chats":[{"pid":4,"jobs":-1,"title":""}]}', '{"chats":[{"pid":4,"jobs":0.5,"title":""}]}', '{"chats":[{"pid":4,"jobs":0}]}',
    '{"chats":[{"pid":4,"jobs":0,"title":3}]}', '{"chats":[{"pid":4,"jobs":0,"title":""},{"pid":4,"jobs":0,"title":""}]}']) {
    assert.equal(answerOf(200, 'application/json', bad), UNREAD, bad);
  }
});

test('a title is cut to one line of at most 60 characters, and a chat is named by its title or else its pid', () => {
  assert.equal(cleanTitle('a\nb\r\n\tc d e‮f⁦g‏h\u0000i\u0085j'), 'a b c d e f g h i j');
  assert.equal(cleanTitle('  spaced   out  '), 'spaced out');
  assert.equal(cleanTitle('x'.repeat(60)), 'x'.repeat(60));
  assert.equal(cleanTitle('x'.repeat(61)), `${'x'.repeat(59)}…`);
  assert.equal(cleanTitle('😀'.repeat(70)), `${'😀'.repeat(59)}…`);
  assert.equal(cleanTitle(undefined), '');
  assert.equal(holdWords({ pid: 9, reason: 'turn', title: 'Deploy' }), '"Deploy" (mid-turn)');
  assert.equal(holdWords({ pid: 9, reason: 'turn' }), 'pid 9 (mid-turn)');
  assert.equal(holdWords({ pid: 9, reason: 'jobs', jobs: 1, title: 'Deploy' }), '"Deploy" (1 background job)');
  assert.equal(holdWords({ pid: 9, reason: 'jobs', jobs: 2, title: ' \n ' }), 'pid 9 (2 background jobs)');
  assert.equal(holdWords({ pid: 9, reason: 'unread' }), 'pid 9 (its background jobs could not be read)');
});

test('the token matches only its own text, and an empty or missing file matches nothing', () => {
  const folder = fs.mkdtempSync(path.join(dir, 'token-'));
  const file = path.join(folder, 'restart.token');
  assert.equal(tokenAllows('abc', file), false, 'no file');
  fs.writeFileSync(file, '');
  assert.equal(tokenAllows('', file), false, 'empty file and empty header');
  assert.equal(tokenAllows('abc', file), false, 'empty file');
  fs.writeFileSync(file, 'abc');
  assert.equal(tokenAllows('abc', file), true);
  for (const wrong of ['abd', 'ab', 'abcd', '', undefined, ['abc'], 'x'.repeat(500)]) assert.equal(tokenAllows(wrong, file), false, String(wrong));
});

test('a token is written fresh at 0600 over an old file or a link, and removed only while it is still that worker\'s', () => {
  const folder = fs.mkdtempSync(path.join(dir, 'token-'));
  const file = path.join(folder, 'restart.token');
  const target = path.join(folder, 'target');
  fs.writeFileSync(target, 'keep');
  fs.symlinkSync(target, file);
  const first = writeToken(file);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep', 'the link\'s target is untouched');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.rmSync(file);
  fs.writeFileSync(file, 'old', { mode: 0o644 });
  const second = writeToken(file);
  assert.notEqual(second, first);
  assert.equal(fs.readFileSync(file, 'utf8'), second);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'an old file\'s looser mode is not kept');
  dropToken(file, first);
  assert.equal(fs.existsSync(file), true, 'another worker\'s token stays');
  dropToken(file, second);
  assert.equal(fs.existsSync(file), false);
});

test('a chat with a background job holds the restart, and the log names it, tells it from a chat mid-turn, and the restart goes once the job ends', async () => {
  const s = await scenario('job');
  s.setWait({ chats: { 'chat-1': { jobs: 0, title: 'Deploy' } } });
  const done = s.restart('--wait', '5');
  await sleep(1000);
  assert.deepEqual(s.calls(), [], 'mid-turn by the transcript, whatever the server says');
  s.setWait({ chats: { 'chat-1': { jobs: 1, title: 'Deploy' } } });
  s.write('end_turn');
  await sleep(1000);
  assert.deepEqual(s.calls(), [], 'the job holds the restart');
  s.setWait({ chats: { 'chat-1': { jobs: 2, title: 'Deploy' } } });
  await sleep(500);
  s.setWait({ chats: { 'chat-1': { jobs: 0, title: 'Deploy' } } });
  const { code, out } = await done;
  s.track();
  assert.equal(code, 0, out);
  assert.deepEqual(s.calls(), [kickstart]);
  const waits = out.split('\n').filter(l => /Waiting for "/.test(l)).map(l => l.replace(/^\S+ /, ''));
  assert.deepEqual(waits, ['Waiting for "Deploy" (mid-turn).', 'Waiting for "Deploy" (1 background job).', 'Waiting for "Deploy" (2 background jobs).']);
  assert.ok(s.seen().length > 3 && s.seen().every(t => /^[0-9a-f]{64}$/.test(t)), 'each poll sent the token');
});

test('a chat that ended its turn with no job does not hold the restart', async () => {
  const s = await scenario('no-job', { transcript: 'end_turn' });
  s.setWait({ chats: { 'chat-1': { jobs: 0, title: 'Done' } } });
  const { code, out } = await s.restart('--wait', '5');
  s.track();
  assert.equal(code, 0, out);
  assert.deepEqual(s.calls(), [kickstart]);
  assert.doesNotMatch(out, /Waiting for "/);
});

test('a server from before the route is read from the transcript alone, behind its sign-in page or its setup page', async () => {
  for (const [name, answer] of [['old-login', null], ['old-setup', { status: 503, type: 'text/html; charset=utf-8', raw: 'setup' }], ['old-login-200', { status: 200, type: 'text/html', raw: 'login' }]]) {
    const s = await scenario(name, { transcript: 'end_turn' });
    if (answer) s.setWait(answer);
    const { code, out } = await s.restart('--wait', '5');
    s.track();
    assert.equal(code, 0, `${name}: ${out}`);
    assert.deepEqual(s.calls(), [kickstart], name);
  }
  const busy = await scenario('old-busy');
  const { code, out } = await busy.restart('--wait', '0.03');
  busy.track();
  assert.equal(code, 1);
  assert.match(out, /Still running: pid \d+ \(mid-turn\)\./);
});

// A server that should answer and does not holds the restart, because it cannot be told whether a chat has a job.
for (const [name, answer] of [
  ['refused', { status: 403, type: 'application/json', raw: '{"error":"Not allowed."}' }],
  ['server-error', { status: 500, type: 'application/json', raw: '{}' }],
  ['bad-json', { raw: '{"chats":' }],
  ['wrong-shape', { raw: '{"chats":[{"pid":"x","jobs":0,"title":""}]}' }],
  ['no-pid', { chats: {} }],
  ['html-not-found', { status: 404, type: 'text/html', raw: 'nope' }],
  ['redirect', { status: 302, type: 'text/html', raw: '' }],
  ['hang', { hang: true }],
]) {
  test(`an answer that is ${name} holds the restart until it gives up, and the log says the jobs could not be read`, async () => {
    const s = await scenario(`unread-${name}`, { transcript: 'end_turn' });
    s.setWait(answer);
    const { code, out } = await s.restart('--wait', '0.03');
    s.track();
    assert.equal(code, 1, out);
    assert.match(out, /Waiting for pid \d+ \(its background jobs could not be read\)\./);
    assert.match(out, /Gave up after 0\.03 minutes without restarting\. Still running: pid \d+ \(its background jobs could not be read\)\.\n$/);
    assert.deepEqual(s.calls(), []);
  });
}

test('--now goes at once with a job running and asks the server nothing', async () => {
  const s = await scenario('now-job', { transcript: 'end_turn' });
  s.setWait({ chats: { 'chat-1': { jobs: 3, title: 'Deploy' } } });
  const { code, out } = await s.restart('--now');
  s.track();
  assert.equal(code, 0, out);
  assert.deepEqual(s.calls(), [kickstart]);
  assert.deepEqual(s.seen(), []);
  assert.equal(fs.existsSync(path.join(s.state, 'restart.token')), false, 'a forced restart writes no token');
});

test('--now --take-over beside a worker held by a job tells it to go now', async () => {
  const s = await scenario('takeover-job', { transcript: 'end_turn' });
  s.setWait({ chats: { 'chat-1': { jobs: 1, title: 'Deploy' } } });
  const waiter = s.restart('--wait', '5');
  assert.ok(await until(() => s.seen().length > 0), 'the worker is polling');
  await sleep(500);
  assert.deepEqual(s.calls(), []);
  const forced = await s.restart('--now', '--take-over');
  assert.equal(forced.code, 0, forced.out);
  const done = await waiter;
  s.track();
  assert.equal(done.code, 0, done.out);
  assert.match(done.out, /Told to stop waiting, so restarting now/);
  assert.deepEqual(s.calls(), [kickstart]);
});

test('the token file is 0600 while the worker waits, is the token each poll sends, replaces a link without following it, and is gone after the restart', async () => {
  const s = await scenario('token', { transcript: 'end_turn' });
  const victim = path.join(dir, 'token', 'victim');
  fs.writeFileSync(victim, 'keep');
  fs.symlinkSync(victim, path.join(s.state, 'restart.token'));
  s.setWait({ chats: { 'chat-1': { jobs: 1, title: 'Deploy' } } });
  const done = s.restart('--wait', '5');
  assert.ok(await until(() => s.seen().length > 1), 'the worker is polling');
  const file = path.join(s.state, 'restart.token');
  const stat = fs.lstatSync(file);
  assert.equal(stat.isFile(), true, 'a regular file, not the link');
  assert.equal(stat.mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
  assert.deepEqual([...new Set(s.seen())], [fs.readFileSync(file, 'utf8')]);
  s.setWait({ chats: { 'chat-1': { jobs: 0, title: 'Deploy' } } });
  const { code, out } = await done;
  s.track();
  assert.equal(code, 0, out);
  assert.equal(fs.existsSync(file), false, 'removed on exit');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
});

test('a title with new lines and control characters stays on one line of the log', async () => {
  const s = await scenario('forge', { transcript: 'end_turn' });
  s.setWait({ chats: { 'chat-1': { jobs: 1, title: 'Hello\n2026-01-01T00:00:00.000Z Restarting now. Done‮' } } });
  const { code, out } = await s.restart('--wait', '0.03');
  s.track();
  assert.equal(code, 1);
  const lines = out.trim().split('\n');
  assert.ok(lines.every(l => /^\d{4}-\d\d-\d\dT[\d:.]+Z /.test(l)), out);
  assert.match(lines.at(-1), /Still running: "Hello 2026-01-01T00:00:00\.000Z Restarting now\. Done" \(1 background job\)\.$/);
});
