// Run with `npm test`. The pair run matches each Mac shot to the web page shot of the same screen, size and scheme.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pairUp } from '../apple/scripts/parity.mjs';

const pairs = [{ mac: '1-list-rows', page: 'list-rows' }, { mac: '6-chat-rich-middle', page: '04-chat-scrolled', note: 'scroll positions differ' }];

test('a pair needs both shots, and a Mac shot with no size suffix is the default size', () => {
  const result = pairUp({
    macFiles: ['1-list-rows-light-default.png', '1-list-rows-light-min.png', '6-chat-rich-middle-dark.png'],
    pageFiles: ['960/light/list-rows.png', '640/light/list-rows.png', '960/dark/04-chat-scrolled.png'],
    pairs,
  });
  assert.deepEqual(result.pairs.map(p => p.name), ['1-list-rows-light-default.png', '1-list-rows-light-min.png', '6-chat-rich-middle-dark-default.png']);
  assert.equal(result.pairs[2].macFile, '6-chat-rich-middle-dark.png');
  assert.equal(result.pairs[2].note, 'scroll positions differ');
  assert.deepEqual(result.half, []);
});

test('a pair with one shot is half missing, and one with neither is left out', () => {
  const result = pairUp({ macFiles: ['1-list-rows-light-default.png'], pageFiles: ['640/dark/list-rows.png'], pairs });
  assert.deepEqual(result.pairs, []);
  assert.deepEqual(result.half.map(p => [p.scheme, p.size, p.macFile, p.pageFile]), [
    ['light', 'default', '1-list-rows-light-default.png', null],
    ['dark', 'min', null, '640/dark/list-rows.png'],
  ]);
});

test('shots no pair names are listed once each, and phone widths are ignored', () => {
  const result = pairUp({
    macFiles: ['1-list-rows-light-default.png', '3-extra-light-default.png', '3-extra-dark-min.png', '3-extra-dark.png', 'notes.txt'],
    pageFiles: ['960/light/list-rows.png', '960/light/extra.png', '640/dark/extra.png', '375/light/phone-only.png'],
    pairs,
  });
  assert.deepEqual(result.unpairedMac, ['3-extra']);
  assert.deepEqual(result.unpairedPage, ['extra']);
});

test('a Mac shot named size first, as in 6-chat-rich-middle-min-light, pairs and is not listed unpaired', () => {
  const result = pairUp({ macFiles: ['6-chat-rich-middle-min-light.png'], pageFiles: ['640/light/04-chat-scrolled.png'], pairs });
  assert.deepEqual(result.pairs.map(p => [p.size, p.macFile]), [['min', '6-chat-rich-middle-min-light.png']]);
  assert.deepEqual(result.unpairedMac, []);
});

test('the ledger header counts match the statuses in its rows', () => {
  const ledger = fs.readFileSync(new URL('../docs/parity.md', import.meta.url), 'utf8');
  const counts = {};
  for (const [, status] of ledger.matchAll(/^\| \d+\.\d+ \| [^|]+ \| (\w+) \|/gm)) counts[status] = (counts[status] ?? 0) + 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const header = /^- \*\*Rows\.\*\* (\d+): (.+)\.$/m.exec(ledger);
  assert.ok(header, 'docs/parity.md needs its "- **Rows.** N: status count, ..." line');
  assert.equal(Number(header[1]), total);
  assert.deepEqual(Object.fromEntries(header[2].split(', ').map(s => s.split(' ')).map(([k, v]) => [k, Number(v)])), counts);
});
