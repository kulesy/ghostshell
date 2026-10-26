// The skills and slash commands a chat can run, for the prompt box's / list, and the models it can switch to, for its model menu. A running chat
// keeps the lists its own process gave when it started. A new session, or a chat with no process, gets a short probe of its folder.
// See docs/adr/20261022-slash-menu-from-the-cli.md and docs/adr/20261022-model-menu-from-the-cli.md.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import crypto from 'node:crypto';
import path from 'node:path';
import { modelLabel } from '../public/ui/format.js';

const DESCRIPTION_LIMIT = 200;
const KEPT_FOLDERS = 20;
// A probe is not a session, so a folder's SessionStart hooks, which would run on it, are turned off.
export const NO_HOOKS = JSON.stringify({ disableAllHooks: true });
// Both are keyed by the resolved folder, because the page sends a folder as typed and `/a/` is `/a`.
const lists = new Map();
const probes = new Map();

const squash = text => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '');

function cut(text, limit) {
  const chars = [...text];
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('').trimEnd()}…` : text;
}

// NOTE: [22 Oct 2026] EK - /clear is left out because the CLI answers it with a new conversation that Capcom's chat would not follow
// (checked on CLI 2.1.307). Names that start with __ are the CLI's own, for server-launched sessions only.
const listed = name => typeof name === 'string' && name !== '' && name !== 'clear' && !name.startsWith('__');

// The CLI's commands as the page needs them, in the CLI's order, each name once.
export function tidy(commands) {
  const seen = new Set();
  const list = [];
  for (const c of Array.isArray(commands) ? commands : []) {
    if (!listed(c?.name) || seen.has(c.name)) continue;
    seen.add(c.name);
    list.push({
      name: c.name,
      description: cut(squash(c.description), DESCRIPTION_LIMIT),
      hint: squash(c.argumentHint),
      aliases: Array.isArray(c.aliases) ? c.aliases.filter(a => typeof a === 'string' && a !== '') : [],
    });
  }
  return list;
}

// The CLI's models by full id, in its order, each id once. An alias (opus, default) adds the model it resolves to after them, named by its id,
// when no entry lists that model by id. The CLI lists the main models only by alias, so this is where their fast mode flag comes from.
export function tidyModels(models) {
  const entries = (Array.isArray(models) ? models : []).filter(m => typeof m?.value === 'string' && m.value !== '' && typeof m.resolvedModel === 'string' && m.resolvedModel !== '');
  const seen = new Set();
  const list = [];
  const add = (m, label) => {
    if (seen.has(m.resolvedModel)) return;
    seen.add(m.resolvedModel);
    list.push({ id: m.resolvedModel, label, fast: m.supportsFastMode === true });
  };
  for (const m of entries) if (m.value === m.resolvedModel) add(m, squash(m.displayName) || modelLabel(m.value));
  for (const m of entries) if (m.value !== m.resolvedModel) add(m, modelLabel(m.resolvedModel));
  return list;
}

// Keeps a folder's lists as if they had just been asked for, so a running chat's own reply refreshes them.
export function remember(cwd, { commands, models }) {
  const folder = path.resolve(cwd);
  lists.delete(folder);
  lists.set(folder, { commands, models, at: Date.now() });
  if (lists.size > KEPT_FOLDERS) lists.delete(lists.keys().next().value);
}

// NOTE: [22 Oct 2026] EK - initialize and its `commands` and `models` are the Agent SDK's control request (the one its supportedCommands()
// reads), not a published contract (checked on CLI 2.1.307). Only that is sent and hooks are off, so nothing is written, no hook runs and no
// model is called. If a CLI stops answering it, the lists say they could not load. See lib/runner.mjs, which reads the same reply.
function probe(cwd, claude, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--no-session-persistence',
      '--settings', NO_HOOKS];
    const proc = spawn(claude, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let over = false;
    const finish = (settle, value) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      settle(value);
    };
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      finish(reject, new Error('Claude did not answer in time.'));
    }, timeoutMs);
    // A write to a process that has already exited fails with EPIPE, which would crash the server unhandled. The close below says why it stopped.
    proc.stdin.on('error', () => {});
    proc.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    proc.on('error', e => finish(reject, e));
    proc.on('close', () => finish(reject, new Error(stderr.trim().split('\n').pop() || 'Claude stopped before it answered.')));
    readline.createInterface({ input: proc.stdout }).on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m?.type !== 'control_response' || m.response?.request_id !== id) return;
      const commands = m.response.subtype === 'success' ? m.response.response?.commands : null;
      if (Array.isArray(commands)) finish(resolve, { commands: tidy(commands), models: tidyModels(m.response.response.models) });
      else finish(reject, new Error(typeof m.response.error === 'string' && m.response.error ? m.response.error : 'Claude did not list its commands and models.'));
      proc.stdin.end();
      setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGTERM'); }, 5000).unref();
    });
    proc.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: id, request: { subtype: 'initialize' } })}\n`);
  });
}

// The tidied lists for a folder, kept for ttlMs. Callers that ask while a probe runs share it, and a failed probe is not kept.
function listsFor(cwd, claude, { ttlMs = 120_000, timeoutMs = 15_000 } = {}) {
  const folder = path.resolve(cwd);
  const kept = lists.get(folder);
  if (kept && Date.now() - kept.at < ttlMs) return Promise.resolve(kept);
  let asking = probes.get(folder);
  if (!asking) {
    asking = probe(folder, claude, timeoutMs)
      .then(got => { remember(folder, got); return got; })
      .finally(() => probes.delete(folder));
    probes.set(folder, asking);
  }
  return asking;
}

export const listCommands = (cwd, claude, options) => listsFor(cwd, claude, options).then(got => got.commands);
export const listModels = (cwd, claude, options) => listsFor(cwd, claude, options).then(got => got.models);
