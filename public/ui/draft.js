// Each session's unsent message is its own, so switching chats leaves it behind and coming back finds it. The new session page has one
// draft of its own. Quotes are the exception: they follow you to the next chat, because quoting one session in another is what they are for.
// The text lives outside every component, so typing redraws only the prompt box. See docs/adr/20261102-a-draft-for-each-session.md.
import { api, postFile } from './api.js';
import { MAX_IMAGES, prepare, TYPES } from './images.js';
import { local } from './storage.js';
import { createStore } from './store.js';

// The key of the new session page's draft. A session's key is its id.
export const NEW = 'new';

// The text is kept in localStorage, so a reload or a phone dropping the tab keeps it. Images and files are kept for the page's life only.
const texts = new Map(Object.entries(local.get('drafts', {})).filter(([, v]) => typeof v === 'string'));
const saveTexts = () => local.set('drafts', Object.fromEntries(texts));

export const draftText = key => texts.get(key) ?? '';

export function setDraftText(key, value) {
  if (value) texts.set(key, value);
  else if (!texts.delete(key)) return;
  saveTexts();
}

const EMPTY = Object.freeze({ images: [], files: [], preparing: 0 });

// The images and files attached to each draft, by the draft's key. A store, because a file is decoded and scaled, or uploaded, before it
// shows as sent, and the box that took it may have been replaced by then. A file still on its way up carries `uploading` and the
// controller that can stop it.
export const attachments = createStore({});

export const attachedTo = (state, key) => state[key] ?? EMPTY;

const change = (key, fn) => attachments.set(s => ({ [key]: { ...attachedTo(s, key), ...fn(attachedTo(s, key)) } }));

export const setAttached = (key, patch) => change(key, () => patch);

export const clearAttached = key => attachments.set({ [key]: undefined });

// The quotes waiting to be sent, from whichever sessions they were taken in. One store for every chat.
export const quoted = createStore({ quotes: [] });

// Drops the drafts of sessions that are not in `live`, the list's sessions, because they are archived or gone. `open` is the chat on screen,
// whose box still holds its draft. The new session page's draft stays.
// NOTE: [2 Nov 2026] EK - The list holds the newest 60 of each loose section, so a draft in an older session goes once it is closed.
export function keepDrafts(live, open = null) {
  const gone = key => key !== NEW && key !== open && !live.has(key);
  const dropped = [...texts.keys()].filter(gone);
  for (const key of dropped) texts.delete(key);
  if (dropped.length) saveTexts();
  const state = attachments.get();
  const stale = Object.keys(state).filter(key => state[key] && gone(key));
  for (const key of stale) for (const f of state[key].files) f.abort?.abort();
  if (stale.length) attachments.set(Object.fromEntries(stale.map(key => [key, undefined])));
}

// What this server takes as a file, or null on one that takes only images. Asked for when the page loads.
export const uploads = createStore({ limits: null });

export async function checkUploads() {
  try {
    const { maxBytes, maxFiles } = await api('api/uploads');
    uploads.set({ limits: { maxBytes, maxFiles } });
  } catch {
    uploads.set({ limits: null });
  }
}

// The files a paste takes. A server that takes only images leaves any other pasted file to the browser, as it did before files, and is asked
// again in the background, so a paste after the server has been updated works.
export function pastedFiles(files) {
  if (uploads.get().limits) return files;
  if (files.some(f => !f.type.startsWith('image/'))) checkUploads();
  return files.filter(f => f.type.startsWith('image/'));
}

export const detach = (key, id) => change(key, d => ({ images: d.images.filter(i => i.id !== id) }));

export function detachFile(key, file) {
  attachedTo(attachments.get(), key).files.find(f => f.key === file)?.abort?.abort();
  change(key, d => ({ files: d.files.filter(f => f.key !== file) }));
}

const isNative = file => TYPES.includes(file.type);
// An image the server does not take as one, such as HEIC. The page redraws it if the browser can decode it, and SVG is text.
const isOther = file => file.type.startsWith('image/') && file.type !== 'image/svg+xml' && !isNative(file);

const full = limit => `A message can hold up to ${limit} files.`;

let counter = 0;

// A quote is { key, text, from: { id, title } }, `from` being the session it was taken from. The same words from the same session are one quote.
export function addQuote(text, from) {
  const { quotes } = quoted.get();
  if (quotes.some(q => q.text === text && q.from.id === from.id)) return;
  quoted.set({ quotes: [...quotes, { key: `quote${++counter}`, text, from }] });
}

export const removeQuote = key => quoted.set(s => ({ quotes: s.quotes.filter(q => q.key !== key) }));

// Uploads one file into the draft `draft`, its card showing at once, and lands it there whichever chat is open by then. A failure drops
// the card and says why, and so does a file the server would refuse.
async function uploadFile(draft, file, notice, { maxBytes, maxFiles }) {
  const name = file.name || 'file';
  if (file.size > maxBytes) return notice(`${name} is over the ${maxBytes / 1024 ** 2} MB limit.`);
  if (attachedTo(attachments.get(), draft).files.length >= maxFiles) return notice(full(maxFiles));
  const key = `file${++counter}`;
  const abort = new AbortController();
  change(draft, d => ({ files: [...d.files, { key, name, size: file.size, uploading: true, abort }] }));
  try {
    const saved = await postFile('api/uploads', file, name, abort.signal);
    change(draft, d => ({ files: d.files.map(f => (f.key === key ? { key, id: saved.id, name: saved.name, size: saved.size, type: saved.type } : f)) }));
  } catch (err) {
    change(draft, d => ({ files: d.files.filter(f => f.key !== key) }));
    if (!abort.signal.aborted) notice(err instanceof TypeError ? `${name} could not be uploaded.` : err.message);
  }
}

async function addImage(draft, file, notice, limits) {
  try {
    const image = await prepare(file, { convert: !!limits });
    change(draft, d => ({ images: [...d.images, image], preparing: d.preparing - 1 }));
  } catch (err) {
    change(draft, d => ({ preparing: d.preparing - 1 }));
    // An image the browser cannot decode goes up as the file it is. One of the four types that will not decode is still an error.
    if (limits && !isNative(file)) await uploadFile(draft, file, notice, limits);
    else notice(err.message);
  }
}

// Takes the files in order, as many as fit. Anything left out is reported through `notice`. The four image types, and other images the
// browser can decode, become images. Everything else uploads, when this server takes files, and otherwise gets the notice it always did.
// `draft` is the key of the draft they go into.
export async function attach(draft, files, notice) {
  if (!uploads.get().limits && files.some(f => !isNative(f))) await checkUploads();
  const { limits } = uploads.get();
  const pictures = limits ? files.filter(f => isNative(f) || isOther(f)) : files;
  const rest = limits ? files.filter(f => !isNative(f) && !isOther(f)) : [];
  const { images, preparing } = attachedTo(attachments.get(), draft);
  const room = Math.max(MAX_IMAGES - images.length - preparing, 0);
  if (pictures.length > room) notice(`A message can hold up to ${MAX_IMAGES} images.`);
  const take = pictures.slice(0, room);
  change(draft, d => ({ preparing: d.preparing + take.length }));
  const places = limits ? Math.max(limits.maxFiles - attachedTo(attachments.get(), draft).files.length, 0) : 0;
  if (rest.length > places) notice(full(limits.maxFiles));
  const uploading = rest.slice(0, places).map(file => uploadFile(draft, file, notice, limits));
  for (const file of take) await addImage(draft, file, notice, limits);
  await Promise.all(uploading);
}
