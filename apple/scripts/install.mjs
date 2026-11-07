#!/usr/bin/env node
// Builds Release and installs it to ~/Applications/GhostShell.app. An old copy moves to ~/junk first, never deleted.
// It never touches bin/build-app.mjs or the Capcom app. --dry-run builds and says what it would do.
//   node apple/scripts/install.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from './build.mjs';

const dry = process.argv.includes('--dry-run');
const app = build({ release: true });
const target = path.join(os.homedir(), 'Applications', 'GhostShell.app');
const junk = path.join(os.homedir(), 'junk');
const old = fs.existsSync(target) ? path.join(junk, `GhostShell-${new Date().toISOString().replace(/[:.]/g, '-')}.app`) : null;

if (dry) {
  console.log(`Built ${app}`);
  console.log(old ? `Would move ${target} to ${old}` : `Nothing at ${target} to move`);
  console.log(`Would copy the build to ${target}`);
  process.exit(0);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
if (old) {
  fs.mkdirSync(junk, { recursive: true });
  fs.renameSync(target, old);
  console.log(`Moved the old copy to ${old}`);
}
execFileSync('ditto', [app, target]);
console.log(`Installed ${target}`);
console.log('The first launch asks once for Keychain access, because each new build has a new code signature.');
