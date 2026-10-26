// Capcom. A browser chat client for every Claude Code session on this Mac, grouped in its own layout, and driven
// through headless `claude -p` processes.
import crypto from 'node:crypto';
import http from 'node:http';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { cfg, ROOT } from './lib/config.mjs';
import { lastReply, makeWindows, shapeUsage, transcriptFigure } from './lib/context.mjs';
import { parseCron } from './lib/cron.mjs';
import { loadDesktop } from './lib/desktop.mjs';
import { dotOf } from './lib/dots.mjs';
import { chainOf, familiesOf } from './lib/families.mjs';
import { linksOf, previewFile, serveFile } from './lib/files.mjs';
import { chipRefusal, ensureGroupDir, groupDir, guideFor, workFolder } from './lib/groups.mjs';
import { makeLayout } from './lib/layout.mjs';
import { makeMarks } from './lib/marks.mjs';
import { pendingLines } from './lib/subs.mjs';
import { makeSummaries } from './lib/summaries.mjs';
import { makePulls } from './lib/pulls.mjs';
import { indexTranscripts, transcriptFor, readHead, readBefore, readAfter, readImage, listImages, completeEnd } from './lib/transcripts.mjs';
import { readImages, MAX_BODY_BYTES } from './lib/images.mjs';
import { isSlashCommand, makeUploads, MAX_FILE_BYTES, MAX_FILES, withMentions } from './lib/uploads.mjs';
import { createOutside, STALE_MS } from './lib/outside.mjs';
import { chatFor, getChat, onTurn, startChat, sweep, activeStates } from './lib/runner.mjs';
import { listCommands, listModels } from './lib/commands.mjs';
import { makeAuth, overHttps, sessionCookie } from './lib/auth.mjs';
import { makePasskeys, PasskeyError } from './lib/passkeys.mjs';
import { handOffText, makeTerminal } from './lib/terminal.mjs';
import { EFFORTS, MODEL, makeChips } from './lib/tools.mjs';
import { JITTER_PROBLEM, makeRoutines, makeScheduler, makeZoneFollower, upcoming, validJitter } from './lib/routines.mjs';
import { esc } from './public/md.mjs';
import { comparator, DEFAULT_SORT, sortFamily, sortRows, UNTITLED } from './public/ui/order.js';
import { titleText } from './public/ui/quote-rules.js';
import { SECTION_IDS, SECTIONS, sectionById, sectionOf, sectionSessions } from './public/ui/sections.js';
import { withKids } from './public/ui/tree.js';

const auth = makeAuth(cfg.stateDir);
const passkeys = makePasskeys(cfg.stateDir, { port: cfg.port, origins: cfg.passkeyOrigins, warn: console.error });
const chips = makeChips(cfg.stateDir);
const layout = makeLayout(cfg.stateDir);
const marks = makeMarks(cfg.stateDir);
const windows = makeWindows(cfg.stateDir);
const uploads = makeUploads(cfg.stateDir);
const summaries = makeSummaries({ transcriptFor });
const pulls = makePulls({ transcriptFor, gh: cfg.gh });
// A mention of a file in front of /name stops the CLI reading the message as a command.
const SLASH_WITH_FILES = 'Send a slash command on its own, without files.';
const MODES = ['manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];
const startedFile = path.join(cfg.stateDir, 'started.json');
const readStarted = () => { try { return JSON.parse(fs.readFileSync(startedFile, 'utf8')); } catch { return []; } };
// The model, effort and fast mode picked in Capcom for each session, kept here because Desktop's own records are read only.
const picksFile = path.join(cfg.stateDir, 'picks.json');
const readPicks = () => { try { return JSON.parse(fs.readFileSync(picksFile, 'utf8')); } catch { return {}; } };
const savePick = (id, pick) => {
  const all = readPicks();
  fs.writeFileSync(picksFile, JSON.stringify({ ...all, [id]: { ...all[id], ...pick } }));
};
// A refusal drops fast mode from the pick, or every process would ask again. It runs as Claude's output is read, where a throw would
// stop the server, so a failed save is logged as in newSession.
function dropFastOnRefusal(chat) {
  chat.onFastRefused = () => {
    try {
      savePick(chat.id, { fast: false });
    } catch (e) {
      console.error(`Could not record that fast mode was refused for ${chat.id}: ${e.message}`);
    }
  };
}
const viewers = new Map();
// The terminal's events ride each open chat's own event stream, so a chat needs no second connection.
const terminal = makeTerminal({
  emit: (id, data) => { for (const fn of viewers.get(id) || []) fn({ type: 'terminal', data }); },
  onEnd: (id, done) => handBashToClaude(id, done),
});
const outside = createOutside();
const listOutside = createOutside({ keep: 256 });

// A mark that cannot be written costs the list one dot, so it is logged. Marks are written as Claude's output is read and as a stream
// closes, where a throw would stop the server.
function writeMark(change) {
  try {
    change();
  } catch (e) {
    console.error(`Could not write marks.json: ${e.message}`);
  }
}
onTurn(({ id, kind, at }) => writeMark(() => {
  if (kind === 'start') marks.started(id, at);
  else if (kind === 'end') marks.ended(id, at, !!viewers.get(id)?.size);
  else marks.failed(id, at);
}));

// ---- the session index ---------------------------------------------------------------------------

const ownTitle = (own, id) => (Object.hasOwn(own.titles, id) && typeof own.titles[id] === 'string' && own.titles[id].trim() ? own.titles[id] : '');

// What a session is linked to: Capcom's own choice, a null included, wins over the chip it was started from, and that over Desktop's link.
const linkOf = (own, fromChips, desk, id) => (Object.hasOwn(own.parents, id) ? own.parents[id] : fromChips.get(id) ?? desk.links.get(id) ?? null);
const linksNow = () => {
  const own = layout.read();
  const fromChips = chips.links();
  const desk = loadDesktop(cfg.desktopDir);
  return id => linkOf(own, fromChips, desk, id);
};
const linkNow = id => linksNow()(id);

// A nested session that leaves its place would take the sessions straight under it along, so each is linked to the one it showed
// under instead, and those further down keep their links. A head takes its whole family along.
function keepFamily(id, rows) {
  const { via } = rows.get(id);
  const links = {};
  if (via) for (const r of rows.values()) if (!r.archived && r.via === id) links[r.id] = via;
  return links;
}

// A session with a link leaves its parent when it moves or is pinned, which only the server can tell, since it alone knows a session's link.
const leaving = id => (linkNow(id) === null ? {} : { unlink: true, relink: keepFamily(id, buildIndex().rows) });

function buildIndex({ archived = false } = {}) {
  const desk = loadDesktop(cfg.desktopDir);
  const own = layout.read();
  const files = indexTranscripts(cfg.projectsDir);
  const live = activeStates();
  const started = new Map(readStarted().map(s => [s.id, s]));
  const now = Date.now();
  const stateOf = (id, mtime) => live[id] || (now - mtime < 120_000 ? 'active' : 'idle');
  // The turns Capcom ran are in no record of Desktop's, so the last time one began or ended lifts a row's place when it is later.
  // Desktop's own place is its record's sort key and not the transcript's file time, which any write moves.
  const edges = marks.read().edges;
  const edgeOf = id => edges.get(id) ?? 0;

  const rows = new Map();
  for (const r of desk.sessions) {
    const t = files.get(r.id);
    if (!t) continue;
    rows.set(r.id, { ...r, source: 'desktop', lastActivityAt: Math.max(Date.parse(r.lastActivityAt) || r.lastActivityAt || 0, t.mtime), sortAt: Math.max(r.sortKey, edgeOf(r.id)), state: stateOf(r.id, t.mtime) });
  }
  const cutoff = now - cfg.otherDays * 86400_000;
  // A deleted group's chat is kept in `retired` and stays a group's session, so it is out of every list and keeps the group chat's protections.
  // A built-in section's chat is owned the same way, and is named for the section.
  const sectionChats = SECTIONS.filter(s => own.sections[s.id]).map(s => ({ id: s.id, name: s.name, session: own.sections[s.id] }));
  const ownedChats = [...own.groups, ...own.retired, ...sectionChats].filter(g => g.session);
  const groupSessionIds = new Set(ownedChats.map(g => g.session));
  for (const t of files.values()) {
    if (rows.has(t.id) || (t.mtime < cutoff && !started.has(t.id) && !groupSessionIds.has(t.id))) continue;
    const head = readHead(t, uploads.dir);
    // NOTE: [15 Oct 2026] EK - A routine's prompt can run past the 64 KB head that readHead reads, so a run Capcom started keeps
    // its routine in started.json, and shows the title it was started with. Without it a long prompt lists outside Routines.
    const routine = head.routine || started.get(t.id)?.routine || null;
    rows.set(t.id, { id: t.id, title: (routine && started.get(t.id)?.title) || head.title || started.get(t.id)?.title || UNTITLED, cwd: head.cwd || started.get(t.id)?.cwd || '', branch: head.branch,
      archived: false, lastActivityAt: t.mtime, sortAt: Math.max(t.mtime, edgeOf(t.id)), createdAt: started.get(t.id)?.at ?? 0, routine, source: started.has(t.id) ? 'capcom' : 'cli', state: stateOf(t.id, t.mtime) });
  }
  // A session started moments ago may not have written its file yet; after that, no file means it is gone.
  for (const s of started.values()) {
    if (!rows.has(s.id) && now - s.at < 10 * 60_000) rows.set(s.id, { id: s.id, title: s.title || UNTITLED, cwd: s.cwd, branch: '', archived: false, lastActivityAt: s.at, sortAt: Math.max(s.at, edgeOf(s.id)), createdAt: s.at, routine: s.routine || null, source: 'capcom', state: stateOf(s.id, s.at) });
  }

  // Projects, groups and pins are Capcom's own and cover every session, whichever app started it. A group that is gone leaves its
  // sessions loose, and a group whose project is gone is at the top level.
  const groupIds = new Set(own.groups.map(g => g.id));
  const projectIds = new Set(own.projects.map(p => p.id));
  const pins = new Set(own.pinned);
  const unarchived = new Set(own.unarchived);
  for (const r of rows.values()) {
    r.group = groupIds.has(own.assignments[r.id]) ? own.assignments[r.id] : null;
    r.pinned = pins.has(r.id);
    // Capcom's own choice wins over Desktop's flag, in both directions. A session in both lists is archived.
    if (Object.hasOwn(own.archived, r.id)) r.archived = true;
    else if (unarchived.has(r.id)) r.archived = false;
    if (r.archived) r.archivedAt = Date.parse(own.archived[r.id]) || r.changedAt || r.lastActivityAt;
    // Capcom's own title wins over every other, and is applied before the sorts so a group goes by it.
    const title = ownTitle(own, r.id);
    if (title) { r.title = title; r.renamed = true; }
  }

  // A group's or section's session belongs to it alone, so its row leaves `rows` here and no list, family, count or search sees it. A session
  // with no transcript yet gets a row from the layout.
  const groupSessions = new Map();
  for (const g of ownedChats) {
    const row = rows.get(g.session) ?? { lastActivityAt: 0, sortAt: 0, createdAt: 0, state: stateOf(g.session, 0) };
    rows.delete(g.session);
    groupSessions.set(g.session, { ...row, id: g.session, title: g.name, cwd: groupDir(cfg.stateDir, g.id), branch: row.branch ?? '', archived: false, routine: null, source: 'capcom', group: null, pinned: false, parent: null, via: null, groupSession: g.id });
  }

  // A family shows in the place of its holder, the topmost session its links reach, so a child takes the place its holder has now.
  const fromChips = chips.links();
  const families = familiesOf(rows, id => linkOf(own, fromChips, desk, id), { archived });
  const places = new Map([...rows.values()].map(r => [r.id, { group: r.group, pinned: r.pinned }]));
  for (const r of rows.values()) {
    const { holder, parent, via } = families.get(r.id);
    Object.assign(r, { parent, via }, places.get(holder));
  }
  const visible = [...rows.values()].filter(r => archived || !r.archived);
  // Counted by the place a family gives each row, which is what api/archived?group= lists by.
  const archivedIn = new Map();
  for (const r of rows.values()) if (r.archived && r.group) archivedIn.set(r.group, (archivedIn.get(r.group) ?? 0) + 1);
  // An archived row is not always linked to its holder in the live index, so its section comes from the holder every build agrees on.
  const archivedSection = new Map();
  const archivedInSection = new Map();
  for (const r of rows.values()) {
    if (!r.archived) continue;
    const { holder } = families.get(r.id);
    const section = sectionOf({ ...r, parent: holder === r.id ? null : holder }, rows);
    archivedSection.set(r.id, section);
    if (section) archivedInSection.set(section, (archivedInSection.get(section) ?? 0) + 1);
  }

  // Each list sorts as the Desktop section it comes from does, and Started here, Ungrouped and Terminal and other all sort as Desktop's
  // loose list does. A list Desktop has no section for goes newest first.
  const sorts = { pinned: desk.sorts.pinned ?? DEFAULT_SORT, routines: desk.sorts.routines ?? DEFAULT_SORT, sessions: desk.sorts.sessions ?? DEFAULT_SORT };
  const groupSort = id => desk.sorts.groups.get(id) ?? DEFAULT_SORT;
  const sortOf = r => (r.pinned ? sorts.pinned : r.group ? groupSort(r.group) : r.routine ? sorts.routines : sorts.sessions);
  const kids = new Map();
  for (const r of visible.filter(r => r.parent)) kids.set(r.parent, [...(kids.get(r.parent) ?? []), r]);
  for (const [id, list] of kids) {
    const parent = rows.get(id);
    parent.children = sortFamily(parent, list, sortOf(parent));
  }

  // A child is listed under its parent only.
  const top = visible.filter(r => !r.parent);
  const pinned = sortRows(top.filter(r => r.pinned), sorts.pinned);
  const groups = own.groups.map(g => {
    const sort = groupSort(g.id);
    const session = g.session ? { id: g.session, state: groupSessions.get(g.session).state } : null;
    return { id: g.id, name: g.name, project: projectIds.has(g.project) ? g.project : null, sort, session, archived: archivedIn.get(g.id) ?? 0, sessions: sortRows(top.filter(r => r.group === g.id && !r.pinned), sort) };
  });
  // A routine's runs go newest first, and the routines go by their latest run.
  const byLatest = comparator(sorts.routines);
  const routines = new Map();
  for (const r of top.filter(r => r.routine && !r.group && !r.pinned).sort(comparator(DEFAULT_SORT))) {
    if (!routines.has(r.routine)) routines.set(r.routine, { name: r.routine, latest: r, earlier: [] });
    else if (routines.get(r.routine).earlier.length < 12 || unarchived.has(r.id)) routines.get(r.routine).earlier.push(r);
  }
  const loose = sortRows(top.filter(r => !r.group && !r.routine && !r.pinned), sorts.sessions);
  // A list stops at its newest 60 but keeps every session brought back from the archive, so an old one is not lost between the two.
  // A family counts as one and stays whole when any of its members was brought back.
  const newest = list => list.filter((r, i) => i < 60 || [r, ...(r.children ?? [])].some(m => unarchived.has(m.id)));
  return {
    station: cfg.station,
    problem: [desk.problem, own.problem].filter(Boolean).join('. ') || null,
    projects: own.projects.map(({ id, name }) => ({ id, name })),
    pinned,
    groups,
    routines: [...routines.values()].sort((a, b) => byLatest(a.latest, b.latest)),
    started: newest(loose.filter(r => r.source === 'capcom')),
    ungrouped: newest(loose.filter(r => r.source === 'desktop')),
    other: newest(loose.filter(r => r.source === 'cli')),
    // The five built-in sections of Home are not in `groups`, which the page walks for rows. Each has its chat, if one was booked, and a count of its archived sessions.
    sections: SECTIONS.map(({ id }) => ({ id, session: own.sections[id] ? { id: own.sections[id], state: groupSessions.get(own.sections[id]).state } : null, archived: archivedInSection.get(id) ?? 0 })),
    sorts,
    rows,
    groupSessions,
    archivedSection,
  };
}

function findRow(id) {
  const index = buildIndex({ archived: true });
  return index.rows.get(id) || index.groupSessions.get(id) || null;
}

// ---- reading a session ---------------------------------------------------------------------------

const shown = items => items.filter(i => i.kind !== 'result').length;

function readMessages(id, q) {
  let t = transcriptFor(id);
  if (!t) { indexTranscripts(cfg.projectsDir, 0); t = transcriptFor(id); }
  if (!t) return { items: [], start: 0, end: 0, hasEarlier: false };
  const row = findRow(id);
  const cwd = row?.cwd || '';
  // A client far behind (a stale tab, or a file that was rewritten) gets a fresh tail, not the whole file.
  const after = Number(q.get('after')) || 0;
  if (q.has('after') && completeEnd(t) - after <= cfg.chunkBytes * 4 && after <= completeEnd(t)) return readAfter(t, after, cwd, cfg.outputChars, uploads.dir);
  let end = q.has('before') ? Number(q.get('before')) : completeEnd(t);
  const reset = q.has('after');
  const first = readBefore(t, end, cfg.chunkBytes, cwd, cfg.outputChars, uploads.dir);
  let { items, start } = first;
  end = first.end;
  for (let i = 0; i < 6 && start > 0 && shown(items) < 40; i++) {
    const more = readBefore(t, start, cfg.chunkBytes, cwd, cfg.outputChars, uploads.dir);
    items = [...more.items, ...items];
    start = more.start;
  }
  return { items, start, end, hasEarlier: start > 0, ...(reset ? { reset: true } : {}) };
}

// Settings follow Claude Desktop: a session Desktop knows keeps the mode, model and effort it recorded, and
// anything else gets Desktop's mode for that folder, Desktop's effort, and the model in ~/.claude/settings.json.
const MODE_NAMES = { default: 'manual' };
function readUserSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.claude', 'settings.json'), 'utf8')); } catch { return {}; }
}

function desktopSettings(row) {
  const desk = loadDesktop(cfg.desktopDir);
  const user = readUserSettings();
  const mode = [row?.permissionMode, desk.folderModes[row?.cwd], user.permissions?.defaultMode]
    .map(m => MODE_NAMES[m] || m).find(m => MODES.includes(m)) || cfg.defaultMode;
  return { mode, model: row?.model || null, shownModel: row?.model || user.model || null, effort: row?.effort || desk.effort || null };
}

// What Desktop would use, with whatever model, effort and fast mode was picked here laid over it.
function settingsFor(id, row) {
  const { model, effort, fast } = readPicks()[id] || {};
  return { ...desktopSettings(row), ...(model && { model, shownModel: model }), ...(effort && { effort }), ...(fast && { fast }), chrome: cfg.chrome };
}

async function newSession({ cwd, text, images = [], documents = [], files = [], mode, model, effort, fast, title, routine }) {
  const s = desktopSettings({ cwd });
  const chat = await startChat({ cwd, mode: mode || s.mode, model: model || s.model, shownModel: model || s.shownModel, effort: effort || s.effort, fast, text: withMentions(files, text), images, documents, chrome: cfg.chrome, claude: cfg.claude, chips, subs: subCtx });
  dropFastOnRefusal(chat);
  // The session is running by now, so a record that cannot be written must not tell the caller that it never started.
  try {
    // The list falls back on this title when the transcript's first line is too long to read, as it is with an image in it.
    const named = title || titleText(text.trim()) || (files.length ? (files.length > 1 ? 'Files' : files[0].name) : images.length > 1 ? 'Images' : 'Image');
    fs.writeFileSync(startedFile, JSON.stringify([...readStarted(), { id: chat.id, cwd, at: Date.now(), title: named.slice(0, 120), ...(routine && { routine }) }]));
    // Fast mode is saved from the chat, as the CLI may have refused it already. The hook covers a refusal that comes later.
    if (model || effort || chat.fast) savePick(chat.id, { ...(model && { model }), ...(effort && { effort }), ...(chat.fast && { fast: true }) });
  } catch (e) {
    console.error(`Could not record session ${chat.id}: ${e.message}`);
  }
  if (cfg.desktopHandoff && !routine) afterTurn(chat, () => handOff(chat.id));
  return chat.id;
}

// ---- sub sessions --------------------------------------------------------------------------------

// What a chat is waiting on for the owner's say-so.
const pendingOf = id => getChat(id)?.status().pending ?? [];

// What an ordinary chat reaches the sessions under it through. Each call looks the index up again, so a session archived or nested since is seen
// as it is now. Every row is in the index whether archived or not, and `via` skips the archived ones unless they are asked for.
function subCtx(sessionId) {
  return {
    lookup({ archived }) {
      const { rows } = buildIndex({ archived });
      return { self: rows.get(sessionId) ?? null, rows: [...rows.values()].filter(r => archived || !r.archived) };
    },
    pending: pendingOf,
    summary: (id, cwd) => summaries.get(id, cwd),
  };
}

// ---- group sessions ------------------------------------------------------------------------------

// The session is running by now, so a layout that cannot be written is logged and told to the caller as not placed. `home` is a group, which
// takes it in, or a section: Pinned pins it, and the sections that list loose sessions leave it as it is, where GhostShell's own sessions list.
function placeStarted(id, home) {
  try {
    if (home === 'pinned') layout.pin(id, true);
    else if (!sectionById(home)) layout.move(id, home);
    return true;
  } catch (e) {
    console.error(`Could not place ${id} in ${home}: ${e.message}`);
    return false;
  }
}

// The sessions a section's chat reaches: those the sidebar lists in it, with the sessions nested under each, so the cap on a list and the
// families are the sidebar's, and the archived ones, which no list holds.
function sectionMembers(section) {
  const { rows, archivedSection } = buildIndex({ archived: true });
  const live = withKids(sectionSessions(buildIndex(), section.id));
  return { name: section.name, section, members: [...live, ...[...rows.values()].filter(r => archivedSection.get(r.id) === section.id)] };
}

// What a group's chat, or a built-in section's, reaches its sessions through. Each call looks the group up again, so a group deleted by hand
// takes its tools with it. A section is always there, and its `section` tells the tools where a session it starts goes, if it can start one.
function groupCtx(groupId) {
  const section = sectionById(groupId);
  return {
    stateDir: cfg.stateDir,
    ...(section && { section }),
    lookup() {
      if (section) return sectionMembers(section);
      const group = layout.read().groups.find(g => g.id === groupId);
      if (!group) return null;
      const { rows } = buildIndex({ archived: true });
      return { name: group.name, members: [...rows.values()].filter(r => r.group === groupId) };
    },
    pending: pendingOf,
    async start({ cwd, prompt, title }) {
      const id = await newSession({ cwd, text: prompt, title });
      return { id, placed: placeStarted(id, groupId) };
    },
  };
}

// The CLI refuses --session-id for an id that has a transcript and --resume for one that has none, so each spawn asks. The index is rescanned
// once before a no, since a transcript written a moment ago may not be in it yet.
const hasTranscript = id => !!(transcriptFor(id) || (indexTranscripts(cfg.projectsDir, 0), transcriptFor(id)));

// Booked when the owner first opens the chat of a group or a built-in section. It makes the folder and writes the id and starts nothing, so it
// costs no tokens, and it is synchronous, so two tabs opening it together get the same id.
function bookGroupSession(groupId) {
  if (!sectionById(groupId) && !layout.read().groups.some(g => g.id === groupId)) throw refuse(404, 'Unknown group.');
  try {
    ensureGroupDir(cfg.stateDir, groupId);
  } catch (e) {
    throw refuse(500, `Could not make the group's folder: ${e.message}`);
  }
  return layout.claimGroupSession(groupId, () => crypto.randomUUID());
}

// ---- routines ------------------------------------------------------------------------------------
// GhostShell is the only home for routines. See docs/adr/20261015-capcom-runs-routines-itself.md and
// docs/adr/20261025-ghostshell-is-the-only-home-for-routines.md.

// What is wrong with the folder, mode, model and effort of a routine, each under its field, in the order the first of them is told in.
function routineProblems(r) {
  const found = {};
  if (typeof r.cwd !== 'string' || !r.cwd.trim()) found.cwd = 'The routine has no folder. Give its full path, starting with /.';
  else if (!path.isAbsolute(r.cwd)) found.cwd = `The folder ${r.cwd} must be a full path starting with /.`;
  else if (!fs.existsSync(r.cwd)) found.cwd = `The folder ${r.cwd} does not exist.`;
  else if (!fs.statSync(r.cwd).isDirectory()) found.cwd = `${r.cwd} is not a folder.`;
  if (r.mode && !MODES.includes(r.mode)) found.mode = `Unknown permission mode ${r.mode}.`;
  if (r.model && !MODEL.test(r.model)) found.model = `Unknown model ${r.model}.`;
  if (r.effort && !EFFORTS.includes(r.effort)) found.effort = `Unknown effort level ${r.effort}.`;
  return found;
}

const routineProblem = r => Object.values(routineProblems(r))[0] ?? null;

// An id is kept for any routine whose runs the session list still holds, so a new routine never takes over the runs of a deleted one.
const routineIdTaken = id => [...buildIndex().rows.values()].some(r => r.routine === id);

// A run is a new session like any other, except that it is never handed to Desktop, whose window it would open at fire time.
const routines = makeScheduler({
  store: makeRoutines(cfg.stateDir),
  check: routineProblem,
  fieldProblems: routineProblems,
  idTaken: routineIdTaken,
  start: (r, text) => newSession({ cwd: r.cwd, text, mode: r.mode, model: r.model, effort: r.effort, title: r.title, routine: r.id }),
  working: id => { const chat = getChat(id); return !!chat && chat.state !== 'idle'; },
  waiting: id => getChat(id)?.state === 'waiting',
  stop: id => { const chat = getChat(id); if (chat) { chat.interrupt(); chat.stop(); } },
  limit: 3,
});

// ---- handing new sessions to Desktop -------------------------------------------------------------
// Opt-in through desktopHandoff in config.json, because a hand-off adds to Desktop's sidebar and switches its window.
// NOTE: [14 Oct 2026] EK - Desktop's own hand-off link is the only way into its sidebar, because Desktop keeps its session
// list in memory and writes over its files. It takes the title from the transcript's custom-title entry and opens the
// session in its window. Read from Desktop's code on 14 Oct 2026, so re-check this after a Desktop update.

const markStarted = (id, patch) => fs.writeFileSync(startedFile, JSON.stringify(readStarted().map(s => (s.id === id ? { ...s, ...patch } : s))));
const inDesktop = id => loadDesktop(cfg.desktopDir, 0).sessions.some(r => r.id === id);
const shortTitle = text => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 60).replace(/\s+\S*$/, '')}…` : t; };

function afterTurn(chat, fn) {
  const once = ev => { if (ev.type === 'turn-end' || ev.type === 'exit') { chat.listeners.delete(once); fn(); } };
  chat.listeners.add(once);
}

async function handOff(id) {
  const s = readStarted().find(x => x.id === id);
  if (!s || s.desktopAt) return;
  // Capcom's process is stopped first, so the two apps never run the session at once. The next message here starts it again.
  const chat = getChat(id);
  if (chat && chat.state !== 'idle') return afterTurn(chat, () => handOff(id));
  if (chat?.proc) { const exited = new Promise(done => chat.proc.once('exit', done)); chat.stop(); await exited; }
  if (getChat(id)?.proc) return afterTurn(getChat(id), () => handOff(id));
  const t = indexTranscripts(cfg.projectsDir, 0).get(id);
  if (!t) return;
  if (inDesktop(id)) return markStarted(id, { desktopAt: Date.now() });
  if (!fs.readFileSync(t.file, 'utf8').includes('"type":"custom-title"')) {
    fs.appendFileSync(t.file, `${JSON.stringify({ type: 'custom-title', customTitle: shortTitle(ownTitle(layout.read(), id) || s.title || 'GhostShell session'), sessionId: id })}\n`);
  }
  // Marked before the link opens, so a failed hand-off is logged once rather than retried into Desktop's window.
  markStarted(id, { desktopAt: Date.now() });
  execFile('open', ['-g', `claude://resume?session=${id}`], err => { if (err) console.error(`Hand-off of ${id} to Desktop failed: ${err.message}`); });
  setTimeout(() => { if (!inDesktop(id)) console.error(`Desktop did not add ${id} to its sidebar.`); }, 30_000).unref();
}

// ---- http ----------------------------------------------------------------------------------------

const PUBLIC = path.join(ROOT, 'public');
const page = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');
// NOTE: [15 Oct 2026] EK - Every file under public/ with one of these extensions is served before sign-in. The page templates
// (.html) and the vendor license texts are not on the list, so keep anything private out of public/.
// NOTE: [22 Oct 2026] EK - test/load-hooks.mjs mirrors the module types here (.js, .mjs) and asset()'s lookup by raw path in its SCRIPT
// rule. Change that rule when this list changes, or test/load.test.mjs stops matching what the server sends.
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

// The weak tag is the file's size and modified time. It is taken before the file is read, so a file changed in between costs one more download, never a stale copy.
function asset(pathname) {
  const type = TYPES[path.extname(pathname)];
  const file = path.join(PUBLIC, pathname);
  if (!type || !file.startsWith(PUBLIC + path.sep)) return null;
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? { file, type, etag: `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"` } : null;
  } catch { return null; }
}

const opaque = tag => tag.trim().replace(/^W\//, '');
// Whether the browser's If-None-Match holds this tag. Weak comparison, so the W/ in front does not count.
const held = (header, etag) => !!header && header.split(',').some(t => t.trim() === '*' || opaque(t) === opaque(etag));

function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// One megabyte, except where a message can carry images (the send and new routes).
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// A form or script on another site cannot drive this, because every write must come from this host over this scheme.
// NOTE: [16 Oct 2026] EK - The scheme is the proxy's X-Forwarded-Proto, so a proxy that ends https and does not send it
// has every write refused with a 403. docs/remote-access.md says so.
function sameOrigin(req) {
  const { origin, host } = req.headers;
  if (!origin) return true;
  if (!host) return false;
  try { return new URL(origin).origin === new URL(`${overHttps(req) ? 'https' : 'http'}://${host}`).origin; } catch { return false; }
}

// NOTE: [23 Oct 2026] EK - The global check lets a request with no Origin through, so the routes that run something as the owner (the
// terminal and the routine writes) insist on one. A browser always sends Origin with a cross-site write.
function strictOrigin(req) {
  if (!req.headers.origin || !sameOrigin(req)) return false;
  const site = req.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}

// A JSON body, or null when it is not JSON or is too large.
async function readJson(req, limit) {
  try { return JSON.parse(await readBody(req, limit) || '{}') || {}; } catch { return null; }
}

function indexPage() {
  return page('index.html').replace(/\{\{station\}\}/g, () => esc(cfg.station)).replace(/\{\{home\}\}/g, () => esc(os.homedir()));
}

function loginPage(message = '') {
  return page('login.html').replace('{{message}}', message);
}

function ensureChat(id, row, { mode } = {}) {
  const groupId = row?.groupSession;
  const section = groupId && sectionById(groupId);
  // A group's or section's session starts on what a new session in its folder would, and has its tools and standing instructions.
  const s = settingsFor(id, groupId ? { cwd: row.cwd } : row);
  const group = groupId && {
    group: groupCtx(groupId),
    instructions: () => (section ? guideFor(section.name, section.id) : guideFor(layout.read().groups.find(g => g.id === groupId)?.name ?? row.title)),
    fresh: () => !hasTranscript(id),
  };
  const chat = chatFor(id, { cwd: row?.cwd, mode: MODES.includes(mode) ? mode : s.mode, model: s.model, shownModel: s.shownModel, effort: s.effort, fast: s.fast, chrome: s.chrome, claude: cfg.claude, chips, ...group, subs: groupId ? undefined : subCtx });
  dropFastOnRefusal(chat);
  for (const fn of viewers.get(id) || []) chat.listeners.add(fn);
  return chat;
}

// The message is already sent by now, so a layout that cannot be written is logged, not reported as a failed send.
function unarchive(id) {
  try {
    layout.unarchive(id);
    return true;
  } catch (e) {
    console.error(`Could not unarchive ${id}: ${e.message}`);
    return false;
  }
}

const workingChat = id => {
  const chat = getChat(id);
  return chat && chat.state !== 'idle' ? chat : null;
};

// A chat Capcom is running shows its own work from the CLI's stream, so only a chat it is not running is read from its transcript.
const outsideFor = id => (workingChat(id) ? null : outside.read(transcriptFor(id)));

// The list has its own reader, so it never pushes out the files the open chats' checks hold. An open chat is read whatever the index
// says, because the index's mtime can predate the write that began its turn.
const turnOf = (id, now) => {
  const chat = workingChat(id);
  if (chat) return chat.work.snapshot();
  const t = transcriptFor(id);
  if (viewers.get(id)?.size) return outside.read(t);
  return t && now - t.mtime < STALE_MS ? listOutside.read(t) : null;
};

// The mark a row shows, from Desktop's record of it read beside Capcom's own marks. A turn Capcom ran after Desktop's last one makes
// Desktop's verdict and error stale, and a page of Capcom with the chat open has read it, which Desktop cannot hear.
function dotFor(r, elsewhere, { desk, mine, now }) {
  const edge = mine.edges.get(r.id) ?? 0;
  const seenAt = mine.seen.get(r.id);
  const deskUnread = desk.unread.has(r.localId) && !(seenAt >= r.sortAt);
  const ownUnread = mine.unread.has(r.id) && !(seenAt >= mine.unread.get(r.id));
  const errorAt = Math.max(r.error && !(edge > r.errorAt) ? r.errorAt : 0, mine.errors.get(r.id) ?? 0);
  return dotOf({
    archived: r.archived, routine: r.routine, updatedAt: r.sortAt,
    approval: r.state === 'waiting', responding: r.state === 'working', elsewhere,
    verdict: edge > r.sortKey ? null : r.verdict ?? null,
    error: errorAt > 0, errorAt, unread: !viewers.get(r.id)?.size && (deskUnread || ownUnread), ackedAt: desk.acked.get(r.localId),
  }, now);
}

const modelKey = set => set.model || set.shownModel || null;

// A chat that Capcom runs is asked for its own count. Without a process, or when the CLI cannot answer, the last reply in the
// transcript gives the total, and the window is the one last seen for the model the chat is set to.
async function contextFor(id, detail) {
  const chat = getChat(id);
  // The count is for the model the chat was on when it was asked, so it is saved only if the chat is still on that model.
  const asked = chat?.model;
  const figure = shapeUsage(await chat?.contextUsage(detail), detail);
  if (figure) {
    if (asked && chat.model === asked) windows.learn(asked, figure);
    return { source: 'process', detail, ...figure };
  }
  const t = transcriptFor(id) || (indexTranscripts(cfg.projectsDir, 0), transcriptFor(id));
  const found = t && lastReply(t.file);
  if (!found) return { source: 'none' };
  if (found.compacted) return { source: 'none', compacted: true };
  return transcriptFigure(found, windows.get(modelKey(chat || settingsFor(id, findRow(id)))));
}

// What the page redraws from. The clock is left out because it moves on every read.
const outsideKey = o => (o ? JSON.stringify([o.startedAt, o.tokens, o.tools.map(t => t.id)]) : '');

const EVENT_BACKLOG = 8 * 1024 * 1024;

function events(req, res, id) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  // A page that stops reading is dropped once this much waits for it, and its EventSource reconnects to a fresh snapshot.
  const write = (type, data) => {
    if (res.destroyed) return;
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    if (res.writableLength > EVENT_BACKLOG) res.destroy();
  };
  const chat = getChat(id);
  const first = outsideFor(id);
  // The key of the turn of another app this viewer was last sent, so a change is sent once.
  let shown = outsideKey(first);
  // The page drops that turn when Capcom starts work in the chat. If the work ends before the next look at the transcript, the key
  // would still match and the page would never get the turn back, so the key is cleared and the turn is sent again.
  const forward = ev => {
    if (ev.type === 'state' && ev.data.state !== 'idle') shown = '';
    write(ev.type, ev.data);
  };
  const row = findRow(id);
  write('status', { ...(chat ? chat.status() : { state: 'idle', running: false, ...settingsFor(id, row), live: '', pending: [] }), outside: first });
  if (!row?.groupSession) write('terminal', { type: 'state', ...terminal.snapshot(id, row?.cwd || '') });
  if (!viewers.has(id)) viewers.set(id, new Set());
  viewers.get(id).add(forward);
  chat?.listeners.add(forward);
  // A page opening the chat reads it, which clears its unread mark here. Desktop's own mark is not Capcom's to clear.
  writeMark(() => marks.opened(id, Date.now()));
  // Sessions running in Desktop or a terminal only show up as a growing file, so the file is watched too.
  let size = transcriptFor(id)?.size ?? -1;
  // A group's session has no file until its first message, which a chat of ours sends, so the index is not rescanned for one while no chat of ours runs it.
  const groupChat = !!findRow(id)?.groupSession;
  const watch = setInterval(() => {
    const t = transcriptFor(id) || (groupChat && !getChat(id) ? null : (indexTranscripts(cfg.projectsDir, 3000), transcriptFor(id)));
    if (!t) return;
    let now;
    try { now = fs.statSync(t.file).size; } catch { return; }
    if (now !== size) { size = now; write('changed', {}); }
    const out = outsideFor(id);
    if (outsideKey(out) !== shown) { shown = outsideKey(out); write('outside', out); }
  }, 1500);
  const beat = setInterval(() => res.destroyed || res.write(': keep-alive\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(watch);
    clearInterval(beat);
    viewers.get(id)?.delete(forward);
    getChat(id)?.listeners.delete(forward);
    writeMark(() => marks.closed(id, Date.now()));
  });
}

const NO_SESSION = 'No session with that id on this Mac.';
// The word for what owns a chat that is no session's: a group, or one of the built-in sections.
const kindOf = row => (SECTION_IDS.includes(row.groupSession) ? 'section' : 'group');
const refuse = (status, message) => Object.assign(new Error(message), { status });

async function editLayout(req, res, change) {
  const body = await readJson(req);
  if (!body) return send(res, 400, { error: 'Send a JSON body.' });
  // A new password can land while the body is still arriving, so the session is checked again before the layout is written.
  if (!auth.check(req)) return send(res, 401, { error: 'Signed out.' });
  const { id } = body;
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Which session?' });
  const row = findRow(id);
  if (!row) return send(res, 404, { error: NO_SESSION });
  if (row.groupSession) return send(res, 400, { error: `A ${kindOf(row)}'s session stays with its ${kindOf(row)}.` });
  let extra;
  try {
    extra = change(id, body);
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
  const now = layout.read();
  return send(res, 200, { id, group: now.assignments[id] || null, pinned: now.pinned.includes(id), ...extra });
}

// Archiving a chat Capcom runs stops it: a turn in progress is interrupted and its approvals denied, then the process closes.
// With stop: false a running chat is refused with a 409 before anything is written, so the caller can ask first.
function setArchived(id, archived, stop) {
  if (typeof archived !== 'boolean') throw Object.assign(new Error('Archived or not?'), { status: 400 });
  if (stop !== undefined && typeof stop !== 'boolean') throw Object.assign(new Error('Stop it or not?'), { status: 400 });
  if (!archived) {
    layout.unarchive(id);
    return { archived };
  }
  const chat = getChat(id);
  const stopped = !!chat && chat.state !== 'idle';
  if (stopped && stop === false) throw Object.assign(new Error('That chat is running, and archiving it would stop it.'), { status: 409 });
  // The sessions under an archived one move up to the one it showed under by themselves, so archiving writes no link.
  layout.archive(id);
  if (stopped) chat.interrupt();
  chat?.stop();
  return { archived, ...(stopped && { stopped: true }) };
}

// Nests a session under another, or takes it out when `parent` is null. A family is one level deep, so a drop on a child nests under that
// child's parent. The answer carries the parent the list now shows.
function nest(id, parent) {
  if (parent !== null && typeof parent !== 'string') throw refuse(400, 'Nest it under which session?');
  const { rows, groupSessions } = buildIndex();
  if (parent === null) {
    // A null written with no link to override would hide one that Desktop makes later.
    if (linkNow(id) !== null) layout.unnest(id, { group: rows.get(id).group, pinned: rows.get(id).pinned, relink: keepFamily(id, rows) });
    return { parent: null };
  }
  if (groupSessions.has(parent)) throw refuse(400, `A ${kindOf(groupSessions.get(parent))}'s session cannot hold sessions.`);
  const target = rows.get(parent);
  if (!target) throw refuse(404, NO_SESSION);
  if (target.archived) throw refuse(400, 'That session is archived.');
  if (target.routine) throw refuse(400, 'A routine run cannot hold sessions.');
  // The links lead through archived sessions too, which a family does not show, so they are followed all the way up.
  if ([target, ...chainOf(rows, linksNow(), target)].some(r => r.id === id)) throw refuse(400, 'A session cannot nest under itself or its own child.');
  const root = target.parent ?? target.id;
  // A session that shows under that parent already keeps its own group and its link.
  if (rows.get(id).parent === root) return { parent: root };
  layout.nest(id, root, { relink: keepFamily(id, rows) });
  return { parent: buildIndex().rows.get(id).parent };
}

// A group's own chat is retired with the group, and one Capcom runs is stopped as archiving it would stop it, after the layout is written.
function removeGroup(id) {
  const group = layout.removeGroup(id);
  const chat = group.session ? getChat(group.session) : undefined;
  const stopped = !!chat && chat.state !== 'idle';
  if (stopped) chat.interrupt();
  chat?.stop();
  return { ...group, ...(stopped && { stopped: true }) };
}

// Projects and groups change by POST only, each with a JSON body, and a GET to these paths is a 404 that changes nothing.
const STRUCTURE = new Map([
  ['/api/layout/project/add', b => layout.addProject(b.name)],
  ['/api/layout/project/rename', b => layout.renameProject(b.id, b.name)],
  ['/api/layout/group/rename', b => layout.renameGroup(b.id, b.name)],
  ['/api/layout/project/remove', b => layout.removeProject(b.id)],
  ['/api/layout/group/add', b => layout.addGroup(b.name, b.project ?? null)],
  ['/api/layout/group/move', b => layout.moveGroup(b.id, b.project ?? null)],
  ['/api/layout/group/order', b => layout.orderGroup(b.id, { before: b.before, after: b.after })],
  ['/api/layout/group/remove', b => removeGroup(b.id)],
]);

async function editStructure(req, res, change) {
  const body = await readJson(req, 10_000);
  if (!body) return send(res, 400, { error: 'Send a JSON body.' });
  // A new password can land while the body is still arriving, so the session is checked again before the layout is written.
  if (!auth.check(req)) return send(res, 401, { error: 'Signed out.' });
  try {
    return send(res, 200, change(body));
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
}

// What the CLI lists under `key` for a session or a folder, named in the body as `id` or `cwd`. A chat with a process answers from its own
// reply, and anything else from a probe of its folder.
async function askLists(req, res, key, list) {
  const body = await readJson(req, 10_000);
  if (!body) return send(res, 400, { error: 'Send a JSON body.' });
  const { id, cwd } = body;
  let folder = cwd;
  if (typeof id === 'string') {
    if (!/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Bad session id' });
    const known = getChat(id)?.[key];
    if (known) return send(res, 200, { [key]: known });
    const row = findRow(id);
    if (!row) return send(res, 404, { error: NO_SESSION });
    folder = row.cwd && fs.existsSync(row.cwd) ? row.cwd : os.homedir();
  } else if (cwd === undefined) {
    return send(res, 400, { error: 'Which session or folder?' });
  } else if (typeof cwd !== 'string' || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return send(res, 400, { error: 'That folder does not exist on this Mac.' });
  }
  try {
    return send(res, 200, { [key]: await list(folder, cfg.claude) });
  } catch (e) {
    return send(res, 502, { error: e.message });
  }
}

// GET api/routines lists them and POST adds one. GET api/routines/<id>/prompt reads one's prompt, PATCH api/routines/<id> edits it and
// DELETE removes it. POST api/routines/<id>/run runs one now, and POST api/routines/<id>/enabled switches it on or off.
// A routine runs a prompt as the owner, so the writes take the terminal's stricter origin check.
async function routinesApi(req, res, parts) {
  const [, , id, action] = parts;
  const adding = parts.length === 2;
  if (!adding && !/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Bad routine id' });
  const allowed = adding ? ['GET', 'POST'] : parts.length === 3 ? ['PATCH', 'DELETE'] : action === 'prompt' ? ['GET'] : ['run', 'enabled'].includes(action) ? ['POST'] : null;
  if (parts.length > 4 || !allowed) return send(res, 404, { error: 'Not found' });
  if (!allowed.includes(req.method)) return send(res, 405, { error: 'Method not allowed' }, 'application/json', { allow: allowed.join(', ') });
  try {
    if (req.method === 'GET') return send(res, 200, adding ? routines.list() : routines.prompt(id));
    if (!strictOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });
    if (req.method === 'DELETE') return send(res, 200, { removed: routines.remove(id) });
    const body = await readJson(req, 300_000);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Send a JSON body.' });
    // A new password can land while the body is still arriving, so the session is checked again before anything is written.
    if (!auth.check(req)) return send(res, 401, { error: 'Signed out.' });
    if (adding) return send(res, 200, { routine: routines.add(body) });
    if (req.method === 'PATCH') return send(res, 200, { routine: routines.edit(id, body) });
    if (action === 'run') return send(res, 200, await routines.runNow(id));
    return send(res, 200, { routine: routines.setEnabled(id, body.enabled) });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message, ...(e.problems && { problems: e.problems }) });
  }
}

// GET api/schedule?cron=&jitter= gives the next three times a schedule fires, for the form that is being filled in. It reserves no routine id.
// A half-typed schedule is an ordinary answer while typing, so it is a 200 with the problem and the page's console stays clean.
function scheduleApi(req, res, u) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' }, 'application/json', { allow: 'GET' });
  const cron = u.searchParams.get('cron') ?? '';
  const jitter = Number(u.searchParams.get('jitter') || 0);
  try {
    parseCron(cron);
    if (!validJitter(jitter)) throw new Error(JITTER_PROBLEM);
    return send(res, 200, { next: upcoming(cron, jitter, Date.now()), problem: null });
  } catch (e) {
    return send(res, 200, { next: [], problem: e.message });
  }
}

// The localhost origin is believed only on a request that reached Capcom as localhost. Sent through a proxy, a page on another
// device could borrow it and have the owner approve a passkey prompt that was meant for that page.
const localOrigin = `http://localhost:${cfg.port}`;
const proxied = req => Object.keys(req.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-'));
function claimedOrigin(req, origin) {
  return origin === localOrigin && (req.headers.host !== `localhost:${cfg.port}` || proxied(req)) ? null : origin;
}

// A passkey that the server refuses is a plain reply. Anything else is a bug and goes to the 500 handler.
function passkeyRefusal(res, e) {
  if (!(e instanceof PasskeyError)) throw e;
  if (e.cause) console.error(`${e.message} (${e.cause.message})`);
  return send(res, e.status, { error: e.message });
}

// The sign-in page asks for a challenge at passkey-options, signs it with a passkey, and sends the answer to passkey-login.
// A refused answer counts toward the same lockout as a wrong password.
async function passkeySignIn(req, res, u, { secure, agent }) {
  const body = await readJson(req, 100_000);
  if (!body) return send(res, 400, { error: 'Send JSON.' });
  if (u.pathname === '/passkey-options') return passkeyOptions(req, res, body);
  if (auth.locked()) return send(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
  try {
    passkeys.authenticate(body);
  } catch (e) {
    if (e instanceof PasskeyError) auth.fail();
    return passkeyRefusal(res, e);
  }
  return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': auth.cookie(auth.issue(agent), secure) });
}

// Having no passkey to offer is an ordinary answer, so it is a 200 and the sign-in page's console stays clean.
function passkeyOptions(req, res, body) {
  try {
    return send(res, 200, { options: passkeys.authenticationOptions(claimedOrigin(req, body.origin)) });
  } catch (e) {
    if (!(e instanceof PasskeyError) || e.status >= 500) throw e;
    return send(res, 200, { options: null, why: e.status === 404 ? '' : e.message });
  }
}

// GET api/passkeys lists them. POST api/passkeys/options starts adding one, POST api/passkeys finishes it, and POST api/passkeys/remove removes one.
async function passkeysApi(req, res, parts, u) {
  const step = parts[2];
  if (req.method === 'GET' && !step) return send(res, 200, { available: passkeys.allowed(claimedOrigin(req, u.searchParams.get('origin'))), passkeys: passkeys.list() });
  if (req.method !== 'POST' || parts.length > 3 || (step && !['options', 'remove'].includes(step))) return send(res, 404, { error: 'Not found' });
  const body = await readJson(req, 100_000);
  if (!body) return send(res, 400, { error: 'Send JSON.' });
  // A new password can land while the body is still arriving, so the session is checked again before a passkey is written.
  if (!auth.check(req)) return send(res, 401, { error: 'Signed out.' });
  try {
    if (step === 'options') return send(res, 200, passkeys.registrationOptions(claimedOrigin(req, body.origin)));
    if (step === 'remove') return passkeys.remove(String(body.id)) ? send(res, 200, { passkeys: passkeys.list() }) : send(res, 404, { error: 'No such passkey.' });
    passkeys.register(body, req.headers['user-agent']);
    return send(res, 200, { passkeys: passkeys.list() });
  } catch (e) {
    return passkeyRefusal(res, e);
  }
}

// A file the CLI reads by path. GET says whether this server takes files and how many and how large, so a page loaded before an
// update to this server can tell. POST is the file itself, named in x-file-name, and answers with the id a message names it by.
async function uploadsApi(req, res) {
  if (req.method === 'GET') return send(res, 200, { maxBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    return send(res, 200, await uploads.save(req, { signedIn: () => !!auth.check(req) }));
  } catch (e) {
    if (!e.status) console.error(e);
    // The rest of a refused body is read and dropped, so the sender is not cut off before it has the reason. A sender that never stops is cut off.
    req.resume();
    setTimeout(() => { if (!req.complete) req.destroy(); }, 10_000).unref();
    return send(res, e.status || 500, { error: e.status ? e.message : 'The file could not be saved.' });
  }
}

// ---- the terminal --------------------------------------------------------------------------------
// Commands run in the session's folder from a click or Enter on the page. See docs/adr/20261023-terminal-without-a-pty.md.

const TERMINAL_HEADERS = { 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' };
const TERMINAL_STEPS = ['run', 'input', 'stop', 'clear'];
const isDirectory = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// A command run with ! is for Claude as well: it is sent at once, as the CLI does, or kept for the next message when the owner's
// settings say Claude is not to reply to commands. Mid-turn the CLI queues it, as it does a typed message.
function handBashToClaude(id, { run, stdout, stderr }) {
  const row = findRow(id);
  if (!row) return null;
  const text = handOffText({ command: run.command, stdout, stderr });
  if (readUserSettings().respondToBashCommands === false) {
    terminal.hold(id, text);
    return 'held';
  }
  ensureChat(id, row).send(text);
  if (row.archived) unarchive(id);
  return 'sent';
}

// GET api/sessions/<id>/terminal lists the runs and starts nothing. Run, input, stop and clear are POSTs that a page on another site
// cannot make: they need this host's Origin, a JSON body, which a form cannot send, and no cross-site Sec-Fetch-Site.
async function terminalApi(req, res, id, [step, ...extra]) {
  const reply = (status, body, headers) => send(res, status, body, 'application/json', { ...TERMINAL_HEADERS, ...headers });
  if (extra.length) return reply(404, { error: 'Not found' });
  if (step === undefined) {
    if (req.method !== 'GET') return reply(405, { error: 'Method not allowed' }, { allow: 'GET' });
    const row = findRow(id);
    if (row?.groupSession) return reply(400, { error: `A ${kindOf(row)}'s session has no terminal.` });
    return row ? reply(200, terminal.snapshot(id, row.cwd || '')) : reply(404, { error: NO_SESSION });
  }
  if (!TERMINAL_STEPS.includes(step)) return reply(404, { error: 'Not found' });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' }, { allow: 'POST' });
  if (!strictOrigin(req)) return reply(403, { error: 'Cross-site request refused.' });
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'Send JSON.' });
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Send a JSON body.' });
  // A new password can land while the body is still arriving, so the session is checked again before anything runs.
  if (!auth.check(req)) return reply(401, { error: 'Signed out.' });
  const row = findRow(id);
  if (!row) return reply(404, { error: NO_SESSION });
  // A group's or section's session works in GhostShell's own state folder and asks before every Bash call, so it gets no terminal.
  if (row.groupSession) return reply(400, { error: `A ${kindOf(row)}'s session has no terminal.` });
  try {
    if (step === 'run') {
      if (!row.cwd || !isDirectory(row.cwd)) return reply(409, { error: 'This session\'s folder does not exist on this Mac.' });
      return reply(200, { run: await terminal.run(id, { command: body.command, source: body.source, folder: row.cwd }) });
    }
    if (step === 'input') {
      terminal.input(id, body.run, body.text, body.eof);
      return reply(200, { ok: true });
    }
    if (step === 'stop') return reply(200, { run: terminal.stop(id, body.run) });
    const runs = terminal.clear(id);
    return reply(200, { cwd: terminal.cwd(id, row.cwd || ''), runs });
  } catch (e) {
    if (!e.status) throw e;
    return reply(e.status, { error: e.message });
  }
}

const MAX_SUMMARY_IDS = 60;

// The distinct session ids in ?ids=, or the sentence for a 400 when there are none or too many.
function askedIds(u) {
  const ids = [...new Set((u.searchParams.get('ids') ?? '').split(',').map(id => id.trim()).filter(Boolean))];
  if (!ids.length) return 'Name the sessions in ids.';
  return ids.length > MAX_SUMMARY_IDS ? `Ask for at most ${MAX_SUMMARY_IDS} sessions at a time.` : ids;
}

// GET api/summaries?ids=a,b,c answers for each id that is a session: the first sentence of its latest reply, when it was said, and what it waits on.
// With detail=1 each also has the reply itself. An id that is no session, or is a group's chat, is left out without a word.
function summariesApi(res, u) {
  const ids = askedIds(u);
  if (typeof ids === 'string') return send(res, 400, { error: ids });
  const detail = u.searchParams.get('detail') === '1';
  const { rows } = buildIndex({ archived: true });
  const found = ids.filter(id => rows.has(id)).map(id => {
    const said = summaries.get(id, rows.get(id).cwd);
    return [id, { line: said?.line ?? '', at: said?.at ?? null, pending: pendingLines(pendingOf(id)), ...(detail && { reply: said?.reply ?? '' }) }];
  });
  return send(res, 200, { summaries: Object.fromEntries(found) });
}

// GET api/pulls?ids=a,b,c answers for each id that is a session: the pull requests it is working on, with their status from GitHub, and
// whether some are still being read. An id that is no session, or is a group's chat, is left out without a word, and a broken or missing gh gives empty lists.
async function pullsApi(res, u) {
  const ids = askedIds(u);
  if (typeof ids === 'string') return send(res, 400, { error: ids });
  const { rows } = buildIndex({ archived: true });
  const urls = new Map(ids.filter(id => rows.has(id)).map(id => [id, pulls.urlsFor(id, rows.get(id).cwd)]));
  const { found, settling } = await pulls.lookup([...new Set([...urls.values()].flat())]);
  const answer = Object.fromEntries([...urls].map(([id, list]) => [id, list.filter(url => found.has(url)).map(url => found.get(url))]));
  return send(res, 200, { pulls: answer, settling });
}

async function api(req, res, u) {
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[1] === 'routines') return routinesApi(req, res, parts);
  if (parts[1] === 'schedule' && parts.length === 2) return scheduleApi(req, res, u);
  if (parts[1] === 'passkeys') return passkeysApi(req, res, parts, u);
  if (req.method === 'GET' && u.pathname === '/api/sessions') {
    const withArchived = u.searchParams.get('archived') === '1';
    const { rows, groupSessions, archivedSection, ...index } = buildIndex({ archived: withArchived });
    // The turns and the marks go onto the rows here and not in buildIndex, which findRow runs for every request.
    const now = Date.now();
    const shared = { desk: loadDesktop(cfg.desktopDir), mine: marks.read(), now };
    for (const r of rows.values()) {
      if (r.archived && !withArchived) continue;
      const turn = turnOf(r.id, now);
      if (turn) {
        r.turnStartedAt = turn.startedAt;
        r.turnMs = turn.turnMs;
        // Another app's long tool call can leave its file still past the 2 minutes that count as idle. Active, never working, because the
        // page lets a working row's archive stop the turn, which Capcom cannot do there.
        if (r.state === 'idle') r.state = 'active';
      }
      // Active also means any write in the last 2 minutes, so only a turn found open in the transcript counts as running in another app.
      r.dot = dotFor(r, r.state === 'active' && !!turn, shared);
      // What the mark was worked out from is not for the page.
      delete r.verdict;
      delete r.error;
      delete r.errorAt;
      delete r.sortKey;
    }
    // Tells a page which of these a server knows, which an older one cannot say: group sessions, sessions for the built-in sections, deleting and ordering groups, adding, editing and deleting routines, routines that run a prompt file, sub session summaries, and the status of the pull requests a session works on.
    return send(res, 200, { ...index, features: { groupSessions: true, sectionSessions: true, groupEdits: true, groupRename: true, routineEdits: true, routineFiles: true, subStatus: true, pullStatus: true } });
  }
  if (req.method === 'GET' && u.pathname === '/api/summaries') return summariesApi(res, u);
  if (req.method === 'GET' && u.pathname === '/api/pulls') return pullsApi(res, u);
  // Archived sessions are left out of the list and found through search, newest archived first. Desktop does not record when it
  // archived a session, but archiving rewrites its record, so the record's file time stands in. With ?group= only that group's or built-in section's.
  if (req.method === 'GET' && u.pathname === '/api/archived') {
    const only = u.searchParams.get('group');
    const { rows, archivedSection } = buildIndex({ archived: true });
    // A built-in section is named by its id, and holds the rows the sidebar would list in it.
    const archived = [...rows.values()].filter(r => r.archived && (only === null || (sectionById(only) ? archivedSection.get(r.id) === only : r.group === only)))
      .map(({ id, title, cwd, branch, routine, state, lastActivityAt, archivedAt }) => ({ id, title, cwd, branch, routine, state, lastActivityAt, archivedAt, archived: true }))
      .sort((a, b) => b.archivedAt - a.archivedAt);
    return send(res, 200, { archived });
  }
  if (req.method === 'GET' && u.pathname === '/api/defaults') {
    return send(res, 200, desktopSettings({ cwd: u.searchParams.get('cwd') || process.env.HOME }));
  }
  if (req.method === 'GET' && u.pathname === '/api/folders') {
    const seen = new Map();
    for (const r of [...buildIndex().rows.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt)) {
      if (r.cwd && !seen.has(r.cwd) && fs.existsSync(r.cwd)) seen.set(r.cwd, r.lastActivityAt);
    }
    const home = process.env.HOME;
    return send(res, 200, { folders: [home, ...[...seen.keys()].filter(f => f !== home)].slice(0, 25) });
  }
  if (req.method === 'POST' && u.pathname === '/api/new') {
    const { cwd, text, mode, model, effort, fast, images: sent, files: listed } = JSON.parse(await readBody(req, MAX_BODY_BYTES) || '{}');
    const { images, error } = readImages(sent);
    if (error) return send(res, 400, { error });
    const { files, error: fileError } = uploads.readFiles(listed);
    if (fileError) return send(res, 400, { error: fileError });
    if (files.length && isSlashCommand(text || '')) return send(res, 400, { error: SLASH_WITH_FILES });
    const { documents, error: documentError } = uploads.readDocuments(files);
    if (documentError) return send(res, 400, { error: documentError });
    if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return send(res, 400, { error: 'That folder does not exist on this Mac.' });
    if (!text?.trim() && !images.length && !files.length) return send(res, 400, { error: 'Write the first message.' });
    if (model && !MODEL.test(model)) return send(res, 400, { error: 'Unknown model.' });
    if (effort && !EFFORTS.includes(effort)) return send(res, 400, { error: 'Unknown effort level.' });
    if (fast !== undefined && typeof fast !== 'boolean') return send(res, 400, { error: 'Unknown fast mode.' });
    const chosen = MODES.includes(mode) ? mode : desktopSettings({ cwd }).mode;
    const id = await newSession({ cwd, text: text || '', images, documents, files, mode: chosen, model, effort, fast });
    uploads.record(id, files);
    return send(res, 200, { id });
  }
  if (u.pathname === '/api/uploads') return uploadsApi(req, res);
  // POSTs, so a page on another site can never start a CLI through them (the same-origin check covers POSTs only).
  if (req.method === 'POST' && u.pathname === '/api/commands') return askLists(req, res, 'commands', listCommands);
  if (req.method === 'POST' && u.pathname === '/api/models') return askLists(req, res, 'models', listModels);
  if (req.method === 'POST' && u.pathname === '/api/layout/move') return editLayout(req, res, (id, body) => layout.move(id, body.group ?? null, leaving(id)));
  if (req.method === 'POST' && u.pathname === '/api/layout/pin') return editLayout(req, res, (id, body) => layout.pin(id, body.pinned, leaving(id)));
  if (req.method === 'POST' && u.pathname === '/api/layout/nest') return editLayout(req, res, (id, body) => nest(id, body.parent));
  if (req.method === 'POST' && u.pathname === '/api/layout/rename') return editLayout(req, res, (id, body) => ({ title: layout.rename(id, body.title) }));
  if (req.method === 'POST' && u.pathname === '/api/layout/archive') return editLayout(req, res, (id, body) => setArchived(id, body.archived, body.stop));
  if (req.method === 'POST' && STRUCTURE.has(u.pathname)) return editStructure(req, res, STRUCTURE.get(u.pathname));
  if (req.method === 'POST' && (u.pathname === '/api/chips/start' || u.pathname === '/api/chips/dismiss')) {
    const { sessionId, toolUseId, title, tldr, prompt, cwd, confirmCwd, model: postedModel, effort: postedEffort } = JSON.parse(await readBody(req) || '{}');
    if (!sessionId || !toolUseId) return send(res, 400, { error: 'Which chip?' });
    const known = chips.get(toolUseId);
    if (known && known.status !== 'open') return send(res, 409, { error: `That chip was already ${known.status}.`, chip: known });
    if (u.pathname.endsWith('/dismiss')) return send(res, 200, { chip: chips.put({ ...known, toolUseId, sessionId: known?.sessionId || sessionId, title, status: 'dismissed' }) });
    const text = known?.prompt || prompt;
    const model = known?.model || postedModel;
    if (model && (typeof model !== 'string' || !MODEL.test(model))) return send(res, 400, { error: 'Unknown model.' });
    const effort = known?.effort || postedEffort;
    if (effort && !EFFORTS.includes(effort)) return send(res, 400, { error: 'Unknown effort level.' });
    // The folder comes from transcript text, so anywhere other than the session's own folder needs the one the card showed.
    const from = findRow(sessionId);
    // The chip's own session decides as well as the posted one, so naming another session cannot lift the group's rules.
    const groupId = findRow(known?.sessionId || sessionId)?.groupSession || from?.groupSession;
    const section = groupId && sectionById(groupId);
    // A card is drawn from a transcript, so the chat's tool is not the only place a section that cannot hold a new session is refused.
    if (section && !section.place) return send(res, 400, { error: chipRefusal(section) });
    const home = from?.cwd;
    // A group's session has no folder to fall back on: its own is private, and a chip must never start there.
    const folder = known?.cwd || cwd || (groupId ? '' : home);
    if (groupId && !folder) return send(res, 400, { error: `This chip names no folder, and a ${section ? 'section' : 'group'}'s session has none of its own. Ask it to suggest the task again with a folder.` });
    if (!text || !folder || !fs.existsSync(folder)) return send(res, 400, { error: 'This chip has no prompt or folder to start from.' });
    let start = folder;
    if (groupId) {
      try {
        start = workFolder(folder, cfg.stateDir);
      } catch (e) {
        return send(res, e.refusal ? 400 : 500, { error: e.refusal ? e.message : 'Could not check that folder.' });
      }
    }
    if ((groupId || folder !== home) && confirmCwd !== folder) return send(res, 400, { error: `This chip starts in ${folder}. Check the folder on the card, then press Start again.` });
    const id = await newSession({ cwd: start, text, title: known?.title || title, model, effort });
    // A group's session is out of every list, so a session its chip starts would show at the top level. It goes into the group instead, and a
    // section's chip pins it or leaves it loose, as that section's own chat would.
    if (groupId) placeStarted(id, groupId);
    return send(res, 200, { id, chip: chips.put({ ...known, toolUseId, sessionId: known?.sessionId || sessionId, title: known?.title || title, tldr: known?.tldr || tldr, ...(model && { model }), ...(effort && { effort }), status: 'started', startedId: id }) });
  }
  const booking = /^\/api\/groups\/([\w-]+)\/session$/.exec(u.pathname);
  if (req.method === 'POST' && booking) {
    try {
      return send(res, 200, { id: bookGroupSession(booking[1]) });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }
  if (parts[1] !== 'sessions' || !parts[2]) return send(res, 404, { error: 'Not found' });
  const id = parts[2];
  if (!/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Bad session id' });
  const action = parts[3];
  if (action === 'terminal') return terminalApi(req, res, id, parts.slice(4));
  if (req.method === 'GET' && action === 'messages') {
    const row = findRow(id);
    const connectors = loadDesktop(cfg.desktopDir).connectors.get(id) || {};
    // fileLinks and terminal tell the page that those routes exist, so a page newer than this server draws nothing that would 404.
    return send(res, 200, { ...readMessages(id, u.searchParams), fileLinks: true, terminal: !row?.groupSession, session: row && { id, title: row.title, cwd: row.cwd, branch: row.branch, source: row.source, routine: row.routine, connectors } });
  }
  if (req.method === 'GET' && action === 'events') return events(req, res, id);
  if (req.method === 'GET' && action === 'chips') return send(res, 200, { chips: chips.forSession(id) });
  // The pictures of the whole chat as items with refs and no bytes, for the viewer to count and step through.
  if (req.method === 'GET' && action === 'images' && !parts[4]) {
    const before = u.searchParams.get('before');
    if (before !== null && !/^\d+$/.test(before)) return send(res, 400, { error: 'before must be a byte offset.' });
    const t = transcriptFor(id) || (indexTranscripts(cfg.projectsDir, 0), transcriptFor(id));
    if (!t) return send(res, 404, { error: 'No session with that id on this Mac.' });
    return send(res, 200, { items: listImages(t, before === null ? Infinity : Number(before)) });
  }
  // An image from a message in the transcript. The ref comes from the item, and the bytes never travel in the messages.
  if (req.method === 'GET' && action === 'images') {
    const t = transcriptFor(id) || (indexTranscripts(cfg.projectsDir, 0), transcriptFor(id));
    const image = t && readImage(t, parts[4]);
    if (!image) return send(res, 404, { error: 'No such image.' });
    // NOTE: [18 Oct 2026] EK - Vary: Cookie, so the browser reuses its copy only while it holds the cookie it fetched it with. Sign-out's
    // Clear-Site-Data deletes the copy in Chrome and Firefox, but Safari 27 ignores it, and no browser acts on it at a plain http address.
    return send(res, 200, image.bytes, image.type, { 'cache-control': 'private, max-age=31536000, immutable', vary: 'Cookie', 'x-content-type-options': 'nosniff' });
  }
  // A file a reply or a thought in the chat links to, as its text or its bytes. lib/files.mjs holds the gate, and `about` keeps a
  // browser from reading the JSON about a file as anything else.
  if (req.method === 'GET' && (action === 'preview' || action === 'file') && !parts[4]) {
    const about = { 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' };
    const t = transcriptFor(id) || (indexTranscripts(cfg.projectsDir, 0), transcriptFor(id));
    const chat = getChat(id);
    if (!t && !chat) return send(res, 404, { error: NO_SESSION }, 'application/json', about);
    const linked = linksOf(t, chat?.live, cfg.outputChars);
    const wanted = u.searchParams.get('path');
    try {
      if (action === 'preview') return send(res, 200, await previewFile(wanted, linked), 'application/json', about);
      const file = await serveFile(wanted, linked, u.searchParams.get('download') === '1');
      res.writeHead(200, file.headers);
      if (!file.stream) return res.end();
      return pipeline(file.stream, res, () => {});
    } catch (e) {
      return send(res, e.status || 500, { error: e.message }, 'application/json', about);
    }
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const body = JSON.parse(await readBody(req, action === 'send' ? MAX_BODY_BYTES : undefined) || '{}');
  if (action === 'send') {
    const { images, error } = readImages(body.images);
    if (error) return send(res, 400, { error });
    const { files, error: fileError } = uploads.readFiles(body.files, id, { blocks: !['working', 'waiting'].includes(getChat(id)?.state) });
    if (fileError) return send(res, 400, { error: fileError });
    if (files.length && isSlashCommand(body.text || '')) return send(res, 400, { error: SLASH_WITH_FILES });
    const { documents, error: documentError } = uploads.readDocuments(files);
    if (documentError) return send(res, 400, { error: documentError });
    if (!body.text?.trim() && !images.length && !files.length) return send(res, 400, { error: 'Nothing to send.' });
    const row = findRow(id);
    if (!row) return send(res, 404, { error: 'No session with that id on this Mac.' });
    const chat = ensureChat(id, row, { mode: body.mode });
    // The result of a command run with ! that Claude was not to reply to goes in front of the next message, as its own paragraph.
    // A slash command has to stay first to run, so the result waits for the message after it.
    const held = !isSlashCommand(body.text || '') && terminal.held(id);
    const text = withMentions(files, body.text || '');
    chat.send(held ? [held, text].filter(t => t.trim()).join('\n\n') : text, images, documents);
    if (held) terminal.release(id);
    uploads.record(id, files);
    const unarchived = row.archived && unarchive(id);
    return send(res, 200, { ...chat.status(), ...(unarchived && { unarchived }) });
  }
  // A POST because a count of a chat Capcom runs can save a window to windows.json.
  if (action === 'context') {
    const detail = body.detail ?? 'summary';
    if (detail !== 'summary' && detail !== 'full') return send(res, 400, { error: 'detail must be summary or full.' });
    return send(res, 200, await contextFor(id, detail));
  }
  const chat = getChat(id);
  if (action === 'mode') {
    if (!MODES.includes(body.mode)) return send(res, 400, { error: 'Unknown permission mode.' });
    const row = findRow(id);
    try {
      await ensureChat(id, row, { mode: body.mode }).setMode(body.mode);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    return send(res, 200, { mode: body.mode });
  }
  if (action === 'model' || action === 'effort' || action === 'fast') {
    const value = body[action];
    if (action === 'model' ? !MODEL.test(value || '') : action === 'effort' ? !EFFORTS.includes(value) : typeof value !== 'boolean') return send(res, 400, { error: `Unknown ${action}.` });
    const row = findRow(id);
    if (!chat && !row) return send(res, 404, { error: 'No session with that id on this Mac.' });
    const target = chat || ensureChat(id, row);
    try {
      await (action === 'model' ? target.setModel(value) : action === 'effort' ? target.setEffort(value) : target.setFast(value));
    } catch (e) {
      // The chat's status holds a later pick that went through, which the page would otherwise overwrite with the value it had before this one.
      return send(res, 400, { error: e.message, status: target.status() });
    }
    savePick(id, { [action]: value });
    return send(res, 200, target.status());
  }
  if (!chat) return send(res, 409, { error: 'That session is not running here.' });
  if (action === 'approve') {
    const answers = body.decision === 'answer' && body.answers && typeof body.answers === 'object' ? body.answers : undefined;
    if (body.decision === 'answer' && !answers) return send(res, 400, { error: 'No answers given.' });
    return send(res, chat.answer(body.requestId, body.decision, answers) ? 200 : 410, chat.status());
  }
  if (action === 'stop') { chat.interrupt(); return send(res, 200, chat.status()); }
  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
    const file = asset(u.pathname);
    if (file) {
      const headers = { 'cache-control': 'no-cache', etag: file.etag };
      if (held(req.headers['if-none-match'], file.etag)) { res.writeHead(304, headers); return res.end(); }
      return send(res, 200, fs.readFileSync(file.file), file.type, headers);
    }
    // NOTE: [16 Oct 2026] EK - The cookie is SameSite=Lax (lib/auth.mjs), so a link from another site arrives signed in.
    // A GET must never write, and every write must be a POST, PATCH or DELETE past this check.
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });
    if (!auth.hasPassword()) return send(res, 503, page('setup.html'), 'text/html; charset=utf-8');
    const secure = overHttps(req);
    const agent = req.headers['user-agent'];
    if (u.pathname === '/login' && req.method === 'POST') {
      const password = new URLSearchParams(await readBody(req)).get('password');
      const result = auth.verify(password);
      if (!result.ok) return send(res, 401, loginPage(result.locked ? 'Too many tries. Wait 15 minutes.' : 'That password did not match.'), 'text/html; charset=utf-8');
      // No Path, so behind a reverse proxy that mounts Capcom under a sub-path the cookie stays scoped to that path.
      // Every reply that sets it (login, passkey-login, renew, logout) must therefore sit directly under the mount, never under /api.
      return send(res, 303, '', 'text/plain', { location: './?signed-in', 'set-cookie': auth.cookie(auth.issue(agent), secure) });
    }
    if (req.method === 'POST' && (u.pathname === '/passkey-options' || u.pathname === '/passkey-login')) return await passkeySignIn(req, res, u, { secure, agent });
    // Ahead of the session check, so a tab whose sign-in a new password already ended still clears its cookie and cache.
    if (u.pathname === '/logout' && req.method === 'POST') {
      const live = auth.check(req);
      if (live) auth.revoke(live);
      // NOTE: [18 Oct 2026] EK - Only "cache". Cookies ignore ports, so "cookies" would sign out every app on localhost,
      // and "storage" would empty the storage of every app that shares this origin.
      return send(res, 303, '', 'text/plain', { location: './', 'clear-site-data': '"cache"', 'set-cookie': sessionCookie('', 0, secure) });
    }
    const token = auth.check(req);
    if (!token) {
      if (u.pathname.startsWith('/api/') || u.pathname === '/renew') return send(res, 401, { error: 'Signed out.' });
      return send(res, 200, loginPage(), 'text/html; charset=utf-8');
    }
    auth.touch(token, agent);
    if (u.pathname === '/renew' && req.method === 'POST') {
      return send(res, 200, { ok: true }, 'application/json', auth.cookieDue(token) ? { 'set-cookie': auth.cookie(token, secure) } : {});
    }
    if (u.pathname === '/login') return send(res, 303, '', 'text/plain', { location: './' });
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    if (u.pathname === '/' || u.pathname === '/index.html') return send(res, 200, indexPage(), 'text/html; charset=utf-8');
    send(res, 404, 'Not found', 'text/plain');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

// Capcom's groups and pins start as a copy of Desktop's, made once. Until a copy exists it tries again on every start.
function seedLayout() {
  const have = layout.read();
  if (have.seededAt) return;
  const desk = loadDesktop(cfg.desktopDir, 0);
  try {
    const made = layout.seed(desk);
    if (made) return console.log(`Copied Desktop's layout into layout.json: ${made.groups.length} groups, ${Object.keys(made.assignments).length} sessions in groups, ${made.pinned.length} pinned.`);
  } catch (e) {
    return console.error(`Could not write layout.json: ${e.message}`);
  }
  console.error(`Desktop's groups and pins are not copied yet (${have.problem || desk.problem}). Capcom tries again on the next start.`);
}

seedLayout();
// Routines fire from here, and only once the port is ours, so a second Capcom that cannot bind never runs one. The first check
// is at start, so a run that came due while Capcom was down is caught up.
const followZone = makeZoneFollower();
const checkRoutines = () => {
  followZone();
  routines.tick().catch(e => console.error(`Routine check failed: ${e.message}`));
};
server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`Capcom on http://localhost:${cfg.port}`);
  setInterval(checkRoutines, 30_000).unref();
  checkRoutines();
});
setInterval(() => sweep(cfg.idleMinutes), 60_000).unref();
// Whatever the terminal started ends with Capcom, so a restart leaves nothing running behind. A signal ends the process through
// exit, which kills the command groups; without a handler the default would end it first.
process.on('exit', () => terminal.killAll());
for (const name of ['SIGTERM', 'SIGINT']) process.on(name, () => process.exit(128 + os.constants.signals[name]));
// With the hand-off on, sessions started before it existed are handed over the first time Capcom starts with it.
if (cfg.desktopHandoff) for (const s of readStarted()) if (!s.desktopAt && !s.routine) handOff(s.id).catch(e => console.error(`Hand-off of ${s.id} failed: ${e.message}`));
