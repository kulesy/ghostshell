// The context meter in the prompt box: a ring, or the count in words where the window is not known, and a popover that lists what fills
// the window, largest first. The popover is shadcn's, which is Radix's, in its non-modal form: the page behind it keeps taking presses,
// and a press or the focus going anywhere else closes it.
import { hasFigure, parts, planRows, readout } from './context-rules.js';
import { useFields } from './hooks.js';
import { Fragment, html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { onPressOutside } from './layer.js';
import { place } from './menu-rules.js';
import { usePresence } from './presence.js';

const RADIUS = 7;
const CIRCLE = 2 * Math.PI * RADIUS;
const SKELETONS = Array.from({ length: 9 }, (_, n) => n);

// Opens above its button with its end edge on the button's, as shadcn's popover does, and flips below when there is no room.
const RULE = { side: 'top', align: 'end', offset: 4, pad: 8 };

let made = 0;

// The arc starts at 12 o'clock and runs clockwise. A ring with nothing in it draws no arc, because a round cap would still leave a dot.
const Ring = ({ fill }) => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
  <circle class="context-track" cx="10" cy="10" r=${RADIUS} fill="none" stroke="currentColor" stroke-width="2.25" />
  ${fill > 0 ? html`<circle class="context-arc" cx="10" cy="10" r=${RADIUS} fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-dasharray=${`${(CIRCLE * fill) / 100} ${CIRCLE}`} transform="rotate(-90 10 10)" />` : null}
</svg>`;

const Row = ({ part }) => html`<tr><th scope="row">${part.name}</th><td>${part.size}${part.share ? html`<span class="context-share">${part.share}</span>` : null}</td></tr>`;

// What fills the window. A chat Capcom runs has its parts counted by Claude, which takes a moment. One it does not run has only the
// total, read from the transcript.
function Parts({ figure, view, busy, failed }) {
  if (figure.source !== 'process') {
    return html`<div class="context-parts">
      <p class="context-note">From the transcript, as of Claude's last reply. The breakdown shows while GhostShell runs this chat.</p>
      ${figure.window ? null : html`<p class="context-note">GhostShell learns this model's window the next time it runs a chat set to it.</p>`}
    </div>`;
  }
  return html`<div class="context-parts" aria-busy=${busy}>
    ${view
      ? html`<table class="context-table">
          <caption class="sr">What fills the context window, largest first</caption>
          <tbody>${view.used.map(part => html`<${Row} key=${part.key} part=${part} />`)}</tbody>
          ${view.rest.length ? html`<tbody class="context-rest">${view.rest.map(part => html`<${Row} key=${part.key} part=${part} />`)}</tbody>` : null}
        </table>`
      : failed
        ? html`<p class="context-note">The parts could not be counted.</p>`
        : html`<p class="sr" role="status">Counting what fills the window</p>
          <div class="context-load" aria-hidden="true">${SKELETONS.map(n => html`<span key=${n}></span>`)}</div>`}
  </div>`;
}

// The plan's limits are the account's, so they show for any chat. Each is a bar like the one above, and a row that is near its limit takes
// the severity colour the server names.
function Plan({ id, rows }) {
  return html`<section class="context-plan" aria-labelledby=${`${id}-plan`}>
    <h4 class="context-plan-title" id=${`${id}-plan`}>Plan usage</h4>
    <ul class="plan-list">
      ${rows.map(row => html`<li key=${row.key} class="plan-row" data-severity=${row.severity}>
        <div class="plan-head"><span class="plan-label">${row.label}</span><span class="plan-percent">${row.percent}%</span></div>
        <div class="context-bar" role="meter" aria-label=${row.label} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${row.percent} aria-valuetext=${row.text}>
          <span class="context-fill" style=${`width:${row.percent}%`}></span>
        </div>
        ${row.reset ? html`<p class="plan-reset">${row.reset}</p>` : null}
      </li>`)}
    </ul>
  </section>`;
}

function Popover({ id, box, open, anchor, shut, figure, r, view, busy, failed, plan }) {
  const rows = plan ? planRows(plan) : [];
  const [at, setAt] = useState(null);
  const size = useRef(null);
  const placed = at !== null;

  const lay = () => {
    const a = anchor.current.getBoundingClientRect();
    const v = window.visualViewport;
    const room = v ? { x: v.offsetLeft, y: v.offsetTop, width: v.width, height: v.height } : { width: innerWidth, height: innerHeight };
    return place({ anchor: { x: a.x, y: a.y, width: a.width, height: a.height }, size: size.current, view: room, dpr: window.devicePixelRatio || 1, ...RULE });
  };
  const reflow = () => {
    if (!box.current || !anchor.current) return;
    const next = lay();
    setAt(now => (now && now.x === next.x && now.y === next.y && now.room === next.room && now.side === next.side ? now : next));
  };

  useLayoutEffect(() => {
    const rect = box.current.getBoundingClientRect();
    size.current = { width: rect.width, height: rect.height };
    setAt(lay());
  }, []);

  // The parts arrive after the popover has opened, so a change of size places it again.
  useEffect(() => {
    const watch = new ResizeObserver(([e]) => {
      // A popover that has just been removed reports a size of 0 before this observer is disconnected.
      if (!e.target.isConnected) return;
      const b = e.borderBoxSize?.[0] ?? { inlineSize: e.contentRect.width, blockSize: e.contentRect.height };
      const was = size.current;
      if (!was || (Math.abs(was.width - b.inlineSize) < 0.01 && Math.abs(was.height - b.blockSize) < 0.01)) return;
      size.current = { width: b.inlineSize, height: b.blockSize };
      reflow();
    });
    watch.observe(box.current);
    return () => watch.disconnect();
  }, []);

  // The popover takes the focus once it is in place, as Radix's does, so a key can close it.
  useLayoutEffect(() => {
    if (open && placed) box.current.focus({ preventScroll: true });
  }, [open, placed]);

  useEffect(() => {
    if (!open) return undefined;
    // Preact runs a removed component's effect cleanups on the next frame, and a popover with no exit animation is removed at once, so
    // these handlers can still hear an event after the popover has gone.
    const inside = el => !!el && !!(box.current?.contains(el) || anchor.current?.contains(el));
    // The document hears every key first, so Esc closes the popover and cannot also stop a chat that is running behind it.
    const onKey = e => { if (e.key === 'Escape' && box.current) { e.preventDefault(); e.stopPropagation(); shut(true); } };
    const onFocus = e => { if (!inside(e.target)) shut(false); };
    const v = window.visualViewport;
    const stop = onPressOutside(inside, () => shut(false));
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    window.addEventListener('resize', reflow);
    v?.addEventListener('resize', reflow);
    v?.addEventListener('scroll', reflow);
    return () => {
      stop();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('resize', reflow);
      v?.removeEventListener('resize', reflow);
      v?.removeEventListener('scroll', reflow);
    };
  }, [open]);

  const style = at
    ? `left:${at.x}px;top:${at.y}px;--pop-origin:${at.origin};--pop-room:${at.room}px`
    : 'left:0;top:0;visibility:hidden;animation:none';

  return html`<div class="context-pop" id=${id} data-slot="popover-content" role="dialog" aria-labelledby=${`${id}-title`} tabindex="-1" ref=${box}
    data-state=${open ? 'open' : 'closed'} data-side=${at?.side || null} data-align=${at?.align || null} data-severity=${r.severity}
    inert=${!open} style=${style}>
    <div class="context-head"><h3 class="context-title" id=${`${id}-title`}>Context</h3><span class="context-size">${r.size}</span></div>
    ${r.fill === null ? null : html`<div class="context-gauge">
      <div class="context-bar" role="meter" aria-label="Context used" aria-valuemin="0" aria-valuemax=${figure.window} aria-valuenow=${Math.min(figure.total, figure.window)} aria-valuetext=${r.exact}>
        <span class="context-fill" style=${`width:${r.fill}%`}></span>
      </div>
      ${r.tick === null ? null : html`<span class="context-tick" style=${`left:${r.tick}%`} aria-hidden="true"></span>`}
    </div>`}
    ${r.line ? html`<p class="context-line">${r.line}</p>` : null}
    <${Parts} figure=${figure} view=${view} busy=${busy} failed=${failed} />
    ${rows.length ? html`<${Plan} id=${id} rows=${rows} />` : null}
  </div>`;
}

function Meter({ ctrl, figure }) {
  const r = readout(figure);
  const ringed = r.fill !== null;
  const [open, setOpen] = useState(false);
  const [failedAt, setFailedAt] = useState(null);
  const [plan, setPlan] = useState(null);
  const [id] = useState(() => `context-${++made}`);
  const button = useRef(null);
  const box = useRef(null);
  const present = usePresence(open, box);
  const last = useRef(null);
  const counted = figure.source === 'process';
  const counts = counted && figure.categories ? parts(figure) : null;
  const failed = failedAt === figure.total;
  if (counts) last.current = counts;
  // A total that moves on while the popover is open drops the parts, so the last table stays, dimmed, until the next count lands.
  const view = counts || (counted && !failed ? last.current : null);
  const busy = counted && !counts && !failed;

  // The parts are counted when the popover opens and again when the total moves on while it is open. One count that fails is not asked
  // for again until the popover is opened again or the total changes, or a failing count would be asked for in a loop.
  const asking = open && busy;
  useEffect(() => {
    if (!asking) return undefined;
    let live = true;
    ctrl.loadContext('full').then(got => { if (live && !got?.categories) setFailedAt(figure.total); });
    return () => { live = false; };
  }, [asking, figure.total]);

  // The plan's usage is asked for once each time the popover opens. A failed ask drops the rows, and is not asked for again.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    ctrl.loadPlan().then(rows => { if (live) setPlan(rows); });
    return () => { live = false; };
  }, [open]);

  const shut = back => {
    setOpen(false);
    if (back) button.current?.focus({ preventScroll: true });
  };
  const toggle = () => {
    if (open) {
      shut(true);
    } else {
      setFailedAt(null);
      last.current = null;
      setOpen(true);
    }
  };

  return html`<${Fragment}>
    <button class="btn context" type="button" data-variant="ghost" data-size=${ringed ? 'icon-sm' : 'sm'} data-state=${open ? 'open' : 'closed'} data-severity=${r.severity}
      aria-haspopup="dialog" aria-expanded=${open} aria-controls=${open ? id : null} aria-label=${r.label} data-tip=${open ? '' : r.tip}
      ref=${button} onClick=${toggle}>${ringed ? html`<${Ring} fill=${r.fill} />` : html`<span>${r.text}</span>`}</button>
    ${present ? html`<${Popover} id=${id} box=${box} open=${open} anchor=${button} shut=${shut} figure=${figure} r=${r} view=${view} busy=${busy} failed=${failed} plan=${plan} />` : null}
  <//>`;
}

export function ContextMeter({ ctrl }) {
  const { context } = useFields(ctrl.store, 'context');
  return !ctrl.draft && hasFigure(context) ? html`<${Meter} ctrl=${ctrl} figure=${context} />` : null;
}
