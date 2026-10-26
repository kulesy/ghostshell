import { pointIn } from './drag.js';
import { Fragment, html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { enter, holdPointer, onPressOutside, topmost } from './layer.js';
import { isSecondary } from './layer-rules.js';
import { graceArea, inside, keyedItem, nextMatch, place, roleOf, stepIn } from './menu-rules.js';
import { usePresence } from './presence.js';
import { shortcut } from './shortcuts.js';

// shadcn's dropdown and context menus, which are Radix's, and modal as they are: the page under an open menu takes no press.
// `items` are { label, run, icon, hint, danger, disabled }, { separator: true }, { group, items } for items under a heading, or
// { label, icon, items } for an item that opens a sub-menu. `hint` names the key that does the same. A group with `heading: false` keeps
// its name for assistive technology and draws none. An item can also have:
// `checked` (true or false) to be a radio item, which draws a check in place of its hint when true; `switch` (true or false) to be a switch;
// `value` for muted text at the right; `warn` for a warning icon there; `key`, one character that picks the item while this menu has the
// focus, ahead of typing to find an item; `tip`, the words of a tooltip; and `id`, which keeps the focus on the item when the items
// before it change, as they do when the CLI's models arrive.
// A sub-menu can also have `find(query)`, which returns the items it lists for the words typed, and `findLabel`, what its search box is
// called. The box sits at the top of the sub-menu and keeps the focus, and the arrows light an item in the list with Enter picking it.
// The list is a listbox of options, so assistive technology reads the lit item as the selected one.

// Whether the last input was a key. A menu opened by a key lights its first item, and one opened by a pointer lights none.
let keyboard = false;
document.addEventListener('keydown', () => { keyboard = true; }, true);
document.addEventListener('pointerdown', () => { keyboard = false; }, true);
document.addEventListener('pointermove', () => { keyboard = false; }, true);

// Lucide's 24px outlines, as the paths shadcn's menus draw.
export const icons = {
  pencil: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', 'm15 5 4 4'],
  folderInput: ['M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1', 'M2 13h10', 'm9 16 3-3-3-3'],
  archive: ['M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'],
  messageSquare: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  messageSquarePlus: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', 'M12 7v6', 'M9 10h6'],
  folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  folderPlus: ['M12 10v6', 'M9 13h6', 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  arrowUp: ['m5 12 7-7 7 7', 'M12 19V5'],
  arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
  trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  indentIncrease: ['M21 12H11', 'M21 18H11', 'M21 6H11', 'm3 8 4 4-4 4'],
  indentDecrease: ['M21 12H11', 'M21 18H11', 'M21 6H11', 'm7 8-4 4 4 4'],
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  squareCheck: ['M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.5', 'm9 11 3 3L22 4'],
  triangleAlert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  terminal: ['m4 17 6-6-6-6', 'M12 19h8'],
  copy: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  play: ['M6 3l14 9-14 9Z'],
  square: ['M6 6h12v12H6Z'],
  file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4'],
  rotateCcw: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  search: ['M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z', 'm21 21-4.3-4.3'],
  quote: ['M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z', 'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'],
  circlePlay: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'm10 8 6 4-6 4Z'],
  pause: ['M15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'],
  calendarClock: ['M16 14v2.2l1.6 1', 'M16 2v4', 'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5', 'M3 10h5', 'M8 2v4', 'M10 16a6 6 0 1 0 12 0 6 6 0 1 0-12 0'],
};

export const draw = (paths, className) => html`<svg class=${className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.map(d => html`<path d=${d} />`)}</svg>`;

// The id of a menu's element, which the button that opened it names in aria-controls. `path` names a sub-menu: 2.0 is the first item
// of the third item's menu.
export const layerId = (menu, path = '') => `menu-${menu}${path ? `-${path.replace(/\./g, '-')}` : ''}`;

// Where each kind of layer sits against what opened it: a sub-menu beside its item, a context menu beside the pointer, a dropdown
// under its button.
const RULES = {
  sub: { side: 'right', align: 'start', offset: 0 },
  point: { side: 'right', align: 'start', offset: 2 },
  button: { side: 'bottom', align: 'end', offset: 4 },
};

const rectOf = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });

// Whether something the menu is drawn in is animating, such as the sheet while it slides in. An animation that has ended but holds its
// last frame, or one that follows a scroll, does not count, or the menu would follow it for as long as it is open.
const animating = el => {
  for (let up = el.parentElement; up; up = up.parentElement) if (up.getAnimations().some(a => a.playState === 'running' && a.timeline === document.timeline)) return true;
  return false;
};

const LIVE = '[role^="menuitem"]:not([data-disabled]), [role="option"]:not([data-disabled])';

const listIdOf = id => `${id}-list`;

const flatOf = items => items.flatMap(it => (it.group ? it.items : it.separator ? [] : [it]));

function Layer({ open, onGone, ...rest }) {
  const box = useRef(null);
  const present = usePresence(open, box, onGone);
  return present ? html`<${Panel} box=${box} open=${open} ...${rest} />` : null;
}

// One menu: its items, and beside it the sub-menu of the item that opens one, which is a layer of its own so the scrolling and
// clipping of this one cannot cut it off. `root` holds what the layers share.
function Panel({ root, box, items: listed, path, open, label, labelledBy, trigger, entry, back, find, findLabel }) {
  const id = layerId(root.id, path);
  const [at, setAt] = useState(null);
  const [sub, setSub] = useState(null);
  const [query, setQuery] = useState('');
  const [marked, setMarked] = useState(-1);
  const finding = !!find;
  const words = query.trim() !== '';
  const items = finding && words ? find(query) : listed;
  const flat = flatOf(items);
  const rows = useRef([]);
  const size = useRef(null);
  const search = useRef(null);
  const wide = useRef(0);
  const opened = useRef(null);
  const follow = useRef(false);
  const still = useRef(null);
  const typed = useRef({ text: '', timer: 0 });
  const wait = useRef(0);
  const pressed = useRef(null);
  const placed = at !== null;
  const subPath = n => (path ? `${path}.${n}` : String(n));
  const enabled = () => [...box.current.querySelectorAll(LIVE)];
  const lit = el => { if (el && document.activeElement !== el) el.focus({ preventScroll: true }); };
  // focus() alone would put an item that was out of view in the middle of the menu, so the menu scrolls only as far as its nearest
  // edge. The first item of a group brings the group's label with it, as the search does with its headings.
  const bring = el => {
    const group = el.closest('[role="group"]');
    if (group?.querySelector(LIVE) === el) group.querySelector('.menu-label')?.scrollIntoView({ block: 'nearest' });
    el.scrollIntoView({ block: 'nearest' });
  };
  const reach = el => {
    el.focus({ preventScroll: true });
    bring(el);
  };
  const openSub = (n, which = null) => setSub({ at: n, entry: which && { which } });

  const lay = holding => {
    const from = trigger ? trigger() : root.anchor;
    const anchor = !trigger && root.point ? { x: root.point.x, y: root.point.y, width: 0, height: 0 } : rectOf(from.getBoundingClientRect());
    const v = window.visualViewport;
    const view = v ? { x: v.offsetLeft, y: v.offsetTop, width: v.width, height: v.height } : { width: innerWidth, height: innerHeight };
    const kind = trigger ? 'sub' : root.point ? 'point' : 'button';
    const at = place({ anchor, size: size.current, view, pad: 8, dpr: window.devicePixelRatio || 1, ...RULES[kind], held: holding ? opened.current : null });
    if (finding && !holding) opened.current = at;
    // A transformed ancestor, such as the sheet while it slides in, is the containing block of a fixed menu, so its left and top count
    // from that block's corner and not the window's. A probe beside the menu finds the corner.
    const probe = document.createElement('div');
    probe.style.cssText = `position:${getComputedStyle(box.current).position};left:0;top:0;width:0;height:0;margin:0;visibility:hidden`;
    box.current.after(probe);
    const corner = probe.getBoundingClientRect();
    probe.remove();
    return { ...at, x: at.x - corner.x, y: at.y - corner.y };
  };

  // A reload can take away the row or button a menu was opened from, and a menu with nothing to hang from has nowhere to sit.
  useLayoutEffect(() => {
    if (!(trigger ? trigger() : root.anchor)?.isConnected) { root.shut(false); return; }
    const r = box.current.getBoundingClientRect();
    size.current = { width: r.width, height: r.height };
    wide.current = r.width;
    setAt(lay());
  }, []);

  // A search that changes the size of its list keeps the menu where it opened, and a move of the window or the anchor places it afresh.
  const again = holding => {
    const next = lay(holding === true);
    setAt(now => (now && now.x === next.x && now.y === next.y && now.room === next.room && now.side === next.side ? now : next));
  };

  // Tree places every layer again when the keyboard on a phone moves the window or the anchor while the search box has the focus.
  useEffect(() => {
    const layer = { depth: path ? path.split('.').length : 0, again };
    root.layers.add(layer);
    return () => { root.layers.delete(layer); };
  }, []);

  // A sub-menu opened again while it fades out starts with an empty box, as one drawn afresh does. Tree keeps the menu on the page
  // while a search box has had the focus in an opening, which ends when the sub-menu closes.
  useLayoutEffect(() => {
    if (open) { setQuery(''); setMarked(-1); } else if (root.searched === id) root.searched = null;
  }, [open]);

  // The + menu grows when the list arrives, and a menu taller than its room is cut to it, so a change of size places it again.
  useEffect(() => {
    const watch = new ResizeObserver(([e]) => {
      // A menu that has just been removed reports a size of 0 before this observer is disconnected.
      if (!e.target.isConnected) return;
      const b = e.borderBoxSize?.[0] ?? { inlineSize: e.contentRect.width, blockSize: e.contentRect.height };
      const was = size.current;
      if (!was || (Math.abs(was.width - b.inlineSize) < 0.01 && Math.abs(was.height - b.blockSize) < 0.01)) return;
      size.current = { width: b.inlineSize, height: b.blockSize };
      again(finding);
    });
    watch.observe(box.current);
    return () => watch.disconnect();
  }, []);

  // A menu opened while the sheet slides in is kept inside the window from where the sheet is at that moment, and the slide then carries
  // it too far, so it is placed again on each frame until the slide is over. A search sub-menu keeps where it opened, so it waits for
  // its parent menu to stop moving in the same way.
  useEffect(() => {
    let frame = 0;
    const moving = () => animating(finding && trigger ? trigger() : box.current);
    const follow = () => {
      if (!(trigger ? trigger() : root.anchor)?.isConnected) return;
      again();
      if (moving()) frame = requestAnimationFrame(follow);
    };
    if (moving()) frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, []);

  // A key lights the first or last item, or goes to a sub-menu's search box. A pointer leaves the focus on the item, so a touch
  // does not raise the keyboard.
  useLayoutEffect(() => {
    if (!open || !placed) return;
    const which = entry?.which ?? (!trigger && keyboard ? 'first' : null);
    if (!trigger) box.current.focus({ preventScroll: true });
    if (!which) return;
    if (finding) { search.current.focus({ preventScroll: true }); return; }
    const list = enabled();
    list[which === 'last' ? list.length - 1 : 0]?.focus();
  }, [open, placed, entry]);

  // Focus that lands anywhere but on the open sub-menu or its item closes it, as the pointer moving on to another item does.
  useEffect(() => {
    if (!sub) return;
    const base = subPath(sub.at);
    const away = e => {
      const layer = e.target.closest?.(`.menu[data-menu-id="${root.id}"]`);
      if (layer && (layer.dataset.path === base || layer.dataset.path.startsWith(`${base}.`))) return;
      if (e.target !== rows.current[sub.at]) setSub(null);
    };
    document.addEventListener('focusin', away);
    return () => document.removeEventListener('focusin', away);
  }, [sub?.at]);

  useEffect(() => () => { clearTimeout(typed.current.timer); clearTimeout(wait.current); }, []);

  // The item a key lit scrolls into view, under the search box. One the pointer lit is already under the pointer.
  useLayoutEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    if (rows.current[marked]) bring(rows.current[marked]);
  }, [marked, query]);

  // Lights an item of the list for Enter, and shows it. `n` is an index among the items drawn, or -1 for none.
  const mark = n => { follow.current = true; setMarked(n); };
  const markable = () => flat.flatMap((it, n) => (it.disabled ? [] : [n]));

  // A key in the search box. Typing, Space and the caret keys are the box's own and never reach the menu's typeahead or item keys.
  // The arrows, Home and End light an item, Enter picks it, and the left arrow at the start of the box goes back to the parent item.
  function typedKey(e) {
    if (e.isComposing) return;
    const asked = shortcut(e);
    if (asked) { if (asked !== 'archive') root.shut(true); return; }
    if (e.key === 'Tab') { e.preventDefault(); return; }
    const field = e.target;
    if (e.key === 'Enter') {
      e.preventDefault();
      const def = flat[marked];
      if (def && !def.disabled && !def.items) root.pick(def);
      return;
    }
    if (e.key === 'ArrowLeft' && back && !e.shiftKey && field.selectionStart === 0 && field.selectionEnd === 0) { e.preventDefault(); back(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const from = markable();
    const to = stepIn(from.length, from.indexOf(marked), e.key);
    if (to >= 0) mark(from[to]);
  }

  function key(e) {
    if (finding && e.target === search.current) { typedKey(e); return; }
    const list = enabled();
    const here = list.indexOf(document.activeElement);
    const asked = shortcut(e);
    // The key goes on to do its job, which can move the list from under a menu fixed to the screen. Cmd+A is left to the list, which
    // reads the open menu for the row to archive and closes it when there is one.
    if (asked) { if (asked !== 'archive') root.shut(true); return; }
    if (e.key === 'Tab') { e.preventDefault(); return; }
    const opens = list[here]?.hasAttribute('aria-haspopup');
    const typing = typed.current.text !== '';
    if (e.key === 'Enter' || (e.key === ' ' && !typing)) {
      e.preventDefault();
      if (opens) openSub(Number(list[here].dataset.at), 'first');
      else list[here]?.click();
      return;
    }
    if (e.key === 'ArrowRight' && opens) { e.preventDefault(); openSub(Number(list[here].dataset.at), 'first'); return; }
    if (e.key === 'ArrowLeft' && back) { e.preventDefault(); back(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!e.shiftKey) {
      const to = stepIn(list.length, here, e.key);
      if (to >= 0) { e.preventDefault(); reach(list[to]); return; }
    }
    if (e.key.length !== 1) return;
    const keyed = keyedItem(flat, e.key);
    if (keyed >= 0) { e.preventDefault(); root.pick(flat[keyed]); return; }
    const t = typed.current;
    clearTimeout(t.timer);
    t.text += e.key;
    t.timer = setTimeout(() => { t.text = ''; }, 1000);
    if (e.key === ' ') e.preventDefault();
    const hit = nextMatch(list.map(el => el.querySelector('.menu-text').textContent.trim()), t.text, here);
    if (hit >= 0) reach(list[hit]);
  }

  // Typing finds items afresh, lights the first, and keeps an empty box the menu as it was.
  const onSearch = e => {
    setQuery(e.target.value);
    const first = e.target.value.trim() ? flatOf(find(e.target.value)).findIndex(it => !it.disabled) : -1;
    mark(first);
  };

  // The mouse over a menu with a search box gives the box the focus, so typing carries on where the pointer is.
  const near = e => {
    if (e.pointerType === 'mouse' && document.activeElement !== search.current) search.current.focus({ preventScroll: true });
  };

  // A pointer that has not moved lights nothing, because a list that scrolls under it sends a move of its own.
  const moved = e => {
    const was = still.current;
    still.current = [e.clientX, e.clientY];
    return !(was && was[0] === e.clientX && was[1] === e.clientY);
  };

  const toward = e => !!root.grace && root.dir === root.grace.side && inside({ x: e.clientX, y: e.clientY }, root.grace.area);

  function leave(e, el, n) {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(wait.current);
    wait.current = 0;
    if (sub?.at === n) {
      const subEl = document.getElementById(layerId(root.id, subPath(n)));
      if (subEl) {
        const side = subEl.dataset.side;
        root.grace = { area: graceArea({ x: e.clientX, y: e.clientY }, subEl.getBoundingClientRect(), side), side };
        clearTimeout(root.timer);
        root.timer = setTimeout(() => { root.grace = null; }, 300);
      } else root.grace = null;
    }
    // A pointer that jumps from one layer straight into another has not left the menu, and the item it lands on takes the focus.
    const into = e.relatedTarget?.closest?.(`.menu[data-menu-id="${root.id}"]`);
    if (toward(e) || (into && into !== box.current)) return;
    if (finding) return;
    box.current.focus({ preventScroll: true });
  }

  function hover(e, def, el, n) {
    if (e.pointerType !== 'mouse') return;
    if (def.disabled) { leave(e, el, n); return; }
    if (toward(e)) return;
    if (finding) { if (moved(e)) setMarked(n); }
    else lit(el);
    if (def.items && sub?.at !== n && !wait.current) {
      root.grace = null;
      wait.current = setTimeout(() => { wait.current = 0; openSub(n); }, 100);
    }
  }

  // A press in a menu with a search box leaves the focus in the box, where it would fall on the menu or on the result pressed. A press on
  // the icon or the padding of the box focuses it, and the click on a result still picks it.
  const keepBox = e => {
    if (e.target === search.current) return;
    e.preventDefault();
    if (e.target.closest('.menu-search')) search.current.focus({ preventScroll: true });
  };

  // A press that began on the button that opened the menu, or on another item, and ends on an item picks it, as Radix's items do.
  function release(e, def) {
    const started = pressed.current;
    pressed.current = null;
    if (started !== e.currentTarget && e.pointerType === 'mouse' && e.button === 0 && !def.disabled) e.currentTarget.click();
  }

  function pick(def, el, n) {
    if (def.disabled) return;
    if (!def.items) { root.pick(def); return; }
    lit(el);
    if (sub?.at !== n) openSub(n);
  }

  const row = def => {
    const n = flat.indexOf(def);
    const opens = !!def.items;
    const shown = opens && open && sub?.at === n;
    const { role, checked } = finding ? { role: 'option', checked: null } : roleOf(def);
    return html`<div key=${def.id ?? n} class="menu-item" role=${role} aria-checked=${checked} aria-selected=${finding ? marked === n : null} tabindex="-1" id=${`${id}-item-${n}`} data-at=${n} data-tip=${def.tip || null}
      data-variant=${def.danger ? 'destructive' : null} data-disabled=${def.disabled ? '' : null} aria-disabled=${def.disabled ? 'true' : null}
      data-state=${opens ? (shown ? 'open' : 'closed') : null} data-highlighted=${marked === n ? '' : null} aria-haspopup=${opens ? (def.find ? 'listbox' : 'menu') : null} aria-expanded=${opens ? shown : null}
      aria-controls=${opens ? (def.find ? listIdOf(layerId(root.id, subPath(n))) : layerId(root.id, subPath(n))) : null} ref=${el => { rows.current[n] = el; }}
      onClick=${e => pick(def, e.currentTarget, n)} onPointerDown=${e => { pressed.current = e.currentTarget; }} onPointerUp=${e => release(e, def)}
      onPointerMove=${e => hover(e, def, e.currentTarget, n)} onPointerLeave=${e => leave(e, e.currentTarget, n)}>
      ${def.icon ? draw(def.icon) : null}<span class="menu-text">${def.label}</span>${def.value ? html`<span class="menu-value">${def.value}</span>` : null}${def.warn ? draw(icons.triangleAlert, 'menu-warning') : null}${role === 'menuitemradio' && checked ? draw(icons.check, 'menu-check') : def.hint ? html`<span class="menu-shortcut">${def.hint}</span>` : null}${role === 'menuitemcheckbox' ? html`<span class="menu-switch" data-state=${checked ? 'checked' : 'unchecked'} aria-hidden="true"><span class="menu-switch-thumb"></span></span>` : null}${opens ? draw(['m9 18 6-6-6-6'], 'menu-chevron') : null}
    </div>`;
  };

  const body = items.map(it => (it.separator
    ? html`<div class="menu-separator" role="separator"></div>`
    : it.group
      ? html`<div role="group" aria-label=${it.group}>${it.heading === false ? null : html`<div class="menu-label" aria-hidden="true">${it.group}</div>`}${it.items.map(row)}</div>`
      : row(it)));

  // A menu keeps the width it opened with while a search changes its list, and a result too wide for it is cut with an ellipsis.
  const style = at
    ? `left:${at.x}px;top:${at.y}px;--menu-origin:${at.origin};--menu-room:${at.room}px${finding ? `;width:${wide.current}px` : ''}`
    : 'left:0;top:0;visibility:hidden;animation:none';

  // With a search box the menu element only holds the box and the list, which is a listbox, because a menu may own nothing but items.
  const semantics = { role: finding ? 'listbox' : 'menu', 'aria-orientation': 'vertical', 'aria-label': label || null, 'aria-labelledby': labelledBy || null };
  const found = finding && words && !flat.length;

  return html`<${Fragment}>
    <div class="menu" id=${id} ref=${box} tabindex="-1" ...${finding ? {} : semantics}
      data-menu-id=${root.id} data-path=${path} data-sub=${path ? '' : null} data-find=${finding ? '' : null} data-state=${open ? 'open' : 'closed'}
      data-side=${at?.side || null} data-align=${at?.align || null} inert=${!open} style=${style} onKeyDown=${key} onPointerMove=${finding ? near : null}
      onPointerDown=${finding ? keepBox : null} onMouseDown=${finding ? keepBox : null}>
      ${finding
        ? html`<div class="menu-search">${draw(icons.search)}<input class="menu-search-input" ref=${search} type="text" role="combobox" value=${query} placeholder=${findLabel} aria-label=${findLabel}
              aria-expanded="true" aria-autocomplete="list" aria-controls=${listIdOf(id)} aria-activedescendant=${flat[marked] ? `${id}-item-${marked}` : null}
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck=${false} enterkeyhint="go" onInput=${onSearch} onFocus=${() => { root.searched = id; }} /></div>
          <div class="menu-list" id=${listIdOf(id)} ...${semantics}>${body}</div>
          <div class="menu-empty" role="status">${found ? 'Nothing matches.' : null}</div>`
        : body}
    </div>
    ${flat.map((it, n) => (it.items
      ? html`<${Layer} key=${n} root=${root} items=${it.items} find=${it.find} findLabel=${it.findLabel} path=${subPath(n)} open=${open && sub?.at === n} labelledBy=${`${id}-item-${n}`}
          trigger=${() => rows.current[n]} entry=${sub?.at === n ? sub.entry : null} back=${() => { rows.current[n]?.focus(); setSub(null); }} />`
      : null))}
  <//>`;
}

// What a menu keeps while it is open, and the listeners that close it.
function Tree({ menu, open, onClose, onGone }) {
  const close = useRef(onClose);
  close.current = onClose;
  const shared = useRef(null);
  if (!shared.current) {
    const root = { id: menu.id, anchor: menu.anchor, point: menu.point || null, dir: 'right', grace: null, timer: 0, layers: new Set(), searched: null };
    // A press outside puts the focus back after the press has moved it, which it does once the pointer events are over.
    root.shut = (back, later) => {
      const focus = () => { if (root.anchor.isConnected) root.anchor.focus({ preventScroll: true }); };
      if (back) { if (later) setTimeout(focus); else focus(); }
      close.current();
    };
    // The menu closes first, so a choice that opens a form or moves the focus is not undone by the menu leaving. An item with nothing
    // to run, such as the checked one, hands the focus back to the button as Esc does.
    root.pick = item => { if (!item.run) return root.shut(true); close.current(); item.run(); };
    shared.current = root;
  }
  const root = shared.current;
  const entry = useRef(menu.entry ? { which: menu.entry } : null).current;
  const me = useRef({}).current;

  // The page under a menu takes no press until the menu has faded out, so the first press outside only closes it and a second lands on
  // the page just the same.
  useLayoutEffect(() => holdPointer(), []);

  // A menu is a layer on the stack until it has faded out, so in a sheet Esc and the first press outside close only the menu, and a press
  // while it fades closes nothing.
  useLayoutEffect(() => enter(me), []);

  // A list that reloads can scroll without the button moving, so only a scroll that moves the anchor closes the menu. While a search
  // sub-menu is open whose box has had the focus, the keyboard of a phone resizes the window or scrolls the anchor, even after Done has
  // taken the focus from the box, and then the menu is placed again.
  useEffect(() => {
    if (!open) return;
    const { anchor } = root;
    let start = anchor.getBoundingClientRect();
    let frame = 0;
    const moved = () => { const now = anchor.getBoundingClientRect(); return Math.abs(now.top - start.top) > 1 || Math.abs(now.left - start.left) > 1; };
    const within = el => !!el.closest?.(`.menu[data-menu-id="${root.id}"]`);
    const searching = () => root.searched !== null;
    // A layer is placed from the one it hangs from, so the parents go first and the next frame settles the ones under them.
    const place = () => [...root.layers].sort((a, b) => a.depth - b.depth).forEach(layer => layer.again());
    const replace = () => {
      place();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
      start = anchor.getBoundingClientRect();
    };
    const escape = e => { if (e.key === 'Escape' && topmost(me)) { e.preventDefault(); e.stopPropagation(); root.shut(true); } };
    const scrolled = e => {
      if (within(e.target) || !moved()) return;
      if (searching()) replace();
      else close.current();
    };
    const away = () => { if (searching()) replace(); else close.current(); };
    const panned = () => { if (searching()) replace(); };
    const noNativeMenu = e => e.preventDefault();
    let lastX = 0;
    const track = e => { if (e.clientX !== lastX) { root.dir = e.clientX > lastX ? 'right' : 'left'; lastX = e.clientX; } };
    const stop = onPressOutside(within, e => root.shut(!isSecondary(e), true));
    document.addEventListener('keydown', escape, true);
    document.addEventListener('contextmenu', noNativeMenu, true);
    document.addEventListener('pointermove', track);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', away);
    window.visualViewport?.addEventListener('resize', panned);
    window.visualViewport?.addEventListener('scroll', panned);
    return () => {
      stop();
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('contextmenu', noNativeMenu, true);
      document.removeEventListener('pointermove', track);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', away);
      window.visualViewport?.removeEventListener('resize', panned);
      window.visualViewport?.removeEventListener('scroll', panned);
      clearTimeout(root.timer);
    };
  }, [open]);

  return html`<${Layer} root=${root} items=${menu.items} path="" open=${open} label=${menu.label} entry=${entry} onGone=${onGone} />`;
}

let pressedTrigger = null;

// The handlers of a button that opens a menu, as Radix's trigger has them. A mouse opens the menu when the button is pressed, so
// pressing, dragging to an item and letting go there picks it. A touch or a key opens it on the click, and the up and down arrows
// open it with the last or first item lit. `open(button, entry)` opens the menu.
export function opener(open) {
  return {
    onPointerDown(e) {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.ctrlKey) return;
      e.preventDefault();
      pressedTrigger = e.currentTarget;
      document.addEventListener('pointerup', () => setTimeout(() => { pressedTrigger = null; }), { once: true, capture: true });
      open(e.currentTarget);
    },
    onClick(e) {
      if (pressedTrigger === e.currentTarget && e.detail > 0) return;
      open(e.currentTarget);
    },
    onKeyDown(e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      open(e.currentTarget, e.key === 'ArrowDown' ? 'first' : 'last');
    },
  };
}

// A finger held still for this long asks for the menu, within this far of where it came down. These are drag.js's numbers, which ask
// the same of a session row.
const HOLD_MS = 350;
const HOLD_SLOP = 8;

let touching = false;
let endPress = null;
let quiet = 0;

const swallow = e => { e.preventDefault(); e.stopPropagation(); };
const swallowing = on => {
  for (const type of ['click', 'mousedown']) window[on ? 'addEventListener' : 'removeEventListener'](type, swallow, true);
};

// The handlers of an area that opens a menu as Radix's context menu trigger does: on a right click, at the pointer, on the menu key,
// with no point, and on a finger held still for HOLD_MS, at the finger. `open(area, point, from)` opens the menu, and `from` is the
// element the event came from, such as a menu button inside the area. The click that follows a long press is swallowed, so it picks
// nothing. A menu button inside the area keeps its own touches.
export function contextOpener(open) {
  return {
    onContextMenu(e) {
      e.preventDefault();
      if (!touching) open(e.currentTarget, keyboard ? null : pointIn(e.currentTarget, e), e.target);
    },
    onPointerDown(e) {
      if (e.pointerType === 'mouse' || !e.isPrimary || e.button !== 0) return;
      const area = e.currentTarget;
      const from = e.target;
      const start = { x: e.clientX, y: e.clientY };
      let now = start;
      let fired = false;
      endPress?.();
      clearTimeout(quiet);
      swallowing(false);
      touching = true;
      const timer = from.closest('[aria-haspopup="menu"]') ? 0 : setTimeout(() => {
        fired = true;
        swallowing(true);
        open(area, now, from);
      }, HOLD_MS);
      const stop = new AbortController();
      const end = () => {
        clearTimeout(timer);
        stop.abort();
        touching = false;
        endPress = null;
        if (fired) quiet = setTimeout(() => swallowing(false), 250);
      };
      endPress = end;
      document.addEventListener('pointermove', m => {
        if (!m.isPrimary) return;
        now = { x: m.clientX, y: m.clientY };
        if (Math.hypot(now.x - start.x, now.y - start.y) > HOLD_SLOP) clearTimeout(timer);
      }, { signal: stop.signal });
      document.addEventListener('pointerup', end, { signal: stop.signal });
      document.addEventListener('pointercancel', end, { signal: stop.signal });
    },
  };
}

// `menu` is { id, anchor, point, label, items, entry } while a menu is open, and null when none is. `id` is new for each opening.
// `anchor` is the button or row the menu hangs from and gives the focus back to, and `point` ({ x, y }) opens it at the pointer
// instead. `entry` is 'first' or 'last' to light that item on opening. A menu that has closed stays until it has faded out.
export function Menu({ menu, onClose }) {
  const last = useRef(null);
  const [ended, setEnded] = useState(0);
  if (menu) last.current = menu;
  const drawn = menu ?? (last.current?.id === ended ? null : last.current);
  if (!drawn) return null;
  return html`<${Tree} key=${drawn.id} menu=${drawn} open=${!!menu} onClose=${onClose} onGone=${() => setEnded(drawn.id)} />`;
}
