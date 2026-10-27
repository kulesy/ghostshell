// Names the sessions GhostShell starts. A session started with a title (a chip, a group chat's start tool) keeps it, and one started by typing is
// named once its first turn ends, by a model that is asked through `ask`. The rules here take no model, so node tests them alone.
// See docs/adr/20261027-name-sessions-from-their-first-turn.md.
import { cleanName, showsNothing, MAX_TITLE } from './layout.mjs';

const FIRST_KEPT = 600;
const REPLY_KEPT = 800;
// Listening stops adding past this, so a long reply cannot grow the string without bound.
const REPLY_HEARD = 2000;
const TITLE_CHARS = 80;
const TITLE_WORDS = 12;
const FALLBACK_SHORT = 60;

export const TITLE_SYSTEM = 'You name chat sessions. Reply with the title only: 3 to 8 words, no quotes, no trailing period. '
  + 'Use "Area - task" when an area such as UI, Server, Auth, Docs or Tests is clear, otherwise a plain phrase.';

const clip = (text, limit) => [...String(text ?? '').trim()].slice(0, limit).join('');

// What the model reads: the first message and, when there is one, the first reply, each cut to its head.
export function promptFor({ first, reply }) {
  const said = clip(reply, REPLY_KEPT);
  return `First message:\n${clip(first, FIRST_KEPT)}${said ? `\n\nFirst reply:\n${said}` : ''}`;
}

const WRAPS = [['"', '"'], ["'", "'"], ['`', '`'], ['“', '”'], ['‘', '’'], ['**', '**'], ['*', '*'], ['_', '_']];
// A reply that talks to the owner is no title, whatever its length.
const TALKS = /^(sorry|i\s|i'|unfortunately|as an ai|please|could you|can you|it seems|it looks like|here is|here's|there is no|there's no)/i;

// Cuts at a word that fits, so a title never ends half way through one.
function atWord(text, limit, floor = 0) {
  const chars = [...text];
  if (chars.length <= limit) return text;
  const head = chars.slice(0, limit).join('');
  const space = head.lastIndexOf(' ');
  return (space > floor ? head.slice(0, space) : head).trimEnd();
}

// The model's answer as a title, or '' when it is not one.
export function tidyTitle(raw) {
  let line = cleanName((typeof raw === 'string' ? raw : '').split('\n').find(l => l.trim()) ?? '');
  line = line.replace(/^#{1,6}\s*/, '').replace(/^title:\s*/i, '');
  for (let again = true; again;) {
    again = false;
    for (const [open, close] of WRAPS) {
      if (line.length > open.length + close.length && line.startsWith(open) && line.endsWith(close)) { line = line.slice(open.length, -close.length).trim(); again = true; }
    }
  }
  line = line.replace(/\.+$/, '').trim();
  if (!/[\p{L}\p{N}]/u.test(line) || showsNothing(line) || line.endsWith('?') || TALKS.test(line) || line.split(' ').length > TITLE_WORDS) return '';
  return atWord(line, TITLE_CHARS);
}

const marks = line => line.replace(/^#{1,6}\s*/, '').replace(/^(?:[-*+>]|\d+[.)])\s+/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').trim();
const AREA_TASK = /^\S+(?:\s+\S+){0,2} - \S/;

// A title from the owner's own words, for when the model gave none. A heading brief such as "# Server - Let a chip set its effort" keeps its
// "Area - task" line, and any other message gives its first line, cut at a word.
export function fallbackTitle(text) {
  const lines = String(text ?? '').split('\n').map(l => ({ head: /^\s*#/.test(l), line: cleanName(marks(l)) })).filter(l => l.line && !/^goal:?$/i.test(l.line));
  const shaped = lines.slice(0, 3).find(l => l.head && AREA_TASK.test(l.line));
  const picked = (shaped ?? lines[0])?.line.replace(/^goal:\s*/i, '');
  if (!picked || !/[\p{L}\p{N}]/u.test(picked) || showsNothing(picked)) return '';
  const wrapped = WRAPS.find(([open, close]) => picked.length > 2 && picked.startsWith(open) && picked.endsWith(close));
  const plain = wrapped ? picked.slice(wrapped[0].length, -wrapped[1].length).trim() : picked;
  const short = atWord(plain, TITLE_CHARS, FALLBACK_SHORT);
  return short === plain ? plain : `${short}…`;
}

// Hears a chat's first turn and says what it said, so the title can use the reply. A turn that ended in an error has no reply worth reading.
// The chat has run since it started, so a turn that has already ended is read from its events and no listener is left on it.
export function watchFirstTurn(chat, done) {
  let reply = '';
  const hear = ev => {
    if (ev.type === 'delta') {
      if (reply.length < REPLY_HEARD) reply += ev.data.text;
      return false;
    }
    if (ev.type !== 'turn-end' && ev.type !== 'exit') return false;
    done({ reply: ev.type === 'turn-end' && !ev.data.error ? reply : '' });
    return true;
  };
  if ((chat.events ?? []).some(hear)) return;
  const listen = ev => { if (hear(ev)) chat.listeners.delete(listen); };
  chat.listeners.add(listen);
}

function within(ask, prompt, ms) {
  const stop = new AbortController();
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => { stop.abort(); reject(new Error('The title took too long.')); }, ms); });
  return Promise.race([new Promise(resolve => resolve(ask(prompt, { signal: stop.signal }))), late]).finally(() => clearTimeout(timer));
}

// `ask(prompt, { signal })` gives the model's answer as text. `own(id)` is the title the owner set, '' for none, and `record(id, title)` saves one.
// Nothing here throws or is awaited by the chat, and each session is tried once in this process.
export function makeTitler({ ask, own, record, enabled = true, timeoutMs = 45_000, log = console.error }) {
  const tried = new Set();

  // Two asks at most, then the owner's own first line. A title the owner set while this ran wins, and the check and the write have no await between.
  async function name({ id, first = '', reply = '' }) {
    if (tried.has(id)) return null;
    tried.add(id);
    try {
      if (own(id) || !(first.trim() || reply.trim())) return null;
      const prompt = promptFor({ first, reply });
      let title = '';
      let why = '';
      for (let attempt = 0; attempt < 2 && !title; attempt++) {
        try { title = tidyTitle(await within(ask, prompt, timeoutMs)); if (!title) why = 'The answer was not a title.'; } catch (e) { why = e?.message ?? String(e); }
      }
      if (!title) {
        title = fallbackTitle(first);
        log(`Could not name session ${id} from a model (${why}), so it keeps its first line.`);
      }
      if (!title || own(id)) return null;
      record(id, title);
      return title;
    } catch (e) {
      log(`Could not name session ${id}: ${e.message}`);
      return null;
    }
  }

  // A given title is the title and costs no call. Otherwise the first turn is heard and the session named from it.
  function start(chat, { title, first }) {
    if (!enabled) return;
    const given = clip(cleanName(title), MAX_TITLE).trim();
    if (given && !showsNothing(given)) {
      try { record(chat.id, given); } catch (e) { log(`Could not title session ${chat.id}: ${e.message}`); }
      return;
    }
    watchFirstTurn(chat, ({ reply }) => { name({ id: chat.id, first, reply }); });
  }

  return { name, start };
}
