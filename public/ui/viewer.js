// The image viewer: one picture of a chat over the page, with the others a step away. It sits beside the app so the
// app can be made inert while it is open.
import { dataUrlToBlob, isDataUrl, joinEarlier, nearestThumb, position, stepKey, swipeStep, tabTarget } from './gallery.js';
import { useStore } from './hooks.js';
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from './html.js';
import { shortcut } from './shortcuts.js';
import { createStore } from './store.js';
import { atOwnSize, boxOf, DOUBLE_TAP_ZOOM, DRAG_PX, FIT, isDoubleTap, isTap, panBy, pinchOf, pinchTo, rebox, rectOf, settle, TAP_PX, toFit, travelled, WHEEL_QUIET_MS, wheelPx, wheelZoom, zoomAt } from './zoom.js';

const viewer = createStore({ open: null, earlier: [] });

// `current`, if given, returns the list as it stands when the viewer closes: a message still being sent gets new keys when it is saved.
// `later`, if given, is a promise of the pictures from before `images`; the viewer keeps to `images` if it fails.
export function openViewer(images, index, from, current, later) {
  const open = { images, index, from, current };
  viewer.set({ open, earlier: later ? null : [] });
  later?.catch(() => []).then(list => { if (viewer.get().open === open) viewer.set({ earlier: list }); });
}
export const closeViewer = () => viewer.set({ open: null, earlier: [] });

const Close = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>`;
export const NewTab = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M8.5 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5v-3M11.5 4H16v4.5M16 4l-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const ZoomIn = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M12.5 12.5l4 4M8.5 6v5M6 8.5h5M14 8.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const ZoomOut = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M12.5 12.5l4 4M6 8.5h5M14 8.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const Prev = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M12 4.5 6.5 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const Next = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M8 4.5 13.5 10 8 15.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

const isBackdrop = el => el.dataset?.backdrop !== undefined;

// A thumbnail someone can see. Chromium and WebKit keep the boxes of what a closed details hides, so having a box is not enough.
const isOnScreen = el => !!el?.isConnected && el.getClientRects().length > 0 && !el.closest('details:not([open])');

// A view at fit whose box is not measured yet. It also stands for a view that has to be measured again.
const UNMEASURED = { ...FIT, box: null };

// How far each key pans a zoomed picture, in stage heights, as a scroll area scrolls. Infinity goes all the way to the edge.
const JUMPS = { PageDown: -0.9, PageUp: 0.9, End: -Infinity, Home: Infinity };

const point = e => ({ x: e.clientX, y: e.clientY });

// The first two fingers down, in stage px. A third is ignored.
const fingers = (touches, left, top) => {
  const { d, x, y } = pinchOf(...touches.values());
  return { d, x: x - left, y: y - top };
};

function Viewer({ images, start, from, current, earlier }) {
  const root = useRef(null);
  const stage = useRef(null);
  const picture = useRef(null);
  const press = useRef({ touches: new Map(), start: null, drag: null });
  const lastTap = useRef(null);
  const gesture = useRef(null);
  const carry = useRef(null);
  const [key, setKey] = useState(images[start].key);
  const [held, setHeld] = useState(UNMEASURED);
  const [dragging, setDragging] = useState(false);
  const [seen, setSeen] = useState({});
  const [loaded, setLoaded] = useState(0);
  const waiting = earlier === null;
  const all = useMemo(() => (waiting ? images : joinEarlier(earlier, images)), [images, earlier]);
  const allNow = useRef(all);
  allNow.current = all;
  const at = Math.max(0, all.findIndex(i => i.key === key));
  const total = all.length;
  const image = all[at];
  const shownNow = useRef(image.key);
  shownNow.current = image.key;

  // The picture on screen is held by its key, so earlier pictures arriving in front of it do not move it.
  // The latest list is read from a ref because the key listener is added once.
  const step = by => setKey(k => stepKey(allNow.current, k, by));

  // A view keeps the key of the picture it was measured on, so a step by any route opens the next picture at fit.
  // The refs are what the listeners added once read, and what an event sees before the render its predecessor asked for.
  const viewNow = useRef(held);
  const mine = v => (v.key === shownNow.current ? v : UNMEASURED);
  const show = next => { viewNow.current = { ...next, key: shownNow.current }; setHeld(viewNow.current); };
  const move = change => { const v = mine(viewNow.current); if (v.box) show(change(v, v.box)); };
  const zoomedNow = () => mine(viewNow.current).s > 1;
  const view = mine(held);

  // Keys are caught before the page behind sees them, so Esc closes this instead of also stopping a running chat.
  // With the app inert, Tab would leave through the browser's own controls, so it is kept moving among ours.
  useLayoutEffect(() => {
    const el = root.current;
    const app = document.getElementById('app');
    const controls = () => [...el.querySelectorAll('button:not(:disabled), a[href]')];
    const onKey = e => {
      if (e.isComposing) return;
      // Capcom's own shortcuts do nothing here, and are kept from Chrome too, or Cmd+N in the app would open a second window.
      if (e.altKey || e.ctrlKey || e.metaKey) { if (shortcut(e)) e.preventDefault(); e.stopPropagation(); return; }
      const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      const dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      const panning = zoomedNow();
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeViewer(); }
      // Up and down are the viewer's only while zoomed, where all four arrows pan. At fit left and right step.
      else if (dx || (dy && panning)) {
        e.preventDefault();
        e.stopPropagation();
        if (panning) move((v, box) => panBy(v, -dx * box.sw / 10, -dy * box.sh / 10, box));
        else step(dx);
      }
      else if (panning && Object.hasOwn(JUMPS, e.key)) {
        e.preventDefault();
        e.stopPropagation();
        move((v, box) => panBy(v, 0, JUMPS[e.key] * box.sh, box));
      }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const list = controls();
        (list[tabTarget(list.length, list.indexOf(document.activeElement), e.shiftKey)] || el).focus();
      }
    };
    const onFocus = e => { if (!el.contains(e.target)) el.focus(); };

    // A ctrl+wheel pinch has no end event, so it ends when the wheel has been quiet.
    let quiet = 0;
    // Safari sends a trackpad pinch as gesture events and the other browsers as a ctrl+wheel, so a gesture in progress mutes the wheel.
    const onWheel = e => {
      if (!e.ctrlKey && !zoomedNow()) return;
      e.preventDefault();
      if (e.ctrlKey && gesture.current) return;
      const { left, top } = stage.current.getBoundingClientRect();
      move((v, box) => (e.ctrlKey
        ? zoomAt(v, wheelZoom(wheelPx(e.deltaY, e.deltaMode, box.sh)), e.clientX - left, e.clientY - top, box)
        : panBy(v, -wheelPx(e.deltaX, e.deltaMode, box.sh), -wheelPx(e.deltaY, e.deltaMode, box.sh), box)));
      if (e.ctrlKey) { clearTimeout(quiet); quiet = setTimeout(() => move(settle), WHEEL_QUIET_MS); }
    };
    // With fingers down the pointer events have the pinch already. Without, this is a trackpad.
    const onGesture = e => {
      e.preventDefault();
      if (e.type === 'gesturestart') { gesture.current = { scale: 1 }; return; }
      const g = gesture.current;
      if (!g) return;
      const trackpad = !press.current.touches.size;
      if (e.type === 'gestureend') { gesture.current = null; if (trackpad) move(settle); return; }
      const k = e.scale / g.scale;
      g.scale = e.scale;
      if (!trackpad) return;
      const { left, top } = stage.current.getBoundingClientRect();
      move((v, box) => zoomAt(v, k, Number.isFinite(e.clientX) ? e.clientX - left : box.sw / 2, Number.isFinite(e.clientY) ? e.clientY - top : box.sh / 2, box));
    };
    // WebKit lets a second finger zoom the page unless its touchmove is cancelled. Never cancel touchstart, which would end taps and clicks.
    const onTouchMove = e => { if (e.touches.length > 1) e.preventDefault(); };
    const gestures = ['gesturestart', 'gesturechange', 'gestureend'];

    el.focus({ preventScroll: true });
    app?.setAttribute('inert', '');
    app?.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.add('viewing');
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    for (const type of gestures) el.addEventListener(type, onGesture);
    return () => {
      clearTimeout(quiet);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', onTouchMove);
      for (const type of gestures) el.removeEventListener(type, onGesture);
      document.documentElement.classList.remove('viewing');
      app?.removeAttribute('inert');
      app?.removeAttribute('aria-hidden');
      // Focus goes back to the thumbnail clicked, not the picture stepped to. If that was redrawn or has gone, the same picture's
      // thumbnail takes it, else the one at its place in the thread now (a sent message gets new keys), else the nearest.
      const shown = [...document.querySelectorAll('[data-image]')].filter(isOnScreen);
      const keys = (current?.() ?? images).map(i => i.key);
      (isOnScreen(from) ? from : shown[nearestThumb(shown.map(t => t.dataset.image), keys, start, images[start].key)])?.focus();
    };
  }, []);

  // A new stage size makes the measured box stale, so the picture is measured again at fit and a zoom it had is carried over to the new box.
  // While it is unmeasured there is nothing to keep, so a second callback leaves the zoom already taken.
  useLayoutEffect(() => {
    let last = '';
    const watch = new ResizeObserver(([entry]) => {
      const size = `${entry.contentRect.width}x${entry.contentRect.height}`;
      if (last && size !== last) {
        const v = mine(viewNow.current);
        if (v.box) carry.current = v.s > 1 ? v : null;
        show(UNMEASURED);
      }
      last = size;
    });
    watch.observe(stage.current);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    for (const near of [all[at - 1], all[at + 1]]) if (near && !isDataUrl(near.src)) new Image().src = near.src;
  }, [at, all]);

  const mark = state => setSeen(s => (s[image.key] === state ? s : { ...s, [image.key]: state }));
  const status = seen[image.key];

  // Another picture drops the view held and any zoom a resize took. Otherwise a step to a picture that is never measured and back would bring the first one's zoom back.
  useLayoutEffect(() => { carry.current = null; if (viewNow.current.box) show(UNMEASURED); }, [image.key]);

  // The box can only be measured while the picture sits at fit, which it does until it is zoomed. A picture seen before is
  // ready at once, but its new element may not have loaded, so each load measures again.
  useLayoutEffect(() => {
    const pic = picture.current;
    if (status !== 'ready' || view.box || !pic.naturalWidth) return;
    const box = boxOf(stage.current.getBoundingClientRect(), pic.getBoundingClientRect(), parseFloat(getComputedStyle(pic).borderLeftWidth), pic.naturalWidth);
    const was = carry.current;
    carry.current = null;
    show({ ...(box && was?.key === image.key ? rebox(was, was.box, box) : FIT), box });
  }, [status, view.box, loaded, image.key]);

  const openHere = () => {
    const blob = URL.createObjectURL(dataUrlToBlob(image.src));
    window.open(blob, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(blob), 60_000);
  };

  const zoomed = view.s > 1;
  const rect = zoomed && rectOf(view, view.box);
  const stuck = !zoomed && !!view.box && atOwnSize(view.box);
  const onFit = () => move((v, box) => (v.s > 1 ? toFit(v) : atOwnSize(box) ? v : zoomAt(v, box.actual, box.sw / 2, box.sh / 2, box)));
  const fitLabel = zoomed ? 'Fit to screen' : 'Actual size';

  // A pinch is worked from the view and fingers at its start, which is taken again whenever a finger lands or lifts or the view is measured again.
  const anchor = touches => {
    const { left, top } = stage.current.getBoundingClientRect();
    return { from: mine(viewNow.current), left, top, start: fingers(touches, left, top) };
  };

  // NOTE: [18 Oct 2026] EK - Keep the viewer and its stage at touch-action: none in app.css and handle every touch gesture here.
  // WebKit has no pan-left, pan-right, pan-up or pan-down, and lets a second finger through pan-x and pan-y.
  // See https://bugs.webkit.org/show_bug.cgi?id=238543.
  const onDown = e => {
    const touch = e.pointerType !== 'mouse';
    // A primary touch begins a new press, so fingers a lost pointerup left recorded cannot turn it into a pinch.
    if (!touch || e.isPrimary || !press.current.touches.size) {
      press.current = { touches: new Map(), start: { ...point(e), t: e.timeStamp }, slop: touch ? TAP_PX : DRAG_PX, backdrop: isBackdrop(e.target), onPicture: e.target === picture.current, moved: false, swipe: false, pinched: false, pinch: null, drag: null };
    }
    const p = press.current;
    if (!touch) {
      if (e.button === 0 && zoomedNow() && stage.current.contains(e.target)) {
        p.drag = point(e);
        stage.current.setPointerCapture(e.pointerId);
        setDragging(true);
      }
      return;
    }
    p.touches.set(e.pointerId, point(e));
    if (p.touches.size === 1) p.swipe = e.isPrimary && !zoomedNow();
    // A second finger ends any step or tap for the rest of the press, so a pinch never steps however the fingers travel.
    else { p.swipe = false; p.pinched = true; p.pinch = anchor(p.touches); }
  };
  const onMove = e => {
    const p = press.current;
    const touch = e.pointerType !== 'mouse';
    if (touch ? !p.touches.has(e.pointerId) : !(e.buttons & 1)) return;
    if (p.start && !p.moved && travelled(p.start, point(e)) > p.slop) p.moved = true;
    if (touch && p.touches.size > 1) {
      p.touches.set(e.pointerId, point(e));
      move((v, box) => {
        if (p.pinch.from.box !== box) p.pinch = anchor(p.touches);
        const { from, left, top, start } = p.pinch;
        return pinchTo(from, start, fingers(p.touches, left, top), box);
      });
      return;
    }
    const was = touch ? p.touches.get(e.pointerId) : p.drag;
    if (touch) p.touches.set(e.pointerId, point(e));
    else if (was) p.drag = point(e);
    if (was && zoomedNow()) move((v, box) => panBy(v, e.clientX - was.x, e.clientY - was.y, box));
  };
  const lift = (e, cancelled) => {
    const p = press.current;
    if (e.pointerType === 'mouse') {
      if (p.drag) { p.drag = null; setDragging(false); }
      return;
    }
    if (!p.touches.delete(e.pointerId)) return;
    p.pinch = p.touches.size > 1 ? anchor(p.touches) : null;
    if (p.touches.size) return;
    if (p.pinched) { move(settle); return; }
    const up = { ...point(e), t: e.timeStamp };
    if (!cancelled && p.swipe) step(swipeStep(up.x - p.start.x, up.y - p.start.y));
    if (cancelled || !p.onPicture || !isTap(p.start, up)) { lastTap.current = null; return; }
    if (lastTap.current && isDoubleTap(lastTap.current, up)) {
      lastTap.current = null;
      const { left, top } = stage.current.getBoundingClientRect();
      move((v, box) => (v.s > 1 ? toFit(v) : zoomAt(v, DOUBLE_TAP_ZOOM, up.x - left, up.y - top, box)));
    } else lastTap.current = up;
  };
  // A click closes only if it began on the backdrop too, stayed put and never had a second finger, so a drag or a pinch that ends there does not.
  // NOTE: [24 Nov 2026] EK - Keep cancelling clicks on the picture. WebKit's source has a route that zooms the page on a double tap whose click
  // nobody handled, and touch-action does not stop it. See https://github.com/kulesy/ghostshell/issues/1.
  const onClick = e => {
    const p = press.current;
    if (e.target === picture.current) e.preventDefault();
    else if (p.backdrop && !p.moved && !p.pinched && isBackdrop(e.target)) closeViewer();
  };
  // A long press on a zoomed picture would open the browser's menu, which cancels the pan. A mouse keeps its right click.
  const onContextMenu = e => { if (zoomedNow() && press.current.touches.size) e.preventDefault(); };

  const note = status === 'failed'
    ? html`<p class="viewer-note" role="alert">This image could not be loaded.</p>`
    : status ? null : html`<p class="viewer-note">Loading</p>`;

  return html`<div class="viewer" ref=${root} role="dialog" aria-modal="true" aria-label="Image viewer" tabindex="-1" data-backdrop
      onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${e => lift(e, false)} onPointerCancel=${e => lift(e, true)} onClick=${onClick} onContextMenu=${onContextMenu}>
    <div class="viewer-bar" data-backdrop>
      <button class="btn viewer-fit" data-variant="outline" data-size="icon" type="button" aria-label=${fitLabel} aria-disabled=${!view.box || stuck} data-tip=${stuck ? 'Already at actual size' : fitLabel} onClick=${onFit}>${zoomed ? html`<${ZoomOut} />` : html`<${ZoomIn} />`}</button>
      ${isDataUrl(image.src)
        ? html`<button class="btn" data-variant="outline" data-size="icon" type="button" aria-label="Open in new tab" data-tip="Open in new tab" onClick=${openHere}><${NewTab} /></button>`
        : html`<a class="btn" data-variant="outline" data-size="icon" href=${image.src} target="_blank" rel="noopener" aria-label="Open in new tab" data-tip="Open in new tab"><${NewTab} /></a>`}
      <button class="btn" data-variant="outline" data-size="icon" type="button" aria-label="Close" data-tip="Close" data-tip-key="Esc" onClick=${closeViewer}><${Close} /></button>
    </div>
    <div class="viewer-stage" ref=${stage} data-backdrop data-size=${zoomed ? 'zoom' : 'fit'} data-drag=${dragging ? '' : undefined}>
      <img class="viewer-img" ref=${picture} key=${image.key} src=${image.src} alt=${image.alt} draggable=${false} data-state=${status || 'loading'}
        style=${rect ? { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` } : undefined}
        onLoad=${() => { mark('ready'); setLoaded(n => n + 1); }} onError=${() => mark('failed')} />
      ${note}
    </div>
    ${total > 1 || waiting ? html`<div class="viewer-pager" data-backdrop>
      <button class="btn" data-variant="outline" data-size="icon" type="button" aria-label="Previous image" data-tip="Previous" data-tip-key="←" aria-disabled=${at === 0} onClick=${() => step(-1)}><${Prev} /></button>
      <p class="viewer-count" aria-live="polite" aria-atomic="true">${waiting ? '' : position(at, total)}</p>
      <button class="btn" data-variant="outline" data-size="icon" type="button" aria-label="Next image" data-tip="Next" data-tip-key="→" aria-disabled=${at === total - 1} onClick=${() => step(1)}><${Next} /></button>
    </div>` : null}
  </div>`;
}

export function ViewerHost() {
  const open = useStore(viewer, s => s.open);
  const earlier = useStore(viewer, s => s.earlier);
  return open ? html`<${Viewer} key=${open} images=${open.images} start=${open.index} from=${open.from} current=${open.current} earlier=${earlier} />` : null;
}
