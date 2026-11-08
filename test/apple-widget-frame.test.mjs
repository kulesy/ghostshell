// Run with `npm test`. The Swift app builds the widget frame from a generated file, and this fails while that file is behind the page's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generate, rawLiteral, TARGET } from '../apple/scripts/widget-frame.mjs';

test('the generated Swift file matches public/ui/widget-frame.js and widget-theme.js', () => {
  assert.equal(fs.readFileSync(TARGET, 'utf8'), generate(), 'run: node apple/scripts/widget-frame.mjs');
});

test('a raw literal takes enough hashes that nothing inside can close it or escape', () => {
  assert.match(rawLiteral('plain'), /^#"""\nplain\n"""#$/);
  assert.match(rawLiteral('a "# b'), /^##"""/);
  assert.match(rawLiteral('a "## b \\# c'), /^###"""/);
  assert.match(rawLiteral('a \\## b'), /^###"""/);
});
