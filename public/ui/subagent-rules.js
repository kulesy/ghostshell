// What the Subagents tab decides, as rules that need no page, so node can test them. An agent is as `lib/subagents.mjs` lists it, with
// `ms`, the time it has run by the server's clock, which the page turns into a start on its own clock when the event arrives.
import { duration, modelLabel } from './format.js';

export const STATE_WORD = { running: 'Running', done: 'Done', stopped: 'Stopped', failed: 'Failed' };

// The lamp each state shows. A stopped helper has no lamp colour, since nothing is happening and nothing went wrong that is known.
export const LAMP = { running: 'working', done: 'done', failed: 'failed', stopped: '' };

// How often an open helper that is still running is read again.
export const DETAIL_POLL_MS = 3000;

// A server that sends the list says so on the index. An older one has no tab to show.
export const agentsOn = features => !!features?.subagents;

// The tab is offered once the chat has had a helper, as the terminal tab is offered only where there is a terminal.
export const tabOffered = (features, agents) => agentsOn(features) && Array.isArray(agents) && agents.length > 0;

const known = list => (Array.isArray(list) ? list.filter(a => a && typeof a.id === 'string') : []);

// The list the store keeps: each running helper gets `since`, when it started by this page's clock. A later report can only move it
// earlier, so a slow one never steps the timer back, and a helper that ended keeps the time the server gave.
export function heardAgents(before, list, now = Date.now()) {
  const was = new Map((before ?? []).map(a => [a.id, a]));
  return known(list).map(a => {
    if (a.state !== 'running') return a;
    const since = now - (Number.isFinite(a.ms) ? Math.max(0, a.ms) : 0);
    const earlier = was.get(a.id);
    return { ...a, since: earlier?.state === 'running' && Number.isFinite(earlier.since) ? Math.min(earlier.since, since) : since };
  });
}

export const elapsedOf = (agent, now = Date.now()) => (agent.state === 'running' && Number.isFinite(agent.since) ? Math.max(0, now - agent.since) : Math.max(0, agent.ms || 0));

export const elapsedText = (agent, now) => duration(elapsedOf(agent, now));

// Running helpers first, the newest start first, then the finished ones, the newest end first.
export function partsOf(agents) {
  const list = known(agents);
  const running = list.filter(a => a.state === 'running').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const finished = list.filter(a => a.state !== 'running').sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0));
  return { running, finished };
}

// "2 running, 5 finished", with a part left out when it is none.
export function summaryLine(agents) {
  const { running, finished } = partsOf(agents);
  return [running.length && `${running.length} running`, finished.length && `${finished.length} finished`].filter(Boolean).join(', ');
}

// The ids that stopped running between two lists, which is when a card leaves the Running list for the Finished one.
export function movedToFinished(before, agents) {
  const was = new Set(known(before).filter(a => a.state === 'running').map(a => a.id));
  return known(agents).filter(a => a.state !== 'running' && was.has(a.id)).map(a => a.id);
}

// The Finished fold has to be open when a card that was open or had focus has just moved into it, or the card would vanish from under the user.
export const foldMustOpen = (moved, opened, focused) => moved.some(id => !!opened?.[id] || id === focused);

export const finishedLabel = n => `Finished (${n})`;

// "Sonnet 5.5" from claude-sonnet-5-5, "Haiku" from the alias, an id the page cannot read as it came, and nothing for no model.
export const modelName = model => (typeof model === 'string' ? modelLabel(model.trim()) : '');

export const titleOf = agent => agent.description || agent.type || 'Subagent';

// The facts under the title, in the order they are read: the state in words, the model and how long it has run.
export const metaOf = (agent, now) => [STATE_WORD[agent.state] ?? agent.state, modelName(agent.model), elapsedText(agent, now)].filter(Boolean);

// An open helper is read again while it runs and its tab is on show. Once it ends, or its card closes, nothing asks again.
export const pollsDetail = ({ open, active, state }) => !!open && !!active && state === 'running';
