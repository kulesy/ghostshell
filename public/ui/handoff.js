// Under a chat's transcript, a quiet line when it holds a saved handoff, and a link to the session it carries on from or went to.
// The list holds no archived session, so a chat it does not hold is looked up in api/archived, which names where the work went.
import { api } from './api.js';
import { handoffLines } from './handoff-rules.js';
import { useStore } from './hooks.js';
import { html, useEffect, useState } from './html.js';
import { sessionIndex } from './subs.js';
import { findRow } from './tree.js';

export function HandoffNotice({ ctrl }) {
  const { id } = ctrl;
  const ix = useStore(sessionIndex, s => s.ix);
  const listed = id && ix ? findRow(ix, id) : null;
  const look = !!id && !!ix && !listed;
  const [archived, setArchived] = useState(null);
  useEffect(() => {
    setArchived(null);
    if (!look) return undefined;
    let live = true;
    api('api/archived').then(d => { if (live) setArchived((d.archived || []).find(r => r.id === id) ?? null); }, () => {});
    return () => { live = false; };
  }, [id, look]);
  const lines = handoffLines(listed || archived);
  return lines.length ? html`<div class="notice-action" id="handoffNotice">${lines.map(l => html`<p class="quiet account-hint" key=${l.text}>${l.text}${l.href ? html` <a href=${l.href}>${l.label}</a>` : null}</p>`)}</div>` : null;
}
