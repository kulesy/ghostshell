// The status of the pull requests and issues of the open session and of the sessions under it, asked of the server for the session itself and the
// sessions the header button counts, so its mark is right with the panel closed. The header mounts the hook, and the tab and its cards only read the store.
import { api } from './api.js';
import { enc } from './group-status.js';
import { useStore } from './hooks.js';
import { useEffect, useMemo, useReducer, useRef, useState } from './html.js';
import { needsOf, pullsToAsk, scopeOf } from './pull-rules.js';
import { createStore } from './store.js';
import { batchesOf, KEPT, stampOf, trim } from './sub-panel-rules.js';
import { everyRow, findRow } from './tree.js';

// What the server last said of each session's pull requests, { stamp, at, pulls, settling }, in the order they were stored.
export const pullStore = createStore({ known: new Map() });

const SETTLE_MS = 4000;
const NOTHING = new Set();
// The ids a request is out for, so a refresh of the list that lands first does not ask again.
const asking = new Set();
// The ids whose list changed while a request for them was out, so that request's answer is already old.
const changed = new Set();

export const pullsOn = ix => !!ix?.features?.pullStatus;
export const attachOn = ix => !!ix?.features?.attachLinks;

// The tabs on a page, each told to ask again when a session's list has changed.
const listening = new Set();

// Marks a session's answer old, keeping what it holds on screen until the new one lands, and has every tab ask for it again.
export function refreshPulls(id) {
  if (asking.has(id)) changed.add(id);
  const kept = pullStore.get().known.get(id);
  if (kept) {
    const known = new Map(pullStore.get().known);
    known.set(id, { ...kept, at: 0 });
    pullStore.set({ known });
  }
  listening.forEach(ask => ask());
}

// Whether the answer left something to ask again: the server was still reading, or a list changed while the request was out.
function keep(batch, reply, stamps, drawn) {
  const known = new Map(pullStore.get().known);
  const at = Date.now();
  let again = reply.settling === true;
  for (const id of batch) {
    const old = changed.delete(id);
    again ||= old;
    known.delete(id);
    known.set(id, { stamp: stamps.get(id), at: old ? 0 : at, pulls: reply.pulls?.[id] ?? [], settling: reply.settling === true });
  }
  trim(known, drawn, KEPT);
  pullStore.set({ known });
  return again;
}

// Asks for the sessions under `chatId` whose answer is missing or old, while the page is in sight and the server can say. A failed request keeps
// what the page has and waits for the next refresh of the list.
export function usePullStatus(ix, chatId) {
  const [round, again] = useReducer(n => n + 1, 0);
  const [seen, setSeen] = useState(() => !document.hidden);
  const mounted = useRef(true);
  const timer = useRef(0);
  const rows = useMemo(() => {
    if (!pullsOn(ix)) return [];
    const own = findRow(ix, chatId);
    return [...(own && !own.archived ? [own] : []), ...scopeOf(ix, chatId).filter(row => row.id !== chatId)];
  }, [ix, chatId]);
  useEffect(() => {
    listening.add(again);
    return () => listening.delete(again);
  }, []);
  useEffect(() => {
    const sync = () => setSeen(!document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  useEffect(() => () => { mounted.current = false; clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!seen) return;
    const ids = pullsToAsk(rows, pullStore.get().known).filter(id => !asking.has(id));
    const stamps = new Map(rows.map(row => [row.id, stampOf(row)]));
    for (const batch of batchesOf(ids)) {
      batch.forEach(id => asking.add(id));
      api(`api/pulls?ids=${batch.map(enc).join(',')}`).then(
        reply => (keep(batch, reply, stamps, new Set(rows.map(row => row.id))) ? 'settling' : 'answered'),
        () => 'failed',
      ).then(result => {
        batch.forEach(id => asking.delete(id));
        if (result !== 'settling' || !mounted.current) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(again, SETTLE_MS);
      });
    }
  }, [rows, seen, round]);
}

// The ids of the sessions that wait on the owner for a pull request. A server that cannot say, or a list not loaded yet, gives none.
export function usePullNeeds(ix) {
  const known = useStore(pullStore, s => s.known);
  return useMemo(() => (pullsOn(ix) ? needsOf(everyRow(ix), known) : NOTHING), [ix, known]);
}
