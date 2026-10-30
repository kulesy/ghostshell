// The rows of the transcript. Each is memoised, so a row draws again only when its own item changes.
import { md } from '../md.mjs';
import { BashItem } from './bash.js';
import { HOME } from './env.js';
import { clip, duration, lf, modelLabel, pre, preview, serverLabel, tilde, toolLabel } from './format.js';
import { FileCard } from './file-card.js';
import { fromTool, imageKey, overflow, TILES, tileLabel, toolShots } from './gallery.js';
import { Fragment, html, memo, useLayoutEffect, useReducer, useRef, useState } from './html.js';
import { useClock } from './hooks.js';
import { draw, icons } from './menu.js';
import { effortName, modelName } from './model-rules.js';
import { splitQuotes } from './quote-rules.js';
import { groupStart, step, summarize } from './thread.js';
import { Widget } from './widget.js';

const STATUS_LABEL = { pending: 'running', ok: 'ok', failed: 'failed', denied: 'denied' };

// A folded group shows its rows' pictures too, so they need no opening to see. CSS hides the group's copy while it is open,
// because the rows then show their own.
function ToolPictures({ shots, url, onOpen }) {
  if (!shots.length) return null;
  const more = overflow(shots.length);
  return html`<div class="shots">${shots.slice(0, TILES).map(({ img, source }, n) => {
    const key = imageKey(img);
    const last = more > 0 && n === TILES - 1;
    // NOTE: [17 Oct 2026] EK - Keep loading before src. Preact sets props in template order and WebKit fetches the moment src is set.
    return html`<button class=${last ? 'thumb more' : 'thumb'} type="button" key=${key} data-image=${key} aria-haspopup="dialog" aria-label=${tileLabel(n, shots.length, source)} onClick=${e => onOpen(key, e.currentTarget)}>
      <img loading="lazy" src=${url(img.ref)} alt=${fromTool(source)} />${last ? html`<span class="more-count" aria-hidden="true">+${more}</span>` : null}</button>`;
  })}</div>`;
}

const ToolRow = memo(function ToolRow({ t, imageUrl, onImage, connectors }) {
  const input = pre(t.name === 'Bash' ? t.input?.command || '' : JSON.stringify(t.input ?? {}, null, 2));
  const server = serverLabel(t.name, connectors);
  return html`<li class="tool" data-status=${t.status}><details data-k=${t.id}><summary><span class="tool-name">${server ? html`<span class="tool-server">${server}</span> ` : null}${toolLabel(t.name)}</span><span class="tool-sum">${t.summary || ''}</span><span class="tool-status">${STATUS_LABEL[t.status] || t.status}</span></summary>
    <pre class="tool-io">${input}</pre>${t.output ? html`<pre class="tool-io">${pre(t.output)}</pre>` : null}</details>
    <${ToolPictures} shots=${toolShots([t], connectors)} url=${imageUrl} onOpen=${onImage} /></li>`;
});

const SystemNotice = memo(function SystemNotice({ n }) {
  return html`<li class="system"><span class="lamp" data-state=${n.state || ''}></span>
    <div>
      <p class="system-title">${n.title}</p>
      ${n.text ? html`<p class="system-text">${lf(n.text)}</p>` : null}
      ${n.output ? html`<pre class="tool-io">${pre(n.output)}</pre>` : null}
      ${n.details.length ? html`<details><summary><span class="system-more">Details</span></summary>
        <dl class="system-details">${n.details.map((d, k) => html`<${Fragment} key=${k}><dt>${d.label}</dt><dd>${lf(d.value)}</dd><//>`)}</dl></details>` : null}
    </div></li>`;
});

const sameRows = (a, b) => a.length === b.length && a.every((t, n) => t === b[n]);

// One block of thinking: the start of it on the summary line, and all of it under that.
export function Thought({ text, name, open, bodyRef, fileUrl }) {
  return html`<details open=${open}><summary><span class="think-name">${name}</span><span class="think-sum">${preview(text)}</span></summary>
    <div class="think-text" ref=${bodyRef} dangerouslySetInnerHTML=${{ __html: md(text, fileUrl) }}></div></details>`;
}

const ThinkRow = memo(function ThinkRow({ t, fileUrl }) {
  return html`<li class="think"><${Thought} text=${t.text} name="Thought" fileUrl=${fileUrl} /></li>`;
});

// Shows a text and, when it changes, fades the old one out above the new one, which fades in. The old text sits out of flow so a
// longer one never holds the row's height, and it goes when its animation ends. The first text appears with no fade, and nor does
// one that replaces another while `fade` is off. Two at most wait to go, because with reduced motion no animation ends to take them away.
function Swap({ text, fade = true }) {
  const [, redraw] = useReducer(n => n + 1, 0);
  const held = useRef({ text, count: 0, fading: [] });
  const h = held.current;
  if (h.text !== text) {
    if (fade) h.fading = [...h.fading, { id: ++h.count, text: h.text }].slice(-2);
    h.text = text;
  }
  const drop = id => { h.fading = h.fading.filter(f => f.id !== id); redraw(); };
  return html`<span class="swap"><span class=${h.count ? 'swap-in' : ''} key=${h.count}>${text}</span>${h.fading.map(f => html`<span class="swap-out" key=${`out${f.id}`} aria-hidden="true" onAnimationEnd=${() => drop(f.id)}>${f.text}</span>`)}</span>`;
}

// A running group says which step it is on and how long it has been going, in place of what it did, and its chevron gives way to the
// moving lamps. Anything else about it is as when it is finished. The step fades in over the step before it and the summary over the
// last step, but not over the summary the group showed before it was known to be running: a chat opens on its rows before its
// status arrives, and that summary would flash and fade for no reason.
const ToolGroup = memo(function ToolGroup({ rows, imageUrl, onImage, connectors, running, fileUrl }) {
  const g = summarize(rows);
  const began = running ? groupStart(rows) : null;
  useClock(began !== null, began);
  const was = useRef(running);
  const starting = running && !was.current;
  was.current = running;
  return html`<li class="tool-group" data-status=${g.status} data-running=${running ? '' : undefined}><details data-k=${`g:${rows[0].key}`}><summary><span class="group-sum">${running ? html`<span class="step-lamps" aria-hidden="true"><span></span><span></span><span></span><span></span></span>` : null}<${Swap} text=${running ? step(rows, connectors) : g.title} fade=${!starting} /></span>
    <span class="group-meta">${g.edited ? html`<span class="add">+${g.added}</span> <span class="del">-${g.removed}</span>` : null}<span class="tool-status">${began === null ? g.note : duration(Date.now() - began)}</span></span></summary>
    <ul class="group-tools">${rows.map(r => (r.kind === 'thinking' ? html`<${ThinkRow} key=${r.key} t=${r} fileUrl=${fileUrl} />` : html`<${ToolRow} key=${r.key} t=${r} imageUrl=${imageUrl} onImage=${onImage} connectors=${connectors} />`))}</ul></details>
    <${ToolPictures} shots=${toolShots(rows, connectors)} url=${imageUrl} onOpen=${onImage} /></li>`;
}, (a, b) => a.imageUrl === b.imageUrl && a.onImage === b.onImage && a.connectors === b.connectors && a.running === b.running && a.fileUrl === b.fileUrl && sameRows(a.rows, b.rows));

// A chip from Capcom's own tool or from Desktop's, so chips in resumed Desktop sessions can be started here too.
function ChipCard({ t, chip, cwd, onChip }) {
  const [busy, setBusy] = useState('');
  const i = t.input || {};
  const status = chip?.status || 'open';
  const folder = chip?.cwd || i.cwd || cwd || '';
  const model = chip?.model || i.model;
  const effort = chip?.effort || i.effort;
  const act = async action => {
    setBusy(action);
    if (!(await onChip(action, t, folder))) setBusy('');
  };
  const actions = status === 'started'
    ? html`<a class="btn" data-variant="outline" href=${`#/s/${encodeURIComponent(chip.startedId)}`}>Open the session</a>`
    : status === 'dismissed'
      ? html`<span class="quiet">Dismissed</span>`
      : html`<button class="btn" type="button" data-chip="start" data-tool=${t.id} data-folder=${folder} disabled=${busy === 'start'} onClick=${() => act('start')}>Start session</button>
         <button class="btn" data-variant="ghost" type="button" data-chip="dismiss" data-tool=${t.id} disabled=${busy === 'dismiss'} onClick=${() => act('dismiss')}>Dismiss</button>`;
  return html`<li class="chip-card" data-status=${status} data-model=${model || undefined} data-effort=${effort || undefined}>
    <p class="chip-kind">Suggested task${t.name.startsWith('mcp__capcom__') ? '' : ' from Desktop'}</p>
    <h4>${i.title || 'Untitled task'}</h4>
    ${i.tldr ? html`<p>${i.tldr}</p>` : null}
    <pre class="tool-io chip-prompt">${pre(clip(i.prompt || '', 8))}</pre>
    <p class="chip-folder">Starts in ${tilde(folder, HOME) || 'the session folder'}${model ? ` on ${modelName(model)}` : ''}${effort ? ` at ${effortName(effort)} effort` : ''}</p>
    ${chip?.opensIn ? html`<p class="chip-folder chip-opens">${chip.opensIn}</p>` : null}
    <div class="chip-actions">${actions}</div></li>`;
}

// The files and pictures in a message. Each picture opens in the viewer. One from the transcript loads from its address, and one still being sent from the page's own copy.
function Thumbs({ images = [], files = [], url, onOpen }) {
  return html`<div class="thumbs">${files.map((file, n) => html`<${FileCard} key=${`file${n}`} file=${file} />`)}${images.map((img, n) => {
    const key = imageKey(img);
    const label = images.length > 1 ? `View attached image ${n + 1} of ${images.length}` : 'View attached image';
    // loading before src, as in ToolPictures.
    return html`<button class="thumb" type="button" key=${key} data-image=${key} aria-label=${label} aria-haspopup="dialog" onClick=${e => onOpen(key, e.currentTarget)}>
      <img loading=${img.src ? undefined : 'lazy'} src=${img.src ?? url(img.ref)} alt="Attached image" /></button>`;
  })}</div>`;
}

// A quote in a sent message, cut to three lines. It is a button, to read the rest, only when something is cut.
function Quoted({ quote }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const text = useRef(null);
  // Measured again whenever the text's box changes size, and when the element is swapped for the other tag.
  useLayoutEffect(() => {
    const el = text.current;
    const measure = () => { if (!open) setCut(el.scrollHeight > el.clientHeight + 1); };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [quote.text, open, cut]);
  const Tag = cut ? 'button' : 'div';
  return html`<${Tag} class="quoted" type=${cut ? 'button' : undefined} aria-expanded=${cut ? open : undefined} data-open=${open ? '' : undefined} onClick=${cut ? () => setOpen(!open) : undefined}>
    ${draw(icons.quote, 'quote-glyph')}
    <span class="quoted-body">
      ${quote.from !== null ? html`<span class="quoted-from">From ${quote.from || 'another session'}</span>` : null}
      <span class="quoted-text" ref=${text}>${lf(quote.text)}</span>
    </span>
  <//>`;
}

const sameRow = (a, b) => a.chip === b.chip && a.cwd === b.cwd && a.onChip === b.onChip && a.imageUrl === b.imageUrl && a.onImage === b.onImage && a.connectors === b.connectors && a.onPrompt === b.onPrompt && a.running === b.running && a.fileUrl === b.fileUrl
  && a.term === b.term && a.terminal === b.terminal
  && (a.item === b.item || (a.item.kind === 'group' && b.item.kind === 'group' && sameRows(a.item.rows, b.item.rows)));

export const isChip = i => i.kind === 'tool' && /__spawn_task$/.test(i.name);

export const Row = memo(function Row({ item: i, chip, cwd, onChip, imageUrl, onImage, connectors, onPrompt, running, fileUrl, term, terminal }) {
  if (i.kind === 'user') {
    const { quotes, text } = splitQuotes(i.text);
    return html`<li class=${`msg user${i.sending ? ' sending' : ''}`}>${i.images?.length || i.files?.length ? html`<${Thumbs} images=${i.images} files=${i.files} url=${imageUrl} onOpen=${onImage} />` : null}${quotes.map((q, n) => html`<${Quoted} key=${n} quote=${q} />`)}${text ? html`<div class="bubble">${lf(text)}</div>` : null}</li>`;
  }
  if (i.kind === 'assistant') return html`<li class="msg claude" dangerouslySetInnerHTML=${{ __html: md(i.text, fileUrl) }}></li>`;
  if (i.kind === 'tool') {
    if (/__spawn_task$/.test(i.name)) return html`<${ChipCard} t=${i} chip=${chip} cwd=${cwd} onChip=${onChip} />`;
    if (/__mark_chapter$/.test(i.name)) return html`<li class="chapter"><span>${i.input?.title || 'Chapter'}</span></li>`;
    if (/__show_widget$/.test(i.name) && i.input?.widget_code) return html`<${Widget} t=${i} onPrompt=${onPrompt} />`;
    if (/__dismiss_task$/.test(i.name)) return html`<li hidden></li>`;
    return html`<${ToolRow} t=${i} imageUrl=${imageUrl} onImage=${onImage} connectors=${connectors} />`;
  }
  if (i.kind === 'thinking') return html`<${ThinkRow} t=${i} fileUrl=${fileUrl} />`;
  if (i.kind === 'group') return html`<${ToolGroup} rows=${i.rows} imageUrl=${imageUrl} onImage=${onImage} connectors=${connectors} running=${running} fileUrl=${fileUrl} />`;
  if (i.kind === 'system') return html`<${SystemNotice} n=${i} />`;
  if (i.kind === 'bash') return html`<${BashItem} item=${i} term=${term} terminal=${terminal} />`;
  if (i.kind === 'model') return html`<li class="divider">Model set to ${modelLabel(i.model)}</li>`;
  if (i.kind === 'routine') return html`<li class="divider">Started by the ${i.name} routine</li>`;
  if (i.kind === 'scheduled') return html`<li class="divider">Started by the ${i.name} scheduled session</li>`;
  if (i.kind === 'divider') return html`<li class="divider">${i.text}</li>`;
  return html`<li hidden></li>`;
}, sameRow);
