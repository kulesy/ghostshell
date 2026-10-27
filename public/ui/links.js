// The status of the pull requests and issues an assistant message links to, drawn as a badge after the link, with a card of the details that opens
// over the link or the badge on a hover, and on a click or tap of the badge. The rules are in link-rules.js. The replies are drawn from markdown HTML
// the page does not own, so the badges are put in the drawn DOM and put back when a reply is drawn again. A page whose server cannot say draws none.
import { api } from './api.js';
import { useEffect } from './html.js';
import { badgeOf, cardOf, isLinkUrl, linksToAsk, usable, wantsLink } from './link-rules.js';
import { createStore } from './store.js';
import { KEPT, trim } from './sub-panel-rules.js';
import { place } from './tooltip.js';

// What the server last said of each link, { at, link, settling }, in the order they were stored. A link it could not read is kept with a null link,
// so it is asked for again when the answer is old and not on every change of the page.
export const linkStore = createStore({ known: new Map() });

export const linksOn = ix => !!ix?.features?.linkStatus;

const SETTLE_MS = 4000;
const HOLD_MS = 400;
const OPEN_MS = 700;
const CLOSE_MS = 300;
const CARD_ID = 'link-card';
// The room kept between the card and the side of the window.
const EDGE = 8;
const LINK = '.msg.claude a[href*="github.com/"]';
// The addresses a request is out for, so a change of the page that lands first does not ask again.
const asking = new Set();

const hovers = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

const MARKS = {
  pull: ['M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M13 6h3a2 2 0 0 1 2 2v7', 'M6 9v12'],
  draft: ['M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M18 6h.01', 'M6 9v12'],
  merge: ['M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M6 21V9a9 9 0 0 0 9 9'],
  closed: ['M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M6 9v12', 'm21 3-6 6', 'm21 9-6-6', 'M18 11.5V15', 'M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  issue: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'M13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0'],
  done: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'm9 12 2 2 4-4'],
  skip: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'M9 15l6-6'],
};

function markOf(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  for (const d of MARKS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// Text from GitHub goes in as text and never as markup.
function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function keep(batch, reply) {
  const known = new Map(linkStore.get().known);
  const at = Date.now();
  for (const url of batch) {
    const prior = known.get(url);
    known.delete(url);
    known.set(url, { at, link: usable(url, reply?.links?.[url]) ?? prior?.link ?? null, settling: reply?.settling === true });
  }
  trim(known, new Set(batch), KEPT);
  linkStore.set({ known });
}

// Asks for the links in `urls` whose answer is missing, unfinished or old, and says whether the server is still reading some. A failed request keeps
// what the page has.
function askAbout(urls) {
  const batches = linksToAsk(urls, linkStore.get().known).map(batch => batch.filter(url => !asking.has(url))).filter(batch => batch.length);
  return Promise.all(batches.map(batch => {
    batch.forEach(url => asking.add(url));
    return api(`api/links?${batch.map(url => `url=${encodeURIComponent(url)}`).join('&')}`).then(
      reply => { keep(batch, reply); return reply.settling === true; },
      () => { keep(batch, null); return false; },
    ).then(settling => {
      batch.forEach(url => asking.delete(url));
      return settling;
    });
  })).then(results => results.includes(true));
}

const known = url => linkStore.get().known.get(url);
const hrefOf = a => a.getAttribute('href');
const anchorsIn = node => (node.nodeType === 1 ? [...(node.matches(LINK) ? [node] : []), ...node.querySelectorAll(LINK)].filter(a => isLinkUrl(hrefOf(a))) : []);

// Puts the badge after the link, or updates or removes the one there, so drawing twice leaves one.
function paint(a) {
  const url = hrefOf(a);
  const link = usable(url, known(url)?.link);
  const there = a.nextSibling?.classList?.contains('link-badge') ? a.nextSibling : null;
  if (!link) {
    there?.remove();
    return;
  }
  const { word, tone, mark } = badgeOf(link);
  const sig = `${tone}|${mark}|${word}|${link.kind}`;
  if (there?.dataset.sig === sig && there.dataset.url === url) return;
  const badge = there ?? element('button', 'badge link-badge');
  badge.type = 'button';
  badge.dataset.variant = 'outline';
  badge.dataset.tone = tone;
  badge.dataset.url = url;
  badge.dataset.sig = sig;
  badge.setAttribute('aria-haspopup', 'dialog');
  badge.setAttribute('aria-controls', CARD_ID);
  badge.setAttribute('aria-label', `${word}, ${link.kind === 'pull' ? 'pull request' : 'issue'} status`);
  if (!there) badge.setAttribute('aria-expanded', 'false');
  badge.replaceChildren(markOf(mark), word);
  if (!there) a.after(badge);
}

let host = null;
let shown = null;
let openTimer = 0;
let closeTimer = 0;
let watchers = 0;

function fill(card) {
  const state = element('p', 'link-state');
  state.dataset.tone = card.state.tone;
  state.append(markOf(card.state.mark), card.state.word);
  const nodes = [element('p', 'link-title', card.title), element('p', 'link-repo', card.repo), state];
  if (card.facts.length) {
    const facts = element('dl', 'link-facts');
    for (const [name, word] of card.facts) facts.append(element('dt', '', name), element('dd', '', word));
    nodes.push(facts);
  }
  if (card.next) {
    const next = element('p', 'link-next', card.next.text);
    next.dataset.tone = card.next.tone;
    nodes.push(next);
  }
  host.setAttribute('aria-label', card.label);
  host.replaceChildren(...nodes);
}

function position() {
  const { left, top, width, height } = shown.badge.getBoundingClientRect();
  const at = place({ left: left - EDGE, top, width, height }, { width: host.offsetWidth, height: host.offsetHeight }, { width: innerWidth - 2 * EDGE, height: innerHeight });
  host.style.transform = `translate(${at.x + EDGE}px, ${at.y}px)`;
}

function close(back) {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  if (!shown) return;
  const { badge } = shown;
  shown = null;
  badge.setAttribute('aria-expanded', 'false');
  host.hidden = true;
  if (back === true && badge.isConnected) badge.focus({ preventScroll: true });
}

function open(badge, how) {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  if (!badge.isConnected) return;
  const kept = known(badge.dataset.url);
  const link = usable(badge.dataset.url, kept?.link);
  const card = link && cardOf(link);
  if (!card) return;
  if (shown && shown.badge !== badge) close();
  fill(card);
  shown = { badge, how };
  badge.setAttribute('aria-expanded', 'true');
  host.hidden = false;
  position();
  if (wantsLink(kept)) askAbout([badge.dataset.url]);
}

// Draws the card again when the answer it shows has changed.
function refresh() {
  if (!shown) return;
  const link = usable(shown.badge.dataset.url, known(shown.badge.dataset.url)?.link);
  const card = link && cardOf(link);
  if (!card) return close();
  fill(card);
  position();
}

function leave() {
  clearTimeout(openTimer);
  if (shown?.how !== 'hover') return;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(close, CLOSE_MS);
}

function enter(badge) {
  clearTimeout(closeTimer);
  if (shown?.badge === badge) return;
  clearTimeout(openTimer);
  openTimer = setTimeout(() => open(badge, 'hover'), OPEN_MS);
}

// The badge a pointer over `el` is on, or the one after the link it is on.
function badgeAt(el) {
  const near = el.closest?.('.link-badge, a[href]');
  if (!near) return null;
  if (near.classList.contains('link-badge')) return near;
  return near.closest('.msg.claude') && near.nextSibling?.classList?.contains('link-badge') ? near.nextSibling : null;
}

function cardHost() {
  if (!host) {
    host = element('div', 'link-card');
    host.id = CARD_ID;
    host.setAttribute('role', 'dialog');
    host.hidden = true;
    host.tabIndex = -1;
    host.addEventListener('pointerover', () => clearTimeout(closeTimer));
    host.addEventListener('pointerout', e => { if (!host.contains(e.relatedTarget)) leave(); });
    document.body.append(host);
  }
  return host;
}

// Draws the badges in `root`, which holds the replies, and keeps them: for the links that are there, the ones that appear and the ones drawn again.
// Returns the function that stops.
export function watchLinks(root) {
  cardHost();
  watchers++;
  let askTimer = 0;
  let settleTimer = 0;
  let stopped = false;

  const anchors = () => anchorsIn(root);
  const ask = () => {
    if (stopped || document.hidden) return;
    askAbout(anchors().map(hrefOf)).then(settling => {
      if (!settling || stopped) return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(ask, SETTLE_MS);
    });
  };
  // A reply that is still being written holds still for a moment before its links are asked about, as a half written address may name another pull request.
  const soon = () => {
    clearTimeout(askTimer);
    askTimer = setTimeout(ask, HOLD_MS);
  };

  const changed = records => {
    let found = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 || node.classList.contains('link-badge')) continue;
        const list = anchorsIn(node);
        list.forEach(paint);
        found ||= list.length > 0;
      }
    }
    if (shown && !shown.badge.isConnected) close();
    if (found) soon();
  };
  const watch = new MutationObserver(changed);
  watch.observe(root, { childList: true, subtree: true });
  const unsubscribe = linkStore.subscribe(() => {
    anchors().forEach(paint);
    refresh();
  });

  const over = e => {
    if (e.pointerType === 'touch' || !hovers()) return;
    const badge = badgeAt(e.target);
    if (badge) enter(badge);
  };
  const out = e => {
    const badge = badgeAt(e.target);
    if (!badge) return;
    const into = e.relatedTarget && badgeAt(e.relatedTarget);
    if (into !== badge) leave();
  };
  const click = e => {
    const badge = e.target.closest?.('.link-badge');
    if (!badge) return;
    if (shown?.badge !== badge) open(badge, 'click');
    else if (shown.how === 'hover') shown.how = 'click';
    else close();
  };
  const pressed = e => {
    if (shown && !host.contains(e.target) && !e.target.closest?.('.link-badge')) close();
  };
  const keyed = e => {
    if (e.key !== 'Escape' || !shown) return;
    e.preventDefault();
    close(true);
  };
  const left = e => {
    if (shown && e.target === shown.badge && !host.contains(e.relatedTarget)) close();
  };
  const seen = () => { if (!document.hidden) ask(); };
  const quit = () => close();
  // A reply being written scrolls the box on every word, so the card follows its badge and closes only once the badge is out of sight.
  const scrolled = () => {
    if (!shown) return;
    const at = shown.badge.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    if (at.bottom <= box.top || at.top >= box.bottom) close();
    else position();
  };

  root.addEventListener('pointerover', over);
  root.addEventListener('pointerout', out);
  root.addEventListener('click', click);
  root.addEventListener('focusout', left);
  root.addEventListener('scroll', scrolled, { passive: true });
  document.addEventListener('pointerdown', pressed, true);
  document.addEventListener('keydown', keyed, true);
  document.addEventListener('visibilitychange', seen);
  addEventListener('resize', quit);

  anchors().forEach(paint);
  soon();

  return () => {
    stopped = true;
    clearTimeout(askTimer);
    clearTimeout(settleTimer);
    watch.disconnect();
    unsubscribe();
    root.removeEventListener('pointerover', over);
    root.removeEventListener('pointerout', out);
    root.removeEventListener('click', click);
    root.removeEventListener('focusout', left);
    root.removeEventListener('scroll', scrolled);
    document.removeEventListener('pointerdown', pressed, true);
    document.removeEventListener('keydown', keyed, true);
    document.removeEventListener('visibilitychange', seen);
    removeEventListener('resize', quit);
    close();
    if (--watchers === 0) {
      host.remove();
      host = null;
    }
  };
}

// Draws the badges in the transcript `box` while the server can say what a link's status is.
export function useLinkPreviews(box, on) {
  useEffect(() => (on ? watchLinks(box.current) : undefined), [on]);
}
