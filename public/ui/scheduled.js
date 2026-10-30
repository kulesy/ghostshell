// The Scheduled sessions page: every one-off session with when it starts and what became of it, and the form that adds or edits one.
// The actions are shared with the menu of its row in Home. It borrows the Routines page's layout and fields.
import { api } from './api.js';
import { ask } from './ask.js';
import { MODES } from './composer.js';
import { HOME } from './env.js';
import { useDocumentTitle } from './hooks.js';
import { html, useEffect, useRef, useState } from './html.js';
import { draw, icons, layerId, Menu, opener } from './menu.js';
import { Alert, aria, chevron, dots, Field } from './routines.js';
import { choices, fireTime, retryWords } from './routine-rules.js';
import {
  deleteDetail, effortChoices, formOf, groupChoices, modelChoices, newForm, NEW_SCHEDULED_HASH, ordered, refusals, requestOf, scheduledHash, scheduledRoute,
  SCHEDULED_HASH, statusWords, supportsScheduled, takes,
} from './scheduled-rules.js';
import { say } from './toast.js';

const scheduledUrl = id => `api/scheduled/${encodeURIComponent(id)}`;
const sessionHash = id => `#/s/${encodeURIComponent(id)}`;

// The button on the Scheduled heading in Home, drawn as the one on the Routines heading is.
export const ManageScheduled = ({ current }) => html`<a class="more head-tool" href=${SCHEDULED_HASH} aria-label="Manage scheduled sessions" data-tip="Manage scheduled sessions" aria-current=${current ? 'page' : null}>${draw(icons.calendarPlus)}</a>`;

// ---- actions, shared with Home's row menu --------------------------------------------------------

// Each says what happened or why not in the screen's note and loads the list and the sessions again, so the screen shows the result.
export async function startScheduled(s, refresh) {
  try {
    const { sessionId } = await api(`${scheduledUrl(s.id)}/start`, {});
    say(`Started “${s.title}”.`, sessionId ? { action: { label: 'Open', onClick: () => { location.hash = sessionHash(sessionId); } } } : undefined);
  } catch (e) {
    say(e.message, { problem: true });
  }
  await refresh();
}

export async function cancelScheduled(s, refresh) {
  try {
    await api(`${scheduledUrl(s.id)}/cancel`, {});
    say(`Cancelled “${s.title}”.`);
  } catch (e) {
    say(e.message, { problem: true });
  }
  await refresh();
}

// Asks first, because the entry goes. Cancel has the focus, so Enter does no harm. `done` runs once the server has deleted it.
export function deleteScheduled(s, { refresh, back, done }) {
  ask({
    action: 'Delete scheduled session',
    title: s.title,
    detail: deleteDetail(s),
    back,
    run: async () => {
      try {
        await api(scheduledUrl(s.id), undefined, 'DELETE');
      } catch (e) {
        say(e.message, { problem: true });
        await refresh();
        return;
      }
      say(`Deleted “${s.title}”.`);
      done?.();
      await refresh();
    },
  });
}

// What a row's menu holds, on the page and in Home. Only a pending one can start, change or be called off.
export function scheduledItems(s, ctx) {
  const can = takes(s);
  return [
    ...(can.start ? [{ label: 'Start now', icon: icons.circlePlay, run: () => startScheduled(s, ctx.refresh) }] : []),
    ...(can.edit ? [{ label: 'Edit', icon: icons.pencil, run: () => { location.hash = scheduledHash(s.id); } }] : []),
    ...(can.cancel ? [{ label: 'Cancel', icon: icons.x, run: () => cancelScheduled(s, ctx.refresh) }] : []),
    { label: 'Delete', icon: icons.trash, danger: true, run: () => deleteScheduled(s, ctx) },
  ];
}

// ---- the page ------------------------------------------------------------------------------------

// `scheduled` is what api/scheduled answered, `error` why it could not, `reload` loads it again and `refresh` loads it and the session list.
export function ScheduledPane({ ix, route, scheduled, error, reload, refresh }) {
  if (ix && !supportsScheduled(ix)) return html`<section class="session"><div class="routines-body"><div class="routines-inner"><p class="routines-failure" role="alert">This GhostShell does not have scheduled sessions.</p></div></div></section>`;
  if (route.form) return html`<${ScheduledForm} key=${route.id ?? 'new'} id=${route.id} ix=${ix} scheduled=${scheduled} error=${error} refresh=${refresh} />`;
  return html`<${ScheduledList} scheduled=${scheduled} error=${error} reload=${reload} refresh=${refresh} />`;
}

function ScheduledRow({ s, now, busy, open, menuId, onStart, onMore }) {
  const more = opener(onMore);
  const alone = s.status === 'started' && s.sessionId;
  const reason = s.status === 'skipped' || s.status === 'started' ? s.lastError : null;
  return html`<li class="routine" data-scheduled=${s.id}>
    <div class="routine-info">
      <div class="routine-head"><h3 class="routine-title">${s.title}</h3></div>
      <p class="routine-schedule"><span>${alone ? html`Started <a href=${sessionHash(s.sessionId)}>${fireTime(s.startedAt, now)}</a>` : statusWords(s, now)}</span>${s.status === 'pending' || s.status === 'cancelled' || s.status === 'skipped' ? html`<span>${fireTime(s.at, now)}</span>` : null}</p>
      <p class="routine-times"><span>${s.cwd}</span><span>${s.groupName ? `Group ${s.groupName}` : s.group ? 'A group that has been deleted' : 'Home'}</span></p>
      ${s.problem ? html`<${Alert}>${s.problem}<//>` : null}
      ${s.retry && s.status === 'pending' ? html`<${Alert} tone="warning">${retryWords(s.retry, now)}. The last try said: ${s.lastError}<//>`
        : reason ? html`<${Alert}>${reason}<//>` : null}
    </div>
    <div class="routine-actions">
      ${s.status === 'pending' ? html`<button class="btn" data-variant="outline" data-size="sm" type="button" disabled=${busy} aria-label=${`Start ${s.title} now`} onClick=${onStart}>Start now</button>` : null}
      <button class="btn routine-more" data-variant="ghost" data-size="icon-sm" type="button" aria-label=${`Actions for ${s.title}`} data-tip=${`Actions for ${s.title}`} aria-haspopup="menu"
        aria-expanded=${open} aria-controls=${open ? layerId(menuId) : null} data-state=${open ? 'open' : 'closed'} ...${more}>${dots()}</button>
    </div>
  </li>`;
}

function ScheduledList({ scheduled, error, reload, refresh }) {
  useDocumentTitle('Scheduled sessions · GhostShell');
  const [busy, setBusy] = useState(() => new Set());
  const [shown, setShown] = useState(null);
  const opened = useRef(0);
  const box = useRef(null);
  const list = scheduled ? ordered(scheduled.scheduled) : null;
  const rowOf = id => box.current?.querySelector(`[data-scheduled="${CSS.escape(id)}"]`);

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) reload(); }, 5000);
    return () => clearInterval(timer);
  }, [reload]);

  const hold = async (id, work) => {
    setBusy(s => new Set(s).add(id));
    try {
      await work();
    } finally {
      setBusy(s => { const next = new Set(s); next.delete(id); return next; });
    }
  };

  const items = s => scheduledItems(s, { refresh, back: () => rowOf(s.id)?.querySelector('.routine-more'), done: () => document.getElementById('scheduled-new')?.focus() });
  const more = (s, button, entry) => setShown(open => (open?.session === s.id && !entry
    ? null
    : { id: ++opened.current, session: s.id, anchor: button, point: null, entry, label: `Actions for ${s.title}`, items: items(s) }));

  const now = Date.now();
  return html`<section class="session" id="scheduled">
    <header class="chat-head">
      <a class="btn back" data-variant="ghost" data-size="sm" href="#/" aria-label="Back to sessions">${chevron()}Sessions</a>
      <div class="chat-title"><h2>Scheduled sessions</h2></div>
      <div class="chat-tools"><a class="btn" id="scheduled-new" data-size="sm" href=${NEW_SCHEDULED_HASH}>Schedule a session</a></div>
    </header>
    <div class="routines-body">
      <div class="routines-inner" ref=${box}>
        ${scheduled?.problem ? html`<p class="routines-banner" role="alert">${draw(icons.triangleAlert)}<span>${scheduled.problem}</span></p>` : null}
        ${list
          ? list.length
            ? html`<ul class="routine-list">${list.map(s => html`<${ScheduledRow} key=${s.id} s=${s} now=${now} busy=${busy.has(s.id)} open=${shown?.session === s.id} menuId=${shown?.id}
                onStart=${() => hold(s.id, () => startScheduled(s, refresh))} onMore=${(button, entry) => more(s, button, entry)} />`)}</ul>`
            : html`<div class="routine-none">
                <p>No scheduled sessions.</p>
                <p class="quiet">A scheduled session starts once, at the date and time you pick, with the prompt you give it. For something that repeats, use a routine.</p>
                <a class="btn" data-variant="outline" data-size="sm" href=${NEW_SCHEDULED_HASH}>Schedule a session</a>
              </div>`
          : error
            ? html`<div class="routine-none"><p class="routines-failure" role="alert">Could not load scheduled sessions: ${error}</p><button class="btn" data-variant="outline" data-size="sm" type="button" onClick=${reload}>Try again</button></div>`
            : html`<p class="quiet">Loading scheduled sessions</p>`}
      </div>
    </div>
    <${Menu} menu=${shown} onClose=${() => setShown(null)} />
  </section>`;
}

// ---- the form ------------------------------------------------------------------------------------

const FIELD_IDS = { title: 'scheduled-title', at: 'scheduled-at', cwd: 'scheduled-cwd', model: 'scheduled-model', effort: 'scheduled-effort', mode: 'scheduled-mode', group: 'scheduled-group', prompt: 'scheduled-prompt' };

function ScheduledForm({ id, ix, scheduled, error, refresh }) {
  const adding = id === null;
  const entry = adding ? null : scheduled?.scheduled.find(s => s.id === id);
  const [form, setForm] = useState(adding ? newForm(HOME) : null);
  const [was, setWas] = useState(null);
  const [problems, setProblems] = useState({});
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState({ n: 0, key: null });
  const remover = useRef(null);
  useDocumentTitle(`${adding ? 'Schedule a session' : entry?.title ?? 'Scheduled session'} · GhostShell`);

  useEffect(() => {
    if (form || !entry || entry.status !== 'pending') return;
    setForm(formOf(entry));
    setWas(entry);
  }, [entry?.id, entry?.status]);

  useEffect(() => { if (attempt.key) document.getElementById(FIELD_IDS[attempt.key])?.focus(); }, [attempt]);

  const head = html`<header class="chat-head">
    <a class="btn back back-always" data-variant="ghost" data-size="sm" href=${SCHEDULED_HASH} aria-label="Back to scheduled sessions">${chevron()}Scheduled</a>
    <div class="chat-title"><h2>${adding ? 'Schedule a session' : entry?.title ?? 'Scheduled session'}</h2></div>
  </header>`;
  const page = body => html`<section class="session" id="scheduled-form">${head}<div class="routines-body"><div class="routines-inner routines-form-inner">${body}</div></div></section>`;

  if (!form) {
    const missing = scheduled && !entry && !adding;
    const why = missing ? 'That scheduled session is not here any more.'
      : entry && entry.status !== 'pending' ? `${entry.title} is ${entry.status}, so it can no longer be changed.`
      : error && !scheduled ? `Could not load scheduled sessions: ${error}` : '';
    if (why) return page(html`<p class="routines-failure" role="alert">${why}</p><a class="btn" data-variant="outline" data-size="sm" href=${SCHEDULED_HASH}>Back to scheduled sessions</a>`);
    return page(html`<p class="quiet">Loading the scheduled session</p>`);
  }

  const set = key => e => {
    const value = e.currentTarget.value;
    setForm(f => ({ ...f, [key]: value }));
    if (problems[key]) setProblems(({ [key]: _gone, ...rest }) => rest);
  };
  const refused = key => problems[key] || '';

  // Back to the list, unless the owner has opened something else while the server answered, which a late reply must not undo.
  const leave = () => {
    const here = scheduledRoute(location.hash);
    if (here?.form && here.id === id) location.hash = SCHEDULED_HASH;
  };

  const save = async e => {
    e.preventDefault();
    if (saving) return;
    const body = requestOf(form, was);
    if (was && !Object.keys(body).length) return leave();
    setSaving(true);
    setNotice('');
    setProblems({});
    try {
      await api(adding ? 'api/scheduled' : scheduledUrl(id), body, adding ? 'POST' : 'PATCH');
      say(`${adding ? 'Scheduled' : 'Saved'} “${form.title.trim()}”.`);
      await refresh();
      leave();
    } catch (err) {
      const { fields, first } = refusals(err);
      if (first) {
        setProblems(fields);
        setAttempt(({ n }) => ({ n: n + 1, key: first }));
      } else {
        setNotice(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return page(html`<form class="routine-form" noValidate onSubmit=${save}>
    <${Field} id=${FIELD_IDS.title} label="Title" hint="The session is called this." error=${refused('title')}>
      <input class="input" id=${FIELD_IDS.title} type="text" value=${form.title} autocomplete="off" onInput=${set('title')} ...${aria(FIELD_IDS.title, true, refused('title'))} />
    <//>
    <${Field} id=${FIELD_IDS.at} label="Date and time" hint="In this Mac's time zone. If GhostShell is off then, it starts as soon as it is back, unless that is more than 12 hours late." error=${refused('at')}>
      <input class="input routine-short" id=${FIELD_IDS.at} type="datetime-local" value=${form.at} onInput=${set('at')} ...${aria(FIELD_IDS.at, true, refused('at'))} />
    <//>
    <${Field} id=${FIELD_IDS.cwd} label="Folder" hint="The full path of the folder the session starts in." error=${refused('cwd')}>
      <input class="input routine-mono" id=${FIELD_IDS.cwd} type="text" value=${form.cwd} autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck=${false} onInput=${set('cwd')}
        ...${aria(FIELD_IDS.cwd, true, refused('cwd'))} />
    <//>
    <div class="routine-trio">
      ${[['model', 'Model', modelChoices(form.model)], ['effort', 'Effort', effortChoices(form.effort)], ['mode', 'Permission mode', choices(MODES, form.mode)]].map(([key, label, options]) => html`
        <${Field} key=${key} id=${FIELD_IDS[key]} label=${label} error=${refused(key)}>
          <select class="input" id=${FIELD_IDS[key]} value=${form[key]} onChange=${set(key)} ...${aria(FIELD_IDS[key], false, refused(key))}>
            ${options.map(([value, text]) => html`<option value=${value}>${text}</option>`)}
          </select>
        <//>`)}
    </div>
    <p class="routine-hint routine-default">Default follows Claude Desktop's settings for the folder.</p>
    <${Field} id=${FIELD_IDS.group} label="Group" hint="The session goes into this group when it starts. With none it starts on Home." error=${refused('group')}>
      <select class="input" id=${FIELD_IDS.group} value=${form.group} onChange=${set('group')} ...${aria(FIELD_IDS.group, true, refused('group'))}>
        ${groupChoices(ix?.groups ?? [], form.group).map(([value, text]) => html`<option value=${value}>${text}</option>`)}
      </select>
    <//>
    <${Field} id=${FIELD_IDS.prompt} label="Prompt" hint="GhostShell sends it as the session's first message, with a note that nobody is there to answer." error=${refused('prompt')}>
      <textarea class="input routine-prompt" id=${FIELD_IDS.prompt} rows="14" value=${form.prompt} spellcheck=${true} onInput=${set('prompt')} ...${aria(FIELD_IDS.prompt, true, refused('prompt'))}></textarea>
    <//>
    <p class="notice" role="alert">${notice}</p>
    <div class="routine-buttons">
      <button class="btn" type="submit" disabled=${saving}>${saving ? 'Saving' : 'Save'}</button>
      <a class="btn" data-variant="outline" href=${SCHEDULED_HASH}>Cancel</a>
      ${adding || !entry ? null : html`<button class="btn routine-delete" data-variant="destructive" type="button" ref=${remover}
        onClick=${() => deleteScheduled(entry, { refresh, back: () => remover.current, done: leave })}>Delete</button>`}
    </div>
  </form>`);
}
