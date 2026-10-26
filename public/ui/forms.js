import { html, useLayoutEffect, useRef, useState } from './html.js';

export const escapeCancels = cancel => e => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
};

// A name with its runs of whitespace made single spaces and its ends trimmed, as the server keeps it.
export const clean = value => (value || '').replace(/\s+/g, ' ').trim();

// A bare box for a name, in place of the title or button it names. Enter and the focus leaving save it, Esc cancels, and an empty name or
// one no different from `was` cancels without asking the server. `onSubmit(text, away)` resolves false when the server refused, and the
// box stays open. `away` says the focus left, so the caller leaves it where the person put it.
export function NameForm({ label, placeholder, value = '', was = value, max = 80, onSubmit, onCancel }) {
  const [text, setText] = useState(value);
  const input = useRef(null);
  const form = useRef(null);
  const ended = useRef(false);
  const gone = useRef(false);
  const kept = useRef(value);
  useLayoutEffect(() => {
    input.current.focus({ preventScroll: true });
    input.current.select();
    form.current.scrollIntoView({ block: 'nearest' });
    return () => { gone.current = true; };
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

  // maxlength counts UTF-16 units, so it refuses an emoji the server counts as one character. An edit past `max` characters is undone
  // instead, which keeps the end of the name. A composition is judged when it ends, as writing the value in the middle of one breaks it.
  const take = e => {
    const el = e.currentTarget;
    if (e.isComposing && e.type === 'input') return setText(el.value);
    if ([...el.value].length <= max) { kept.current = el.value; return setText(el.value); }
    const at = Math.max(0, el.selectionStart - (el.value.length - kept.current.length));
    el.value = kept.current;
    el.setSelectionRange(at, at);
    setText(kept.current);
  };

  // A window that loses the focus blurs the box too, and the name is saved only when the focus goes somewhere on the page.
  const blur = () => { if (document.hasFocus()) finish(true, true); };

  return html`<form class="name-form" ref=${form} onSubmit=${e => { e.preventDefault(); finish(false, true); }} onKeyDown=${escapeCancels(() => finish(false, false))}>
    <input class="input" ref=${input} type="text" value=${text} placeholder=${placeholder} aria-label=${label} autocomplete="off" enterkeyhint="done"
      onInput=${take} onCompositionEnd=${take} onBlur=${blur} />
  </form>`;
}
