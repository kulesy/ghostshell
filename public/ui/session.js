// One open chat: the transcript, the live event stream and every action on them. It is plain data and functions, so
// the components only draw what is in its store and call what it returns.
import { api } from './api.js';
import { mergeContext } from './context-rules.js';
import { HOME } from './env.js';
import { leadingMentions } from './files.js';
import { payload } from './images.js';
import { createStore } from './store.js';
import { heardAgents } from './subagent-rules.js';
import { createTerminal } from './terminal-state.js';
import { absorb, prepend } from './thread.js';

const enc = encodeURIComponent;

// The first message of a session started here shows as a bubble until its transcript has it.
let startedHere = null;

// A bubble that is still being sent and the transcript's copy of it are one message when the words and the number of images and files match.
// With files attached, the transcript's copy has their mentions taken out and the words are the typed ones. With none, the words may start
// with a mention the owner typed, which the transcript takes out as well and counts as a file.
const sameMessage = (item, m) => {
  const typed = m.files?.length ? { paths: [], text: m.text } : leadingMentions(m.text);
  return item.kind === 'user' && item.text.trim() === typed.text.trim() && (item.images?.length || 0) === m.images.length
    && (item.files?.length || 0) === (m.files?.length || 0) + typed.paths.length;
};

// When the turn began by this page's clock. A later report can only move it earlier, so a slow one never steps the timer back.
const began = work => (work ? Date.now() - work.turnMs : 0);

// A finished block is kept until the transcript has it, so the text does not vanish before its saved row arrives.
const thought = (shown, d) => (d.done
  ? (shown?.id === d.id ? { ...shown, done: true } : shown)
  : { id: d.id, done: false, text: (shown?.id === d.id ? shown.text : '') + d.text });

// Desktop can name a session's connectors after the chat opened, as when the chat moves to Desktop, so each reply brings them.
// Every row compares the names, so names equal to the ones held are not set again.
const sameNames = (a, b) => {
  const keys = Object.keys(a || {});
  return keys.length === Object.keys(b || {}).length && keys.every(k => Object.hasOwn(b, k) && b[k] === a[k]);
};

// The CLI holds at most 100 messages at once, so keeping that many counts a burst that ended together in full.
const ENDED_KEPT = 100;

// A transcript changes all through a turn, so the window is counted at most this often.
const CONTEXT_EVERY = 5000;

// A chat's pane is built again each time the owner opens another chat, so the holds that ended undelivered wait here by chat id.
const endedByChat = new Map();

const OPEN_FAILED = 'Could not open this session: ';

// `toast` shows a note on the screen. The page passes it in so this file loads without the page's components.
export function createChat({ id = null, draft = false, row = null, refreshIndex, toast = () => {} }) {
  const first = !draft && startedHere?.id === id ? startedHere : null;
  if (first) startedHere = null;
  // Until a new session starts, the box holds its settings here; the ones left alone follow the home folder's defaults.
  const touched = draft ? new Set() : null;
  const store = createStore({
    items: [], orphans: new Map(), chips: new Map(), start: 0, end: 0, hasEarlier: false, loaded: false, failed: false, fileLinks: false, terminal: false,
    status: draft ? { state: 'idle', pending: [], mode: 'manual', model: null, shownModel: null, effort: null, fast: false } : null,
    live: '', think: null, work: null, turnStart: 0, outside: null, outsideStart: 0, agents: null, holdsEnded: endedByChat.get(id) || [],
    group: null, sending: first ? [{ text: first.text, images: first.images, files: first.files }] : [], notice: '', starting: false, loadingEarlier: false,
    session: row && { title: row.title, cwd: row.cwd, branch: row.branch, routine: row.routine },
    jump: 0, earlierSeq: 0, context: null,
  });
  const state = store.get;
  // A new session has no id until it starts, so it has no terminal.
  const term = draft ? null : createTerminal({ id, enabled: () => state().terminal });
  let closed = false;
  let es = null;
  let fetching = false;
  let again = false;
  // Once a turn ends the streamed text stays up until the transcript has the real message, so it never blinks out.
  let ended = false;
  let earlier = null;
  let contextAt = -Infinity;
  let contextTimer = 0;
  // Each count is numbered as it is asked, and `shown` is the number of the one on show.
  let sent = 0;
  let shown = 0;
  const asking = {};

  const keepEnded = holdsEnded => { endedByChat.set(id, holdsEnded); return { holdsEnded }; };
  const notice = text => store.set({ notice: text || '' });
  const patchStatus = patch => store.set(s => ({ status: { ...s.status, ...patch } }));
  const onVisible = () => { if (!document.hidden) fetchNew(); };

  async function loadChips() {
    try {
      const { chips } = await api(`api/sessions/${enc(id)}/chips`);
      return new Map(chips.map(ch => [ch.toolUseId, ch]));
    } catch { return null; }
  }

  async function load() {
    try {
      const r = await api(`api/sessions/${enc(id)}/messages`);
      if (closed) return;
      store.set(s => ({ session: r.session || s.session, fileLinks: r.fileLinks === true, terminal: r.terminal === true }));
      const thread = absorb({ items: [], orphans: new Map() }, r.items);
      const chips = await loadChips();
      if (closed) return;
      store.set(s => ({
        ...thread, ...(chips && { chips }), start: r.start, end: r.end, hasEarlier: r.hasEarlier, loaded: true, failed: false,
        sending: s.sending.filter(m => !thread.items.some(i => sameMessage(i, m))),
      }));
    } catch (e) {
      if (closed) return;
      store.set({ failed: true });
      notice(`${OPEN_FAILED}${e.message}`);
    }
  }

  async function open() {
    document.addEventListener('visibilitychange', onVisible);
    if (draft) {
      loadDefaults();
      return;
    }
    await load();
    if (!closed) connect();
  }

  // The event stream is already connected, so a retry only asks for the history again.
  async function retry() {
    if (!state().failed) return;
    store.set(s => ({ failed: false, notice: s.notice.startsWith(OPEN_FAILED) ? '' : s.notice }));
    await load();
    if (closed || state().failed) return;
    // Events that came in while the history was missing were dropped, and a reply that finished meanwhile is a row now.
    store.set({ live: '', think: null });
    fetchNew();
  }

  function close() {
    closed = true;
    clearTimeout(contextTimer);
    es?.close();
    document.removeEventListener('visibilitychange', onVisible);
  }

  // ---- the live event stream ---------------------------------------------------------------------------

  function connect() {
    es = new EventSource(`api/sessions/${enc(id)}/events`);
    const on = (type, fn) => es.addEventListener(type, e => { if (!closed) fn(JSON.parse(e.data || '{}')); });
    on('status', s => { ended = false; store.set({ status: s, live: s.live || '', think: s.think || null, work: s.work || null, turnStart: began(s.work), outside: s.outside || null, outsideStart: began(s.outside), notice: '' }); fetchNew(); refreshContext(); });
    // Capcom's own work takes over from a turn another app was running, and the old line must not flash back when its turn ends.
    on('state', d => { patchStatus({ state: d.state }); store.set(d.state === 'idle' ? { work: null, turnStart: 0 } : { outside: null, outsideStart: 0 }); });
    on('delta', d => { const fresh = ended; ended = false; store.set(s => ({ live: (fresh ? '' : s.live) + d.text })); });
    on('think', d => store.set(s => ({ think: thought(s.think, d) })));
    // A turn that begins here reloads the list, so its row's time starts with this line. The state cannot tell, as send() sets it first.
    on('work', d => { const begun = d && d.startedAt !== state().work?.startedAt; store.set(s => ({ work: d, turnStart: s.work ? Math.min(s.turnStart, began(d)) : began(d) })); if (begun) refreshIndex(); });
    // Another app's turn beginning or ending reloads the list, so the row's time keeps up with this line.
    on('subagents', d => store.set(s => ({ agents: heardAgents(s.agents, d?.agents) })));
    on('outside', d => { const turned = (d?.startedAt ?? null) !== (state().outside?.startedAt ?? null); store.set(s => ({ outside: d, outsideStart: !d ? 0 : s.outside?.startedAt === d.startedAt ? Math.min(s.outsideStart, began(d)) : began(d) })); if (turned) refreshIndex(); });
    on('changed', () => { fetchNew(); refreshContext(); });
    on('approval', p => store.set(s => ({ status: { ...s.status, pending: [...(s.status?.pending || []).filter(x => x.requestId !== p.requestId), p] } })));
    on('approval-resolved', d => store.set(s => ({ status: { ...s.status, pending: (s.status?.pending || []).filter(x => x.requestId !== d.requestId) } })));
    on('hold', h => store.set(s => ({ status: { ...s.status, holds: [...(s.status?.holds || []).filter(x => x.id !== h.id), h] } })));
    on('hold-ended', d => store.set(s => ({
      status: { ...s.status, holds: (s.status?.holds || []).filter(x => x.id !== d.id) },
      ...(d.state === 'dropped' && keepEnded([...s.holdsEnded.filter(x => x.id !== d.id), d].slice(-ENDED_KEPT))),
    })));
    on('mode', d => patchStatus({ mode: d.mode }));
    on('model', d => { patchStatus({ model: d.model, shownModel: d.model }); refreshContext(); });
    on('fast', d => patchStatus({ fast: d.fast }));
    on('effort', d => patchStatus({ effort: d.effort }));
    on('turn-end', d => { ended = true; if (d.error) notice(d.message || 'The last turn ended with an error.'); fetchNew(); refreshIndex(); refreshContext(); });
    on('terminal', d => { if (state().terminal) term.apply(d); });
    on('error', d => notice(d.message));
    on('exit', () => { patchStatus({ running: false, state: 'idle', pending: [], holds: [] }); store.set({ work: null, turnStart: 0 }); refreshContext(); });
    es.onerror = () => { if (!closed) notice(es.readyState === EventSource.CLOSED ? 'Lost contact with the Mac.' : ''); };
  }

  // ---- reading the transcript --------------------------------------------------------------------------

  // One fetch at a time: an event that arrives meanwhile asks for another once this one is done.
  async function fetchNew() {
    if (!state().loaded) return;
    if (fetching) { again = true; return; }
    fetching = true;
    try {
      const r = await api(`api/sessions/${enc(id)}/messages?after=${state().end}`);
      if (closed) return;
      // Chips are loaded first so a new chip never shows as open for a moment when it is already settled.
      const chips = r.items.some(i => /__(spawn|dismiss)_task$/.test(i.name || '')) ? await loadChips() : null;
      if (closed) return;
      const over = ended;
      const clearLive = over || r.items.some(i => i.kind === 'assistant');
      ended = false;
      const names = r.session?.connectors;
      store.set(s => {
        const thread = absorb(r.reset ? { items: [], orphans: new Map() } : s, r.items);
        const saved = s.think?.done && r.items.some(i => i.kind === 'thinking' && i.msgId === s.think.id);
        return {
          ...thread, ...(chips && { chips }), end: r.end,
          ...(r.reset && { start: r.start, hasEarlier: r.hasEarlier }),
          ...(s.session && names && !sameNames(names, s.session.connectors) && { session: { ...s.session, connectors: names } }),
          sending: s.sending.filter(m => !r.items.some(i => sameMessage(i, m))),
          ...(clearLive && { live: '' }),
          ...((over || saved) && { think: null }),
        };
      });
    } catch (e) {
      notice(e.message);
    } finally {
      fetching = false;
      if (again) { again = false; fetchNew(); }
    }
  }

  // ---- the context window ------------------------------------------------------------------------------

  // How full the window is. The server asks Claude when Capcom runs the chat and reads the transcript when it does not. A failed ask
  // leaves the last figure on show, and a draft has no window yet.
  function loadContext(detail = 'summary') {
    if (draft) return Promise.resolve(null);
    asking[detail] ??= (async () => {
      try {
        // A reply asked for before the one on show is out of date, so it is dropped. A full count dropped so is asked for once more,
        // inside this promise, so that whoever waits on it gets the parts.
        for (let retry = detail === 'full'; ; retry = false) {
          const n = ++sent;
          const reply = await api(`api/sessions/${enc(id)}/context`, { detail });
          if (closed) return null;
          if (n > shown) {
            shown = n;
            const context = mergeContext(state().context, reply, detail);
            if (context !== state().context) store.set({ context });
            return context;
          }
          if (!retry) return state().context;
        }
      } catch {
        return null;
      } finally {
        asking[detail] = null;
      }
    })();
    return asking[detail];
  }

  // A count that comes sooner than CONTEXT_EVERY after the last one waits for it, and the many that arrive while it waits are one.
  function refreshContext() {
    if (draft || closed) return;
    const wait = Math.min(CONTEXT_EVERY, contextAt + CONTEXT_EVERY - Date.now());
    if (wait > 0) {
      contextTimer ||= setTimeout(() => { contextTimer = 0; refreshContext(); }, wait);
      return;
    }
    contextAt = Date.now();
    loadContext();
  }

  async function loadEarlier() {
    store.set({ loadingEarlier: true });
    try {
      const r = await api(`api/sessions/${enc(id)}/messages?before=${state().start}`);
      if (closed) return;
      store.set(s => ({ ...prepend(s, r.items), start: r.start, hasEarlier: r.hasEarlier, earlierSeq: s.earlierSeq + 1 }));
    } catch (e) {
      notice(e.message);
    } finally {
      if (!closed) store.set({ loadingEarlier: false });
    }
  }

  // The viewer's pictures from before the loaded messages. The answer is kept for this `start`, so the viewer opens at once the
  // next time, and dropped when it fails so the next open asks again.
  function earlierImages() {
    const { start } = state();
    if (earlier?.start !== start) {
      const asked = api(`api/sessions/${enc(id)}/images?before=${start}`).then(r => r.items, err => {
        if (earlier?.asked === asked) earlier = null;
        throw err;
      });
      earlier = { start, asked };
    }
    return earlier.asked;
  }

  // ---- talking to Claude -------------------------------------------------------------------------------

  // Sent while Claude works, a message redirects it without stopping: Claude reads it before its next step.
  async function send(text, images, mode, files = []) {
    const message = { text, images, files };
    store.set(s => ({ sending: [...s.sending, message], notice: '', jump: s.jump + 1 }));
    try {
      const { unarchived, ...status } = await api(`api/sessions/${enc(id)}/send`, { text, mode, ...(images.length && { images: payload(images) }), ...(files.length && { files: files.map(f => f.id) }) });
      // Each change of fast mode reaches the page over SSE, and a reply can be older than the last one.
      if (!closed) store.set(s => ({ status: { ...status, fast: s.status ? s.status.fast : status.fast } }));
      if (unarchived) refreshIndex();
      return true;
    } catch (err) {
      if (!closed) store.set(s => ({ sending: s.sending.filter(m => m !== message), notice: `Not sent: ${err.message}` }));
      return false;
    }
  }

  // A widget's button sends its text as the owner's message, in the mode the prompt box would use for a plain message.
  const prompt = text => send(text, [], (state().status || { mode: 'manual' }).mode);

  async function stop() {
    try { await api(`api/sessions/${enc(id)}/stop`, {}); } catch (e) { notice(e.message); }
  }

  // Resolves true once the server has the answer, so a card can leave its buttons off and wait for the event that clears it.
  async function decide(requestId, decision, answers) {
    try {
      await api(`api/sessions/${enc(id)}/approve`, { requestId, decision, ...(decision === 'answer' && { answers }) });
      return true;
    } catch (err) {
      notice(err.message);
      return false;
    }
  }

  const dismissHold = ids => store.set(s => keepEnded(s.holdsEnded.filter(d => !ids.includes(d.id))));

  // A 409 means the chip was settled somewhere else, and the error carries its current state for the card to show.
  async function chip(action, tool, folder) {
    const keep = c => store.set(s => ({ chips: new Map(s.chips).set(tool.id, c) }));
    try {
      const r = await api(`api/chips/${action}`, {
        sessionId: id, toolUseId: tool.id, title: tool.input?.title, tldr: tool.input?.tldr,
        prompt: tool.input?.prompt, cwd: tool.input?.cwd, confirmCwd: folder, model: tool.input?.model, effort: tool.input?.effort,
      });
      keep(r.chip);
      refreshIndex();
      return true;
    } catch (err) {
      if (err.data?.chip) { keep(err.data.chip); return true; }
      notice(err.message);
      return false;
    }
  }

  // ---- the settings under the prompt box ---------------------------------------------------------------

  function setDraft(patch) {
    for (const k of Object.keys(patch)) touched.add(k === 'shownModel' ? 'model' : k);
    patchStatus(patch);
  }

  // Claude can refuse a switch, so a failed one puts the picker back where it was.
  async function setMode(mode) {
    if (draft) return setDraft({ mode });
    const before = state().status?.mode;
    patchStatus({ mode });
    try {
      await api(`api/sessions/${enc(id)}/mode`, { mode });
    } catch (err) {
      if (closed) return;
      patchStatus({ mode: before });
      notice(err.message);
    }
  }

  // The change shows at once and applies from Claude's next request, even mid-turn. When Claude refuses it, the page shows the status
  // Capcom answers with, which holds a later pick that went through, and puts the old value back only when there is none.
  // `kind` is 'model', 'effort' or 'fast', and fast mode's value is true or false.
  async function pick(kind, value) {
    const patch = kind === 'model' ? { model: value, shownModel: value } : { [kind]: value };
    if (draft) return setDraft(patch);
    const before = state().status || {};
    patchStatus(patch);
    try {
      const status = await api(`api/sessions/${enc(id)}/${kind}`, { [kind]: value });
      if (!closed) store.set({ status });
      if (kind === 'model') refreshContext();
    } catch (err) {
      if (closed) return;
      if (err.data?.status) store.set({ status: err.data.status });
      else patchStatus(Object.fromEntries(Object.keys(patch).map(k => [k, before[k]])));
      notice(err.message);
    }
  }

  // ---- starting a session ------------------------------------------------------------------------------

  // A new session starts the way Desktop would start one in the home folder: its mode there, and its effort.
  async function loadDefaults() {
    try {
      const d = await api(`api/defaults?cwd=${enc(HOME)}`);
      if (closed) return;
      patchStatus({ ...(!touched.has('mode') && { mode: d.mode }), ...(!touched.has('model') && { model: d.model, shownModel: d.shownModel }), ...(!touched.has('effort') && { effort: d.effort }) });
    } catch {}
  }

  // The first message goes to the new session; the page follows once the list knows about it.
  async function startNew(text, images, onCreated, files = []) {
    if (state().starting) return;
    const s = state().status;
    const group = state().group;
    store.set({ starting: true, notice: '' });
    try {
      const { id: created } = await api('api/new', {
        cwd: HOME, text, mode: s.mode, ...(images.length && { images: payload(images) }), ...(files.length && { files: files.map(f => f.id) }),
        ...(touched.has('model') && { model: s.shownModel }), ...(touched.has('effort') && { effort: s.effort }), ...(touched.has('fast') && { fast: s.fast }),
      });
      onCreated();
      let notPlaced = null;
      // Placed before this function reads the list; a refresh elsewhere can still draw it ungrouped for a moment. A failure still opens it.
      if (group) {
        try { await api('api/layout/move', { id: created, group }); } catch (err) { notPlaced = err; }
      }
      startedHere = { id: created, text, images, files };
      await refreshIndex();
      location.hash = `#/s/${enc(created)}`;
      if (notPlaced) toast(`Started the session, but could not put it in the group: ${notPlaced.message}`, { problem: true });
    } catch (err) {
      notice(err.message);
    } finally {
      if (!closed) store.set({ starting: false });
    }
  }

  // Where the page loads an image from, given the ref the transcript put on it.
  const imageUrl = ref => `api/sessions/${enc(id)}/images/${enc(ref)}`;
  const fileUrl = path => `api/sessions/${enc(id)}/file?path=${enc(path)}`;

  return {
    id, draft: draft ? { touched } : null, store, term, open, close, fetchNew, loadEarlier, earlierImages, loadContext, retry,
    send, prompt, stop, decide, dismissHold, chip, setMode, pick, startNew, notice, imageUrl, fileUrl,
  };
}
