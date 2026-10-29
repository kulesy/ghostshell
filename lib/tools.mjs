// Capcom's own MCP server, served to each chat the way Claude Desktop serves its built-ins: declared in the
// initialize request and spoken over the session's stdio as mcp_message control requests.
// NOTE: [7 Oct 2026] EK - initialize.sdkMcpServers and mcp_message are the Agent SDK's wire format, not a published
// contract; proven on CLI 2.1.292. If chips stop appearing after a CLI update, check this first.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanName } from './layout.mjs';
import { MOST_LINKS } from '../public/ui/link-rules.js';
import { ELSEWHERE, githubStatus, groupReader, listGroupSessions, readGroupSession, startGroupSession, startRefusal, workFolder } from './groups.mjs';
import { listSubSessions, readSubSession, sendSession } from './subs.mjs';
import { archiveSession, CHIP_STATUSES, findSessions, groupNamed, layoutSummary, listChips, moveSession, setSessionTitle, unarchiveSession } from './layout-tools.mjs';

export const SERVER = 'capcom';
// The levels `claude --help` lists for --effort.
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Models are checked for shape only, because the CLI knows the current names.
export const MODEL = /^[a-z][\w.-]*(\[1m\])?$/i;

const TOOLS = [
  {
    name: 'spawn_task',
    description: 'Suggest a follow-up task to the user as a chip card in GhostShell. They can start it later as its own session with one tap, or dismiss it. Use it for work that surfaces beside the current task. The prompt must stand alone: include paths and the context the new session needs.',
    inputSchema: { type: 'object', properties: {
      title: { type: 'string', description: 'Under 60 characters, an imperative phrase.' },
      tldr: { type: 'string', description: 'One or two plain sentences on why, shown on the card.' },
      prompt: { type: 'string', description: 'The first message for the new session.' },
      cwd: { type: 'string', description: 'Absolute folder for the new session. Defaults to this session\'s folder.' },
      model: { type: 'string', description: 'The model the new session runs on, as a full id such as claude-sonnet-5-5, claude-opus-5-5 or claude-haiku-5-5. Leave it out to keep the app\'s default.' },
      effort: { type: 'string', enum: EFFORTS, description: 'The effort level the new session starts at. Leave it out to keep the app\'s default.' },
      group: { type: 'string', description: 'The name of a group as the sidebar shows it, such as Reviewing, or its id. The new session opens in that group on its own, not nested under this session. Leave it out to nest it under this session, which keeps it in this session\'s group.' },
    }, required: ['title', 'prompt'] },
  },
  {
    name: 'dismiss_task',
    description: 'Withdraw a chip created with spawn_task that is now stale or superseded.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, reason: { type: 'string' } }, required: ['task_id'] },
  },
  {
    name: 'mark_chapter',
    description: 'Mark the start of a new chapter in this session. GhostShell shows it as a titled divider in the chat. Use it sparingly, when the work moves to a meaningfully different phase.',
    inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'A short noun phrase.' }, summary: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'widget_guide',
    description: 'Returns how to write a widget for GhostShell: the size, theme, variables, sandbox and limits that show_widget works within. Call it once per chat, before the first show_widget.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'show_widget',
    description: 'Show a chart, diagram or small interactive widget inline in the chat. Call widget_guide once per chat before your first widget. widget_code is an HTML or SVG fragment that runs in a sandboxed frame and loads from cdnjs.cloudflare.com, esm.sh, cdn.jsdelivr.net and unpkg.com only.',
    inputSchema: { type: 'object', properties: {
      loading_messages: { type: 'array', items: { type: 'string' }, description: 'One to four short phrases, a few words each, shown while the widget is written. Put this field first.' },
      title: { type: 'string', description: 'A short snake_case name for the widget.' },
      widget_code: { type: 'string' },
    }, required: ['title', 'widget_code'] },
  },
];

// Listed and answered only in a group's or built-in section's own chat. The ones that read run without asking, and starting always asks.
// `kind` words the descriptions, and `canStart` false says the start tool is refused.
const groupTools = (kind, canStart = true) => [
  {
    name: 'list_group_sessions',
    description: `List the sessions in this ${kind} with their title, id, state, folder, branch and last activity, the ones that need the owner first. Archived sessions are counted, and listed only with include_archived.`,
    inputSchema: { type: 'object', properties: {
      include_archived: { type: 'boolean', description: 'Also list the archived sessions. Defaults to false.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'The most sessions to list. Defaults to 100.' },
    } },
  },
  {
    name: 'read_group_session',
    description: `Read the end of one session in this ${kind}: its latest messages and tool calls, and any approval it is waiting on. Use an id from list_group_sessions. A session outside this ${kind} is refused.`,
    inputSchema: { type: 'object', properties: {
      session_id: { type: 'string', description: `The id of a session in this ${kind}.` },
      items: { type: 'integer', minimum: 1, maximum: 60, description: 'How many of the latest messages and tool calls to read. Defaults to 20.' },
    }, required: ['session_id'] },
  },
  {
    name: 'github_status',
    description: 'Read the status of GitHub pull requests and issues from their addresses (https://github.com/owner/repo/pull/N or https://github.com/owner/repo/issues/N): state, review, checks, merge state, unresolved threads and the owner\'s next step. Use this instead of running gh for the status of a pull request or issue. One still being read says so: ask again shortly.',
    inputSchema: { type: 'object', properties: {
      urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MOST_LINKS, description: `The addresses of pull requests or issues, at most ${MOST_LINKS}.` },
    }, required: ['urls'] },
  },
  {
    name: 'start_group_session',
    description: canStart
      ? `Start a new session${kind === 'group' ? ' in this group' : ' from this section'}, in the folder you give, with the first message you give. The owner is asked to approve every start. Use the folder the work belongs in, such as one of the ${kind}'s sessions works in.`
      : `Refused in this chat: this section cannot hold a new session. Tell the owner, and suggest starting the work ${ELSEWHERE}.`,
    inputSchema: { type: 'object', properties: {
      cwd: { type: 'string', description: 'Absolute folder for the new session.' },
      prompt: { type: 'string', description: 'The first message for the new session. It must stand alone.' },
      title: { type: 'string', description: 'A short title, under 120 characters.' },
    }, required: ['cwd', 'prompt'] },
  },
];

const GROUP_TOOLS = groupTools('group');

// Listed to every chat that is given `ctx.subs`, and reaches any session in it. It makes another session act, so a send outside the sender's own
// tree asks every time (`inOwnTree` in lib/subs.mjs).
const SEND_TOOL = {
  name: 'send_session',
  description: 'Send a message to any other session by its id, even an idle one. The owner approves it unless it is to your parent, sub sessions or siblings. A busy session reads it before its next step. No reply is awaited: read a sub session\'s later with read_sub_session, and any other\'s shows only in its own chat. find_sessions finds an id by title. An archived session is refused until unarchive_session brings it back.',
  inputSchema: { type: 'object', properties: {
    session_id: { type: 'string', description: 'The id of the session to message. A sub session\'s id comes from list_sub_sessions.' },
    message: { type: 'string', description: 'What to tell it. It must stand alone.' },
  }, required: ['session_id', 'message'] },
};

// In a group's or section's chat the ids come from list_group_sessions, and only its members can be read back.
const groupSend = kind => ({
  ...SEND_TOOL,
  description: `Send a message to any other session by its id, even an idle one: one in this ${kind} or any other. The owner approves every send. A busy session is not interrupted and reads it before its next step. This does not wait for a reply: use read_group_session later for one in this ${kind}. Any other session's reply shows only in its own chat. Use find_sessions to look an id up by title. Archived sessions are refused: unarchive one with unarchive_session first.`,
  inputSchema: { ...SEND_TOOL.inputSchema, properties: { ...SEND_TOOL.inputSchema.properties, session_id: { type: 'string', description: `The id of the session to message. One in this ${kind} has its id in list_group_sessions.` } } },
});

// Listed to every chat that is given `ctx.subs`, a group's and a section's included. The four that write change another session's place, title or archive
// and ask, as send_session does, though a rename or move within an ordinary chat's own tree does not. The two that read run without a card and give
// titles, states and chip records, never a transcript.
const IN_TREE_ASKS = 'The owner approves it unless it is this session, your parent, a sibling or a session below this one.';
const LAYOUT_WRITES = [
  {
    name: 'archive_session',
    description: 'Archive a session by its id, which closes its chat and takes it out of the sidebar\'s lists. The owner approves every call. Refused for this session itself, for a group\'s or section\'s own chat, and for a session that is running a turn or waiting for the owner. An archived session is brought back with unarchive_session.',
    inputSchema: { type: 'object', properties: { session_id: { type: 'string', description: 'The id of the session to archive. find_sessions looks one up by title.' } }, required: ['session_id'] },
  },
  {
    name: 'unarchive_session',
    description: 'Bring an archived session back to its place in the sidebar, by its id, so send_session can reach it. The owner approves every call. Refused for a group\'s or section\'s own chat.',
    inputSchema: { type: 'object', properties: { session_id: { type: 'string', description: 'The id of the archived session. find_sessions lists archived ones by default.' } }, required: ['session_id'] },
  },
  {
    name: 'set_session_title',
    description: `Set the title GhostShell shows for a session, this one included. ${IN_TREE_ASKS} The title shows in GhostShell only, up to 120 characters. Refused for a group's or section's own chat.`,
    inputSchema: { type: 'object', properties: {
      session_id: { type: 'string', description: 'The id of the session to rename. Its own id renames this session.' },
      title: { type: 'string', description: 'The new title, on one line.' },
    }, required: ['session_id', 'title'] },
  },
  {
    name: 'move_session_to_group',
    description: `Move a session into a group, by the group's name as the sidebar shows it or by its id. ${IN_TREE_ASKS} The session leaves Pinned and any session it was nested under. A name that matches no group, or two, is refused with the names. Refused for a group's or section's own chat.`,
    inputSchema: { type: 'object', properties: {
      session_id: { type: 'string', description: 'The id of the session to move.' },
      group: { type: 'string', description: 'The name of the group, such as Reviewing, matched without regard to case, or its id.' },
    }, required: ['session_id', 'group'] },
  },
];

const LAYOUT_READS = [
  {
    name: 'list_chips',
    description: 'List the chips made with spawn_task, newest first: each with its task id, title, status (open, started or dismissed), the session it started, the session that made it and when. Use it to find which session a chip started.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Part of the chip\'s title, matched without regard to case.' },
      status: { type: 'string', enum: CHIP_STATUSES, description: 'Only chips with this status.' },
      session_id: { type: 'string', description: 'Only chips made by this session.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'The most chips to list. Defaults to 50.' },
    } },
  },
  {
    name: 'find_sessions',
    description: 'Find any session on this Mac by part of its title, matched without regard to case, the latest first. Each line has its title, id, state, folder, branch, last activity and group, and says if it is archived or a group\'s or section\'s own chat. It gives no transcript. Use the id with send_session or the tools that archive, rename or move a session.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Part of the title to look for.' },
      include_archived: { type: 'boolean', description: 'Defaults to true, since the session you want is often archived. Pass false to leave archived sessions out.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'The most sessions to list. Defaults to 100.' },
    }, required: ['query'] },
  },
];

const LAYOUT_TOOLS = [...LAYOUT_READS, ...LAYOUT_WRITES];
// A group's or section's chat has no tree, so each of its writes asks.
const GROUP_LAYOUT_TOOLS = [...LAYOUT_READS, ...LAYOUT_WRITES.map(t => ({ ...t, description: t.description.replace(IN_TREE_ASKS, 'The owner approves every call.') }))];

// Listed to an ordinary chat that is given `ctx.subs`, never to a group's, and answered there alone. The two that read are allowed without asking and reach
// sub sessions alone.
const SUB_TOOLS = [
  {
    name: 'list_sub_sessions',
    description: 'List the sub sessions under this session, at every level, as a tree. A sub session is one nested under this one, such as one started from a chip you suggested. Each line has its title, id, state, folder, branch, last activity and the first sentence of its latest reply, the ones that need the owner first. Archived ones are listed only with include_archived.',
    inputSchema: { type: 'object', properties: {
      include_archived: { type: 'boolean', description: 'Also list the archived sub sessions. Defaults to false.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'The most sub sessions to list. Defaults to 100.' },
    } },
  },
  {
    name: 'read_sub_session',
    description: 'Read the end of one sub session of this session, at any depth: its latest messages and tool calls, and any approval it is waiting on. Use an id from list_sub_sessions. Any other session is refused.',
    inputSchema: { type: 'object', properties: {
      session_id: { type: 'string', description: 'The id of a sub session of this session.' },
      items: { type: 'integer', minimum: 1, maximum: 60, description: 'How many of the latest messages and tool calls to read. Defaults to 20.' },
    }, required: ['session_id'] },
  },
  SEND_TOOL,
];

// In a group chat spawn_task names its folder, for the same reason. In the chat of a section that cannot hold a new session it is refused.
const forGroup = (tools, canStart) => tools.map(t => (t.name !== 'spawn_task' ? t : {
  ...t,
  description: canStart ? t.description : `Refused in this chat: this section cannot hold a new session, so no chip can start one. Tell the owner, and suggest starting the work ${ELSEWHERE}.`,
  inputSchema: {
    ...t.inputSchema,
    properties: {
      ...t.inputSchema.properties,
      cwd: { type: 'string', description: 'Absolute folder for the new session. Required here, as this session has no folder of its own to default to.' },
      group: { type: 'string', description: 'The name of a group as the sidebar shows it, such as Reviewing, or its id. The new session opens in that group. Leave it out to place it as this chat places the sessions it starts.' },
    },
    required: [...t.inputSchema.required, 'cwd'],
  },
}));

const FOR_GROUP = forGroup(TOOLS, true);

// The tools of a group's chat, or of the chat of one of the built-in sections, whose `section` says whether it can hold a new session. `sessions` adds
// send_session and the tools that find, archive, rename and move sessions.
function toolsInGroup({ section }, sessions) {
  const tools = section ? [...forGroup(TOOLS, !!section.place), ...groupTools('section', !!section.place)] : [...FOR_GROUP, ...GROUP_TOOLS];
  return sessions ? [...tools, groupSend(section ? 'section' : 'group'), ...GROUP_LAYOUT_TOOLS] : tools;
}

const toolName = name => `mcp__${SERVER}__${name}`;
export const TOOL_NAMES = TOOLS.map(t => toolName(t.name));
export const GROUP_READ_NAMES = GROUP_TOOLS.filter(t => t.name !== 'start_group_session').map(t => toolName(t.name));
export const GROUP_START_NAME = toolName('start_group_session');
export const SEND_NAME = toolName('send_session');
export const SUB_READ_NAMES = SUB_TOOLS.map(t => toolName(t.name)).filter(name => name !== SEND_NAME);
export const LAYOUT_WRITE_NAMES = LAYOUT_WRITES.map(t => toolName(t.name));
// The writes that go without a card when the target is in the caller's own tree. Archiving and unarchiving ask for every target.
export const TREE_WRITE_NAMES = ['set_session_title', 'move_session_to_group'].map(toolName);
export const LAYOUT_READ_NAMES = LAYOUT_READS.map(t => toolName(t.name));
// The card's one line for a write of the layout, from the tool's full name.
export const layoutWriteSummary = (tool, input, subs, groups, own) => layoutSummary(tool.slice(toolName('').length), input, subs, groups, own);

export function makeChips(stateDir) {
  const file = path.join(stateDir, 'chips.json');
  let chips = {};
  try { chips = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  // chips.json decides where sessions nest, and a cut-off write would load as no chips and be written over on the next put.
  const save = () => {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(chips));
    fs.renameSync(temp, file);
  };
  return {
    list: () => Object.values(chips),
    // Keyed by the tool_use id, so a chip in any transcript, Desktop's included, can be looked up from the chat.
    forSession: sessionId => Object.values(chips).filter(c => c.sessionId === sessionId),
    get: toolUseId => chips[toolUseId] || null,
    put(chip) { chips[chip.toolUseId] = { ...chips[chip.toolUseId], ...chip }; save(); return chips[chip.toolUseId]; },
    byTaskId: taskId => Object.values(chips).find(c => c.id === taskId) || null,
    // Each session a chip started, mapped to the session that made the chip, for the list to nest it there.
    links: () => new Map(Object.values(chips).filter(c => c.status === 'started' && c.startedId && c.sessionId).map(c => [c.startedId, c.sessionId])),
    // The title the parent gave each started session in spawn_task.
    titles: () => new Map(Object.values(chips).filter(c => c.status === 'started' && c.startedId && typeof c.title === 'string' && c.title.trim()).map(c => [c.startedId, c.title])),
  };
}

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

// Read when asked for, so an edit to the guide shows in the next chat without a restart.
const GUIDE = new URL('./widget-guide.md', import.meta.url);

function widgetGuide() {
  try {
    return text(fs.readFileSync(GUIDE, 'utf8'));
  } catch (err) {
    return text(`The widget guide could not be read (${err.code || 'error'}). Write the widget from the show_widget description, and keep it a small fragment.`, true);
  }
}

const GROUP_CALLS = { list_group_sessions: listGroupSessions, read_group_session: readGroupSession, github_status: githubStatus, start_group_session: startGroupSession };

const SUB_CALLS = { list_sub_sessions: listSubSessions, read_sub_session: readSubSession };

// Every chat given `ctx.subs` sends the same way. A group's or section's reply points at the members it can read back.
const SEND_CALLS = { send_session: (args, { subs, group }) => sendSession(args, subs, group ? groupReader(group) : null) };

// Every chat given `ctx.subs` finds sessions and chips and changes the layout the same way. The writes are held for the owner's card by the runner.
const LAYOUT_CALLS = {
  list_chips: (args, { chips }) => listChips(args, chips),
  find_sessions: (args, { subs, groups }) => findSessions(args, subs, groups?.() ?? []),
  archive_session: (args, { subs }) => archiveSession(args, subs),
  unarchive_session: (args, { subs }) => unarchiveSession(args, subs),
  set_session_title: (args, { subs }) => setSessionTitle(args, subs),
  move_session_to_group: (args, { subs, groups, group }) => moveSession(args, subs, groups?.() ?? [], group?.id),
};

// A refusal is worded for the model. Anything else is logged here and told as a bare failure, so no path or stack reaches the chat.
function toolFailed(name, err) {
  if (err.refusal) return text(err.message, true);
  console.error(`${name} failed: ${err.stack || err}`);
  return text(`${name} could not finish (${err.code || 'error'}).`, true);
}

// Starting a session waits on the CLI to name it, so a call can answer with a promise.
function callWith(calls, name, args, context) {
  try {
    const done = calls[name](args, context);
    return done instanceof Promise ? done.then(text, err => toolFailed(name, err)) : text(done);
  } catch (err) {
    return toolFailed(name, err);
  }
}

function callTool(name, args, ctx) {
  if (Object.hasOwn(GROUP_CALLS, name) && ctx.group) return callWith(GROUP_CALLS, name, args, ctx.group);
  if (Object.hasOwn(SUB_CALLS, name) && ctx.subs && !ctx.group) return callWith(SUB_CALLS, name, args, ctx.subs);
  if (Object.hasOwn(SEND_CALLS, name) && ctx.subs) return callWith(SEND_CALLS, name, args, ctx);
  if (Object.hasOwn(LAYOUT_CALLS, name) && ctx.subs) return callWith(LAYOUT_CALLS, name, args, ctx);
  if (name === 'spawn_task') {
    if (!args.title || !args.prompt) return text('spawn_task needs a title and a prompt.', true);
    if (args.model && (typeof args.model !== 'string' || !MODEL.test(args.model))) return text('spawn_task model must be a full model id, such as claude-sonnet-5-5.', true);
    if (args.effort && !EFFORTS.includes(args.effort)) return text(`spawn_task effort must be one of ${EFFORTS.join(', ')}.`, true);
    // A section that cannot hold a new session cannot hold a chip's either, which would be started in its place.
    if (ctx.group?.section && !ctx.group.section.place) return text(startRefusal(ctx.group.section), true);
    let group;
    if (args.group != null && !(typeof args.group === 'string' && !cleanName(args.group))) {
      if (typeof args.group !== 'string') return text('spawn_task group must be the name of a group or its id.', true);
      const picked = groupNamed(args.group, ctx.groups?.() ?? [], 'spawn_task');
      if (picked.refusal) return text(picked.refusal, true);
      ({ group } = picked);
    }
    // A group's session works in a private folder under the state folder, so a chip never defaults to it or names anything in the state folder.
    if (ctx.group && !args.cwd) return text(`spawn_task needs a cwd in a ${ctx.group.section ? 'section' : 'group'} session. Use the folder the work belongs in.`, true);
    if (ctx.group) {
      try { workFolder(args.cwd, ctx.group.stateDir); } catch (err) { return toolFailed('spawn_task', err); }
    }
    const chip = ctx.chips.put({
      id: `task_${crypto.randomBytes(4).toString('hex')}`, toolUseId: ctx.toolUseId || `chip-${crypto.randomUUID()}`, sessionId: ctx.sessionId,
      title: String(args.title).slice(0, 120), tldr: args.tldr || '', prompt: args.prompt, cwd: args.cwd || ctx.cwd, ...(args.model && { model: args.model }), ...(args.effort && { effort: args.effort }), ...(group && { group: group.id }), status: 'open', at: Date.now(),
    });
    return text(`Chip created (task_id: ${chip.id})${group ? `, to open in the group "${group.name}"` : ''}. The user sees a card with Start and Dismiss in GhostShell. Carry on with the current task.`);
  }
  if (name === 'dismiss_task') {
    const chip = ctx.chips.byTaskId(args.task_id);
    if (!chip) return text(`No chip with task_id ${args.task_id}.`, true);
    if (chip.status !== 'open') return text(`That chip was already ${chip.status}, so it was left alone.`);
    ctx.chips.put({ ...chip, status: 'dismissed', reason: args.reason || '' });
    return text('Chip withdrawn.');
  }
  if (name === 'mark_chapter') return text('Chapter marked.');
  if (name === 'widget_guide') return widgetGuide();
  if (name === 'show_widget') return text('The widget is showing in the chat.');
  return text(`GhostShell has no tool called ${name}.`, true);
}

// One JSON-RPC message from the CLI in, one reply out, or a promise of one for a call that has to wait. Notifications get the empty
// acknowledgement the CLI expects. `ctx.group` is set for the chat of a group or a built-in section alone, and is what gives it the group tools. `ctx.subs` gives
// every chat send_session, and the other chats the tools for their sub sessions too.
export function handleMcp(message, ctx) {
  const reply = result => ({ jsonrpc: '2.0', id: message.id ?? 0, result });
  if (!message.method || message.method.startsWith('notifications/')) return { jsonrpc: '2.0', result: {}, id: 0 };
  if (message.method === 'initialize') {
    return reply({ protocolVersion: message.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: SERVER, version: '0.1.0' } });
  }
  if (message.method === 'tools/list') return reply({ tools: ctx.group ? toolsInGroup(ctx.group, !!ctx.subs) : ctx.subs ? [...TOOLS, ...SUB_TOOLS, ...LAYOUT_TOOLS] : TOOLS });
  if (message.method === 'tools/call') {
    const toolUseId = message.params?._meta?.['claudecode/toolUseId'];
    const done = callTool(message.params?.name, message.params?.arguments || {}, { ...ctx, toolUseId });
    return done instanceof Promise ? done.then(reply) : reply(done);
  }
  return { jsonrpc: '2.0', id: message.id ?? 0, error: { code: -32601, message: `Method not found: ${message.method}` } };
}
