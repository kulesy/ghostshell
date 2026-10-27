import { md } from '../md.mjs';
import { BangRuns } from './bash.js';
import { closeFile, openFile } from './file-view.js';
import { duration, tokenCount } from './format.js';
import { threadImages } from './gallery.js';
import { html, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from './html.js';
import { gapBelow, NEAR_END, useClock, useFields, usePin, useStick, useStore } from './hooks.js';
import { linksOn, useLinkPreviews } from './links.js';
import { loadingView } from './load-rules.js';
import { QuoteFloat } from './quote.js';
import { isChip, Row, Thought } from './rows.js';
import { Shell } from './shell.js';
import { sessionIndex } from './subs.js';
import { display, doingNow } from './thread.js';
import { closeViewer, openViewer } from './viewer.js';
import { DEFAULT_TEXT, hasRow, HOLD_MS, nextHold, ROTATE_MS, waitText } from './widget-wait.js';

// Claude's thinking as it is written. It is open while it grows and folds once the block ends.
function LiveThink({ think }) {
  const body = useRef(null);
  const pin = usePin(body);
  useStick(body, pin);
  return html`<div class="live-think"><div class="think"><${Thought} text=${think.text} name=${think.done ? 'Thought' : 'Thinking'} open=${!think.done} bodyRef=${body} /></div></div>`;
}

const OWN_TITLE = 'Time since the turn began, and the tokens in the replies Claude has finished this turn. The count moves when a reply ends, not while it is written.';
const OUTSIDE_TITLE = 'Another app runs this chat, so GhostShell reads the time and tokens from its transcript. They move when a step is saved.';

// Whose turn is on screen: Capcom's own while it works, else one another app is running in a chat Capcom is not working on.
function turnOf({ status, outside }) {
  const state = status?.state || 'idle';
  return state === 'working' ? 'own' : state === 'idle' && outside ? 'outside' : '';
}

// How long the turn has run, the tokens of the replies Claude has finished, and what it is doing now, after the lamps that run.
function Working({ work, since, on, outside, names }) {
  useClock(on, since);
  const text = [work && duration(Date.now() - since), work?.tokens > 0 && `${tokenCount(work.tokens)} tokens`, doingNow(work, names)].filter(Boolean).join(' · ');
  return html`<p class="working" id="working" hidden=${!on}><span class="chaser" aria-hidden="true"><span></span><span></span><span></span></span><${Shell} class="shell-spin" />
    <span class="working-text" id="workingText" title=${outside ? OUTSIDE_TITLE : OWN_TITLE}>${text}</span></p>`;
}

// The phrases Claude sent with the widget call, one after another, where the widget will draw. A different call gets a new one.
function WidgetPlaceholder({ loading }) {
  const [step, setStep] = useState(0);
  const rotates = loading.length > 1;
  useEffect(() => {
    if (!rotates) return undefined;
    const timer = setInterval(() => setStep(n => n + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotates]);
  return html`<div class="widget-wait" aria-hidden="true"><span class="widget-wait-text" key=${step}>${waitText(loading, step)}</span></div>`;
}

// Holds a place for a widget from the moment Claude starts writing it until its row is in the thread. The phrases are for the eye: a
// screen reader hears one status line when the place appears, and is not read every change of phrase.
function WidgetWait({ ctrl, work }) {
  const items = useStore(ctrl.store, s => s.items);
  const held = useRef(null);
  const [, recheck] = useReducer(n => n + 1, 0);
  held.current = nextHold({ held: held.current, tools: work?.tools, inThread: id => hasRow(items, id), now: Date.now() });
  const place = held.current;
  // Nothing else draws the page again when the hold runs out, so a timer does.
  useEffect(() => {
    if (place?.since == null) return undefined;
    const timer = setTimeout(recheck, Math.max(0, HOLD_MS - (Date.now() - place.since)) + 20);
    return () => clearTimeout(timer);
  }, [place?.id, place?.since]);
  return html`<p class="sr" role="status">${place ? DEFAULT_TEXT : ''}</p>
    ${place ? html`<${WidgetPlaceholder} key=${place.id} loading=${place.loading} />` : null}`;
}

// The thinking and the reply as they are written, the place held for a widget, and the line that says what Claude is doing.
function Live({ ctrl, box, pin, fileUrl }) {
  const { live, think, work, turnStart, outside, outsideStart } = useFields(ctrl.store, 'live', 'think', 'work', 'turnStart', 'outside', 'outsideStart');
  const turn = useStore(ctrl.store, turnOf);
  const names = useStore(ctrl.store, s => s.session?.connectors);
  const other = turn === 'outside';
  useStick(box, pin);
  return html`${think ? html`<${LiveThink} key=${think.id} think=${think} />` : null}
    <div class="msg claude live" id="live" hidden=${!live} dangerouslySetInnerHTML=${{ __html: live ? md(live, fileUrl) : '' }}></div>
    <${WidgetWait} ctrl=${ctrl} work=${work} />
    <${Working} work=${other ? outside : work} since=${other ? outsideStart : turnStart} on=${!!turn} outside=${other} names=${names} />`;
}

export function Transcript({ ctrl, quoting }) {
  const box = useRef(null);
  const fromBottom = useRef(0);
  const { items, chips, sending, hasEarlier, loadingEarlier, loaded, failed, jump, earlierSeq, session, fileLinks, terminal } = useFields(
    ctrl.store, 'items', 'chips', 'sending', 'hasEarlier', 'loadingEarlier', 'loaded', 'failed', 'jump', 'earlierSeq', 'session', 'fileLinks', 'terminal',
  );
  // Until the server says it serves linked files, a path in a reply stays text.
  const fileUrl = fileLinks ? ctrl.fileUrl : null;
  const rows = useMemo(() => display(items), [items]);
  const turn = useStore(ctrl.store, turnOf);
  const [away, setAway] = useState(false);
  const pin = usePin(box);
  useLinkPreviews(box, useStore(sessionIndex, s => linksOn(s.ix)));
  // A late picture or a docked card grows the box with no scroll event, so a resize pins a pinned box and checks the gap once a frame.
  useEffect(() => {
    const el = box.current;
    const check = () => setAway(gapBelow(el) > NEAR_END);
    let frame = 0;
    const resized = new ResizeObserver(() => {
      if (pin.current) el.scrollTop = el.scrollHeight;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    });
    el.addEventListener('scroll', check, { passive: true });
    resized.observe(el);
    resized.observe(el.querySelector('#items'));
    return () => {
      el.removeEventListener('scroll', check);
      resized.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  // Opening a session and sending a message both end at the bottom; loading earlier keeps what you were looking at.
  useLayoutEffect(() => {
    if (!loaded && !jump) return;
    pin.current = true;
    box.current.scrollTop = box.current.scrollHeight;
  }, [loaded, jump]);
  useLayoutEffect(() => { if (earlierSeq) box.current.scrollTop = box.current.scrollHeight - fromBottom.current; }, [earlierSeq]);

  const loadEarlier = () => {
    fromBottom.current = box.current.scrollHeight - box.current.scrollTop;
    ctrl.loadEarlier();
  };

  const toEnd = () => {
    pin.current = true;
    box.current.scrollTo({ top: box.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  // The viewer steps through the pictures the thread holds when one is clicked, and back through those of the unloaded messages, which the server lists. It closes with the chat.
  const viewImage = useCallback((key, from) => {
    const names = () => ctrl.store.get().session?.connectors;
    const thread = () => {
      const { items: saved, sending: unsent } = ctrl.store.get();
      return threadImages(saved, unsent, ctrl.imageUrl, names());
    };
    const images = thread();
    const earlier = ctrl.store.get().hasEarlier ? ctrl.earlierImages().then(list => threadImages(list, [], ctrl.imageUrl, names())) : null;
    openViewer(images, Math.max(0, images.findIndex(i => i.key === key)), from, thread, earlier);
  }, [ctrl]);
  useEffect(() => closeViewer, []);

  // A plain click on a file link opens it here. A click with a modifier is left to the browser, so it opens the file in a new tab or window.
  const openLink = e => {
    const link = e.target.closest?.('a[data-file]');
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openFile({ id: ctrl.id, path: link.dataset.file, line: link.dataset.line ? Number(link.dataset.line) : null, from: link });
  };
  useEffect(() => closeFile, []);

  // A message still on its way into the thread begins the next turn, so the group above it belongs to the last one.
  const live = !!turn && !sending.length;
  const view = loadingView({ draft: !!ctrl.draft, loaded, failed, sending: !!sending.length });
  return html`<div class="scroller">
    <div class="transcript" id="transcript" ref=${box} role="region" aria-label="Messages" tabindex="0" onClick=${openLink}>
      ${ctrl.draft ? html`<p class="new-hint" id="newHint">Say what Claude should do. Your first message starts the session.</p>` : null}
      ${view === 'loading' ? html`<div class="load-state" role="status"><svg class="load-spin" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2"/><path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><${Shell} class="shell-spin" /><p>Opening this chat</p></div>` : null}
      ${view === 'failed' ? html`<div class="load-state" role="alert"><p>Could not open this chat.</p><button class="btn" data-variant="outline" type="button" onClick=${ctrl.retry}>Try again</button></div>` : null}
      <button class="btn earlier" data-variant="outline" id="earlier" type="button" hidden=${!hasEarlier} disabled=${loadingEarlier} onClick=${loadEarlier}>Load earlier</button>
      <ol class="items" id="items">
        ${rows.map((i, n) => html`<${Row} key=${i.key} item=${i} chip=${isChip(i) ? chips.get(i.id) : undefined} cwd=${isChip(i) ? session?.cwd : undefined} onChip=${ctrl.chip} imageUrl=${ctrl.imageUrl} onImage=${viewImage} connectors=${session?.connectors} onPrompt=${ctrl.prompt} running=${live && n === rows.length - 1 && i.kind === 'group'} fileUrl=${fileUrl} term=${ctrl.term} terminal=${terminal} />`)}
        ${ctrl.term ? html`<${BangRuns} ctrl=${ctrl} items=${items} hasEarlier=${hasEarlier} />` : null}
        ${sending.map((m, n) => html`<${Row} key=${`sending${n}`} item=${{ kind: 'user', text: m.text, images: m.images, files: m.files, sending: true }} onImage=${viewImage} />`)}
      </ol>
      <${Live} ctrl=${ctrl} box=${box} pin=${pin} fileUrl=${fileUrl} />
      <${QuoteFloat} ctrl=${ctrl} quoting=${quoting} />
    </div>
    <button class="btn scroll-end" data-variant="outline" data-size="icon-sm" data-active=${away} type="button" inert=${!away} aria-label="Scroll to end" data-tip="Scroll to end" onClick=${toEnd}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4v11.5M5 10.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>`;
}
