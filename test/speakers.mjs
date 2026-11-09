// Tells a test run whether its own processes made a sound. Several sessions run tests at once, so a sound is only counted against the pids
// it is asked about. A process that opens the speakers logs "--> setPlayState Started", and an alert beep is asked of systemsoundserverd,
// which logs the asking pid.
import { execFile, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const MARK = `speakers-${crypto.randomBytes(6).toString('hex')}`;
const PREDICATE = `eventMessage CONTAINS "--> setPlayState Started" OR (process == "systemsoundserverd" AND eventMessage CONTAINS "inClientPID") OR eventMessage CONTAINS "${MARK}"`;
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// Notes the time a run starts. Off macOS it hears nothing.
export function listen() {
  const since = stamp(new Date(Date.now() - 1000));
  return {
    // The log lines since then that put a sound out for one of `pids`. It reads the stored log, because `log stream` drops the sandboxed
    // browser's line. The newest lines take a while to land on a busy machine, so it reads until a mark logged now shows up.
    async heard(pids) {
      if (process.platform !== 'darwin') return [];
      const mark = `${MARK}-${Date.now()}`;
      spawnSync('/usr/bin/logger', [mark]);
      for (const until = Date.now() + 120_000; Date.now() < until;) {
        const { stdout } = await promisify(execFile)('/usr/bin/log', ['show', '--start', since, '--style', 'compact', '--predicate', PREDICATE], { maxBuffer: 1 << 26 });
        if (stdout.includes(mark)) return sounds(stdout, pids);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw new Error('The system log never caught up, so the run cannot tell whether it made a sound.');
    },
  };
}

function sounds(text, pids) {
  const wanted = new Set([...pids].filter(Boolean).map(String));
  return text.split('\n').filter(line => {
    const asker = line.match(/inClientPID (\d+)/);
    const owner = line.match(/^\S+ \S+ \S+ .*?\[(\d+):/);
    return asker ? wanted.has(asker[1]) : line.includes('--> setPlayState Started') && wanted.has(owner?.[1]);
  });
}

// `pid` and every process under it now. A browser's audio comes from a helper that quits when idle, so a test samples this while it plays.
export function family(pid) {
  const kids = new Map();
  for (const row of spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout.trim().split('\n')) {
    const [child, parent] = row.trim().split(/\s+/).map(Number);
    kids.set(parent, [...(kids.get(parent) ?? []), child]);
  }
  const all = [pid];
  for (let i = 0; i < all.length; i++) all.push(...(kids.get(all[i]) ?? []));
  return all;
}
