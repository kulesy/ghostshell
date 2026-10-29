// The chat pane: header, transcript and the dock under it. It owns one chat controller for as long as it is on screen.
import { Approvals } from './approvals.js';
import { ArchiveButton } from './chat-archive.js';
import { copyText } from './clipboard.js';
import { Composer } from './composer.js';
import { HOME } from './env.js';
import { folderName, settingsLine } from './format.js';
import { NameForm } from './forms.js';
import { Holds } from './holds.js';
import { useDocumentTitle, useFields, useStore } from './hooks.js';
import { html, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { draw, icons } from './menu.js';
import { Panel, useAgentsOffered, useShownTab } from './panel.js';
import { toggleTab } from './panel-state.js';
import { runFromClick } from './run.js';
import { QuoteDock, useQuoting } from './quote.js';
import { draftGroup, groupById } from './group-rules.js';
import { createChat } from './session.js';
import { keyHint, shortcut } from './shortcuts.js';
import { usePullNeeds, usePullStatus } from './pulls.js';
import { BOT } from './subagents.js';
import { subsButtonName, subsOffered, subsStatus } from './sub-panel-rules.js';
import { LIST_TREE, sessionIndex } from './subs.js';
import { runnableBlock } from './terminal-rules.js';
import { toast } from './toast.js';
import { Transcript } from './transcript.js';

export const Back = () => html`<a class="btn back" data-variant="ghost" data-size="sm" href="#/" aria-label="Back to sessions"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Sessions</a>`;

function TerminalButton({ ctrl }) {
  const shown = useShownTab(ctrl);
  return html`<button class="btn" id="terminalButton" type="button" data-variant="ghost" data-size="icon-sm" aria-label="Terminal" aria-expanded=${shown === 'terminal'} aria-controls="panel" data-tip="Terminal" data-tip-key=${keyHint('Ctrl', '`')} onClick=${e => toggleTab(ctrl.id, 'terminal', e.currentTarget, shown)}>${draw(icons.terminal, 'icon')}</button>`;
}

// Only where the chat has neither the terminal nor sub sessions, so a chat with helpers alone still has a way to its panel.
function AgentsButton({ ctrl }) {
  const shown = useShownTab(ctrl);
  return html`<button class="btn" id="agentsButton" type="button" data-variant="ghost" data-size="icon-sm" aria-label="Subagents" aria-expanded=${shown === 'agents'} aria-controls="panel" data-tip="Subagents" onClick=${e => toggleTab(ctrl.id, 'agents', e.currentTarget, shown)}>${draw(BOT, 'icon')}</button>`;
}

// Its name carries the count and what waits on the owner, since the mark on it is colour alone. It also asks for the pull requests of the
// sessions it counts, so that count is right with the panel closed.
function SubsButton({ ctrl }) {
  const ix = useStore(sessionIndex, s => s.ix);
  const shown = useShownTab(ctrl);
  usePullStatus(ix, ctrl.id);
  const status = subsStatus(ix, ctrl.id, undefined, usePullNeeds(ix));
  const name = subsButtonName(status);
  return html`<button class="btn" id="subsButton" type="button" data-variant="ghost" data-size="icon-sm" aria-label=${name} aria-expanded=${shown === 'subs'} aria-controls="panel" data-tip=${name} onClick=${e => toggleTab(ctrl.id, 'subs', e.currentTarget, shown)}>${draw(LIST_TREE, 'icon')}${status.needs ? html`<span class="subs-mark" aria-hidden="true"></span>` : null}</button>`;
}

// Ctrl+` shows the terminal, switches to it or closes the panel, as the Terminal button does. It has its own component so a tab change
// draws this and not the whole chat.
function PanelKeys({ ctrl }) {
  const shown = useShownTab(ctrl);
  const latest = useRef(shown);
  latest.current = shown;
  useEffect(() => {
    const onKey = e => {
      if (shortcut(e) !== 'terminal' || !ctrl.store.get().terminal) return;
      e.preventDefault();
      const here = document.activeElement;
      toggleTab(ctrl.id, 'terminal', here === document.body ? null : here, latest.current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ctrl]);
  return null;
}

// The choice lives in the address, so clearing it is a navigation. The typed text stays because the pane keeps its key.
function startOutside() {
  location.hash = '#/new';
  document.getElementById('text')?.focus();
}

// `kind` names the chat in place of its folder and branch, as a group's session does. `rename` is { label, max, save(text) } when the title
// can be renamed here, and `save` resolves { problem }.
function ChatHead({ ctrl, kind, rename }) {
  const [renaming, setRenaming] = useState(false);
  const pencil = useRef(null);
  const refocus = useRef(false);
  const { session, status, outside, terminal, group } = useFields(ctrl.store, 'session', 'status', 'outside', 'terminal', 'group');
  const draft = !!ctrl.draft;
  const groupName = useStore(sessionIndex, s => (draft && group ? groupById(s.ix, group)?.name ?? null : null));
  const subs = useStore(sessionIndex, s => subsOffered(s.ix, ctrl.id));
  const agents = useAgentsOffered(ctrl);
  const state = status?.state || 'idle';
  useDocumentTitle(draft ? 'New session · GhostShell' : session?.title ? `${session.title} · GhostShell` : 'GhostShell');
  const place = kind ? [kind] : session ? [folderName(session.cwd, HOME), session.branch, session.routine ? `${session.routine} routine` : ''] : [];
  const meta = draft
    ? 'Starts Claude Code in your home folder'
    : session ? [...place, settingsLine(status)].filter(Boolean).join('  ') : '';
  const title = draft ? 'New session' : session?.title || 'Session';
  const renamable = !!rename && !draft && !!session;
  const archivable = !draft && !kind && !!session;
  useLayoutEffect(() => { if (!renamable) setRenaming(false); }, [renamable]);
  useLayoutEffect(() => {
    if (!renaming && refocus.current) pencil.current?.focus({ preventScroll: true });
    refocus.current = false;
  }, [renaming]);
  const close = away => { refocus.current = !away; setRenaming(false); };
  const save = async (text, away) => {
    const { problem } = await rename.save(text);
    if (problem) toast(problem, { problem: true });
    else close(away);
    return !problem;
  };
  const lamp = html`<span class="lamp" id="chatLamp" data-state=${state === 'idle' && outside ? 'working' : state} aria-hidden="true"></span>`;
  return html`<header class="chat-head">
    <${Back} />
    <div class="chat-title">
      <div class="chat-name" data-rename=${renamable || null}>
        ${renaming
          ? html`<${NameForm} label=${rename.label} value=${title} max=${rename.max} onCancel=${close} onSubmit=${save} />`
          : html`<h2 id="title" onClick=${renamable ? () => setRenaming(true) : null}>${title}</h2>
            ${renamable ? html`<button class="btn chat-rename" type="button" data-variant="ghost" data-size="icon-xs" ref=${pencil} aria-label=${rename.label} data-tip=${rename.label} onClick=${() => setRenaming(true)}>${draw(icons.pencil, 'icon')}</button>` : null}`}
      </div>
      <p class="chat-meta" id="meta">${meta}</p>
      ${draft && groupName ? html`<span class="start-group">${draw(icons.folder, 'icon')}<span class="name">${groupName}</span><button class="btn" id="startOutside" type="button" data-variant="ghost" data-size="icon-xs" aria-label=${`Start outside ${groupName}`} data-tip="Start outside the group" onClick=${startOutside}>${draw(icons.x, 'icon')}</button></span>` : null}
    </div>
    ${archivable || terminal || subs || agents ? html`<div class="chat-tools">${archivable ? html`<${ArchiveButton} id=${ctrl.id} state=${state} title=${session.title} />` : null}${subs ? html`<${SubsButton} ctrl=${ctrl} />` : null}${agents && !subs && !terminal ? html`<${AgentsButton} ctrl=${ctrl} />` : null}${terminal ? html`<${TerminalButton} ctrl=${ctrl} />` : null}${lamp}</div>` : lamp}
  </header>`;
}

// Copy and Run on the code blocks of the chat's replies. Run reads the block's own text as the button is pressed, and only a real click
// on a finished reply runs anything. Nothing else on the page calls runFromClick with a block's text.
function blockClick(ctrl, e) {
  const button = e.target.closest?.('button[data-code]');
  const code = button?.closest('.code-block')?.querySelector('pre.code');
  if (!code) return;
  if (button.dataset.code === 'copy') {
    copyText(code.textContent).then(ok => toast(ok ? 'Copied to clipboard' : 'Could not copy the code', { problem: !ok, duration: 2000 }));
    return;
  }
  if (button.dataset.code !== 'run' || !e.isTrusted || button.getAttribute('aria-disabled') === 'true') return;
  // A file open in the panel is drawn like a reply but is not one, so its blocks have Copy only.
  if (!ctrl.store.get().terminal || !button.closest('.msg.claude:not(.live, .file-doc)')) return;
  const block = runnableBlock(code.dataset.lang, code.textContent);
  if (block && !block.hidden) runFromClick(ctrl.term, block.command, 'block', button);
}

function Notice({ ctrl }) {
  const text = useStore(ctrl.store, s => s.notice);
  return html`<p class="notice" id="notice" role="alert" hidden=${!text}>${text}</p>`;
}

// `row` is the list's entry for the session, which names it until the transcript answers. It is read once, so a
// fresh copy of the list never redraws the chat. Only `title`, which is passed apart, is followed, so a rename in the list reaches
// the header and the page title. The list's title wins over the chat's own, including one from a first page of messages that left
// the server before the rename.
// `rename` is what the header's pencil renames with, from chat-rename.js, or null for a chat that cannot be renamed there.
// `meta` stands in the header for the folder and branch, and `aside` is drawn between the header and the transcript. `aside` must be
// one element that follows a store of its own, because a new element on each render would redraw the whole chat.
export const ChatPane = memo(function ChatPane({ id, row, title, refreshIndex, meta, aside, group = null, rename }) {
  const held = useRef(null);
  const pane = useRef(null);
  if (!held.current) held.current = createChat({ id, draft: id === null, row, refreshIndex, toast });
  const ctrl = held.current;
  const named = useStore(ctrl.store, s => s.session?.title);
  const terminal = useStore(ctrl.store, s => s.terminal);
  const onBlock = useCallback(e => blockClick(ctrl, e), [ctrl]);
  const quoting = useQuoting(ctrl, pane);
  useLayoutEffect(() => {
    ctrl.open();
    return ctrl.close;
  }, [ctrl]);
  const startIn = useStore(sessionIndex, s => draftGroup(s.ix, group));
  useLayoutEffect(() => { if (ctrl.draft) ctrl.store.set({ group: startIn }); }, [ctrl, startIn]);
  useLayoutEffect(() => {
    const { session } = ctrl.store.get();
    if (title && session && session.title !== title) ctrl.store.set({ session: { ...session, title } });
  }, [ctrl, title, named]);
  return html`<section class="session" id="session" ref=${pane} data-terminal=${terminal ? '' : undefined} onClick=${onBlock}>
    <${ChatHead} ctrl=${ctrl} kind=${meta} rename=${rename} />
    ${aside}
    <${Transcript} ctrl=${ctrl} quoting=${quoting} />
    <div class="dock">
      <${QuoteDock} ctrl=${ctrl} quoting=${quoting} />
      <${Approvals} ctrl=${ctrl} place=${meta?.startsWith('Section') ? 'section' : 'group'} />
      <${Holds} ctrl=${ctrl} />
      <${Notice} ctrl=${ctrl} />
      <${Composer} ctrl=${ctrl} />
    </div>
    <${Panel} ctrl=${ctrl} />
    <${PanelKeys} ctrl=${ctrl} />
  </section>`;
}, (a, b) => a.id === b.id && a.title === b.title && a.refreshIndex === b.refreshIndex && a.meta === b.meta && a.aside === b.aside && a.group === b.group && a.rename === b.rename);
