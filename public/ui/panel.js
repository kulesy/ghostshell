// The side panel of a chat: the sub sessions under it, the subagents it started, its terminal and the file it has open, as tabs. It sits on the right of the chat when
// there is room for both, and covers the chat when there is not. Its look is in app.css, which reads the mode and width this file puts on the session.
import { backTo, closeFile, FileTab, useFile } from './file-view.js';
import { useStore } from './hooks.js';
import { html, memo, useCallback, useLayoutEffect, useRef, useState } from './html.js';
import { draw, icons } from './menu.js';
import { closeQuietly, hidePanel, openQuietly, panelOf, panels, selectTab, setPanelWidth, takeOrigin, takeWant } from './panel-state.js';
import { keyHint } from './shortcuts.js';
import { tabOffered } from './subagent-rules.js';
import { BOT, SubagentsTab } from './subagents.js';
import { subsOffered } from './sub-panel-rules.js';
import { LIST_TREE, sessionIndex, SubsTab } from './subs.js';
import { clampWidth, opensByDefault, PANEL, panelMode, panelName, panelTabs, TAB_LABEL, tabByKey, tabShown, widestPanel, widthByKey } from './terminal-rules.js';
import { TerminalTab } from './terminal.js';

const ICON = { subs: LIST_TREE, agents: BOT, terminal: icons.terminal, file: icons.file };

const fine = () => matchMedia('(pointer: fine)').matches;

const SubsPane = memo(SubsTab);
const AgentsPane = memo(SubagentsTab);
const TerminalPane = memo(TerminalTab);
const FilePane = memo(FileTab);

// Whether the chat has a Subagents tab: the server sends the list and the chat has had a helper.
export function useAgentsOffered(ctrl) {
  const features = useStore(sessionIndex, s => s.ix?.features ?? null);
  const agents = useStore(ctrl.store, s => s.agents);
  return tabOffered(features, agents);
}

// The tabs the chat's panel offers, and the file it has open. `ctrl.term` is null only for a new session, which never has a tab.
export function usePanelTabs(ctrl) {
  const subs = useStore(sessionIndex, s => subsOffered(s.ix, ctrl.id));
  const agents = useAgentsOffered(ctrl);
  const terminal = useStore(ctrl.store, s => s.terminal);
  const file = useFile(ctrl.id);
  return { tabs: panelTabs({ subs, agents, terminal, file: !!file }), file };
}

// The tab on show, or null while the panel is closed.
export function useShownTab(ctrl) {
  const { tabs } = usePanelTabs(ctrl);
  const state = useStore(panels, s => panelOf(s, ctrl.id));
  return state.open ? tabShown(state.tab, tabs) : null;
}

// Draws nothing until the chat's panel is open and offers a tab. It also opens the panel by itself on the Sub sessions tab for a chat that
// has sub sessions, while its panel has never been opened or closed and fits beside the chat. That is not saved, and it goes if the room does.
export function Panel({ ctrl }) {
  const id = ctrl.id;
  const { tabs, file } = usePanelTabs(ctrl);
  const state = useStore(panels, s => panelOf(s, id));
  const saved = useStore(panels, s => id in s.byId);
  const offered = tabs.includes('subs');
  useLayoutEffect(() => {
    const section = document.getElementById('session');
    const fit = () => {
      const mode = panelMode(section?.clientWidth || innerWidth);
      if (opensByDefault({ saved, offered, mode })) openQuietly(id, 'subs');
      else if (!offered || mode !== 'side') closeQuietly(id);
    };
    fit();
    if (!section) return undefined;
    const watch = new ResizeObserver(fit);
    watch.observe(section);
    return () => watch.disconnect();
  }, [id, saved, offered]);
  if (!state.open || !tabs.length) return null;
  return html`<${Shown} ctrl=${ctrl} tabs=${tabs} tab=${tabShown(state.tab, tabs)} file=${file} />`;
}

function Shown({ ctrl, tabs, tab, file }) {
  const id = ctrl.id;
  const root = useRef(null);
  const width = useStore(panels, s => s.width);
  const want = useStore(panels, s => s.want);
  const canClear = useStore(ctrl.term.store, s => s.runs.some(r => !r.running));
  const [span, setSpan] = useState(() => document.getElementById('session')?.clientWidth || innerWidth);
  const over = panelMode(span) === 'over';
  const shown = clampWidth(width, span);
  const widest = widestPanel(span);

  // The session lays itself out from what the panel puts on it, so the chat is not drawn again as the panel is dragged.
  useLayoutEffect(() => {
    const section = root.current.parentElement;
    const measure = () => setSpan(section.clientWidth);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(section);
    return () => watch.disconnect();
  }, []);

  useLayoutEffect(() => {
    const section = root.current.parentElement;
    section.dataset.panel = over ? 'over' : 'side';
    return () => { delete section.dataset.panel; };
  }, [over]);

  useLayoutEffect(() => {
    const section = root.current.parentElement;
    section.style.setProperty('--panel-w', `${shown}px`);
    return () => section.style.removeProperty('--panel-w');
  }, [shown]);

  // A panel that covers the chat takes the chat out of reach as well as out of sight. This must be declared before the focus
  // return below, because focus cannot go back to something that is still inert.
  useLayoutEffect(() => {
    if (!over) return undefined;
    const me = root.current;
    const section = me.parentElement;
    const apply = () => { for (const el of section.children) if (el !== me) el.inert = true; };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(section, { childList: true });
    return () => {
      watch.disconnect();
      for (const el of section.children) el.inert = false;
    };
  }, [over]);

  // Focus goes back to whatever opened the panel, but only when it was inside the panel as it closed.
  useLayoutEffect(() => {
    const me = root.current;
    return () => {
      const from = takeOrigin(id);
      if (!me.contains(document.activeElement)) return;
      (from?.isConnected ? from : document.getElementById('terminalButton') ?? document.getElementById('subsButton') ?? document.getElementById('agentsButton') ?? document.getElementById('text'))?.focus();
    };
  }, [id]);

  // The focus goes into the panel when a button or a shortcut opened it, and stays where it is when it is already in the panel.
  useLayoutEffect(() => {
    if (want?.id !== id) return;
    takeWant(id);
    const me = root.current;
    if (document.activeElement !== me && me.contains(document.activeElement)) return;
    const target = tab === 'terminal' ? (fine() ? me.querySelector('#term-input') : me) : tab === 'file' ? me.querySelector('.file-body') ?? me : me;
    target.focus({ preventScroll: true });
  }, [want]);

  // The panes get their handlers through a ref, so a drag, which draws this panel again and again, leaves them alone.
  const latest = useRef(null);
  latest.current = {
    leave: () => (over ? hidePanel(id) : document.getElementById('text')?.focus()),
    closeFile: () => {
      const link = backTo(file.from, file.path);
      closeFile();
      const back = ['terminal', 'subs', 'agents'].find(t => tabs.includes(t));
      if (back) selectTab(id, back);
      else hidePanel(id);
      (link ?? document.getElementById('text'))?.focus();
    },
  };
  const leave = useCallback(() => latest.current.leave(), []);
  const leaveFile = useCallback(() => latest.current.closeFile(), []);

  const onKeyDown = e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    leave();
  };

  const onTabKey = e => {
    const next = tabByKey(e.key, tab, tabs);
    if (!next) return;
    e.preventDefault();
    selectTab(id, next);
    root.current.querySelector(`#tab-${next}`)?.focus();
  };

  const onResizeKey = e => {
    const next = widthByKey(e.key, e.shiftKey, shown, span);
    if (next === null) return;
    e.preventDefault();
    setPanelWidth(next);
  };

  // The panel is on the right, so the edge is the distance from the session's right side to the pointer.
  const drag = e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const right = root.current.parentElement.getBoundingClientRect().right;
    const move = ev => setPanelWidth(clampWidth(right - ev.clientX, span), false);
    const end = ev => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      delete root.current?.dataset.dragging;
      setPanelWidth(panels.get().width);
    };
    handle.focus();
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    root.current.dataset.dragging = '';
  };

  return html`<section class="panel" id="panel" ref=${root} role=${over ? 'dialog' : 'region'} aria-modal=${over ? 'true' : undefined} aria-label=${panelName(tabs)} tabindex="-1" onKeyDown=${onKeyDown}>
    ${over ? null : html`<div class="panel-resize" role="separator" aria-orientation="vertical" aria-label="Resize panel" aria-valuemin=${PANEL.min} aria-valuemax=${widest} aria-valuenow=${shown} tabindex="0" onKeyDown=${onResizeKey} onPointerDown=${drag}></div>`}
    <div class="panel-head">
      <div class="panel-tabs" role="tablist" aria-label="Panel">
        ${tabs.map(t => html`<button class="panel-tab" type="button" role="tab" id=${`tab-${t}`} aria-selected=${t === tab} aria-controls=${`pane-${t}`} tabindex=${t === tab ? 0 : -1} onClick=${() => selectTab(id, t)} onKeyDown=${onTabKey}>${draw(ICON[t], 'icon')}${TAB_LABEL[t]}</button>`)}
      </div>
      <div class="panel-tools">
        ${tab === 'terminal' ? html`<button class="btn" type="button" data-variant="ghost" data-size="icon-sm" aria-label="Clear finished commands" data-tip="Clear finished commands" disabled=${!canClear} onClick=${() => ctrl.term.clear()}>${draw(icons.trash, 'icon')}</button>` : null}
        <button class="btn" type="button" data-variant="ghost" data-size="icon-sm" aria-label="Close panel" data-tip="Close panel" data-tip-key=${tabs.includes('terminal') ? keyHint('Ctrl', '`') : undefined} onClick=${() => hidePanel(id)}>${draw(icons.x, 'icon')}</button>
      </div>
    </div>
    ${tabs.includes('subs') ? html`<div class="panel-pane" role="tabpanel" id="pane-subs" aria-labelledby="tab-subs" hidden=${tab !== 'subs'}><${SubsPane} ctrl=${ctrl} active=${tab === 'subs'} /></div>` : null}
    ${tabs.includes('agents') ? html`<div class="panel-pane" role="tabpanel" id="pane-agents" aria-labelledby="tab-agents" hidden=${tab !== 'agents'}><${AgentsPane} ctrl=${ctrl} active=${tab === 'agents'} /></div>` : null}
    ${tabs.includes('terminal') ? html`<div class="panel-pane" role="tabpanel" id="pane-terminal" aria-labelledby="tab-terminal" hidden=${tab !== 'terminal'}><${TerminalPane} ctrl=${ctrl} active=${tab === 'terminal'} onLeave=${leave} /></div>` : null}
    ${file ? html`<div class="panel-pane" role="tabpanel" id="pane-file" aria-labelledby="tab-file" hidden=${tab !== 'file'}><${FilePane} file=${file} onClose=${leaveFile} /></div>` : null}
  </section>`;
}
