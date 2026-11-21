#!/usr/bin/env node
// Pairs each Mac shot with the web page shot of the same screen and state, and writes a side-by-side image per pair and a list of what has no partner.
// Headless Chromium only. Set PLAYWRIGHT_CORE to the playwright-core folder of a checkout that has it.
//   node apple/scripts/parity.mjs --mac <folder of Mac shots> --page <folder holding page/> --out <folder>
// The Mac folder is the mac-screenshots artifact and the page folder is what page-shots.mjs wrote, at 960 and 640. parity-pairs.json says which shots go together.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findChromium, notFound } from '../../test/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The Mac window's default and minimum size, which the web page is rendered at too.
const SIZES = { default: { width: 960, height: 640 }, min: { width: 640, height: 420 } };
const SCHEMES = ['light', 'dark'];
const MAC_FILE = /^(.+?)(?:-(?:default|min))?-(light|dark)(?:-(?:default|min))?\.png$/;

// Given the file names in each folder and the pairs map, returns the pairs with both shots, the pairs with one, and the shots no pair names.
// macFiles are names such as `1-list-rows-light-default.png`; pageFiles are paths such as `960/light/list-rows.png`.
export function pairUp({ macFiles, pageFiles, pairs }) {
  const mac = new Set(macFiles);
  const page = new Set(pageFiles);
  const both = [];
  const half = [];
  for (const { mac: macBase, page: screen, note = '' } of pairs) {
    for (const scheme of SCHEMES) for (const size of Object.keys(SIZES)) {
      const macFile = [`${macBase}-${scheme}-${size}.png`, `${macBase}-${size}-${scheme}.png`, ...(size === 'default' ? [`${macBase}-${scheme}.png`] : [])].find(f => mac.has(f)) ?? null;
      const pageFile = page.has(`${SIZES[size].width}/${scheme}/${screen}.png`) ? `${SIZES[size].width}/${scheme}/${screen}.png` : null;
      if (!macFile && !pageFile) continue;
      const row = { mac: macBase, page: screen, scheme, size, macFile, pageFile, note, name: `${macBase}-${scheme}-${size}.png` };
      (macFile && pageFile ? both : half).push(row);
    }
  }
  const mapped = { mac: new Set(pairs.map(p => p.mac)), page: new Set(pairs.map(p => p.page)) };
  const unpairedMac = [...new Set(macFiles.map(f => MAC_FILE.exec(f)?.[1]).filter(Boolean))].filter(b => !mapped.mac.has(b)).sort();
  const unpairedPage = [...new Set(pageFiles
    .map(f => /^(?:960|640)\/(?:light|dark)\/(.+)\.png$/.exec(f)?.[1]).filter(Boolean))].filter(s => !mapped.page.has(s)).sort();
  return { pairs: both, half, unpairedMac, unpairedPage };
}

const list = dir => { try { return fs.readdirSync(dir); } catch { return []; } };

// The web page shots under <page>/page, as `<width>/<scheme>/<screen>.png`.
function pageFilesOf(root) {
  const found = [];
  for (const width of list(path.join(root, 'page'))) for (const scheme of list(path.join(root, 'page', width))) {
    for (const file of list(path.join(root, 'page', width, scheme))) if (file.endsWith('.png') && !file.endsWith('.FAILED.png')) found.push(`${width}/${scheme}/${file}`);
  }
  return found;
}

const escape = text => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Both images at the window's CSS size under a label each, on a neutral ground, so the two can be compared by eye.
function sideBySide(size, left, right) {
  const { width, height } = SIZES[size];
  const column = ({ label, file }) => `<figure><figcaption>${escape(label)}</figcaption><img width="${width}" height="${height}" src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}"></figure>`;
  return `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; background: #d8d8dc; }
body { display: flex; gap: 16px; padding: 16px; width: max-content; font: 13px/1.4 ui-monospace, Menlo, monospace; color: #222; }
figure { margin: 0; }
figcaption { height: 24px; white-space: pre; }
img { display: block; }
</style>${column(left)}${column(right)}`;
}

function table(rows, head) {
  const line = cells => `| ${cells.map(c => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

function report({ pairs, half, unpairedMac, unpairedPage }) {
  const bullets = items => (items.length ? items.map(i => `- ${i}`).join('\n') : 'None.');
  return [
    '# Pair run',
    `${pairs.length} pairs made, ${half.length} with one side missing, ${unpairedMac.length} Mac shots and ${unpairedPage.length} web shots with no pair.`,
    '## Pairs',
    table(pairs.map(p => [p.mac, p.page, p.scheme, p.size, p.name, p.note]), ['Mac', 'Web', 'Scheme', 'Size', 'Side by side', 'Note']),
    '## Pairs with one side missing',
    half.length ? table(half.map(p => [p.mac, p.page, p.scheme, p.size, p.macFile ? 'web' : 'Mac', p.note]), ['Mac', 'Web', 'Scheme', 'Size', 'Missing', 'Note']) : 'None.',
    '## Mac shots with no pair',
    bullets(unpairedMac),
    '## Web shots with no pair',
    bullets(unpairedPage),
  ].join('\n\n') + '\n';
}

async function main() {
  const argv = process.argv.slice(2);
  const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const [macDir, pageDir, outDir] = ['--mac', '--page', '--out'].map(name => (option(name) ? path.resolve(option(name)) : null));
  if (!macDir || !pageDir || !outDir) throw new Error('usage: node apple/scripts/parity.mjs --mac <folder> --page <folder holding page/> --out <folder>');
  if (!fs.existsSync(macDir)) throw new Error(`no Mac shot folder at ${macDir}`);
  if (!fs.existsSync(path.join(pageDir, 'page'))) throw new Error(`no page/ folder in ${pageDir}`);
  const headless = findChromium();
  if (!headless) throw new Error(notFound());
  // NOTE: [21 Nov 2026] EK - playwright-core is not a dependency of this repo, so PLAYWRIGHT_CORE points at a checkout that has it.
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || 'playwright-core');

  const result = pairUp({
    macFiles: list(macDir).filter(f => f.endsWith('.png')),
    pageFiles: pageFilesOf(pageDir),
    pairs: JSON.parse(fs.readFileSync(path.join(HERE, 'parity-pairs.json'), 'utf8')),
  });
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: headless });
  try {
    for (const size of Object.keys(SIZES)) {
      const { width, height } = SIZES[size];
      const page = await browser.newPage({ viewport: { width: width * 2 + 48, height: height + 24 + 32 }, deviceScaleFactor: 2 });
      for (const p of result.pairs.filter(r => r.size === size)) {
        await page.setContent(sideBySide(size,
          { label: `Mac  ${p.macFile}`, file: path.join(macDir, p.macFile) },
          { label: `Web  ${p.pageFile}`, file: path.join(pageDir, 'page', p.pageFile) }));
        await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
        await page.screenshot({ path: path.join(outDir, p.name) });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(outDir, 'pairs.md'), report(result));
  console.log(`${result.pairs.length} pairs made, ${result.half.length} with one side missing, ${result.unpairedMac.length} Mac and ${result.unpairedPage.length} web shots with no pair. See ${path.join(outDir, 'pairs.md')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
