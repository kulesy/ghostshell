// Run with `npm test`. Lifting a row of the list: a finger that holds still after the long press asks for the row's menu and leaves the
// list where it is, and one that moves drags the row, onto a section or onto another row. A group's header lifts the same way and
// takes only a project or a place among the groups. The page is a small stand-in with just what drag.js touches.
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const HOLD_MS = 350;
const EDGE = 56;

// A target for events, which also forgets a listener whose signal aborts, as the page does.
const target = () => {
  const on = new Map();
  return {
    addEventListener(type, fn, options) {
      if (!on.has(type)) on.set(type, new Set());
      on.get(type).add(fn);
      options?.signal?.addEventListener('abort', () => on.get(type).delete(fn));
    },
    removeEventListener: (type, fn) => on.get(type)?.delete(fn),
    fire: (type, event) => [...(on.get(type) ?? [])].forEach(fn => fn({ type, preventDefault() {}, stopPropagation() {}, ...event })),
  };
};

// A drop target as the page draws one: its `data-drop`, whether only its middle half counts, where it is, and the target around it.
const dropTarget = (drop, { middle = false, top = 0, height = 40, within = null } = {}) => ({
  dataset: { drop },
  hasAttribute: name => name === 'data-drop-middle' && middle,
  getBoundingClientRect: () => ({ top, height }),
  parentElement: { closest: () => within },
});

// A list 600 pixels tall with one row near its bottom edge, scrolled down by 100, and the callbacks drag.js reports to.
async function mount() {
  mock.timers.enable({ apis: ['setTimeout'] });
  const frames = [];
  globalThis.requestAnimationFrame = fn => frames.push(fn);
  globalThis.cancelAnimationFrame = () => frames.length = 0;
  const drop = { over: null };
  globalThis.document = Object.assign(target(), {
    body: { append() {}, classList: { add() {}, remove() {} } },
    elementFromPoint: () => drop.over && { closest: selector => (selector.includes('^="to:"') && !drop.over.dataset.drop.startsWith('to:') ? null : drop.over) },
  });
  globalThis.window = target();
  const copy = { classList: { add() {} }, removeAttribute() {}, setAttribute() {}, querySelectorAll: () => [], style: {}, remove() {} };
  const row = { dataset: { id: 'r1' }, getBoundingClientRect: () => ({ left: 0, top: 570, width: 300 }), cloneNode: () => copy };
  const bar = { dataset: { handle: 'cg-1' }, getBoundingClientRect: () => ({ left: 0, top: 280, width: 300 }), cloneNode: () => copy };
  const place = { slot: null };
  const box = Object.assign(target(), { scrollTop: 100, getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 600 }) });
  const log = [];
  const kinds = [];
  const { dragRows } = await import('../public/ui/drag.js');
  const stop = dragRows(box, {
    onStart: (id, kind) => { log.push(['start', id]); kinds.push(['start', kind]); },
    onOver: over => log.push(['over', over]),
    onEnd: (id, section, kind) => { log.push(['end', id, section]); kinds.push(['end', kind]); },
    onMenu: (id, element, point, kind) => { log.push(['menu', id, element === row || element === bar, point]); kinds.push(['menu', kind]); },
    slot: (x, y, id) => { kinds.push(['slot', id]); return place.slot; },
  });
  const at = (clientX, clientY) => ({ isPrimary: true, clientX, clientY });
  return {
    box, log, kinds, drop, place, stop,
    down: (kind, x, y, grip = row) => box.fire('pointerdown', { ...at(x, y), button: 0, ctrlKey: false, pointerType: kind, target: { closest: selector => (selector.includes('aria-haspopup') ? null : grip) } }),
    header: (kind, x, y, dots = false) => box.fire('pointerdown', { ...at(x, y), button: 0, ctrlKey: false, pointerType: kind, target: { closest: selector => (selector.includes('aria-haspopup') ? dots && {} : bar) } }),
    move: (x, y) => document.fire('pointermove', at(x, y)),
    up: (x, y) => document.fire('pointerup', at(x, y)),
    frame: () => frames.splice(0).forEach(fn => fn()),
  };
}

afterEach(() => mock.timers.reset());

test('a finger held still near the edge of the list leaves the list where it is, and letting go asks for the row menu at the finger', async () => {
  const t = await mount();
  t.down('touch', 100, 600 - EDGE / 2);
  mock.timers.tick(HOLD_MS);
  for (let i = 0; i < 5; i++) t.frame();
  assert.equal(t.box.scrollTop, 100);
  t.up(100, 600 - EDGE / 2);
  assert.deepEqual(t.log, [['start', 'r1'], ['end', 'r1', null], ['menu', 'r1', true, { x: 100, y: 600 - EDGE / 2 }]]);
  t.stop();
});

test('the mouse down and click a touch sends after the long press is let go are swallowed for a moment, so the menu keeps the focus', async () => {
  const t = await mount();
  const swallowed = type => {
    let hit = false;
    window.fire(type, { preventDefault: () => { hit = true; } });
    return hit;
  };
  t.down('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.up(100, 300);
  assert.deepEqual([swallowed('mousedown'), swallowed('click')], [true, true]);
  mock.timers.tick(250);
  assert.deepEqual([swallowed('mousedown'), swallowed('click')], [false, false]);
  t.stop();
});

test('a finger that drifts a little while held still is still held still', async () => {
  const t = await mount();
  t.down('touch', 100, 590);
  mock.timers.tick(HOLD_MS);
  t.move(104, 593);
  t.frame();
  assert.equal(t.box.scrollTop, 100);
  t.up(104, 593);
  assert.deepEqual(t.log.map(([name]) => name), ['start', 'end', 'menu']);
  t.stop();
});

test('a finger that leaves the circle it was held in and comes back drags the row, and does not ask for the menu', async () => {
  const t = await mount();
  t.down('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.move(100, 340);
  t.move(100, 300);
  t.up(100, 300);
  assert.deepEqual(t.log.map(([name]) => name), ['start', 'end']);
  assert.deepEqual(t.log.at(-1), ['end', 'r1', null]);
  t.stop();
});

test('a finger that has moved and lets go over a section drops the row there, with no menu', async () => {
  const t = await mount();
  t.down('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.drop.over = dropTarget('pinned');
  t.move(100, 200);
  t.up(100, 200);
  assert.deepEqual(t.log.filter(([name]) => name !== 'over'), [['start', 'r1'], ['end', 'r1', 'pinned']]);
  t.stop();
});

test('a finger that has moved to the edge of the list scrolls it', async () => {
  const t = await mount();
  t.down('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.move(100, 590);
  t.frame();
  assert.ok(t.box.scrollTop > 100, String(t.box.scrollTop));
  t.up(100, 590);
  t.stop();
});

test('a mouse that has lifted the row scrolls the list at the edge at once', async () => {
  const t = await mount();
  t.down('mouse', 100, 590);
  t.move(110, 590);
  t.frame();
  assert.ok(t.box.scrollTop > 100, String(t.box.scrollTop));
  t.up(110, 590);
  assert.deepEqual(t.log.filter(([name]) => name === 'menu'), []);
  t.stop();
});

test('a row that takes a nest counts in the middle half of its height, and above and below that the drop falls to the section around it', async () => {
  const t = await mount();
  const over = () => t.log.findLast(([name]) => name === 'over')?.[1] ?? null;
  t.down('mouse', 100, 300);
  t.move(110, 300);
  t.drop.over = dropTarget('nest:r2', { middle: true, top: 100, height: 40, within: dropTarget('cg-work') });
  const seen = [100, 109, 110, 120, 130, 131, 139, 140].map(y => (t.move(110, y), over()));
  assert.deepEqual(seen, ['cg-work', 'cg-work', 'nest:r2', 'nest:r2', 'nest:r2', 'cg-work', 'cg-work', 'cg-work']);
  t.up(110, 120);
  assert.deepEqual(t.log.at(-1), ['end', 'r1', 'nest:r2']);
  t.stop();
});

test('a row that takes a nest and sits in no section has no target on its edges, and a target without the marker counts all over', async () => {
  const t = await mount();
  const over = () => t.log.findLast(([name]) => name === 'over')?.[1] ?? null;
  t.down('mouse', 100, 300);
  t.move(110, 300);
  t.drop.over = dropTarget('nest:r2', { middle: true, top: 100, height: 40 });
  t.move(110, 104);
  assert.equal(over(), null);
  t.drop.over = dropTarget('pinned', { top: 100, height: 40 });
  t.move(110, 104);
  assert.equal(over(), 'pinned');
  t.up(110, 104);
  assert.deepEqual(t.log.at(-1), ['end', 'r1', 'pinned']);
  t.stop();
});

test('the list of a carried session\'s own family takes a nest under their parent wherever a row of it does not, so its edges never fall to the section', async () => {
  const t = await mount();
  const over = () => t.log.findLast(([name]) => name === 'over')?.[1] ?? null;
  const family = dropTarget('nest:parent', { top: 60, height: 120, within: dropTarget('cg-work') });
  t.down('mouse', 100, 300);
  t.move(110, 300);
  t.drop.over = dropTarget('nest:sibling', { middle: true, top: 100, height: 40, within: family });
  assert.deepEqual([100, 109, 120, 131, 139].map(y => (t.move(110, y), over())), ['nest:parent', 'nest:parent', 'nest:sibling', 'nest:parent', 'nest:parent']);
  t.drop.over = family;
  t.move(110, 70);
  assert.equal(over(), 'nest:parent', 'between rows, or on the border of the list');
  t.up(110, 70);
  assert.deepEqual(t.log.at(-1), ['end', 'r1', 'nest:parent']);
  t.stop();
});

const swallowed = type => {
  let hit = false;
  window.fire(type, { preventDefault: () => { hit = true; } });
  return hit;
};

test('a row and a header both say which kind they are when they start, end and ask for a menu', async () => {
  const t = await mount();
  t.down('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.up(100, 300);
  t.header('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.up(100, 300);
  assert.deepEqual(t.kinds.filter(([name]) => name !== 'slot'), [['start', 'row'], ['end', 'row'], ['menu', 'row'], ['start', 'group'], ['end', 'group'], ['menu', 'group']]);
  assert.deepEqual(t.log.filter(([name]) => name === 'start' || name === 'menu').map(([name, id]) => [name, id]), [['start', 'r1'], ['menu', 'r1'], ['start', 'cg-1'], ['menu', 'cg-1']]);
  t.stop();
});

test('a mouse on a header lifts it after five pixels and not before, and the click that follows is swallowed for a moment', async () => {
  const t = await mount();
  t.header('mouse', 100, 300);
  t.move(103, 302);
  assert.deepEqual(t.log, []);
  t.move(105, 300);
  assert.deepEqual(t.log.filter(([name]) => name === 'start'), [['start', 'cg-1']]);
  t.up(105, 300);
  assert.deepEqual([swallowed('mousedown'), swallowed('click')], [true, true]);
  mock.timers.tick(250);
  assert.deepEqual([swallowed('mousedown'), swallowed('click')], [false, false]);
  t.stop();
});

test('a click on a header that never moves lifts nothing, so it folds the group and opens its menu as before', async () => {
  const t = await mount();
  t.header('mouse', 100, 300);
  t.up(100, 300);
  assert.deepEqual(t.log, []);
  assert.equal(swallowed('click'), false);
  t.stop();
});

test('a finger that swipes on a header before the long press is up lifts nothing, so the list scrolls', async () => {
  const t = await mount();
  t.header('touch', 100, 300);
  t.move(100, 320);
  mock.timers.tick(HOLD_MS);
  t.up(100, 320);
  assert.deepEqual(t.log, []);
  t.stop();
});

test('a finger held on a header lifts it after the long press, and moving it drops it on a project or a place among the groups', async () => {
  const t = await mount();
  t.header('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.drop.over = dropTarget('to:cp-one');
  t.move(100, 200);
  t.up(100, 200);
  assert.deepEqual(t.log.filter(([name]) => name !== 'over'), [['start', 'cg-1'], ['end', 'cg-1', 'to:cp-one']]);
  t.drop.over = null;
  t.place.slot = 'before:cg-2';
  t.header('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.move(100, 200);
  t.up(100, 200);
  assert.deepEqual(t.log.at(-1), ['end', 'cg-1', 'before:cg-2']);
  assert.deepEqual(t.kinds.filter(([name]) => name === 'slot').at(-1), ['slot', 'cg-1']);
  t.stop();
});

test('a finger held still on a header asks for its menu at the finger and drops nothing', async () => {
  const t = await mount();
  t.header('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.place.slot = 'before:cg-2';
  t.up(100, 300);
  assert.deepEqual(t.log.filter(([name]) => name !== 'over'), [['start', 'cg-1'], ['end', 'cg-1', null], ['menu', 'cg-1', true, { x: 100, y: 300 }]]);
  t.stop();
});

test('a dragged header has no row target: a section, a nest or a row under it count for nothing', async () => {
  const t = await mount();
  t.header('mouse', 100, 300);
  t.move(110, 300);
  t.drop.over = dropTarget('pinned');
  t.move(110, 200);
  t.drop.over = dropTarget('nest:r2', { middle: true, top: 100, height: 40 });
  t.move(110, 120);
  t.up(110, 120);
  assert.deepEqual(t.log.filter(([name]) => name !== 'start'), [['end', 'cg-1', null]]);
  t.stop();
});

test('Esc cancels a dragged header and drops nothing, even over a project', async () => {
  const t = await mount();
  t.header('mouse', 100, 300);
  t.move(110, 300);
  t.drop.over = dropTarget('to:cp-one');
  t.move(110, 200);
  document.fire('keydown', { key: 'Escape' });
  t.up(110, 200);
  assert.deepEqual(t.log.filter(([name]) => name === 'end'), [['end', 'cg-1', null]]);
  assert.deepEqual(t.kinds.filter(([name]) => name === 'end'), [['end', 'group']]);
  t.stop();
});

test('a context menu while a finger presses or drags a header is stopped, and one with no press is left to the header', async () => {
  const t = await mount();
  const sent = () => {
    const stopped = { prevented: false, stopped: false };
    t.box.fire('contextmenu', { target: { closest: () => null }, preventDefault: () => { stopped.prevented = true; }, stopPropagation: () => { stopped.stopped = true; } });
    return stopped;
  };
  assert.deepEqual(sent(), { prevented: false, stopped: false });
  t.header('touch', 100, 300);
  assert.deepEqual(sent(), { prevented: true, stopped: true });
  mock.timers.tick(HOLD_MS);
  assert.deepEqual(sent(), { prevented: true, stopped: true });
  t.up(100, 300);
  assert.deepEqual(sent(), { prevented: false, stopped: false });
  t.header('mouse', 100, 300);
  assert.deepEqual(sent(), { prevented: false, stopped: false });
  t.up(100, 300);
  t.stop();
});

test('a header carried above the list does not scroll it, as a row does, so the Move to strip over it can be reached', async () => {
  const t = await mount();
  t.header('mouse', 100, 300);
  t.move(110, 300);
  t.move(110, -20);
  for (let i = 0; i < 3; i++) t.frame();
  assert.equal(t.box.scrollTop, 100);
  t.move(110, 20);
  t.frame();
  assert.ok(t.box.scrollTop < 100, String(t.box.scrollTop));
  t.up(110, 20);
  t.down('mouse', 100, 300);
  t.box.scrollTop = 100;
  t.move(110, 300);
  t.move(110, -20);
  t.frame();
  assert.ok(t.box.scrollTop < 100, 'a row still scrolls');
  t.up(110, -20);
  t.stop();
});

test('a press on a header\'s menu button starts no press and lifts nothing, for a mouse and a finger, so the menu can pick on the release', async () => {
  for (const kind of ['mouse', 'touch']) {
    const t = await mount();
    t.header(kind, 100, 300, true);
    t.move(120, 300);
    mock.timers.tick(HOLD_MS);
    t.move(140, 320);
    t.up(140, 320);
    assert.deepEqual(t.log, []);
    t.stop();
    mock.timers.reset();
  }
});
