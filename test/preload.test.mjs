// Run with `npm test`. Every page module reachable from app.js by a relative import needs a modulepreload line in index.html,
// or the browser finds it only after it has loaded and read the module that imports it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const served = new URL('../public/', import.meta.url).pathname;
const html = fs.readFileSync(path.join(served, 'index.html'), 'utf8');
const preloaded = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(m => path.join(served, m[1])));

const reachable = new Set();
const walk = file => {
  if (reachable.has(file)) return;
  reachable.add(file);
  const source = fs.readFileSync(file, 'utf8');
  for (const [, spec] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)) walk(path.resolve(path.dirname(file), spec));
};
walk(path.join(served, 'app.js'));

test('every module reachable from app.js has a modulepreload line', () => {
  const missing = [...reachable].filter(file => !preloaded.has(file)).map(file => path.relative(served, file)).sort();
  assert.deepEqual(missing, []);
});
