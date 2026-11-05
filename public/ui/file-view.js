// The file viewer: a file that a reply links to, read in the panel beside the chat. A picture opens in the image viewer instead.
import { md } from '../md.mjs';
import { api } from './api.js';
import { draftKey, readDraft, route } from './file-edit-rules.js';
import { CLIP, ClipList, ClipNav, clipsIn, Player, playClip, stopClip } from './file-audio.js';
import { cancelEdit, Editor, EditNotes, leaveEdit, saveEdit, startEdit, useEdit } from './file-edit.js';
import { fileSize, grouped, lf } from './format.js';
import { useStore } from './hooks.js';
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from './html.js';
import { draw, icons } from './menu.js';
import { panelNow, restorePanel, showPanel } from './panel-state.js';
import { createStore } from './store.js';
import { NewTab, openViewer } from './viewer.js';

const shown = createStore({ open: null });

// A file that arrives faster than this opens with no loading state flashing in the panel.
const WAIT_MS = 300;

let count = 0;

// Opens the file at `path` that chat `id` links to, at `line` if given. `from` is the link, which gets the focus back. The panel shows
// the file once it has answered or been waited for, and the waiting shows as "Loading".
export function openFile({ id, path, line, from }) {
  const n = ++count;
  const was = shown.get().open;
  leaveEdit(draftKey(id, path));
  const mine = () => shown.get().open?.n === n;
  const patch = change => { if (mine()) shown.set(s => ({ open: { ...s.open, ...change } })); };
  let before = null;
  const reveal = () => {
    if (!mine() || before) return;
    before = panelNow(id);
    showPanel(id, 'file', from);
  };
  // A move from one clip to another keeps the File tab, and the player if the clip before had one, on screen until the next preview answers.
  const swap = was?.chat === id && (was.late || was.preview || was.error) && CLIP.test(was.path) && CLIP.test(path);
  const clips = [clipsIn(from), was?.chat === id ? was.clips : []].find(list => list?.includes(path)) ?? [];
  if (CLIP.test(path)) playClip(route(id, 'file', path));
  else stopClip();
  shown.set({ open: { n, chat: id, path, line, from, clips, late: swap, preview: swap && was.preview?.kind === 'audio' && !was.preview.tooLarge ? was.preview : null, error: '' } });
  setTimeout(() => { patch({ late: true }); reveal(); }, WAIT_MS);
  api(route(id, 'preview', path)).then(preview => {
    if (!mine()) return;
    if (preview.kind !== 'audio' || preview.tooLarge) stopClip();
    if (preview.kind === 'image' && !preview.tooLarge) {
      const src = route(id, 'file', path);
      shown.set({ open: null });
      // The panel was opened to wait for a picture, which the viewer shows instead, so it goes back to how it was.
      if (before) restorePanel(id, before);
      openViewer([{ key: src, src, alt: preview.name }], 0, from);
    } else {
      patch({ preview });
      reveal();
    }
  }, e => {
    if (mine()) stopClip();
    patch({ error: e.message, preview: null });
    reveal();
  });
}

export const closeFile = () => {
  leaveEdit();
  stopClip();
  shown.set({ open: null });
};

// The file as the server has it after a save, or after the edit was thrown away for what is on disk.
const refreshPreview = (n, preview) => shown.set(s => (s.open?.n === n ? { open: { ...s.open, preview, error: '' } } : s));

// The file could not be read again, so the view says why and shows no earlier copy of it.
const failPreview = (n, error) => shown.set(s => (s.open?.n === n ? { open: { ...s.open, preview: null, error } } : s));

// The file this chat has open, once it is ready to show, else null. The panel offers its File tab while there is one.
export const useFile = chat => useStore(shown, s => (s.open?.chat === chat && (s.open.late || s.open.preview || s.open.error) ? s.open : null));

const Download = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3.5v9M6 8.5l4 4 4-4M4 15.5h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const Code = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const Page = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 3.5h5.5L15 7v9a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM11 3.5V7h4M8 10.5h4M8 13h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

const linesOf = text => {
  const lines = lf(text).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

// What a file is called in the card for one that cannot be shown: its extension in capitals, or just "File".
const kindName = name => {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1];
  return ext ? `${ext.toUpperCase()} file` : 'File';
};

// One element a line, each text a text node. The numbers are drawn apart from the text and hidden from copying and from a screen reader.
function Lines({ text, line }) {
  const lines = useMemo(() => linesOf(text), [text]);
  if (!lines.length) return html`<p class="file-note">This file is empty.</p>`;
  return html`<div class="file-lines" style=${{ '--digits': String(String(lines.length).length) }}>${lines.map((l, n) => html`<div class="file-line" data-hit=${n + 1 === line ? '' : undefined}><span class="file-no" aria-hidden="true">${n + 1}</span><span class="file-text">${l}</span></div>`)}</div>`;
}

function Document({ text }) {
  const markup = useMemo(() => md(text), [text]);
  return html`<div class="msg claude file-doc" dangerouslySetInnerHTML=${{ __html: markup }}></div>`;
}

// Where the focus goes when the file closes: the link clicked, or that link drawn again if its reply has been redrawn since.
export const backTo = (from, path) => (from?.isConnected ? from : [...document.querySelectorAll('a[data-file]')].find(a => a.dataset.file === path));

// The file's head and body, which the panel shows in its File tab. `onClose` closes the file.
export function FileTab({ file: { n, chat, path, line, from, clips, preview, error }, onClose }) {
  const body = useRef(null);
  const [source, setSource] = useState(line != null);
  const name = path.split('/').pop();
  const kind = preview?.kind;
  const url = route(chat, 'file', path);
  const text = kind === 'text' || kind === 'markdown';
  const framed = kind === 'pdf' && !preview.tooLarge;
  const reads = !error && (!preview || (text && !preview.tooLarge));
  // Audio has Download and no new tab, because the sandbox on a served file stops Chrome's media page loading the clip.
  const audible = kind === 'audio' && !preview.tooLarge;
  const loading = !preview && !error;
  const openable = !!preview && !preview.tooLarge && kind !== 'binary' && kind !== 'image';
  const lines = preview?.truncated ? linesOf(preview.text).length : 0;
  const editing = useEdit(chat, path);
  const moves = !editing && clips.length > 1;
  const pick = next => openFile({ id: chat, path: next, line: null, from });
  const focusBody = () => body.current?.focus();
  const view = {
    done: next => { refreshPreview(n, next); focusBody(); },
    fail: message => failPreview(n, message),
    back: () => body.current?.querySelector('.file-editor') ?? body.current,
  };

  // A file left half edited comes back in the editor, with its text.
  useEffect(() => {
    if (preview?.editable && readDraft(draftKey(chat, path))) startEdit(chat, path, preview);
  }, [preview]);

  // The line asked for goes to the middle of the body, and anything else starts at the top, so a note about a missing clip is seen. A clip that plays, or is still loading, leaves a long list where it is.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || audible || (clips.length > 1 && loading)) return;
    const hit = el.querySelector('[data-hit]');
    el.scrollTop = hit ? hit.offsetTop - (el.clientHeight - hit.offsetHeight) / 2 : 0;
  }, [preview, source, error]);

  let content;
  if (error) content = html`<p class="file-note" role="alert">${error}</p>`;
  else if (!preview) content = html`<p class="file-note" role="status">Loading</p>`;
  else if (editing) content = html`<${EditNotes} /><${Editor} name=${name} focus=${editing.focus} saving=${editing.saving} view=${view} />`;
  else if (audible) content = null;
  else if (preview.tooLarge || !(text || kind === 'pdf')) {
    content = html`<div class="file-meta">
      <p class="file-kind">${kindName(name)}</p>
      <p class="file-sub">${fileSize(preview.size)}${preview.tooLarge ? '. This file is too large to open here.' : ''}</p>
      ${preview.tooLarge ? null : html`<a class="btn" data-variant="outline" href=${`${url}&download=1`} download=${name}><${Download} />Download</a>`}
    </div>`;
  } else if (kind === 'pdf') content = html`<iframe class="file-pdf" src=${url} title=${name}></iframe>`;
  else {
    content = html`${kind === 'markdown' && !source ? html`<${Document} text=${preview.text} />` : html`<${Lines} text=${preview.text} line=${line} />`}
      ${preview.truncated ? html`<p class="file-end">Showing the first ${grouped(lines)} lines of ${fileSize(preview.size)}. <a href=${url} target="_blank" rel="noopener">Open in new tab</a></p>` : null}`;
  }

  return html`<div class="file-view">
    <div class="file-head">
      <div class="file-title">
        <h3 id="file-title" class="file-name">${name}</h3>
        <div class="file-where"><span class="file-path" title=${path}><bdi>${path}</bdi></span>${preview?.path === path ? html`<span class="file-size">${fileSize(preview.size)}</span>` : null}</div>
      </div>
      <div class="file-actions">
        ${editing ? html`<button class="btn" data-variant="outline" data-size="sm" type="button" onClick=${() => cancelEdit(view)}>Cancel</button>
        <button class="btn" data-size="sm" type="button" disabled=${editing.saving || (!editing.changed && !editing.conflict)} onClick=${() => saveEdit(view)}>${editing.saving ? 'Saving' : 'Save'}</button>` : null}
        ${!editing && preview?.editable ? html`<button class="btn" data-variant="outline" data-size="icon-sm" type="button" aria-label="Edit file" data-tip="Edit file" onClick=${() => startEdit(chat, path, preview, { focus: true })}>${draw(icons.pencil, 'icon')}</button>` : null}
        ${!editing && openable && kind === 'markdown' ? html`<button class="btn" data-variant="outline" data-size="icon-sm" type="button" aria-label=${source ? 'Show rendered' : 'Show source'} data-tip=${source ? 'Show rendered' : 'Show source'} onClick=${() => setSource(s => !s)}>${source ? html`<${Page} />` : html`<${Code} />`}</button>` : null}
        ${!editing && openable && kind !== 'audio' ? html`<a class="btn" data-variant="outline" data-size="icon-sm" href=${url} target="_blank" rel="noopener" aria-label="Open in new tab" data-tip="Open in new tab"><${NewTab} /></a>` : null}
        ${!editing && openable ? html`<a class="btn" data-variant="outline" data-size="icon-sm" href=${`${url}&download=1`} download=${name} aria-label="Download" data-tip="Download"><${Download} /></a>` : null}
        ${editing ? null : html`<button class="btn" data-variant="outline" data-size="icon-sm" type="button" aria-label="Close file" data-tip="Close file" onClick=${onClose}>${draw(icons.x, 'icon')}</button>`}
      </div>
    </div>
    ${preview?.readOnly && !editing ? html`<p class="file-readonly">${preview.readOnly}</p>` : null}
    <div class="file-body" ref=${body} data-tall=${framed ? '' : undefined} data-editing=${editing ? '' : undefined} data-kind=${kind} tabindex=${reads && !editing ? 0 : -1} role=${reads && !editing ? 'region' : undefined} aria-label=${reads && !editing ? `Contents of ${name}` : undefined}>${audible || moves ? html`<div class="file-bar">${audible ? html`<${Player} url=${url} name=${name} />` : null}${moves ? html`<${ClipNav} clips=${clips} path=${path} onPick=${pick} />` : null}</div>` : null}${content}${moves ? html`<${ClipList} clips=${clips} path=${path} follow=${audible || loading} onPick=${pick} />` : null}</div>
  </div>`;
}
