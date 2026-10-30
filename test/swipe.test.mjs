// Run with `npm test`. Swiping a row sideways with a finger: the row follows once the touch is clearly sideways, and letting go past 40% of its
// width, or with a flick, takes it, else it springs back. A mouse, a scroll, a touch at the screen's edge and a row already lifted to drag do
// nothing. The page is a small stand-in with just what swipe.js touches.
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const ROW = 'a.row[data-id]';
const WIDTH = 300;
const OUT_MS = 160;
const BACK_MS = 200;

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
    listening: type => on.get(type)?.size ?? 0,
  };
};

// A list with one row 300 wide in a host, the page's 400 wide, and the calls swipe.js makes to the list.
async function mount({ leaves = () => true, reduced = false } = {}) {
  mock.timers.enable({ apis: ['setTimeout'] });
  const dragging = { on: false };
  globalThis.innerWidth = 400;
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 16);
  globalThis.document = Object.assign(target(), { body: { classList: { contains: () => dragging.on } } });
  globalThis.window = target();
  const host = { dataset: {}, offsetHeight: 48, style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } } };
  const row = { parentElement: host, dataset: { id: 'r1' }, getBoundingClientRect: () => ({ width: WIDTH, height: 48 }) };
  const box = target();
  const swiped = [];
  const { swipeRows } = await import('../public/ui/swipe.js');
  const stop = swipeRows(box, { row: ROW, leaves, onSwipe: el => { swiped.push(el.dataset.id); } });
  let now = 1000;
  const at = (x, y, extra) => ({ isPrimary: true, clientX: x, clientY: y, timeStamp: now, ...extra });
  return {
    host, swiped, dragging, stop, window,
    down: (x, y, pointerType = 'touch', closest = selector => (selector === ROW ? row : null)) => box.fire('pointerdown', { ...at(x, y), pointerType, target: { closest } }),
    move: (x, y, wait = 16) => { now += wait; document.fire('pointermove', at(x, y)); },
    up: (x, y, wait = 16) => { now += wait; document.fire('pointerup', at(x, y)); },
    cancel: (x, y) => document.fire('pointercancel', at(x, y)),
    clicked: () => { let hit = false; window.fire('click', { preventDefault: () => { hit = true; } }); return hit; },
  };
}

afterEach(() => mock.timers.reset());

test('a touch that is clearly sideways moves the row with the finger from where it was recognised, and names the side', async () => {
  const t = await mount();
  t.down(100, 100);
  t.move(104, 100);
  assert.equal(t.host.dataset.swipe, undefined);
  t.move(112, 102);
  assert.equal(t.host.dataset.swipe, 'right');
  assert.equal(t.host.style['--swipe'], '0px');
  t.move(172, 102);
  assert.equal(t.host.style['--swipe'], '60px');
  assert.equal(t.host.style['--swipe-height'], '48px');
  t.move(30, 102);
  assert.equal(t.host.dataset.swipe, 'left');
  t.stop();
});

test('a touch that is not clearly sideways is a scroll, and stays one even if it turns sideways later', async () => {
  const t = await mount();
  t.down(100, 100);
  t.move(110, 112);
  t.move(250, 112);
  assert.equal(t.host.dataset.swipe, undefined);
  t.up(250, 112);
  mock.timers.tick(OUT_MS);
  mock.timers.tick(OUT_MS);
  assert.deepEqual(t.swiped, []);
  t.stop();
});

test('a touch that starts within 20 pixels of either edge of the screen is left to the browser', async () => {
  const t = await mount();
  for (const x of [19, 381]) {
    t.down(x, 100);
    t.move(x + 60, 100);
    t.move(x + 120, 100);
    assert.equal(t.host.dataset.swipe, undefined);
    t.up(x + 120, 100);
  }
  t.down(20, 100);
  t.move(80, 100);
  assert.equal(t.host.dataset.swipe, 'right');
  t.stop();
});

test('a mouse does nothing, and neither does a press on the menu button', async () => {
  const t = await mount();
  t.down(100, 100, 'mouse');
  t.move(200, 100);
  assert.equal(t.host.dataset.swipe, undefined);
  t.up(200, 100);
  t.down(100, 100, 'touch', () => ({}));
  t.move(200, 100);
  assert.equal(t.host.dataset.swipe, undefined);
  t.stop();
});

test('a row lifted by a long press is the drag\'s, so a move after it does not swipe', async () => {
  const t = await mount();
  t.down(100, 100);
  t.dragging.on = true;
  t.move(130, 100);
  t.move(220, 100);
  assert.equal(t.host.dataset.swipe, undefined);
  t.stop();
});

test('letting go past 40% of the width slides the row off, collapses it, and then reports it', async () => {
  const t = await mount();
  t.down(100, 100);
  t.move(112, 100);
  t.move(112 + 110, 100);
  assert.equal(t.host.dataset.swipe, 'right');
  t.move(112 + 120, 100);
  assert.equal(t.host.dataset.swipe, 'right armed');
  t.up(112 + 120, 100, 400);
  assert.equal(t.host.dataset.swipe, 'right armed out');
  assert.equal(t.host.style['--swipe'], `${WIDTH}px`);
  assert.deepEqual(t.swiped, []);
  mock.timers.tick(OUT_MS);
  assert.equal(t.host.dataset.swipe, 'right armed collapse');
  assert.equal(t.host.style.height, '0px');
  assert.deepEqual(t.swiped, []);
  mock.timers.tick(OUT_MS);
  assert.deepEqual(t.swiped, ['r1']);
  mock.timers.tick(16);
  assert.equal(t.host.dataset.swipe, undefined);
  assert.equal(t.host.style.height, undefined);
  t.stop();
});

test('letting go short of 40% springs back, reports nothing, and leaves the host clean', async () => {
  const t = await mount();
  t.down(100, 100);
  t.move(112, 100);
  t.move(112 + 100, 100, 300);
  t.up(112 + 100, 100, 300);
  assert.equal(t.host.dataset.swipe, 'right back');
  assert.equal(t.host.style['--swipe'], '0px');
  mock.timers.tick(BACK_MS);
  assert.equal(t.host.dataset.swipe, undefined);
  assert.equal(t.host.style['--swipe'], undefined);
  assert.deepEqual(t.swiped, []);
  t.stop();
});

test('a quick flick in the direction of the swipe takes the row from a short way, and a slow drag or a tiny flick does not', async () => {
  const fling = async (distance, wait) => {
    const t = await mount();
    t.down(100, 100);
    t.move(112, 100);
    t.move(112 + distance, 100, wait);
    t.up(112 + distance, 100, 1);
    mock.timers.tick(OUT_MS);
    mock.timers.tick(OUT_MS);
    t.stop();
    mock.timers.reset();
    return t.swiped;
  };
  assert.deepEqual(await fling(60, 60), ['r1']);
  assert.deepEqual(await fling(60, 400), []);
  assert.deepEqual(await fling(12, 10), []);
});

test('a flick back the other way is not a fling in the direction the row is displaced', async () => {
  const t = await mount();
  t.down(100, 100);
  t.move(112, 100);
  t.move(172, 100, 300);
  t.move(150, 100, 20);
  t.up(150, 100, 20);
  mock.timers.tick(OUT_MS);
  mock.timers.tick(OUT_MS);
  assert.deepEqual(t.swiped, []);
  t.stop();
});

test('a cancelled touch springs back even past the threshold', async () => {
  const t = await mount();
  t.down(100, 100);
  t.move(112, 100);
  t.move(260, 100);
  t.cancel(260, 100);
  assert.equal(t.host.dataset.swipe, 'right back');
  mock.timers.tick(BACK_MS * 2);
  assert.deepEqual(t.swiped, []);
  t.stop();
});

test('a row that will not leave springs back and is reported at once, for the question to be asked', async () => {
  const t = await mount({ leaves: () => false });
  t.down(100, 100);
  t.move(112, 100);
  t.move(262, 100);
  t.up(262, 100);
  assert.deepEqual(t.swiped, ['r1']);
  assert.equal(t.host.dataset.swipe, 'right back');
  mock.timers.tick(BACK_MS);
  assert.equal(t.host.dataset.swipe, undefined);
  t.stop();
});

test('with reduced motion the row is removed and reported at once', async () => {
  const t = await mount({ reduced: true });
  t.down(100, 100);
  t.move(112, 100);
  t.move(262, 100);
  t.up(262, 100);
  assert.deepEqual(t.swiped, ['r1']);
  assert.equal(t.host.style.height, '0px');
  mock.timers.tick(16);
  assert.equal(t.host.style.height, undefined);
  t.stop();
});

test('the click a touch sends after a swipe is swallowed for a moment, and a tap does not swallow anything', async () => {
  const t = await mount();
  t.down(100, 100);
  t.up(100, 100);
  assert.equal(t.clicked(), false);
  t.down(100, 100);
  t.move(112, 100);
  t.move(150, 100);
  t.up(150, 100);
  assert.equal(t.clicked(), true);
  mock.timers.tick(250);
  assert.equal(t.clicked(), false);
  t.stop();
});

test('stopping takes the listeners off, and a swipe in progress leaves the host clean', async () => {
  const t = await mount();
  t.down(100, 100);
  t.move(112, 100);
  t.move(160, 100);
  t.stop();
  assert.equal(t.host.dataset.swipe, undefined);
  assert.equal(document.listening('pointermove'), 0);
  t.down(100, 100);
  t.move(112, 100);
  t.move(160, 100);
  assert.equal(t.host.dataset.swipe, undefined);
});
