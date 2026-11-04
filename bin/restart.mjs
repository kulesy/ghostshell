// Restarts the launchd service once, when no chat is running. It never schedules anything: a submitted or KeepAlive job would relaunch itself.
// A chat that runs this is killed by the restart, so unless --foreground it hands the work to one detached worker and returns at once.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { cfg } from '../lib/config.mjs';
import { FALLBACK_LABEL, guard, labelOf, launchdList, listenerPid, lockHolder, MIN_UPTIME_MS, parseArgs, POLL_MS, psRows, runningChats, USAGE } from '../lib/restart.mjs';

if (process.platform !== 'darwin') { console.error('launchd is macOS only.'); process.exit(1); }

const opts = parseArgs(process.argv.slice(2));
if (opts.error) { console.error(`${opts.error}\n${USAGE}`); process.exit(1); }

const logFile = path.join(cfg.stateDir, 'restart.log');
const lockFile = path.join(cfg.stateDir, 'restart.lock');
const launchctl = process.env.CAPCOM_LAUNCHCTL || 'launchctl';
const minUptimeMs = Number(process.env.CAPCOM_RESTART_MIN_UPTIME_MS ?? MIN_UPTIME_MS);
const pollMs = Number(process.env.CAPCOM_RESTART_POLL_MS || POLL_MS);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = text => console.log(`${new Date().toISOString()} ${text}`);

// Only --now --take-over (the banner's Force restart) tells a waiting worker to stop waiting and exits; plain --now refuses, so a chat cannot cut other chats. Only a live restart worker is signalled,
// because a stale lock's pid can belong to another process by now, and an unhandled SIGUSR2 would kill it.
async function takeOver(pid) {
  if (!opts.takeOver) return false;
  const row = (await psRows()).find(r => r.pid === pid);
  const words = row?.command.split(/\s+/) ?? [];
  if (!words.includes('--foreground') || !words.some(w => w.endsWith('/restart.mjs'))) return false;
  try { process.kill(pid, 'SIGUSR2'); } catch { return false; }
  console.log(`Told the waiting restart worker (pid ${pid}) to restart now. See ${logFile}.`);
  process.exit(0);
}

const holder = fs.existsSync(lockFile) ? lockHolder(lockFile, process.pid) : null;
if (holder && !(await takeOver(holder))) { console.error(`A restart is already under way (pid ${holder}). See ${logFile}.`); process.exit(1); }

if (!opts.foreground) {
  const fd = fs.openSync(logFile, 'a');
  const forward = process.argv.slice(2).filter(a => a !== '--foreground');
  spawn(process.execPath, [process.argv[1], '--foreground', ...forward], { detached: true, stdio: ['ignore', fd, fd] }).unref();
  console.log(`Restart handed to a background worker. Progress is in ${logFile}`);
  process.exit(0);
}

// Installed before the lock is written, so a pid in the lock always has a handler and a SIGUSR2 to it never kills it.
let goNow = false;
process.on('SIGUSR2', () => { goNow = true; });

try { fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); } catch {
  const raced = lockHolder(lockFile, process.pid);
  if (raced && !(await takeOver(raced))) { console.error(`A restart is already under way. See ${logFile}.`); process.exit(1); }
  fs.writeFileSync(lockFile, String(process.pid));
}
const unlock = () => { try { if (Number(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.unlinkSync(lockFile); } catch {} };
process.on('exit', unlock);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
const fail = text => { log(text); process.exit(1); };

const answers = port => new Promise(resolve => {
  const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, res => { res.resume(); resolve(true); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});

const oldPid = await listenerPid(cfg.port);
let serverRow = null;
if (!oldPid) log(`Nothing is listening on port ${cfg.port}, so there are no chats to wait for.`);
else {
  serverRow = (await psRows()).find(r => r.pid === oldPid) ?? null;
  const refused = guard(serverRow?.seconds ?? null, minUptimeMs);
  if (refused) fail(refused);

  if (opts.now) log(`Restarting without waiting (server pid ${oldPid}).`);
  else {
    const deadline = Date.now() + opts.wait * 60_000;
    let clear = 0;
    log(`Waiting for no chat to be running (server pid ${oldPid}, up to ${opts.wait} minutes).`);
    // Two clear polls in a row, because a chat can go mid-turn between one check and the restart.
    while (clear < 2 && !goNow) {
      const busy = await runningChats(oldPid);
      clear = busy.length ? 0 : clear + 1;
      if (busy.length && Date.now() >= deadline) fail(`Gave up after ${opts.wait} minutes without restarting. Still running: ${busy.map(c => `pid ${c.pid}`).join(', ')}.`);
      if (clear < 2) await sleep(pollMs);
    }
    if (goNow) log('Told to stop waiting, so restarting now.');
  }
}

if (oldPid) {
  // The server can have crashed and come back during the wait, and the restart would then end its new chats.
  if ((await listenerPid(cfg.port)) !== oldPid) fail(`The server on port ${cfg.port} changed while waiting, so nothing was restarted. Run the command again.`);
}
const label = opts.label ?? labelOf(await launchdList(launchctl), [oldPid, serverRow?.ppid].filter(Boolean)) ?? FALLBACK_LABEL;
const target = `gui/${process.getuid()}/${label}`;
log(`Running launchctl kickstart -k ${target}`);
const kick = spawnSync(launchctl, ['kickstart', '-k', target], { encoding: 'utf8' });
if (kick.status !== 0) fail(`launchctl failed (${kick.status ?? kick.error?.code}): ${(kick.stderr || '').trim()}`);

for (const end = Date.now() + 30_000; Date.now() < end; await sleep(500)) {
  if (!(await answers(cfg.port))) continue;
  const pid = await listenerPid(cfg.port);
  if (pid && pid !== oldPid) { log(`answering on port ${cfg.port} (new pid ${pid})`); process.exit(0); }
}
fail(`The server did not answer on port ${cfg.port} as a new process within 30 seconds.`);
