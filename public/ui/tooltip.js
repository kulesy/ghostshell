// shadcn's tooltip for every icon-only button. A button opts in with `data-tip` (its words) and `data-tip-key` (its shortcut, drawn
// as a <kbd>), and the listeners below are on the document, so a button needs nothing else. There is one host, so one tooltip shows
// at a time. Radix opens on the first pointer move over the trigger, at once on keyboard focus, and never for a touch. It closes
// on a press, a click, the pointer leaving, the trigger losing focus, a scroll, a resize, another tooltip opening and `dismissTooltip`,
// which a walk down the list calls once it has opened the session. A tooltip the keyboard opened keeps through a scroll and moves with
// its trigger until that is out of sight.
// An empty `data-tip` keeps the button a trigger and shows nothing, which is how a button hides its tooltip while its popover is open.
// `data-tip-side="right"` puts the tooltip beside a wide trigger such as a row, and `data-tip-delay` is the milliseconds from the pointer
// reaching the trigger to the tooltip opening: none for an icon button, 700 for a row, which is Radix's own delay. A tooltip that closed
// in the last 300ms makes the next one open at once. A held button opens none.
// A trigger whose text already says what the tooltip says, as a row's does for a screen reader, is not also described by it.
const GAP = 10;
const ARROW = 10;
const SKIP_DELAY = 300;

// Where a tooltip of `size` goes for a trigger at `t`, in a window of `view`: centred over the trigger and GAP above it, slid along
// the edge to stay in the window without leaving the trigger, and under the trigger when there is no room above. `arrow` is how far
// along the tooltip its arrow sits, or null when the trigger's centre is not under the tooltip.
// With `prefer` 'right' it goes GAP beside the trigger instead, centred on its height, on the left when only that side has room, and
// above or below as before when neither does. The arrow then sits down the tooltip's edge.
export function place(t, size, view, prefer = 'top') {
  const across = size.width + GAP;
  const after = view.width - (t.left + t.width);
  if (prefer === 'right' && (after >= across || t.left >= across)) {
    const side = after >= across ? 'right' : 'left';
    const y = Math.min(Math.max(t.top + t.height / 2 - size.height / 2, 0), view.height - size.height);
    const down = t.top + t.height / 2 - y - ARROW / 2;
    const x = side === 'right' ? t.left + t.width + GAP : t.left - across;
    return { side, x: Math.round(x), y: Math.round(y), arrow: down >= 0 && down <= size.height - ARROW ? down : null };
  }
  const need = size.height + GAP;
  const above = t.top;
  const below = view.height - (t.top + t.height);
  const side = above >= need || (below < need && above >= below) ? 'top' : 'bottom';
  const inWindow = Math.min(Math.max(t.left + t.width / 2 - size.width / 2, 0), view.width - size.width);
  const x = Math.min(Math.max(inWindow, t.left - size.width), t.left + t.width);
  const y = side === 'top' ? t.top - need : t.top + t.height + GAP;
  const along = t.left + t.width / 2 - x - ARROW / 2;
  return { side, x: Math.round(x), y: Math.round(y), arrow: along >= 0 && along <= size.width - ARROW ? along : null };
}

// Whether the middle of a trigger at `t` is inside `box`, which is how a tooltip tells that its trigger has not scrolled out of sight.
export function inView(t, box) {
  const x = t.left + t.width / 2 - box.left;
  const y = t.top + t.height / 2 - box.top;
  return x >= 0 && x <= box.width && y >= 0 && y <= box.height;
}

let host = null;
let tip = null;
let leaving = null;
let timer = 0;
let skip = 0;
let delayed = true;
let moved = null;
let pressed = false;
let touched = false;
let count = 0;
let installed = false;

const triggerOf = el => el?.closest?.('[data-tip]') ?? null;

const describe = (trigger, id, on) => {
  const rest = (trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== id);
  if (on) rest.push(id);
  if (rest.length) trigger.setAttribute('aria-describedby', rest.join(' '));
  else trigger.removeAttribute('aria-describedby');
};

function build(trigger, how, id) {
  const content = document.createElement('div');
  content.dataset.slot = 'tooltip-content';
  content.dataset.state = how;
  content.dataset.align = 'center';
  const line = document.createElement('div');
  line.dataset.part = 'tooltip-content-line';
  line.append(trigger.dataset.tip);
  if (trigger.dataset.tipKey) {
    const kbd = document.createElement('kbd');
    kbd.textContent = trigger.dataset.tipKey;
    line.append(kbd);
  }
  const arrow = document.createElement('span');
  arrow.dataset.part = 'tooltip-arrow';
  arrow.innerHTML = '<svg data-part="tooltip-content-arrow" width="10" height="5" viewBox="0 0 30 10" preserveAspectRatio="none"><polygon points="0,0 30,0 15,10"/></svg>';
  const copy = document.createElement('span');
  copy.id = id;
  copy.className = 'sr';
  copy.setAttribute('role', 'tooltip');
  copy.textContent = [trigger.dataset.tip, trigger.dataset.tipKey].filter(Boolean).join(' ');
  content.append(line, arrow, copy);
  return { content, arrow };
}

// Puts the tooltip beside its trigger, and again where a scroll has taken the trigger.
function position({ trigger, content, arrow }) {
  const t = trigger.getBoundingClientRect();
  const at = place(t, { width: host.offsetWidth, height: host.offsetHeight }, { width: innerWidth, height: innerHeight }, trigger.dataset.tipSide);
  host.style.transform = `translate(${at.x}px, ${at.y}px)`;
  content.dataset.side = at.side;
  const beside = at.side === 'right' || at.side === 'left';
  const tail = { top: host.offsetHeight + GAP, bottom: -GAP, right: -GAP, left: host.offsetWidth + GAP }[at.side];
  const along = at.arrow === null ? '50%' : `${at.arrow + ARROW / 2}px`;
  content.style.setProperty('--radix-tooltip-content-transform-origin', beside ? `${tail}px ${along}` : `${along} ${tail}px`);
  arrow.removeAttribute('style');
  if (at.arrow === null) arrow.style.visibility = 'hidden';
  else arrow.style[beside ? 'top' : 'left'] = `${at.arrow}px`;
}

function show(trigger, how) {
  clearTimeout(timer);
  if (tip?.trigger === trigger || !trigger.dataset.tip || !trigger.isConnected) return;
  hide();
  leaving?.();
  clearTimeout(skip);
  delayed = false;
  const id = `tooltip-${++count}`;
  const { content, arrow } = build(trigger, how, id);
  if (!host) {
    host = document.createElement('div');
    host.dataset.part = 'tooltip-host';
    document.body.append(host);
  }
  host.replaceChildren(content);
  position({ trigger, content, arrow });
  const said = !trigger.dataset.tipKey && trigger.innerText.replace(/\s+/g, ' ').includes(trigger.dataset.tip);
  if (!said) describe(trigger, id, true);
  const watch = new MutationObserver(() => { if (!trigger.isConnected) hide(); });
  watch.observe(document.body, { childList: true, subtree: true });
  tip = { trigger, content, arrow, id, watch };
}

function hide() {
  clearTimeout(timer);
  if (!tip) return;
  const { trigger, content, id, watch } = tip;
  tip = null;
  watch.disconnect();
  describe(trigger, id, false);
  content.dataset.state = 'closed';
  clearTimeout(skip);
  skip = setTimeout(() => { delayed = true; }, SKIP_DELAY);
  if (getComputedStyle(content).animationName === 'none') { content.remove(); return; }
  const stop = setTimeout(() => done(), 500);
  const end = e => { if (e.target === content) done(); };
  const done = () => {
    clearTimeout(stop);
    content.removeEventListener('animationend', end);
    content.removeEventListener('animationcancel', end);
    content.remove();
    if (leaving === done) leaving = null;
  };
  content.addEventListener('animationend', end);
  content.addEventListener('animationcancel', end);
  leaving = done;
}

// Closes the tooltip with no fade, for a caller that moved the focus onto a trigger and has already shown what the tooltip says.
export function dismissTooltip() {
  hide();
  leaving?.();
}

export function installTooltips() {
  if (installed) return;
  installed = true;
  const on = (type, fn, target = document) => target.addEventListener(type, fn, true);

  on('pointermove', e => {
    if (e.pointerType === 'touch' || e.buttons) return;
    const trigger = triggerOf(e.target);
    if (!trigger || trigger === moved) return;
    moved = trigger;
    if (delayed) timer = setTimeout(() => show(trigger, 'delayed-open'), Number(trigger.dataset.tipDelay) || 0);
    else show(trigger, 'instant-open');
  });

  on('pointerout', e => {
    const trigger = triggerOf(e.target);
    if (!trigger || trigger.contains(e.relatedTarget)) return;
    if (moved === trigger) moved = null;
    clearTimeout(timer);
    if (tip?.trigger === trigger) hide();
  });

  on('pointerdown', e => {
    touched = e.pointerType === 'touch';
    hide();
    if (!triggerOf(e.target)) return;
    pressed = true;
    document.addEventListener('pointerup', () => { pressed = false; }, { once: true, capture: true });
  });

  on('click', e => { if (triggerOf(e.target)) hide(); });

  on('focusin', e => {
    const trigger = triggerOf(e.target);
    if (trigger && !pressed && !touched && trigger.matches(':focus-visible')) show(trigger, 'instant-open');
  });

  on('focusout', e => { if (tip && triggerOf(e.target) === tip.trigger) hide(); });

  // Esc hides the tooltip and goes on to whatever else it closes, so a tooltip on a dialog's own button cannot cost a second press.
  // It marks the key as used, so the composer does not also stop a running chat.
  on('keydown', e => { touched = false; if (e.key === 'Escape') { if (tip) e.preventDefault(); hide(); } });
  // A walk down the list scrolls the row that has just taken the focus, and that must not close its tooltip.
  on('scroll', e => {
    if (!tip || !e.target.contains?.(tip.trigger)) return;
    const t = tip.trigger.getBoundingClientRect();
    const view = { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const clip = e.target === document ? view : e.target.getBoundingClientRect();
    if (tip.trigger.matches(':focus-visible') && inView(t, view) && inView(t, clip)) position(tip);
    else hide();
  }, window);
  on('resize', hide, window);
}
