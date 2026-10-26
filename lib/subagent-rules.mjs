// What the helpers a session starts say about themselves, as rules that need no files, so node can test them: how a saved entry
// leaves the agent, what state that makes, how its latest step reads and the order the list shows. See
// docs/adr/20261026-subagents-in-the-side-panel.md.
import { toolSummary } from './transcripts.mjs';
import { toolLabel } from '../public/ui/format.js';

export const ACTION_CHARS = 80;
export const STEP_CHARS = 200;
const DETAIL_CHARS = 120;
const INTERRUPTED = '[Request interrupted by user';

const oneLine = (text, max) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
};

const VERBS = {
  Read: 'Read', Write: 'Wrote', Edit: 'Edited', NotebookEdit: 'Edited', Bash: 'Ran', Grep: 'Searched for', Glob: 'Listed',
  WebFetch: 'Fetched', WebSearch: 'Searched the web for', Agent: 'Started', Task: 'Started', Skill: 'Used skill',
};

// A tool call in a few words: "Read lib/work.mjs", "Ran npm test". A tool with no verb of its own is named as the page names it.
export function callLabel(name, input, cwd = '') {
  const tool = typeof name === 'string' ? name : '';
  const verb = Object.hasOwn(VERBS, tool) ? VERBS[tool] : toolLabel(tool).replace(/^./, c => c.toUpperCase());
  const detail = oneLine(toolSummary(tool, input, cwd), DETAIL_CHARS);
  return detail ? `${verb} ${detail}` : verb;
}

const blocksOf = e => (Array.isArray(e?.message?.content) ? e.message.content : []);
const isText = b => b?.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '';

// The steps an assistant entry takes, oldest first: each tool call and each piece of text, which a line holds. The CLI saves one
// entry for each block of a message, so most entries have one step.
export function stepsOf(e, cwd = '') {
  if (e?.type !== 'assistant') return [];
  const at = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
  return blocksOf(e).flatMap(b => {
    if (b?.type === 'tool_use') return [{ kind: 'tool', label: callLabel(b.name, b.input, cwd), at: Number.isNaN(at) ? null : at }];
    if (isText(b)) return [{ kind: 'text', label: oneLine(b.text, STEP_CHARS), at: Number.isNaN(at) ? null : at }];
    return [];
  });
}

// The words of the last piece of text in an assistant entry, which is the reply when the entry ends the agent.
export const replyOf = e => (e?.type === 'assistant' ? blocksOf(e).filter(isText).at(-1)?.text.trim() ?? '' : '');

// The latest step as a few words for the list.
export const actionOf = step => (step ? oneLine(step.label, ACTION_CHARS) : '');

// What one saved entry says about how the agent stands, or null for an entry that says nothing: the CLI also saves attachments,
// requests and system lines. `failed` is an API error the CLI gave up on or a reply cut off, `ended` a finished reply, `stopped` an
// interrupt, `text` a reply of text alone that carries no stop reason (older CLIs saved the last reply so), and `working` the rest.
export function howOf(e) {
  if (e?.type !== 'assistant' && e?.type !== 'user') return null;
  const at = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
  const base = { at: Number.isNaN(at) ? null : at };
  const blocks = blocksOf(e);
  if (e.type === 'assistant') {
    const why = e.message?.stop_reason;
    if (e.isApiErrorMessage === true || why === 'max_tokens' || why === 'refusal') return { ...base, how: 'failed' };
    if (why === 'end_turn' || why === 'stop_sequence') return { ...base, how: 'ended' };
    if (!why && blocks.some(isText) && !blocks.some(b => b?.type === 'tool_use')) return { ...base, how: 'text' };
    return { ...base, how: 'working' };
  }
  if (e.toolEndsTurn === true) return { ...base, how: 'ended' };
  const said = typeof e.message?.content === 'string' ? e.message.content : blocks.find(isText)?.text ?? '';
  return { ...base, how: said.trim().startsWith(INTERRUPTED) ? 'stopped' : 'working' };
}

// running, done, failed or stopped. A failure wins over `finished`, because the CLI marks an agent that died of an API error
// finished too. `quiet` is a file nobody has written to for the stale time: an agent that never ended then reads as stopped, because
// its app quit, and one whose last reply was text alone reads as done.
export function stateOf({ finished = false, how = 'working', quiet = false }) {
  if (how === 'failed') return 'failed';
  if (finished || how === 'ended') return 'done';
  if (how === 'stopped') return 'stopped';
  if (!quiet) return 'running';
  return how === 'text' ? 'done' : 'stopped';
}

// The agents that run first, the newest start first, then the ones that ended, the newest end first.
export function orderAgents(list) {
  const running = a => a.state === 'running';
  const time = a => (running(a) ? a.startedAt : a.endedAt ?? a.startedAt) ?? 0;
  return [...list].sort((a, b) => running(b) - running(a) || time(b) - time(a) || (a.id < b.id ? -1 : 1));
}

// What the page redraws from. Start and end are left out because the page ticks the time itself.
export const agentsKey = list => JSON.stringify(list.map(a => [a.id, a.state, a.action, a.type, a.description, a.model]));
