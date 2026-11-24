// Run with `npm test`. show_form's questions are checked and stored by plain functions, so this runs without a server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeForms, readForm } from '../lib/forms.mjs';

const choice = { type: 'choice', question: 'Which region?', options: [{ label: 'Sydney', description: 'Close' }, { label: 'Dublin' }] };
const slider = { type: 'slider', question: 'How many?', min: 0, max: 10 };
const form = (...questions) => ({ title: 'Plan', questions });

test('a form with every question type is stored with only the fields it knows, trimmed', () => {
  const read = readForm({
    title: '  Plan ',
    junk: 1,
    questions: [
      { ...choice, extra: 'x', optional: true },
      { type: 'choices', question: 'Checks?', options: [{ label: 'Tests', description: 'Slow', icon: 'x' }, { label: ' Lint ' }] },
      { type: 'text', question: ' Who? ', placeholder: 'A name', min: 4 },
      { type: 'date', question: 'When?', min: '2026-12-01', max: '2026-12-31' },
      { ...slider, step: 2, start: 4, unit: ' kg ' },
    ],
  });
  assert.deepEqual(read, {
    title: 'Plan',
    questions: [
      { type: 'choice', question: 'Which region?', optional: true, options: [{ label: 'Sydney', description: 'Close' }, { label: 'Dublin' }] },
      { type: 'choices', question: 'Checks?', options: [{ label: 'Tests', description: 'Slow' }, { label: 'Lint' }] },
      { type: 'text', question: 'Who?', placeholder: 'A name' },
      { type: 'date', question: 'When?', min: '2026-12-01', max: '2026-12-31' },
      { type: 'slider', question: 'How many?', min: 0, max: 10, step: 2, start: 4, unit: 'kg' },
    ],
  });
});

test('a slider with no step or start steps by 1 from its minimum', () => {
  assert.deepEqual(readForm(form(slider)).questions[0], { type: 'slider', question: 'How many?', min: 0, max: 10, step: 1, start: 0 });
  assert.deepEqual(readForm(form({ ...slider, step: null, start: null, unit: null })).questions[0], { type: 'slider', question: 'How many?', min: 0, max: 10, step: 1, start: 0 });
});

const refused = (args, pattern) => {
  const read = readForm(args);
  assert.match(read.error ?? '', pattern, `${JSON.stringify(args).slice(0, 80)} was not refused as expected`);
};

test('a form is refused for a missing title or a bad number of questions, and the refusal says what to fix', () => {
  refused({ questions: [choice] }, /needs a title/);
  refused({ title: '   ', questions: [choice] }, /needs a title/);
  refused({ title: 'x'.repeat(121), questions: [choice] }, /title of 1 to 120/);
  refused({ title: 'T' }, /1 to 10 questions/);
  refused(form(), /1 to 10 questions/);
  refused(form(...Array(11).fill(choice)), /1 to 10 questions/);
  assert.ok(!readForm(form(...Array(10).fill(choice))).error, 'ten is allowed');
  refused(null, /needs a title/);
});

test('a question is refused for its type, its words or its optional flag, naming which question', () => {
  refused(form(choice, { type: 'file', question: 'Upload' }), /Question 2 has the type "file"/);
  refused(form({ type: 'text' }), /Question 1 needs a question/);
  refused(form({ type: 'text', question: 'x'.repeat(301) }), /Question 1 needs a question of 1 to 300/);
  refused(form(7), /Question 1 must be an object/);
  refused(form({ type: 'text', question: 'Why?', optional: 'yes' }), /Question 1 \("Why\?"\) has an optional that is not true or false/);
  refused(form({ type: 'text', question: 'Why?', placeholder: '' }), /placeholder/);
});

test('a choice needs 2 to 10 options with a label each and no label twice', () => {
  refused(form({ ...choice, options: [{ label: 'One' }] }), /needs 2 to 10 options/);
  refused(form({ ...choice, options: Array.from({ length: 11 }, (_, n) => ({ label: `o${n}` })) }), /needs 2 to 10 options/);
  refused(form({ ...choice, options: undefined }), /needs 2 to 10 options/);
  refused(form({ ...choice, options: [{ label: 'A' }, {}] }), /option 2 needs a label/);
  refused(form({ ...choice, options: [{ label: 'A' }, 'B'] }), /option 2 needs a label/);
  refused(form({ ...choice, options: [{ label: 'A' }, { label: 'B', description: '' }] }), /option "B" has a description/);
  refused(form({ ...choice, options: [{ label: 'A' }, { label: ' a ' }] }), /label "a" more than once/);
  refused(form({ ...choice, options: [{ label: 'A'.repeat(121) }, { label: 'B' }] }), /label of 1 to 120/);
});

test('a date needs real calendar days, and its minimum may not come after its maximum', () => {
  refused(form({ type: 'date', question: 'When?', min: '2026-02-30' }), /min that is not a real date/);
  refused(form({ type: 'date', question: 'When?', max: '12/24/2026' }), /max that is not a real date/);
  refused(form({ type: 'date', question: 'When?', min: 20261201 }), /min that is not a real date/);
  refused(form({ type: 'date', question: 'When?', min: '2026-12-02', max: '2026-12-01' }), /min on or before max/);
  assert.ok(!readForm(form({ type: 'date', question: 'When?', min: '2026-12-01', max: '2026-12-01' })).error, 'one day is allowed');
  assert.deepEqual(readForm(form({ type: 'date', question: 'When?' })).questions[0], { type: 'date', question: 'When?' });
});

test('a slider needs finite numbers, a minimum below its maximum, a positive step in the range and a start inside it', () => {
  refused(form({ type: 'slider', question: 'N' }), /needs min as a finite number/);
  refused(form({ ...slider, max: '10' }), /needs max as a finite number/);
  refused(form({ ...slider, max: Infinity }), /needs max as a finite number/);
  refused(form({ ...slider, max: NaN }), /needs max as a finite number/);
  refused(form({ ...slider, min: 10 }), /min below max/);
  refused(form({ ...slider, step: 0 }), /step above 0/);
  refused(form({ ...slider, step: -1 }), /step above 0/);
  refused(form({ ...slider, step: 'big' }), /needs step as a finite number/);
  refused(form({ ...slider, step: 11 }), /step larger than its range/);
  refused(form({ ...slider, start: -1 }), /start outside min and max/);
  refused(form({ ...slider, start: 11 }), /start outside min and max/);
  refused(form({ ...slider, unit: '' }), /unit/);
  assert.ok(!readForm(form({ ...slider, step: 10 })).error, 'a step as wide as the range is allowed');
});

test('forms are kept in forms.json, found by session and by tool use id, and survive a restart', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-forms-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const forms = makeForms(dir);
  forms.put({ toolUseId: 'a', sessionId: 's1', title: 'A', questions: [], status: 'open' });
  forms.put({ toolUseId: 'b', sessionId: 's2', title: 'B', questions: [], status: 'open' });
  assert.deepEqual(forms.forSession('s1').map(f => f.toolUseId), ['a']);
  assert.equal(forms.get('b').title, 'B');
  assert.equal(forms.get('missing'), null);
  assert.equal(makeForms(dir).get('a').sessionId, 's1', 'a restart reads forms.json');
  assert.deepEqual(fs.readdirSync(dir), ['forms.json'], 'the temp file is renamed away');
});

test('a form is claimed once, by its own session, and a release puts it back to open', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-forms-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const forms = makeForms(dir);
  forms.put({ toolUseId: 'a', sessionId: 's1', title: 'A', questions: [], status: 'open' });
  assert.equal(forms.claim('a', 's2', 'answered'), null, 'another session cannot claim it');
  assert.equal(forms.claim('nope', 's1', 'answered'), null);
  assert.equal(forms.get('a').status, 'open');
  assert.equal(forms.claim('a', 's1', 'skipped').status, 'skipped');
  assert.equal(forms.claim('a', 's1', 'answered'), null, 'a second claim finds it settled');
  assert.equal(forms.get('a').status, 'skipped');
  assert.equal(forms.release('a').status, 'open');
  assert.equal(makeForms(dir).get('a').status, 'open', 'the release is saved');
  assert.equal(forms.claim('a', 's1', 'answered').status, 'answered');
  assert.ok(!forms.release('missing'));
});
