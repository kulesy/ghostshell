import { tickIn, untilMidnight } from './format.js';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from './html.js';
import { modifier, onAppChange } from './shortcuts.js';
import { local } from './storage.js';
import { INSTALLED, windowTitle } from './title-rules.js';

// Re-renders when the selected slice of the store changes. A selector must return an existing value, not a new object.
export function useStore(store, select) {
  const [, rerender] = useReducer(n => n + 1, 0);
  const pick = useRef(select);
  pick.current = select;
  const value = select(store.get());
  const shown = useRef(value);
  shown.current = value;
  useLayoutEffect(() => {
    const check = () => { if (!Object.is(pick.current(store.get()), shown.current)) rerender(); };
    check();
    return store.subscribe(check);
  }, [store]);
  return value;
}

// State kept in localStorage under capcom.<key>.
export function useLocal(key, fallback) {
  const [value, setValue] = useState(() => local.get(key, fallback));
  const latest = useRef(value);
  const set = useCallback(next => {
    const v = typeof next === 'function' ? next(latest.current) : next;
    latest.current = v;
    local.set(key, v);
    setValue(v);
  }, [key]);
  return [value, set];
}

// The modifier a shortcut hint names, kept up to date as Capcom moves between a tab and the installed app.
export function useModifier() {
  const [mod, setMod] = useState(modifier);
  useEffect(() => onAppChange(() => setMod(modifier())), []);
  return mod;
}

// Whether the window is wide enough for the projects to sit in a column beside the list. app.css changes its grid at the same width.
const WIDE = '(min-width: 56rem)';

export const isWide = () => matchMedia(WIDE).matches;

export function useWide() {
  const [wide, setWide] = useState(isWide);
  useEffect(() => {
    const query = matchMedia(WIDE);
    const sync = () => setWide(query.matches);
    query.addEventListener('change', sync);
    sync();
    return () => query.removeEventListener('change', sync);
  }, []);
  return wide;
}

export function useDocumentTitle(title) {
  useEffect(() => {
    const installed = matchMedia(INSTALLED);
    const sync = () => { document.title = windowTitle(title, installed.matches); };
    installed.addEventListener('change', sync);
    sync();
    return () => installed.removeEventListener('change', sync);
  }, [title]);
}

// The local date, which changes at midnight. A phone can sleep through the timer, so coming back to the page checks it too.
export function useToday() {
  const [today, setToday] = useState(() => new Date().toDateString());
  useEffect(() => {
    let timer;
    const check = () => {
      clearTimeout(timer);
      setToday(new Date().toDateString());
      timer = setTimeout(check, untilMidnight(Date.now()));
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}

// Draws the component again every second while `on`, so a timer on screen keeps counting between events. Given the time it counts
// from, each draw falls just after a whole second of it, so timers counting from one start change together.
export function useClock(on, since) {
  const [, rerender] = useReducer(n => n + 1, 0);
  useEffect(() => {
    if (!on) return undefined;
    if (!Number.isFinite(since)) {
      const timer = setInterval(rerender, 1000);
      return () => clearInterval(timer);
    }
    let timer;
    const wait = () => {
      timer = setTimeout(() => { rerender(); wait(); }, tickIn(Date.now(), since));
    };
    wait();
    return () => clearTimeout(timer);
  }, [on, since]);
}

// How near the end of a scroll box counts as being at it.
export const NEAR_END = 8;
export const gapBelow = el => el.scrollHeight - el.scrollTop - el.clientHeight;

const EDITABLE = 'input, textarea, select, [contenteditable]';
const SCROLL_UP_KEYS = ['ArrowUp', 'PageUp', 'Home'];
const TOUCH_SLOP = 8;

// Whether a box between `target` and `box` can still scroll up, so a scroll up there is its own and not the outer box's.
function innerScrolls(target, box) {
  for (let el = target; el && el !== box; el = el.parentElement) {
    if (el.scrollTop > 0 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true;
  }
  return false;
}

// Whether a scroll box should stay at its end. A scroll up lets go, and coming back to the end holds again. Wheel, key and touch are
// read as well as scroll because a render can pin the box between the input and its scroll event.
export function usePin(box) {
  const pin = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    let gap = 0;
    let finger = 0;
    const release = target => { if (el.scrollTop > 0 && !innerScrolls(target, el)) pin.current = false; };
    // The gap below the view, not scrollTop, because a pin and a scroll up in one frame add up to a move down that still leaves a gap.
    // A box that shrinks or grows taller keeps its gap, and a bounce past the end counts as no gap.
    const scrolled = () => {
      const now = Math.max(0, gapBelow(el));
      if (now > gap + 0.5) pin.current = false;
      else if (now <= NEAR_END) pin.current = true;
      gap = now;
    };
    const wheeled = e => { if (e.deltaY < 0 && !e.ctrlKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) release(e.target); };
    const keyed = e => {
      const up = SCROLL_UP_KEYS.includes(e.key) || (e.key === ' ' && e.shiftKey && e.target === el);
      if (up && !e.defaultPrevented && !e.target.closest?.(EDITABLE)) release(e.target);
    };
    const touched = e => { finger = e.touches[0].clientY; };
    const dragged = e => {
      const y = e.touches[0].clientY;
      if (y - finger > TOUCH_SLOP) release(e.target);
      finger = Math.min(finger, y);
    };
    el.addEventListener('scroll', scrolled, { passive: true });
    el.addEventListener('wheel', wheeled, { passive: true });
    el.addEventListener('keydown', keyed);
    el.addEventListener('touchstart', touched, { passive: true });
    el.addEventListener('touchmove', dragged, { passive: true });
    return () => {
      el.removeEventListener('scroll', scrolled);
      el.removeEventListener('wheel', wheeled);
      el.removeEventListener('keydown', keyed);
      el.removeEventListener('touchstart', touched);
      el.removeEventListener('touchmove', dragged);
    };
  }, []);
  return pin;
}

// Puts the box at its end after every render while `pin` holds.
export function useStick(box, pin) {
  useLayoutEffect(() => {
    if (pin.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  });
}

// Like useStore, for several plain fields at once. Returns the whole state, so read only the fields named here.
export function useFields(store, ...keys) {
  const [, rerender] = useReducer(n => n + 1, 0);
  const state = store.get();
  const shown = useRef(state);
  shown.current = state;
  useLayoutEffect(() => {
    const check = () => {
      const now = store.get();
      if (keys.some(k => !Object.is(now[k], shown.current[k]))) rerender();
    };
    check();
    return store.subscribe(check);
  }, [store]);
  return state;
}
