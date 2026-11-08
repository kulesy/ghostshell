#!/usr/bin/env node
// Typechecks the screenshot helper, then runs the Swift tests: the unit tests, then the integration tests against two scratch servers (one is for the lockout, which ends a server's
// sign-in), then one Keychain round trip in a service made for this run. Servers always stop, even when a test fails.
//   node apple/scripts/test.mjs [--unit]
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startScratch } from './test-server.mjs';

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'GhostShellKit');
const run = (label, args, env = {}, timeout = 600_000) => {
  console.log(`\n== ${label}`);
  const r = spawnSync('swift', ['test', ...args], { cwd: kit, env: { ...process.env, ...env }, stdio: 'inherit', timeout });
  if (r.status !== 0) console.log(`${label} FAILED (${r.signal || r.status})`);
  return r.status === 0;
};

// The screenshot helper is compiled only by apple:shot, so a break in it would otherwise show only partway through a run.
const ax = spawnSync('swiftc', ['-typecheck', path.join(kit, '..', 'scripts', 'ax.swift')], { stdio: 'inherit', timeout: 120_000 });
console.log(ax.status === 0 ? '\n== ax.swift typechecks' : '\nax.swift does not typecheck');
let ok = ax.status === 0;
ok = run('unit tests', ['--skip', 'IntegrationTests', '--skip', 'KeychainTests']) && ok;
if (!process.argv.includes('--unit')) {
  let main, lock;
  try {
    main = await startScratch();
    lock = await startScratch({ empty: true });
    ok = run('integration tests', ['--filter', 'IntegrationTests'], {
      GS_SCRATCH_ADDRESS: main.address, GS_SCRATCH_PASSWORD_FILE: main.passwordFile, GS_LOCK_ADDRESS: lock.address, GS_LOCK_PASSWORD_FILE: lock.passwordFile,
    }) && ok;
  } finally {
    await main?.stop();
    await lock?.stop();
  }
  // The service name is new for the run, and the test removes its own items. A hung Keychain dialog ends at the timeout.
  const service = `gs-test-${crypto.randomBytes(6).toString('hex')}`;
  ok = run(`keychain round trip (service ${service})`, ['--filter', 'KeychainTests'], { GS_KEYCHAIN_TEST: service }, 60_000) && ok;
}
process.exit(ok ? 0 : 1);
