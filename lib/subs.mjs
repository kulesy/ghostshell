// The tools of an ordinary chat that reach the sessions nested under it, at any depth. As with a group's tools, the server hands each chat
// callbacks for what it may reach, so nothing here imports the server or the runner.
import { descendantsOf, rollupLine, rollupOf, treeOf } from '../public/ui/sub-rules.js';
import { count, listLine, LIST_LIMIT, oneLine, readSession, refusal, whole } from './groups.mjs';
import { label, PARENT_TAG } from './notices.mjs';

const NOT_BELOW = 'That session is not one of the sub sessions of this session. Use list_sub_sessions to see the ones you can reach.';

const MESSAGE_MAX = 20_000;

// What a session waits on, one line each, for the page and the tools to show.
export const pendingLines = pending => pending.map(p => ({ tool: oneLine(p.tool, 80), summary: oneLine(p.summary, 200) }));

// `subs.lookup({ archived })` gives this session's own row (null when it has none yet) and the rows of the index, with `via` running
// through the archived sessions only when `archived` is set.
export function listSubSessions(args, subs, now = Date.now()) {
  const asked = args.include_archived === true;
  const { self, rows } = subs.lookup({ archived: asked });
  const below = self ? descendantsOf(rows, self.id) : [];
  const name = self ? `Session "${oneLine(self.title, 80) || 'Untitled'}"` : 'This session';
  if (!below.length) return `${name} has no sub sessions.`;
  const roll = rollupOf(rows, self.id, now);
  const flags = [roll.needs && `${roll.needs} ${roll.needs === 1 ? 'needs' : 'need'} you`, roll.working && `${roll.working} working`].filter(Boolean);
  const archived = below.filter(row => row.archived).length;
  const head = `${name}: ${count(roll.total, 'sub session')}${flags.length ? ` (${flags.join(', ')})` : ''}${archived ? `, ${archived} archived` : ''}`;

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
  const cut = below.length - shown;
  return [head, lines.join('\n'), cut && `… and ${cut} more, past the limit of ${limit}.`].filter(Boolean).join('\n\n');
}

// Any session below this one at any depth, archived ones included. Every other id gets one answer, so the reply tells nothing about it.
export function readSubSession(args, subs, now = Date.now()) {
  const { self, rows } = subs.lookup({ archived: true });
  const row = self && typeof args.session_id === 'string' ? descendantsOf(rows, self.id).find(r => r.id === args.session_id) : null;
  if (!row) throw refusal(NOT_BELOW);
  return readSession(row, args, subs.pending(row.id), now);
}

// A session the owner has not renamed is called what its parent called it in spawn_task, in place of the first line of its prompt.
export const chipTitled = (rows, titles) => rows.map(row => (!row.renamed && titles.get(row.id) ? { ...row, title: titles.get(row.id) } : row));

// The text the page already draws as a message from another session, in the parent's name. It has a tag of its own because the CLI holds the
// tag of its peer messages. Quotes and angle brackets would end the attributes early, and the notice's title keeps 60 characters of the name,
// so the parent's title is cut to leave room for what follows it.
// `label` adds three dots to a name it cuts.
const attribute = (text, limit) => label(text, limit).replace(/["<>]/g, '');
const PARENT = ' (your parent session)';
const ANCESTOR = ' (your ancestor session)';
// A closing tag inside the message would end the wrapper early, so it is written with a backslash and stays text.
const CLOSING = new RegExp(`</(?=${PARENT_TAG})`, 'gi');
const peerText = (self, message, relation) => `<${PARENT_TAG} from="${attribute(self.id, 60)}" from-name="${attribute(self.title, 60 - relation.length - 3) || 'A session'}${relation}">\n${message.replace(CLOSING, '<\\/')}\n</${PARENT_TAG}>`;

// Delivery goes through `subs.send(row, text)`, which resumes the session if it has no process and answers with the state it was in.
// Archived sessions are refused, as sending would unarchive them, which is the owner's call.
export function sendSubSession(args, subs) {
  const { self, rows } = subs.lookup({ archived: true });
  const row = self && typeof args.session_id === 'string' ? descendantsOf(rows, self.id).find(r => r.id === args.session_id) : null;
  if (!row) throw refusal(NOT_BELOW);
  const { message } = args;
  if (typeof message !== 'string' || !message.trim()) throw refusal('Give the message to send as message.');
  if (message.length > MESSAGE_MAX) throw refusal(`That message is ${message.length} characters, over the limit of ${MESSAGE_MAX}. Shorten it, or point to a file.`);
  const name = `"${oneLine(row.title, 80) || 'Untitled'}" [${row.id}]`;
  if (row.archived) throw refusal(`Refused: ${name} is archived. Ask the owner to unarchive it, then send again.`);
  const was = subs.send(row, peerText(self, message.trim(), row.via === self.id ? PARENT : ANCESTOR));
  if (was === 'elsewhere') throw refusal(`Refused: ${name} looks to be running in another app, and a second process on its transcript could corrupt it. Try again once it has stopped.`);
  const later = 'This call did not wait for a reply: use read_sub_session later to see it.';
  if (was === 'working') return `Queued for ${name}. It is running a turn, which this does not interrupt, and it reads your message before its next step. ${later}`;
  if (was === 'waiting') return `Queued for ${name}. It is waiting for its owner to approve something, and it reads your message once that is settled. ${later}`;
  return `Delivered to ${name}. It was idle, so it has started a turn to read your message. ${later}`;
}

// What the approval card shows: who the message is for and how it starts.
export function sendSummary(input, subs) {
  let to = typeof input?.session_id === 'string' ? input.session_id : '';
  try {
    const { self, rows } = subs.lookup({ archived: true });
    const row = self && descendantsOf(rows, self.id).find(r => r.id === to);
    if (row) to = oneLine(row.title, 80) || 'Untitled';
  } catch {}
  return `to "${oneLine(to, 80)}": ${oneLine(input?.message, 200)}`;
}
