// The Sub sessions tab of a chat's side panel: the sessions nested under the chat, or the group's own sessions in a group's chat. Each is a
// card with its state, when it last moved, the first sentence of its latest reply and its roll-up, and it opens to the whole reply and the
// sessions under it, to any depth. Summaries are read for the lines on screen only, and again for a line when it moves.
import { md } from '../md.mjs';
import { api } from './api.js';
import { DOT_LABEL, STATE_LABEL, when } from './format.js';
import { flipped, groupOfSession } from './group-rules.js';
import { chevron, emptyNote, enc, LIVE } from './group-status.js';
import { useStore } from './hooks.js';
import { html, useEffect, useMemo, useReducer, useRef, useState } from './html.js';
import { UNTITLED } from './order.js';
import { createStore } from './store.js';
import { batchesOf, drawnRows, KEPT, linesOf, partsOf, pendingLine, pillOf, splitWaiting, staleIds, stampOf, summaryLine, trim } from './sub-panel-rules.js';
import { rollupLine, rollupOf } from './sub-rules.js';
import { everyRow } from './tree.js';

// Lucide's list-tree, as the header button and the tab draw it.
export const LIST_TREE = ['M21 12h-8', 'M21 6H8', 'M21 18h-8', 'M3 6v4c0 1.1.9 2 2 2h3', 'M3 10v6c0 1.1.9 2 2 2h3'];

// The page's list of sessions, which app.js keeps here so the panel can read what is nested without the chat being handed the list.
export const sessionIndex = createStore({ ix: null });

const NOTHING = { line: '', pending: [] };
const NONE = new Set();

// What the server last said of each session and the reply it last read in full, each with the stamp of the row it was read for.
const said = new Map();
const replies = new Map();
// The ids a request is out for, so a refresh that lands first does not ask again.
const asking = new Set();
// The tabs on a page, each told when a request answers, so it asks again for what it skipped while that request was out and is still stale.
const listening = new Set();

// `drawn` is the ids on screen, which are kept past the limit so that none is asked for again.
function keep(map, id, value, drawn = NONE) {
  map.delete(id);
  map.set(id, value);
  trim(map, drawn, KEPT);
}

function useSummaries(rows, ix) {
  const [round, again] = useReducer(n => n + 1, 0);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const latest = useRef(rows);
  latest.current = rows;
  useEffect(() => {
    listening.add(again);
    return () => { listening.delete(again); mounted.current = false; };
  }, []);
  const stale = staleIds(rows, said);
  useEffect(() => {
    // An answer can land between the render and this effect, so what is stale is worked out again here.
    const ids = staleIds(rows, said).filter(id => !asking.has(id));
    if (!ids.length) return;
    const stamps = new Map(rows.map(row => [row.id, stampOf(row)]));
    for (const batch of batchesOf(ids)) {
      batch.forEach(id => asking.add(id));
      api(`api/summaries?ids=${batch.map(enc).join(',')}`).then(
        reply => {
          const drawn = new Set(latest.current.map(row => row.id));
          for (const id of batch) keep(said, id, { ...NOTHING, ...reply.summaries?.[id], stamp: stamps.get(id) }, drawn);
          if (mounted.current) setFailed(false);
          return true;
        },
        () => {
          if (mounted.current) setFailed(true);
          return false;
        },
      ).then(answered => {
        batch.forEach(id => asking.delete(id));
        // A failed request waits for the next refresh of the list, so a server that is down is not asked again at once.
        if (answered) listening.forEach(ask => ask());
      });
    }
  }, [stale.join(','), ix, round]);
  return failed;
}

// The whole of a session's latest reply, read when its line is opened and again when the session moves while it stays open. A tab out of sight asks for nothing.
function Reply({ row, active }) {
  const stamp = stampOf(row);
  const [got, setGot] = useState(() => replies.get(row.id) ?? null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    const have = replies.get(row.id);
    if (have?.stamp === stamp) { setGot(have); return undefined; }
    if (!active) return undefined;
    let stale = false;
    api(`api/summaries?ids=${enc(row.id)}&detail=1`).then(
      reply => {
        keep(replies, row.id, { stamp, reply: reply.summaries?.[row.id]?.reply ?? '' });
        if (!stale) { setGot(replies.get(row.id)); setProblem(''); }
      },
      e => { if (!stale) setProblem(e.message); },
    );
    return () => { stale = true; };
  }, [row.id, stamp, active]);
  const markup = useMemo(() => (got?.reply ? md(got.reply) : ''), [got?.reply]);
  if (!got) return problem ? html`<p class="status-note" role="alert">Could not load the reply: ${problem}</p>` : html`<p class="status-note" role="status">Loading the reply</p>`;
  if (!got.reply) return html`<p class="status-note">No reply yet.</p>`;
  // file-doc keeps Run off the blocks of a reply that belongs to another session, as it does for a file in the panel.
  return html`<div class="msg claude file-doc sub-reply" tabindex="0" role="region" aria-label=${`Latest reply of ${row.title || UNTITLED}`} dangerouslySetInnerHTML=${{ __html: markup }}></div>`;
}

function Words({ text }) {
  const [before, words, after] = splitWaiting(text);
  return html`${before}${words ? html`<span class="sub-need">${words}</span>` : null}${after}`;
}

function Line({ node, shared }) {
  const { row, subs } = node;
  const { rows, opened, active, flip } = shared;
  const open = !!opened[row.id];
  const heard = said.get(row.id);
  const waits = row.state === 'waiting' ? pendingLine(heard?.pending) : '';
  const roll = rollupLine(rollupOf(rows, row.id));
  const name = row.title || UNTITLED;
  const state = DOT_LABEL[row.dot] ?? STATE_LABEL[row.state];
  const pill = pillOf(row);
  const body = `sub-${row.id}`;
  const under = `${body}-subs`;
  const showSubs = open && subs.length > 0;
  return html`<li class=${open ? 'sub open' : 'sub'}>
    <div class="sub-card">
      <div class="sub-head">
        <a class="sub-title" href=${`#/s/${enc(row.id)}`}>${name}${state ? html`<span class="sr">, ${state}</span>` : null}</a>
        <time class="status-time">${when(row.lastActivityAt)}</time>
      </div>
      <span class="sub-pill" data-tone=${pill.tone}>${pill.label}</span>
      ${heard?.line ? html`<p class="sub-said">${heard.line}</p>` : null}
      ${waits ? html`<p class="sub-wait">${waits}</p>` : null}
      <div class="sub-foot">
        ${roll ? html`<p class="sub-roll"><${Words} text=${roll} /></p>` : null}
        <button class="btn sub-fold" data-variant="ghost" data-size="xs" type="button" aria-expanded=${open} aria-controls=${open ? (showSubs ? `${body} ${under}` : body) : null} aria-label=${`Details of ${name}`} data-tip=${`Details of ${name}`} onClick=${() => flip(row.id)}>Details${chevron()}</button>
      </div>
      ${open ? html`<div class="sub-open" id=${body}><${Reply} row=${row} active=${active} /></div>` : null}
    </div>
    ${showSubs ? html`<div class="sub-under" id=${under}><${Lines} nodes=${subs} shared=${shared} label=${`Sub sessions of ${name}`} /></div>` : null}
  </li>`;
}

const Lines = ({ nodes, shared, label }) => html`<ul class="sub-lines" aria-label=${label}>${nodes.map(node => html`<${Line} key=${node.row.id} node=${node} shared=${shared} />`)}</ul>`;

function Section({ label, nodes, shared }) {
  return html`<section class="status-part">
    <h3 class="status-heading">${`${label} (${nodes.length})`}</h3>
    <${Lines} nodes=${nodes} shared=${shared} />
  </section>`;
}

// Every session at the level, idle ones too. Archived sessions are not in the page's list, so the tab never shows them.
const PARTS = [...LIVE, ['idle', 'Idle']];

// `active` is whether the tab is on show, since the panel keeps its tabs mounted and a tab out of sight asks the server for nothing.
export function SubsTab({ ctrl, active }) {
  const id = ctrl.id;
  const ix = useStore(sessionIndex, s => s.ix);
  const group = groupOfSession(ix, id);
  const [opened, setOpened] = useState({});
  const lines = useMemo(() => (ix ? linesOf(ix, id) : []), [ix, id]);
  const rows = useMemo(() => (ix ? everyRow(ix) : []), [ix]);
  const parts = useMemo(() => partsOf(lines), [lines]);
  const shown = PARTS.flatMap(([key]) => parts[key]);
  const failed = useSummaries(active ? drawnRows(shown, opened) : [], ix);
  if (!ix) return null;
  const shared = { rows, opened, active, flip: key => setOpened(all => flipped(all, key)) };
  const summary = summaryLine(ix, id);
  return html`<div class="subs">
    ${summary ? html`<p class="subs-sum"><${Words} text=${summary} /></p>` : null}
    ${PARTS.map(([key, label]) => (parts[key].length ? html`<${Section} key=${key} label=${label} nodes=${parts[key]} shared=${shared} />` : null))}
    ${group && !lines.length ? html`<p class="status-note">${emptyNote(group)}</p>` : null}
    ${failed ? html`<p class="status-note" role="status">Could not read what these sessions last said.</p>` : null}
  </div>`;
}
