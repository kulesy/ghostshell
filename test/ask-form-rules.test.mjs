// Run with `npm test`. What an ask form holds and says is plain rules on plain data, so it runs here without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { answered, answersMessage, canSend, choose, dateHint, dayInRange, initialAnswers, invalid, isDay, isForm, settled, skipMessage, snap, typeOther, valueText, waitingOnForm } from '../public/ui/ask-form-rules.js';

const FORM = {
  title: 'Launch plan',
  questions: [
    { type: 'choice', question: 'Which region?', options: [{ label: 'Sydney' }, { label: 'Dublin' }] },
    { type: 'choices', question: 'Which checks?', options: [{ label: 'Tests' }, { label: 'Lint' }, { label: 'Types' }] },
    { type: 'text', question: 'Who signs off?' },
    { type: 'date', question: 'When?', min: '2026-12-01', max: '2026-12-31' },
    { type: 'slider', question: 'How many?', min: 0, max: 10, step: 2, start: 4, unit: 'servers' },
  ],
};

const filled = () => {
  const a = initialAnswers(FORM.questions);
  a[0] = { ...a[0], chosen: [1] };
  a[1] = { ...a[1], chosen: [2, 0], other: 'Smoke' };
  a[2] = { ...a[2], text: '  Ada  ' };
  a[3] = { ...a[3], text: '2026-12-24' };
  a[4] = { ...a[4], value: 6 };
  return a;
};

test('a form starts with nothing chosen and each slider at its start, snapped to a step', () => {
  const a = initialAnswers(FORM.questions);
  assert.deepEqual(a[0], { chosen: [], other: '', text: '', value: null });
  assert.equal(a[4].value, 4);
  assert.equal(initialAnswers([{ type: 'slider', min: 1, max: 10, step: 3, start: 6 }])[0].value, 7);
  assert.equal(initialAnswers([{ type: 'slider', min: 0, max: 1, step: 0.1, start: 0.3 }])[0].value, 0.3);
  assert.equal(initialAnswers([{ type: 'slider', min: 0, max: 10, step: 4 }])[0].value, 0, 'no start means the minimum');
  assert.equal(snap({ min: 0, max: 10, step: 4 }, 99), 8, 'the last whole step, not past the maximum');
});

test('the message lists every question with its answer, choices in option order with the own answer last', () => {
  assert.equal(answersMessage(FORM, filled()), [
    'Answers to the form "Launch plan":', '',
    '1. Which region?', 'Dublin', '',
    '2. Which checks?', 'Tests, Types, Smoke', '',
    '3. Who signs off?', 'Ada', '',
    '4. When?', '2026-12-24', '',
    '5. How many?', '6 servers',
  ].join('\n'));
});

test('a question left unanswered says No answer, and a slider without a unit says only the number', () => {
  const form = { title: 'T', questions: [{ type: 'text', question: 'Why?', optional: true }, { type: 'slider', question: 'N', min: 1, max: 5, step: 1 }] };
  assert.equal(answersMessage(form, initialAnswers(form.questions)), 'Answers to the form "T":\n\n1. Why?\nNo answer\n\n2. N\n1');
  assert.equal(valueText({ unit: 'kg' }, 3), '3 kg');
  assert.equal(valueText({}, 3), '3');
});

test('an own answer alone answers a choice, and a single choice drops it when an option is picked', () => {
  const q = FORM.questions[0];
  const typed = typeOther({ chosen: [], other: '' }, 'Perth', false);
  assert.ok(answered(q, typed));
  assert.deepEqual(choose(typed, 1, false), { chosen: [1], other: '' });
  assert.deepEqual(typeOther({ chosen: [1], other: '' }, 'Perth', false), { chosen: [], other: 'Perth' });
  assert.deepEqual(typeOther({ chosen: [1], other: '' }, 'Perth', true), { chosen: [1], other: 'Perth' });
  assert.deepEqual(choose({ chosen: [1], other: 'x' }, 1, false).chosen, [], 'picking the same option again puts it down');
  assert.deepEqual(choose({ chosen: [0], other: 'x' }, 2, true), { chosen: [0, 2], other: 'x' });
  assert.deepEqual(choose({ chosen: [0, 2], other: '' }, 0, true).chosen, [2]);
});

test('a form can be sent once every required question is answered, and an optional one may stay empty', () => {
  const a = initialAnswers(FORM.questions);
  assert.equal(canSend(FORM.questions, a), false);
  assert.equal(canSend(FORM.questions, filled()), true);
  const optional = FORM.questions.map(q => ({ ...q, optional: q.type !== 'slider' }));
  assert.equal(canSend(optional, a), true);
  const blank = filled();
  blank[2].text = '   ';
  assert.equal(canSend(FORM.questions, blank), false, 'spaces are no answer');
});

test('a date must be a real day inside its range, and one that is typed but outside it keeps the form from going', () => {
  assert.ok(isDay('2026-02-28') && isDay('2028-02-29'));
  assert.ok(!isDay('2026-02-30') && !isDay('2026-13-01') && !isDay('26-01-01') && !isDay('') && !isDay(undefined));
  const q = FORM.questions[3];
  assert.ok(dayInRange(q, '2026-12-01') && dayInRange(q, '2026-12-31'));
  assert.ok(!dayInRange(q, '2026-11-30') && !dayInRange(q, '2027-01-01'));
  assert.ok(dayInRange({}, '1999-01-01'), 'no range means any day');
  const a = filled();
  a[3].text = '2027-05-05';
  assert.equal(invalid(q, a[3]), true);
  assert.equal(canSend(FORM.questions.map(x => ({ ...x, optional: true })), a), false, 'even an optional date cannot go out of range');
  a[3].text = '';
  assert.equal(invalid(q, a[3]), false);
});

test('the range hint names whichever ends a date has', () => {
  assert.equal(dateHint({ min: '2026-01-01', max: '2026-02-01' }), '2026-01-01 to 2026-02-01');
  assert.equal(dateHint({ min: '2026-01-01' }), '2026-01-01 or later');
  assert.equal(dateHint({ max: '2026-02-01' }), '2026-02-01 or earlier');
  assert.equal(dateHint({}), '');
});

test('the skip note names the form', () => {
  assert.equal(skipMessage(FORM), 'Skipped the form "Launch plan".');
});

test('a form is settled once answered or skipped, and the page waits on one with no record or an open one', () => {
  assert.ok(settled({ status: 'answered' }) && settled({ status: 'skipped' }));
  assert.ok(!settled({ status: 'open' }) && !settled(undefined));
  const row = (id, status = 'ok') => ({ kind: 'tool', id, name: 'mcp__capcom__show_form', status });
  const records = new Map([['a', { status: 'answered' }], ['b', { status: 'open' }]]);
  assert.equal(waitingOnForm([row('a')], records), false);
  assert.equal(waitingOnForm([row('a'), row('b')], records), true, 'an open one');
  assert.equal(waitingOnForm([row('c')], records), true, 'no record yet');
  assert.equal(waitingOnForm([row('c', 'failed'), row('d', 'denied')], records), false, 'a call that failed never makes a record');
  assert.equal(waitingOnForm([{ kind: 'tool', id: 'c', name: 'Bash' }, { kind: 'assistant' }], records), false);
});

test('only the capcom or any server\'s show_form tool row is a form', () => {
  assert.ok(isForm({ kind: 'tool', name: 'mcp__capcom__show_form' }));
  assert.ok(!isForm({ kind: 'tool', name: 'mcp__capcom__show_form_later' }) && !isForm({ kind: 'tool', name: 'show_formal' }) && !isForm({ kind: 'assistant', name: 'mcp__capcom__show_form' }) && !isForm(null));
});
