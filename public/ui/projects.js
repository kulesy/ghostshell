// The projects sidebar, which picks the view the session list shows. From 56rem up it is a column beside the list that stays open
// until it is closed. Below that there is no room beside the list, so it is shadcn's mobile sidebar: a sheet that slides in over the
// page, on the dialog layer, and closes when a view is picked.
import { Dialog } from './dialog.js';
import { NameForm } from './forms.js';
import { STATE_LABEL } from './format.js';
import { MOVE, viewTargets } from './group-drag-rules.js';
import { useLocal, useModifier, useWide } from './hooks.js';
import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { contextOpener, layerId, Menu, opener as menuOpener } from './menu.js';
import { countOf, EVERY_VIEW, HOME_VIEW, holder, lampOf, NO_VIEW, othersWaiting, viewIn } from './scopes.js';
import { keyHint } from './shortcuts.js';
import { nextStop } from './tree.js';

const PANEL = 'projectsPanel';

// The view in use, kept in this browser as a project id or null for Home, and whether the column is open. The sheet is plain state
// and never stored, so a phone always starts with it shut. It opens over whatever is on screen, a chat included, and it ends when the
// route or the view changes and when the window grows wide. Opening the chat at `current` switches to the view that has its row, once
// for each chat. `box` is the panel and `opener` the button that opens it. `toList()` puts the list on screen, for a view picked
// where a chat has the screen.
export function useProjects(ix, current, hash, toList) {
  const [chosen, choose] = useLocal('scope', null);
  const [docked, setDocked] = useLocal('projectsDocked', false);
  const [sheet, setSheet] = useState(false);
  const [landing, setLanding] = useState(null);
  const wide = useWide();
  const opener = useRef(null);
  const box = useRef(null);
  const revealed = useRef(null);
  const view = ix ? viewIn(ix, chosen) : chosen;
  const open = wide ? docked : sheet;

  // This runs before the screen is drawn, so a route that hides the list never shows the sheet over it.
  useLayoutEffect(() => { setSheet(false); }, [hash, view, wide]);

  // A new chat's row arrives a little after its route, so this waits for the row. A pinned row is in every view, so it never switches.
  // Once a chat has been looked for, a later list does not switch the view again, or a list refresh would undo a view picked by hand.
  useEffect(() => {
    if (!current) { revealed.current = null; return; }
    if (!ix || revealed.current === current) return;
    const held = holder(ix, current);
    if (held === NO_VIEW) return;
    revealed.current = current;
    if (held !== EVERY_VIEW && held !== view) choose(held);
  }, [ix, current]);

  // A view picked by hand counts as looking for the open chat, so a later list cannot switch away from it. In the sheet the pick
  // also shuts the sheet and puts the list on screen.
  const pick = id => {
    revealed.current = current;
    choose(id);
    if (wide) return;
    toList();
    setSheet(false);
  };

  // The search picks a view, and a group in it when it found one. The chat on screen counts as looked for, so its row cannot switch the
  // view back, and `landing` has the list focus the group, or else the view's first group. Only a pick moves the focus.
  const show = (id, group = null) => {
    revealed.current = current;
    choose(id);
    if (!wide) { toList(); setSheet(false); }
    setLanding({ view: ix ? viewIn(ix, id) : id, group });
  };

  const toggle = () => {
    if (wide) setDocked(on => !on);
    else setSheet(on => !on);
  };

  return {
    view,
    pick,
    wide,
    open,
    box,
    opener,
    landing,
    show,
    close: () => setSheet(false),
    settle: () => setLanding(null),
    toggle,
    // Ctrl+B or Cmd+B. The column leaves the focus where it is, unless the focus is in the column as it closes, when it goes to the
    // button that opens it. The sheet opens and closes as its button does.
    flip: () => {
      if (wide && docked && box.current?.contains(document.activeElement)) opener.current?.focus();
      toggle();
    },
    elsewhere: !!ix && !open && othersWaiting(ix, view),
  };
}

const sidebar = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.75 4v12" stroke="currentColor" stroke-width="1.6"/></svg>`;

// The button at the left of the list's header. A dot on it says a chat in a view that is not on screen needs you.
export function ProjectsToggle({ projects }) {
  const { open, toggle, opener, elsewhere, wide } = projects;
  const mod = useModifier();
  return html`<button class="btn projects-toggle" data-variant="ghost" data-size="icon-sm" type="button" ref=${opener} aria-label="Projects" data-tip="Projects" data-tip-key=${keyHint(mod, 'B')}
    aria-haspopup=${wide ? null : 'dialog'} aria-expanded=${open} aria-controls=${open ? PANEL : null} aria-describedby=${elsewhere ? 'projectsElsewhere' : null} onClick=${toggle}>
    ${sidebar()}
    ${elsewhere ? html`<span class="dot" aria-hidden="true"></span><span class="sr" id="projectsElsewhere">A chat in another view needs you</span>` : null}
  </button>`;
}

const dots = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>`;

// A project's row also has its actions, `{ label, menu, open(anchor, point, entry) }`: the dots at its end, a right click, the menu key and
// a long press all open its menu. `menu` is the open menu while it is the row's. A menu asked for from the dots hangs from them, so Esc
// gives the focus back to the dots, and any other hangs from the row. `drop` is the target a carried group's header can be dropped on,
// when the row is one, and `over` whether it would land here now.
function Scope({ home, id, name, count, lamp, current, onPick, actions, drop, over }) {
  const trigger = actions && menuOpener((button, entry) => actions.open(button, null, entry));
  const asking = actions && contextOpener((area, point, from) => actions.open(from?.closest?.('.more') ?? area.querySelector('.scope'), point));
  return html`<li class=${actions ? 'has-more' : null} ...${asking}>
    <button class=${home ? 'scope home' : 'scope'} type="button" data-key=${id} aria-current=${current ? 'true' : null} data-menu=${actions?.menu ? 'true' : null} data-drop=${drop ?? null} data-over=${over || null} onClick=${onPick}>
      <span class="lamp" data-state=${lamp || 'idle'} aria-hidden="true"></span>
      <span class="scope-name">${name}</span>
      ${count === undefined ? null : html`<span class="badge scope-count">${count}</span>`}
      ${lamp ? html`<span class="sr">, ${STATE_LABEL[lamp]}</span>` : null}
    </button>
    ${actions ? html`<button class="more" type="button" aria-label=${actions.label} data-tip=${actions.label} aria-haspopup="menu" aria-expanded=${!!actions.menu}
      aria-controls=${actions.menu ? layerId(actions.menu.id) : null} data-state=${actions.menu ? 'open' : 'closed'} ...${trigger}>${dots()}</button>` : null}
  </li>`;
}

const plus = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

// `creating` is whether the New project form is open, and the list owns it. `onCreate(name, away)` resolves with the reason the server
// refused, or an empty string, and `away` is whether the focus left the box. `tree` is the list's handle on what a project's row shares
// with it: the menu and the rename form. A panel that closes with a form or the menu open ends it. `carry` is the group whose header is
// being dragged, if one is: its rows are targets then, except the view it is in.
export function ProjectsPanel({ ix, projects, tree, carry, creating, onNew, onCancel, onCreate }) {
  const { view, wide, open, box, opener, pick, close } = projects;
  const { renamingProject: renaming } = tree;
  const held = !!tree.shown?.rail;
  const [reason, setReason] = useState('');
  const toggle = useRef(null);
  const mod = useModifier();

  useEffect(() => {
    if (open) return;
    if (creating) onCancel();
    if (renaming) tree.cancelRename();
    if (held) tree.shut();
  }, [open, creating, renaming, held]);

  const choosing = (e, id) => {
    if (wide) e.currentTarget.focus();
    pick(id);
  };
  const begin = () => { setReason(''); onNew(); };
  const create = async (name, away) => {
    const problem = await onCreate(name, away);
    setReason(problem);
    return !problem;
  };

  // The arrows move between the buttons, and start at the view in use when none has the focus. A project's dots count as its row. A
  // key from the menu, or one the dots took to open it, is not for the walk.
  const key = e => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('input, textarea, form, .menu')) return;
    const stops = [...e.currentTarget.querySelectorAll('.scope, .new-project')];
    const start = Math.max(stops.indexOf(e.currentTarget.querySelector('[aria-current="true"]')), 0);
    const here = document.activeElement;
    const to = nextStop(stops.length, stops.indexOf(here.matches('.more') ? here.parentElement.querySelector('.scope') : here), e.key, start);
    if (to < 0) return;
    e.preventDefault();
    // focus() alone would put a stop that was out of view in the middle of the sidebar, so the sidebar scrolls only as far as its
    // nearest edge. The first stop takes it back to the top, where the title shows.
    stops[to].focus({ preventScroll: true });
    if (to === 0) e.currentTarget.scrollTop = 0;
    else stops[to].scrollIntoView({ block: 'nearest' });
  };

  const lamp = id => (ix ? lampOf(ix, id) : null);
  const targets = carry && ix ? new Set(viewTargets(ix.projects, view).map(t => t.id)) : null;
  const drops = id => {
    const to = MOVE + (id ?? '');
    return { drop: targets?.has(to) ? to : null, over: carry?.over === to };
  };
  const actions = p => ({
    label: `Actions for ${p.name}`,
    menu: held && tree.shown.key === p.id ? tree.shown : null,
    open: (anchor, point, entry) => tree.pop(p.id, tree.projectMenu(p), anchor, { point, entry, rail: true }),
  });
  const panel = html`<nav class="rail" id=${PANEL} ref=${box} aria-labelledby="projectsTitle" onKeyDown=${key}>
    <div class="rail-head">
      ${wide ? null : html`<button class="btn projects-toggle" data-variant="ghost" data-size="icon-sm" type="button" ref=${toggle} aria-label="Projects" data-tip="Projects" data-tip-key=${keyHint(mod, 'B')} aria-expanded="true" onClick=${close}>${sidebar()}</button>`}
      <h2 class="rail-title" id="projectsTitle">Projects</h2>
    </div>
    <ul class="scopes">
      <${Scope} key="home" home=${true} name="Home" lamp=${lamp(HOME_VIEW)} current=${view === HOME_VIEW} onPick=${e => choosing(e, HOME_VIEW)} ...${drops(null)} />
      <li class="scope-rule" aria-hidden="true"></li>
      ${(ix?.projects || []).map(p => (renaming === p.id
        ? html`<li key=${p.id}>${tree.renameForm(p)}</li>`
        : html`<${Scope} key=${p.id} id=${p.id} name=${p.name} count=${countOf(ix, p.id)} lamp=${lamp(p.id)} current=${view === p.id} onPick=${e => choosing(e, p.id)} actions=${actions(p)} ...${drops(p.id)} />`))}
      <li>${creating
        ? html`<${NameForm} label="New project" placeholder="New project" onSubmit=${create} onCancel=${onCancel} />`
        : html`<button class="scope new-project" type="button" disabled=${!ix} onClick=${begin}>${plus()}<span class="scope-name">New project</span></button>`}</li>
    </ul>
    <div role="status">${creating && reason ? html`<p class="problem">${reason}</p>` : null}</div>
    <${Menu} menu=${held ? tree.shown : null} onClose=${tree.shut} />
  </nav>`;
  if (wide) return open ? panel : null;

  // Esc leaves a half typed name first, as it does in the column, and then the sheet. The focus goes back to the button that opened
  // the sheet when that is on screen, and otherwise to where it was when the sheet opened, as over a chat.
  const dismiss = why => {
    if (why !== 'escape' || !(creating || renaming)) close();
    else if (creating) onCancel();
    else tree.cancelRename();
  };
  const opened = () => (opener.current?.getClientRects().length ? opener.current : null);
  return html`<${Dialog} open=${open} sheet="left" labelledBy="projectsTitle" initial=${toggle} restoreTo=${opened} onClose=${dismiss}>${panel}<//>`;
}
