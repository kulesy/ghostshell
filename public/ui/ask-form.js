// The form Claude shows with show_form, drawn from the questions the server stored, so the page owns every control and the
// buttons that send. The answers go to Claude as the owner's next message. See docs/adr/20261124-page-draws-ask-forms.md.
import { ANSWER_MAX, answersMessage, canSend, choose, dateHint, initialAnswers, invalid, settled, skipMessage, typeOther, valueText } from './ask-form-rules.js';
import { pre } from './format.js';
import { html, useEffect, useRef, useState } from './html.js';

// A question's options and the box for an own answer. The AskUserQuestion card draws its options with this too.
export function Choices({ q, options, chosen, other, busy, max, onChoose, onOther }) {
  return html`<div class="options">${options.map((o, oi) => html`<button class="option" key=${`o${oi}`} type="button" data-q=${q} data-o=${oi} aria-pressed=${chosen.includes(oi)} disabled=${busy} onClick=${() => onChoose(oi)}>
    <strong>${o.label}</strong>${o.description ? html`<span>${o.description}</span>` : null}</button>
    ${o.preview && chosen.includes(oi) ? html`<pre class="preview">${pre(o.preview)}</pre>` : null}`)}</div>
    <input class="input other" type="text" data-q=${q} value=${other} maxlength=${max} placeholder="Or write your own answer" aria-label="Your own answer" disabled=${busy} onInput=${e => onOther(e.target.value)} />`;
}

// The answers typed into forms that are not sent yet, by tool use id. A row that is drawn again picks its answers up from here, and a form
// that is edited and unsent holds back the page's reload.
const drafts = new Map();
export const formsEdited = () => drafts.size > 0;

const Control = ({ q, qi, a, busy, change }) => {
  if (q.type === 'text') return html`<input class="input" type="text" data-q=${qi} value=${a.text} maxlength=${ANSWER_MAX} placeholder=${q.placeholder} aria-label=${q.question} disabled=${busy} onInput=${e => change({ text: e.target.value })} />`;
  if (q.type === 'date') {
    const hint = dateHint(q);
    return html`<input class="input" type="date" data-q=${qi} value=${a.text} min=${q.min} max=${q.max} aria-label=${q.question} aria-invalid=${invalid(q, a)} disabled=${busy} onInput=${e => change({ text: e.target.value })} />
      ${hint ? html`<p class="form-hint" data-invalid=${invalid(q, a)}>${invalid(q, a) ? `Pick a date from ${hint}` : hint}</p>` : null}`;
  }
  if (q.type === 'slider') {
    return html`<div class="form-slider">
      <output class="form-value" data-q=${qi}>${valueText(q, a.value)}</output>
      <input type="range" data-q=${qi} min=${q.min} max=${q.max} step=${q.step} value=${a.value} aria-label=${q.question} aria-valuetext=${valueText(q, a.value)} disabled=${busy} onInput=${e => change({ value: Number(e.target.value) })} />
      <span class="form-ends"><span>${valueText(q, q.min)}</span><span>${valueText(q, q.max)}</span></span></div>`;
  }
  return html`<${Choices} q=${qi} options=${q.options} chosen=${a.chosen} other=${a.other} busy=${busy} max=${ANSWER_MAX}
    onChoose=${o => change(pick => choose(pick, o, q.type === 'choices'))} onOther=${text => change(pick => typeOther(pick, text, q.type === 'choices'))} />`;
};

// `onForm(id, text, skipped)` sends the message and resolves true once the server has it. A failed send leaves the answers where they are.
export function AskForm({ form, onForm }) {
  const id = form.toolUseId;
  const [answers, setAnswers] = useState(() => drafts.get(id) || initialAnswers(form.questions));
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const done = settled(form);
  useEffect(() => { if (done) drafts.delete(id); }, [done]);
  if (done) {
    return html`<li class="chip-card form-card" data-status=${form.status} data-form=${id}>
      <p class="chip-kind">Form from Claude</p>
      <h4>${form.title}</h4>
      <div class="chip-actions"><span class="quiet">${form.status === 'skipped' ? 'Skipped' : 'Answered'}</span></div></li>`;
  }
  const change = (qi, edit) => setAnswers(all => {
    const next = all.map((a, n) => (n === qi ? { ...a, ...(typeof edit === 'function' ? edit(a) : edit) } : a));
    drafts.set(id, next);
    return next;
  });
  // Only the owner's own click sends. A click made by a script has isTrusted false, and the lock stops a second click while the first is sent.
  const go = skipped => async e => {
    if (!e.isTrusted || sending.current) return;
    sending.current = true;
    setBusy(true);
    const ok = await onForm(id, skipped ? skipMessage(form) : answersMessage(form, answers), skipped);
    sending.current = false;
    if (ok) drafts.delete(id);
    else setBusy(false);
  };
  return html`<li class="chip-card form-card" data-status="open" data-form=${id}>
    <p class="chip-kind">Form from Claude</p>
    <h4>${form.title}</h4>
    ${form.questions.map((q, qi) => html`<fieldset class="ask" key=${qi} data-q=${qi}>
      <legend>${q.question}${q.type === 'choices' ? html` <span class="quiet">(pick any)</span>` : null}${q.optional ? html` <span class="quiet">(optional)</span>` : null}</legend>
      <${Control} q=${q} qi=${qi} a=${answers[qi]} busy=${busy} change=${edit => change(qi, edit)} />
    </fieldset>`)}
    <div class="approval-actions">
      <button class="btn" type="button" data-form-send="answers" disabled=${busy || !canSend(form.questions, answers)} onClick=${go(false)}>Send answers</button>
      <button class="btn" data-variant="outline" type="button" data-form-send="skip" disabled=${busy} onClick=${go(true)}>Skip</button>
    </div></li>`;
}
