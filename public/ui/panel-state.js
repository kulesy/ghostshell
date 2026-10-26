// Which side panel each chat has open and on which tab, how wide the panels are, and what the panel is asked to focus. The open state
// and tab are kept for the 100 newest chats, the width is one for all of them, and both are kept in localStorage. A panel that opened by
// itself is not the owner's choice, so it is held in `auto` in memory only, and goes when the chat has no room for it.
import { local } from './storage.js';
import { createStore } from './store.js';
import { PANEL, tabPress } from './terminal-rules.js';

const KEPT = 100;

export const CLOSED = Object.freeze({ open: false, tab: 'terminal' });

const TABS = ['subs', 'agents', 'terminal', 'file'];

export const valid = saved => Object.fromEntries(Object.entries(saved && typeof saved === 'object' ? saved : {})
  .filter(([, v]) => v && typeof v.open === 'boolean' && TABS.includes(v.tab))
  .map(([id, v]) => [id, { open: v.open, tab: v.tab }])
  .slice(-KEPT));

export const panels = createStore({ byId: valid(local.get('panels', {})), auto: {}, width: Number(local.get('panelWidth', PANEL.fallback)) || PANEL.fallback, want: null, goto: null });

export const panelOf = (state, id) => state.byId[id] ?? state.auto[id] ?? CLOSED;

// Where the focus goes back to when a chat's panel closes, which is whatever opened it. Kept apart from the store, as an element is not data.
const origins = new Map();
let asks = 0;

function put(id, patch) {
  panels.set(s => {
    const byId = { ...s.byId };
    const was = byId[id] ?? s.auto[id] ?? CLOSED;
    delete byId[id];
    byId[id] = { ...was, ...patch };
    const ids = Object.keys(byId);
    for (const old of ids.slice(0, Math.max(0, ids.length - KEPT))) delete byId[old];
    local.set('panels', byId);
    const auto = { ...s.auto };
    delete auto[id];
    return { byId, auto };
  });
}

// Opens the chat's panel on `tab`. `from` is the control that asked, which gets the focus back when the panel closes, and the panel
// takes the focus when it opens.
export function showPanel(id, tab, from) {
  if (from) origins.set(id, from);
  else origins.delete(id);
  put(id, { open: true, tab });
  panels.set({ want: { id, tab, n: ++asks } });
}

export const hidePanel = id => put(id, { open: false });

// Opens the chat's panel on `tab` and leaves the focus where it is, as a panel that opens by itself must. Nothing is saved, so the owner
// has not chosen it, and a chat the owner has opened or closed is left as it is.
export function openQuietly(id, tab) {
  const { byId, auto } = panels.get();
  if (id in byId || auto[id]?.tab === tab) return;
  panels.set({ auto: { ...auto, [id]: { open: true, tab } } });
}

// Takes a panel that opened by itself back, as it must when the chat no longer has room for it beside the chat.
export function closeQuietly(id) {
  const { auto } = panels.get();
  if (!(id in auto)) return;
  const { [id]: gone, ...rest } = auto;
  panels.set({ auto: rest });
}

// The chat's panel as it stands, for `restorePanel` to put back: what is saved for it and whether it opened by itself.
export function panelNow(id) {
  const { byId, auto } = panels.get();
  return { saved: byId[id] ?? null, auto: auto[id] ?? null };
}

// Puts the chat's panel back as `panelNow` found it, saved or not, after something opened it for a moment.
export function restorePanel(id, was) {
  panels.set(s => {
    const byId = { ...s.byId };
    const auto = { ...s.auto };
    delete byId[id];
    delete auto[id];
    if (was.saved) byId[id] = was.saved;
    if (was.auto) auto[id] = was.auto;
    local.set('panels', byId);
    return { byId, auto };
  });
}

// What a header button or shortcut for `tab` does. `shown` is the tab on show, or null while the panel is closed.
export function toggleTab(id, tab, from, shown) {
  if (tabPress(shown, tab) === 'close') hidePanel(id);
  else showPanel(id, tab, from);
}

// A panel that opened by itself stays that way when the owner picks another tab.
export function selectTab(id, tab) {
  const { byId, auto } = panels.get();
  if (id in auto && !(id in byId)) panels.set({ auto: { ...auto, [id]: { open: true, tab } } });
  else put(id, { tab });
}

export const takeWant = id => {
  const { want } = panels.get();
  if (want?.id !== id) return null;
  panels.set({ want: null });
  return want;
};

export const takeOrigin = id => {
  const from = origins.get(id);
  origins.delete(id);
  return from ?? null;
};

// The width follows a drag as it moves, and is kept once it lets go.
export function setPanelWidth(width, keep = true) {
  const next = Math.round(width);
  if (keep) local.set('panelWidth', next);
  if (next !== panels.get().width) panels.set({ width: next });
}

// Asks the terminal tab to scroll to a run and focus it, as "Open in terminal" does.
export const goToRun = key => panels.set({ goto: { key, n: ++asks } });
