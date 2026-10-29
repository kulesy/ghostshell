// The parts of `npm run restart` that decide things: what the arguments mean, which of the server's children are chats, and whether a chat
// is mid-turn. The process and file reads sit in small functions at the bottom so the rules above them can be tested with plain data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const FALLBACK_LABEL = 'local.capcom';
export const DEFAULT_WAIT_MINUTES = 30;
export const MIN_UPTIME_MS = 60_000;
export const POLL_MS = 5000;
const TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 16 * 1024 * 1024;

export const USAGE = 'Usage: npm run restart -- [--now] [--wait <minutes>] [--label <name>] [--foreground]\n'
  + 'Waits until no chat is running, then restarts the service once. --now restarts at once, --wait is how long to wait (default 30).\n'
  + '--label is the launchd job, by default the one running the server.\n'
  + 'A label uses letters, digits, dots, dashes and underscores.';

// Returns the options, or { error } for the caller to print above the usage.
export function parseArgs(argv) {
  const opts = { now: false, foreground: false, wait: DEFAULT_WAIT_MINUTES, label: null };
  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = argv[i].split(/=(.*)/s);
    const value = () => (inline !== undefined ? inline : argv[++i]);
    if (name === '--now' && inline === undefined) opts.now = true;
    else if (name === '--foreground' && inline === undefined) opts.foreground = true;
    else if (name === '--wait') {
      const raw = value();
      const minutes = /^\d+(\.\d+)?$/.test(raw ?? '') ? Number(raw) : NaN;
      if (!(minutes > 0)) return { error: '--wait needs a number of minutes above 0.' };
      opts.wait = minutes;
    } else if (name === '--label') {
      opts.label = value();
      if (!opts.label || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(opts.label)) return { error: '--label needs a valid name.' };
    } else return { error: `Unknown argument ${argv[i]}.` };
  }
  return opts;
}

// ps prints elapsed time as [[dd-]hh:]mm:ss.
export function parseEtime(text) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text ?? '');
  return m ? (((Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3])) * 60 + Number(m[4])) : null;
}

// Lines of `ps -axo pid=,ppid=,etime=,command=`.
export function parsePs(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), seconds: parseEtime(m[3]), command: m[4] });
  }
  return rows;
}

// A chat is `claude -p`. The slash menu probe passes --no-session-persistence and never holds a turn.
export function isChat(command) {
  const words = command.split(/\s+/);
  const at = words.findIndex(w => path.basename(w) === 'claude');
  return at >= 0 && words.slice(at + 1).includes('-p') && !words.includes('--no-session-persistence');
}

export function resumeId(command) {
  const words = command.split(/\s+/);
  const at = Math.max(words.indexOf('--resume'), words.indexOf('--session-id'));
  const id = at >= 0 ? words[at + 1] : null;
  return id && /^[\w-]+$/.test(id) ? id : null;
}

export const chatsOf = (rows, serverPid) => rows.filter(r => r.ppid === serverPid && isChat(r.command));

// The last user or assistant entry in the end of a transcript. The first line is dropped when the read began mid-file, and a last line
// still being written is skipped because it does not parse.
export function lastTurnEntry(tail, partial) {
  const lines = tail.split('\n');
  if (partial) lines.shift();
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry && (entry.type === 'user' || entry.type === 'assistant')) return entry;
  }
  return null;
}

// Idle only when the turn ended. A tool call, a tool result, a user message or no entry at all counts as running.
// A turn the user stopped, and one the CLI ended itself with a synthetic reply (a limit or an API error), leave the process up but idle.
export function isIdle(entry) {
  if (entry?.type === 'assistant') return entry.message?.stop_reason === 'end_turn' || entry.message?.model === '<synthetic>';
  const content = entry?.message?.content;
  const text = typeof content === 'string' ? content : content?.[0]?.text;
  return entry?.type === 'user' && typeof text === 'string' && text.startsWith('[Request interrupted by user');
}

// Refuses a restart of a server that has only just started, which is what stops a restart loop at its second pass.
export function guard(uptimeSeconds, minMs = MIN_UPTIME_MS) {
  if (uptimeSeconds === null || uptimeSeconds * 1000 >= minMs) return null;
  const wait = Math.ceil(minMs / 1000 - uptimeSeconds);
  return `The server started ${uptimeSeconds} seconds ago. Wait ${wait} more seconds before restarting it.`;
}

// `launchctl list` prints "pid status label" lines. The job running the server is the one whose pid is the server or its parent, which
// is the app wrapper when the service runs through Capcom.app.
export function labelOf(listing, pids) {
  for (const line of String(listing).split('\n')) {
    const [pid, , label] = line.trim().split(/\s+/);
    if (label && pids.includes(Number(pid))) return label;
  }
  return null;
}

export const projectDirName = cwd => cwd.replace(/[^A-Za-z0-9]/g, '-');

const run = (file, args) => new Promise(resolve => {
  execFile(file, args, { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err && !stdout ? '' : stdout));
});

export const psRows = async () => parsePs(await run('ps', ['-axo', 'pid=,ppid=,etime=,command=']));

export const launchdList = launchctl => run(launchctl, ['list']);

export async function listenerPid(port) {
  const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  const pid = Number(out.split('\n').find(Boolean));
  return pid > 0 ? pid : null;
}

// Entries such as attachments can fill the end of a transcript, so it is read back in chunks until a user or assistant entry turns up.
function lastTurnOf(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    for (let len = TAIL_BYTES; ; len *= 4) {
      const start = Math.max(0, size - len);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const entry = lastTurnEntry(buf.toString('utf8'), start > 0);
      if (entry || start === 0 || len >= MAX_TAIL_BYTES) return entry;
    }
  } finally { fs.closeSync(fd); }
}

// The pid of the live restart that holds the lock file, or null when there is no file, it holds no pid, that pid is `except` (the
// caller's own) or no such process runs. A process owned by someone else (EPERM) is alive.
export function lockHolder(lockFile, except = null) {
  let pid;
  try { pid = Number(fs.readFileSync(lockFile, 'utf8').trim() || 0); } catch { return null; }
  if (!(pid > 0) || pid === except) return null;
  try { process.kill(pid, 0); return pid; } catch (e) { return e.code === 'EPERM' ? pid : null; }
}

const projectsDir = () => path.join(os.homedir(), '.claude', 'projects');

function transcriptFor(id) {
  for (const dir of fs.readdirSync(projectsDir())) {
    const file = path.join(projectsDir(), dir, `${id}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// A chat with no id on its command line has not told which transcript is its own. It is read only when its folder holds exactly one
// written since it started, because the newest of several may be another session's.
async function onlyTranscriptSince(pid, seconds) {
  const out = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const cwd = out.split('\n').find(l => l.startsWith('n'))?.slice(1);
  if (!cwd) return null;
  const dir = path.join(projectsDir(), projectDirName(cwd));
  const since = Date.now() - (seconds ?? 0) * 1000 - 1000;
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl') && fs.statSync(path.join(dir, name)).mtimeMs >= since);
  return files.length === 1 ? path.join(dir, files[0]) : null;
}

// True when the chat may be mid-turn. Anything that cannot be read counts as running, to be safe.
export async function isRunning(chat) {
  try {
    const id = resumeId(chat.command);
    const file = id ? transcriptFor(id) : await onlyTranscriptSince(chat.pid, chat.seconds);
    if (!file) return true;
    return !isIdle(lastTurnOf(file));
  } catch { return true; }
}

export async function runningChats(serverPid) {
  const chats = chatsOf(await psRows(), serverPid);
  const states = await Promise.all(chats.map(isRunning));
  return chats.filter((_, i) => states[i]);
}
