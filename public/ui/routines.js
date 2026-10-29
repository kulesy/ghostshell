// The Routines page: every routine with its schedule, next and last run, and the form that adds or edits one. The prompt text and a
// prompt file's path go to the server, so nothing here touches a file. The actions are shared with the menu of a routine's row in Home.
import { api } from './api.js';
import { ask } from './ask.js';
import { MODES } from './composer.js';
import { HOME } from './env.js';
import { useDocumentTitle } from './hooks.js';
import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { draw, icons, layerId, Menu, opener } from './menu.js';
import {
  byTitle, choices, deleteDetail, effortChoices, fireTime, formOf, jitterOf, JITTER_PROBLEM, modelChoices, newForm, NEW_ROUTINE_HASH,
  promptHint, promptSource, refusals, requestOf, routineHash, routineRoute, ROUTINES_HASH, scheduleWords, skippedWords, supportsRoutineEdits, supportsRoutineFiles, wasOf,
} from './routine-rules.js';
import { say } from './toast.js';
import { neighbour } from './tree.js';

const enc = encodeURIComponent;
const routineUrl = id => `api/routines/${enc(id)}`;
const sessionHash = id => `#/s/${enc(id)}`;

// Where the list puts the focus when it is first drawn after a form closed over it, as { gone, to } like a delete in the list. The form
// is gone by then, so it cannot do it, and the focus would fall to the page.
let landing = null;

const chevron = () => html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`;
const dots = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>`;

// The button on the Routines header in Home, drawn as the header button of a group's chat is.
export const ManageRoutines = ({ current }) => html`<a class="more head-tool" href=${ROUTINES_HASH} aria-label="Manage routines" data-tip="Manage routines" aria-current=${current ? 'page' : null}>${draw(icons.calendarClock)}</a>`;

// ---- actions, shared with Home's row menu --------------------------------------------------------

// Each says what happened or why not in the screen's note and loads the routines and the list again, so the screen shows the result.
export async function runRoutine(r, refresh) {
  try {
    const { sessionId } = await api(`${routineUrl(r.id)}/run`, {});
    say(`Started “${r.title}”.`, sessionId ? { action: { label: 'Open', onClick: () => { location.hash = sessionHash(sessionId); } } } : undefined);
  } catch (e) {
    say(e.message, { problem: true });
  }
  await refresh();
}

// Resolves with whether the server switched it.
export async function switchRoutine(r, on, refresh) {
  let done = false;
  try {
    await api(`${routineUrl(r.id)}/enabled`, { enabled: on });
    done = true;
  } catch (e) {
    say(e.message, { problem: true });
  }
  await refresh();
  return done;
}

// Asks first, because the schedule goes. Cancel has the focus, so Enter does no harm. `done` runs once the server has deleted it.
export function deleteRoutine(r, { refresh, back, done }) {
  ask({
    action: 'Delete routine',
    title: r.title,
    detail: deleteDetail(r),
    back,
    run: async () => {
      try {
        await api(routineUrl(r.id), undefined, 'DELETE');
      } catch (e) {
        say(e.message, { problem: true });
        await refresh();
        return;
      }
      say(`Deleted “${r.title}”.`);
      done?.();
      await refresh();
    },
  });
}

const manageItems = (r, ctx) => [
  { label: 'Edit', icon: icons.pencil, run: () => { location.hash = routineHash(r.id); } },
  { label: 'Delete', icon: icons.trash, danger: true, run: () => deleteRoutine(r, ctx) },
];

// What a routine's row menu in Home starts with. Add and edit only show on a server that has them.
export const routineItems = (r, { editable, ...ctx }) => [
  { label: 'Run now', icon: icons.circlePlay, run: () => runRoutine(r, ctx.refresh) },
  { label: r.enabled ? 'Pause' : 'Resume', icon: r.enabled ? icons.pause : icons.play, run: async () => { if (await switchRoutine(r, !r.enabled, ctx.refresh)) say(`${r.enabled ? 'Paused' : 'Resumed'} “${r.title}”.`); } },
  ...(editable ? manageItems(r, ctx) : []),
];

// ---- the page ------------------------------------------------------------------------------------

// `routines` is what api/routines answered, `error` why it could not, `reload` loads it again and `refresh` loads it and the session list.
export function RoutinesPane({ ix, route, routines, error, reload, refresh }) {
  if (route.form && supportsRoutineEdits(ix)) return html`<${RoutineForm} key=${route.id ?? 'new'} id=${route.id} ix=${ix} routines=${routines} error=${error} refresh=${refresh} />`;
  return html`<${RoutineList} ix=${ix} routines=${routines} error=${error} reload=${reload} refresh=${refresh} />`;
}

function Switch({ on, label, busy, onClick, id }) {
  return html`<button class="menu-switch routine-switch" id=${id} type="button" role="switch" aria-checked=${on} aria-label=${label} data-state=${on ? 'checked' : 'unchecked'} disabled=${busy} onClick=${onClick}>
    <span class="menu-switch-thumb"></span></button>`;
}

const Alert = ({ children, tone }) => html`<p class="routine-alert" data-tone=${tone || null}>${draw(icons.triangleAlert)}<span>${children}</span></p>`;

function RoutineRow({ r, now, editable, busy, open, menuId, onSwitch, onRun, onMore }) {
  const words = scheduleWords(r.cron, r.jitterSeconds);
  const skipped = skippedWords(r.skipped, now);
  const next = !r.enabled ? 'Off' : r.next ? `Next ${fireTime(r.next, now)}` : 'No upcoming run';
  const lastAt = fireTime(r.lastRunAt, now);
  const last = !lastAt ? 'Never run' : r.lastSessionId ? html`Last run <a href=${sessionHash(r.lastSessionId)}>${lastAt}</a>` : `Last run ${lastAt}`;
  const more = opener(onMore);
  return html`<li class="routine" data-routine=${r.id}>
    <div class="routine-info">
      <div class="routine-head">
        <h3 class="routine-title">${r.title}</h3>
        ${r.running ? html`<span class="routine-running"><span class="lamp" data-state="working" aria-hidden="true"></span>Running</span>` : null}
      </div>
      <p class="routine-schedule">${words ? html`<span>${words}</span>` : null}${r.cron ? html`<code class="routine-cron">${r.cron}</code>` : null}</p>
      <p class="routine-times"><span>${next}</span><span>${last}</span></p>
      ${r.problem ? html`<${Alert}>${r.problem}<//>` : null}
      ${r.lastError ? html`<${Alert}>The last run did not start: ${r.lastError}<//>` : null}
      ${skipped ? html`<p class="routine-quiet">${skipped}</p>` : null}
    </div>
    <div class="routine-actions">
      <${Switch} on=${r.enabled === true} label=${`Run ${r.title} on its schedule`} busy=${busy} onClick=${onSwitch} />
      <button class="btn" data-variant="outline" data-size="sm" type="button" disabled=${r.running || busy} aria-label=${`Run ${r.title} now`} onClick=${onRun}>Run now</button>
      ${editable
        ? html`<button class="btn routine-more" data-variant="ghost" data-size="icon-sm" type="button" aria-label=${`Actions for ${r.title}`} data-tip=${`Actions for ${r.title}`} aria-haspopup="menu"
            aria-expanded=${open} aria-controls=${open ? layerId(menuId) : null} data-state=${open ? 'open' : 'closed'} ...${more}>${dots()}</button>`
        : null}
    </div>
  </li>`;
}

function RoutineList({ ix, routines, error, reload, refresh }) {
  useDocumentTitle('Routines · GhostShell');
  const editable = supportsRoutineEdits(ix);
  const [busy, setBusy] = useState(() => new Set());
  const [shown, setShown] = useState(null);
  const opened = useRef(0);
  const box = useRef(null);
  const pending = useRef(undefined);
  if (pending.current === undefined) {
    pending.current = landing;
    landing = null;
  }
  const list = routines ? byTitle(routines.routines) : null;
  const rowOf = id => box.current?.querySelector(`[data-routine="${CSS.escape(id)}"]`);

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) reload(); }, 5000);
    return () => clearInterval(timer);
  }, [reload]);

  // Once a deleted routine has left the list, the focus goes to the row after it, or the one before it, or the New routine button.
  // After a save in the form, the routine's own switch has it.
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p || !list || list.some(r => r.id === p.gone)) return;
    pending.current = null;
    (p.to && rowOf(p.to)?.querySelector('[role="switch"]') || document.getElementById('routine-new'))?.focus();
  });

  const hold = async (id, work) => {
    setBusy(s => new Set(s).add(id));
    try {
      await work();
    } finally {
      setBusy(s => { const next = new Set(s); next.delete(id); return next; });
    }
  };

  const manage = r => manageItems(r, {
    refresh,
    back: () => rowOf(r.id)?.querySelector('.routine-more'),
    done: () => { pending.current = { gone: r.id, to: neighbour(list.map(x => x.id), r.id) }; },
  });

  const more = (r, button, entry) => setShown(open => (open?.session === r.id && !entry
    ? null
    : { id: ++opened.current, session: r.id, anchor: button, point: null, entry, label: `Actions for ${r.title}`, items: manage(r) }));

  const now = Date.now();
  return html`<section class="session" id="routines">
    <header class="chat-head">
      <a class="btn back" data-variant="ghost" data-size="sm" href="#/" aria-label="Back to sessions">${chevron()}Sessions</a>
      <div class="chat-title"><h2>Routines</h2></div>
      ${editable ? html`<div class="chat-tools"><a class="btn" id="routine-new" data-size="sm" href=${NEW_ROUTINE_HASH}>New routine</a></div>` : null}
    </header>
    <div class="routines-body">
      <div class="routines-inner" ref=${box}>
        ${routines?.problem ? html`<p class="routines-banner" role="alert">${draw(icons.triangleAlert)}<span>${routines.problem}</span></p>` : null}
        ${list
          ? list.length
            ? html`<ul class="routine-list">${list.map(r => html`<${RoutineRow} key=${r.id} r=${r} now=${now} editable=${editable} busy=${busy.has(r.id)} open=${shown?.session === r.id} menuId=${shown?.id}
                onSwitch=${() => hold(r.id, () => switchRoutine(r, !r.enabled, refresh))} onRun=${() => hold(r.id, () => runRoutine(r, refresh))} onMore=${(button, entry) => more(r, button, entry)} />`)}</ul>`
            : html`<div class="routine-none">
                <p>No routines yet.</p>
                <p class="quiet">${editable
                  ? 'A routine runs a prompt on a schedule, such as weekdays at 07:30. GhostShell starts a session for each run.'
                  : 'Routines are listed here once they are in routines.json in the GhostShell folder.'}</p>
                ${editable ? html`<a class="btn" data-variant="outline" data-size="sm" href=${NEW_ROUTINE_HASH}>New routine</a>` : null}
              </div>`
          : error
            ? html`<div class="routine-none"><p class="routines-failure" role="alert">Could not load routines: ${error}</p><button class="btn" data-variant="outline" data-size="sm" type="button" onClick=${reload}>Try again</button></div>`
            : html`<p class="quiet">Loading routines</p>`}
      </div>
    </div>
    <${Menu} menu=${shown} onClose=${() => setShown(null)} />
  </section>`;
}

// ---- the form ------------------------------------------------------------------------------------

const FIELD_IDS = { title: 'routine-title', cron: 'routine-cron', jitterSeconds: 'routine-jitter', cwd: 'routine-cwd', model: 'routine-model', effort: 'routine-effort', mode: 'routine-mode', file: 'routine-file', prompt: 'routine-prompt' };

const aria = (id, hint, error) => ({
  'aria-invalid': error ? 'true' : null,
  'aria-describedby': [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || null,
});

function Field({ id, label, hint, error, children }) {
  return html`<div class="routine-field">
    <label for=${id}>${label}</label>
    ${children}
    ${hint ? html`<p class="routine-hint" id=${`${id}-hint`}>${hint}</p>` : null}
    <p class="routine-error" id=${`${id}-error`}>${error}</p>
  </div>`;
}

function SchedulePreview({ cron, jitter, preview, now }) {
  const words = cron.trim() ? scheduleWords(cron, jitter ?? 0) : null;
  const { times, problem } = preview;
  return html`<div class="routine-preview" aria-live="polite">
    ${words ? html`<p class="routine-words">${words}</p>` : null}
    ${times.length ? html`<p class="routine-fires"><span>Next</span>${times.map(t => html`<span key=${t}>${fireTime(t, now)}</span>`)}</p>` : null}
    ${cron.trim() && jitter !== null && !problem && preview.done && !times.length ? html`<p class="routine-words">This schedule never fires.</p>` : null}
  </div>`;
}

function RoutineForm({ id, ix, routines, error, refresh }) {
  const adding = id === null;
  const files = supportsRoutineFiles(ix);
  const routine = adding ? null : routines?.routines.find(r => r.id === id);
  const [prompt, setPrompt] = useState(adding ? { text: '' } : null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(adding ? newForm(HOME) : null);
  const [was, setWas] = useState(null);
  const [problems, setProblems] = useState({});
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState({ n: 0, key: null });
  const [preview, setPreview] = useState({ times: [], problem: '', done: false });
  const remover = useRef(null);
  useDocumentTitle(`${adding ? 'New routine' : routine?.title ?? 'Routine'} · GhostShell`);

  useEffect(() => {
    if (adding) return;
    api(`${routineUrl(id)}/prompt`).then(setPrompt).catch(e => setLoadError(e.message));
  }, [id]);

  useEffect(() => {
    if (form || !routine || !prompt) return;
    setForm(formOf(routine, prompt));
    setWas(wasOf(routine, prompt));
  }, [routine?.id, prompt]);

  const cron = form?.cron ?? '';
  const jitter = jitterOf(form?.jitterSeconds);

  // The next fire times for what is typed, a moment after the typing stops. An answer that comes after the schedule changed again is dropped.
  useEffect(() => {
    if (!form) return undefined;
    if (!cron.trim() || jitter === null) {
      setPreview({ times: [], problem: '', done: false });
      return undefined;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const { next, problem } = await api(`api/schedule?cron=${enc(cron.trim())}&jitter=${jitter}`);
        if (current) setPreview({ times: next, problem: problem || '', done: true });
      } catch (e) {
        if (current) setPreview({ times: [], problem: e.message, done: true });
      }
    }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [!!form, cron, jitter]);

  useEffect(() => { if (attempt.key) document.getElementById(FIELD_IDS[attempt.key])?.focus(); }, [attempt]);

  const head = html`<header class="chat-head">
    <a class="btn back back-always" data-variant="ghost" data-size="sm" href=${ROUTINES_HASH} aria-label="Back to routines">${chevron()}Routines</a>
    <div class="chat-title"><h2>${adding ? 'New routine' : routine?.title ?? 'Routine'}</h2></div>
  </header>`;
  const page = body => html`<section class="session" id="routine-form">${head}<div class="routines-body"><div class="routines-inner routines-form-inner">${body}</div></div></section>`;

  if (!form) {
    const missing = routines && !routine && !adding;
    if (loadError || missing || (error && !routines)) {
      const why = missing ? 'That routine is not here any more.' : loadError || `Could not load routines: ${error}`;
      return page(html`<p class="routines-failure" role="alert">${why}</p><a class="btn" data-variant="outline" data-size="sm" href=${ROUTINES_HASH}>Back to routines</a>`);
    }
    return page(html`<p class="quiet">Loading the routine</p>`);
  }

  const set = key => e => {
    const value = e.currentTarget.value;
    setForm(f => ({ ...f, [key]: value }));
    if (problems[key]) setProblems(({ [key]: _gone, ...rest }) => rest);
  };

  const refused = key => problems[key] || '';
  const pickKind = promptKind => () => {
    setForm(f => ({ ...f, promptKind }));
    setProblems(({ file: _file, prompt: _prompt, ...rest }) => rest);
  };
  const refuse = (fields, first) => {
    setProblems(fields);
    setNotice('');
    setAttempt(({ n }) => ({ n: n + 1, key: first }));
  };

  // Back to the list, unless the owner has opened something else while the server answered, which a late reply must not undo.
  const leave = focus => {
    const here = routineRoute(location.hash);
    if (!here?.form || here.id !== id) return;
    landing = focus;
    location.hash = ROUTINES_HASH;
  };

  const save = async e => {
    e.preventDefault();
    if (saving) return;
    if (jitter === null) return refuse({ jitterSeconds: JITTER_PROBLEM }, 'jitterSeconds');
    const body = requestOf(form, was);
    if (was && !Object.keys(body).length) {
      leave({ gone: null, to: id });
      return;
    }
    setSaving(true);
    setNotice('');
    setProblems({});
    try {
      const saved = await api(adding ? 'api/routines' : routineUrl(id), body, adding ? 'POST' : 'PATCH');
      say(`${adding ? 'Added' : 'Saved'} “${form.title.trim()}”.`);
      await refresh();
      leave({ gone: null, to: saved.routine?.id ?? id });
    } catch (err) {
      const { fields, first } = refusals(err);
      if (first) refuse(fields, first);
      else setNotice(err.message);
    } finally {
      setSaving(false);
    }
  };

  const cronError = refused('cron') || (cron.trim() && jitter !== null ? preview.problem : '');
  const jitterError = refused('jitterSeconds') || (jitter === null ? JITTER_PROBLEM : '');
  const fileMode = files && form.promptKind === 'file';
  const loadedError = !files || (fileMode ? was?.kind === 'file' && form.file === was.file : was?.kind === 'text' && form.prompt === was.prompt);
  const textError = refused('prompt') || (!fileMode && loadedError ? prompt.error || '' : '');
  const fileError = refused('file') || (fileMode && loadedError ? prompt.error || '' : '');
  const now = Date.now();

  return page(html`<form class="routine-form" noValidate onSubmit=${save}>
    <${Field} id=${FIELD_IDS.title} label="Title" error=${refused('title')}>
      <input class="input" id=${FIELD_IDS.title} type="text" value=${form.title} autocomplete="off" onInput=${set('title')} ...${aria(FIELD_IDS.title, false, refused('title'))} />
    <//>
    <${Field} id=${FIELD_IDS.cron} label="Schedule" hint="Five fields: minute, hour, day of the month, month and day of the week, in this Mac's time. For example 30 7 * * 1-5." error=${cronError}>
      <input class="input routine-mono" id=${FIELD_IDS.cron} type="text" value=${form.cron} placeholder="30 7 * * 1-5" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck=${false} onInput=${set('cron')}
        ...${aria(FIELD_IDS.cron, true, cronError)} />
      <${SchedulePreview} cron=${cron} jitter=${jitter} preview=${preview} now=${now} />
    <//>
    <${Field} id=${FIELD_IDS.jitterSeconds} label="Jitter in seconds" hint="Added to every fire time, so runs do not all start on the minute." error=${jitterError}>
      <input class="input routine-short" id=${FIELD_IDS.jitterSeconds} type="text" inputmode="numeric" value=${form.jitterSeconds} autocomplete="off" onInput=${set('jitterSeconds')}
        ...${aria(FIELD_IDS.jitterSeconds, true, jitterError)} />
    <//>
    <${Field} id=${FIELD_IDS.cwd} label="Folder" hint="The full path of the folder each run starts in." error=${refused('cwd')}>
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
    ${files
      ? html`<fieldset class="routine-field routine-kind">
          <legend>Prompt</legend>
          <div class="routine-choices">
            <label class="routine-choice"><input type="radio" name="routine-prompt-kind" id="routine-kind-text" value="text" checked=${!fileMode} onChange=${pickKind('text')} />GhostShell's own text</label>
            <label class="routine-choice"><input type="radio" name="routine-prompt-kind" id="routine-kind-file" value="file" checked=${fileMode} onChange=${pickKind('file')} />A prompt file</label>
          </div>
          ${fileMode
            ? html`<input class="input routine-mono" id=${FIELD_IDS.file} type="text" value=${form.file} placeholder="/Users/you/prompts/daily-scrum.md" aria-label="Full path of the prompt file" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck=${false}
                onInput=${set('file')} ...${aria(FIELD_IDS.file, true, fileError)} />
              <p class="routine-hint" id=${`${FIELD_IDS.file}-hint`}>${promptHint('file', was?.kind)}</p>
              <p class="routine-error" id=${`${FIELD_IDS.file}-error`}>${fileError}</p>`
            : html`<textarea class="input routine-prompt" id=${FIELD_IDS.prompt} rows="14" aria-label="Prompt text" value=${form.prompt} spellcheck=${true} onInput=${set('prompt')} ...${aria(FIELD_IDS.prompt, true, textError)}></textarea>
              <p class="routine-hint" id=${`${FIELD_IDS.prompt}-hint`}>${promptHint('text', was?.kind)}</p>
              <p class="routine-error" id=${`${FIELD_IDS.prompt}-error`}>${textError}</p>`}
        </fieldset>`
      : html`<${Field} id=${FIELD_IDS.prompt} label="Prompt" hint=${adding ? 'GhostShell keeps the prompt in its own folder.' : promptSource(prompt)} error=${textError}>
          <textarea class="input routine-prompt" id=${FIELD_IDS.prompt} rows="14" value=${form.prompt} spellcheck=${true} onInput=${set('prompt')} ...${aria(FIELD_IDS.prompt, true, textError)}></textarea>
        <//>`}
    <div class="routine-field routine-on">
      <div class="routine-on-row">
        <label id="routine-enabled-label" for="routine-enabled">Run on its schedule</label>
        <${Switch} id="routine-enabled" on=${form.enabled} label=${null} onClick=${() => setForm(f => ({ ...f, enabled: !f.enabled }))} />
      </div>
      <p class="routine-hint">${adding ? 'A new routine starts counting from the moment it is on.' : 'Off keeps the routine here without running it.'}</p>
    </div>
    <p class="notice" role="alert">${notice}</p>
    <div class="routine-buttons">
      <button class="btn" type="submit" disabled=${saving}>${saving ? 'Saving' : 'Save'}</button>
      <a class="btn" data-variant="outline" href=${ROUTINES_HASH}>Cancel</a>
      ${adding || !routine ? null : html`<button class="btn routine-delete" data-variant="destructive" type="button" ref=${remover}
        onClick=${() => deleteRoutine(routine, { refresh, back: () => remover.current, done: () => leave({ gone: routine.id, to: null }) })}>Delete</button>`}
    </div>
  </form>`);
}
