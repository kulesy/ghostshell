// Drags a session row onto a section or onto another row, and a user group's header onto a project or a place among the groups, with
// pointer events, so a mouse and a finger share the code. A mouse drags after a few pixels, so a click still opens the session or folds
// the group. A finger drags after a long press, so a swipe still scrolls the list. A right click, or a long press let go without
// moving, asks for the row's or the header's menu instead.
const MOUSE_SLOP = 5;
const HOLD_MS = 350;
const HOLD_SLOP = 8;
const EDGE = 56;
const SCROLL_STEP = 16;

// The place of a click if it is inside the element. The menu key reports one that can be far from it, so it gets null.
export function pointIn(el, e) {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? { x: e.clientX, y: e.clientY } : null;
}

const GRIPS = 'a.row[data-id], .bar[data-handle]';

// The target a dragged header has under a point: a project or Home in the sidebar or the Move to strip, else the place among the groups.
function groupTargetAt(x, y, id, slot) {
  return document.elementFromPoint(x, y)?.closest('[data-drop^="to:"]')?.dataset.drop ?? slot(x, y, id);
}

// The drop target under a point. One marked `data-drop-middle` counts only in the middle half of its height, and above and below that
// the point belongs to the target around it, so a row that takes a nest leaves its edges to the section it is in.
function targetAt(x, y) {
  for (let el = document.elementFromPoint(x, y)?.closest('[data-drop]'); el; el = el.parentElement?.closest('[data-drop]')) {
    if (!el.hasAttribute('data-drop-middle')) return el.dataset.drop;
    const { top, height } = el.getBoundingClientRect();
    if (Math.abs(y - top - height / 2) <= height / 4) return el.dataset.drop;
  }
  return null;
}

// `box` is the scrolling list. Rows are `a.row[data-id]`, a header that can be dragged is `.bar[data-handle]` with the group's id, and
// drop targets carry `data-drop`. A dragged header has only the targets marked `to:` and `slot(x, y, id)`, which gives the place among
// the groups under a point or null. The `kind` that `onStart`, `onEnd` and `onMenu` get last is 'row' or 'group'. `onOver` gets the
// target under the pointer, or null. `onEnd` gets the target dropped on, or null when the drag was cancelled. `onMenu` gets the id and
// element, and where the click or the finger was, or null for the menu key.
// Returns a function that stops it.
export function dragRows(box, { onStart, onOver, onEnd, onMenu, slot = () => null }) {
  let press = null;
  let drag = null;
  let stop = null;
  let frame = 0;
  let quiet = 0;

  const swallow = e => { e.preventDefault(); e.stopPropagation(); };
  const swallowing = on => {
    for (const type of ['click', 'mousedown']) window[on ? 'addEventListener' : 'removeEventListener'](type, swallow, true);
  };

  function down(e) {
    const grip = e.target.closest(GRIPS);
    if (!grip || !e.isPrimary || e.button !== 0) return;
    // On a Mac a Ctrl click is a right click, which asks for the menu, so it must not start a drag.
    if (e.ctrlKey && e.pointerType === 'mouse') return;
    if (stop) lost();
    clearTimeout(quiet);
    swallowing(false);
    const at = { x: e.clientX, y: e.clientY };
    press = { grip, start: at, now: at, touch: e.pointerType !== 'mouse', timer: 0 };
    if (press.touch) press.timer = setTimeout(() => lift(press.now.x, press.now.y), HOLD_MS);
    stop = new AbortController();
    const { signal } = stop;
    document.addEventListener('pointermove', move, { signal });
    document.addEventListener('pointerup', up, { signal });
    document.addEventListener('pointercancel', up, { signal });
    document.addEventListener('keydown', escape, { signal, capture: true });
    window.addEventListener('blur', lost, { signal });
  }

  // The drag's place. A touch that leaves the circle it was held in has moved for good, even if it comes back.
  function reach(d, x, y) {
    Object.assign(d, { x, y });
    if (Math.hypot(x - d.start.x, y - d.start.y) > HOLD_SLOP) d.moved = true;
  }

  function move(e) {
    if (!e.isPrimary) return;
    if (drag) {
      reach(drag, e.clientX, e.clientY);
      return follow();
    }
    if (!press) return;
    press.now = { x: e.clientX, y: e.clientY };
    const moved = Math.hypot(press.now.x - press.start.x, press.now.y - press.start.y);
    if (!press.touch && moved >= MOUSE_SLOP) lift(press.now.x, press.now.y);
    else if (press.touch && moved > HOLD_SLOP) release();
  }

  function lift(x, y) {
    const { grip, start, touch } = press;
    const kind = grip.dataset.handle === undefined ? 'row' : 'group';
    const at = grip.getBoundingClientRect();
    const copy = grip.cloneNode(true);
    copy.classList.add('lifted');
    for (const attr of ['href', 'data-id', 'data-handle', 'aria-current', 'data-lifted', 'data-picked']) copy.removeAttribute(attr);
    copy.setAttribute('aria-hidden', 'true');
    if (kind === 'group') {
      copy.setAttribute('inert', '');
      for (const el of copy.querySelectorAll('[data-key], [aria-controls]')) for (const attr of ['data-key', 'aria-controls']) el.removeAttribute(attr);
    }
    copy.style.width = `${at.width}px`;
    document.body.append(copy);
    document.body.classList.add('dragging');
    clearTimeout(press.timer);
    press = null;
    drag = { id: kind === 'group' ? grip.dataset.handle : grip.dataset.id, kind, grip, touch, start, copy, grabX: start.x - at.left, grabY: start.y - at.top, x, y, over: null, moved: !touch };
    swallowing(true);
    onStart(drag.id, kind);
    follow();
    frame = requestAnimationFrame(autoscroll);
  }

  function follow() {
    drag.copy.style.transform = `translate(${drag.x - drag.grabX}px, ${drag.y - drag.grabY}px)`;
    const over = drag.kind === 'group' ? groupTargetAt(drag.x, drag.y, drag.id, slot) : targetAt(drag.x, drag.y);
    if (over !== drag.over) {
      drag.over = over;
      onOver(over);
    }
  }

  // Near the top or bottom of the list it scrolls, faster the closer the pointer is to the edge, so a far section can be reached.
  // A finger that has not moved since the long press holds still, so the list holds still under it.
  function autoscroll() {
    if (!drag) return;
    const r = box.getBoundingClientRect();
    // A header carried over what sits above or below the list, such as the Move to strip, must not scroll it.
    const away = drag.x < r.left || drag.x > r.right || (drag.kind === 'group' && (drag.y < r.top || drag.y > r.bottom));
    const pull = !drag.moved || away ? 0 : Math.max(drag.y - (r.bottom - EDGE), 0) - Math.max(r.top + EDGE - drag.y, 0);
    if (pull) {
      const was = box.scrollTop;
      box.scrollTop += Math.sign(pull) * Math.ceil(SCROLL_STEP * Math.min(Math.abs(pull), EDGE) / EDGE);
      if (box.scrollTop !== was) follow();
    }
    frame = requestAnimationFrame(autoscroll);
  }

  function discard() {
    cancelAnimationFrame(frame);
    drag.copy.remove();
    document.body.classList.remove('dragging');
    drag = null;
  }

  // The click after a drag must not open the session. A touch can send it a moment after the pointer goes up, so it is swallowed for a while.
  // So is the mouse down before it, which would take the focus off the menu a long press opens.
  function release() {
    clearTimeout(press?.timer);
    press = null;
    stop?.abort();
    stop = null;
    if (drag) discard();
    quiet = setTimeout(() => swallowing(false), 250);
  }

  function up(e) {
    if (!e.isPrimary) return;
    const carried = drag;
    const dropped = carried && e.type === 'pointerup';
    if (dropped) {
      reach(carried, e.clientX, e.clientY);
      follow();
    }
    const still = dropped && carried.touch && !carried.moved;
    const target = dropped && !still ? carried.over : null;
    release();
    if (carried) onEnd(carried.id, target, carried.kind);
    if (still) onMenu(carried.id, carried.grip, { x: carried.x, y: carried.y }, carried.kind);
  }

  function escape(e) {
    if (e.key !== 'Escape' || !drag) return;
    e.preventDefault();
    e.stopPropagation();
    const { id, kind } = drag;
    discard();
    onEnd(id, null, kind);
  }

  function lost() {
    const carried = drag;
    release();
    if (carried) onEnd(carried.id, null, carried.kind);
  }

  function menu(e) {
    if (press?.touch || drag) return e.preventDefault();
    const row = e.target.closest('a.row[data-id]');
    if (!row) return;
    e.preventDefault();
    onMenu(row.dataset.id, row, pointIn(row, e), 'row');
  }

  const life = new AbortController();
  const { signal } = life;
  box.addEventListener('pointerdown', down, { signal });
  box.addEventListener('dragstart', e => e.preventDefault(), { signal });
  box.addEventListener('contextmenu', menu, { signal });
  // A long press on Android also sends a context menu, which a header would answer with its menu before the press is over.
  box.addEventListener('contextmenu', e => { if (press?.touch || drag) swallow(e); }, { signal, capture: true });
  // NOTE: [15 Oct 2026] EK - Keep this touchmove listener non-passive and registered up front, not added at the long press.
  // dnd-kit does the same to stop the list scrolling under a touch drag, and says iOS Safari needs it.
  // See https://github.com/clauderic/dnd-kit/blob/master/packages/core/src/sensors/touch/TouchSensor.ts.
  box.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { signal, passive: false });

  return () => {
    life.abort();
    lost();
  };
}
