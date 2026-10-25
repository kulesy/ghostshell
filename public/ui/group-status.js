// The status of a group's or built-in section's sessions: the panel drawn above its chat by a server that cannot summarise sessions, and the parts, the
// fold for the idle and the lazily loaded archived list that the Sub sessions tab of a group's chat draws too. It is drawn from the list the
// page already loads, so it costs no tokens, and the archived part is read from the server only when that part is opened.
import { api } from './api.js';
import { HOME } from './env.js';
import { DOT_LABEL, folderName, STATE_LABEL, when } from './format.js';
import { bucketsOf, flipped, membersOf, summaryOf } from './group-rules.js';
import { useLocal, useStore } from './hooks.js';
import { html, useEffect, useState } from './html.js';
import { draw, icons } from './menu.js';
import { UNTITLED } from './order.js';

export const enc = encodeURIComponent;

// The archived sessions drawn before Show more, since a group can hold hundreds.
const ARCHIVED_SHOWN = 100;

export const chevron = () => draw(['m9 18 6-6-6-6'], 'chevron');

// The mark of a session as a sidebar row shows it, in the slot at the start of a status line.
export const Mark = ({ dot }) => html`<span class="status-dot">${dot ? html`<span class="row-dot" data-dot=${dot} aria-hidden="true">${dot === 'error' ? draw(icons.triangleAlert) : null}</span>` : null}</span>`;

// A session of the group, as a sidebar row shows it: its mark, title, folder and branch, state and when it last ran. An archived
// session is listed with its state from when it was archived, which says nothing now.
function Member({ r }) {
  const label = r.archived ? '' : DOT_LABEL[r.dot] ?? STATE_LABEL[r.state];
  const where = [folderName(r.cwd, HOME), r.branch, label].filter(Boolean).join(' · ');
  return html`<li><a class="status-row" href=${`#/s/${enc(r.id)}`}>
    <${Mark} dot=${r.dot} />
    <span class="status-title">${r.title || UNTITLED}</span>
    ${where ? html`<span class="status-meta">${where}</span>` : null}
    <time class="status-time">${when(r.lastActivityAt)}</time></a></li>`;
}

export function Part({ label, rows, count = rows.length, children }) {
  return html`<section class="status-part">
    <h3 class="status-heading">${`${label} (${count})`}</h3>
    <ul class="status-rows">${rows.map(r => html`<${Member} key=${r.id} r=${r} />`)}</ul>${children}
  </section>`;
}

// Mounted only while the part is open. It reads the group's archived sessions then, and again when the group's count of them changes.
function Archived({ group }) {
  const [got, setGot] = useState({ rows: null, error: '' });
  const [limit, setLimit] = useState(ARCHIVED_SHOWN);
  useEffect(() => {
    let stale = false;
    api(`api/archived?group=${enc(group.id)}`).then(
      reply => { if (!stale) setGot({ rows: reply.archived, error: '' }); },
      e => { if (!stale) setGot(was => ({ ...was, error: e.message })); },
    );
    return () => { stale = true; };
  }, [group.id, group.archived]);
  const failed = got.error ? html`<p class="status-note" role="alert">Could not load the archived sessions: ${got.error}</p>` : null;
  if (!got.rows) return failed ?? html`<p class="status-note" role="status">Loading the archived sessions</p>`;
  if (!got.rows.length) return failed;
  const more = got.rows.length - limit;
  return html`<${Part} label="Archived" rows=${got.rows.slice(0, limit)} count=${got.rows.length}>
    ${more > 0 ? html`<button class="btn status-more" data-variant="ghost" data-size="sm" type="button" onClick=${() => setLimit(n => n + ARCHIVED_SHOWN)}>Show ${Math.min(more, ARCHIVED_SHOWN)} more</button>` : null}${failed}
  <//>`;
}

// The fold for the idle and the archived. `children` is the idle part, drawn as the caller likes, and `count` is what the fold counts besides
// the archived sessions.
export function Rest({ group, label = 'Idle and archived', count, open, onFlip, children }) {
  const body = `status-more-${group.id}`;
  return html`<section class="status-part">
    <button class="status-fold status-rest" type="button" aria-expanded=${open} aria-controls=${open ? body : null} onClick=${onFlip}>
      <span>${`${label} (${count + group.archived})`}</span>${chevron()}
    </button>
    ${open ? html`<div id=${body}>
      ${children}
      ${group.archived ? html`<${Archived} group=${group} />` : null}
    </div>` : null}
  </section>`;
}

export const EMPTY = 'No sessions in this group yet. Move one in from its menu, or ask here to start one.';

// A section is filled by where its sessions come from, so it has no menu to move one in from.
export const emptyNote = group => (group.section ? 'No sessions in this section right now.' : EMPTY);

export const LIVE = [['needs', 'Waiting on you'], ['working', 'Working'], ['recent', 'Recent activity']];

// The summary line folds the panel. Both folds are kept for each group in this browser.
export function GroupStatus({ feed }) {
  const group = useStore(feed, s => s.group);
  const [shut, setShut] = useLocal('groupShut', {});
  const [opened, setOpened] = useLocal('groupMore', {});
  if (!group) return null;
  const buckets = bucketsOf(membersOf(group));
  const open = !shut[group.id];
  const body = `status-${group.id}`;
  const empty = !membersOf(group).length && !group.archived;
  return html`<section class="group-status" aria-label=${`Sessions in ${group.name}`}>
    <button class="status-fold status-sum" type="button" aria-expanded=${open} aria-controls=${open ? body : null} onClick=${() => setShut(all => flipped(all, group.id))}>
      <span>${summaryOf(buckets, group.archived)}</span>${chevron()}
    </button>
    ${open ? html`<div class="status-body" id=${body}>
      ${LIVE.map(([key, label]) => (buckets[key].length ? html`<${Part} key=${key} label=${label} rows=${buckets[key]} />` : null))}
      ${buckets.idle.length || group.archived ? html`<${Rest} group=${group} count=${buckets.idle.length} open=${!!opened[group.id]} onFlip=${() => setOpened(all => flipped(all, group.id))}>${buckets.idle.length ? html`<${Part} label="Idle" rows=${buckets.idle} />` : null}<//>` : null}
      ${empty ? html`<p class="status-note">${emptyNote(group)}</p>` : null}
    </div>` : null}
  </section>`;
}
