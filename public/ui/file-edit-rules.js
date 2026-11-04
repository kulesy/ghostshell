// What the file editor decides without touching the page: the routes, and the drafts it keeps in localStorage for a file that was left unsaved.
import { local } from './storage.js';

export const FILE_DRAFTS = 'fileDrafts';

export const route = (chat, what, path) => `api/sessions/${encodeURIComponent(chat)}/${what}?path=${encodeURIComponent(path)}`;

// A draft belongs to one file in one chat. A NUL cannot be in a path, so it cannot be in two keys at once.
export const draftKey = (chat, path) => `${chat}\0${path}`;

const all = () => {
  const stored = local.get(FILE_DRAFTS, {});
  return stored && typeof stored === 'object' ? stored : {};
};

// The saved edit `{ text, base }` for this file, or null.
export function readDraft(key) {
  const d = all()[key];
  return d && typeof d.text === 'string' && typeof d.base === 'string' ? d : null;
}

// Set by sign-out. The page unloads right after, and its pagehide would write the draft back and leave the text for the next person at the browser.
let forgotten = false;

// Empties every draft, and keeps this page from writing another.
export function forgetFileDrafts() {
  forgotten = true;
  local.set(FILE_DRAFTS, {});
}

// Keeps the draft, or drops it when `draft` is null. Returns whether the store took it.
export function writeDraft(key, draft) {
  if (forgotten) return true;
  const drafts = { ...all() };
  if (draft) drafts[key] = draft;
  else if (key in drafts) delete drafts[key];
  else return true;
  return local.set(FILE_DRAFTS, drafts);
}
