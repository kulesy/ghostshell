// The Subagents tab of a chat's side panel: the helpers the session started with the Agent tool, running ones first and the finished ones in a
// fold. A helper is not a sub session. Each is a button that opens in place to its recent steps and, once it has ended, its reply. The list
// arrives on the chat's events stream, and an open helper is read from the detail route when it opens and every few seconds while it runs.
import { md } from '../md.mjs';
import { api } from './api.js';
import { chevron, enc } from './group-status.js';
import { useClock, useStore } from './hooks.js';
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from './html.js';
import { DETAIL_POLL_MS, finishedLabel, foldMustOpen, LAMP, metaOf, movedToFinished, partsOf, pollsDetail, summaryLine, titleOf } from './subagent-rules.js';

// Lucide's bot, as the tab draws it.
export const BOT = ['M12 8V4H8', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'];

const clock = at => (Number.isFinite(at) ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '');

// The helper as the detail route has it. It is read when the card opens and again each few seconds while the helper runs, and not once it ends.
function Open({ chat, agent, active, id }) {
  const [got, setGot] = useState(null);
  const [problem, setProblem] = useState('');
  const running = pollsDetail({ open: true, active, state: agent.state });
  useEffect(() => {
    if (!active) return undefined;
    let stale = false;
    const read = () => api(`api/sessions/${enc(chat)}/subagents/${enc(agent.id)}`).then(
      reply => { if (!stale) { setGot(reply); setProblem(''); } },
      e => { if (!stale) setProblem(e.message); },
    );
    read();
    const timer = running ? setInterval(read, DETAIL_POLL_MS) : 0;
    return () => { stale = true; clearInterval(timer); };
  }, [chat, agent.id, agent.state, active, running]);
  const markup = useMemo(() => (got?.reply ? md(got.reply) : ''), [got?.reply]);
  if (!got) return html`<div class="agent-open" id=${id}>${problem ? html`<p class="status-note" role="alert">Could not load this subagent: ${problem}</p>` : html`<p class="status-note" role="status">Loading</p>`}</div>`;
  return html`<div class="agent-open" id=${id}>
    ${got.steps?.length ? html`<ol class="agent-steps" aria-label="Recent steps">${got.steps.map((step, n) => html`<li class="agent-step" data-kind=${step.kind} key=${n}>
      <time class="agent-at">${clock(step.at)}</time><span class="agent-label">${step.label}</span></li>`)}</ol>`
      : html`<p class="status-note">No steps yet.</p>`}
    ${got.reply ? html`<div class="agent-reply msg claude file-doc" tabindex="0" role="region" aria-label=${`Reply of ${titleOf(agent)}`} dangerouslySetInnerHTML=${{ __html: markup }}></div>` : null}
    ${problem ? html`<p class="status-note" role="alert">Could not refresh: ${problem}</p>` : null}
  </div>`;
}

function Card({ chat, agent, open, active, flip, focus }) {
  const body = `agent-${agent.id}`;
  const name = titleOf(agent);
  return html`<li class=${open ? 'agent open' : 'agent'} data-state=${agent.state} data-agent=${agent.id}>
    <button class="agent-card" type="button" aria-expanded=${open} aria-controls=${open ? body : null} onClick=${() => flip(agent.id)} onFocus=${() => { focus.current = agent.id; }} onBlur=${e => { if (e.currentTarget.isConnected) focus.current = null; }}>
      <span class="agent-head"><span class="badge" data-variant="outline">${agent.type || 'Agent'}</span>${chevron()}</span>
      <span class="agent-title">${name}</span>
      <span class="agent-meta">${metaOf(agent).map((part, n) => html`${n ? html`<span aria-hidden="true"> · </span>` : null}<span class=${n ? undefined : 'agent-state'}>${part}</span>`)}</span>
      ${agent.action ? html`<span class="agent-action"><span class="lamp" data-state=${LAMP[agent.state] || undefined} aria-hidden="true"></span><span class="agent-line">${agent.action}</span></span>` : null}
    </button>
    ${open ? html`<${Open} chat=${chat} agent=${agent} active=${active} id=${body} />` : null}
  </li>`;
}

function Cards({ chat, agents, shared, label }) {
  return html`<ul class="agent-list" aria-label=${label}>${agents.map(agent => html`<${Card} key=${agent.id} chat=${chat} agent=${agent} open=${!!shared.opened[agent.id]} active=${shared.active} flip=${shared.flip} focus=${shared.focus} />`)}</ul>`;
}

// `active` is whether the tab is on show, since the panel keeps its tabs mounted and a tab out of sight draws no clock and asks for nothing.
export function SubagentsTab({ ctrl, active }) {
  const agents = useStore(ctrl.store, s => s.agents);
  const [opened, setOpened] = useState({});
  const [fold, setFold] = useState(false);
  const { running, finished } = useMemo(() => partsOf(agents), [agents]);
  const root = useRef(null);
  const focus = useRef(null);
  const before = useRef(null);
  const lost = useRef(null);
  // A card that changes state moves between lists and is drawn again, so its open state is kept here by id, the fold opens for it and focus returns to its button.
  useLayoutEffect(() => {
    const moved = movedToFinished(before.current, agents);
    before.current = agents;
    if (moved.length && foldMustOpen(moved, opened, focus.current)) setFold(true);
    if (moved.includes(focus.current)) lost.current = focus.current;
  }, [agents]);
  useLayoutEffect(() => {
    if (!lost.current) return;
    const button = root.current?.querySelector(`[data-agent="${CSS.escape(lost.current)}"] .agent-card`);
    if (!button) return;
    button.focus();
    lost.current = null;
  }, [agents, fold]);
  useClock(active && running.length > 0);
  if (!agents?.length) return null;
  const shared = { opened, active, focus, flip: key => setOpened(all => ({ ...all, [key]: !all[key] })) };
  const body = `agents-finished-${ctrl.id}`;
  return html`<div class="subs agents" ref=${root}>
    <p class="subs-sum">${summaryLine(agents)}</p>
    ${running.length ? html`<section class="status-part"><h3 class="status-heading">${`Running (${running.length})`}</h3><${Cards} chat=${ctrl.id} agents=${running} shared=${shared} label="Running subagents" /></section>` : null}
    ${finished.length ? html`<section class="status-part">
      <button class="status-fold status-rest" type="button" aria-expanded=${fold} aria-controls=${fold ? body : null} onClick=${() => setFold(v => !v)}><span>${finishedLabel(finished.length)}</span>${chevron()}</button>
      ${fold ? html`<div id=${body}><${Cards} chat=${ctrl.id} agents=${finished} shared=${shared} label="Finished subagents" /></div>` : null}
    </section>` : null}
  </div>`;
}
