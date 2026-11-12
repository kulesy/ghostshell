// A lock between runs on one Mac, shared by `npm test` and the iPhone Simulator run so worktrees take turns instead of piling up.
// It is a folder made with `mkdir`, which only one run can do, holding an `owner` file that names the run. See apple/README.md.
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
// The owner has made the folder and not yet written its file for this long before the folder counts as abandoned.
const YOUNG_MS = 5000;

function readOwner(lock) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner'), 'utf8'));
    return Number.isInteger(owner.pid) ? owner : null;
  } catch { return null; }
}

// Waits for `lock`, then returns a function that gives it back. `what` names the thing being locked in the messages. `checkout` is the
// path of the repo taking the lock, so the run that waits can say whose turn it is.
export async function acquire(lock, { what, checkout = process.cwd(), pollMs = 1000, log = console.log } = {}) {
  let announced = false;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, 'owner'), JSON.stringify({ pid: process.pid, checkout, started: new Date().toISOString() }));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const first = readOwner(lock);
    const young = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) < YOUNG_MS;
    const dead = first ? !alive(first.pid) : !young;
    // Read the owner again just before clearing, so a lock another run has only now retaken is left alone.
    if (dead && readOwner(lock)?.pid === first?.pid) {
      const stale = `${lock}.stale-${process.pid}`;
      try { fs.renameSync(lock, stale); fs.rmSync(stale, { recursive: true, force: true }); continue; } catch { /* another run got there first */ }
    }
    if (!announced) {
      announced = true;
      log(`Waiting for ${what}, held by ${first ? `pid ${first.pid} in ${first.checkout} since ${first.started}` : 'another run'} (${lock}).`);
    }
    await sleep(pollMs);
  }
  if (announced) log(`Got the lock for ${what}.`);
  const release = () => {
    process.removeListener('exit', release);
    // Only the owner removes it, so a run whose lock was taken over as stale does not delete the new owner's.
    try { if (readOwner(lock)?.pid === process.pid) fs.rmSync(lock, { recursive: true, force: true }); } catch { /* left for the stale check */ }
  };
  process.once('exit', release);
  return release;
}
