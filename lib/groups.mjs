// A group's own session: the folder it works in, its standing instructions, and what its tools may reach and say. The tools reach the
// group's sessions through callbacks the server gives each group chat, so nothing here imports the server or the runner.
import fs from 'node:fs';
import path from 'node:path';
import { BUCKETS, bucketsOf } from '../public/ui/group-rules.js';
import { MOST_LINKS, cardOf } from '../public/ui/link-rules.js';
import { isIssueUrl, isPullUrl } from '../public/ui/pull-url.js';
import { sectionById } from '../public/ui/sections.js';
import { label } from './notices.mjs';
import { completeEnd, readBefore, transcriptFor } from './transcripts.mjs';

// Under the state folder, so the session never edits a repo by accident. A character that cannot sit in a folder name is replaced,
// so a group id read from a hand-edited layout cannot point outside.
export const groupDir = (stateDir, groupId) => path.join(stateDir, 'groups', String(groupId).replace(/[^\w-]/g, '_'));

// Made before the session is booked and before every spawn, because the runner falls back to the home folder for one that is missing.
export function ensureGroupDir(stateDir, groupId) {
  const dir = groupDir(stateDir, groupId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// Read at each spawn, so a guide that cannot be read stops it: a chat must not start without the owner's rules. Lines that open with
// [start] are left out of a chat that cannot start sessions, and [group] and [rank] lines are for a group's chat alone.
const GUIDE = new URL('./group-guide.md', import.meta.url);

// Where a session started from a section's chat goes, as the guide, the start tool's reply and the refusals tell it.
const STARTS_IN = { pin: 'and pins it, so it shows in Pinned', loose: 'in no group, so it shows in Started here' };

// Where work goes instead, when a section's chat cannot start it.
export const ELSEWHERE = "from a group's chat, from the chat of Pinned or Started here, or in a new session";

// What a section's chat that cannot start a session tells the model, for it to pass on to the owner.
export const startRefusal = section => `${section.name} cannot hold a new session, so none can be started from its chat. Say so to the owner, and suggest starting the work ${ELSEWHERE}.`;

// What a chip card from the chat of such a section is told when Start is pressed.
export const chipRefusal = section => `${section.name} cannot hold a new session, so a chip from its chat cannot start one. Start the work ${ELSEWHERE}.`;

function introOf(name, section) {
  if (!section) return `You are the session for the group "${name}" in GhostShell. The owner talks to you about the work in this group. The group is a set of other Claude sessions, and you can see them and start new ones, but they are not yours to run.`;
  const who = `You are the session for one of GhostShell's own sidebar sections, "${section.name}". It holds ${section.holds}. The owner talks to you about the work in this section, and cannot rename or remove it. The section is a set of other Claude sessions, and you can see them, but they are not yours to run.`;
  return section.place ? who : `${who} ${section.name} cannot hold a new session, so start_group_session and spawn_task are refused in this chat. If the owner asks you to start work, say so, and suggest starting it ${ELSEWHERE}.`;
}

export function guideFor(name, sectionId = null) {
  const section = sectionId ? sectionById(sectionId) : null;
  const starts = !section || !!section.place;
  const text = fs.readFileSync(GUIDE, 'utf8').split('\n').filter(line => (starts || !line.startsWith('[start] ')) && (!section || !/^\[(group|rank)\] /.test(line))).map(line => line.replace(/^\[(start|group|rank)\] /, '')).join('\n').replace(/\n{3,}/g, '\n\n');
  const values = { intro: introOf(name, section), kind: section ? 'section' : 'group', start: section ? `starts a new session ${STARTS_IN[section.place]}` : 'starts a new session in the group', offer: starts ? ', or offer to start one' : '' };
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]);
}

// The ranking rules of a group's guide, for the first update to a chat that started before they were written.
export const rankRules = () => fs.readFileSync(GUIDE, 'utf8').split('\n').filter(line => line.startsWith('[rank] ')).map(line => line.slice(7)).join('\n');

export const LIST_LIMIT = { min: 1, max: 200, fallback: 100 };
const TAIL_ITEMS = { min: 1, max: 60, fallback: 20 };
const ITEM_CHARS = 1500;
const OUTPUT_CHARS = 300;
const REPLY_CHARS = 20_000;
const TAIL_CHUNK = 512 * 1024;
const TAIL_CHUNKS = 4;
const TITLE_MAX = 120;

// A refusal is a sentence for the model. Anything else that goes wrong stays out of its sight.
export const refusal = message => Object.assign(new Error(message), { refusal: true });

const notHere = found => `That session is not in this ${found.section ? 'section' : 'group'}. Use list_group_sessions to see the ones you can reach.`;

// The group as it is now, or a refusal: the callback looks it up on every call, so a group deleted by hand takes its tools with it.
// A built-in section is always there, and its lookup says `section`.
function here(group) {
  const found = group.lookup();
  if (!found) throw refusal('This group no longer exists.');
  return found;
}

export const whole = (value, { min, max, fallback }) => (Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback);

// One line of text. Titles, folders and branches come from sessions, so none of them may break a line and pass as another.
export const oneLine = (value, max) => label(value, max);

export function ago(ms, now) {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return 'just now';
  const [n, unit] = seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] : seconds < 86400 ? [Math.floor(seconds / 3600), 'hour'] : [Math.floor(seconds / 86400), 'day'];
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

const stamp = (ms, now) => (Number.isFinite(ms) && ms > 0 ? `last active ${new Date(ms).toISOString()} (${ago(ms, now)})` : 'never active');
export const stateOf = row => (row.archived ? 'archived' : row.state || 'idle');
export const place = row => [oneLine(row.cwd, 300) || 'no folder', oneLine(row.branch, 100) || 'no branch'];

export function listLine(row, now) {
  return `- ${oneLine(row.title, 80) || 'Untitled'} [${row.id}] · ${stateOf(row)} · ${place(row).join(' · ')} · ${stamp(row.lastActivityAt, now)}`;
}

export const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// The sessions of the group in the panel's order: those that need the owner, those working, recent ones, then idle ones, and archived
// ones only when asked for.
export function listGroupSessions(args, group, now = Date.now()) {
  const { name, members, section } = here(group);
  const limit = whole(args.limit, LIST_LIMIT);
  const buckets = bucketsOf(members, now);
  const live = members.length - buckets.archived.length;
  const flags = [buckets.needs.length && `${buckets.needs.length} need you`, buckets.working.length && `${buckets.working.length} working`].filter(Boolean);
  const archived = buckets.archived.length;
  const head = `${section ? 'Section' : 'Group'} "${oneLine(name, 80)}": ${count(live, 'session')}${flags.length ? ` (${flags.join(', ')})` : ''}${archived ? `, ${archived} archived` : ''}`;
  if (!members.length) return `${head}. It has no sessions yet.`;
  const asked = args.include_archived === true;
  const sections = [];
  let room = limit;
  let more = 0;
  for (const { key, label: title } of BUCKETS) {
    const list = buckets[key];
    if (!list.length || (key === 'archived' && !asked)) continue;
    const shown = list.slice(0, room);
    room -= shown.length;
    more += list.length - shown.length;
    if (shown.length) sections.push(`${title} (${list.length})\n${shown.map(row => listLine(row, now)).join('\n')}`);
  }
  const notes = [more && `… and ${more} more`, archived && !asked && 'Pass include_archived to list the archived ones.'].filter(Boolean);
  return [head, ...sections, ...notes].join('\n\n');
}

// ---- reading the end of one session --------------------------------------------------------------

const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text);
// Continuation lines are indented, so text in a transcript cannot start a line that reads as a speaker. Every break a reader may take for
// one is split on: a lone CR, NEL, LS and PS as well as LF.
const indent = text => text.replace(/\r\n|[\n\r\u0085\u2028\u2029]/g, '\n  ');

// What the end of a transcript says, as one line per message, tool call or note. A tool call carries what its result said when the result
// is in the part read. Thinking is left out.
function linesOf(items) {
  const results = new Map(items.filter(i => i.kind === 'result').map(i => [i.toolId, i]));
  const lines = [];
  for (const i of items) {
    if (i.kind === 'user') lines.push(['Owner:', indent(cut(i.text || '', ITEM_CHARS)), i.images?.length && `[${count(i.images.length, 'image')}]`].filter(Boolean).join(' '));
    else if (i.kind === 'assistant') lines.push(`Claude: ${indent(cut(i.text, ITEM_CHARS))}`);
    else if (i.kind === 'tool') {
      const result = results.get(i.id);
      const output = result?.output ? cut(result.output.replace(/\s+/g, ' ').trim(), OUTPUT_CHARS) : '';
      lines.push(`Tool ${oneLine(i.name, 80)}: ${oneLine(i.summary, 200)} → ${result ? result.status : 'no result yet'}${output ? `: ${output}` : ''}`);
    } else if (i.kind === 'system') lines.push(`Note: ${indent(cut([i.title, i.text].filter(Boolean).join(': '), ITEM_CHARS))}`);
    else if (i.kind === 'divider') lines.push(`Note: ${i.text}`);
    else if (i.kind === 'routine') lines.push(`${i.once ? 'Scheduled session' : 'Routine'}: ${oneLine(i.name, 80)}`);
  }
  return lines;
}

const shownKinds = new Set(['user', 'assistant', 'tool', 'system', 'divider', 'routine']);

// The last `want` lines, read from at most the last four chunks of the file.
function tailOf(t, cwd, want) {
  let end = completeEnd(t);
  let items = [];
  for (let n = 0; n < TAIL_CHUNKS && end > 0; n++) {
    const got = readBefore(t, end, TAIL_CHUNK, cwd, ITEM_CHARS * 2);
    items = [...got.items, ...items];
    end = got.start;
    if (items.filter(i => shownKinds.has(i.kind)).length > want) break;
  }
  const lines = linesOf(items);
  return { lines: lines.slice(-want), earlier: lines.length > want || end > 0 };
}

// The header of a session, what it waits on and the end of its transcript, as the tools that read one session of another's give it.
export function readSession(row, args, pending, now) {
  const want = whole(args.items, TAIL_ITEMS);
  const t = transcriptFor(row.id);
  const { lines, earlier } = t ? tailOf(t, row.cwd, want) : { lines: [], earlier: false };
  const waiting = pending.map(p => `Waiting for the owner to approve: ${oneLine(p.tool, 80)}${p.summary ? ` ${oneLine(p.summary, 300)}` : ''}`);
  const head = `Session "${oneLine(row.title, 80) || 'Untitled'}" [${row.id}] · ${stateOf(row)} · ${place(row).join(' · ')} · ${stamp(row.lastActivityAt, now)}`;
  let body = lines.join('\n');
  let note = lines.length ? `The last ${count(lines.length, 'line')}${earlier ? '; earlier ones are not shown.' : '.'}` : 'No messages yet.';
  if (body.length > REPLY_CHARS) {
    body = body.slice(-REPLY_CHARS);
    body = body.slice(body.indexOf('\n') + 1);
    note = 'The start of this was cut to fit; earlier lines are not shown.';
  }
  return [head, ...waiting, note, body].filter(Boolean).join('\n');
}

export function readGroupSession(args, group, now = Date.now()) {
  const found = here(group);
  const { members } = found;
  const row = typeof args.session_id === 'string' ? members.find(m => m.id === args.session_id) : null;
  // One answer for another group's session, a session in no group, this one and an id that is not a session, so the reply tells nothing about them.
  if (!row) throw refusal(notHere(found));
  return readSession(row, args, group.pending(row.id), now);
}

// What send_session in a group's or section's chat points at for reading a session back: its members, through read_group_session.
// It is looked up before the send, so the chat of a group deleted by hand cannot send either.
export function groupReader(group) {
  const { members, section } = here(group);
  const ids = new Set(members.map(m => m.id));
  return { read: 'read_group_session', reaches: `this ${section ? 'section' : 'group'}'s sessions`, has: id => ids.has(id) };
}

// ---- the status of pull requests and issues ------------------------------------------------------------

// A link's line, worded as its card is, with what a pull request still open adds: its merge state, unresolved threads and reviewers asked.
function linkLine(url, link) {
  const card = cardOf(link);
  if (!card) return `- ${url} could not be read.`;
  const parts = [card.state.word, ...card.facts.map(([name, word]) => `${name}: ${word}`)];
  if (link.kind === 'pull' && (link.state === 'open' || link.state === 'draft')) {
    parts.push(link.conflicts ? 'Has conflicts' : link.clean ? 'Merges cleanly' : 'No conflicts, not clean to merge yet');
    if (Number.isInteger(link.threads)) parts.push(count(link.threads, 'unresolved thread'));
    if (Number.isInteger(link.requested)) parts.push(link.requested ? `${count(link.requested, 'reviewer')} requested` : 'No reviewers requested');
  }
  if (card.next) parts.push(`Next: ${card.next.text}`);
  return `- ${url} "${oneLine(card.title, 300)}" · ${parts.join(' · ')}`;
}

// One line for each address, from the reader the pages use, so the model does not run gh for it. A group's chat reads it as the group's tool does,
// and an address that cannot be read or is not a pull request or issue is told on its own line, without failing the others.
export async function githubStatus(args, group) {
  here(group);
  const { urls } = args;
  if (!Array.isArray(urls) || !urls.length) throw refusal('Give urls as a list of GitHub pull request or issue addresses, such as https://github.com/owner/repo/pull/12.');
  if (urls.length > MOST_LINKS) throw refusal(`Ask about at most ${MOST_LINKS} addresses at a time.`);
  const asked = [...new Set(urls.map(url => (typeof url === 'string' ? url.trim() : url)))];
  const lines = await Promise.all(asked.map(async url => {
    if (!isPullUrl(url) && !isIssueUrl(url)) return `- ${oneLine(url, 200) || 'An empty address'} is not the address of a GitHub pull request or issue, so it was not read. Use https://github.com/owner/repo/pull/N or https://github.com/owner/repo/issues/N.`;
    // Each address is looked up alone, since lookup() says settling for a whole batch and only this tells still-being-read from failed.
    const { found, settling } = await group.links([url]);
    const link = found.get(url);
    if (!link) return settling ? `- ${url} is still being read. Ask again shortly.` : `- ${url} could not be read.`;
    return linkLine(url, link);
  }));
  return lines.join('\n');
}

// ---- starting a session from the group or section -------------------------------------------------------------

// The folder a session started from a group's or section's chat may use, as the disk names it, or a refusal. The start tool, spawn_task in a group's chat
// and starting that chat's chips all go through it, so none can begin work in Capcom's state folder, where its tokens are.
export function workFolder(cwd, stateDir) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw refusal('Give cwd as an absolute folder. This chat has no default folder, so use the one the work belongs in.');
  let real;
  try { real = fs.realpathSync.native(path.resolve(cwd)); } catch { throw refusal('That folder does not exist on this Mac.'); }
  if (!fs.statSync(real).isDirectory()) throw refusal('That path is not a folder.');
  // NOTE: [23 Oct 2026] EK - fs.realpathSync keeps the case it is given and APFS ignores case, so only the native one names a folder as the disk does.
  // Without it any other spelling of the state folder's path passes this fence.
  const state = fs.realpathSync.native(stateDir);
  if (real === state || real.startsWith(state + path.sep)) throw refusal('That folder belongs to GhostShell. Pick the folder the work is in.');
  return real;
}

export async function startGroupSession(args, group) {
  const { name, section } = here(group);
  if (section && !section.place) throw refusal(startRefusal(section));
  const { prompt } = args;
  const folder = workFolder(args.cwd, group.stateDir);
  if (typeof prompt !== 'string' || !prompt.trim()) throw refusal('Give the first message for the new session as prompt.');
  const title = typeof args.title === 'string' && args.title.trim() ? oneLine(args.title, TITLE_MAX) : '';
  const { id, placed } = await group.start({ cwd: folder, prompt, title });
  return `Started session [${id}] in ${folder}${title ? ` called "${title}"` : ''}. ${placedNote(name, section, placed)} Use read_group_session to see how it is getting on.`;
}

function placedNote(name, section, placed) {
  if (!section) return placed ? `It is in the group "${oneLine(name, 80)}" and running now.` : 'It is running, but GhostShell could not put it in the group, so tell the owner.';
  if (!placed) return 'It is running, but GhostShell could not pin it, so tell the owner.';
  if (section.place === 'pin') return 'It is pinned, so it shows in Pinned, and it is running now.';
  // GhostShell started it, so the sidebar lists it under Started here whichever loose section this is.
  return `It is in no group, so it shows in Started here${section.id === 'started' ? '' : ' and not in ' + section.name}, and it is running now.`;
}
