// Run with `npm test`. Taps in the image viewer, in a real page with the app's own styles. Chromium has no Safari double-tap zoom, so these hold
// the click that is cancelled to keep that zoom away and the taps it must leave alone. It needs Playwright's Chromium headless shell, and every test
// skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound, serve } from './browser.mjs';

const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700"><rect width="900" height="700" fill="teal"/></svg>')}`;
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css">
<script type="importmap">{ "imports": { "preact": "/vendor/preact.mjs", "preact/hooks": "/vendor/hooks.mjs", "htm": "/vendor/htm.mjs" } }</script></head>
<body><div id="app"></div><div id="viewer"></div><script type="module">
import { html, render } from '/ui/html.js';
import { openViewer, ViewerHost } from '/ui/viewer.js';
window.clicks = [];
document.addEventListener('click', e => clicks.push({ on: e.target.className, cancelled: e.defaultPrevented }));
render(html\`<\${ViewerHost} />\`, document.getElementById('viewer'));
openViewer([{ key: 'a', src: ${JSON.stringify(PICTURE)}, alt: 'teal' }], 0, null);
</script></body></html>`;

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 20_000;
let site;
let browser;

before(async () => {
  if (skip) return;
  site = await serve({ '/': PAGE });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const SIZE = `document.querySelector('.viewer-stage')?.dataset.size`;

async function viewerPage(t) {
  const page = await browser.open(`${site.origin}/`, { phone: true });
  t.after(() => page.close());
  await page.until(`document.querySelector('.viewer-img')?.dataset.state === 'ready' && document.querySelector('.viewer-fit').getAttribute('aria-disabled') === 'false'`);
  return page;
}

// Two taps 100ms apart by the touches' own times, so a slow machine cannot stretch them past the viewer's double tap.
async function doubleTap(page, selector) {
  const point = await page.evaluate(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const start = Date.now() / 1000;
  for (const [type, ms] of [['touchStart', 0], ['touchEnd', 40], ['touchStart', 100], ['touchEnd', 140]]) {
    await page.call('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchStart' ? [point] : [], timestamp: start + ms / 1000 });
  }
}

test('a tap on the picture has its click cancelled and leaves the viewer open at fit', { skip, timeout }, async t => {
  const page = await viewerPage(t);
  await page.tap('.viewer-img');
  await page.until(`clicks.length === 1`);
  assert.deepEqual(await page.evaluate('clicks'), [{ on: 'viewer-img', cancelled: true }]);
  assert.equal(await page.evaluate(SIZE), 'fit');
  assert.deepEqual(page.problems, []);
});

test('a double tap still zooms the picture, with the page left at its own size', { skip, timeout }, async t => {
  const page = await viewerPage(t);
  await doubleTap(page, '.viewer-img');
  await page.until(`${SIZE} === 'zoom'`);
  assert.equal(await page.evaluate('visualViewport.scale'), 1);
  assert.deepEqual(page.problems, []);
});

test('a tap on a button or the backdrop keeps its click, so the button works and the backdrop closes the viewer', { skip, timeout }, async t => {
  const page = await viewerPage(t);
  await page.tap('.viewer-fit');
  await page.until(`${SIZE} === 'zoom'`);
  await page.tap('.viewer-fit');
  await page.until(`${SIZE} === 'fit'`);
  await page.tap('.viewer-bar');
  await page.until(`!document.querySelector('.viewer')`);
  assert.ok((await page.evaluate('clicks')).every(c => !c.cancelled));
  assert.deepEqual(page.problems, []);
});
