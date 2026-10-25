// The status of the pull requests the sessions under a chat work on, asked of the server for the sessions the header button counts, so its mark
// is right with the panel closed. The header button mounts the hook once, and the tab and its cards only read the store.
import { api } from './api.js';
import { enc } from './group-status.js';
import { useStore } from './hooks.js';
import { useEffect, useMemo, useReducer, useRef, useState } from './html.js';
import { needsOf, pullsToAsk, scopeOf } from './pull-rules.js';
import { createStore } from './store.js';
import { batchesOf, KEPT, stampOf, trim } from './sub-panel-rules.js';
import { everyRow } from './tree.js';

// What the server last said of each session's pull requests, { stamp, at, pulls, settling }, in the order they were stored.
export const pullStore = createStore({ known: new Map() });

const SETTLE_MS = 4000;
const NOTHING = new Set();
// The ids a request is out for, so a refresh of the list that lands first does not ask again.
const asking = new Set();

export const pullsOn = ix => !!ix?.features?.pullStatus;

function keep(batch, reply, stamps, drawn) {
  const known = new Map(pullStore.get().known);
  const at = Date.now();
  for (const id of batch) {
    known.delete(id);
    known.set(id, { stamp: stamps.get(id), at, pulls: reply.pulls?.[id] ?? [], settling: reply.settling === true });
  }
  trim(known, drawn, KEPT);
  pullStore.set({ known });
}

// Asks for the sessions under `chatId` whose answer is missing or old, while the page is in sight and the server can say. A failed request keeps
// what the page has and waits for the next refresh of the list.
export function usePullStatus(ix, chatId) {
  const [round, again] = useReducer(n => n + 1, 0);
  const [seen, setSeen] = useState(() => !document.hidden);
  const mounted = useRef(true);
  const timer = useRef(0);
  const rows = useMemo(() => (pullsOn(ix) ? scopeOf(ix, chatId) : []), [ix, chatId]);
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
        reply => {
          keep(batch, reply, stamps, new Set(rows.map(row => row.id)));
          return reply.settling ? 'settling' : 'answered';
        },
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
