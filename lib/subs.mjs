// The tools of an ordinary chat that reach the sessions nested under it, at any depth. As with a group's tools, the server hands each chat
// callbacks for what it may reach, so nothing here imports the server or the runner.
import { descendantsOf, rollupLine, rollupOf, treeOf } from '../public/ui/sub-rules.js';
import { count, listLine, LIST_LIMIT, oneLine, readSession, refusal, whole } from './groups.mjs';
import { label, SESSION_TAG } from './notices.mjs';

const NOT_BELOW = 'That session is not a sub session of this session, nor one its chips started beside it. Use list_sub_sessions to see the ones you can reach.';

const MESSAGE_MAX = 20_000;

// What a session waits on, one line each, for the page and the tools to show.
export const pendingLines = pending => pending.map(p => ({ tool: oneLine(p.tool, 80), summary: oneLine(p.summary, 200) }));

// What a session reaches: those below it at any depth, and those its chips started beside it, which `startedBy` names.
const reachOf = (rows, self) => {
  const below = self ? descendantsOf(rows, self.id) : [];
  return { below, beside: self ? rows.filter(r => r.startedBy === self.id && !below.some(b => b.id === r.id)) : [] };
};

// `subs.lookup({ archived })` gives this session's own row (null when it has none yet) and the rows of the index, with `via` running
// through the archived sessions only when `archived` is set.
export function listSubSessions(args, subs, now = Date.now()) {
  const asked = args.include_archived === true;
  const { self, rows } = subs.lookup({ archived: asked });
  const { below, beside } = reachOf(rows, self);
  const name = self ? `Session "${oneLine(self.title, 80) || 'Untitled'}"` : 'This session';
  if (!below.length && !beside.length) return `${name} has no sub sessions.`;
  const roll = rollupOf(rows, self.id, now);
  const flags = [roll.needs && `${roll.needs} ${roll.needs === 1 ? 'needs' : 'need'} you`, roll.working && `${roll.working} working`].filter(Boolean);
  const archived = below.filter(row => row.archived).length;
  const aside = beside.length ? `${beside.length} started beside it` : '';
  const head = below.length
    ? `${name}: ${count(roll.total, 'sub session')}${flags.length ? ` (${flags.join(', ')})` : ''}${archived ? `, ${archived} archived` : ''}${aside && `, ${aside}`}`
    : `${name}: no sub sessions, ${aside}`;

  const limit = whole(args.limit, LIST_LIMIT);
  const lines = [];
  let shown = 0;
  const walk = (nodes, depth) => {
    for (const { row, subs: under } of nodes) {
      if (shown >= limit) return;
      shown++;
      const pad = '  '.repeat(depth);
      lines.push(`${pad}${listLine(row, now)}`);
      const rolled = rollupLine(rollupOf(rows, row.id, now));
      if (rolled) lines.push(`${pad}  ${rolled}`);
      const said = subs.summary(row.id, row.cwd)?.line;
      if (said) lines.push(`${pad}  "${oneLine(said, 200)}"`);
      walk(under, depth + 1);
    }
  };
  walk(treeOf(rows, self.id, now), 0);
  if (beside.length && shown < limit) {
    lines.push(`${lines.length ? '\n' : ''}Started from this session's chips, beside it:`);
    for (const row of beside) {
      if (shown >= limit) break;
      shown++;
      lines.push(listLine(row, now));
      const said = subs.summary(row.id, row.cwd)?.line;
      if (said) lines.push(`  "${oneLine(said, 200)}"`);
    }
  }
  const cut = below.length + beside.length - shown;
  return [head, lines.join('\n'), cut && `… and ${cut} more, past the limit of ${limit}.`].filter(Boolean).join('\n\n');
}

// Any session below this one at any depth, or started beside it by one of its chips, archived ones included. Every other id gets one answer, so the reply tells nothing about it.
export function readSubSession(args, subs, now = Date.now()) {
  const { self, rows } = subs.lookup({ archived: true });
  const { below, beside } = reachOf(rows, self);
  const row = typeof args.session_id === 'string' ? [...below, ...beside].find(r => r.id === args.session_id) : null;
  if (!row) throw refusal(NOT_BELOW);
  return readSession(row, args, subs.pending(row.id), now);
}

// The text the page already draws as a message from another session. It has a tag of its own because the CLI holds the tag of its peer messages.
// Quotes and angle brackets would end the attributes early, and the notice's title keeps 60 characters of the name, so the sender's title is cut
// to leave room for what follows it. `label` adds three dots to a name it cuts.
const attribute = (text, limit) => label(text, limit).replace(/["<>]/g, '');
// What the sender is to the receiver, shown after its name in the notice's title.
const PARENT = ' (your parent session)';
const ANCESTOR = ' (your ancestor session)';
const OTHER = ' (another session)';
// A closing tag inside the message would end the wrapper early, so it is written with a backslash and stays text.
const CLOSING = new RegExp(`</(?=${SESSION_TAG})`, 'gi');
// `from` and `name` are already safe to put in an attribute.
export const sessionMessage = (from, name, message) => `<${SESSION_TAG} from="${from}" from-name="${name}">\n${message.replace(CLOSING, '<\\/')}\n</${SESSION_TAG}>`;
const peerText = (self, message, relation) => sessionMessage(attribute(self.id, 60), `${attribute(self.title, 60 - relation.length - 3) || 'A session'}${relation}`, message);

// What the reply to a send points at for reading the session back. A group's or section's chat passes its own, whose `has` says whether it can read an id.
const SUB_READER = { read: 'read_sub_session', reaches: 'sub sessions and the sessions its chips started' };

// Delivery goes through `subs.send(row, text)`, which resumes the session if it has no process and answers with the state it was in.
// Any session in the index can be sent to except the sender. Archived sessions are refused, as sending would unarchive them, which is the owner's call through unarchive_session.
export function sendSession(args, subs, reader = null) {
  const { read, reaches } = reader ?? SUB_READER;
  const { self, rows } = subs.lookup({ archived: true });
  if (!self) throw refusal('This session is not in the list of sessions yet, so it cannot send a message. Try again once it has a reply.');
  const row = typeof args.session_id === 'string' ? rows.find(r => r.id === args.session_id) : null;
  if (!row) throw refusal('No session with that id on this Mac. Use find_sessions to look one up by its title.');
  if (row.id === self.id) throw refusal('A session cannot send a message to itself.');
  const { message } = args;
  if (typeof message !== 'string' || !message.trim()) throw refusal('Give the message to send as message.');
  if (message.length > MESSAGE_MAX) throw refusal(`That message is ${message.length} characters, over the limit of ${MESSAGE_MAX}. Shorten it, or point to a file.`);
  const name = `"${oneLine(row.title, 80) || 'Untitled'}" [${row.id}]`;
  if (row.archived) throw refusal(`Refused: ${name} is archived. Unarchive it with unarchive_session, which the owner approves, then send again.`);
  const reach = reachOf(rows, self);
  const below = reach.below.some(r => r.id === row.id);
  const was = subs.send(row, peerText(self, message.trim(), !below ? OTHER : row.via === self.id ? PARENT : ANCESTOR));
  if (was === 'elsewhere') throw refusal(`Refused: ${name} looks to be running in another app, and a second process on its transcript could corrupt it. Try again once it has stopped.`);
  const later = (reader ? reader.has(row.id) : below || reach.beside.some(r => r.id === row.id))
    ? `This call did not wait for a reply: use ${read} later to see it.`
    : `This call did not wait for a reply, and ${read} reaches only ${reaches}, so you cannot read it. The owner sees the reply in that session's own chat.`;
  if (was === 'working') return `Queued for ${name}. It is running a turn, which this does not interrupt, and it reads your message before its next step. ${later}`;
  if (was === 'waiting') return `Queued for ${name}. It is waiting for its owner to approve something, and it reads your message once that is settled. ${later}`;
  return `Delivered to ${name}. It was idle, so it has started a turn to read your message. ${later}`;
}

// What the approval card shows: who the message is for and how it starts.
export function sendSummary(input, subs) {
  let to = typeof input?.session_id === 'string' ? input.session_id : '';
  try {
    const row = subs.lookup({ archived: true }).rows.find(r => r.id === to);
    if (row) to = oneLine(row.title, 80) || 'Untitled';
  } catch {}
  return `to "${oneLine(to, 80)}": ${oneLine(input?.message, 200)}`;
}

// Whether a session is in the caller's own tree: its parent, a session below it at any depth, or a sibling under the same parent, and the caller
// itself when `self` is set. A send there, or a rename or move, needs no card. Worked out from the links as they are now, archived ones included,
// and never from anything the model says about the target.
export function inOwnTree(subs, sessionId, { self: withSelf = false } = {}) {
  try {
    const { self, rows } = subs.lookup({ archived: true });
    if (!self || typeof sessionId !== 'string') return false;
    if (sessionId === self.id) return withSelf;
    const row = rows.find(r => r.id === sessionId);
    if (!row) return false;
    if (self.via && (row.id === self.via || row.via === self.via)) return true;
    return descendantsOf(rows, self.id).some(r => r.id === row.id);
  } catch {
    return false;
  }
}
