// `npm test`: runs the suite with at most 4 files at once (2 on CI), at background priority on a Mac. Node runs every file at once without --test-concurrency,
// and each file starts a server and a browser. A full run (no file named) waits for any other full run on the Mac, so worktrees take turns.
//   npm test                                  the whole suite
//   npm test -- test/lock.test.mjs            only that file, with no lock
//   npm test -- --test-name-pattern=foo       other `node --test` flags pass through; give a flag's value after `=`
// See https://github.com/kulesy/ghostshell/issues/151.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquire } from '../lib/lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = '/tmp/ghostshell-node-test.lock';
// A CI runner has few cores, and four files each starting a server and a browser starve each other into timeouts.
const CONCURRENCY = process.env.CI ? 2 : 4;

const args = process.argv.slice(2);
const named = args.filter(a => !a.startsWith('-'));
const full = !named.length;
const files = full ? fs.readdirSync(path.join(root, 'test')).filter(n => n.endsWith('.test.mjs')).sort().map(n => path.join('test', n)) : [];

const node = ['--test', ...(args.some(a => a.startsWith('--test-concurrency')) ? [] : [`--test-concurrency=${CONCURRENCY}`]), ...args, ...files];
// taskpolicy -b lowers CPU and disk priority for the run and everything it starts, so the Mac stays usable. A CI runner has nothing to share.
const background = process.platform === 'darwin' && !process.env.CI;
const [command, ...commandArgs] = background ? ['taskpolicy', '-b', process.execPath, ...node] : [process.execPath, ...node];

let child = null;
// Before the lock is taken, so a signal while waiting exits (and the exit handler in lock.mjs gives the lock back). Once the suite runs, it is passed on and its exit ends this.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { if (child) child.kill(signal); else process.exit(128 + os.constants.signals[signal]); });
}

const release = full ? await acquire(LOCK, { what: 'the full Node test suite', checkout: root }) : () => {};
child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit' });
const code = await new Promise(resolve => {
  child.on('error', error => { console.error(`Could not start ${command}: ${error.message}`); resolve(1); });
  child.on('close', (status, signal) => resolve(status ?? 128 + os.constants.signals[signal]));
});
release();
process.exit(code);
