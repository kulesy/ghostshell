// Editing a text file that a reply links to, from the file viewer. The text lives in this module and not in the store or the components, as the
// prompt box's does, so typing redraws nothing and leaving the file keeps it. An unsaved edit is kept in localStorage as a draft, which the file
// gets back when it is opened again. See docs/adr/20261105-edit-linked-text-files.md.
import { api } from './api.js';
import { ask } from './ask.js';
import { copyText } from './clipboard.js';
import { lf } from './format.js';
import { useStore } from './hooks.js';
import { html, useEffect, useLayoutEffect, useRef } from './html.js';
import { draftKey, readDraft, route, writeDraft } from './file-edit-rules.js';
import { createStore } from './store.js';
import { toast } from './toast.js';

const IDLE = { key: null, chat: '', path: '', name: '', base: '', saving: false, conflict: false, error: '', focus: false, changed: false, restored: false, unstored: false };

// The file being edited, if any. Only one file is edited at a time, and the others wait as drafts. It holds what the page draws, which changes
// rarely; `text` is the box's text, and `original` is the file's as the box would show it.
export const edit = createStore(IDLE);
let text = '';
let original = '';

const DEBOUNCE_MS = 400;
let timer = 0;

const changedNow = () => text !== original;

function persist() {
  clearTimeout(timer);
  const { key, base, unstored } = edit.get();
  if (!key) return;
  const lost = !writeDraft(key, changedNow() ? { text, base } : null);
  if (lost !== unstored) edit.set({ unstored: lost });
}

addEventListener('pagehide', persist);
addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
addEventListener('beforeunload', ev => {
  if (!edit.get().unstored || !edit.get().key || !changedNow()) return;
  ev.preventDefault();
  ev.returnValue = '';
});

// Starts editing `preview`, an editable file of chat `chat`. A draft from earlier gives the text back; one made from an older version of the
// file starts with the conflict showing, because a save of it would fail.
export function startEdit(chat, path, preview, { focus = false } = {}) {
  const key = draftKey(chat, path);
  if (edit.get().key === key) return;
  const draft = readDraft(key);
  original = lf(preview.text);
  text = draft ? draft.text : original;
  edit.set({ ...IDLE, key, chat, path, name: preview.name, focus, base: draft ? draft.base : preview.version, changed: changedNow(), restored: !!draft && changedNow(), conflict: !!draft && draft.base !== preview.version });
}

// Called on every keystroke, and redraws only when something the page shows has changed.
export function changeText(value) {
  text = value;
  const { changed, error, restored } = edit.get();
  const patch = {};
  if (changedNow() !== changed) patch.changed = !changed;
  if (error) patch.error = '';
  if (restored) patch.restored = false;
  if (Object.keys(patch).length) edit.set(patch);
  clearTimeout(timer);
  timer = setTimeout(persist, DEBOUNCE_MS);
}

const stop = () => {
  clearTimeout(timer);
  text = '';
  original = '';
  edit.set(IDLE);
};

// The file closed, or another opened, while it was being edited. Unsaved edits stay as a draft, and the note says so.
export function leaveEdit(nextKey = null) {
  const { key, name } = edit.get();
  if (!key) return;
  persist();
  const unsaved = changedNow();
  if (unsaved && edit.get().unstored) toast(`Your changes to ${name} could not be kept, because this browser would not store them.`, { problem: true });
  else if (unsaved && key !== nextKey) toast(`Unsaved changes to ${name} are kept. Open the file again to finish.`);
  stop();
}

// Ends editing, throws the edits away and shows the file as it is on disk now. A file that cannot be read says so and shows nothing stale.
function discard({ done, fail }) {
  const { key, chat, path } = edit.get();
  stop();
  if (key) writeDraft(key, null);
  api(route(chat, 'preview', path)).then(done, e => fail(e.message));
}

export function cancelEdit(view) {
  const { name } = edit.get();
  if (!changedNow()) { discard(view); return; }
  ask({ action: 'Discard', title: name, detail: 'Your changes to this file will be lost.', run: () => discard(view), back: view.back });
}

// Saves the text over the file. `view.done` gets the preview the server answers with, which is the file as it is now. A file that changed on
// disk answers 409 and nothing is written; the text stays, and a save again is checked against the same version.
export async function saveEdit(view) {
  const e = edit.get();
  if (!e.key || e.saving || (!e.changed && !e.conflict)) return;
  persist();
  edit.set({ saving: true, error: '' });
  const { chat, path, key, base } = e;
  try {
    const preview = await api(`api/sessions/${encodeURIComponent(chat)}/save`, { path, text, base });
    writeDraft(key, null);
    if (edit.get().key === key) stop();
    view.done(preview);
    toast(`Saved ${preview.name}`);
  } catch (err) {
    if (edit.get().key !== key) return;
    edit.set(err.data?.changed ? { saving: false, conflict: true } : { saving: false, error: err.message });
  }
}

async function copyMine() {
  const copied = await copyText(text);
  toast(copied ? 'Copied your text' : 'Could not copy your text', { problem: !copied });
}

export const useEdit = (chat, path) => useStore(edit, s => (s.key === draftKey(chat, path) ? s : null));

// The notes over the text: the file changed under the edit, a save failed, the text came from an earlier visit, or the browser keeps no draft.
export function EditNotes() {
  const { chat, path, conflict, error, restored, unstored } = useStore(edit, s => s);
  return html`${conflict ? html`<div class="file-alert" role="alert">
      <p>This file changed on disk after you opened it, so nothing was saved. Your text is still here.</p>
      <div class="file-alert-actions">
        <button class="btn" data-variant="outline" data-size="sm" type="button" onClick=${copyMine}>Copy text</button>
        <a class="btn" data-variant="outline" data-size="sm" href=${route(chat, 'file', path)} target="_blank" rel="noopener">Open the new version</a>
      </div>
    </div>` : null}
    ${error ? html`<div class="file-alert" role="alert"><p>${error}</p></div>` : null}
    ${restored ? html`<p class="file-hint" role="status">These are your unsaved edits from earlier. Nothing is saved yet.</p>` : null}
    ${unstored ? html`<p class="file-hint" role="status">This browser would not keep a draft of your text, so save or copy it before you leave.</p>` : null}`;
}

// iOS covers the layout viewport with the keyboard and pans the page to the caret, which carries Save and Cancel off the screen. While the
// box is focused and the keyboard is up, the panel is pinned to the area the visual viewport shows. It lets go once the keyboard is gone.
function useKeyboardFit(box) {
  useLayoutEffect(() => {
    const el = box.current;
    const panel = el.closest('.panel');
    const view = window.visualViewport;
    if (!panel || !view) return undefined;
    let width = 0;
    const covered = () => view.scale <= 1 && (window.innerHeight - view.height > 1 || view.offsetTop > 0);
    const unpin = () => {
      panel.removeAttribute('data-keyboard');
      for (const name of ['--vv-top', '--vv-right', '--vv-width', '--vv-height']) panel.style.removeProperty(name);
      width = 0;
    };
    const fit = () => {
      const focused = document.activeElement === el;
      if (!covered() || (!focused && !panel.hasAttribute('data-keyboard'))) { unpin(); if (!focused) stop(); return; }
      if (!width) width = panel.offsetWidth;
      panel.style.setProperty('--vv-top', `${view.offsetTop}px`);
      panel.style.setProperty('--vv-right', `${Math.max(0, window.innerWidth - view.offsetLeft - view.width)}px`);
      panel.style.setProperty('--vv-width', `${width}px`);
      panel.style.setProperty('--vv-height', `${view.height}px`);
      panel.setAttribute('data-keyboard', '');
    };
    const watch = () => { view.addEventListener('resize', fit); view.addEventListener('scroll', fit); addEventListener('resize', refit); };
    const stop = () => { view.removeEventListener('resize', fit); view.removeEventListener('scroll', fit); removeEventListener('resize', refit); };
    const refit = () => { unpin(); fit(); };
    // The keyboard can still be on its way out when the box loses focus, so the pin goes when the viewport says it is gone, not before.
    const onFocus = () => { watch(); fit(); };
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', fit);
    if (document.activeElement === el) onFocus();
    return () => {
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', fit);
      stop();
      unpin();
    };
  }, []);
}

// The text box, left to the browser while it is typed in. Escape does nothing here but keep the panel from closing, because the text is not
// lost by leaving, and Tab is left alone so the focus can move on. Ctrl or Cmd+S saves.
export function Editor({ name, focus, saving, view }) {
  const box = useRef(null);
  useLayoutEffect(() => { box.current.value = text; }, []);
  useKeyboardFit(box);
  useEffect(() => {
    if (!focus) return;
    box.current.setSelectionRange(0, 0);
    box.current.focus({ preventScroll: true });
  }, []);
  const onKeyDown = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); return; }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveEdit(view); }
  };
  return html`<textarea class="file-editor" ref=${box} readOnly=${saving} aria-label=${`Edit ${name}`} spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off"
    onInput=${ev => changeText(ev.currentTarget.value)} onKeyDown=${onKeyDown}></textarea>`;
}
