// A widget is HTML or SVG that Claude wrote, shown in a sandboxed frame. This file keeps the frames, answers what they send, and
// asks the owner first when a frame wants something the owner did not click.
import { escapeCancels } from './forms.js';
import { html, memo, useLayoutEffect, useMemo, useRef, useState } from './html.js';
import { clampHeight, frameDoc, humanTitle, isCard, linkGate, linkTarget, parseGlyphs, promptGate, viewBoxRatio } from './widget-frame.js';

const FAILED = 'That did not send. Try again, or cancel.';
const CONFIRM_DELAY_MS = 600;
// A report another frame posted for the same click may still be in flight when a prompt arrives, so the page waits before it decides.
const SETTLE_MS = 50;

// Every frame on the page, by its window. The frame's script is not trusted, so a message counts only when its source is one of these.
// `acted` is when the frame last reported a click or key press of the owner's, by this page's clock.
const frames = new Map();

// When the owner last used the page itself. A click inside a frame never reaches this page, so a frame reports its own. A touch that
// turns into a scroll ends in pointercancel, so only a tap counts.
// NOTE: [19 Oct 2026] EK - Leaving a scroll out is safe only because the browser drops the activation when a touch is cancelled (tried
// in Chromium 151). An engine that kept it would let a widget that takes the focus send after a scroll.
let pageActed = 0;
const ACTIVATING = {
  pointerdown: e => e.pointerType === 'mouse',
  pointerup: e => e.pointerType !== 'mouse',
  click: () => true,
  keydown: () => true,
};
for (const [type, counts] of Object.entries(ACTIVATING)) {
  window.addEventListener(type, e => { if (e.isTrusted && counts(e)) pageActed = Date.now(); }, true);
}

function othersActed(win) {
  let latest = 0;
  for (const [other, frame] of frames) if (other !== win && frame.acted > latest) latest = frame.acted;
  return latest;
}

const dark = matchMedia('(prefers-color-scheme: dark)');
const modeNow = () => (dark.matches ? 'dark' : 'light');
const tell = (win, kind, fields) => win.postMessage({ capcom: kind, ...fields }, '*');

window.addEventListener('message', e => {
  const frame = frames.get(e.source);
  const m = e.data;
  if (!frame || !m || typeof m !== 'object') return;
  if (m.capcom === 'height') frame.height(m.h);
  else if (m.capcom === 'tabbable') frame.tabbable(m.yes === true);
  else if (m.capcom === 'prompt') frame.prompt(m.text);
  else if (m.capcom === 'link') frame.link(m.url);
  else if (m.capcom === 'acted') frame.acted = Date.now();
});

dark.addEventListener('change', () => {
  for (const win of frames.keys()) tell(win, 'mode', { mode: modeNow() });
});

// The icon font and its names are fetched once, when the first widget that uses an icon loads. If either fails, the icons stay blank
// and the next widget to ask tries again.
let icons = null;
function loadIcons() {
  const get = (name, read) => fetch(new URL(`../vendor/${name}`, import.meta.url)).then(r => (r.ok ? read(r) : Promise.reject(new Error(String(r.status)))));
  icons ||= Promise.all([get('tabler-icons.woff2', r => r.arrayBuffer()), get('tabler-icons.min.css', r => r.text())])
    .then(([font, css]) => ({ font, glyphs: parseGlyphs(css) }), () => { icons = null; return null; });
  return icons;
}

const long = text => text.length > 240 || text.split('\n').length > 4;

// What a widget asked for without a click of the owner's. Nothing happens until the owner presses the button, and not in the first
// moments after the bar appears, so a tap meant for something else cannot land on it.
function Ask({ request, onConfirm, onCancel }) {
  const shownAt = useRef(performance.now());
  const [armed, setArmed] = useState(false);
  const [wide, setWide] = useState(false);
  const link = request.kind === 'link';
  const shown = link ? request.url : request.text;
  useLayoutEffect(() => {
    shownAt.current = performance.now();
    setArmed(false);
    const id = setTimeout(() => setArmed(true), CONFIRM_DELAY_MS);
    return () => clearTimeout(id);
  }, [request.error]);
  const confirm = () => {
    if (request.working || performance.now() - shownAt.current < CONFIRM_DELAY_MS) return;
    onConfirm();
  };
  return html`<div class="widget-ask" role="group" aria-label="Request from the widget" onKeyDown=${escapeCancels(onCancel)}>
    <p class="widget-ask-kind">${link ? 'A widget wants to open a link' : 'A widget wants to send this to Claude'}</p>
    ${link ? html`<p class="widget-ask-host">${request.host}</p>` : null}
    <p class=${link ? 'widget-ask-url' : 'widget-ask-text'} data-open=${wide ? '' : null}>${shown}</p>
    ${long(shown) ? html`<button class="btn" data-variant="ghost" data-size="xs" type="button" aria-expanded=${wide} onClick=${() => setWide(!wide)}>${wide ? 'Show less' : 'Show all'}</button>` : null}
    ${request.error ? html`<p class="widget-ask-error" role="alert">${request.error}</p>` : null}
    <div class="widget-ask-actions">
      <button class="btn" type="button" data-ask="confirm" aria-disabled=${!armed || !!request.working} onClick=${confirm}>${link ? 'Open link' : 'Send'}</button>
      <button class="btn" data-variant="outline" type="button" data-ask="cancel" onClick=${onCancel}>Cancel</button>
    </div></div>`;
}

// The frame's srcdoc only changes if the code does, so a tool result arriving later never reloads a running widget, and a change of
// theme never does either: the mode goes into the document when it is built and later changes are sent to the frame as a message.
export const Widget = memo(function Widget({ t, onPrompt }) {
  const code = t.input?.widget_code || '';
  const card = isCard(code);
  const ratio = useMemo(() => viewBoxRatio(code), [code]);
  const doc = useMemo(() => frameDoc(code, { mode: modeNow(), card }), [code, card]);
  const frame = useRef(null);
  const li = useRef(null);
  const [height, setHeight] = useState(0);
  // A frame stays a tab stop until it says it holds nothing to focus, so one that never says keeps its controls in reach.
  const [tabbable, setTabbable] = useState(true);
  const [closed, setClosed] = useState(false);
  const [request, setRequest] = useState(null);
  const asking = useRef(null);
  const lastSent = useRef(0);
  const lastOpened = useRef(0);
  const loads = useRef(0);
  const loaded = useRef(doc);
  const alive = useRef(true);
  const latest = useRef(null);
  latest.current = { onPrompt, code };
  // A new document is a new first load.
  if (loaded.current !== doc) { loaded.current = doc; loads.current = 0; }

  const show = next => {
    asking.current = next;
    if (alive.current) setRequest(next);
  };
  const close = () => {
    const holdsFocus = li.current?.contains(document.activeElement) && document.activeElement?.closest('.widget-ask');
    show(null);
    if (holdsFocus) frame.current?.focus();
  };
  const send = async text => {
    try {
      return (await latest.current.onPrompt?.(text)) === true;
    } catch (err) {
      return false;
    }
  };
  const confirm = async () => {
    const r = asking.current;
    if (!r || r.working) return;
    if (r.kind === 'link') {
      window.open(r.url, '_blank', 'noopener,noreferrer');
      close();
      return;
    }
    show({ ...r, working: true, error: '' });
    if (await send(r.text)) {
      lastSent.current = Date.now();
      close();
    } else {
      show({ ...r, working: false, error: FAILED });
    }
  };

  // A layout effect, so the frame is known before it can send its first message.
  useLayoutEffect(() => {
    const win = frame.current.contentWindow;
    alive.current = true;
    const ask = next => { if (!asking.current) show(next); };
    const decide = text => {
      if (!alive.current || !frames.has(win)) return;
      const now = Date.now();
      const verdict = promptGate({
        text, active: navigator.userActivation?.isActive, focused: document.activeElement === frame.current,
        now, last: lastSent.current, pending: !!asking.current, pageActed, othersActed: othersActed(win),
      });
      if (verdict === 'ask') ask({ kind: 'prompt', text });
      if (verdict !== 'send') return;
      lastSent.current = now;
      send(text).then(sent => { if (!sent) ask({ kind: 'prompt', text, error: FAILED }); });
    };
    const follow = url => {
      const target = linkTarget(url);
      if (!target || !alive.current || !frames.has(win)) return;
      const now = Date.now();
      const verdict = linkGate({
        active: navigator.userActivation?.isActive, focused: document.activeElement === frame.current,
        now, last: lastOpened.current, pageActed, othersActed: othersActed(win),
      });
      if (verdict === 'ask') return ask({ kind: 'link', url: target, host: new URL(target).hostname });
      lastOpened.current = now;
      window.open(target, '_blank', 'noopener,noreferrer');
    };
    frames.set(win, {
      acted: 0,
      height: h => { const px = clampHeight(h); if (px !== null) setHeight(px); },
      tabbable: yes => { if (alive.current) setTabbable(yes); },
      prompt: text => { setTimeout(decide, SETTLE_MS, text); },
      link: url => { setTimeout(follow, SETTLE_MS, url); },
    });
    return () => { alive.current = false; frames.delete(win); };
  }, []);

  // The first load is the widget's document. A second one means the widget navigated its own frame somewhere, so the frame goes.
  const onLoad = () => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    if (++loads.current > 1) {
      frames.delete(win);
      show(null);
      setClosed(true);
      return;
    }
    tell(win, 'mode', { mode: modeNow() });
    if (latest.current.code.includes('ti-')) loadIcons().then(font => { if (font && frames.has(win)) tell(win, 'icons', font); });
  };

  if (closed) return html`<li class="widget"><p class="widget-note">This widget tried to open another page, so GhostShell closed it.</p></li>`;
  // Until the page in the frame has measured itself, an SVG card holds the place its picture will take.
  const style = height ? { height: `${height}px` } : ratio ? { height: 'auto', aspectRatio: `${ratio.width} / ${ratio.height}` } : undefined;
  const note = request ? (request.kind === 'link' ? 'A widget wants to open a link. Choose Open link or Cancel.' : 'A widget wants to send a message. Choose Send or Cancel.') : '';
  return html`<li class="widget" ref=${li}>
    <iframe ref=${frame} class=${card ? 'card' : undefined} sandbox="allow-scripts" title=${humanTitle(t.input?.title)} tabindex=${tabbable ? null : -1} srcdoc=${doc} style=${style} onLoad=${onLoad}></iframe>
    ${request ? html`<${Ask} request=${request} onConfirm=${confirm} onCancel=${close} />` : null}
    <p class="sr" role="status">${note}</p></li>`;
});
