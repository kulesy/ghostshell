import { api } from './ui/api.js';
import { AskHost } from './ui/ask.js';
import { ChatPane } from './ui/chat.js';
import { groupById, groupOfSession, parseNewRoute } from './ui/group-rules.js';
import { GroupPane } from './ui/group.js';
import { checkUploads } from './ui/draft.js';
import { useModifier } from './ui/hooks.js';
import { Fragment, html, render, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from './ui/html.js';
import { PasskeyOffer, PasskeysPane, usePasskeyOffer } from './ui/passkeys.js';
import { useProjects } from './ui/projects.js';
import { useRenewal } from './ui/renew.js';
import { routineRoute } from './ui/routine-rules.js';
import { RoutinesPane } from './ui/routines.js';
import { newSession, SessionList } from './ui/sessions-list.js';
import { Shell } from './ui/shell.js';
import { keyHint, shortcut } from './ui/shortcuts.js';
import { Spotlight } from './ui/spotlight.js';
import { sessionIndex } from './ui/subs.js';
import { ToastHost } from './ui/toast.js';
import { installTooltips } from './ui/tooltip.js';
import { findRow, nestRow, placeRow, sortGroups, stampTurns, unnestRow, withoutRow } from './ui/tree.js';
import { ViewerHost } from './ui/viewer.js';

// #/ is the list, #/s/<id> a session, #/g/<id> a group's own session, #/new an empty chat for a session not started yet (#/new/<id> with a group chosen to start it in),
// #/passkeys the passkeys and #/routines the routines, with #/routines/new to add one and #/routines/<id> to edit one.
function parseRoute(hash) {
  try {
    if (hash.startsWith('#/s/')) return { name: 'session', id: decodeURIComponent(hash.slice(4)) };
    if (hash.startsWith('#/g/')) return { name: 'group', id: decodeURIComponent(hash.slice(4)) };
  } catch {}
  const fresh = parseNewRoute(hash);
  if (fresh) return { name: 'new', group: fresh.group };
  const routines = routineRoute(hash);
  if (routines) return { name: 'routines', ...routines };
  return { name: hash === '#/passkeys' ? 'passkeys' : 'list' };
}

function App() {
  const [hash, setHash] = useState(location.hash);
  const [ix, setIx] = useState(null);
  const [error, setError] = useState('');
  const [routines, setRoutines] = useState(null);
  const [routinesError, setRoutinesError] = useState('');
  const [ready, setReady] = useState(false);
  const [finding, setFinding] = useState(false);
  const now = useRef({});
  now.current = { ix };
  useLayoutEffect(() => { sessionIndex.set({ ix }); }, [ix]);
  const latest = useRef(0);
  const shown = useRef(0);
  const routinesShown = useRef({ asked: 0, drawn: 0 });
  const writing = useRef(0);
  const taking = useRef(new Set());
  const [offering, stopOffering] = usePasskeyOffer();
  const mod = useModifier();
  const flipKey = useRef(null);
  useRenewal();

  // A list is drawn only if it is newer than the one on screen, so a slow answer cannot put an older list back, and once a load
  // finishes the screen shows its list or a newer one.
  const loadIndex = useCallback(async () => {
    const mine = ++latest.current;
    const hiding = [...taking.current];
    try {
      const loaded = await api('api/sessions');
      const arrived = Date.now();
      // A list asked for in the middle of an archive batch still has the rows the batch has not reached, which would flicker back.
      const next = hiding.reduce((list, id) => withoutRow(list, id), sortGroups(loaded));
      if (mine > shown.current) { shown.current = mine; setIx(stampTurns(next, now.current.ix, arrived)); setError(''); }
    } catch (e) {
      if (!now.current.ix) setError(e.message);
    }
  }, []);

  // The routines come from their own request, and an answer older than the one on screen is dropped, as the list's is.
  const loadRoutines = useCallback(async () => {
    const mine = ++routinesShown.current.asked;
    try {
      const loaded = await api('api/routines');
      if (mine > routinesShown.current.drawn) { routinesShown.current.drawn = mine; setRoutines(loaded); setRoutinesError(''); }
    } catch (e) {
      setRoutinesError(e.message);
    }
  }, []);

  // After a change to a routine, both show it: the routines and the sessions its runs start.
  const refreshRoutines = useCallback(() => Promise.all([loadRoutines(), loadIndex()]), []);

  // A session's route waits for a list, so the session opens with its name already known, unless the first load fails.
  useEffect(() => { loadIndex().then(() => setReady(true)); loadRoutines(); }, []);
  useEffect(() => { checkUploads(); }, []);

  // A drop shows at once and the server's list then replaces the guess. If the server refuses, the row goes back and the reason is returned.
  // The old list goes back only while none has been drawn since, or it would undo that one. The reload puts the row back then.
  // A row's menu can outlive the row when a reload takes it away, so a session that is no longer listed is refused here. It resolves
  // once the server's list is drawn, so the focus can go back to the row where that list puts it.
  const place = useCallback(async (id, section) => {
    const before = now.current.ix;
    const pin = section === 'pinned';
    if (!findRow(before, id)) return `${pin ? 'Not pinned' : 'Not moved'}: that session is no longer in the list.`;
    const guess = placeRow(before, id, section);
    if (guess === before) return '';
    const group = before.groups.some(g => g.id === section) ? section : null;
    const mark = ++latest.current;
    setIx(guess);
    shown.current = mark;
    writing.current++;
    try {
      await api(pin ? 'api/layout/pin' : 'api/layout/move', pin ? { id, pinned: true } : { id, group });
      return '';
    } catch (e) {
      if (shown.current === mark) setIx(before);
      return `${pin ? 'Not pinned' : 'Not moved'}: ${e.message}`;
    } finally {
      writing.current--;
      await loadIndex();
    }
  }, []);

  // Nesting shows at once as a drop does, and the server's list then replaces the guess. A `parent` of null takes the row out of its
  // parent. It resolves with the reason when the server refuses, or an empty string, and a nesting that changes nothing sends nothing.
  const nest = useCallback(async (id, parent) => {
    const before = now.current.ix;
    const refused = parent ? 'Not nested' : 'Not moved out';
    if (!findRow(before, id) || (parent && !findRow(before, parent))) return `${refused}: that session is no longer in the list.`;
    const guess = parent ? nestRow(before, id, parent) : unnestRow(before, id);
    if (guess === before) return '';
    const mark = ++latest.current;
    setIx(guess);
    shown.current = mark;
    writing.current++;
    try {
      await api('api/layout/nest', { id, parent });
      return '';
    } catch (e) {
      if (shown.current === mark) setIx(before);
      return `${refused}: ${e.message}`;
    } finally {
      writing.current--;
      await loadIndex();
    }
  }, []);

  // Archiving takes the row out at once and puts it back if the server refuses, while no other list has been drawn since. Unarchiving
  // waits for the server's list, because the server says where the session lands. It resolves with { problem, stopped, running }: the
  // reason when the server refuses, whether it stopped a chat that was running, and whether it refused because the chat was running and
  // `stop` was false, which leaves it archived by no one. The server's list is drawn before it resolves.
  const archive = useCallback(async (id, archived, { stop = true } = {}) => {
    const before = now.current.ix;
    const mark = archived ? ++latest.current : 0;
    if (archived) {
      setIx(withoutRow(before, id));
      shown.current = mark;
    }
    writing.current++;
    try {
      const reply = await api('api/layout/archive', stop ? { id, archived } : { id, archived, stop: false });
      return { problem: '', stopped: !!reply.stopped, running: false };
    } catch (e) {
      if (archived && shown.current === mark) setIx(before);
      return { problem: `${archived ? 'Not archived' : 'Not unarchived'}: ${e.message}`, stopped: false, running: e.status === 409 };
    } finally {
      writing.current--;
      await loadIndex();
    }
  }, []);

  // Archives or unarchives several sessions one after another, one request each, and loads the list once at the end. Archiving takes
  // every row out at once, and the rows the server refused come back at once. It resolves with { done, stopped, failed }: the ids the
  // server took, how many of those were running chats it stopped, and { id, message, running } for each it refused.
  const archiveAll = useCallback(async (ids, archived, { stop = true } = {}) => {
    const before = now.current.ix;
    const without = gone => gone.reduce((list, id) => withoutRow(list, id), before);
    const mark = archived ? ++latest.current : 0;
    if (archived) {
      setIx(without(ids));
      shown.current = mark;
    }
    writing.current++;
    if (archived) ids.forEach(id => taking.current.add(id));
    const done = [];
    const failed = [];
    let stopped = 0;
    try {
      for (const id of ids) {
        try {
          const reply = await api('api/layout/archive', stop ? { id, archived } : { id, archived, stop: false });
          done.push(id);
          if (reply.stopped) stopped++;
        } catch (e) {
          taking.current.delete(id);
          failed.push({ id, message: e.message, running: e.status === 409 });
        }
      }
      if (archived && failed.length && shown.current === mark) setIx(without(done));
      return { done, stopped, failed };
    } finally {
      writing.current--;
      ids.forEach(id => taking.current.delete(id));
      await loadIndex();
    }
  }, []);

  // A change to a project or group. It resolves with { problem, made }: the reason when the server refuses, or an empty string and
  // the project or group the server made, changed or removed. Either way the list is loaded again before it resolves.
  const edit = useCallback(async (path, body) => {
    writing.current++;
    try {
      return { problem: '', made: await api(path, body) };
    } catch (e) {
      return { problem: e.message, made: null };
    } finally {
      writing.current--;
      await loadIndex();
    }
  }, []);

  useEffect(() => {
    const refresh = () => { if (!document.hidden && !writing.current) { loadIndex(); loadRoutines(); } };
    const timer = setInterval(refresh, 15_000);
    const onHash = () => setHash(location.hash);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('hashchange', onHash);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  // Ctrl+N starts a session, Ctrl+K finds one and Ctrl+B shows or hides the projects sidebar. Cmd+K and Cmd+B work too, and so does
  // Cmd+N in the installed app. The list takes Cmd+A, because it knows which row has the focus.
  useEffect(() => {
    const onKey = e => {
      const asked = shortcut(e);
      if (asked !== 'new' && asked !== 'find' && asked !== 'projects') return;
      e.preventDefault();
      if (asked === 'new') { setFinding(false); newSession(); }
      else if (asked === 'projects') flipKey.current();
      else setFinding(open => !open);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const parsed = useMemo(() => parseRoute(hash), [hash]);
  // A group's session has a route of its own, so a link to it by its id opens the group, and the address is changed to match.
  const owner = parsed.name === 'session' ? groupOfSession(ix, parsed.id) : null;
  useEffect(() => { if (owner) location.replace(`#/g/${encodeURIComponent(owner.id)}`); }, [owner?.id]);
  const route = useMemo(() => (owner ? { name: 'group', id: owner.id } : parsed), [parsed, owner?.id]);
  // A new session needs no list, so it opens at once.
  const view = route.name !== 'list' && (route.name === 'new' || ready || ix) ? 'chat' : 'list';
  const id = route.name === 'session' ? route.id : null;
  const row = findRow(ix, id);
  // A group's session is not a row, but the list and the projects still follow it as the chat on screen.
  const groupSession = route.name === 'group' ? groupById(ix, route.id)?.session?.id ?? null : null;
  const current = view === 'chat' ? id ?? groupSession : null;
  // A view picked where a chat has the screen puts the list there. The route is set in state at once, so the list is on screen when
  // the focus moves to it.
  const toList = () => {
    if (view === 'list') return;
    location.hash = '#/';
    setHash(location.hash);
  };
  const projects = useProjects(ix, current, hash, toList);
  useEffect(() => { if (view === 'list') document.title = 'GhostShell'; }, [view]);

  // A view picked in the search, or a group in one.
  const showView = (viewId, groupId) => {
    setFinding(false);
    projects.show(viewId, groupId);
  };

  // Ctrl+B or Cmd+B. The search closes with the focus on the button that opens the sidebar, once the search has let go of the focus.
  flipKey.current = () => {
    setFinding(false);
    if (finding && projects.wide) queueMicrotask(() => projects.opener.current?.focus());
    projects.flip();
  };

  return html`<${Fragment}>
  <div class="app" id="app" data-view=${view}>
    <${SessionList} ix=${ix} projects=${projects} error=${error} current=${current} place=${place} nest=${nest} edit=${edit} archive=${archive} archiveAll=${archiveAll} onFind=${() => setFinding(true)} passkeys=${route.name === 'passkeys'}
      routines=${routines} routinesOpen=${route.name === 'routines'} refreshRoutines=${refreshRoutines}
      banner=${offering ? html`<${PasskeyOffer} onDone=${stopOffering} />` : null} />
    <main class="chat" id="chat">
      <section class="empty" id="empty" hidden=${view !== 'list'}>
        <div class="emblem" aria-hidden="true"><${Shell} class="emblem-shell" /><span class="emblem-shadow"></span></div>
        <p>Pick a session, press <kbd>${keyHint(mod, 'K')}</kbd> to find one, or <kbd>${keyHint(mod, 'N')}</kbd> to start a new one.</p>
      </section>
      ${view === 'chat' && route.name === 'passkeys' ? html`<${PasskeysPane} />` : null}
      ${view === 'chat' && route.name === 'routines' ? html`<${RoutinesPane} ix=${ix} route=${route} routines=${routines} error=${routinesError} reload=${loadRoutines} refresh=${refreshRoutines} />` : null}
      ${view === 'chat' && route.name === 'group' ? html`<${GroupPane} key=${route.id} id=${route.id} ix=${ix} refreshIndex=${loadIndex} />` : null}
      ${view === 'chat' && route.name !== 'passkeys' && route.name !== 'routines' && route.name !== 'group' ? html`<${ChatPane} key=${id ?? 'new'} id=${id} row=${row} title=${row?.title} refreshIndex=${loadIndex} group=${route.name === 'new' ? route.group : null} />` : null}
    </main>
  </div>
  <${Spotlight} open=${finding} ix=${ix} archive=${archive} onShow=${showView} onClose=${() => setFinding(false)} />
  <${ViewerHost} />
  <${AskHost} />
  <${ToastHost} />
<//>`;
}

installTooltips();
document.getElementById('boot').remove();
document.getElementById('unsupported').remove();
render(html`<${App} />`, document.getElementById('root'));
