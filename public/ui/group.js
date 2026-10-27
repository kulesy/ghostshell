// The own session of a group or of one of the built-in sections: the normal chat. A server that summarises sessions shows the group's status in the Sub sessions tab of the chat's
// panel. An older one gets it above the transcript, which is the only place this file draws it.
import { api } from './api.js';
import { Back, ChatPane } from './chat.js';
import { renamerFor } from './chat-rename.js';
import { enc, GroupStatus } from './group-status.js';
import { groupById, paneOf, supportsGroupRename } from './group-rules.js';
import { sectionById } from './sections.js';
import { useDocumentTitle } from './hooks.js';
import { html, useEffect, useLayoutEffect, useMemo, useState } from './html.js';
import { draw, icons } from './menu.js';
import { subStatusOn } from './sub-panel-rules.js';
import { createStore } from './store.js';

// A pane with no chat in it: a way back to the list, and why.
function Stub({ title, children, action, kind }) {
  useDocumentTitle(`${kind} session · GhostShell`);
  return html`<section class="session" id="session">
    <header class="chat-head"><${Back} /><div class="chat-title"><h2>${kind} session</h2></div></header>
    <div data-slot="empty">
      <div data-slot="empty-header">
        <div data-slot="empty-icon" data-variant="icon">${draw(icons.messageSquare)}</div>
        <div data-slot="empty-title">${title}</div>
        <div data-slot="empty-description">${children}</div>
      </div>
      ${action ? html`<div data-slot="empty-content">${action}</div>` : null}
    </div>
  </section>`;
}

// The chat of the group or section `id`. One not yet opened is given its session first, which starts no process and costs no tokens, then the
// list brings the id and the chat opens. `ix` is the page's list, so a server that cannot run group sessions is told from it.
export function GroupPane({ id, ix, refreshIndex, edit }) {
  const state = paneOf(ix, id);
  const group = groupById(ix, id);
  const kind = sectionById(id) ? 'Section' : 'Group';
  const renameOn = kind === 'Group' && supportsGroupRename(ix);
  const rename = useMemo(() => (renameOn ? renamerFor({ kind: 'group', id, edit }) : null), [renameOn, id, edit]);
  const [booked, setBooked] = useState(null);
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0);
  const feed = useMemo(() => createStore({ group: null }), []);
  const panel = useMemo(() => html`<${GroupStatus} feed=${feed} />`, [feed]);
  const session = group?.session?.id ?? booked;
  const booking = state === 'ready' && !group.session;

  useLayoutEffect(() => { feed.set({ group }); }, [feed, group]);

  useEffect(() => {
    if (!booking) return undefined;
    let stale = false;
    setProblem('');
    api(`api/groups/${enc(id)}/session`, {}).then(
      made => { if (!stale) { setBooked(made.id); refreshIndex(); } },
      e => { if (!stale) setProblem(e.message); },
    );
    return () => { stale = true; };
  }, [id, booking, attempt]);

  if (state === 'unloaded') return html`<${Stub} kind=${kind} title="Sessions did not load">GhostShell could not be reached. This opens when the list does.<//>`;
  if (state === 'unsupported') return html`<${Stub} kind=${kind} title=${`Restart GhostShell to talk to a ${kind.toLowerCase()}`}>This GhostShell started before ${kind === 'Group' ? 'groups' : 'sections'} had sessions of their own. Restart it to open one.<//>`;
  if (state === 'missing') return html`<${Stub} kind=${kind} title=${`${kind} not found`}>${kind === 'Group' ? 'It may have been deleted. ' : ''}Pick another from the list.<//>`;
  if (!session) {
    return html`<${Stub} kind=${kind} title=${problem ? 'Could not open the session' : 'Opening the session'}
      action=${problem ? html`<button class="btn" data-variant="outline" type="button" onClick=${() => setAttempt(n => n + 1)}>Try again</button>` : null}>${problem || `Getting ${group.name} ready.`}<//>`;
  }
  return html`<${ChatPane} key=${session} id=${session} row=${{ title: group.name, cwd: '', branch: '' }} title=${group.name} refreshIndex=${refreshIndex} meta=${`${kind} session`} rename=${rename} aside=${subStatusOn(ix) ? undefined : panel} />`;
}
