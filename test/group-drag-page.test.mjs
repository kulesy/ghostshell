// Run with `npm test`. A group's header dragged in the real page: the line where it would land, the order the server keeps, the Move to strip
// when the projects sidebar is shut and the sidebar's own rows when it is open, and a plain click that still folds. It needs Playwright's
// Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const GROUPS = [
  { id: 'cg-a', name: 'Reviewing' },
  { id: 'cg-b', name: 'Backlog' },
  { id: 'cg-c', name: 'Notes' },
];
const SESSIONS = [
  { id: 's1', title: 'In reviewing', group: 'cg-a', ago: 1 },
  { id: 's2', title: 'In backlog', group: 'cg-b', ago: 2 },
  { id: 's3', title: 'In notes', group: 'cg-c', ago: 3 },
];
const PROJECTS = { projects: [{ id: 'cp-x', name: 'Capcom' }] };

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let browser;

before(async () => {
  if (!skip) browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const bar = name => `[...document.querySelectorAll('.bar')].find(el => el.querySelector('.name').textContent === ${JSON.stringify(name)})`;
const NAMES = `[...document.querySelectorAll('.group-head[data-key^="cg-"] .name')].map(el => el.textContent)`;

async function appPage(t, { docked = false } = {}) {
  const server = await start({ sessions: SESSIONS, groups: GROUPS, layout: PROJECTS });
  const setter = await browser.open(`${server.origin}/healthz`);
  await setter.evaluate(`localStorage.setItem('capcom.projectsDocked', '${docked}'); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  const page = await browser.open(`${server.origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || (${LIST}))`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
  }
  await page.until(`document.querySelectorAll('.group-head[data-key^="cg-"]').length === 3`);
  return { page, server };
}

const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const order = s => onDisk(s).groups.filter(g => !g.project).map(g => g.name);
const middleOf = selector => `(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))(document.querySelector('${selector}').getBoundingClientRect())`;
const bottomOf = name => `(r => ({ x: r.x + r.width / 2, y: r.bottom - 2 }))((${bar(name)}).closest('.group').getBoundingClientRect())`;

test('a header carried to the bottom of the groups draws the line under the last one and the drop saves that order', { skip, timeout }, async t => {
  const { page, server } = await appPage(t);
  const release = await page.carry(`.bar:has(.group-head[data-key="cg-a"])`, bottomOf('Notes'));
  assert.equal(await page.evaluate(`document.querySelectorAll('.bar.lifted').length`), 1);
  assert.equal(await page.evaluate(`document.querySelector('.group[data-line]')?.dataset.line + ':' + document.querySelector('.group[data-line] .name').textContent`), 'after:Notes');
  assert.equal(await page.evaluate(`document.querySelectorAll('.drop-hint').length`), 0);
  await release();
  await page.until(`${NAMES}.join() === 'Backlog,Notes,Reviewing'`);
  assert.deepEqual(order(server), ['Backlog', 'Notes', 'Reviewing']);
  assert.equal(await page.evaluate(`document.querySelector('[data-sonner-toast]').textContent`), 'Moved “Reviewing” below “Notes”.');
  assert.equal(await page.evaluate(`document.activeElement.closest('.group-head')?.querySelector('.name').textContent`), 'Reviewing');
  assert.deepEqual(page.problems, []);
});

test('a header let go where it already is draws no line and changes nothing, and a plain click folds the group', { skip, timeout }, async t => {
  const { page, server } = await appPage(t);
  const before = JSON.stringify(onDisk(server).groups);
  const release = await page.carry(`.bar:has(.group-head[data-key="cg-b"])`, `(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 + 12 }))(document.querySelector('.group-head[data-key="cg-b"]').getBoundingClientRect())`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.group[data-line]').length`), 0);
  await release();
  assert.equal(JSON.stringify(onDisk(server).groups), before);
  assert.equal(await page.evaluate(`document.querySelector('.group-head[data-key="cg-b"]').getAttribute('aria-expanded')`), 'true');
  await page.click('.group-head[data-key="cg-b"]');
  await page.until(`document.querySelector('.group-head[data-key="cg-b"]').getAttribute('aria-expanded') === 'false'`);
});

test('with the sidebar shut a Move to strip of the projects shows during the drag and a drop on one moves the group there', { skip, timeout }, async t => {
  const { page, server } = await appPage(t);
  assert.equal(await page.evaluate(`document.querySelectorAll('.move-strip').length`), 0);
  const release = await page.carry(`.bar:has(.group-head[data-key="cg-a"])`, middleOf('.move-chip'));
  assert.equal(await page.evaluate(`document.querySelectorAll('.move-chip').length`), 1);
  assert.equal(await page.evaluate(`document.querySelector('.move-chip').dataset.over`), 'true');
  await release();
  await page.until(`${NAMES}.join() === 'Backlog,Notes'`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.move-strip').length`), 0);
  assert.equal(onDisk(server).groups.find(g => g.id === 'cg-a').project, 'cp-x');
  assert.deepEqual(page.problems, []);
});

test('with the sidebar open its rows are the targets, and a drop on a project moves the group there', { skip, timeout }, async t => {
  const { page, server } = await appPage(t, { docked: true });
  await page.until(`!!document.querySelector('.scope[data-key="cp-x"]')`);
  const release = await page.carry(`.bar:has(.group-head[data-key="cg-a"])`, middleOf('.scope[data-key="cp-x"]'));
  assert.equal(await page.evaluate(`document.querySelectorAll('.move-strip').length`), 0);
  assert.equal(await page.evaluate(`document.querySelector('.scope[data-key="cp-x"]').dataset.over`), 'true');
  assert.equal(await page.evaluate(`document.querySelectorAll('.scope.home[data-drop]').length`), 0);
  await release();
  await page.until(`${NAMES}.join() === 'Backlog,Notes'`);
  assert.equal(onDisk(server).groups.find(g => g.id === 'cg-a').project, 'cp-x');
  assert.equal(await page.evaluate(`document.querySelector('[data-sonner-toast]').textContent`), 'Moved “Reviewing” to Capcom.');
  assert.deepEqual(page.problems, []);
});
