import { html, useLayoutEffect, useRef, useState } from './html.js';

export const escapeCancels = cancel => e => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
};

// A name with its runs of whitespace made single spaces and its ends trimmed, as the server keeps it.
export const clean = value => (value || '').replace(/\s+/g, ' ').trim();

// How long a blur that moved the focus nowhere waits before it saves, for the macOS emoji picker or another panel to hand it back.
const BLANK_BLUR_GRACE_MS = 10000;

// A bare box for a name, in place of the title or button it names. Enter and the focus leaving save it, Esc cancels, and an empty name or
// one no different from `was` cancels without asking the server. `onSubmit(text, away)` resolves false when the server refused, and the
// box stays open. `away` says the focus left, so the caller leaves it where the person put it. With `blurSaves` false the focus leaving the
// box saves nothing, for a form whose `children` are controls beside it, and the caller's own buttons save and cancel.
export function NameForm({ label, placeholder, value = '', was = value, max = 80, grace = BLANK_BLUR_GRACE_MS, blurSaves = true, onSubmit, onCancel, children = null }) {
  const [text, setText] = useState(value);
  const input = useRef(null);
  const form = useRef(null);
  const ended = useRef(false);
  const gone = useRef(false);
  const kept = useRef(value);
  const finishing = useRef(null);
  const watch = useRef(null);
  const pointed = useRef(false);
  // Stops waiting on a blur that went nowhere: its timer, or the window focus it is waiting for.
  const disarm = () => { watch.current?.(); watch.current = null; };
  useLayoutEffect(() => {
    input.current.focus({ preventScroll: true });
    input.current.select();
    form.current.scrollIntoView({ block: 'nearest' });
    // A click's pointerdown comes before the blur it causes, so a press outside the form is noted for blur to see.
    const press = e => { if (!form.current.contains(e.target)) pointed.current = true; };
    document.addEventListener('pointerdown', press, true);
    return () => { gone.current = true; disarm(); document.removeEventListener('pointerdown', press, true); };
  }, []);

  // Enter, Esc and the focus leaving can follow one another, as the blur after the form closes does, so only the first save counts
  // until a refused one lets the form end again. Esc still cancels while a save is pending, so a request that hangs never traps the box.
  async function finish(away, save) {
    if (gone.current || (ended.current && save)) return;
    ended.current = true;
    const name = clean(text);
    if (!save || !name || name === clean(was)) return onCancel(away);
    if (!(await onSubmit(text, away))) ended.current = false;
  }
  finishing.current = finish;

  // maxlength counts UTF-16 units, so it refuses an emoji the server counts as one character. An edit past `max` characters is undone
  // instead, which keeps the end of the name. A composition is judged when it ends, as writing the value in the middle of one breaks it.
  const take = e => {
    disarm();
    const el = e.currentTarget;
    if (e.isComposing && e.type === 'input') return setText(el.value);
    if ([...el.value].length <= max) { kept.current = el.value; return setText(el.value); }
    const at = Math.max(0, el.selectionStart - (el.value.length - kept.current.length));
    el.value = kept.current;
    el.setSelectionRange(at, at);
    setText(kept.current);
  };

  // A window that loses the focus blurs the box too, and the name is saved only when the focus goes somewhere on the page. A blur that
  // names no element and follows no press is the emoji picker or another panel, so it waits `grace` for the box to get the focus back.
  const blur = e => {
    if (!blurSaves || !document.hasFocus()) return;
    if (e.relatedTarget || pointed.current) return finish(true, true);
    disarm();
    const timer = setTimeout(() => {
      if (document.activeElement === input.current) return;
      if (document.hasFocus()) return finishing.current(true, true);
      // The window lost the focus meanwhile, so the box is kept and refocused when the window returns.
      const back = () => input.current.focus({ preventScroll: true });
      window.addEventListener('focus', back, { once: true });
      watch.current = () => window.removeEventListener('focus', back);
    }, grace);
    watch.current = () => clearTimeout(timer);
  };
  const focus = () => { disarm(); pointed.current = false; };

  return html`<form class="name-form" ref=${form} onSubmit=${e => { e.preventDefault(); finish(false, true); }} onKeyDown=${escapeCancels(() => finish(false, false))}>
    <input class="input" ref=${input} type="text" value=${text} placeholder=${placeholder} aria-label=${label} autocomplete="off" enterkeyhint="done"
      onInput=${take} onCompositionEnd=${take} onFocus=${focus} onBlur=${blur} />
    ${children}
  </form>`;
}
