#!/usr/bin/env node
// Builds the watch app on its own. It is also built into the iPhone app, so `npm run apple:ios-build` covers it for a device.
//   node apple/scripts/watch.mjs build [--release]
// A Debug build is for the Simulator. A Release build is for a device with signing off, then searched for the Debug hooks like the Mac one.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNoHooks } from './build.mjs';

const apple = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED = path.join(apple, 'build', 'watch');

export function build({ release = false } = {}) {
  const args = release
    ? ['-configuration', 'Release', '-destination', 'generic/platform=watchOS', 'CODE_SIGNING_ALLOWED=NO']
    : ['-configuration', 'Debug', '-destination', 'generic/platform=watchOS Simulator'];
  const r = spawnSync('xcodebuild', ['-project', path.join(apple, 'GhostShell.xcodeproj'), '-scheme', 'GhostShellWatch', '-derivedDataPath', DERIVED, ...args, 'build'],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    console.error(r.stdout.split('\n').filter(l => /error:|BUILD FAILED/.test(l)).join('\n') || r.stderr);
    throw new Error(`The watch ${release ? 'Release' : 'Debug'} build failed.`);
  }
  const app = path.join(DERIVED, 'Build', 'Products', release ? 'Release-watchos' : 'Debug-watchsimulator', 'GhostShellWatch.app');
  // The watch bundle is flat, so its binaries are the executable and any dylib beside it.
  if (release) checkNoHooks(app, [path.join(app, 'GhostShellWatch'), ...fs.readdirSync(app).filter(n => n.endsWith('.dylib')).map(n => path.join(app, n))]);
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'build') throw new Error('Usage: watch.mjs build [--release]');
  const app = build({ release: process.argv.includes('--release') });
  if (!fs.existsSync(app)) throw new Error(`No app at ${app}`);
  console.log(app);
}
