// The forms Claude shows with show_form. The model sends questions as data and this file checks every field, so the page draws
// the form itself and no HTML from the model reaches it. A refusal is worded for the model, which can fix the call and retry.
import fs from 'node:fs';
import path from 'node:path';
import { isDay } from '../public/ui/ask-form-rules.js';

export const QUESTION_TYPES = ['choice', 'choices', 'text', 'date', 'slider'];
export const MOST_QUESTIONS = 10;
const OPTIONS = [2, 10];
const TITLE_MAX = 120;
const QUESTION_MAX = 300;
const LABEL_MAX = 120;
const DESCRIPTION_MAX = 300;
const PLACEHOLDER_MAX = 120;
const UNIT_MAX = 20;

const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.trim().length <= max;
const trimmed = v => v.trim();

function option(o, n, at) {
  if (!o || typeof o !== 'object' || !isText(o.label, LABEL_MAX)) return { error: `${at} option ${n + 1} needs a label of 1 to ${LABEL_MAX} characters.` };
  if (o.description != null && !isText(o.description, DESCRIPTION_MAX)) return { error: `${at} option "${trimmed(o.label)}" has a description that is empty or over ${DESCRIPTION_MAX} characters.` };
  return { option: { label: trimmed(o.label), ...(o.description != null && { description: trimmed(o.description) }) } };
}

function slider(q, at) {
  const { min, max } = q;
  const step = q.step ?? 1;
  const start = q.start ?? min;
  const numbers = { min, max, step, start };
  const bad = Object.keys(numbers).find(k => typeof numbers[k] !== 'number' || !Number.isFinite(numbers[k]));
  if (bad) return { error: `${at} needs ${bad} as a finite number${bad === 'min' || bad === 'max' ? ' (a slider needs min and max)' : ''}.` };
  if (min >= max) return { error: `${at} needs min below max.` };
  if (step <= 0) return { error: `${at} needs a step above 0.` };
  if (step > max - min) return { error: `${at} has a step larger than its range. Use a step of ${max - min} or less.` };
  if (start < min || start > max) return { error: `${at} has a start outside min and max. Use a start from ${min} to ${max}.` };
  if (q.unit != null && !isText(q.unit, UNIT_MAX)) return { error: `${at} has a unit that is empty or over ${UNIT_MAX} characters.` };
  return { fields: { min, max, step, start, ...(q.unit != null && { unit: trimmed(q.unit) }) } };
}

function date(q, at) {
  for (const k of ['min', 'max']) {
    if (q[k] != null && !(typeof q[k] === 'string' && isDay(q[k]))) return { error: `${at} has a ${k} that is not a real date. Write it as YYYY-MM-DD.` };
  }
  if (q.min != null && q.max != null && q.min > q.max) return { error: `${at} needs min on or before max.` };
  return { fields: { ...(q.min != null && { min: q.min }), ...(q.max != null && { max: q.max }) } };
}

function question(q, n) {
  const at = `Question ${n + 1}`;
  if (!q || typeof q !== 'object') return { error: `${at} must be an object with a type and a question.` };
  if (!QUESTION_TYPES.includes(q.type)) return { error: `${at} has the type ${JSON.stringify(q.type)}. Use one of ${QUESTION_TYPES.join(', ')}.` };
  if (!isText(q.question, QUESTION_MAX)) return { error: `${at} needs a question of 1 to ${QUESTION_MAX} characters.` };
  const name = `${at} ("${trimmed(q.question).slice(0, 40)}")`;
  if (q.optional != null && typeof q.optional !== 'boolean') return { error: `${name} has an optional that is not true or false.` };
  const base = { type: q.type, question: trimmed(q.question), ...(q.optional === true && { optional: true }) };
  if (q.type === 'choice' || q.type === 'choices') {
    if (!Array.isArray(q.options) || q.options.length < OPTIONS[0] || q.options.length > OPTIONS[1]) return { error: `${name} needs ${OPTIONS[0]} to ${OPTIONS[1]} options.` };
    const options = [];
    for (const [i, o] of q.options.entries()) {
      const read = option(o, i, name);
      if (read.error) return read;
      options.push(read.option);
    }
    const dupe = options.find((o, i) => options.findIndex(x => x.label.toLowerCase() === o.label.toLowerCase()) !== i);
    if (dupe) return { error: `${name} has the label "${dupe.label}" more than once. Give each option its own label.` };
    return { question: { ...base, options } };
  }
  if (q.type === 'text') {
    if (q.placeholder != null && !isText(q.placeholder, PLACEHOLDER_MAX)) return { error: `${name} has a placeholder that is empty or over ${PLACEHOLDER_MAX} characters.` };
    return { question: { ...base, ...(q.placeholder != null && { placeholder: trimmed(q.placeholder) }) } };
  }
  const read = q.type === 'date' ? date(q, name) : slider(q, name);
  return read.error ? read : { question: { ...base, ...read.fields } };
}

// The form to store for a show_form call, or { error } in words for the model.
export function readForm(args) {
  if (!isText(args?.title, TITLE_MAX)) return { error: `show_form needs a title of 1 to ${TITLE_MAX} characters.` };
  if (!Array.isArray(args.questions) || args.questions.length < 1 || args.questions.length > MOST_QUESTIONS) return { error: `show_form needs 1 to ${MOST_QUESTIONS} questions.` };
  const questions = [];
  for (const [n, q] of args.questions.entries()) {
    const read = question(q, n);
    if (read.error) return read;
    questions.push(read.question);
  }
  return { title: trimmed(args.title), questions };
}

export function makeForms(stateDir) {
  const file = path.join(stateDir, 'forms.json');
  let forms = {};
  try { forms = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  // A cut-off write would load as no forms, and the next put would write over the rest.
  const save = () => {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(forms));
    fs.renameSync(temp, file);
  };
  const put = form => { forms[form.toolUseId] = { ...forms[form.toolUseId], ...form }; save(); return forms[form.toolUseId]; };
  return {
    // Keyed by the tool_use id, which is how the page matches a form to the call in the chat.
    forSession: sessionId => Object.values(forms).filter(f => f.sessionId === sessionId),
    get: toolUseId => forms[toolUseId] || null,
    put,
    // Settles an open form of this session as answered or skipped, once: a second claim finds it settled and gets null.
    claim(toolUseId, sessionId, status) {
      const form = forms[toolUseId];
      return form && form.sessionId === sessionId && form.status === 'open' ? put({ toolUseId, status }) : null;
    },
    // Puts a claimed form back to open when its message was refused, so the owner can send it again.
    release: toolUseId => forms[toolUseId] && put({ toolUseId, status: 'open' }),
  };
}
