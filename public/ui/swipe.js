// Swipes a row sideways with a finger, as Gmail does. The row follows the finger over a backdrop that names the action, and letting go
// far enough, or with a flick, takes it. Short of that it springs back. A mouse or a trackpad does nothing here.
const LOCK = 10;
const RATIO = 1.5;
const EDGE = 20;
const COMMIT = 0.4;
const FLING = 0.5;
const FLING_MIN = 24;
const TRAIL_MS = 100;
const OUT_MS = 160;
const BACK_MS = 200;
const QUIET_MS = 250;

const POPUPS = 'button.more, [aria-haspopup]';
const swallow = e => { e.preventDefault(); e.stopPropagation(); };
const side = offset => (offset < 0 ? 'left' : 'right');

// `box` is the list. `row` is the selector of a row that swipes, and its parent is the host that app.css draws the backdrop on: it gets
// `data-swipe`, which says the side, `armed` once letting go would take the row, and the phase, and `--swipe`, how far the row has moved.
// `leaves(row)` is whether the row goes when taken. If it does not, it springs back and `onSwipe(row)` is called at once, so a question can ask.
// If it does, it slides off and collapses first, and `onSwipe(row)` is called after, because the list removes the row as soon as it is.
// Returns a function that stops it.
export function swipeRows(box, { row, leaves = () => true, onSwipe }) {
  const owner = new WeakMap();
  let touch = null;
  let ending = null;
  let quiet = 0;

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const forget = () => { ending?.abort(); ending = null; touch = null; };

  function clear(t) {
    if (owner.get(t.host) !== t) return;
    owner.delete(t.host);
    delete t.host.dataset.swipe;
    for (const name of ['--swipe', '--swipe-height', 'height']) t.host.style.removeProperty(name);
  }

  function down(e) {
    const el = e.target.closest(row);
    if (!el || !e.isPrimary || e.pointerType !== 'touch' || e.target.closest(POPUPS)) return;
    // The edges are the browser's, for going back and forward.
    if (e.clientX < EDGE || e.clientX > innerWidth - EDGE) return;
    forget();
    clearTimeout(quiet);
    window.removeEventListener('click', swallow, true);
    touch = { el, host: el.parentElement, x: e.clientX, y: e.clientY, locked: false, origin: 0, width: 0, offset: 0, mark: '', trail: [] };
    ending = new AbortController();
    const { signal } = ending;
    document.addEventListener('pointermove', move, { signal });
    document.addEventListener('pointerup', up, { signal });
    document.addEventListener('pointercancel', up, { signal });
  }

  function move(e) {
    if (!e.isPrimary || !touch) return;
    const t = touch;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (!t.locked) {
      if (Math.hypot(dx, dy) < LOCK) return;
      // A long press has lifted the row to drag, which is the drag's. A move that is not clearly sideways is a scroll.
      if (document.body.classList.contains('dragging') || Math.abs(dx) <= RATIO * Math.abs(dy)) return forget();
      const { width, height } = t.el.getBoundingClientRect();
      Object.assign(t, { locked: true, origin: dx, width });
      owner.set(t.host, t);
      t.host.style.setProperty('--swipe-height', `${height}px`);
    }
    t.offset = Math.max(-t.width, Math.min(t.width, dx - t.origin));
    t.trail.push([e.timeStamp, e.clientX]);
    t.host.style.setProperty('--swipe', `${t.offset}px`);
    const mark = `${side(t.offset)}${Math.abs(t.offset) >= COMMIT * t.width ? ' armed' : ''}`;
    if (mark !== t.mark) t.host.dataset.swipe = t.mark = mark;
  }

  // How fast the finger was going over the last moments, in pixels a millisecond, signed.
  function speed(t, e) {
    t.trail.push([e.timeStamp, e.clientX]);
    const recent = t.trail.filter(([time]) => time >= e.timeStamp - TRAIL_MS);
    const [first, last] = [recent[0], recent.at(-1)];
    return last[0] > first[0] ? (last[1] - first[1]) / (last[0] - first[0]) : 0;
  }

  function up(e) {
    if (!e.isPrimary || !touch) return;
    const t = touch;
    forget();
    if (!t.locked) return;
    // A touch can send a click after the pointer goes up, which would open the row.
    window.addEventListener('click', swallow, true);
    quiet = setTimeout(() => window.removeEventListener('click', swallow, true), QUIET_MS);
    const v = speed(t, e);
    const flung = Math.abs(v) >= FLING && Math.sign(v) === Math.sign(t.offset) && Math.abs(t.offset) >= FLING_MIN;
    const taken = e.type === 'pointerup' && (Math.abs(t.offset) >= COMMIT * t.width || flung);
    if (!taken) return back(t);
    if (!leaves(t.el)) {
      back(t);
      return void onSwipe(t.el);
    }
    out(t);
  }

  function back(t) {
    t.host.dataset.swipe = `${side(t.offset)} back`;
    t.host.style.setProperty('--swipe', '0px');
    if (reduced()) clear(t);
    else setTimeout(() => clear(t), BACK_MS);
  }

  // The row slides off, then its height collapses so the rows under it close up, and then the list is told.
  function out(t) {
    const { host } = t;
    const sign = Math.sign(t.offset);
    const collapse = () => {
      host.style.height = `${host.offsetHeight}px`;
      // A height from auto does not animate, so the browser has to lay out the pixel height first.
      void host.offsetHeight;
      host.dataset.swipe = `${side(t.offset)} armed collapse`;
      host.style.height = '0px';
    };
    const done = () => Promise.resolve(onSwipe(t.el)).finally(() => clear(t));
    host.dataset.swipe = `${side(t.offset)} armed out`;
    host.style.setProperty('--swipe', `${sign * t.width}px`);
    if (reduced()) {
      collapse();
      done();
      return;
    }
    setTimeout(() => {
      collapse();
      setTimeout(done, OUT_MS);
    }, OUT_MS);
  }

  const life = new AbortController();
  box.addEventListener('pointerdown', down, { signal: life.signal });

  return () => {
    life.abort();
    if (touch?.locked) clear(touch);
    forget();
  };
}
