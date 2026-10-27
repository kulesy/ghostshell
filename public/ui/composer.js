// The prompt box: the text, the quotes, images and files attached to it, and the settings under it.
import { hintFor, matching, pick, typedCommand } from './command-rules.js';
import { SlashMenu, useCommands, useModels } from './commands.js';
import { ContextMeter } from './context.js';
import { attach, attached, carryDraft, detach, detachFile, pastedFiles, removeQuote, setDraftText, uploads } from './draft.js';
import { HOME } from './env.js';
import { tilde } from './format.js';
import { FileFace } from './file-card.js';
import { draftImages, imageKey } from './gallery.js';
import { useFields, useStore } from './hooks.js';
import { html, useLayoutEffect, useMemo, useRef, useState } from './html.js';
import { TYPES } from './images.js';
import { draw, icons, layerId, Menu, opener } from './menu.js';
import { buttonLabel, buttonOf, modelMenu } from './model-rules.js';
import { messageFor } from './quote-rules.js';
import { bangMode, leaveBang } from './terminal-rules.js';
import { useTypingPing } from './typing.js';
import { openViewer } from './viewer.js';

export const MODES = [['manual', 'Manual'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['auto', 'Auto'], ['bypassPermissions', 'Bypass permissions']];
// NOTE: [16 Oct 2026] EK - Grammarly's extension leaves a field alone when it carries these attributes.
// Without them it puts its own buttons inside the message box.
export const NO_GRAMMARLY = { 'data-gramm': 'false', 'data-gramm_editor': 'false', 'data-enable-grammarly': 'false' };

const isBusy = s => s?.state === 'working' || s?.state === 'waiting';

const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

const CONTROLS = 'button, textarea, input, select, a';

const Cross = () => html`<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

// The quotes in the draft. One from another session than `here`, the one the message goes to, names its own.
function Quotes({ quotes, here }) {
  return html`<ul class="quotes" aria-label="Quotes">
    ${quotes.map(q => html`<li class="quote" key=${q.key} title=${q.text}>
      ${draw(icons.quote, 'quote-glyph')}
      <div class="quote-body">
        ${q.from.id !== here ? html`<p class="quote-from">From ${q.from.title || 'another session'}</p>` : null}
        <p class="quote-text">${q.text}</p>
      </div>
      <button class="btn thumb-remove" data-variant="secondary" data-size="icon-xs" type="button" aria-label="Remove quote" onClick=${() => removeQuote(q.key)}><${Cross} /></button></li>`)}
  </ul>`;
}

function Attachments({ images, files, preparing }) {
  return html`<ul class="attached" aria-label="Attachments">
    ${images.map((img, n) => html`<li class="attachment" key=${img.id}>
      <button class="thumb" type="button" data-image=${imageKey(img)} aria-label=${`View ${img.name}`} aria-haspopup="dialog" onClick=${e => openViewer(draftImages(images), n, e.currentTarget)}><img src=${img.src} alt=${img.name} /></button>
      <button class="btn thumb-remove" data-variant="secondary" data-size="icon-xs" type="button" aria-label=${`Remove ${img.name}`} onClick=${() => detach(img.id)}><${Cross} /></button></li>`)}
    ${files.map(file => html`<li class="attachment file-card" key=${file.key} title=${file.name} aria-busy=${file.uploading || null}>
      <${FileFace} file=${file} />
      <button class="btn thumb-remove" data-variant="secondary" data-size="icon-xs" type="button" aria-label=${`Remove ${file.name}`} onClick=${() => detachFile(file.key)}><${Cross} /></button></li>`)}
    ${Array.from({ length: preparing }, (_, n) => html`<li class="thumb preparing" key=${`preparing${n}`} aria-hidden="true"></li>`)}
  </ul>`;
}

const Plus = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4.25v11.5M4.25 10h11.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
const Arrow = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 16V4.5M5 9.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const Ring = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="30 11"/></svg>`;
const Square = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2.5" fill="currentColor"/></svg>`;

// A mode the list does not hold, such as one Desktop recorded, gets an option of its own so the box shows the truth.
// The choice shows as plain text, as in Desktop, with the native picker laid invisibly over it so a tap still opens it.
function Pick({ id, label, value, options, disabled, onChange }) {
  const all = value && !options.some(([v]) => v === value) ? [...options, [value, value]] : options;
  const shown = all.find(([v]) => v === value)?.[1];
  return html`<label class="btn pick" data-variant="ghost" data-size="sm" data-disabled=${disabled || null}><span class="sr">${label}</span><span aria-hidden="true">${shown}</span>
    <select id=${id} disabled=${disabled} value=${value || ''} onChange=${e => onChange(e.target.value)}>
      ${all.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
    </select></label>`;
}

// Starting a session replaces this box with the new session's, so focus is handed on to the box that mounts next.
let keepFocus = false;

// The search opens a chat from the keyboard, and the chat's box mounts a moment later. Only a box that mounts soon after takes the
// focus, and only where there is a keyboard, so a later chat opened by a tap is left alone.
let focusNext = false;

export function focusNextComposer() {
  focusNext = true;
  setTimeout(() => { focusNext = false; }, 2000);
}

export function Composer({ ctrl }) {
  const { status, starting, terminal, session } = useFields(ctrl.store, 'status', 'starting', 'terminal', 'session');
  const images = useStore(attached, a => a.images);
  const files = useStore(attached, a => a.files);
  const quotes = useStore(attached, a => a.quotes);
  const preparing = useStore(attached, a => a.preparing);
  const takesFiles = useStore(uploads, u => u.limits !== null);
  const uploading = files.some(f => f.uploading);
  const [text, setLocal] = useState(carryDraft);
  const [over, setOver] = useState(false);
  const setText = value => { setDraftText(value); setLocal(value); };
  const draft = !!ctrl.draft;
  useTypingPing(draft ? null : ctrl.id, text);
  const area = useRef(null);
  const form = useRef(null);
  const picker = useRef(null);
  const follow = useRef(false);
  const caretAt = useRef(null);
  const [caret, setCaret] = useState(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState(null);
  const [choice, setChoice] = useState({ query: null, at: 0 });
  const [shown, setShown] = useState(null);
  const opened = useRef(0);
  const s = status || { state: 'idle', pending: [], mode: 'manual' };
  // A text that starts with ! is a command to run in the session's folder, where the session has a terminal.
  const bang = bangMode({ text, terminal, draft });
  // Quotes, images or files alone are a message too.
  const ready = bang ? !!bang.command : !!text.trim() || images.length > 0 || files.length > 0 || quotes.length > 0;
  // While Claude works and the box is empty, the Send button is the Stop button. Typing or attaching turns it back into Send.
  const stop = isBusy(status) && !draft && !ready && !bang;

  // The / list opens while the first word of the message is being typed, with the caret in it.
  const typed = caret === null ? null : typedCommand(text, caret);
  const query = typed ? typed.query : null;
  const target = draft ? { cwd: HOME } : { id: ctrl.id };
  const { commands, error } = useCommands(target, query !== null && focused);
  const matches = useMemo(() => (commands && query !== null ? matching(commands, query) : []), [commands, query]);
  const open = query !== null && focused && !composing && dismissed !== query && (!commands || matches.length > 0);
  const at = open && commands ? (choice.query === query ? Math.min(choice.at, matches.length - 1) : 0) : -1;
  const hint = hintFor(commands, text);
  useLayoutEffect(() => { if (dismissed !== null && dismissed !== query) setDismissed(null); }, [dismissed, query]);

  // The model and the effort share one menu, as in Desktop. The CLI's models are asked for when it opens, and the menu is made again on
  // each render so they appear in it as they arrive.
  const model = s.shownModel || s.model;
  const { models, error: modelsError } = useModels(target, !!shown);
  const look = buttonOf({ model, effort: s.effort, fast: s.fast, listed: models });
  const popModel = (button, entry) => setShown(open => (open && !entry ? null : { id: `composer-${++opened.current}`, anchor: button, entry }));
  // A pick hands the focus back to the button, as Radix's menus do, so a keyboard is not left on a menu that has gone.
  const pickSetting = (kind, value) => { shown.anchor.focus({ preventScroll: true }); ctrl.pick(kind, value); };
  const modelItems = shown ? modelMenu({ model, effort: s.effort, fast: s.fast, listed: models, error: modelsError, pick: pickSetting }) : null;

  // Sizing an untouched empty box would round its natural height down, so it waits for the first text.
  const typedOnce = useRef(false);
  const fit = () => {
    const el = area.current;
    if (!el.value && !typedOnce.current) return;
    typedOnce.current = true;
    el.style.height = 'auto';
    const max = window.innerHeight * 0.4;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  };
  useLayoutEffect(fit, [text]);
  useLayoutEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // The box is controlled, so a caret placed by choosing a command has to wait for the render that writes the new text.
  useLayoutEffect(() => {
    const to = caretAt.current;
    if (to === null) return;
    caretAt.current = null;
    area.current.setSelectionRange(to, to);
  }, [text]);

  useLayoutEffect(() => {
    if (draft || keepFocus || (focusNext && matchMedia('(pointer: fine)').matches)) area.current.focus({ preventScroll: true });
    keepFocus = false;
    focusNext = false;
    return () => {
      keepFocus = document.activeElement === area.current;
      setTimeout(() => { keepFocus = false; });
    };
  }, []);

  const now = useRef({});
  now.current = { busy: isBusy(status), draft, ctrl };
  // A layout effect, so Esc cannot reach a chat that has just closed.
  useLayoutEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      const c = now.current;
      if (!c.draft && c.busy) c.ctrl.stop();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Pasting or dropping files anywhere on the page attaches them, even in a text field, which would lose them.
  // A paste that also holds text stays text if it has several lines, as a spreadsheet copy does, or is in another field.
  useLayoutEffect(() => {
    const note = text => now.current.ctrl.notice(text);
    let depth = 0;
    const onPaste = e => {
      const pasted = pastedFiles([...(e.clipboardData?.files || [])]);
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!pasted.length || /[\n\t]/.test(text)) return;
      if (text && e.target !== area.current && e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      attach(pasted, note);
      if (matchMedia('(pointer: fine)').matches) area.current.focus({ preventScroll: true });
    };
    const onEnter = e => { if (hasFiles(e)) { depth++; setOver(true); } };
    const onOver = e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
    const onLeave = e => { if (hasFiles(e) && --depth <= 0) { depth = 0; setOver(false); } };
    const onDrop = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      attach([...e.dataTransfer.files], note);
    };
    const on = { paste: onPaste, dragenter: onEnter, dragover: onOver, dragleave: onLeave, drop: onDrop };
    for (const [type, fn] of Object.entries(on)) document.addEventListener(type, fn);
    return () => { for (const [type, fn] of Object.entries(on)) document.removeEventListener(type, fn); };
  }, []);

  // The command shows in the transcript at once, and the text comes back to be fixed if the server turns the command away.
  const runCommand = async (typed, command) => {
    setText('');
    const running = ctrl.term.run(command, 'bang');
    ctrl.store.set(s => ({ jump: s.jump + 1 }));
    const problem = await running;
    if (problem) {
      setText(typed);
      ctrl.notice(problem);
    }
  };

  const submit = async e => {
    e.preventDefault();
    const typed = area.current.value;
    const t = typed.trim();
    const { images: sent, files: sentFiles, quotes: sentQuotes } = attached.get();
    const asked = bangMode({ text: typed, terminal: ctrl.store.get().terminal, draft });
    if (asked) {
      if (asked.command) await runCommand(typed, asked.command);
      return;
    }
    if ((!t && !sent.length && !sentFiles.length && !sentQuotes.length) || attached.get().preparing || sentFiles.some(f => f.uploading)) return;
    const { message, kept } = messageFor(sentQuotes, t, ctrl.id);
    const clear = () => { setText(''); attached.set({ images: [], files: [], quotes: kept }); };
    if (draft) { ctrl.startNew(message, sent, clear, sentFiles); return; }
    clear();
    if (!(await ctrl.send(message, sent, s.mode, sentFiles))) { setText(t); attached.set({ images: sent, files: sentFiles, quotes: sentQuotes }); }
  };

  const pickFiles = e => {
    const files = [...e.currentTarget.files];
    e.currentTarget.value = '';
    if (files.length) attach(files, text => ctrl.notice(text));
    if (matchMedia('(pointer: fine)').matches) area.current.focus({ preventScroll: true });
  };

  const track = () => {
    const el = area.current;
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  };
  const onInput = e => {
    if (open) follow.current = true;
    setText(e.target.value);
    track();
  };
  const onFocus = () => { setFocused(true); track(); };
  const onCompositionEnd = () => { setComposing(false); track(); };

  const choose = command => {
    const el = area.current;
    const next = pick(el.value, command.name);
    if (next.text === el.value) el.setSelectionRange(next.caret, next.caret);
    else { caretAt.current = next.caret; setText(next.text); }
    setCaret(next.caret);
    el.focus({ preventScroll: true });
  };

  // With the / list open the arrows move through it, Enter and Tab choose, and Esc closes it. Any other key is typed as usual.
  const slashKey = e => {
    if (!open || e.isComposing || e.keyCode === 229) return false;
    if (e.key === 'Escape') { setDismissed(query); return true; }
    if (!commands) return false;
    const by = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey ? 0 : { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (by) {
      const next = Math.max(0, Math.min(at + by, matches.length - 1));
      if (next !== at) { follow.current = true; setChoice({ query, at: next }); }
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) { choose(matches[at]); return true; }
    return false;
  };

  // Enter sends where there is a keyboard. On a touch screen it makes a new line, as does Shift+Enter anywhere.
  const onKeyDown = e => {
    if (slashKey(e)) { e.preventDefault(); return; }
    // Esc leaves command mode, and is kept from the page's Esc, which would stop Claude.
    if (e.key === 'Escape' && bang && !e.isComposing) { e.preventDefault(); setText(leaveBang(text)); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      if (bang ? bang.command : (e.currentTarget.value.trim() || images.length || files.length || quotes.length)) form.current.requestSubmit();
    }
  };

  // Like shadcn's InputGroupAddon, a press on the box outside its controls keeps or puts the cursor in the text.
  const onBoxMouseDown = e => { if (!e.target.closest(CONTROLS)) e.preventDefault(); };
  const onBoxClick = e => { if (!e.target.closest(CONTROLS)) area.current.focus({ preventScroll: true }); };

  const sendLabel = starting ? 'Starting' : stop ? 'Stop' : bang ? 'Run command' : 'Send';
  const attachLabel = takesFiles ? 'Attach files' : 'Attach images';
  return html`<form class="composer" id="composer" ref=${form} data-over=${over || null} data-bang=${bang ? '' : undefined} onSubmit=${submit}>
    <div class="composer-box input-group" onMouseDown=${onBoxMouseDown} onClick=${onBoxClick}>
      ${quotes.length ? html`<${Quotes} quotes=${quotes} here=${ctrl.id} />` : null}
      ${images.length || files.length || preparing ? html`<${Attachments} images=${images} files=${files} preparing=${preparing} />` : null}
      ${open ? html`<${SlashMenu} matches=${commands ? matches : null} error=${error} at=${at} follow=${follow} onPick=${choose} onSelect=${n => { if (n !== at) setChoice({ query, at: n }); }} />` : null}
      <div class="composer-row">
        <button class="btn attach" data-variant="ghost" data-size="icon-sm" id="attach" type="button" aria-label=${attachLabel} data-tip=${attachLabel} onClick=${() => picker.current.click()}><${Plus} /></button>
        <input type="file" key=${takesFiles ? 'files' : 'images'} ref=${picker} ...${takesFiles ? {} : { accept: TYPES.join(',') }} multiple hidden onChange=${pickFiles} />
        <div class="composer-field">
          <textarea class="input-group-control" id="text" ...${NO_GRAMMARLY} ref=${area} rows="1" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded=${open}
            aria-controls=${open ? 'slash-list' : undefined} aria-activedescendant=${at >= 0 ? `slash-${at}` : undefined} aria-describedby=${bang ? 'bang-hint' : hint ? 'slash-hint' : undefined}
            placeholder=${terminal && !draft ? 'Type / for commands, or ! to run a command' : 'Type / for commands'} aria-label="Message" value=${text}
            onInput=${onInput} onKeyDown=${onKeyDown} onKeyUp=${track} onClick=${track} onFocus=${onFocus} onBlur=${() => setFocused(false)}
            oncompositionstart=${() => setComposing(true)} oncompositionend=${onCompositionEnd}></textarea>
          ${hint ? html`<div class="composer-hint" aria-hidden="true"><span>${text}</span>${hint}</div><span class="sr" id="slash-hint">Arguments: ${hint}</span>` : null}
        </div>
        <button class="btn send" data-size="icon-sm" id="send" type=${stop ? 'button' : 'submit'} data-act=${starting ? 'starting' : stop ? 'stop' : 'send'} aria-label=${sendLabel} data-tip=${sendLabel} disabled=${!stop && (!ready || starting || preparing > 0 || (uploading && !bang))} onClick=${stop ? ctrl.stop : undefined}>${starting ? html`<${Ring} />` : stop ? html`<${Square} />` : bang ? draw(icons.play, 'icon') : html`<${Arrow} />`}</button>
      </div>
      ${terminal && !draft ? html`<p class="bang-hint" id="bang-hint" hidden=${!bang}>Runs in ${session?.cwd ? tilde(session.cwd, HOME) : 'the session folder'}. Claude sees the result.</p><span class="sr" role="status">${bang ? 'Command mode. Enter runs the command.' : ''}</span>` : null}
    </div>
    <div class="composer-bar">
      <div class="composer-left">
        <${Pick} id="mode" label="Permission mode" value=${s.mode || 'manual'} options=${MODES} disabled=${!status} onChange=${ctrl.setMode} />
      </div>
      <div class="composer-right">
        <button class="btn pick" id="model" type="button" data-variant="ghost" data-size="sm" disabled=${!status} aria-label=${buttonLabel(look)} aria-haspopup="menu" aria-expanded=${!!shown}
          aria-controls=${shown ? layerId(shown.id) : null} data-state=${shown ? 'open' : 'closed'} ...${opener(popModel)}>
          <span class="pick-line"><span>${look.model || 'Model'}</span>${look.fast ? html`<span>Fast</span>` : null}${look.effort ? html`<span class="quiet">${look.effort}</span>` : null}${look.max ? draw(icons.triangleAlert, 'pick-warning') : null}</span>
        </button>
        <${ContextMeter} ctrl=${ctrl} />
      </div>
    </div>
    <${Menu} menu=${shown && { ...shown, label: 'Model and effort', items: modelItems }} onClose=${() => setShown(null)} />
  </form>`;
}
