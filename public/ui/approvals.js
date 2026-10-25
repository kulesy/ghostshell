// The cards above the prompt box: what Claude is about to do, and its multiple-choice questions.
import { chromeTool, clip, pre, toolLabel, toolSource } from './format.js';
import { useStore } from './hooks.js';
import { html, useState } from './html.js';

const CHROME_FORMS = new Map(Object.entries({
  navigate: i => ['open a page', [['URL', i.url], ['Tab', i.tabId]]],
  computer: i => [`${i.action || 'act'} on a page`, [['Action', i.action], ['Text', i.text], ['Where', (Array.isArray(i.coordinate) && i.coordinate.join(', ')) || i.ref], ['Tab', i.tabId]]],
  javascript_tool: i => ['run JavaScript in a tab', [['Script', i.text], ['Tab', i.tabId]]],
  form_input: i => ['fill in a form field', [['Field', i.ref], ['Value', i.value === undefined ? '' : String(i.value)], ['Tab', i.tabId]]],
  find: i => ['search a page', [['Looking for', i.query], ['Tab', i.tabId]]],
  file_upload: i => ['upload a file', [['Files', (i.paths || []).join('\n')], ['Field', i.ref], ['Tab', i.tabId]]],
}));

function chromeCard(tool, i) {
  const form = CHROME_FORMS.get(tool)?.(i);
  if (form) return { title: `Chrome wants to ${form[0]}`, fields: form[1] };
  return { title: `Chrome wants to use ${toolLabel(tool)}`, fields: Object.entries(i).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]) };
}

const capitalised = s => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

// Says exactly what is about to happen, so the answer is an informed one.
function cardParts(p, names, place) {
  const i = p.input || {};
  if (p.tool === 'Bash') return { title: 'Bash wants to run a command', fields: [['Command', i.command]] };
  if (p.tool === 'Edit') return { title: 'Edit wants to change', path: p.summary, diff: [i.old_string, i.new_string] };
  if (p.tool === 'Write') return { title: 'Write wants to create or replace', path: p.summary, fields: [['New content', clip(i.content)]] };
  if (p.tool === 'NotebookEdit') return { title: 'NotebookEdit wants to change', path: p.summary, fields: [['New source', clip(i.new_source)]] };
  if (p.tool === 'Read') return { title: 'Read wants to open', path: p.summary, fields: [] };
  if (p.tool === 'WebFetch') return { title: 'WebFetch wants to fetch a page', fields: [['URL', i.url], ['Asks', i.prompt]] };
  if (p.tool === 'WebSearch') return { title: 'WebSearch wants to search the web', fields: [['Query', i.query]] };
  if (p.tool === 'Agent' || p.tool === 'Task') return { title: 'Claude wants to start a subagent', fields: [['Task', i.description], ['Prompt', clip(i.prompt, 12)]] };
  if (p.tool === 'mcp__capcom__start_group_session') return { title: `Claude wants to start a session in this ${place}`, fields: [['Folder', i.cwd], ['Title', i.title], ['First message', clip(i.prompt, 12)]] };
  if (p.tool === 'SendMessage') return { title: 'Claude wants to message another session', fields: [['To', i.to], ['Message', clip(i.message, 12)]] };
  const chrome = chromeTool(p.tool);
  if (chrome !== null) return chromeCard(chrome, i);
  const mcp = p.tool?.match(/^mcp__(.+?)__(.+)$/);
  const fields = Object.entries(i).filter(([, v]) => v !== '' && v != null).slice(0, 8).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v, null, 2)]);
  return { title: mcp ? `${capitalised(toolSource(p.tool, names))} wants to use ${toolLabel(p.tool)}` : `${p.label} wants to run`, fields };
}

function Diff({ before, after }) {
  const lines = [];
  clip(before, 30).split('\n').forEach((l, n) => lines.push(n ? '\n' : null, html`<span class="del">- ${l}</span>`));
  lines.push('\n');
  clip(after, 30).split('\n').forEach((l, n) => lines.push(n ? '\n' : null, html`<span class="add">+ ${l}</span>`));
  return html`<pre class="diff">${lines}</pre>`;
}

// Resolves once the server has the answer; the card then waits for the event that takes it away.
function useDecide(p, onDecide) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision, answers) => {
    setBusy(true);
    if (!(await onDecide(p.requestId, decision, answers))) setBusy(false);
  };
  return [busy, decide];
}

// Always allow shows only where the runner says it sticks. The runner drops it for Chrome, so the page keeps no list of its own.
function ApprovalCard({ p, names, place, onDecide }) {
  const [busy, decide] = useDecide(p, onDecide);
  const c = cardParts(p, names, place);
  const fields = (c.fields || []).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return html`<article class="approval" data-id=${p.requestId}>
    <h3><span class="lamp" data-state="waiting" aria-hidden="true"></span>${c.title}</h3>
    ${c.path ? html`<p class="approval-path">${c.path}</p>` : null}
    ${fields.length ? html`<dl class="fields">${fields.map(([k, v]) => html`<dt>${k}</dt><dd><pre>${pre(v)}</pre></dd>`)}</dl>` : null}
    ${c.diff ? html`<${Diff} before=${c.diff[0]} after=${c.diff[1]} />` : null}
    ${p.description ? html`<p>${p.description}</p>` : null}
    <details><summary class="system-more">All input</summary><pre>${JSON.stringify(p.input ?? {}, null, 2)}</pre></details>
    <div class="approval-actions">
      <button class="btn" type="button" data-decision="allow" disabled=${busy} onClick=${() => decide('allow')}>Allow</button>
      ${p.always ? html`<button class="btn" data-variant="outline" type="button" data-decision="always" disabled=${busy} onClick=${() => decide('always')}>Always allow</button>` : null}
      <button class="btn" data-variant="outline" type="button" data-decision="deny" disabled=${busy} onClick=${() => decide('deny')}>Deny</button>
    </div></article>`;
}

// ---- questions: Claude's multiple-choice asks, answered with buttons ----------------------------------------

function answersFor(qs, picks) {
  const answers = {};
  qs.forEach((q, qi) => {
    const labels = picks[qi].chosen.map(oi => q.options?.[oi]?.label).filter(Boolean);
    if (picks[qi].other.trim()) labels.push(picks[qi].other.trim());
    if (labels.length) answers[q.question] = labels.join(', ');
  });
  return answers;
}

function QuestionCard({ p, onDecide }) {
  const qs = p.input?.questions || [];
  const [busy, decide] = useDecide(p, onDecide);
  const [picks, setPicks] = useState(() => qs.map(() => ({ chosen: [], other: '' })));
  const answers = answersFor(qs, picks);
  const change = (qi, fn) => setPicks(all => all.map((pick, n) => (n === qi ? fn(pick, qs[qi]) : pick)));
  const choose = (qi, o) => change(qi, (pick, q) => (q.multiSelect
    ? { ...pick, chosen: pick.chosen.includes(o) ? pick.chosen.filter(x => x !== o) : [...pick.chosen, o] }
    : { chosen: pick.chosen.includes(o) ? [] : [o], other: '' }));
  const type = (qi, other) => change(qi, (pick, q) => ({ chosen: other && !q.multiSelect ? [] : pick.chosen, other }));
  return html`<article class="approval question" data-id=${p.requestId}>
    <h3><span class="lamp" data-state="waiting" aria-hidden="true"></span>Claude is asking</h3>
    <div class="ask-body">${qs.map((q, qi) => html`<fieldset class="ask" key=${qi} data-q=${qi}>
      <legend>${q.header ? html`<span class="badge ask-head" data-variant="secondary">${q.header}</span>` : null}${q.question}${q.multiSelect ? html` <span class="quiet">(pick any)</span>` : null}</legend>
      <div class="options">${(q.options || []).map((o, oi) => html`<button class="option" key=${`o${oi}`} type="button" data-q=${qi} data-o=${oi} aria-pressed=${picks[qi].chosen.includes(oi)} disabled=${busy} onClick=${() => choose(qi, oi)}>
        <strong>${o.label}</strong>${o.description ? html`<span>${o.description}</span>` : null}</button>
        ${o.preview && picks[qi].chosen.includes(oi) ? html`<pre class="preview">${pre(o.preview)}</pre>` : null}`)}</div>
      <input class="input other" type="text" data-q=${qi} value=${picks[qi].other} placeholder="Or write your own answer" aria-label="Your own answer" onInput=${e => type(qi, e.target.value)} />
    </fieldset>`)}</div>
    <div class="approval-actions">
      <button class="btn" type="button" data-decision="answer" disabled=${busy || Object.keys(answers).length !== qs.length} onClick=${() => decide('answer', answers)}>Send answers</button>
      <button class="btn" data-variant="outline" type="button" data-decision="deny" disabled=${busy} onClick=${() => decide('deny')}>Skip</button>
    </div></article>`;
}

// `place` is what the chat's session belongs to, a group or a section, for the card that asks to start a session in it.
export function Approvals({ ctrl, place = 'group' }) {
  const pending = useStore(ctrl.store, s => s.status?.pending);
  const names = useStore(ctrl.store, s => s.session?.connectors);
  return html`<div class="approvals" id="approvals">${(pending || []).map(p => (p.tool === 'AskUserQuestion'
    ? html`<${QuestionCard} key=${p.requestId} p=${p} onDecide=${ctrl.decide} />`
    : html`<${ApprovalCard} key=${p.requestId} p=${p} names=${names} place=${place} onDecide=${ctrl.decide} />`))}</div>`;
}
