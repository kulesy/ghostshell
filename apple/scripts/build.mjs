#!/usr/bin/env node
// Builds the Mac app into apple/build (git-ignored). Prints the path of the .app.
//   node apple/scripts/build.mjs [--release]
// A Release build is then searched for the Debug hooks, and the build fails if any is found.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apple = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Words only the Debug hooks contain. A Release binary holding any of them has shipped a hook.
const HOOKS = ['GSKeychainService', 'GSAddress', 'GSDefaultsSuite', 'GSAppearance', 'GSShotDir', 'GSNotify', 'GSAlertLog', 'AlertLogPoster', 'ShotWatcher', 'ClickWatcher', 'DebugHooks', 'GSWatchFixture', 'FixtureRelay', 'request.txt', 'click.txt'];

export function build({ release = false } = {}) {
  const configuration = release ? 'Release' : 'Debug';
  const r = spawnSync('xcodebuild', ['-project', path.join(apple, 'GhostShell.xcodeproj'), '-scheme', 'GhostShell', '-configuration', configuration,
    '-derivedDataPath', path.join(apple, 'build'), 'build'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    console.error(r.stdout.split('\n').filter(l => /error:|BUILD FAILED/.test(l)).join('\n') || r.stderr);
    throw new Error(`The ${configuration} build failed.`);
  }
  const app = path.join(apple, 'build', 'Build', 'Products', configuration, 'GhostShell.app');
  if (release) checkNoHooks(app);
  return app;
}

// The Mac bundle keeps its binaries in Contents/MacOS. An iOS bundle is flat, so scripts/iphone.mjs names its binaries itself.
export function checkNoHooks(app, files = fs.readdirSync(path.join(app, 'Contents', 'MacOS')).map(name => path.join(app, 'Contents', 'MacOS', name))) {
  const found = new Set();
  for (const file of files) {
    const strings = spawnSync('strings', ['-a', file], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
    const symbols = spawnSync('nm', [file], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
    for (const word of HOOKS) if (strings.includes(word) || symbols.includes(word)) found.add(word);
  }
  if (found.size) throw new Error(`The binary holds Debug hooks: ${[...found].join(', ')}`);
  console.error(`Release check: none of ${HOOKS.length} hook words is in ${files.length} binaries (strings and nm).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = build({ release: process.argv.includes('--release') });
  if (!fs.existsSync(app)) throw new Error(`No app at ${app}`);
  console.log(app);
}
