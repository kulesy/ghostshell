// Run with `npm test`. The pull requests each session names, as the scan that feeds Ctrl+K reads them from a projects folder: which links count, how a
// pass skips what has not changed, picks up what grew and forgets what is gone, and what the thread around it does when the worker fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeLinkScan, startPullLinks } from '../lib/pull-links.mjs';
import { until } from './harness.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-pull-links-'));
let made = 0;
const fresh = () => {
  const dir = path.join(root, `case-${++made}`);
  fs.mkdirSync(path.join(dir, '-work'), { recursive: true });
  return dir;
};
const fileOf = (dir, id) => path.join(dir, '-work', `${id}.jsonl`);
const pr = (n, repo = 'acme/web') => `https://github.com/${repo}/pull/${n}`;
const said = text => ({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text }] } });
const typed = text => ({ type: 'user', message: { role: 'user', content: text } });
const gave = output => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: output }] } });
const injected = text => ({ type: 'user', isMeta: true, message: { role: 'user', content: text } });
const lines = entries => entries.map(e => `${JSON.stringify(e)}\n`).join('');
const write = (dir, id, entries, ago = 0) => {
  const file = fileOf(dir, id);
  fs.writeFileSync(file, lines(entries));
  const at = (Date.now() - ago) / 1000;
  fs.utimesSync(file, at, at);
};
const append = (dir, id, entries, ago = 0) => {
  const file = fileOf(dir, id);
  fs.appendFileSync(file, lines(entries));
  const at = (Date.now() - ago) / 1000;
  fs.utimesSync(file, at, at);
};

test('every pull request a session names is a link, in the case it was written in, once however often or however spelled', () => {
  const dir = fresh();
  write(dir, 'a', [
    said(`Opened ${pr(7969)} and ${pr(12, 'acme/docs')}`),
    typed(`also ${pr(7969)} again, and https://github.com/ACME/Web/pull/7969/files`),
    said(`and ${pr(3, 'Acme/Tools')}`),
  ]);
  const scan = makeLinkScan(dir);
  assert.equal(scan.pass(), true);
  assert.deepEqual(scan.links(), { a: ['acme/web#7969', 'acme/docs#12', 'Acme/Tools#3'] });
});

test('a bare address that ends a tool result counts and a listing of pull requests does not, and neither does text a skill or CLAUDE.md injected', () => {
  const dir = fresh();
  write(dir, 'made', [gave(`Creating pull request\n${pr(40)}\n`)]);
  write(dir, 'listing', [gave(`${pr(1)}\n${pr(2)}\nDone`)]);
  write(dir, 'meta', [injected(`Read ${pr(50)} first`)]);
  const scan = makeLinkScan(dir);
  scan.pass();
  assert.deepEqual(scan.links(), { made: ['acme/web#40'] });
});

test('a session with no pull request has no entry, and a line that is not JSON or has an odd shape is passed over', () => {
  const dir = fresh();
  write(dir, 'none', [said('Nothing linked here /pull/ but not an address')]);
  fs.appendFileSync(fileOf(dir, 'none'), `not json /pull/\n`);
  write(dir, 'one', [said(pr(5))]);
  fs.appendFileSync(fileOf(dir, 'one'), `null /pull/\n${JSON.stringify({ type: 'assistant', message: { content: [null], note: '/pull/' } })}\n`);
  append(dir, 'one', [said(pr(6))]);
  const scan = makeLinkScan(dir);
  scan.pass();
  assert.deepEqual(scan.links(), { one: ['acme/web#5', 'acme/web#6'] });
});

test('a second pass over files that did not change reports no change, and one that grew gives the links it gained', () => {
  const dir = fresh();
  write(dir, 'a', [said(pr(1))]);
  write(dir, 'b', [said(pr(2))]);
  const scan = makeLinkScan(dir);
  assert.equal(scan.pass(), true);
  assert.equal(scan.pass(), false);
  append(dir, 'a', [said(pr(9, 'acme/docs'))], 1000);
  assert.equal(scan.pass(), true);
  assert.deepEqual(scan.links(), { a: ['acme/web#1', 'acme/docs#9'], b: ['acme/web#2'] });
  assert.equal(scan.pass(), false);
});

test('a transcript that was rewritten loses the links it no longer names', () => {
  const dir = fresh();
  write(dir, 'a', [said(`${pr(1)} ${pr(2)}`), said('a long line to make the first file longer than the second one')]);
  const scan = makeLinkScan(dir);
  scan.pass();
  write(dir, 'a', [said(pr(3))], 5000);
  assert.equal(scan.pass(), true);
  assert.deepEqual(scan.links(), { a: ['acme/web#3'] });
});

test('a session whose transcript is gone is dropped, and the pass says so', () => {
  const dir = fresh();
  write(dir, 'a', [said(pr(1))]);
  write(dir, 'b', [said(pr(2))]);
  const scan = makeLinkScan(dir);
  scan.pass();
  fs.renameSync(fileOf(dir, 'a'), path.join(root, `moved-${made}.jsonl`));
  assert.equal(scan.pass(), true);
  assert.deepEqual(scan.links(), { b: ['acme/web#2'] });
  assert.equal(scan.pass(), false);
});

test('a file that cannot be read is skipped and tried again on the next pass, and the others are still read', () => {
  const dir = fresh();
  write(dir, 'good', [said(pr(1))]);
  fs.mkdirSync(fileOf(dir, 'bad'));
  const scan = makeLinkScan(dir);
  assert.doesNotThrow(() => scan.pass());
  assert.deepEqual(scan.links(), { good: ['acme/web#1'] });
  fs.rmdirSync(fileOf(dir, 'bad'));
  write(dir, 'bad', [said(pr(2))]);
  assert.equal(scan.pass(), true);
  assert.deepEqual(scan.links(), { good: ['acme/web#1'], bad: ['acme/web#2'] });
});

test('a pass reports its progress about every 100 files it read, newest first, and the last of them without a report', () => {
  const dir = fresh();
  for (let n = 0; n < 230; n++) write(dir, `s${String(n).padStart(3, '0')}`, [said(pr(n + 1))], n * 1000);
  const scan = makeLinkScan(dir);
  const reported = [];
  assert.equal(scan.pass({ onProgress: () => reported.push(Object.keys(scan.links()).length) }), true);
  assert.deepEqual(reported, [100, 200]);
  assert.equal(Object.keys(scan.links()).length, 230);
});

test('a pass that reads a lot of files with no new link reports nothing along the way', () => {
  const dir = fresh();
  for (let n = 0; n < 120; n++) write(dir, `s${n}`, [said('no links')]);
  const scan = makeLinkScan(dir);
  let calls = 0;
  assert.equal(scan.pass({ onProgress: () => calls++ }), false);
  assert.equal(calls, 0);
});

test('a worker that fails is logged once, search keeps what it had, and reading stops', async () => {
  const dir = fresh();
  const worker = path.join(dir, 'broken-worker.mjs');
  fs.writeFileSync(worker, "throw new Error('boom');\n");
  const told = [];
  const held = startPullLinks({ projectsDir: dir, worker: new URL(`file://${worker}`), log: message => told.push(message) });
  assert.deepEqual(held.get(), { links: {}, reading: true });
  await until(() => !held.get().reading);
  assert.deepEqual(held.get().links, {});
  assert.deepEqual(told, ['Pull request search stopped reading: boom']);
});

test('the worker reads a projects folder, says when its first pass ends, and then picks up a change', async () => {
  const dir = fresh();
  write(dir, 'a', [said(pr(7969))]);
  const held = startPullLinks({ projectsDir: dir, everyMs: 100 });
  assert.deepEqual(held.get(), { links: {}, reading: true });
  await until(() => !held.get().reading);
  assert.deepEqual(held.get().links, { a: ['acme/web#7969'] });
  append(dir, 'a', [said(pr(1, 'acme/docs'))], 1000);
  await until(() => held.get().links.a?.length === 2, 5000);
  assert.deepEqual(held.get(), { links: { a: ['acme/web#7969', 'acme/docs#1'] }, reading: false });
});
