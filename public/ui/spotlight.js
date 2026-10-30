// Ctrl+K searches from anywhere, in shadcn's command dialog. Chips pick what to look through, and the left and right arrows move
// between them. Archived sessions are only found here, under their own chip, most recently archived first, and only here is one
// unarchived, with Shift+Enter. Home, the projects and the groups are found here too, and opening one shows its
// view in the list. What a search lists, and in what order, is search-rules.js's.
import { api } from './api.js';
import { focusNextComposer } from './composer.js';
import { Dialog } from './dialog.js';
import { STATE_LABEL, when } from './format.js';
import { useModifier } from './hooks.js';
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from './html.js';
import { draw, icons } from './menu.js';
import { UNTITLED } from './order.js';
import { withSubs } from './pick.js';
import { HOME_VIEW } from './scopes.js';
import { emptyText, sectionsFor } from './search-rules.js';
import { FIRST, holdAt, holdBeside, holdStep, selectedIn } from './selection.js';
import { newSession } from './sessions-list.js';
import { keyHint } from './shortcuts.js';
import { swipeRows } from './swipe.js';
import { say } from './toast.js';

const CHIPS = [['all', 'All'], ['projects', 'Projects'], ['groups', 'Groups'], ['sessions', 'Sessions'], ['routines', 'Routines'], ['scheduled', 'Scheduled'], ['archived', 'Archived']];

const Search = () => html`<svg data-part="command-input-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>`;

// What an item says about itself. A session shows its title alone, with the time beside it only while the whole title fits.
function Words({ it }) {
  if (it.action) {
    return html`<span data-part="hit-icon" aria-hidden="true">${draw(icons[it.icon] ?? icons.messageSquarePlus)}</span><span data-part="hit-title">${it.action}</span>${it.hint ? html`<span data-slot="command-shortcut">${it.hint}</span>` : null}`;
  }
  if (it.view) {
    const { view: v } = it;
    const meta = [v.id === HOME_VIEW ? 'Everything outside projects' : 'Project', v.lamp && STATE_LABEL[v.lamp]].filter(Boolean).join(' · ');
    return html`<span class="lamp" data-state=${v.lamp || 'idle'} aria-hidden="true"></span><span data-part="hit-title">${v.name}</span>
      <span data-part="hit-meta">${meta}</span>${v.count === undefined ? null : html`<span data-part="hit-time">${v.count}</span>`}`;
  }
  if (it.group) {
    const { group: g } = it;
    const meta = [g.meta, g.lamp && STATE_LABEL[g.lamp]].filter(Boolean).join(' · ');
    return html`<span class="lamp" data-state=${g.lamp || 'idle'} aria-hidden="true"></span><span data-part="hit-title">${g.name}</span>
      <span data-part="hit-meta">${meta}</span><span data-part="hit-time">${g.count}</span>`;
  }
  const { r } = it;
  const title = r.title || UNTITLED;
  const state = !r.archived && STATE_LABEL[r.state];
  return html`<span class="lamp" data-state=${r.state} aria-hidden="true"></span><span data-part="hit-line" data-tip=${title} data-tip-delay="700">
    <span data-part="hit-title">${title}</span>${state ? html`<span class="sr">${`, ${state}`}</span>` : null}${r.runs ? html`<span data-part="hit-meta">${`${r.runs} run${r.runs > 1 ? 's' : ''}`}</span>` : null}
    <time data-part="hit-time">${when(r.archived ? r.archivedAt : r.lastActivityAt)}</time></span>`;
}

// The wrapper carries the backdrop of a swipe on an archived hit, which would be hidden behind the hit's own background.
const Hit = ({ it, id, selected, onPick, onMove }) => html`<div data-part="hit-swipe"><div id=${id} data-slot="command-item" cmdk-item="" role="option" aria-selected=${selected} data-selected=${selected}
  data-disabled="false" data-value=${it.key} data-archived=${it.r?.archived || null} onClick=${() => onPick(it)} onPointerMove=${onMove}><${Words} it=${it} /></div></div>`;

// `onShow(id, group)` shows a view of the list, a project id or null for Home, with a group in it in sight when `group` names one, and
// closes the search. Opening anything else closes it here.
// The dialog is always drawn and the search inside it is made afresh for each opening, so what was typed last time is gone.
export function Spotlight({ open, ix, archive, onShow, onClose }) {
  return html`<${Dialog} open=${open} part="command-dialog-content" labelledBy="command-title" describedBy="command-description" onClose=${() => onClose()}>
    <${Palette} ix=${ix} archive=${archive} onShow=${onShow} onClose=${onClose} />
  <//>`;
}

function Palette({ ix, archive, onShow, onClose }) {
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const [held, setHeld] = useState(FIRST);
  const [archived, setArchived] = useState([]);
  const [gone, setGone] = useState([]);
  const input = useRef(null);
  const list = useRef(null);
  const scroll = useRef(false);
  const pointer = useRef(null);
  const latestSwipe = useRef(null);
  const mod = useModifier();

  useEffect(() => {
    let live = true;
    api('api/archived').then(d => { if (live) setArchived(d.archived || []); }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => swipeRows(list.current, { row: '[cmdk-item][data-archived]', onSwipe: row => latestSwipe.current(row.dataset.value) }), []);

  const sections = useMemo(() => {
    if (!ix) return [];
    const kept = archived.filter(r => !gone.includes(r.id));
    return sectionsFor(chip, ix, kept, query, keyHint(mod, 'N')).filter(s => s.items.length);
  }, [ix, archived, gone, chip, query, mod]);
  const flat = sections.flatMap(s => s.items);
  const keys = flat.map(it => it.key);
  let counted = 0;
  const starts = sections.map(s => { const at = counted; counted += s.items.length; return at; });
  const pick = selectedIn(keys, held);
  const canUnarchive = !!flat[pick]?.r?.archived;

  // A result held by its key has its position kept up to date, so when it goes the selection falls back on where it last was.
  useLayoutEffect(() => { setHeld(now => (now.key === null || (now.at === pick && now.key === keys[pick]) ? now : holdAt(keys, pick))); });
  // The list follows the selection only when a key, a search or a chip moved it, because the pointer selects what it is already over.
  useLayoutEffect(() => {
    if (!scroll.current) return;
    scroll.current = false;
    const el = list.current?.querySelector('[data-selected="true"]');
    if (!el) return;
    const group = el.closest('[cmdk-group]');
    if (group?.querySelector('[role="option"]') === el) group.querySelector('[cmdk-group-heading]')?.scrollIntoView({ block: 'nearest' });
    el.scrollIntoView({ block: 'nearest' });
  }, [pick, sections]);

  const open = it => {
    if (it.view || it.group) {
      onShow(it.view ? it.view.id : it.group.view, it.group?.id);
      return;
    }
    onClose();
    if (it.key === 'new') newSession();
    else if (it.action) location.hash = it.hash;
    else {
      focusNextComposer();
      location.hash = `#/s/${encodeURIComponent(it.r.id)}`;
    }
  };
  const select = key => { scroll.current = true; setChip(key); setHeld(FIRST); };
  const choose = key => { select(key); input.current.focus(); };
  const step = by => {
    scroll.current = true;
    setChip(now => CHIPS[Math.max(0, Math.min(CHIPS.length - 1, CHIPS.findIndex(([key]) => key === now) + by))][0]);
    setHeld(FIRST);
  };
  const go = to => { scroll.current = true; setHeld(to); };
  // Alt and the arrows jump to the first result of the next or the previous group, and step by one when there is none.
  const groupStep = by => {
    const here = starts.filter(at => at <= pick).length - 1;
    const to = starts[here + by];
    return to === undefined ? holdStep(keys, pick, by) : holdAt(keys, to);
  };

  // Takes an archived session out of the list at once and asks the server to unarchive it. If the server refuses, the session
  // comes back and the reason shows. A swipe passes `focus: false`, so a phone does not raise its keyboard.
  const unarchive = async (it, { focus = true } = {}) => {
    const { r } = it;
    // The selection goes to the result beside it, held by key, so the session reappearing in Sessions does not move it.
    const beside = keys[pick] === it.key ? holdBeside(keys, pick) : null;
    const was = pick;
    if (beside) setHeld(beside);
    setGone(ids => [...ids, r.id]);
    if (focus) input.current.focus();
    const { problem, subs } = await archive(r.id, false);
    if (problem) {
      setGone(ids => ids.filter(id => id !== r.id));
      // A refusal puts the selection back on the session, unless it has been moved on since.
      if (beside) setHeld(now => (now.key === beside.key ? { key: it.key, at: was } : now));
    }
    say(problem || `Unarchived “${r.title || UNTITLED}”${withSubs(subs)}.`, { problem: !!problem });
  };

  latestSwipe.current = key => { const it = flat.find(hit => hit.key === key); if (it) unarchive(it, { focus: false }); };

  // The arrows change chips only from the edge of the text, so they still move the caret through a query. Esc is the dialog's.
  const onKeyDown = e => {
    if (e.isComposing) return;
    const box = e.currentTarget;
    if (e.key === 'ArrowRight' && box.selectionStart === box.value.length) { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' && box.selectionEnd === 0) { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const by = e.key === 'ArrowDown' ? 1 : -1;
      if (e.metaKey) go(holdAt(keys, by > 0 ? Math.max(keys.length - 1, 0) : 0));
      else if (e.altKey) go(groupStep(by));
      else go(holdStep(keys, pick, by));
    }
    else if (e.key === 'Home') { e.preventDefault(); go(holdAt(keys, 0)); }
    else if (e.key === 'End') { e.preventDefault(); go(holdAt(keys, Math.max(keys.length - 1, 0))); }
    else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); if (canUnarchive) unarchive(flat[pick]); }
    else if (e.key === 'Enter' && flat[pick]) { e.preventDefault(); open(flat[pick]); }
  };

  // Only the chip in use is a tab stop, so Tab passes the row once. The arrows move the focus and the choice along it together,
  // wrapping at the ends as Radix's do, so the focus stays on the row. A click or Enter on a chip hands the focus back to the field.
  const onChipKey = e => {
    const at = CHIPS.findIndex(([key]) => key === chip);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: CHIPS.length - 1 }[e.key];
    if (to === undefined || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    const next = (to + CHIPS.length) % CHIPS.length;
    select(CHIPS[next][0]);
    e.currentTarget.children[next].focus();
  };

  const moved = at => e => {
    const was = pointer.current;
    pointer.current = [e.clientX, e.clientY];
    if (was && was[0] === e.clientX && was[1] === e.clientY) return;
    if (at !== pick) setHeld(holdAt(keys, at));
  };

  const index = new Map(flat.map((it, i) => [it, i]));
  return html`<div data-part="command-dialog-header">
      <h2 id="command-title" data-slot="dialog-title">Search</h2>
      <p id="command-description" data-slot="dialog-description">Find a session, a group, a project or an action.</p>
    </div>
    <div data-slot="command" data-part="command-dialog-command">
      <div data-slot="command-input-wrapper">
        <${Search} />
        <input data-slot="command-input" cmdk-input="" ref=${input} type="text" role="combobox" placeholder="Search" autocomplete="off" autocorrect="off" spellcheck=${false} enterkeyhint="search"
          aria-label="Search" aria-autocomplete="list" aria-expanded="true" aria-controls="command-list" aria-activedescendant=${flat[pick] ? `result-${pick}` : undefined} value=${query}
          onInput=${e => { setQuery(e.target.value); scroll.current = true; setHeld(FIRST); }} onKeyDown=${onKeyDown} />
      </div>
      <div class="chips" role="tablist" aria-label="What to search" onKeyDown=${onChipKey}>
        ${CHIPS.map(([key, label]) => html`<button key=${key} class="chip" type="button" role="tab" aria-selected=${chip === key} tabindex=${chip === key ? 0 : -1} onClick=${() => choose(key)}>${label}</button>`)}
      </div>
      <div data-slot="command-list" cmdk-list="" id="command-list" role="listbox" aria-label="Results" tabindex="-1" ref=${list}>
        ${sections.length
          ? sections.map(s => html`<div key=${s.key} data-slot="command-group" cmdk-group="" role="presentation">
              <div cmdk-group-heading="" aria-hidden="true" id=${`group-${s.key}`}>${s.title}</div>
              <div cmdk-group-items="" role="group" aria-labelledby=${`group-${s.key}`}>
                ${s.items.map(it => html`<${Hit} key=${it.key} it=${it} id=${`result-${index.get(it)}`} selected=${index.get(it) === pick} onPick=${open} onMove=${moved(index.get(it))} />`)}
              </div>
            </div>`)
          : html`<div data-slot="command-empty" cmdk-empty="" role="presentation">${ix ? emptyText(chip, query) : 'Loading sessions'}</div>`}
      </div>
      <footer data-part="command-footer">
        <span>Close <kbd>Esc</kbd></span><span>Change type <kbd>←</kbd><kbd>→</kbd></span><span>Open <kbd>↵</kbd></span>
        ${canUnarchive ? html`<span>Unarchive <kbd>⇧↵</kbd></span>` : null}
      </footer>
    </div>`;
}
