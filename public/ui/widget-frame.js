// What Capcom builds around a widget, and what it decides about a widget's requests. Plain strings and functions, so they run
// without a browser. widget.js puts the document in a sandboxed frame and judges every message the frame sends.
//
// A message between the page and a frame is an object with a `capcom` field.
//   frame to page: height { h }, tabbable { yes }, prompt { text }, link { url },
//     acted (no fields: the owner clicked or pressed a key in the frame)
//   page to frame: mode { mode }, icons { font, glyphs }
//
// The names a widget may rely on are the contract: the CSS variables and the SVG classes in widget-theme.js, the `.ti` icon classes,
// the data-mode attribute on the root, and the globals sendPrompt(text) and openLink(url).
import { CARD_CLASS, hostCss } from './widget-theme.js';

export const CDNS = ['https://cdnjs.cloudflare.com', 'https://esm.sh', 'https://cdn.jsdelivr.net', 'https://unpkg.com'];
const cdn = CDNS.join(' ');

// Everything a widget can load comes from the four CDNs, plus Google Fonts for type. It can call out to a CDN, and nowhere else.
export const CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${cdn}`,
  `style-src 'unsafe-inline' ${cdn} https://fonts.googleapis.com`,
  `font-src data: ${cdn} https://fonts.gstatic.com`,
  `img-src data: blob: ${cdn}`,
  `connect-src ${cdn}`,
  'media-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const HEIGHT_MIN = 40;
export const HEIGHT_MAX = 4000;
// A browser keeps a click active for about five seconds, so a widget gets one prompt sent per click, and a second in that time goes
// to the owner.
export const ACTIVE_MS = 5000;
// How long the page and the other frames must have been quiet before a prompt is sent. The extra second makes a click the page saw
// outlast the activation it gave, a tap whose touchend refreshes it included.
const QUIET_MS = ACTIVE_MS + 1000;
export const PROMPT_MAX = 4000;
export const LINK_MAX = 2048;
export const LINK_GAP_MS = 1000;

let cached = '';

// ---- the document ---------------------------------------------------------------------------------------------------------

// The widget's code goes into the body as it was written. The host's styles and script come first, in the head, so the globals
// exist before the widget's own scripts run.
export function frameDoc(code, { mode, card } = {}) {
  cached ||= hostCss();
  const known = mode === 'light' || mode === 'dark';
  return `<!doctype html><html${known ? ` data-mode="${mode}" style="color-scheme:${mode}"` : ''}><head>`
    + `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
    + '<meta name="referrer" content="no-referrer">'
    + '<meta http-equiv="x-dns-prefetch-control" content="off">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<style>${cached}</style>`
    + `<script>(${frameBoot})()</script>`
    + `</head><body${card ? ` class="${CARD_CLASS}"` : ''}>${code}\n</body></html>`;
}

// ---- the script that runs inside the frame ----------------------------------------------------------------------------------
//
// NOTE: [19 Oct 2026] EK - This function is written into every frame as text, so it can use nothing from this file, and its
// source must never hold the closing script tag or an HTML comment opener.
export function frameBoot() {
  const up = window.parent;
  const root = document.documentElement;
  const say = (capcom, fields) => up.postMessage({ capcom, ...fields }, '*');
  const plain = value => (value == null ? '' : String(value));

  // The page sizes the frame to the body. A body that is only as tall as the frame (height: 100vh) would grow it for ever, so a
  // change that merely follows the frame's own height is not sent.
  let lastInner = 0;
  let lastGap = null;
  const measure = () => {
    const body = document.body;
    const h = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height));
    const gap = h - innerHeight;
    if (innerHeight !== lastInner && gap === lastGap) return;
    lastInner = innerHeight;
    lastGap = gap;
    say('height', { h });
  };
  // A frame with nothing to focus must be no tab stop, or Tab parks on its body with no ring. Anything that might take the focus
  // counts, since a needless stop costs less than a control Tab cannot reach.
  const focusable = 'a,area,button,input:not([type="hidden"]),select,textarea,summary,iframe,audio[controls],video[controls],'
    + '[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex^="-"])';
  let lastTabbable = null;
  const tabbable = () => {
    const yes = document.querySelector(focusable) !== null;
    if (yes === lastTabbable) return;
    lastTabbable = yes;
    say('tabbable', { yes });
  };
  const watch = () => {
    new ResizeObserver(measure).observe(document.body);
    measure();
    const changes = { subtree: true, childList: true, attributes: true, attributeFilter: ['type', 'controls', 'contenteditable', 'tabindex'] };
    new MutationObserver(tabbable).observe(root, changes);
    tabbable();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
  addEventListener('load', measure);

  window.sendPrompt = value => say('prompt', { text: plain(value) });
  window.openLink = value => say('link', { url: plain(value) });
  window.open = value => {
    window.openLink(value);
    return null;
  };

  // A link never navigates the frame. A link to a place in this page works as usual, and any other is passed up as a request.
  const follow = e => {
    const link = e.target instanceof Element ? e.target.closest('a') : null;
    const href = link && (link.getAttribute('href') ?? link.getAttribute('xlink:href'));
    if (href == null || href.trim().startsWith('#')) return;
    e.preventDefault();
    let url = href;
    try {
      url = new URL(href, document.baseURI).href;
    } catch (err) {
      url = href;
    }
    window.openLink(url);
  };
  // On the window and first, so no listener of the widget's own can stop the click before this one sees it.
  addEventListener('click', follow, true);
  addEventListener('auxclick', follow, true);

  // The page cannot tell which widget was clicked, since a widget can take the focus back, so each frame reports its own clicks and key
  // presses. They are on the window and first, like the link listeners, and the clock is read before any widget script can replace it.
  const { now } = Date;
  let lastActed = -Infinity;
  const acted = e => {
    const t = now();
    if (!e.isTrusted || t - lastActed < 250) return;
    lastActed = t;
    say('acted');
  };
  addEventListener('pointerdown', acted, true);
  addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') acted(e); }, true);
  addEventListener('click', acted, true);
  addEventListener('keydown', acted, true);

  // Icons are drawn from a font the page sends, and a rule for a glyph is added only once something in the frame uses its name.
  let glyphs = null;
  let sheet = null;
  const added = new Set();
  const want = name => {
    if (!glyphs || added.has(name) || !(name in glyphs)) return;
    added.add(name);
    sheet = sheet || document.head.appendChild(document.createElement('style'));
    sheet.appendChild(document.createTextNode('.ti-' + name + '::before{content:"\\' + glyphs[name] + '"}'));
  };
  const read = el => {
    const classes = el.getAttribute ? el.getAttribute('class') : null;
    if (!classes || classes.indexOf('ti-') < 0) return;
    for (const c of classes.split(/\s+/)) if (c.indexOf('ti-') === 0) want(c.slice(3));
  };
  const sweep = node => {
    read(node);
    if (node.querySelectorAll) node.querySelectorAll('[class*="ti-"]').forEach(read);
  };
  const takeIcons = m => {
    if (glyphs || !(m.font instanceof ArrayBuffer) || !m.glyphs || typeof m.glyphs !== 'object') return;
    glyphs = Object.create(null);
    for (const name in m.glyphs) if (/^[a-z0-9-]+$/.test(name) && /^[0-9a-f]{1,6}$/.test(m.glyphs[name])) glyphs[name] = m.glyphs[name];
    try {
      const face = new FontFace('tabler-icons', m.font);
      document.fonts.add(face);
      face.load().catch(() => {});
    } catch (err) {
      return;
    }
    sweep(root);
    new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'attributes') read(r.target);
        else r.addedNodes.forEach(n => n.nodeType === 1 && sweep(n));
      }
    }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  };

  addEventListener('message', e => {
    const m = e.data;
    if (e.source !== up || !m || typeof m !== 'object') return;
    if (m.capcom === 'mode' && (m.mode === 'light' || m.mode === 'dark')) {
      root.setAttribute('data-mode', m.mode);
      root.style.colorScheme = m.mode;
    } else if (m.capcom === 'icons') {
      takeIcons(m);
    }
  });
}

// ---- what the page decides --------------------------------------------------------------------------------------------------

// What the page does with a widget's sendPrompt: 'send' it at once, 'ask' the owner in a bar, or 'drop' it.
export function promptGate({ text, active, focused, now, last, pending, pageActed, othersActed }) {
  if (typeof text !== 'string' || !text.trim() || pending) return 'drop';
  return clickedHere({ active, focused, now, pageActed, othersActed }) && now - (last ?? -Infinity) >= ACTIVE_MS && text.length <= PROMPT_MAX ? 'send' : 'ask';
}

// What the page does with a link a widget passes up: 'open' it in a new tab at once, after a click on this widget, or 'ask' the owner.
// At most one a second, so a script cannot open a burst of tabs from one click.
export function linkGate({ active, focused, now, last, pageActed, othersActed }) {
  return clickedHere({ active, focused, now, pageActed, othersActed }) && now - (last ?? -Infinity) >= LINK_GAP_MS ? 'open' : 'ask';
}

// NOTE: [19 Oct 2026] EK - Focus cannot say which widget was clicked, because a sandboxed frame can take it back after a click elsewhere
// (tried in Chromium 151 and WebKit 26.5). So a click or key press lately on the page or in another frame rules out a send, whatever
// holds the focus.
function clickedHere({ active, focused, now, pageActed, othersActed }) {
  const ago = since => now - (since ?? -Infinity);
  const quiet = ago(pageActed) > QUIET_MS && ago(othersActed) > QUIET_MS;
  // A browser with no `navigator.userActivation` gives `active` undefined, which never counts as a click.
  return active === true && focused === true && quiet;
}

// The address to offer the owner for a link, or null when the widget must not get to propose it: only a web address that names no user.
export function linkTarget(url) {
  if (typeof url !== 'string' || url.length > LINK_MAX) return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch (err) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  return parsed.href.length <= LINK_MAX ? parsed.href : null;
}

export function clampHeight(h) {
  return typeof h === 'number' && Number.isFinite(h) ? Math.min(Math.max(Math.ceil(h), HEIGHT_MIN), HEIGHT_MAX) : null;
}

// A tool's title is an identifier such as q4_revenue_by_product_line, so the frame is named by it as words.
export function humanTitle(title) {
  const words = typeof title === 'string' ? title.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return words ? words.replace(/^./u, c => c.toUpperCase()) : 'Widget';
}

const LEADING_SVG = /^\s*<svg(?=[\s/>])([^>]*)>/i;

// A widget that is only an SVG is drawn as a card. One that starts with anything else is a page of its own.
export const isCard = code => typeof code === 'string' && LEADING_SVG.test(code);

const attribute = (attributes, name) => {
  const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attributes);
  return found ? (found[1] ?? found[2]).trim() : null;
};

// The width and height of that SVG's viewBox, to hold its place before the frame has measured itself. An SVG whose width is a fixed
// size may be narrower than the card, so the viewBox says nothing about the height it will take and it holds no place.
export function viewBoxRatio(code) {
  const tag = typeof code === 'string' ? LEADING_SVG.exec(code) : null;
  if (!tag) return null;
  const own = attribute(tag[1], 'width');
  if (own && own !== 'auto' && !own.endsWith('%')) return null;
  const box = attribute(tag[1], 'viewBox');
  const parts = box === null ? [] : box.split(/[\s,]+/).map(Number);
  const [, , width, height] = parts;
  return parts.length === 4 && width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}

// The glyph names in Tabler's stylesheet and the code each draws, as { home: 'eac1' }. A rule may name several icons.
export function parseGlyphs(css) {
  const glyphs = {};
  for (const [, selectors, body] of String(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const code = /content\s*:\s*["']\\([0-9a-f]{1,6})["']/i.exec(body);
    if (!code) continue;
    for (const [, name] of selectors.matchAll(/\.ti-([a-z0-9-]+)::?before/gi)) glyphs[name] = code[1].toLowerCase();
  }
  return glyphs;
}
