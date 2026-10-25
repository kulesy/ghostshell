// The chat pane: header, transcript and the dock under it. It owns one chat controller for as long as it is on screen.
import { Approvals } from './approvals.js';
import { copyText } from './clipboard.js';
import { Composer } from './composer.js';
import { HOME } from './env.js';
import { folderName, settingsLine } from './format.js';
import { Holds } from './holds.js';
import { useDocumentTitle, useFields, useStore } from './hooks.js';
import { html, memo, useCallback, useEffect, useLayoutEffect, useRef } from './html.js';
import { draw, icons } from './menu.js';
import { Panel, useShownTab } from './panel.js';
import { toggleTab } from './panel-state.js';
import { runFromClick } from './run.js';
import { QuoteDock, useQuoting } from './quote.js';
import { createChat } from './session.js';
import { keyHint, shortcut } from './shortcuts.js';
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

// Its name carries the count and what waits on the owner, since the mark on it is colour alone.
function SubsButton({ ctrl }) {
  const ix = useStore(sessionIndex, s => s.ix);
  const shown = useShownTab(ctrl);
  const status = subsStatus(ix, ctrl.id);
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

// `kind` names the chat in place of its folder and branch, as a group's session does.
function ChatHead({ ctrl, kind }) {
  const { session, status, outside, terminal } = useFields(ctrl.store, 'session', 'status', 'outside', 'terminal');
  const draft = !!ctrl.draft;
  const subs = useStore(sessionIndex, s => subsOffered(s.ix, ctrl.id));
  const state = status?.state || 'idle';
  useDocumentTitle(draft ? 'New session · GhostShell' : session?.title ? `${session.title} · GhostShell` : 'GhostShell');
  const place = kind ? [kind] : session ? [folderName(session.cwd, HOME), session.branch, session.routine ? `${session.routine} routine` : ''] : [];
  const meta = draft
    ? 'Starts Claude Code in your home folder'
    : session ? [...place, settingsLine(status)].filter(Boolean).join('  ') : '';
  const lamp = html`<span class="lamp" id="chatLamp" data-state=${state === 'idle' && outside ? 'working' : state} aria-hidden="true"></span>`;
  return html`<header class="chat-head">
    <${Back} />
    <div class="chat-title">
      <h2 id="title">${draft ? 'New session' : session?.title || 'Session'}</h2>
      <p class="chat-meta" id="meta">${meta}</p>
    </div>
    ${terminal || subs ? html`<div class="chat-tools">${subs ? html`<${SubsButton} ctrl=${ctrl} />` : null}${terminal ? html`<${TerminalButton} ctrl=${ctrl} />` : null}${lamp}</div>` : lamp}
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
// `meta` stands in the header for the folder and branch, and `aside` is drawn between the header and the transcript. `aside` must be
// one element that follows a store of its own, because a new element on each render would redraw the whole chat.
export const ChatPane = memo(function ChatPane({ id, row, title, refreshIndex, meta, aside }) {
  const held = useRef(null);
  const pane = useRef(null);
  if (!held.current) held.current = createChat({ id, draft: id === null, row, refreshIndex });
  const ctrl = held.current;
  const named = useStore(ctrl.store, s => s.session?.title);
  const terminal = useStore(ctrl.store, s => s.terminal);
  const onBlock = useCallback(e => blockClick(ctrl, e), [ctrl]);
  const quoting = useQuoting(ctrl, pane);
  useLayoutEffect(() => {
    ctrl.open();
    return ctrl.close;
  }, [ctrl]);
  useLayoutEffect(() => {
    const { session } = ctrl.store.get();
    if (title && session && session.title !== title) ctrl.store.set({ session: { ...session, title } });
  }, [ctrl, title, named]);
  return html`<section class="session" id="session" ref=${pane} data-terminal=${terminal ? '' : undefined} onClick=${onBlock}>
    <${ChatHead} ctrl=${ctrl} kind=${meta} />
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
}, (a, b) => a.id === b.id && a.title === b.title && a.refreshIndex === b.refreshIndex && a.meta === b.meta && a.aside === b.aside);
