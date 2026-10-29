// One headless `claude -p` process per open chat, spoken to in stream-json. The session file stays the
// record of what was said; this layer adds only what the file cannot hold: streaming text, approvals and state.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { label } from './notices.mjs';
import { toolSummary } from './transcripts.mjs';
import { GROUP_READ_NAMES, GROUP_START_NAME, SERVER, SUB_READ_NAMES, SEND_NAME, TOOL_NAMES, handleMcp } from './tools.mjs';
import { inOwnTree, sendSummary } from './subs.mjs';
import { createWork } from './work.mjs';
import { remember, tidy, tidyModels } from './commands.mjs';

// Every Chrome action asks first, even ones the user's own settings already allow, so each one reaches Capcom. Bypass answers
// them without a card; the rule stays on there so a switch to a stricter mode applies at once, with no restart.
// NOTE: [15 Oct 2026] EK - The rule beats the permission mode, so Chrome asks in Bypass and Auto too. Checked on CLI 2.1.300.
const CHROME_ASK = 'mcp__claude-in-chrome';
// NOTE: [18 Oct 2026] EK - Desktop's Claude_in_Chrome id is left out here, as no chat Capcom runs can load that server (CLI 2.1.302).
// If one ever can, an allow rule or Always allow lets its Chrome actions run unasked. See docs/adr/20261015-claude-in-chrome-on-by-default.md.
const CHROME_TOOL = 'mcp__claude-in-chrome__';
const isChrome = name => typeof name === 'string' && name.startsWith(CHROME_TOOL);

// A group's chat reads its members' transcripts without a card, so text in one could steer it. These ask every time, in Bypass and Auto as well,
// so it cannot start a session, run a command, edit a file or message another session until the owner says so.
// NOTE: [23 Oct 2026] EK - An ask rule naming an mcp__capcom__ tool or a built-in one (plain "Bash" and "Bash(*)" both work) still sends a can_use_tool request
// in Bypass and Auto, with no permission_suggestions, and a subagent's call reaches Capcom too. Without the rule each runs unasked in Bypass, and Monitor,
// which runs a shell command, is not covered by the Bash rule (checked on CLI 2.1.309). Read is not asked about.
const GROUP_ASKS = [GROUP_START_NAME, SEND_NAME, 'Bash', 'Monitor', 'Write', 'Edit', 'NotebookEdit', 'SendMessage'];
// An ordinary chat's sends reach GhostShell in Bypass and Auto as well. A send makes another session act, possibly one in Bypass, and the chat reads
// sub session transcripts without asking, so text in one could steer it. The owner chose to let a send within the sender's own tree go without a card.
const askRules = ({ chrome, group, subs }) => [chrome && CHROME_ASK, ...(group ? GROUP_ASKS : subs ? [SEND_NAME] : [])].filter(Boolean);
// Chrome and what a chat asks about before every action: Always allow would keep no rule for them, so the card does not offer it.
const alwaysAsked = (tool, group) => isChrome(tool) || tool === SEND_NAME || (group && GROUP_ASKS.includes(tool));
// A group's or section's chat has no tree, so each of its sends asks. See docs/adr/20261023-roll-sub-session-status-up.md (amended 2026-10-29).
const sendsInTree = (chat, r) => !chat.group && !!chat.subs && r.tool_name === SEND_NAME && inOwnTree(chat.subs(chat.id), r.input?.session_id);

const chats = new Map();
// Told when a turn begins or ends, as { id, kind: 'start' | 'end' | 'failed', at }. It is a callback and no chat listener, because a
// listener standing on every chat would keep each one past sweep(), which stops the chats nobody listens to.
let hearTurns = null;
export const onTurn = fn => { hearTurns = fn; };
const RESULT_ERRORS = {
  error_max_turns: 'Claude hit the limit on turns for one request.',
  error_during_execution: 'The turn ended with an error.',
};
const rid = () => crypto.randomUUID();

class Chat {
  // A group's chat also has `group`, the callbacks its tools reach the group through, `instructions`, its standing instructions as text or a
  // function that gives them, and `fresh`, a function that says whether the CLI has no transcript of this session yet. Every chat may have
  // `subs`, a function that gives the callbacks its tools reach other sessions through for a session id, asked at each call since a new chat's id changes.
  // A group's chat sends with them, and any other chat reads its sub sessions with them as well.
  // Every chat has `groups`, a function that lists the groups as { id, name }, for a chip that names one.
  constructor({ id, cwd, mode, model, shownModel, effort, fast, resume, claude, chrome = true, chips, group = null, instructions = null, fresh = null, subs = null, groups = null }) {
    Object.assign(this, { id, cwd, mode, model, shownModel, effort, fast, resume, claude, chrome, chips, group, instructions, fresh, subs, groups });
    this.proc = null;
    this.state = 'idle';
    this.pending = new Map();
    this.holds = new Map();
    this.replies = new Map();
    this.events = [];
    this.seq = 0;
    this.listeners = new Set();
    this.live = '';
    this.work = createWork(cwd);
    this.lastError = '';
    this.interrupted = false;
    this.stderr = '';
    this.lastActive = Date.now();
    this.onSession = null;
    this.onFastRefused = null;
    this.turnStartedAt = 0;
    this.fastSaid = null;
    this.commands = null;
    this.models = null;
  }

  emit(type, data = {}) {
    const ev = { seq: ++this.seq, type, data };
    this.events.push(ev);
    if (this.events.length > 2000) this.events.splice(0, 500);
    for (const fn of this.listeners) fn(ev);
  }

  setState(state) {
    if (this.state === state) return;
    const was = this.state;
    this.state = state;
    if (was === 'idle') {
      this.turnStartedAt = Date.now();
      this.turned('start', this.turnStartedAt);
      this.relay(this.work.begin());
    }
    if (state === 'idle') {
      this.work.end();
      this.turned('end');
    }
    this.emit('state', { state });
  }

  // A new chat has no session id until the CLI names it, and startChat reports its first turn then.
  turned(kind, at = Date.now()) {
    if (!this.id.startsWith('new-')) hearTurns?.({ id: this.id, kind, at });
  }

  endTurn(data) {
    this.emit('turn-end', data);
    if (data.error) this.turned('failed');
  }

  relay(events) {
    for (const [type, data] of events) this.emit(type, data);
  }

  status() {
    return { state: this.state, running: !!this.proc, mode: this.mode, model: this.model, shownModel: this.shownModel, effort: this.effort, fast: this.fastSaid ?? !!this.fast, chrome: this.chrome, live: this.live, think: this.work.thought(), work: this.work.snapshot(), lastError: this.lastError, pending: [...this.pending.values()], holds: [...this.holds.values()] };
  }

  // The CLI can report fast mode off while the pick holds, as for a model that cannot take it, so the status shows a report when there is one.
  hearFast(said) {
    const was = this.fastSaid ?? !!this.fast;
    this.fastSaid = said;
    const now = said ?? !!this.fast;
    if (now !== was) this.emit('fast', { fast: now });
  }

  // NOTE: [22 Oct 2026] EK - fast_mode_state is 'on', 'off' or 'cooldown', a pause after a rate limit that ends by itself. An 'off' with the reason 'pending',
  // 'network_error' or 'unknown' can turn on later in the same process, so it settles nothing and the status shows the pick (checked on CLI 2.1.308).
  followFast(state, reason) {
    if (state !== 'on' && state !== 'cooldown' && state !== 'off') return;
    const unsettled = state === 'off' && ['pending', 'network_error', 'unknown'].includes(reason);
    this.hearFast(unsettled ? null : state !== 'off');
  }

  write(obj) {
    if (this.proc?.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  start() {
    // The CLI refuses a later switch into Bypass unless the process was launched allowing it.
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', this.mode,
      '--allow-dangerously-skip-permissions'];
    // NOTE: [23 Oct 2026] EK - --session-id names a session and its transcript with the id under -p stream-json, but it exits with "already in use"
    // when the id has a transcript, and --resume of an id with none fails with "No conversation found" (checked on CLI 2.1.309).
    // So the choice is made at each spawn from whether the transcript exists.
    if (this.fresh?.()) args.push('--session-id', this.id);
    else if (this.resume) args.push('--resume', this.id);
    if (this.model) args.push('--model', this.model);
    if (this.effort) args.push('--effort', this.effort);
    if (this.chrome) args.push('--chrome');
    const ask = askRules(this);
    if (ask.length) args.push('--settings', JSON.stringify({ permissions: { ask } }));
    // NOTE: [23 Oct 2026] EK - A group's chat can write to its own folder, so settings files there (hooks, allow rules, a model) are never loaded.
    // --settings and the user's own settings still apply with this: the ask rules hold in Bypass and Auto, and the user's model and plugins load (checked on CLI 2.1.309).
    if (this.group) args.push('--setting-sources', 'user');
    // NOTE: [23 Oct 2026] EK - The CLI saves the system prompt with the session on its first request and reuses it on every resume, whatever
    // --append-system-prompt says then (checked on CLI 2.1.309). An edit to the guide reaches new group sessions only. It is passed on every spawn anyway.
    const instructions = typeof this.instructions === 'function' ? this.instructions() : this.instructions;
    if (instructions) args.push('--append-system-prompt', instructions);
    // A group's folder is Capcom's own, so it is made again if it went, and the chat never falls back to the home folder.
    if (this.group) fs.mkdirSync(this.cwd, { recursive: true, mode: 0o700 });
    const cwd = this.cwd && fs.existsSync(this.cwd) ? this.cwd : os.homedir();
    const proc = spawn(this.claude, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.stderr = '';
    this.lastError = '';
    // The process this replaces never gets to clear its holds, because its exit is ignored once this.proc has moved on.
    this.holds.clear();
    proc.on('error', e => { this.lastError = e.message; this.emit('error', { message: e.message }); });
    proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    readline.createInterface({ input: proc.stdout }).on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m && typeof m === 'object') this.handle(m);
    });
    proc.on('exit', code => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.state !== 'idle') {
        // A turn the user stopped can end with the process and no result, which is not worth reporting either.
        if (this.interrupted) this.endTurn({ error: false, message: '' });
        else {
          this.lastError = this.stderr.trim().split('\n').pop() || `Claude stopped (exit ${code})`;
          this.endTurn({ error: true, message: this.lastError });
        }
      }
      // The flag is for the turn that was stopped. Left set after its process is gone, it would hide the next turn's error.
      this.interrupted = false;
      this.pending.clear();
      this.holds.clear();
      for (const { done } of this.replies.values()) done({ subtype: 'error', error: 'Claude stopped before it answered.', unanswered: true });
      this.replies.clear();
      this.live = '';
      this.hearFast(null);
      this.setState('idle');
      this.emit('exit', { code });
    });
    // NOTE: [22 Oct 2026] EK - The reply to initialize also lists the commands the prompt box's / menu shows and the models its model menu
    // offers (checked on CLI 2.1.307). A reply without the commands leaves this chat to the folder probe in lib/commands.mjs, which depends on the same request.
    this.request({ subtype: 'initialize', sdkMcpServers: [SERVER] }).then(reply => {
      const response = reply.subtype === 'success' ? reply.response : null;
      if (!Array.isArray(response?.commands)) return;
      this.commands = tidy(response.commands);
      this.models = tidyModels(response.models);
      remember(cwd, { commands: this.commands, models: this.models });
    });
    // NOTE: [22 Oct 2026] EK - fastMode goes in through apply_flag_settings, never --settings: a value given at spawn cannot be turned off
    // later, and without it the CLI reports sdk_opt_in_required (checked on CLI 2.1.307).
    // NOTE: [22 Oct 2026] EK - The reply carries no fast mode state, and a model that cannot take fast mode is accepted. Each turn's system/init and
    // result say fast_mode_state instead, which handle() follows. With no report the status shows off until the request is answered, then the pick (checked on CLI 2.1.307).
    // A new process starts with no report of its own.
    this.hearFast(this.fast ? false : null);
    if (this.fast) {
      // Handled as its line is read, so it falls in order with the reports around it. Only a refusal drops the pick, since no answer leaves it.
      const onReply = reply => {
        if (this.proc !== proc || reply.unanswered) return;
        if (reply.subtype !== 'error') {
          this.hearFast(null);
          return;
        }
        this.fast = false;
        this.fastSaid = null;
        // Always told, as the page may still be showing the pick.
        this.emit('fast', { fast: false });
        this.onFastRefused?.();
      };
      this.request({ subtype: 'apply_flag_settings', settings: { fastMode: true } }, undefined, { onReply });
    }
    // NOTE: [16 Oct 2026] EK - A headless CLI redacts thinking, so thinking_delta has no text. This asks for the summary. It is an
    // Agent SDK control request, not a published contract (checked on CLI 2.1.301). A CLI that ignores it works but shows no thinking.
    this.write({ type: 'control_request', request_id: rid(), request: { subtype: 'set_max_thinking_tokens', thinking_display: 'summarized' } });
  }

  respond(requestId, response) {
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  }

  // The reply to a call of Capcom's own tools, which can be a promise when the call waits on something. Once the process that asked is gone
  // nothing is written, as the next one knows no such request.
  answerMcp(requestId, reply) {
    if (!(reply instanceof Promise)) return this.respond(requestId, { mcp_response: reply });
    const proc = this.proc;
    reply.then(mcp_response => { if (this.proc === proc) this.respond(requestId, { mcp_response }); }, () => {});
  }

  // Resolves with the CLI's reply to a control request of ours, or an error reply marked `unanswered` if none comes.
  // `onReply` runs as the reply's line is read. A `.then` on the promise runs after the other lines of the same chunk.
  // The reply to a passive request is a look at the chat, so it leaves the idle clock alone.
  request(request, timeoutMs = 15_000, { passive = false, onReply } = {}) {
    return new Promise(resolve => {
      const id = rid();
      const settle = reply => { onReply?.(reply); resolve(reply); };
      const timer = setTimeout(() => { this.replies.delete(id); settle({ subtype: 'error', error: 'Claude did not answer in time.', unanswered: true }); }, timeoutMs);
      this.replies.set(id, { passive, done: reply => { clearTimeout(timer); settle(reply); } });
      this.write({ type: 'control_request', request_id: id, request });
    });
  }

  handle(m) {
    const waiting = m.type === 'control_response' ? this.replies.get(m.response?.request_id) : null;
    if (!waiting?.passive) this.lastActive = Date.now();
    if (m.type === 'control_response') {
      if (waiting) { this.replies.delete(m.response.request_id); waiting.done(m.response); }
      return;
    }
    if (m.type === 'control_request') {
      const r = m.request || {};
      if (r.subtype === 'mcp_message' && r.server_name === SERVER) {
        this.answerMcp(m.request_id, handleMcp(r.message || {}, { chips: this.chips, sessionId: this.id, cwd: this.cwd, group: this.group, groups: this.groups, subs: this.subs?.(this.id) }));
        return;
      }
      // Capcom's own tools only draw in the page, so they never need the user's say-so. Chrome is allowed the same way in Bypass.
      // The tools that read a group are allowed only in that group's own chat, and those that read sub sessions only in a chat that is no group's.
      // Starting a session is not, and always gets a card. A send gets one unless it stays in the sender's own tree.
      const bypassChrome = this.mode === 'bypassPermissions' && isChrome(r.tool_name);
      const readsGroup = !!this.group && GROUP_READ_NAMES.includes(r.tool_name);
      const readsSubs = !this.group && !!this.subs && SUB_READ_NAMES.includes(r.tool_name);
      if (r.subtype === 'can_use_tool' && (TOOL_NAMES.includes(r.tool_name) || bypassChrome || readsGroup || readsSubs || sendsInTree(this, r))) {
        this.respond(m.request_id, { behavior: 'allow', updatedInput: r.input || {} });
        return;
      }
      if (r.subtype !== 'can_use_tool') {
        this.write({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: `GhostShell does not handle ${r.subtype}` } });
        return;
      }
      const suggestions = r.permission_suggestions || [];
      // The card offers Always allow only where answer() keeps it, so never for what a chat asks about before every action.
      const toSession = r.tool_name === SEND_NAME && this.subs;
      const p = { requestId: m.request_id, tool: r.tool_name, label: r.display_name || r.tool_name, input: r.input || {},
        summary: toSession ? sendSummary(r.input, this.subs(this.id)) : toolSummary(r.tool_name, r.input, this.cwd), description: r.description || '', suggestions,
        always: suggestions.length > 0 && !alwaysAsked(r.tool_name, this.group), at: Date.now() };
      this.pending.set(p.requestId, p);
      this.setState('waiting');
      this.emit('approval', p);
      return;
    }
    if (m.type === 'system' && m.subtype === 'init') {
      if (m.session_id && m.session_id !== this.id) this.onSession?.(m.session_id);
      this.followFast(m.fast_mode_state, m.fast_mode_disabled_reason);
      this.emit('init', { sessionId: m.session_id, model: m.model });
      return;
    }
    if (m.type === 'system' && m.subtype === 'peer_message_hold') { this.hold(m); return; }
    if (m.type === 'system' && m.subtype === 'status' && m.status === 'requesting') { this.setState(this.pending.size ? 'waiting' : 'working'); return; }
    this.relay(this.work.feed(m));
    if (m.type === 'stream_event') {
      const e = m.event || {};
      if (e.type === 'message_start') this.live = '';
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        this.live += e.delta.text;
        this.emit('delta', { text: e.delta.text });
      }
      return;
    }
    if (m.type === 'assistant' || m.type === 'user') {
      if (m.type === 'assistant' && Array.isArray(m.message?.content) && m.message.content.some(b => b?.type === 'text')) this.live = '';
      this.emit('changed');
      return;
    }
    if (m.type === 'result') {
      // A turn the user stopped also ends as an error, which is not worth reporting.
      const error = !!m.is_error && !this.interrupted;
      this.interrupted = false;
      if (error) this.lastError = typeof m.result === 'string' && m.result ? m.result : RESULT_ERRORS[m.subtype] || 'The turn ended with an error.';
      this.live = '';
      this.followFast(m.fast_mode_state, m.fast_mode_disabled_reason);
      this.setState(this.pending.size ? 'waiting' : 'idle');
      this.endTurn({ error, message: error ? this.lastError : '', cost: m.total_cost_usd });
      this.emit('changed');
    }
  }

  // NOTE: [16 Oct 2026] EK - A headless chat has no way to approve a held message. No request does, and declaring the
  // peer_inbound_approval dialog in supportedDialogKinds does not get it sent (checked on CLI 2.1.301 and 2.1.302). See docs/adr/20261016-peer-messages-between-chats.md.
  hold(m) {
    // The sender chose its own name and the message id, so both are cut to size.
    const id = String(m.message_uuid || '').slice(0, 100);
    // A frame's own uuid is new on every frame, so only message_uuid can tie a hold to the frame that ends it.
    if (!id) return;
    const from = label(m.from_name || m.from, 60);
    if (m.state === 'held') {
      const held = { id, from, cause: String(m.cause || '').slice(0, 40), at: Date.now() };
      this.holds.set(id, held);
      this.emit('hold', held);
    } else if (m.state === 'released' || m.state === 'dropped') {
      this.holds.delete(id);
      this.emit('hold-ended', { id, from, state: m.state, outcome: String(m.outcome || '').slice(0, 40) });
    }
  }

  send(text, images = [], documents = []) {
    // A process told to stop still exists until it exits, but can no longer take a message, so start a fresh one.
    if (!this.proc?.stdin.writable) this.start();
    this.lastActive = Date.now();
    // With images or documents the content is a list of blocks: the images first, then the documents, then the text if there is any.
    const block = type => ({ mediaType, data }) => ({ type, source: { type: 'base64', media_type: mediaType, data } });
    const content = images.length || documents.length
      ? [...images.map(block('image')), ...documents.map(block('document')), ...(text.trim() ? [{ type: 'text', text }] : [])]
      : text;
    // Sent mid-turn, the CLI holds the message until the running tool finishes, then Claude reads it before its next step.
    this.write({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' });
    this.setState(this.pending.size ? 'waiting' : 'working');
    this.emit('sent', { text });
  }

  // A question is answered by allowing the call with the answers added to its input; allowing it unchanged
  // tells Claude the user did not answer.
  answer(requestId, decision, answers) {
    const p = this.pending.get(requestId);
    if (!p) return false;
    const response = decision === 'deny'
      ? { behavior: 'deny', message: p.tool === 'AskUserQuestion' ? 'The user skipped these questions in GhostShell.' : 'The user denied this from GhostShell.' }
      : decision === 'answer'
        ? { behavior: 'allow', updatedInput: { ...p.input, answers } }
        : { behavior: 'allow', updatedInput: p.input, ...(decision === 'always' && p.always ? { updatedPermissions: p.suggestions } : {}) };
    this.respond(requestId, response);
    this.pending.delete(requestId);
    this.lastActive = Date.now();
    this.setState(this.pending.size ? 'waiting' : 'working');
    this.emit('approval-resolved', { requestId, decision });
    return true;
  }

  interrupt() {
    if (!this.proc) return;
    // With no turn running there is no result to excuse, and a flag left set would hide the error of the next turn.
    if (this.state !== 'idle') this.interrupted = true;
    for (const id of [...this.pending.keys()]) this.answer(id, 'deny');
    this.write({ type: 'control_request', request_id: rid(), request: { subtype: 'interrupt' } });
  }

  // The mode changes only once the CLI accepts it, because Bypass decides here whether Chrome is allowed without a card.
  async setMode(mode) {
    await this.change('set_permission_mode', { mode });
    this.mode = mode;
    this.emit('mode', { mode });
  }

  // NOTE: [14 Oct 2026] EK - set_model and apply_flag_settings are the Agent SDK's control requests, not a published
  // contract; proven on CLI 2.1.299. apply_flag_settings accepts any effortLevel, so server.mjs checks the level first.
  // They apply from the next request, even mid-turn. A process told to stop picks the new value up when it restarts.
  async setModel(model) {
    await this.change('set_model', { model });
    Object.assign(this, { model, shownModel: model });
    this.emit('model', { model });
    // What the CLI said about fast mode was about the model before.
    this.hearFast(null);
  }

  async setEffort(effort) {
    await this.change('apply_flag_settings', { settings: { effortLevel: effort } });
    this.effort = effort;
    this.emit('effort', { effort });
  }

  async setFast(on) {
    await this.change('apply_flag_settings', { settings: { fastMode: on } });
    this.fast = on;
    this.fastSaid = null;
    this.emit('fast', { fast: on });
  }

  async change(subtype, body) {
    if (!this.proc?.stdin.writable) return;
    const reply = await this.request({ subtype, ...body });
    if (reply.subtype === 'error') throw new Error(reply.error || 'Claude refused that change.');
  }

  // NOTE: [22 Oct 2026] EK - get_context_usage is an Agent SDK control request, not a published contract; checked on CLI 2.1.307.
  // It runs no model turn, so nothing reaches the transcript. `summary` is quick but its split is rough, `full` counts each part.
  async contextUsage(detail) {
    if (!this.proc?.stdin.writable) return null;
    const reply = await this.request({ subtype: 'get_context_usage', detail }, detail === 'full' ? 30_000 : 5_000, { passive: true });
    return reply.subtype === 'success' && reply.response && typeof reply.response === 'object' ? reply.response : null;
  }

  stop() {
    const proc = this.proc;
    if (!proc) return;
    proc.stdin.end();
    setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGTERM'); }, 5000).unref();
  }
}

export const getChat = id => chats.get(id) || null;

export function chatFor(id, { cwd, mode, model, shownModel, effort, fast, claude, chrome, chips, group, instructions, fresh, subs, groups }) {
  let chat = chats.get(id);
  if (!chat) {
    chat = new Chat({ id, cwd, mode, model, shownModel, effort, fast, resume: true, claude, chrome, chips, group, instructions, fresh, subs, groups });
    chats.set(id, chat);
  }
  return chat;
}

// A new session has no id until the CLI's init message names it, so it waits under a temporary key.
export function startChat({ cwd, mode, model, shownModel, effort, fast, text, images, documents, claude, chrome, chips, subs, groups, timeoutMs = 60_000 }) {
  const chat = new Chat({ id: `new-${rid()}`, cwd, mode, model, shownModel, effort, fast, resume: false, claude, chrome, chips, subs, groups });
  chats.set(chat.id, chat);
  return new Promise((resolve, reject) => {
    // A start that times out is stopped and forgotten, so a slow CLI cannot become a session that nothing knows about.
    const timer = setTimeout(() => {
      chat.onSession = null;
      chats.delete(chat.id);
      chat.stop();
      reject(new Error(chat.lastError || `Claude did not start within ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    chat.onSession = sessionId => {
      clearTimeout(timer);
      chats.delete(chat.id);
      chat.id = sessionId;
      chat.resume = true;
      chat.onSession = null;
      chats.set(sessionId, chat);
      chat.turned('start', chat.turnStartedAt);
      resolve(chat);
    };
    chat.send(text, images, documents);
  });
}

export function sweep(idleMinutes) {
  const limit = idleMinutes * 60_000;
  for (const [id, chat] of chats) {
    const idle = Date.now() - chat.lastActive > limit && chat.state === 'idle' && !chat.listeners.size;
    if (idle && chat.proc) chat.stop();
    else if (idle) chats.delete(id);
  }
}

export const activeStates = () => Object.fromEntries([...chats.values()].map(c => [c.id, c.state]));
