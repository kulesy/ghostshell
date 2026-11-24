// What an ask form holds and says, as rules that need no page, so node can test them. The server draws nothing: show_form's questions are
// data, and the page turns them into the form. An answer is { chosen, other, text, value }, one per question.

export const FORM_CALL = /__show_form$/;
export const isForm = i => i?.kind === 'tool' && FORM_CALL.test(i.name);

export const settled = form => form?.status === 'answered' || form?.status === 'skipped';

// Whether the thread holds a form whose record is missing or still open, so the page asks the server for the records again.
// A call that failed or was denied never made a record, and waiting for one would ask for ever.
export const waitingOnForm = (items, forms) => items.some(i => isForm(i) && i.status !== 'failed' && i.status !== 'denied' && !settled(forms.get(i.id)));

// The longest typed answer, a text answer or an own answer to a choice.
export const ANSWER_MAX = 500;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real calendar day written YYYY-MM-DD, which Feb 30 and month 13 are not.
export function isDay(value) {
  const m = DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export const dayInRange = (q, value) => isDay(value) && (!q.min || value >= q.min) && (!q.max || value <= q.max);

// The range of dates a question takes, in words, or '' when it has none.
export const dateHint = q => (q.min && q.max ? `${q.min} to ${q.max}` : q.min ? `${q.min} or later` : q.max ? `${q.max} or earlier` : '');

const decimals = n => (String(n).split('.')[1] || '').length;

// The value a slider can really rest on: a whole number of steps from its minimum, and no more than its maximum.
export function snap(q, value) {
  const steps = Math.min(Math.floor((q.max - q.min) / q.step + 1e-9), Math.max(0, Math.round((value - q.min) / q.step)));
  return Number((q.min + steps * q.step).toFixed(Math.max(decimals(q.min), decimals(q.step))));
}

export const initialAnswers = questions => questions.map(q => ({ chosen: [], other: '', text: '', value: q.type === 'slider' ? snap(q, q.start ?? q.min) : null }));

// One more option picked or put down. A single choice holds one option and drops the own answer, as the AskUserQuestion card does.
export const choose = (pick, o, multi) => (multi
  ? { ...pick, chosen: pick.chosen.includes(o) ? pick.chosen.filter(x => x !== o) : [...pick.chosen, o] }
  : { ...pick, chosen: pick.chosen.includes(o) ? [] : [o], other: '' });

// Typing an own answer to a single choice puts the picked option down.
export const typeOther = (pick, other, multi) => ({ ...pick, chosen: other && !multi ? [] : pick.chosen, other });

// A date that is typed but out of range or not a day, which keeps the form from going.
export const invalid = (q, a) => q.type === 'date' && a.text !== '' && !dayInRange(q, a.text);

export function answered(q, a) {
  if (q.type === 'choice' || q.type === 'choices') return a.chosen.length > 0 || a.other.trim() !== '';
  if (q.type === 'text') return a.text.trim() !== '';
  if (q.type === 'date') return dayInRange(q, a.text);
  return true;
}

export const canSend = (questions, answers) => questions.every((q, n) => !invalid(q, answers[n]) && (q.optional || answered(q, answers[n])));

// The slider's value with its unit, in the message and as a screen reader says it.
export const valueText = (q, value) => (q.unit ? `${value} ${q.unit}` : String(value));

// What a question's answer says in the message, or null when it has none.
function sayAnswer(q, a) {
  if (!answered(q, a)) return null;
  if (q.type === 'choice' || q.type === 'choices') return [...[...a.chosen].sort((x, y) => x - y).map(o => q.options[o].label), ...(a.other.trim() ? [a.other.trim()] : [])].join(', ');
  if (q.type === 'text') return a.text.trim();
  if (q.type === 'date') return a.text;
  return valueText(q, a.value);
}

export const answersMessage = (form, answers) => `Answers to the form "${form.title}":\n\n${form.questions
  .map((q, n) => `${n + 1}. ${q.question}\n${sayAnswer(q, answers[n]) ?? 'No answer'}`).join('\n\n')}`;

export const skipMessage = form => `Skipped the form "${form.title}".`;
