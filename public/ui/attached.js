// The open session's header line of pull requests and issues: the ones found in its transcript and the ones the owner added, each with its status,
// a remove button on each, and an inline field to add another. Errors show as a toast, as a rename's do.
import { api } from './api.js';
import { Badges } from './badges.js';
import { escapeCancels } from './forms.js';
import { useStore } from './hooks.js';
import { html, useLayoutEffect, useRef, useState } from './html.js';
import { draw, icons } from './menu.js';
import { itemsOf } from './pull-rules.js';
import { normaliseUrl } from './pull-url.js';
import { attachOn, pullsOn, pullStore, refreshPulls, usePullStatus } from './pulls.js';
import { sessionIndex } from './subs.js';
import { toast } from './toast.js';
import { findRow } from './tree.js';

const FIELD = 'attach-address';
const REFUSED = 'Paste the address of a GitHub pull request or issue.';

// Whether the open session is one the server can list items for: a session of its own, which a draft or a group's chat is not.
export const attachable = (ix, id) => pullsOn(ix) && !!id && !!findRow(ix, id);

// Sends one change and resolves true when the server took it.
async function change(id, url, attached) {
  try {
    await api('api/links', { id, url, attached });
    refreshPulls(id);
    return true;
  } catch (e) {
    toast(e.message, { problem: true });
    return false;
  }
}

function AddForm({ id, onDone }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef(null);
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  const submit = async e => {
    e.preventDefault();
    if (sending) return;
    const given = normaliseUrl(text);
    if (!given) { toast(REFUSED, { problem: true }); input.current?.focus(); return; }
    setSending(true);
    const ok = await change(id, given.url, true);
    if (ok) onDone(true);
    else { setSending(false); input.current?.focus(); }
  };
  return html`<li class="attached-form">
    <form onSubmit=${submit} onKeyDown=${escapeCancels(() => onDone(true))}>
      <label class="sr" for=${FIELD}>Pull request or issue address</label>
      <input class="input" id=${FIELD} ref=${input} type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a pull request or issue address" value=${text} disabled=${sending} onInput=${e => setText(e.currentTarget.value)} />
      <button class="btn" type="submit" data-size="sm" disabled=${sending}>Add</button>
      <button class="btn" type="button" data-variant="ghost" data-size="sm" onClick=${() => onDone(true)}>Cancel</button>
    </form>
  </li>`;
}

export function Attached({ ctrl }) {
  const id = ctrl.id;
  const ix = useStore(sessionIndex, s => s.ix);
  const known = useStore(pullStore, s => s.known);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(() => new Set());
  const plus = useRef(null);
  const refocus = useRef(false);
  usePullStatus(ix, id);
  useLayoutEffect(() => {
    if (!adding && refocus.current) plus.current?.focus({ preventScroll: true });
    refocus.current = false;
  }, [adding]);
  if (!attachable(ix, id)) return null;
  const row = findRow(ix, id);
  const items = itemsOf(known.get(id)?.pulls);
  const editable = attachOn(ix);
  const remove = async (item, button) => {
    setBusy(all => new Set(all).add(item.url));
    const ok = await change(id, item.url, false);
    setBusy(all => { const next = new Set(all); next.delete(item.url); return next; });
    if (ok) (plus.current ?? document.getElementById('text'))?.focus({ preventScroll: true });
    else button.focus({ preventScroll: true });
  };
  const tail = !editable ? null : adding
    ? html`<${AddForm} id=${id} onDone=${back => { refocus.current = back; setAdding(false); }} />`
    : html`<li class="attached-tail"><button class="badge attached-add" data-variant="outline" type="button" ref=${plus} aria-label="Add a pull request or issue" data-tip="Add a pull request or issue" onClick=${() => setAdding(true)}>${draw(icons.plus, 'icon')}</button></li>`;
  return html`<${Badges} items=${items} row=${row} label="Pull requests and issues" remove=${editable ? remove : null} busy=${busy} tail=${tail} />`;
}
