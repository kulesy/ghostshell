// Archive and Unarchive in the header of an open chat, which run the sidebar row's flow: a running chat asks first, and the note offers Undo.
import { api } from './api.js';
import { closeSession, isRunning, unarchiveSession } from './close.js';
import { useStore } from './hooks.js';
import { html, useEffect, useState } from './html.js';
import { draw, icons } from './menu.js';
import { UNTITLED } from './order.js';
import { sessionActions, sessionIndex } from './subs.js';
import { findRow } from './tree.js';

// The ids a request is out for, so a double click archives once and its Undo stays reachable, as subs.js does for a card.
const working = new Set();

// The list holds no archived session, so a chat it does not hold is looked up in api/archived, which every server has. null is not known yet.
// The look can land before an archive from this button does, so `archivedHere` is what that archive's answer said.
function useArchived(id) {
  const listed = useStore(sessionIndex, s => (s.ix ? !!findRow(s.ix, id) : null));
  const [found, setFound] = useState(null);
  const [archivedHere, setArchivedHere] = useState(false);
  const look = listed === false;
  useEffect(() => { setArchivedHere(false); }, [id, listed]);
  useEffect(() => {
    setFound(null);
    if (!look) return undefined;
    let live = true;
    api('api/archived').then(d => { if (live) setFound((d.archived || []).some(r => r.id === id)); }, () => {});
    return () => { live = false; };
  }, [id, look]);
  return [listed ? false : archivedHere || found, () => setArchivedHere(true)];
}

// `state` is the chat's own, and `title` names the session in the note and the question.
export function ArchiveButton({ id, state, title }) {
  const archive = useStore(sessionActions, s => s.archive);
  const [archived, archivedNow] = useArchived(id);
  if (!archive || archived === null) return null;
  const running = isRunning({ state });
  const label = archived ? 'Unarchive' : running ? 'Stop and archive' : 'Archive';
  const name = title || UNTITLED;
  const run = async () => {
    if (working.has(id)) return null;
    working.add(id);
    try {
      return archived ? await unarchiveSession({ archive, id, title: name, retry: 'Try again' }) : await closeSession({ archive, id, title: name, running, done: archivedNow, back: () => document.getElementById('archiveButton') });
    } finally {
      working.delete(id);
    }
  };
  return html`<button class="btn" id="archiveButton" type="button" data-variant="ghost" data-size="icon-sm" aria-label=${label} data-tip=${label} onClick=${run}>${draw(archived ? icons.archiveRestore : icons.archive, 'icon')}</button>`;
}
