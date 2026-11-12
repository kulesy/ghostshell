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
import { lastReply, makeWindows, shapeMcp, shapePlan, shapeUsage, transcriptFigure } from './lib/context.mjs';
import { parseCron } from './lib/cron.mjs';
import { loadDesktop } from './lib/desktop.mjs';
import { dotOf } from './lib/dots.mjs';
import { chainOf, familiesOf } from './lib/families.mjs';
import { descendantsOf } from './public/ui/sub-rules.js';
import { frozenFolders, linksOf, MAX_TEXT_BYTES, previewFile, saveFile, serveFile } from './lib/files.mjs';
import { makeGroupUpdates, makeUpdateStore, pullsOf, scaled } from './lib/group-updates.mjs';
import { chipRefusal, ensureGroupDir, groupDir, guideFor, rankRules, refusal, workFolder } from './lib/groups.mjs';
import { MAX_TITLE, makeLayout, nameOf } from './lib/layout.mjs';
import { makeMarks } from './lib/marks.mjs';
import { pendingLines } from './lib/subs.mjs';
import { makeSummaries } from './lib/summaries.mjs';
import { makePulls } from './lib/pulls.mjs';
import { startPullLinks } from './lib/pull-links.mjs';
import { indexTranscripts, transcriptFor, readHead, readBefore, readAfter, readImage, listImages, completeEnd } from './lib/transcripts.mjs';
import { readImages, MAX_BODY_BYTES } from './lib/images.mjs';
import { isSlashCommand, makeUploads, MAX_FILE_BYTES, MAX_FILES, withMentions } from './lib/uploads.mjs';
import { createOutside, STALE_MS } from './lib/outside.mjs';
import { createSubagents } from './lib/subagents.mjs';
import { agentsKey } from './lib/subagent-rules.mjs';
import { chatFor, getChat, onAuthFailure, onTurn, onUsage, retireOtherAccounts, retireWhenQuietFor, runningChats, startChat, sweep, activeStates, useAccounts } from './lib/runner.mjs';
import { listCommands, listModels } from './lib/commands.mjs';
import { askClaude } from './lib/title-ask.mjs';
import { makeTitler } from './lib/titler.mjs';
import { makeAuth, overHttps, sessionCookie } from './lib/auth.mjs';
import { makePasskeys, PasskeyError } from './lib/passkeys.mjs';
import { handOffText, makeTerminal } from './lib/terminal.mjs';
import { EFFORTS, MODEL, makeChips } from './lib/tools.mjs';
import { lockHolder } from './lib/restart.mjs';
import { authInfo, cleanEnv, readLoginEnd, REFRESH_MS, startSignIn } from './lib/login.mjs';
import { makeAccounts } from './lib/accounts.mjs';
import { makeAccountLogins, resetOf } from './lib/account-logins.mjs';
import { browserSeen, makeChromeCheck, openChromeSettings, SURVEY_MS } from './lib/chrome-check.mjs';
import { accountFor, blockedBy, blockedError, blockedMessage, spillOf } from './lib/account-rule.mjs';
import { groupNamed } from './lib/layout-tools.mjs';
import { CHECK_EVERY_MS, makeUpdate } from './lib/update.mjs';
import { JITTER_PROBLEM, makeRoutines, makeScheduler, makeZoneFollower, upcoming, validJitter } from './lib/routines.mjs';
import { makeScheduledFile, makeScheduledSessions } from './lib/scheduled.mjs';
import { esc } from './public/md.mjs';
import { isIssueUrl, isPullUrl } from './public/ui/pull-url.js';
import { comparator, DEFAULT_SORT, sortFamily, sortRows, UNTITLED } from './public/ui/order.js';
import { placeKey } from './public/ui/pick.js';
import { titleText } from './public/ui/quote-rules.js';
import { SECTION_IDS, SECTIONS, sectionById, sectionOf, sectionSessions } from './public/ui/sections.js';
import { withKids } from './public/ui/tree.js';

// The folders a save from the file viewer never reaches, as real paths.
const frozen = frozenFolders([cfg.stateDir, cfg.projectsDir, cfg.desktopDir, ROOT]);
const auth = makeAuth(cfg.stateDir);
const passkeys = makePasskeys(cfg.stateDir, { port: cfg.port, origins: cfg.passkeyOrigins, warn: console.error });
const chips = makeChips(cfg.stateDir);
const layout = makeLayout(cfg.stateDir);
const marks = makeMarks(cfg.stateDir);
const routineStore = makeRoutines(cfg.stateDir);
const windows = makeWindows(cfg.stateDir);
const uploads = makeUploads(cfg.stateDir);
const accounts = makeAccounts(cfg.stateDir, { warn: console.error });
// The environment an account's processes start with. An id nobody lists gets the active account's, which only a probe or a title ask can reach, since no turn runs on it.
const envOfAccount = id => accounts.envFor(accounts.find(id) ?? accounts.active);
useAccounts(chat => accountOfChat(chat));
retireWhenQuietFor(cfg.retireQuietMs);
const summaries = makeSummaries({ transcriptFor });
const pulls = makePulls({ transcriptFor, gh: cfg.gh });
const pullLinks = startPullLinks({ projectsDir: cfg.projectsDir });
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
const subagents = createSubagents();
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

// A session started here is named from its first turn, and a title the owner set is never replaced. See docs/adr/20261027-name-sessions-from-their-first-turn.md.
const titler = makeTitler({ ask: askClaude(cfg.claude, { env: envOfAccount }), own: id => ownTitle(layout.read(), id), record: (id, title) => layout.rename(id, title), enabled: cfg.autoTitle });

// What a session is linked to: Capcom's own choice, a null included, wins over the chip it was started from, and that over Desktop's link.
const linkOf = (own, fromChips, desk, id) => (Object.hasOwn(own.parents, id) ? own.parents[id] : fromChips.get(id) ?? desk.links.get(id) ?? null);
const linksNow = () => {
  const own = layout.read();
  const fromChips = chips.links();
  const desk = loadDesktop(cfg.desktopDir);
  return id => linkOf(own, fromChips, desk, id);
};
const linkNow = id => linksNow()(id);

// ---- which account a chat runs on ----------------------------------------------------------------
// See docs/adr/20261104-pin-work-to-an-account.md. The runner asks on every retire check, so this reads the stores and nothing deeper: no index build and no
// summary. The links, the started list and the transcript heads are read only once some pin exists, and only as far as the chain of parents goes.

const accountStates = () => ({ list: accounts.list(), signedOut: a => accountLogins.state(a).signedOut, checked: a => accountLogins.checked(a) });

// The layout as it was last readable, which stands in for one that cannot be read now so a typo never moves pinned work onto the active account.
// A restart with an unreadable layout has none, and uses what it reads.
let lastReadable = null;
const pinsOf = own => (own.problem ? lastReadable ?? own : (lastReadable = own));

// `index` is the one buildIndex is making, so its rows, layout and links are used as they stand and nothing is read twice.
function accountData(index) {
  const own = pinsOf(index?.own ?? layout.read());
  const stored = routineStore.read().routines;
  const once = make => { let made; return () => (made ??= make()); };
  const started = once(() => new Map(readStarted().map(r => [r.id, r])));
  const links = once(() => { const fromChips = index?.fromChips ?? chips.links(); const desk = index?.desk ?? loadDesktop(cfg.desktopDir); return id => linkOf(own, fromChips, desk, id); });
  const byId = list => Object.fromEntries(list.map(item => [item.id, item]));
  const routines = byId(stored);
  const groups = byId(own.groups);
  const projects = byId(own.projects);
  // A session Capcom started has its routine in started.json alone, since its first message is text anyone can word as a routine's. Any other
  // takes the one the index shows, or its transcript's head, which can vanish between the lookup and the read.
  const routineOf = (id, t) => {
    const mine = started().get(id);
    if (mine) return mine.routine || null;
    if (index?.rows.has(id)) return index.rows.get(id).routine;
    try { return readHead(t, uploads.dir).routine; } catch { return null; }
  };
  return {
    own,
    active: accounts.active.id,
    routines,
    groups,
    projects,
    anyPin: Object.keys(own.accounts).length > 0 || [...own.groups, ...own.projects, ...stored].some(item => item.account),
    // A group's chat takes its group's pin. A session is known when it has a transcript or Capcom started it.
    facts(id) {
      const group = own.groups.find(g => g.session === id);
      if (group) return { pin: own.accounts[id], overflow: own.overflow?.[id], group: group.id };
      const t = transcriptFor(id);
      if (!t && !started().has(id)) return null;
      return { pin: own.accounts[id], overflow: own.overflow?.[id], routine: routineOf(id, t), group: own.assignments[id], parent: links()(id) };
    },
    // The words for where a pin came from, from names already in the stores.
    nameOf(from, via) {
      if (from === 'group') return groups[via]?.name ?? '';
      if (from === 'project') return projects[via]?.name ?? '';
      if (from === 'routine') return routines[via]?.title ?? '';
      return index?.rows.get(via)?.title ?? (ownTitle(own, via) || started().get(via)?.title || '');
    },
  };
}

// The rule's answer for `self` and what stops it. Work pinned to an account that is out of usage moves to the pin's overflow, unless the pin blocks it: a signed-out
// pinned account blocks the work and never spills. See docs/adr/20261109-spill-pinned-work-to-an-overflow-account.md.
function settle(self, d, states = accountStates()) {
  const pinned = d.anyPin || self.pin ? accountFor(self, d) : { account: d.active, from: 'active', via: null };
  const blocked = blockedBy(pinned, states, d.nameOf);
  return { got: blocked ? pinned : spillOf(pinned, { isOut: accountLogins.isOut, usable: accountLogins.isUsable }), blocked };
}

// What the rule makes of `self`, ready for the runner: the account's id, where it came from, its environment, what stops it and how to prepare it.
// `spilled` is the pinned account the work left, when it did.
function resolveAccount(self, d = accountData()) {
  const { got, blocked } = settle(self, d);
  const account = accounts.find(got.account);
  return {
    id: got.account,
    from: got.from,
    spilled: got.spilled,
    env: account && accounts.envFor(account),
    blocked,
    prepare: () => account && accounts.prepare(account),
  };
}

function accountOfChat(chat) {
  const d = accountData();
  return resolveAccount({ id: chat.id, ...(d.anyPin && d.facts(chat.id)) }, d);
}

// The account a session started with these places will run on, worked out before it has an id. A blocked pin throws the 409.
function accountForNew(where) {
  const got = resolveAccount(where);
  if (got.blocked) throw blockedError(got.blocked);
  return got;
}

// The account an existing session runs on now, as the page would draw it: `{ id, from, blocked }`.
function accountOfSession(id) {
  const d = accountData();
  const { id: account, from, blocked } = resolveAccount({ id, ...d.facts(id) }, d);
  return { id: account, from, blocked };
}
// What a chip's group name is looked up in when the chip is made. Each call reads the layout again, so a group renamed since is seen as it is now.
const groupList = () => layout.read().groups.map(({ id, name, project }) => ({ id, name, project }));

// A nested session that leaves its place would take the sessions linked straight to it along, though they show beside it, so each is
// linked to the parent instead, and those further down keep their links. A head takes its whole family along.
function keepFamily(id, { rows, families }) {
  const { parent } = rows.get(id);
  const links = {};
  if (parent) for (const r of rows.values()) if (!r.archived && families.get(r.id).near === id) links[r.id] = parent;
  return links;
}

// The sessions shown under a head, which archiving takes along from the live list and unarchiving brings back from the archived one, so
// both take what the owner sees. A nested session has none.
const belowNow = (id, { archived }) => descendantsOf([...buildIndex({ archived }).rows.values()], id);

// A session with a link leaves its parent when it moves or is pinned, which only the server can tell, since it alone knows a session's link.
const leaving = id => (linkNow(id) === null ? {} : { unlink: true, relink: keepFamily(id, buildIndex()) });

const withWords = b => b && { ...b, message: blockedMessage(b) };

// Each row's account, for the page. Only built when more than one account is listed or a pin exists, so a single-account station sends the rows it always did.
// The facts are the ones a process start uses, so a row never says different from the account its process runs on. A row a pin blocks carries `blocked` even when one account is listed.
function accountRows(index) {
  const d = accountData(index);
  const many = accounts.list().length > 1;
  if (!many && !d.anyPin) return;
  const states = accountStates();
  for (const r of [...index.rows.values(), ...index.groupSessions.values()]) {
    const settled = settle({ id: r.id, ...d.facts(r.id) }, d, states);
    const { got } = settled;
    const blocked = withWords(settled.blocked);
    const pin = d.own.accounts[r.id];
    const overflow = d.own.overflow?.[r.id];
    if (!many && !blocked && !pin) continue;
    Object.assign(r, { account: got.account, accountFrom: got.from }, got.spilled && { accountSpill: got.spilled }, pin && { accountPin: pin }, pin && overflow && overflow !== pin && { accountOverflow: overflow }, blocked && { blocked });
  }
}

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
    rows.set(t.id, { id: t.id, title: ((routine || head.scheduled) && started.get(t.id)?.title) || head.title || started.get(t.id)?.title || UNTITLED, cwd: head.cwd || started.get(t.id)?.cwd || '', branch: head.branch,
      archived: false, lastActivityAt: t.mtime, sortAt: Math.max(t.mtime, edgeOf(t.id)), createdAt: started.get(t.id)?.at ?? 0, routine, source: started.has(t.id) ? 'capcom' : 'cli', state: stateOf(t.id, t.mtime) });
  }
  // A session started moments ago may not have written its file yet; after that, no file means it is gone. A booked parent has no file
  // until the owner writes in it, and stays until then.
  for (const s of started.values()) {
    if (!rows.has(s.id) && (s.booked || now - s.at < 10 * 60_000)) rows.set(s.id, { id: s.id, title: s.title || UNTITLED, cwd: s.cwd, branch: '', archived: false, lastActivityAt: s.at, sortAt: Math.max(s.at, edgeOf(s.id)), createdAt: s.at, routine: s.routine || null, source: 'capcom', state: stateOf(s.id, s.booked ? 0 : s.at) });
  }

  // Projects, groups and pins are Capcom's own and cover every session, whichever app started it. A group that is gone leaves its
  // sessions loose, and a group whose project is gone is at the top level.
  const groupIds = new Set(own.groups.map(g => g.id));
  const projectIds = new Set(own.projects.map(p => p.id));
  const pins = new Set(own.pinned);
  const unarchived = new Set(own.unarchived);
  const chipTitles = chips.titles();
  // A routine's run shows the routine's title as it is now. A routine that routines.json no longer holds keeps the title its run started with.
  const storedRoutines = routineStore.read().routines;
  const routineTitles = new Map(storedRoutines.map(r => [r.id, r.title]));
  const routineHeadings = new Map(storedRoutines.filter(r => r.heading).map(r => [r.id, r.heading]));
  for (const r of rows.values()) {
    r.group = groupIds.has(own.assignments[r.id]) ? own.assignments[r.id] : null;
    r.pinned = pins.has(r.id);
    // Capcom's own choice wins over Desktop's flag, in both directions. A session in both lists is archived.
    if (Object.hasOwn(own.archived, r.id)) r.archived = true;
    else if (unarchived.has(r.id)) r.archived = false;
    if (r.archived) r.archivedAt = Date.parse(own.archived[r.id]) || r.changedAt || r.lastActivityAt;
    // Capcom's own title wins over every other, then the title a chip gave the session in place of its prompt's first line. Both are
    // applied before the sorts so a group goes by them.
    const title = ownTitle(own, r.id);
    if (title) { r.title = title; r.renamed = true; }
    else if (routineTitles.has(r.routine)) r.title = routineTitles.get(r.routine);
    else if (chipTitles.has(r.id)) r.title = chipTitles.get(r.id);
  }

  // A group's or section's session belongs to it alone, so its row leaves `rows` here and no list, family, count or search sees it. A session
  // with no transcript yet gets a row from the layout. A deleted group's chat is marked `retired`, which send_session cannot reach.
  const retired = new Set(own.retired.map(g => g.session));
  const groupSessions = new Map();
  for (const g of ownedChats) {
    const row = rows.get(g.session) ?? { lastActivityAt: 0, sortAt: 0, createdAt: 0, state: stateOf(g.session, 0) };
    rows.delete(g.session);
    groupSessions.set(g.session, { ...row, id: g.session, title: g.name, cwd: groupDir(cfg.stateDir, g.id), branch: row.branch ?? '', archived: false, routine: null, source: 'capcom', group: null, pinned: false, parent: null, groupSession: g.id, ...(retired.has(g.session) && { retired: true }) });
  }

  // A family shows in the place of its holder, the topmost session its links reach, so a child takes the place its holder has now.
  const fromChips = chips.links();
  const families = familiesOf(rows, id => linkOf(own, fromChips, desk, id), { archived });
  const places = new Map([...rows.values()].map(r => [r.id, { group: r.group, pinned: r.pinned }]));
  for (const r of rows.values()) {
    const { holder, parent } = families.get(r.id);
    Object.assign(r, { parent }, places.get(holder));
  }
  accountRows({ rows, groupSessions, own, fromChips, desk });
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
  // A family is listed under its topmost shown session: its holder in the archived rows, else the head its rows show under.
  const placedUnder = r => (archived ? (families.get(r.id).holder === r.id ? null : families.get(r.id).holder) : r.parent);
  for (const r of visible.filter(placedUnder)) kids.set(placedUnder(r), [...(kids.get(placedUnder(r)) ?? []), r]);
  for (const [id, list] of kids) {
    const parent = rows.get(id);
    parent.children = sortFamily(list, sortOf(parent));
  }

  // A child is listed under its parent only.
  const top = visible.filter(r => !placedUnder(r));
  const pinned = sortRows(top.filter(r => r.pinned), sorts.pinned);
  const groups = own.groups.map(g => {
    const sort = groupSort(g.id);
    // A group's own chat carries what accountRows worked out for it, so its notice reads the same as a session's.
    const chat = g.session && groupSessions.get(g.session);
    const session = chat ? { id: g.session, state: chat.state, ...(chat.account && { account: chat.account, accountFrom: chat.accountFrom }), ...(chat.accountSpill && { accountSpill: chat.accountSpill }), ...(chat.accountPin && { accountPin: chat.accountPin }), ...(chat.accountOverflow && { accountOverflow: chat.accountOverflow }), ...(chat.blocked && { blocked: chat.blocked }) } : null;
    return { id: g.id, name: g.name, project: projectIds.has(g.project) ? g.project : null, ...(g.account && { account: g.account }), ...(g.account && g.overflow && { overflow: g.overflow }), sort, session, archived: archivedIn.get(g.id) ?? 0, sessions: sortRows(top.filter(r => r.group === g.id && !r.pinned), sort) };
  });
  // A routine's runs go newest first, and the routines go by their latest run.
  const byLatest = comparator(sorts.routines);
  const routines = new Map();
  for (const r of top.filter(r => r.routine && !r.group && !r.pinned).sort(comparator(DEFAULT_SORT))) {
    if (!routines.has(r.routine)) routines.set(r.routine, { name: r.routine, ...(routineTitles.has(r.routine) && { title: routineTitles.get(r.routine) }), ...(routineHeadings.has(r.routine) && { heading: routineHeadings.get(r.routine) }), latest: r, earlier: [] });
    else if (routines.get(r.routine).earlier.length < 12 || unarchived.has(r.id)) routines.get(r.routine).earlier.push(r);
  }
  const loose = sortRows(top.filter(r => !r.group && !r.routine && !r.pinned), sorts.sessions);
  // A list stops at its newest 60 but keeps every session brought back from the archive, so an old one is not lost between the two.
  // A family counts as one and stays whole when any of its members was brought back.
  const newest = list => list.filter((r, i) => i < 60 || [r, ...(r.children ?? [])].some(m => unarchived.has(m.id)));
  return {
    station: cfg.station,
    problem: [desk.problem, own.problem].filter(Boolean).join('. ') || null,
    projects: own.projects.map(({ id, name, account, overflow }) => ({ id, name, ...(account && { account }), ...(account && overflow && { overflow }) })),
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
    // Only keepFamily reads `near`, so it stays off the rows that the list and the tools send.
    families,
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

// `group`, `parent`, `routine` and `account` are where the session will land and the pin it is given, which decide its account before it has an id.
// A pin on a signed-out account throws the 409 and starts nothing.
async function newSession({ cwd, text, images = [], documents = [], files = [], mode, model, effort, fast, title, routine, oneOff, group = null, parent = null, account = null }) {
  const s = desktopSettings({ cwd });
  const upfront = accountForNew({ pin: account, routine, group, parent });
  const chat = await startChat({ account: upfront, cwd, mode: mode || s.mode, model: model || s.model, shownModel: model || s.shownModel, effort: effort || s.effort, fast, text: withMentions(files, text), images, documents, chrome: cfg.chrome, claude: cfg.claude, chips, subs: subCtx, groups: groupList });
  dropFastOnRefusal(chat);
  // The session is running by now, so a record that cannot be written must not tell the caller that it never started.
  try {
    if (account) layout.setAccount('session', chat.id, account);
    // The list falls back on this title when the transcript's first line is too long to read, as it is with an image in it.
    const named = title || titleText(text.trim()) || (files.length ? (files.length > 1 ? 'Files' : files[0].name) : images.length > 1 ? 'Images' : 'Image');
    fs.writeFileSync(startedFile, JSON.stringify([...readStarted(), { id: chat.id, cwd, at: Date.now(), title: named.slice(0, 120), ...(routine && { routine }), ...(oneOff && { scheduled: true }) }]));
    // Fast mode is saved from the chat, as the CLI may have refused it already. The hook covers a refusal that comes later.
    if (model || effort || chat.fast) savePick(chat.id, { ...(model && { model }), ...(effort && { effort }), ...(chat.fast && { fast: true }) });
  } catch (e) {
    console.error(`Could not record session ${chat.id}: ${e.message}`);
  }
  if (!routine) titler.start(chat, { title, first: titleText(text.trim()) || files.map(f => f.name).join(', ') });
  if (cfg.desktopHandoff && !routine && !oneOff) afterTurn(chat, () => handOff(chat.id));
  return chat.id;
}

// ---- sub sessions --------------------------------------------------------------------------------

// What a chat is waiting on for the owner's say-so.
const pendingOf = id => getChat(id)?.status().pending ?? [];

// What a chat reaches the sessions under it through, and what every chat sends to, archives, unarchives, renames and moves any session with. Each call looks the index up again, so a session archived or nested since is seen
// as it is now. Every row is in the index whether archived or not, and `parent` skips the archived ones unless they are asked for. The sessions of groups and sections
// are listed too, so one can send and be sent to, and none is ever below another. A deleted group's chat is left out, as nothing would answer its tools.
function subCtx(sessionId) {
  return {
    lookup({ archived }) {
      const { rows, groupSessions } = buildIndex({ archived });
      const { archivedWith, parents } = layout.read();
      const startedBy = chips.startedBy();
      // The owner placing a session elsewhere ends its link to the maker.
      const makerOf = id => (Object.hasOwn(parents, id) ? undefined : startedBy.get(id));
      const listed = [...[...rows.values()].map(r => ({ ...r, archivedWith: archivedWith[r.id], startedBy: makerOf(r.id) })), ...[...groupSessions.values()].filter(r => !r.retired)];
      return { self: listed.find(r => r.id === sessionId) ?? null, rows: listed.filter(r => archived || !r.archived) };
    },
    pending: pendingOf,
    pullLinks: pullLinks.get,
    summary: (id, cwd) => summaries.get(id, cwd),
    pulls: async rows => (await pullsFor(rows)).lists,
    // The same path as a message typed into the session: its chat is resumed if it has no process, and queued behind a running turn. Answers the state it found.
    send(row, text) {
      const chat = getChat(row.id);
      if (!chat?.proc && row.state === 'active') return 'elsewhere';
      const was = chat?.state ?? 'idle';
      // A pinned account that is signed out refuses the start. The tool tells the model in words, and nothing is queued.
      try {
        ensureChat(row.id, row).send(text);
      } catch (e) {
        throw e.blocked ? refusal(`Refused: ${e.message}`) : e;
      }
      return was;
    },
    // The same changes the layout routes make, so a tool's and the owner's cannot differ. A session another app runs is left alone, and a running chat of Capcom's is not stopped.
    // Resolves with how it went. 'done' says how many sub sessions went with it, and a refusal says whether the session itself stood in the way and how many below it did.
    archive(id) {
      const root = editableRow(id);
      const elsewhere = r => !getChat(r.id)?.proc && r.state === 'active';
      const away = belowNow(id, { archived: false }).filter(r => !r.archived && elsewhere(r)).length;
      if (away || elsewhere(root)) return { was: 'elsewhere', self: elsewhere(root), subs: away };
      try {
        return { was: 'done', archivedSubs: CHANGES.archived(id, true, false).subs ?? 0 };
      } catch (e) {
        if (e.status === 409) return { was: 'running', ...e.running };
        throw e;
      }
    },
    // Resolves with how many sub sessions came back with it.
    unarchive: id => { editableRow(id); return CHANGES.archived(id, false).subs ?? 0; },
    rename: (id, title) => { editableRow(id); return CHANGES.rename(id, title); },
    move: (id, group) => { editableRow(id); CHANGES.move(id, group); },
    // The same calls as the project and group add routes, so a name is cleaned and limited the same way.
    projects: () => layout.read().projects.map(({ id, name }) => ({ id, name })),
    addProject: name => layout.addProject(name),
    addGroup: (name, project) => layout.addGroup(name, project),
    moveGroup: (id, project) => layout.moveGroup(id, project),
    orderProject: (id, side) => layout.orderProject(id, side),
    // Whether a move of group `id` into `project` (an id, or null for Home) would change the account its sessions run on. A group with its own pin keeps it.
    // One that cannot be worked out counts as a change, so the owner is asked.
    groupAccount(id, project) {
      try {
        const d = accountData();
        if (!d.anyPin) return { changes: false };
        if (!d.groups[id]) return { changes: true };
        const was = accountFor({ group: id }, d);
        const now = accountFor({ group: id }, { ...d, groups: { ...d.groups, [id]: { ...d.groups[id], project } } });
        const spills = (was.overflow ?? null) !== (now.overflow ?? null);
        return { changes: was.account !== now.account || (was.from === 'active') !== (now.from === 'active') || spills, to: accounts.find(now.account)?.name, active: now.from === 'active', ...(spills && { spills, overflow: now.overflow ? accounts.find(now.overflow)?.name ?? 'another account' : null }) };
      } catch {
        return { changes: true };
      }
    },
    // Whether a move into `group` (a name or an id) would change the account the session runs on, and the account's name if so. A move that
    // cannot be worked out counts as a change, so the owner is asked. The move also takes the session out from under its parent.
    moveAccount(id, group) {
      try {
        const d = accountData();
        if (!d.anyPin) return { changes: false };
        const picked = typeof group === 'string' ? groupNamed(group, groupList(), '').group : null;
        const facts = typeof id === 'string' && d.facts(id);
        if (!picked || !facts) return { changes: true };
        const was = accountFor({ id, ...facts }, d);
        const now = accountFor({ id, ...facts, group: picked.id, parent: null }, d);
        // A pin on the active account's own id still holds through a switch, and the sessions below can follow a head or be relinked off a nested session's pin, so both ask.
        const below = belowNow(id, { archived: false }).length + Object.keys(leaving(id).relink ?? {}).length;
        // The card compares the overflows the pins hold and not the spilled account of the moment.
        const spills = (was.overflow ?? null) !== (now.overflow ?? null);
        return { changes: was.account !== now.account || (was.from === 'active') !== (now.from === 'active') || spills || below > 0, to: accounts.find(now.account)?.name, active: now.from === 'active', below, ...(spills && { spills, overflow: now.overflow ? accounts.find(now.overflow)?.name ?? 'another account' : null }) };
      } catch {
        return { changes: true };
      }
    },
  };
}

// ---- group sessions ------------------------------------------------------------------------------

// The session is running by now, so a layout that cannot be written is logged and told to the caller as not placed. `home` is a group, which
// takes it in, or a section: Pinned pins it, and the sections that list loose sessions leave it as it is, where GhostShell's own sessions list.
// With `unlink` the session also leaves the session that made its chip, which is how a chip that names a group places it.
function placeStarted(id, home, { unlink = false } = {}) {
  try {
    if (home === 'pinned') layout.pin(id, true);
    else if (!sectionById(home)) layout.move(id, home, { unlink });
    return true;
  } catch (e) {
    console.error(`Could not place ${id} in ${home}: ${e.message}`);
    return false;
  }
}

// The head a session shows under in the live list. One under an archived root shows as a head itself, so it has none.
const liveHeadOf = (row, rowOf = findRow) => (row?.parent && !rowOf(row.parent)?.archived ? row.parent : null);

// Where a chip's session opens, worded for its card from the group's name now. `row` is the session that made the chip. A section's chat
// and a routine run, which never holds sessions, have nothing to say. A list of chips passes `rowOf` over one index.
function withOpensIn(chip, row, rowOf = findRow) {
  const groups = groupList();
  const nameOf = id => groups.find(g => g.id === id)?.name;
  const opensIn = (() => {
    if (chip.group) return nameOf(chip.group) ? `Opens in ${nameOf(chip.group)}` : 'Its group has been deleted';
    if (!row || row.routine) return null;
    if (row.groupSession) return nameOf(row.groupSession) ? `Opens in ${nameOf(row.groupSession)}` : null;
    const beside = chip.status === 'started' ? chip.nestUnder : liveHeadOf(row, rowOf);
    // An archived session shows nothing under it, so its chip's session stands in its place on its own. A started chip with a parent already sits there.
    if (row.archived && !(chip.status === 'started' && beside)) return nameOf(row.group) ? `Opens in ${nameOf(row.group)}` : null;
    if (beside) {
      const parent = rowOf(beside)?.title;
      const where = parent ? `Opens beside this session, under “${parent}”` : 'Opens beside this session';
      return nameOf(row.group) ? `${where}, in ${nameOf(row.group)}` : where;
    }
    return nameOf(row.group) ? `Opens under this session, in ${nameOf(row.group)}` : 'Opens under this session';
  })();
  return opensIn ? { ...chip, opensIn } : chip;
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
    id: groupId,
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
    links: urls => pulls.lookup(urls),
    async start({ cwd, prompt, title }) {
      const id = await newSession({ cwd, text: prompt, title, group: groupId });
      return { id, placed: placeStarted(id, groupId) };
    },
  };
}

// The CLI refuses --session-id for an id that has a transcript and --resume for one that has none, so each spawn asks. The index is rescanned
// once before a no, since a transcript written a moment ago may not be in it yet.
const hasTranscript = id => !!(transcriptFor(id) || (indexTranscripts(cfg.projectsDir, 0), transcriptFor(id)));

// A new parent is booked in started.json and has no transcript until the owner first writes in it, as a group's chat does. `booked` stays
// after that, so it says only that New parent made the session.
const isBooked = id => readStarted().some(s => s.id === id && s.booked);
const awaitsFirstMessage = id => isBooked(id) && !hasTranscript(id);

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

// What is wrong with the folder, mode, model and effort of a routine or a scheduled session, each under its field, in the order the first
// of them is told in. `noun` is what the sentence calls it.
function startProblems(r, noun) {
  const found = {};
  if (typeof r.cwd !== 'string' || !r.cwd.trim()) found.cwd = `The ${noun} has no folder. Give its full path, starting with /.`;
  else if (!path.isAbsolute(r.cwd)) found.cwd = `The folder ${r.cwd} must be a full path starting with /.`;
  else if (!fs.existsSync(r.cwd)) found.cwd = `The folder ${r.cwd} does not exist.`;
  else if (!fs.statSync(r.cwd).isDirectory()) found.cwd = `${r.cwd} is not a folder.`;
  if (r.mode && !MODES.includes(r.mode)) found.mode = `Unknown permission mode ${r.mode}.`;
  if (r.model && !MODEL.test(r.model)) found.model = `Unknown model ${r.model}.`;
  if (r.effort && !EFFORTS.includes(r.effort)) found.effort = `Unknown effort level ${r.effort}.`;
  return found;
}

// Why the pin a run would start under cannot run, as a sentence, or null. A start refused here is not retried and never moves to another account.
const accountProblem = (got, nameOf) => {
  const blocked = got && blockedBy(got, accountStates(), nameOf);
  return blocked ? blockedMessage(blocked) : null;
};

// A routine's own pin must be an account GhostShell lists and can run on. A run in a group or project is placed after it starts, so only its pin counts.
function routineProblems(r) {
  const found = startProblems(r, 'routine');
  const problem = accountProblem(typeof r.account === 'string' && r.account ? { account: r.account, from: 'routine', via: r.id, pin: { kind: 'routine', id: r.id } } : null, () => r.title ?? '');
  if (problem) found.account = problem;
  return found;
}
const routineProblem = r => Object.values(routineProblems(r))[0] ?? null;

// A scheduled session takes the account of the group it will be put in, or of that group's project.
function scheduledProblems(s) {
  const found = startProblems(s, 'scheduled session');
  const d = accountData();
  const problem = d.anyPin && s.group ? accountProblem(accountFor({ group: s.group }, d), d.nameOf) : null;
  if (problem) found.account = problem;
  return found;
}
const scheduledProblem = s => Object.values(scheduledProblems(s))[0] ?? null;

// Routines and scheduled sessions together run at most this many sessions at once, which keeps fewer of them fighting over one Chrome.
const AUTOMATED_AT_ONCE = 3;

// An id is kept for any routine whose runs the session list still holds, so a new routine never takes over the runs of a deleted one.
const routineIdTaken = id => [...buildIndex().rows.values()].some(r => r.routine === id);

// A run is a new session like any other, except that it is never handed to Desktop, whose window it would open at fire time. Nor is a scheduled session.
const routines = makeScheduler({
  store: routineStore,
  check: routineProblem,
  fieldProblems: routineProblems,
  idTaken: routineIdTaken,
  restarting: () => lockHolder(path.join(cfg.stateDir, 'restart.lock')) !== null,
  start: (r, text) => newSession({ cwd: r.cwd, text, mode: r.mode, model: r.model, effort: r.effort, title: r.title, routine: r.id }),
  working: id => { const chat = getChat(id); return !!chat && chat.state !== 'idle'; },
  waiting: id => getChat(id)?.state === 'waiting',
  stop: id => { const chat = getChat(id); if (chat) { chat.interrupt(); chat.stop(); } },
  limit: AUTOMATED_AT_ONCE,
  elsewhere: () => scheduled.occupied(),
});

// A one-off scheduled session checks its folder, model, effort and mode as a routine does, and starts the same way.
// See docs/adr/20261030-a-one-off-is-its-own-list.md.
const scheduled = makeScheduledSessions({
  store: makeScheduledFile(cfg.stateDir),
  check: scheduledProblem,
  fieldProblems: scheduledProblems,
  groups: groupList,
  place: placeStarted,
  restarting: () => lockHolder(path.join(cfg.stateDir, 'restart.lock')) !== null,
  start: (s, text) => newSession({ cwd: s.cwd, text, mode: s.mode, model: s.model, effort: s.effort, title: s.title, oneOff: true, group: s.group }),
  working: id => { const chat = getChat(id); return !!chat && chat.state !== 'idle'; },
  waiting: id => getChat(id)?.state === 'waiting',
  limit: AUTOMATED_AT_ONCE,
  elsewhere: () => routines.occupied(),
});

// ---- handing new sessions to Desktop -------------------------------------------------------------
// Opt-in through desktopHandoff in config.json, because a hand-off adds to Desktop's sidebar and switches its window.
// NOTE: [14 Oct 2026] EK - Desktop's own hand-off link is the only way into its sidebar, because Desktop keeps its session
// list in memory and writes over its files. It takes the title from the transcript's custom-title entry and opens the
// session in its window. Read from Desktop's code on 14 Oct 2026, so re-check this after a Desktop update.

const markStarted = (id, patch) => fs.writeFileSync(startedFile, JSON.stringify(readStarted().map(s => (s.id === id ? { ...s, ...patch } : s))));
const spendUndo = id => fs.writeFileSync(startedFile, JSON.stringify(readStarted().map(s => { if (s.id !== id) return s; const { undo, ...rest } = s; return rest; })));
const unbook = id => fs.writeFileSync(startedFile, JSON.stringify(readStarted().filter(s => s.id !== id)));
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
// NOTE: [7 Nov 2026] EK - The native app is not a browser, so its client sets Origin by hand on every non-GET. If this check changes, change
// apple/GhostShellKit/Sources/GhostShellKit/Client/GhostShellClient.swift to match, or its owner-route calls start failing with a 403.
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
    // A chat started now gets the guide with the ranking rules in it, so its first update need not carry them.
    fresh: () => {
      const fresh = !hasTranscript(id);
      if (fresh && !section) {
        try { groupUpdates.rulesSent(id); } catch (e) { console.error(`Could not record the ranking rules for ${id}: ${e.message}`); }
      }
      return fresh;
    },
  };
  const booked = !groupId && isBooked(id);
  const had = !!getChat(id);
  const chat = chatFor(id, { cwd: row?.cwd, mode: MODES.includes(mode) ? mode : s.mode, model: s.model, shownModel: s.shownModel, effort: s.effort, fast: s.fast, chrome: s.chrome, claude: cfg.claude, chips, groups: groupList, ...group, ...(booked && { fresh: () => !hasTranscript(id) }), subs: subCtx });
  dropFastOnRefusal(chat);
  if (booked && !had && cfg.desktopHandoff) afterTurn(chat, () => { if (isBooked(id) && !Object.hasOwn(layout.read().archived, id)) handOff(id); });
  for (const fn of viewers.get(id) || []) chat.listeners.add(fn);
  return chat;
}

// The message is already sent by now, so a layout that cannot be written is logged, not reported as a failed send.
function unarchive(id) {
  try {
    layout.unarchive(id, { under: belowNow(id, { archived: true }).map(r => r.id) });
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

// Plan usage belongs to the account, so any chat Capcom runs on that account can answer it. The first asked is the one given, the first answer stands, and no chat
// is ever started for it. Two others at most are tried, since each can take the full timeout to fail. The last answer of each account is kept with its time.
async function askPlan(account, first) {
  for (const chat of [first, ...runningChats().filter(c => c !== first && c.account === account).slice(0, 2)]) {
    const rows = await chat?.planUsage();
    if (rows) {
      const limits = shapePlan(rows);
      accountLogins.keepPlan(account, { limits, at: Date.now() });
      return limits;
    }
  }
  return null;
}

// A turn ended on `id` out of usage (`text`) or cleanly (null). The mark lasts until the reset of the limit that ran out, read from the chat that ran out, and the
// hour stands without an answer. Then a session that now spills to its overflow carries on there. See docs/adr/20261109-spill-pinned-work-to-an-overflow-account.md.
async function heardUsage(id, text, chat) {
  accountLogins.markUsage(id, text);
  if (!text || !chat || chat.id.startsWith('new-')) return;
  const reset = resetOf(await askPlan(id, chat).catch(() => null));
  if (reset) accountLogins.outUntil(id, reset);
  // The answer took a moment, so the chat may have been sent to since, which already moved it off `id`. A turn is never cut, and a chat with a job or an approval waiting keeps its process.
  if (chat.account !== id || chat.state !== 'idle' || chat.pending.size) return;
  const now = accountOfChat(chat);
  if (now.blocked || now.spilled !== id || !accountLogins.isUsable(now.id)) return;
  chat.retire(true);
  if (chat.proc?.stdin.writable && chat.account !== now.id) return;
  chat.send('Continue.');
}

// The account is named once more than one is listed, since the figures are that account's and not the one in the sidebar.
async function planFor(id) {
  const own = getChat(id);
  const account = own?.proc ? own.account : accountOfSession(id).id;
  const limits = await askPlan(account, own);
  return { limits, ...(accounts.list().length > 1 && { account: accounts.find(account)?.name }) };
}

const NOT_RUNNING = 'This chat is not running. Its MCP servers load fresh when it next starts.';
const reloading = new Set();

// A chat with no process is not started to answer, so it lists none.
async function mcpFor(id) {
  const chat = getChat(id);
  if (!chat?.proc?.stdin.writable) return { running: false, servers: [] };
  const rows = await chat.mcpServers();
  // A server that is on again leaves leftOff, so a later deliberate off is refused like any other. An "on" that timed out may still land.
  if (rows) for (const name of chat.leftOff) if (!rows.some(r => r.name === name && r.status === 'disabled')) chat.leftOff.delete(name);
  return { running: true, servers: rows && shapeMcp(rows, chat.leftOff) };
}

// The only input is a name, and it is used only if it is one of this chat's own servers as the CLI lists them right now. The CLI respawns
// the server from the config it already holds, so no command, argument or setting of the request's ever reaches it.
async function reloadMcpFor(id, name) {
  if (typeof name !== 'string' || !name) return [400, { error: 'Send the name of the server.' }];
  if (reloading.has(id)) return [409, { error: 'A reload is already running in this chat.' }];
  reloading.add(id);
  try {
    const { running, servers } = await mcpFor(id);
    if (!running) return [409, { error: NOT_RUNNING }];
    if (!servers) return [502, { error: 'Claude did not list its MCP servers.' }];
    const found = servers.find(s => s.name === name);
    if (!found) return [404, { error: 'This chat has no MCP server with that name.' }];
    if (!found.reloadable) return [400, { error: found.status === 'disabled' ? 'That server is switched off. Reloading it would switch it on.' : 'GhostShell\'s own server cannot be reloaded.' }];
    try {
      await getChat(id).reloadMcp(name);
    } catch (e) {
      return [502, { error: e.message, ...(await mcpFor(id)) }];
    }
    return [200, await mcpFor(id)];
  } finally {
    reloading.delete(id);
  }
}

// What the page redraws from. The clock is left out because it moves on every read.
const outsideKey = o => (o ? JSON.stringify([o.startedAt, o.tokens, o.tools.map(t => t.id)]) : '');

const EVENT_BACKLOG = 8 * 1024 * 1024;

// NOTE: [8 Nov 2026] EK - The Swift app decodes these events in apple/GhostShellKit/Sources/GhostShellKit/Endpoints/Chat.swift, which names this handler in turn. Decoding is lenient, so a renamed event or field is dropped there with no error.
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
  // The same for the helpers the chat started. The page keeps them through a state event, so nothing resets this key.
  const helpers = subagents.read(transcriptFor(id));
  let helpersShown = agentsKey(helpers);
  // The page drops that turn when Capcom starts work in the chat. If the work ends before the next look at the transcript, the key
  // would still match and the page would never get the turn back, so the key is cleared and the turn is sent again.
  const forward = ev => {
    if (ev.type === 'state' && ev.data.state !== 'idle') shown = '';
    write(ev.type, ev.data);
  };
  const row = findRow(id);
  write('status', { ...(chat ? chat.status() : { state: 'idle', running: false, ...settingsFor(id, row), live: '', pending: [] }), ...(row?.blocked && { blocked: row.blocked }), outside: first });
  write('subagents', { agents: helpers });
  if (!row?.groupSession) write('terminal', { type: 'state', ...terminal.snapshot(id, row?.cwd || '') });
  if (!viewers.has(id)) viewers.set(id, new Set());
  viewers.get(id).add(forward);
  chat?.listeners.add(forward);
  // A page opening the chat reads it, which clears its unread mark here. Desktop's own mark is not Capcom's to clear.
  writeMark(() => marks.opened(id, Date.now()));
  // Sessions running in Desktop or a terminal only show up as a growing file, so the file is watched too.
  let size = transcriptFor(id)?.size ?? -1;
  // A group's session, or a booked parent, has no file until its first message, which a chat of ours sends, so the index is not rescanned for one while no chat of ours runs it.
  const unwritten = !!findRow(id)?.groupSession || awaitsFirstMessage(id);
  const watch = setInterval(() => {
    const t = transcriptFor(id) || (unwritten && !getChat(id) ? null : (indexTranscripts(cfg.projectsDir, 3000), transcriptFor(id)));
    if (!t) return;
    let now;
    try { now = fs.statSync(t.file).size; } catch { return; }
    if (now !== size) { size = now; write('changed', {}); }
    const out = outsideFor(id);
    if (outsideKey(out) !== shown) { shown = outsideKey(out); write('outside', out); }
    const agents = subagents.read(t);
    if (agentsKey(agents) !== helpersShown) { helpersShown = agentsKey(agents); write('subagents', { agents }); }
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

// The row of a session whose place, title and archive the owner or a tool may change. A group's or section's chat stays with it.
function editableRow(id) {
  const row = typeof id === 'string' ? findRow(id) : null;
  if (!row) throw refuse(404, NO_SESSION);
  if (row.groupSession) throw refuse(400, `A ${kindOf(row)}'s session stays with its ${kindOf(row)}.`);
  return row;
}

async function editLayout(req, res, change) {
  const body = await readJson(req);
  if (!body) return send(res, 400, { error: 'Send a JSON body.' });
  // A new password can land while the body is still arriving, so the session is checked again before the layout is written.
  if (!auth.check(req)) return send(res, 401, { error: 'Signed out.' });
  const { id } = body;
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Which session?' });
  let extra;
  try {
    editableRow(id);
    extra = change(id, body);
  } catch (e) {
    return send(res, e.status || 500, { error: e.message, ...e.running });
  }
  const now = layout.read();
  return send(res, 200, { id, group: now.assignments[id] || null, pinned: now.pinned.includes(id), ...extra });
}

// Archiving a session archives every session below it too, in one write, and stops each chat Capcom runs among them: a turn in progress is
// interrupted and its approvals denied, then the process closes. With stop: false a running chat anywhere in the family is refused with a 409
// before anything is written, with `self` (the session itself is running) and `subs` (how many below it are), so the caller can ask first.
// `alone` archives the session without its family, for taking a new parent back.
function setArchived(id, archived, stop, { alone = false } = {}) {
  if (typeof archived !== 'boolean') throw Object.assign(new Error('Archived or not?'), { status: 400 });
  if (stop !== undefined && typeof stop !== 'boolean') throw Object.assign(new Error('Stop it or not?'), { status: 400 });
  const below = alone ? [] : belowNow(id, { archived: !archived });
  if (!archived) {
    const back = layout.unarchive(id, { under: below.map(r => r.id) });
    return { archived, ...(back.length > 1 && { subs: back.length - 1 }) };
  }
  // A session archived already takes none with it, so one brought back from under it is not archived again by a second archive of its parent.
  const under = Object.hasOwn(layout.read().archived, id) ? [] : below.filter(r => !r.archived).map(r => r.id);
  const chats = [id, ...under].map(getChat).filter(Boolean);
  const running = chats.filter(c => c.state !== 'idle');
  if (running.length && stop === false) {
    const self = running.includes(getChat(id));
    const subs = running.length - (self ? 1 : 0);
    const many = self ? subs > 0 : subs > 1;
    const words = !subs ? 'That chat is running, and archiving it would stop it.' : `${self ? 'That chat and ' : ''}${subs} sub session${subs === 1 ? '' : 's'} ${many ? 'are' : 'is'} running or waiting on you, and archiving would stop ${many ? 'them' : 'it'}.`;
    throw Object.assign(new Error(words), { status: 409, running: { self, subs } });
  }
  // The sessions under an archived one move up to the one it showed under by themselves, so archiving writes no link.
  const taken = layout.archive(id, { under });
  for (const chat of chats) {
    if (chat.state !== 'idle') chat.interrupt();
    chat.stop();
  }
  return { archived, ...(running.length && { stopped: true }), ...(running.length > 1 && { stoppedCount: running.length }), ...(taken.length > 1 && { subs: taken.length - 1 }) };
}

// What the routes and a chat's tools both do to a session's title, place and archive.
const CHANGES = {
  move: (id, group) => layout.move(id, group ?? null, leaving(id)),
  rename: (id, title) => layout.rename(id, title),
  archived: setArchived,
};

// The session a new one nests under, and the root of its family: a family is one level deep, so a child stands for its parent. Throws the first refusal.
function familyRoot(parent, { rows, groupSessions } = buildIndex()) {
  if (typeof parent !== 'string') throw refuse(400, 'Nest it under which session?');
  if (groupSessions.has(parent)) throw refuse(400, `A ${kindOf(groupSessions.get(parent))}'s session cannot hold sessions.`);
  const target = rows.get(parent);
  if (!target) throw refuse(404, NO_SESSION);
  if (target.archived) throw refuse(400, 'That session is archived.');
  if (target.routine) throw refuse(400, 'A routine run cannot hold sessions.');
  return { target, root: target.parent ?? target.id };
}

// Nests a session under another, or takes it out when `parent` is null. A family is one level deep, so a drop on a child nests under that
// child's parent. The answer carries the parent the list now shows.
function nest(id, parent) {
  if (parent !== null && typeof parent !== 'string') throw refuse(400, 'Nest it under which session?');
  const index = buildIndex();
  const { rows } = index;
  if (parent === null) {
    // A null written with no link to override would hide one that Desktop makes later.
    if (linkNow(id) !== null) layout.unnest(id, { group: rows.get(id).group, pinned: rows.get(id).pinned, relink: keepFamily(id, index) });
    return { parent: null };
  }
  const { target, root } = familyRoot(parent, index);
  // The links lead through archived sessions too, which a family does not show, so they are followed all the way up.
  if ([target, ...chainOf(rows, linksNow(), target)].some(r => r.id === id)) throw refuse(400, 'A session cannot nest under itself or its own child.');
  // A session that shows under that parent already keeps its own group and its link.
  if (rows.get(id).parent === root) return { parent: root };
  layout.nest(id, root, { relink: keepFamily(id, index) });
  return { parent: buildIndex().rows.get(id).parent };
}

// The repo a session worked in, when it worked in one of its worktrees.
const repoRoot = cwd => cwd.replace(/\/\.claude\/worktrees\/[^/]+\/?$/, '');

// Where a new parent works: the repo the sessions share, else the repo of the one that ran last. A folder that is not on this Mac falls through to the next, then to home.
function parentFolder(picked) {
  const roots = picked.filter(r => r.cwd).sort((a, b) => b.lastActivityAt - a.lastActivityAt).map(r => repoRoot(r.cwd));
  const candidates = roots.every(root => root === roots[0]) ? roots.slice(0, 1) : roots;
  return candidates.find(isDirectory) ?? os.homedir();
}

// The rows of picked sessions that are listed, not archived and not a group's or section's chat, or the first refusal. It checks the ids first:
// each is a plain id, and none twice.
function listedRows(ids, archivedWords) {
  if (!ids.every(id => typeof id === 'string' && /^[\w-]+$/.test(id))) throw refuse(400, 'Which sessions?');
  if (new Set(ids).size < ids.length) throw refuse(400, 'Each session can be picked once.');
  const index = buildIndex();
  for (const id of ids) {
    if (index.groupSessions.has(id)) throw refuse(400, `A ${kindOf(index.groupSessions.get(id))}'s session stays with its ${kindOf(index.groupSessions.get(id))}.`);
    if (!index.rows.has(id)) throw refuse(404, NO_SESSION);
    if (index.rows.get(id).archived) throw refuse(400, archivedWords);
  }
  return index;
}

// The most sessions one new parent takes. editStructure reads a body of up to 64 KB, room for a pick far past this, so the refusal is the sentence and not a bad body.
const MAX_PICKED = 100;

// How long after a new parent is made its Undo works, so a page left open for hours cannot replay a snapshot over newer changes.
const UNDO_WINDOW_MS = 10 * 60_000;

// Makes a session that is booked and not run the parent of several, in one write. See docs/adr/20261022-nest-sessions-under-a-parent.md.
// A picked session whose parent is picked too keeps its link and rides along. The rest link straight to the new parent.
function newParent({ ids, title, place }) {
  if (Array.isArray(ids) && ids.length > MAX_PICKED) throw refuse(400, `Pick at most ${MAX_PICKED} sessions.`);
  if (!Array.isArray(ids) || ids.length < 2) throw refuse(400, 'Pick at least two sessions.');
  const index = listedRows(ids, 'An archived session cannot be nested.');
  const { rows } = index;
  const picked = ids.map(id => rows.get(id));
  const shared = picked.every(r => placeKey(r) === placeKey(picked[0])) ? picked[0] : null;
  if (place == null && !shared) throw refuse(400, 'The sessions are in different places. Choose where it goes.');
  if (place != null && (typeof place !== 'object' || typeof place.pinned !== 'boolean' || (place.group !== null && typeof place.group !== 'string'))) throw refuse(400, 'Where should it go?');
  const home = place ?? { group: shared.group, pinned: shared.pinned };
  const name = nameOf(title, MAX_TITLE);
  const now = layout.read();
  if (now.problem) throw refuse(500, now.problem);
  if (!home.pinned && home.group !== null && !now.groups.some(g => g.id === home.group)) throw refuse(400, 'Unknown group.');

  const chosen = new Set(ids);
  const direct = ids.filter(id => !chosen.has(rows.get(id).parent));
  const parent = crypto.randomUUID();
  const relinks = {};
  for (const id of direct) for (const [kid, to] of Object.entries(keepFamily(id, index))) if (!chosen.has(kid)) relinks[kid] = to;
  const links = { ...relinks, ...Object.fromEntries(direct.map(id => [id, parent])) };
  const own = linksNow();
  const final = id => (Object.hasOwn(links, id) ? links[id] : own(id));
  const known = new Map([...rows, [parent, { id: parent }]]);
  for (const id of Object.keys(links)) {
    const chain = chainOf(known, final, known.get(id));
    if (final((chain.at(-1) ?? known.get(id)).id) === id) throw refuse(400, 'A session cannot nest under itself or its own child.');
  }

  // The booking goes first, so the parent has a row from the moment its children link to it, and a crash after the layout write leaves a parent
  // with no Undo and nothing worse. The snapshot is added once the layout is written.
  fs.writeFileSync(startedFile, JSON.stringify([...readStarted(), { id: parent, cwd: parentFolder(picked), at: Date.now(), title: name, booked: true }]));
  let made;
  try {
    made = layout.newParent(parent, { title: name, group: home.pinned ? null : home.group, pinned: home.pinned, links, moved: direct });
  } catch (e) {
    try { unbook(parent); } catch (again) { console.error(`Could not take the booking of ${parent} back out: ${again.message}`); }
    throw e;
  }
  try { markStarted(parent, { undo: made.before }); } catch (e) { console.error(`Could not keep the Undo of ${parent}: ${e.message}`); }
  return { id: parent, title: made.title, count: ids.length, group: home.pinned ? null : home.group, pinned: home.pinned };
}

// Takes a new parent back with the snapshot its booking holds, for ten minutes after it was made. The snapshot is spent before anything is
// restored, so a failure part way cannot leave it to be replayed, and a second Undo from another tab is a 404. The booking goes when the owner
// has not written in the parent, which takes it out of the list. One he has written in, or that is working, is archived and stopped.
function undoParent({ id }) {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw refuse(400, 'Which session?');
  const booking = readStarted().find(s => s.id === id && s.booked && s.undo);
  if (!booking) throw refuse(404, NO_SESSION);
  if (Date.now() - booking.at > UNDO_WINDOW_MS) throw refuse(409, 'It is too late to undo that. Take the sessions out by hand.');
  spendUndo(id);
  layout.restoreParent(id, booking.undo);
  const chat = getChat(id);
  if (hasTranscript(id) || (chat && chat.state !== 'idle')) return { id, ...setArchived(id, true, undefined, { alone: true }) };
  chat?.stop();
  unbook(id);
  return { id, removed: true };
}

// Undo tokens for moves and nests of several sessions, each holding the entries the write changed. They live in memory, so a restart drops
// the pending ones. See docs/adr/20261102-drag-and-act-on-a-selection.md.
const manyUndos = new Map();

// The one thing a drop aims at, or null when `to` names none or more than one: a group (null for the loose list), Pinned or a parent (null to leave one).
function aimOf(to) {
  const keys = to && typeof to === 'object' && !Array.isArray(to) ? Object.keys(to) : [];
  if (keys.length !== 1) return null;
  const [key] = keys;
  const fits = { group: to.group === null || typeof to.group === 'string', pinned: to.pinned === true, parent: to.parent === null || typeof to.parent === 'string' };
  return fits[key] ? key : null;
}

// Moves, pins, nests or unnests several sessions in one write, with one Undo. `to` is { group } (null for each one's loose list), { pinned: true },
// { parent } or { parent: null }. A picked session whose parent is picked too rides along with its family and is left alone. Any
// refusal writes nothing.
function manyChange({ ids, to }) {
  if (!Array.isArray(ids) || ids.length < 1) throw refuse(400, 'Pick at least one session.');
  if (ids.length > MAX_PICKED) throw refuse(400, `Pick at most ${MAX_PICKED} sessions.`);
  const aim = aimOf(to);
  if (!aim) throw refuse(400, 'Where should they go?');
  const index = listedRows(ids, `An archived session cannot be ${aim === 'parent' ? 'nested' : 'moved'}.`);
  const { rows, groupSessions } = index;
  const now = layout.read();
  if (now.problem) throw refuse(500, now.problem);
  if (aim === 'group' && to.group !== null && !now.groups.some(g => g.id === to.group)) throw refuse(400, 'Unknown group.');

  const chosen = new Set(ids);
  const direct = ids.filter(id => !chosen.has(rows.get(id).parent));
  const own = linksNow();
  // A nested session that leaves its place keeps the picked sessions under it and leaves the others under the one it showed under.
  const leave = id => {
    if (own(id) === null) return {};
    return { unlink: true, relink: Object.fromEntries(Object.entries(keepFamily(id, index)).filter(([kid]) => !chosen.has(kid))) };
  };
  const stays = (id, group, pinned) => own(id) === null && (pinned ? rows.get(id).pinned : !rows.get(id).pinned && rows.get(id).group === group);
  let steps;
  if (aim === 'parent' && to.parent === null) {
    steps = direct.filter(id => own(id) !== null).map(id => ({ kind: 'unnest', id, group: rows.get(id).group, pinned: rows.get(id).pinned, relink: leave(id).relink }));
  } else if (aim === 'parent') {
    const { root } = familyRoot(to.parent, { rows, groupSessions });
    const refusal = 'A session cannot nest under itself or a session nested under it.';
    if (chosen.has(to.parent) || chosen.has(root)) throw refuse(400, refusal);
    steps = direct.filter(id => rows.get(id).parent !== root).map(id => ({ kind: 'nest', id, parent: root, relink: leave(id).relink }));
    const links = Object.assign({}, ...steps.flatMap(step => [step.relink, { [step.id]: root }]));
    const final = id => (Object.hasOwn(links, id) ? links[id] : own(id));
    for (const id of Object.keys(links)) {
      const chain = chainOf(rows, final, rows.get(id));
      if (final((chain.at(-1) ?? rows.get(id)).id) === id) throw refuse(400, refusal);
    }
  } else if (aim === 'pinned') {
    steps = direct.filter(id => !stays(id, null, true)).map(id => ({ kind: 'pin', id, pinned: true, ...leave(id) }));
  } else {
    steps = direct.filter(id => !stays(id, to.group, false)).map(id => ({ kind: 'move', id, group: to.group, ...leave(id) }));
  }
  if (!steps.length) return { count: 0 };

  const { before } = layout.many(steps);
  const at = Date.now();
  for (const [token, undo] of manyUndos) if (at - undo.at > UNDO_WINDOW_MS) manyUndos.delete(token);
  const undo = crypto.randomUUID();
  const changed = new Set(steps.map(step => step.id));
  // A picked session that rides along counts when the one it rides with was changed.
  const headOf = id => (chosen.has(rows.get(id).parent) ? headOf(rows.get(id).parent) : id);
  const count = ids.filter(id => changed.has(headOf(id))).length;
  manyUndos.set(undo, { before, at, count });
  return { undo, count };
}

// Puts back what manyChange changed, for ten minutes after it. The token is spent before anything is restored, so a failure part way cannot
// leave it to be replayed, and a second Undo from another tab is a 404.
function undoMany({ undo }) {
  const held = typeof undo === 'string' ? manyUndos.get(undo) : undefined;
  if (!held) throw refuse(404, 'There is nothing to undo.');
  manyUndos.delete(undo);
  if (Date.now() - held.at > UNDO_WINDOW_MS) throw refuse(409, 'It is too late to undo that. Move the sessions back by hand.');
  layout.restore(held.before);
  return { count: held.count };
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

// Projects, groups and new parents change by POST only, each with a JSON body, and a GET to these paths is a 404 that changes nothing.
const STRUCTURE = new Map([
  ['/api/layout/project/add', b => layout.addProject(b.name)],
  ['/api/layout/project/rename', b => layout.renameProject(b.id, b.name)],
  ['/api/layout/group/rename', b => layout.renameGroup(b.id, b.name)],
  ['/api/layout/project/remove', b => layout.removeProject(b.id)],
  ['/api/layout/group/add', b => layout.addGroup(b.name, b.project ?? null)],
  ['/api/layout/group/move', b => layout.moveGroup(b.id, b.project ?? null)],
  ['/api/layout/group/order', b => layout.orderGroup(b.id, { before: b.before, after: b.after })],
  ['/api/layout/project/order', b => layout.orderProject(b.id, { before: b.before, after: b.after })],
  ['/api/layout/group/remove', b => removeGroup(b.id)],
  ['/api/layout/parent', newParent],
  ['/api/layout/parent/undo', undoParent],
  ['/api/layout/many', manyChange],
  ['/api/layout/many/undo', undoMany],
]);

async function editStructure(req, res, change) {
  const body = await readJson(req, 64_000);
  if (!body) return send(res, 400, { error: 'Send a JSON body.' });
  // A new password can land while the body is still arriving, so the session is checked again before the layout is written.
  if (!auth.check(req)) return send(res, 401, { error: 'Signed out.' });
  try {
    return send(res, 200, change(body));
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
}

// POST api/layout/account pins a session, group or project to an account with { kind, id, account }, and clears the pin when account is null.
// An optional `overflow` names the account that takes the work while the pinned one is out of usage: an id sets it, null clears it and leaving it out keeps it.
// A pin or an overflow on an account that is signed out is refused, as a switch to one is. It runs work as the owner, so it takes the stricter origin check.
// The chats of other accounts that are idle stop at once, and the rest as they go idle.
async function pinAccount(req, res) {
  if (!strictOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });
  const body = await readJson(req, 10_000);
  if (!body) return send(res, 400, { error: 'Send a JSON body.' });
  if (!auth.check(req)) return send(res, 401, { error: 'Signed out.' });
  const { kind, id, account, overflow } = body;
  if (!['session', 'group', 'project'].includes(kind)) return send(res, 400, { error: 'Pin a session, a group or a project.' });
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Which one?' });
  if (account !== null && typeof account !== 'string') return send(res, 400, { error: 'Name an account, or null to clear the pin.' });
  if (overflow !== undefined && overflow !== null && typeof overflow !== 'string') return send(res, 400, { error: 'Name an account, or null to clear the overflow.' });
  if (overflow && overflow === account) return send(res, 400, { error: 'The overflow must be another account than the pin.' });
  try {
    if (kind === 'session') editableRow(id);
    // Clearing the pin clears the overflow, so a stray overflow in that body is not checked.
    for (const wanted of account === null ? [] : [account, overflow].filter(Boolean)) {
      const found = accounts.find(wanted);
      if (!found) return send(res, 404, { error: 'Unknown account.' });
      await accountLogins.refresh(found);
      if (accountLogins.state(found).signedOut) return send(res, 409, { error: `${found.name} is signed out. Sign it in first.` });
    }
    layout.setAccount(kind, id, account, account === null ? undefined : overflow);
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
  retireOtherAccounts();
  return send(res, 200, { kind, id, account, ...(overflow !== undefined && account !== null && { overflow }) });
}

// What the CLI lists under `key` for a session or a folder, named in the body as `id` or `cwd`. A chat with a process answers from its own
// reply, and anything else from a probe of its folder.
async function askLists(req, res, key, list) {
  const body = await readJson(req, 10_000);
  if (!body) return send(res, 400, { error: 'Send a JSON body.' });
  const { id, cwd } = body;
  let folder = cwd;
  // The probe runs on the account of the session that asked, and on the active one when only a folder is named.
  let env = envOfAccount(accounts.active.id);
  if (typeof id === 'string') {
    if (!/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Bad session id' });
    const known = getChat(id)?.[key];
    if (known) return send(res, 200, { [key]: known });
    const row = findRow(id);
    if (!row) return send(res, 404, { error: NO_SESSION });
    folder = row.cwd && fs.existsSync(row.cwd) ? row.cwd : os.homedir();
    env = envOfAccount(accountOfSession(id).id);
  } else if (cwd === undefined) {
    return send(res, 400, { error: 'Which session or folder?' });
  } else if (typeof cwd !== 'string' || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return send(res, 400, { error: 'That folder does not exist on this Mac.' });
  }
  try {
    return send(res, 200, { [key]: await list(folder, cfg.claude, { env: () => env }) });
  } catch (e) {
    return send(res, 502, { error: e.message });
  }
}

// GET api/routines lists them and POST adds one. GET api/routines/<id>/prompt reads one's prompt, PATCH api/routines/<id> edits it and
// DELETE removes it. POST api/routines/<id>/run runs one now, and POST api/routines/<id>/enabled switches it on or off.
// A routine runs a prompt as the owner, so the writes take the terminal's stricter origin check.
// NOTE: [8 Nov 2026] EK - The Swift app calls these routes, and scheduledApi's below, and decodes their replies in apple/GhostShellKit/Sources/GhostShellKit/Endpoints/Routines.swift and
// Models/RoutineModels.swift, which name these handlers in turn. A moved route, body or reply shape breaks the Mac app's Routines screen.
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
    if (adding || req.method === 'PATCH') {
      const was = adding ? null : routineStore.read().routines.find(r => r.id === id)?.account ?? null;
      const routine = adding ? routines.add(body) : routines.edit(id, body);
      // Its runs take the routine's account, so the idle ones on the old account stop as they do for a pin.
      if ((routine.account ?? null) !== was) retireOtherAccounts();
      return send(res, 200, { routine });
    }
    if (action === 'run') return send(res, 200, await routines.runNow(id));
    return send(res, 200, { routine: routines.setEnabled(id, body.enabled) });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message, ...(e.problems && { problems: e.problems }) });
  }
}

// GET api/scheduled lists the one-off sessions and POST adds one. PATCH api/scheduled/<id> edits a pending one and DELETE removes it. POST
// api/scheduled/<id>/cancel calls a pending one off and POST api/scheduled/<id>/start starts it now. Like a routine, one starts a prompt as the
// owner, so the writes take the terminal's stricter origin check.
async function scheduledApi(req, res, parts) {
  const [, , id, action] = parts;
  const adding = parts.length === 2;
  if (!adding && !/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Bad scheduled session id' });
  const allowed = adding ? ['GET', 'POST'] : parts.length === 3 ? ['PATCH', 'DELETE'] : ['cancel', 'start'].includes(action) ? ['POST'] : null;
  if (parts.length > 4 || !allowed) return send(res, 404, { error: 'Not found' });
  if (!allowed.includes(req.method)) return send(res, 405, { error: 'Method not allowed' }, 'application/json', { allow: allowed.join(', ') });
  try {
    if (req.method === 'GET') return send(res, 200, scheduled.list());
    if (!strictOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });
    if (req.method === 'DELETE') return send(res, 200, { removed: scheduled.remove(id) });
    const body = await readJson(req, 300_000);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Send a JSON body.' });
    // A new password can land while the body is still arriving, so the session is checked again before anything is written.
    if (!auth.check(req)) return send(res, 401, { error: 'Signed out.' });
    if (adding) return send(res, 200, { scheduled: scheduled.add(body) });
    if (req.method === 'PATCH') return send(res, 200, { scheduled: scheduled.edit(id, body) });
    if (action === 'start') return send(res, 200, await scheduled.startNow(id));
    return send(res, 200, { scheduled: scheduled.cancel(id) });
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
  try {
    ensureChat(id, row).send(text);
  } catch (e) {
    // A pinned account that is signed out cannot take it, so it waits with the next message, as it does when the settings say not to reply.
    if (!e.blocked) throw e;
    terminal.hold(id, text);
    return 'held';
  }
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

// GET api/summaries?ids=a,b,c answers for each id that is a session: the first sentence of its latest reply, what that reply asks of the reader, when it was said, and what it waits on.
// With detail=1 each also has the reply itself. An id that is no session, or is a group's chat, is left out without a word.
function summariesApi(res, u) {
  const ids = askedIds(u);
  if (typeof ids === 'string') return send(res, 400, { error: ids });
  const detail = u.searchParams.get('detail') === '1';
  const { rows } = buildIndex({ archived: true });
  const found = ids.filter(id => rows.has(id)).map(id => {
    const said = summaries.get(id, rows.get(id).cwd);
    return [id, { line: said?.line ?? '', ask: said?.ask ?? '', at: said?.at ?? null, pending: pendingLines(pendingOf(id)), ...(detail && { reply: said?.reply ?? '' }) }];
  });
  return send(res, 200, { summaries: Object.fromEntries(found) });
}

// The pull requests each of `sessions` (rows with an id and a cwd) is working on, as a map of id to the status gh gave, and whether some are still being read.
async function pullsFor(sessions) {
  const urls = new Map(sessions.map(({ id, cwd }) => [id, pulls.urlsFor(id, cwd)]));
  const { found, settling } = await pulls.lookup([...new Set([...urls.values()].flat())]);
  return { lists: new Map([...urls].map(([id, list]) => [id, list.filter(url => found.has(url)).map(url => found.get(url))])), settling };
}

// GET api/pulls?ids=a,b,c answers for each id that is a session: the pull requests it is working on, with their status from GitHub, and
// whether some are still being read. An id that is no session, or is a group's chat, is left out without a word, and a broken or missing gh gives empty lists.
async function pullsApi(res, u) {
  const ids = askedIds(u);
  if (typeof ids === 'string') return send(res, 400, { error: ids });
  const { rows } = buildIndex({ archived: true });
  const { lists, settling } = await pullsFor(ids.filter(id => rows.has(id)).map(id => rows.get(id)));
  return send(res, 200, { pulls: Object.fromEntries(lists), settling });
}

// GET api/sessions/<id>/subagents/<agentId> answers one helper the session started: its state, its last steps and, once it has ended, its reply.
// The id has to be a file the helpers' folder lists, so a made-up one is a 404 and no path of the caller's is opened.
function subagentApi(res, id, rest) {
  const [agentId, ...more] = rest;
  if (!agentId || more.length) return send(res, 404, { error: 'Not found' });
  if (!/^[\w-]+$/.test(agentId)) return send(res, 400, { error: 'Bad subagent id' });
  const t = transcriptFor(id) || (indexTranscripts(cfg.projectsDir, 0), transcriptFor(id));
  if (!t) return send(res, 404, { error: NO_SESSION });
  const found = subagents.detail(t, agentId);
  return found ? send(res, 200, found) : send(res, 404, { error: 'No such subagent.' });
}

const MAX_LINKS = 40;

// The distinct addresses in the url parameters, or the sentence for a 400 when there are none, too many, or one is not a pull request or issue address.
function askedLinks(u) {
  const urls = [...new Set(u.searchParams.getAll('url'))];
  if (!urls.length) return 'Name the links in url.';
  if (urls.length > MAX_LINKS) return `Ask for at most ${MAX_LINKS} links at a time.`;
  return urls.every(url => isPullUrl(url) || isIssueUrl(url)) ? urls : 'Every url must be the plain address of a GitHub pull request or issue.';
}

// GET api/links?url=a&url=b answers for each address that is a GitHub pull request or issue: its title and status from GitHub, and whether some
// are still being read. An address gh cannot show is left out without a word.
async function linksApi(res, u) {
  const urls = askedLinks(u);
  if (typeof urls === 'string') return send(res, 400, { error: urls });
  const { found, settling } = await pulls.lookup(urls);
  return send(res, 200, { links: Object.fromEntries(found), settling });
}

// ---- ranked updates to a group's chat ------------------------------------------------------------
// A turn in each group's chat when its sessions change, under the rules in docs/adr/20261023-a-session-for-each-group.md (amended 2026-10-27).

// A turn another app runs is read from its transcript for up to a day, with or without a page on it, so a long tool call is still a turn
// after 10 minutes and a session left open for a day is not.
const updateOutside = createOutside({ staleMs: 24 * 3600_000, keep: 256 });

// The group's live sessions with their marks, as the page's list draws them.
function updateMembers(groupId) {
  const found = groupCtx(groupId).lookup();
  if (!found) return null;
  const now = Date.now();
  const shared = { desk: loadDesktop(cfg.desktopDir), mine: marks.read(), now };
  const rows = found.members.filter(r => !r.archived).map(r => {
    const chat = workingChat(r.id);
    const turn = chat ? chat.work.snapshot() : updateOutside.read(transcriptFor(r.id));
    const row = turn && r.state === 'idle' ? { ...r, state: 'active' } : r;
    return { ...row, external: !chat, dot: dotFor(row, row.state === 'active' && !!turn, shared) };
  });
  return { name: found.name, rows };
}

const groupUpdates = makeGroupUpdates({
  timing: scaled(cfg.groupUpdateScale),
  enabled: () => cfg.groupUpdates,
  candidates: () => layout.read().groups.filter(g => g.session).map(g => ({ groupId: g.id, chatId: g.session })),
  openedAt: chatId => (viewers.get(chatId)?.size ? Date.now() : marks.read().seen.get(chatId) ?? 0),
  // The chat's transcript is written as its model is called, so its time stands in for the last call.
  transcript(chatId) {
    const t = transcriptFor(chatId) || (indexTranscripts(cfg.projectsDir, 60_000), transcriptFor(chatId));
    try { return t && { mtime: fs.statSync(t.file).mtimeMs }; } catch { return null; }
  },
  members: updateMembers,
  details: row => ({ pending: pendingLines(pendingOf(row.id)), said: summaries.get(row.id, row.cwd)?.line ?? '' }),
  pulls: rows => pullsOf(rows, pulls),
  chatIdle: chatId => (getChat(chatId)?.state ?? 'idle') === 'idle',
  viewing: chatId => !!viewers.get(chatId)?.size,
  send(chatId, text) {
    const row = findRow(chatId);
    if (!row?.groupSession || !layout.read().groups.some(g => g.session === chatId)) throw new Error('the group is gone');
    ensureChat(chatId, row).send(text);
  },
  rules: rankRules,
  store: makeUpdateStore(cfg.stateDir),
});

// The sidebar banners: when Claude's sign-in ends, and merged changes waiting on main. Both answer from what was last worked out, so a request waits
// on no git, keychain or CLI work. See docs/adr/20261102-banners-for-sign-in-and-updates.md.
// Each account has a sign-in of its own, a mark when it is out of usage, and its last plan usage. See docs/adr/20261102-switch-claude-accounts.md.
// The accounts with a pin on a session, group, project or routine, or a running chat. The sign-in banner covers these and the active account.
const accountsInUse = () => {
  const own = pinsOf(layout.read());
  return [...Object.values(own.accounts), ...[...own.groups, ...own.projects, ...routineStore.read().routines].map(item => item.account), ...runningChats().map(c => c.account)].filter(Boolean);
};
const accountLogins = makeAccountLogins({
  accounts,
  inUse: accountsInUse,
  authInfo: opts => authInfo({ claude: cfg.claude, ...opts }),
  readLoginEnd: opts => readLoginEnd({ security: cfg.security, ...opts }),
  startSignIn: opts => startSignIn({ claude: cfg.claude, ...opts }),
  retireOtherAccounts,
  afterSwitch: account => chromeCheck.switched(account),
  // An update can end in a restart, and its fetch outlasts the sign-in guard in bannersApi.
  restarting: () => ['updating', 'restarting'].includes(updates.state().stage),
});
onAuthFailure(accountLogins.authFailed);
onUsage(heardUsage);

// After a switch, whether Chrome's Claude extension is on the new account, and the banner that says to move it when it is not.
const chromeCheck = makeChromeCheck({
  accounts,
  enabled: cfg.chrome,
  probe: account => browserSeen({ claude: cfg.claude, env: cleanEnv(process.env, accounts.loginEnvOf(account)) }),
  emailOf: id => accountLogins.view().find(a => a.id === id)?.email ?? '',
  openSettings: () => openChromeSettings({ open: cfg.open }),
});

const bannersNow = () => ({ login: accountLogins.loginNow(), update: updates.state(), accounts: accountLogins.banner(), chrome: chromeCheck.state() });

const updates = makeUpdate({
  root: cfg.updateRoot,
  locked: () => lockHolder(path.join(cfg.stateDir, 'restart.lock')) !== null,
  // The chats the restart helper waits for are the ones mid-turn, whether they are working or waiting on an approval.
  busy: () => Object.values(activeStates()).filter(state => state !== 'idle').length,
  log: path.join(cfg.stateDir, 'restart.log'),
});

// GET api/banners gives both banners. POST api/banners/sign-in starts a sign-in on the Mac and POST api/banners/update pulls the merged changes,
// then restarts if they need it. POST api/banners/force-restart does the same without waiting for chats, so it can cut one. All three run
// something as the owner, so they take the stricter origin check, and the page is the only way to reach the force.
async function bannersApi(req, res, parts) {
  const step = parts[2];
  if (req.method === 'GET' && parts.length === 2) {
    updates.refresh();
    return send(res, 200, bannersNow());
  }
  if (req.method !== 'POST' || parts.length !== 3 || !['sign-in', 'update', 'force-restart'].includes(step)) return send(res, 404, { error: 'Not found' });
  if (!strictOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });
  // `claude auth login` is not a chat, so the restart helper would not wait for it.
  if (step === 'sign-in') {
    // No account named means the active one, as a page left open from before sends.
    const body = await readJson(req, 10_000);
    if (!body) return send(res, 400, { error: 'Send a JSON body.' });
    if (body.account !== undefined && typeof body.account !== 'string') return send(res, 400, { error: 'Say which account.' });
    const account = body.account === undefined ? accounts.active : accounts.find(body.account);
    if (!account) return send(res, 404, { error: 'Not found' });
    const refused = accountLogins.signIn(account);
    if (refused) return send(res, 409, { error: refused });
  } else if (accountLogins.waiting() && updates.state().restart) return send(res, 409, { error: 'A sign-in is waiting on the Mac, so GhostShell cannot restart yet.' });
  else {
    const { problem } = await updates.update({ force: step === 'force-restart' });
    if (problem) return send(res, 409, { error: problem });
  }
  return send(res, 200, bannersNow());
}

// What the Accounts page shows, from what was last worked out. No token, orgId or setting is in it.
const accountsNow = () => {
  const own = layout.read();
  const pinsTo = id => ({
    sessions: Object.values(own.accounts).filter(v => v === id).length,
    groups: own.groups.filter(g => g.account === id).length,
    projects: own.projects.filter(p => p.account === id).length,
    routines: routineStore.read().routines.filter(r => r.account === id).length,
  });
  return {
    accounts: accountLogins.view().map(a => {
      const chromeOn = chromeCheck.elsewhere(a.id);
      return {
        ...a, ...(chromeOn && { chromeOn }), active: a.id === accounts.active.id, first: a.id === accounts.list()[0].id, pinned: pinsTo(a.id),
        chats: runningChats().filter(c => c.account === a.id).map(c => ({ id: c.id, title: findRow(c.id)?.title || UNTITLED, state: c.state })),
      };
    }),
    autoSwitch: accounts.autoSwitch,
    auto: accountLogins.banner().auto,
    chrome: chromeCheck.state(),
    waiting: accountLogins.waiting(),
  };
};

// Asks up to two running chats of each account for its plan usage, so the page can show every account's last answer. No chat is started.
const askPlans = () => Promise.all(accounts.list().map(a => askPlan(a.id, null)));

// Why a chat stays on the account it started under after a switch, and that it moves once that ends.
function keptWords(chat, wanted) {
  const [what, ends] = chat.pending.size ? ['waiting on an approval', 'it is answered'] : chat.state !== 'idle' ? ['still in a turn', 'the turn ends'] : ['still running a job', 'the job ends'];
  return `That chat is ${what} on ${accounts.find(chat.account)?.name ?? 'the other account'}. It moves to ${accounts.find(wanted)?.name ?? accounts.active.name} once ${ends}.`;
}

// GET api/accounts lists them. POST api/accounts adds one by name and starts its sign-in, and POST api/accounts/<id>/sign-in starts one. The rest are
// POST api/accounts/<id>/rename, POST api/accounts/<id>/use (with `continue`, a session to send "Continue." to), POST api/accounts/auto, POST api/accounts/seen,
// POST api/accounts/plan, POST api/accounts/chrome-open (the extension's settings on the Mac) and POST api/accounts/chrome-seen. All of them run something as the owner, so they take the stricter origin check.
async function accountsApi(req, res, parts) {
  if (req.method === 'GET' && parts.length === 2) return send(res, 200, accountsNow());
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
  if (!strictOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });
  const body = await readJson(req, 10_000);
  if (!body) return send(res, 400, { error: 'Send a JSON body.' });
  const refuse = (status, error) => send(res, status, { error });
  if (parts.length === 2) {
    if (accountLogins.blocked()) return refuse(409, accountLogins.blocked());
    const { account, problem } = accounts.add(body.name);
    if (problem) return refuse(400, problem);
    accountLogins.signIn(account);
    await accountLogins.refresh(account);
    return send(res, 200, { ...accountsNow(), added: account.id });
  }
  const step = parts[2];
  if (parts.length === 3 && step === 'auto') {
    if (typeof body.on !== 'boolean') return refuse(400, 'Say whether to switch by itself.');
    accounts.setAuto(body.on);
    return send(res, 200, accountsNow());
  }
  if (parts.length === 3 && step === 'seen') {
    accountLogins.seen();
    return send(res, 200, accountsNow());
  }
  if (parts.length === 3 && step === 'chrome-open') {
    const refused = await chromeCheck.open();
    if (refused) return refuse(409, refused);
    return send(res, 200, accountsNow());
  }
  if (parts.length === 3 && step === 'chrome-seen') {
    chromeCheck.dismiss();
    return send(res, 200, accountsNow());
  }
  if (parts.length === 3 && step === 'plan') {
    await askPlans();
    return send(res, 200, accountsNow());
  }
  const account = accounts.find(parts[2]);
  if (!account || parts.length !== 4) return refuse(404, 'Not found');
  if (parts[3] === 'sign-in') {
    const refused = accountLogins.signIn(account);
    if (refused) return refuse(409, refused);
    return send(res, 200, accountsNow());
  }
  if (parts[3] === 'rename') {
    const { problem } = accounts.rename(account.id, body.name);
    if (problem) return refuse(400, problem);
    return send(res, 200, accountsNow());
  }
  if (parts[3] !== 'use') return refuse(404, 'Not found');
  const row = body.continue === undefined ? null : typeof body.continue === 'string' && /^[\w-]+$/.test(body.continue) ? findRow(body.continue) : null;
  if (body.continue !== undefined && !row) return refuse(404, NO_SESSION);
  // A pinned session stays where its pin puts it, so a switch cannot carry it on, and the active account is left alone.
  const pinned = row && accountOfSession(row.id);
  if (pinned && pinned.from !== 'active' && pinned.id !== account.id) return refuse(409, `This session stays on ${accounts.find(pinned.id)?.name ?? 'its account'} because of a pin, so a switch won't move it. Change the pin to move it.`);
  await accountLogins.refresh(account);
  if (accountLogins.state(account).signedOut) return refuse(409, `${account.name} is signed out. Sign it in first.`);
  if (account.id !== accounts.active.id) accountLogins.switchTo(account);
  // A chat that is busy keeps its process on the old account, so "Continue." would go to the account that is out.
  const kept = row && getChat(row.id);
  kept?.retire(true);
  // The session's own account, which a pin can keep apart from the one just switched to.
  const wanted = row && accountOfSession(row.id);
  if (kept?.proc?.stdin.writable && kept.account !== wanted.id) return refuse(409, keptWords(kept, wanted.id));
  if (row) ensureChat(row.id, row).send('Continue.');
  return send(res, 200, accountsNow());
}

// Whether a chat links to a path, for a read and a save alike, or null when this Mac has no such session.
function linkedIn(id) {
  const t = transcriptFor(id) || (indexTranscripts(cfg.projectsDir, 0), transcriptFor(id));
  const chat = getChat(id);
  return !t && !chat ? null : linksOf(t, chat?.live, cfg.outputChars);
}

async function api(req, res, u) {
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[1] === 'banners') return bannersApi(req, res, parts);
  if (parts[1] === 'accounts') return accountsApi(req, res, parts);
  if (parts[1] === 'routines') return routinesApi(req, res, parts);
  if (parts[1] === 'scheduled') return scheduledApi(req, res, parts);
  if (parts[1] === 'schedule' && parts.length === 2) return scheduleApi(req, res, u);
  if (parts[1] === 'passkeys') return passkeysApi(req, res, parts, u);
  // NOTE: [7 Nov 2026] EK - The Swift app decodes this reply in apple/GhostShellKit/Sources/GhostShellKit/Models/SessionIndex.swift, which names this
  // handler in turn. Its decoding is lenient, so a field renamed here is dropped there with no error.
  if (req.method === 'GET' && u.pathname === '/api/sessions') {
    const withArchived = u.searchParams.get('archived') === '1';
    const { rows, groupSessions, archivedSection, families, ...index } = buildIndex({ archived: withArchived });
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
    // Tells a page which of these a server knows, which an older one cannot say: group sessions, sessions for the built-in sections, deleting and ordering groups, adding, editing and deleting routines, routines that run a prompt file, the group a routine can be given for a heading in Home, one-off scheduled sessions, sub session summaries, the status of the pull requests a session works on, the status of the pull requests and issues a reply links to, and the ranked updates a group's chat gets, with the typing ping that holds them back, and the helpers a session started, and a new parent for several sessions, the banners for the sign-in and for updates, and moving or nesting several sessions in one write.
    return send(res, 200, { ...index, features: { groupSessions: true, sectionSessions: true, groupEdits: true, projectOrder: true, groupRename: true, routineEdits: true, routineFiles: true, scheduled: true, subStatus: true, pullStatus: true, linkStatus: true, groupUpdates: true, subagents: true, newParent: true, banners: true, accounts: true, accountPins: true, many: true, routineHeadings: true } });
  }
  if (req.method === 'GET' && u.pathname === '/api/summaries') return summariesApi(res, u);
  if (req.method === 'GET' && u.pathname === '/api/pulls') return pullsApi(res, u);
  if (req.method === 'GET' && u.pathname === '/api/links') return linksApi(res, u);
  // Every pull request each session names, for Ctrl+K. It is answered from memory, filled by a worker thread, and `reading` is true until its first pass ends.
  if (req.method === 'GET' && u.pathname === '/api/pull-links') return send(res, 200, pullLinks.get());
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
    const { cwd, text, mode, model, effort, fast, group, parent, account, images: sent, files: listed } = JSON.parse(await readBody(req, MAX_BODY_BYTES) || '{}');
    // A pin, or a group or parent that picks the account, decides which subscription the session spends.
    if ((account != null || group != null || parent != null) && !strictOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });
    const { images, error } = readImages(sent);
    if (error) return send(res, 400, { error });
    const { files, error: fileError } = uploads.readFiles(listed);
    if (fileError) return send(res, 400, { error: fileError });
    if (files.length && isSlashCommand(text || '')) return send(res, 400, { error: SLASH_WITH_FILES });
    const { documents, error: documentError } = uploads.readDocuments(files);
    if (documentError) return send(res, 400, { error: documentError });
    let root = null;
    if (parent != null) {
      try {
        ({ root } = familyRoot(parent));
      } catch (e) {
        if (!e.status) throw e;
        return send(res, e.status, { error: e.message });
      }
    }
    const folder = root ? findRow(root)?.cwd : cwd;
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return send(res, 400, { error: 'That folder does not exist on this Mac.' });
    if (!text?.trim() && !images.length && !files.length) return send(res, 400, { error: 'Write the first message.' });
    if (model && !MODEL.test(model)) return send(res, 400, { error: 'Unknown model.' });
    if (effort && !EFFORTS.includes(effort)) return send(res, 400, { error: 'Unknown effort level.' });
    if (fast !== undefined && typeof fast !== 'boolean') return send(res, 400, { error: 'Unknown fast mode.' });
    if (group != null && !groupList().some(g => g.id === group)) return send(res, 400, { error: 'Unknown group.' });
    if (account != null && (typeof account !== 'string' || !accounts.find(account))) return send(res, 400, { error: 'Unknown account.' });
    const chosen = MODES.includes(mode) ? mode : desktopSettings({ cwd: folder }).mode;
    const home = root ? null : group ?? null;
    const id = await newSession({ cwd: folder, text: text || '', images, documents, files, mode: chosen, model, effort, fast, group: home, parent: root, account: account ?? null });
    if (home) placeStarted(id, home);
    uploads.record(id, files);
    if (!root) return send(res, 200, { id });
    try {
      layout.nest(id, root);
    } catch (e) {
      console.error(`Could not nest ${id} under ${root}: ${e.message}`);
      return send(res, 200, { id, notNested: true });
    }
    return send(res, 200, { id });
  }
  if (u.pathname === '/api/uploads') return uploadsApi(req, res);
  // POSTs, so a page on another site can never start a CLI through them (the same-origin check covers POSTs only).
  if (req.method === 'POST' && u.pathname === '/api/commands') return askLists(req, res, 'commands', listCommands);
  if (req.method === 'POST' && u.pathname === '/api/models') return askLists(req, res, 'models', listModels);
  if (req.method === 'POST' && u.pathname === '/api/layout/move') return editLayout(req, res, (id, body) => CHANGES.move(id, body.group));
  if (req.method === 'POST' && u.pathname === '/api/layout/pin') return editLayout(req, res, (id, body) => layout.pin(id, body.pinned, leaving(id)));
  if (req.method === 'POST' && u.pathname === '/api/layout/nest') return editLayout(req, res, (id, body) => nest(id, body.parent));
  if (req.method === 'POST' && u.pathname === '/api/layout/rename') return editLayout(req, res, (id, body) => ({ title: CHANGES.rename(id, body.title) }));
  if (req.method === 'POST' && u.pathname === '/api/layout/archive') return editLayout(req, res, (id, body) => CHANGES.archived(id, body.archived, body.stop));
  if (req.method === 'POST' && u.pathname === '/api/layout/account') return pinAccount(req, res);
  if (req.method === 'POST' && STRUCTURE.has(u.pathname)) return editStructure(req, res, STRUCTURE.get(u.pathname));
  if (req.method === 'POST' && (u.pathname === '/api/chips/start' || u.pathname === '/api/chips/dismiss')) {
    const { sessionId, toolUseId, title, tldr, prompt, cwd, confirmCwd, model: postedModel, effort: postedEffort } = JSON.parse(await readBody(req) || '{}');
    if (!sessionId || !toolUseId) return send(res, 400, { error: 'Which chip?' });
    const known = chips.get(toolUseId);
    const maker = () => findRow(known?.sessionId || sessionId);
    if (known && known.status !== 'open') return send(res, 409, { error: `That chip was already ${known.status}.`, chip: withOpensIn(known, maker()) });
    if (u.pathname.endsWith('/dismiss')) return send(res, 200, { chip: withOpensIn(chips.put({ ...known, toolUseId, sessionId: known?.sessionId || sessionId, title, status: 'dismissed' }), maker()) });
    const text = known?.prompt || prompt;
    const model = known?.model || postedModel;
    if (model && (typeof model !== 'string' || !MODEL.test(model))) return send(res, 400, { error: 'Unknown model.' });
    const effort = known?.effort || postedEffort;
    if (effort && !EFFORTS.includes(effort)) return send(res, 400, { error: 'Unknown effort level.' });
    // Only the chip the server stored names a group, never the posted card or the transcript's input.
    const named = known?.group;
    if (named && !groupList().some(g => g.id === named)) return send(res, 400, { error: 'The group this chip names has been deleted. Ask the session to suggest the task again.' });
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
    // A chip from a sub session starts its session beside it, under the sub session's parent. A chip naming a group is unlinked anyway.
    const nestUnder = named ? null : liveHeadOf(findRow(known?.sessionId || sessionId));
    const makerId = known?.sessionId || sessionId;
    const id = await newSession({ cwd: start, text, title: known?.title || title, model, effort, group: named || groupId || null, parent: named || groupId ? null : nestUnder || makerId });
    // A group's session is out of every list, so a session its chip starts would show at the top level. It goes into the group instead, and a
    // section's chip pins it or leaves it loose, as that section's own chat would. A group the chip names wins over both, and the session is
    // unlinked so it stands in that group on its own. See docs/adr/20261027-chips-name-their-group.md.
    // A group deleted while the session started leaves it loose, never nested where the chip did not ask for it.
    if (named) placeStarted(id, named, { unlink: true }) || placeStarted(id, null, { unlink: true });
    else if (groupId) placeStarted(id, groupId);
    const started = chips.put({ ...known, toolUseId, sessionId: known?.sessionId || sessionId, title: known?.title || title, tldr: known?.tldr || tldr, ...(model && { model }), ...(effort && { effort }), ...(nestUnder && { nestUnder }), status: 'started', startedId: id });
    return send(res, 200, { id, chip: withOpensIn(started, findRow(started.sessionId)) });
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
  if (req.method === 'GET' && action === 'subagents') return subagentApi(res, id, parts.slice(4));
  if (req.method === 'GET' && action === 'messages') {
    const row = findRow(id);
    const connectors = loadDesktop(cfg.desktopDir).connectors.get(id) || {};
    // fileLinks and terminal tell the page that those routes exist, so a page newer than this server draws nothing that would 404.
    return send(res, 200, { ...readMessages(id, u.searchParams), fileLinks: true, terminal: !row?.groupSession, session: row && { id, title: row.title, cwd: row.cwd, branch: row.branch, source: row.source, routine: row.routine, connectors } });
  }
  if (req.method === 'GET' && action === 'events') return events(req, res, id);
  if (req.method === 'GET' && action === 'chips') {
    const index = buildIndex({ archived: true });
    const rowOf = rowId => index.rows.get(rowId) || index.groupSessions.get(rowId) || null;
    return send(res, 200, { chips: chips.forSession(id).map(c => withOpensIn(c, rowOf(id), rowOf)) });
  }
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
  // A file a reply or a thought in the chat links to, as its text or its bytes, and a save of its text. lib/files.mjs holds the gate, and
  // `about` keeps a browser from reading the JSON about a file as anything else.
  const about = { 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' };
  if (req.method === 'GET' && (action === 'preview' || action === 'file') && !parts[4]) {
    const linked = linkedIn(id);
    if (!linked) return send(res, 404, { error: NO_SESSION }, 'application/json', about);
    const wanted = u.searchParams.get('path');
    try {
      if (action === 'preview') return send(res, 200, await previewFile(wanted, linked, frozen), 'application/json', about);
      const file = await serveFile(wanted, linked, u.searchParams.get('download') === '1', req.headers.range);
      res.writeHead(file.status, file.headers);
      if (!file.stream) return res.end();
      return pipeline(file.stream, res, () => {});
    } catch (e) {
      return send(res, e.status || 500, { error: e.message }, 'application/json', about);
    }
  }
  // Writes the owner's text over a linked file, so it takes the terminal's rules: this host's Origin, a JSON body and a second look at the sign-in.
  if (action === 'save' && !parts[4]) {
    const reply = (status, body) => send(res, status, body, 'application/json', about);
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, 'application/json', { ...about, allow: 'POST' });
    if (!strictOrigin(req)) return reply(403, { error: 'Cross-site request refused.' });
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'Send JSON.' });
    // A JSON string can grow six times over as escapes, so the limit allows for that.
    const limit = MAX_TEXT_BYTES * 6 + 64_000;
    if (Number(req.headers['content-length']) > limit) return reply(413, { error: 'That text is more than GhostShell saves.' });
    const body = await readJson(req, limit);
    if (!body || [body.path, body.text, body.base].some(v => typeof v !== 'string')) return reply(400, { error: 'Send the path, the text and the version of the file.' });
    // A new password can land while the body is still arriving, so the session is checked again before anything is written.
    if (!auth.check(req)) return reply(401, { error: 'Signed out.' });
    const linked = linkedIn(id);
    if (!linked) return reply(404, { error: NO_SESSION });
    try {
      return reply(200, await saveFile(body.path, linked, { text: body.text, base: body.base }, frozen));
    } catch (e) {
      return reply(e.status || 500, { error: e.message, ...(e.changed && { changed: true }) });
    }
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const body = JSON.parse(await readBody(req, action === 'send' ? MAX_BODY_BYTES : undefined) || '{}');
  // The owner is typing in a group's prompt box, which holds an update back for a while. Only a group's chat takes it.
  if (action === 'typing') {
    if (!layout.read().groups.some(g => g.session === id)) return findRow(id) ? send(res, 400, { error: 'Only a group\'s chat takes this.' }) : send(res, 404, { error: NO_SESSION });
    groupUpdates.typing(id);
    return send(res, 204, '');
  }
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
    // A refused start throws before the held result is released, so it stays held.
    chat.send(held ? [held, text].filter(t => t.trim()).join('\n\n') : text, images, documents);
    if (row.groupSession) groupUpdates.ownerSpoke(id);
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
  if (action === 'plan') return send(res, 200, await planFor(id));
  if (action === 'mcp') return send(res, 200, await mcpFor(id));
  if (action === 'mcp-reload') return send(res, ...(await reloadMcpFor(id, body.name)));
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
    // NOTE: [7 Nov 2026] EK - The native app signs in here, not in a browser. It reads the `capcom` cookie off a 303 and tells a locked
    // account from a wrong password by the words "Too many tries" in the 401 page. Change either and update
    // apple/GhostShellKit/Sources/GhostShellKit/Client/GhostShellClient.swift, or every sign-in there reads as a wrong password.
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
    // A start refused for a pinned account that is signed out is the caller's to fix, so it is told with the data and not logged as a fault.
    if (e.blocked && !res.headersSent) return send(res, 409, { error: e.message, blocked: withWords(e.blocked) });
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
  scheduled.tick().catch(e => console.error(`Scheduled session check failed: ${e.message}`));
};
server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`Capcom on http://localhost:${cfg.port}`);
  setInterval(checkRoutines, 30_000).unref();
  checkRoutines();
  accounts.prepare(accounts.active);
  accountLogins.refreshAll();
  setInterval(accountLogins.refreshAll, REFRESH_MS).unref();
  setTimeout(updates.check, cfg.updateDelayMs).unref();
  setInterval(updates.check, CHECK_EVERY_MS).unref();
  setTimeout(chromeCheck.survey, cfg.surveyDelayMs).unref();
  setInterval(chromeCheck.survey, SURVEY_MS).unref();
});
setInterval(() => sweep(cfg.idleMinutes), 60_000).unref();
setInterval(() => groupUpdates.tick().catch(e => console.error(`Group updates failed: ${e.message}`)), scaled(cfg.groupUpdateScale).tick).unref();
// Whatever the terminal started ends with Capcom, so a restart leaves nothing running behind. A signal ends the process through
// exit, which kills the command groups; without a handler the default would end it first.
process.on('exit', () => { terminal.killAll(); accountLogins.stopAll(); });
for (const name of ['SIGTERM', 'SIGINT']) process.on(name, () => process.exit(128 + os.constants.signals[name]));
// With the hand-off on, sessions started before it existed are handed over the first time Capcom starts with it.
if (cfg.desktopHandoff) for (const s of readStarted()) if (!s.desktopAt && !s.routine && !s.scheduled && !awaitsFirstMessage(s.id)) handOff(s.id).catch(e => console.error(`Hand-off of ${s.id} failed: ${e.message}`));
