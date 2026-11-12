// Run with `npm test`. The lock that `npm test` and the iPhone run share (lib/lock.mjs), on a folder in the temp directory, never /tmp/ghostshell-*.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquire } from '../lib/lock.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const lockAt = name => path.join(dir, name);
const opts = log => ({ what: 'the test lock', pollMs: 10, log });
const settled = promise => Promise.race([promise.then(() => true), new Promise(resolve => setTimeout(resolve, 150, false))]);
// A pid that has existed and is gone.
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

test('taking the lock writes an owner file, and giving it back removes the folder', async () => {
  const lock = lockAt('basic');
  const release = await acquire(lock, { ...opts(() => {}), checkout: '/some/checkout' });
  const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner'), 'utf8'));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.checkout, '/some/checkout');
  assert.ok(!Number.isNaN(Date.parse(owner.started)));
  release();
  assert.equal(fs.existsSync(lock), false);
});

test('a second run waits until the first gives the lock back, saying who holds it and when it has it', async () => {
  const lock = lockAt('wait');
  const lines = [];
  const first = await acquire(lock, opts(() => {}));
  const second = acquire(lock, opts(line => lines.push(line)));
  assert.equal(await settled(second), false, 'still waiting while the first holds it');
  assert.equal(lines.length, 1, 'says it is waiting once, however long it polls');
  assert.match(lines[0], new RegExp(`^Waiting for the test lock, held by pid ${process.pid} in `));
  first();
  const release = await second;
  assert.match(lines[1], /^Got the lock/);
  assert.equal(lines.length, 2);
  release();
  assert.equal(fs.existsSync(lock), false);
});

test('a lock whose owner is dead is taken over', async () => {
  const lock = lockAt('stale');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner'), JSON.stringify({ pid: deadPid(), checkout: '/gone', started: new Date().toISOString() }));
  const lines = [];
  const release = await acquire(lock, opts(line => lines.push(line)));
  assert.deepEqual(lines, [], 'no waiting');
  assert.equal(JSON.parse(fs.readFileSync(path.join(lock, 'owner'), 'utf8')).pid, process.pid);
  release();
  assert.equal(fs.existsSync(lock), false);
});

test('a folder with no owner file is waited for while it is young, and taken over once it is old', async () => {
  const lock = lockAt('half');
  fs.mkdirSync(lock);
  const second = acquire(lock, opts(() => {}));
  assert.equal(await settled(second), false, 'young');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  const release = await second;
  release();
  assert.equal(fs.existsSync(lock), false);
});

test('giving back a lock that another run has since taken over leaves the new owner\'s alone', async () => {
  const lock = lockAt('taken');
  const release = await acquire(lock, opts(() => {}));
  fs.writeFileSync(path.join(lock, 'owner'), JSON.stringify({ pid: process.ppid, checkout: '/other', started: new Date().toISOString() }));
  release();
  assert.equal(fs.existsSync(lock), true);
});
