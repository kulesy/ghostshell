// Run with `npm test`. What the Scheduled sessions page and Home's Scheduled section say and send: the routes, how long until a time, the note
// under a row, which entries Home shows, the page's order, which actions an entry takes and the form's request, which sends only what changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteDetail, formOf, groupChoices, inSidebar, newForm, noteOf, ordered, refusals, requestOf, scheduledHash, scheduledRoute, statusWords, supportsScheduled, takes, untilWords,
} from '../public/ui/scheduled-rules.js';

const NOW = Date.parse('2026-10-30T10:00:00+10:00');
const entry = (extra = {}) => ({ id: 'one', title: 'One', at: '2026-10-31T09:00:00+10:00', cwd: '/work', prompt: 'Do it.', model: null, effort: null, mode: null, group: null, status: 'pending', ...extra });

test('only a server that says it has scheduled sessions shows them', () => {
  assert.equal(supportsScheduled({ features: { scheduled: true } }), true);
  assert.equal(supportsScheduled({ features: { routineEdits: true } }), false);
  assert.equal(supportsScheduled(null), false);
});

test('the routes are the list, the add form and an entry\'s form, and an entry called new is reached by its escaped id', () => {
  assert.deepEqual(scheduledRoute('#/scheduled'), { form: false, id: null });
  assert.deepEqual(scheduledRoute('#/scheduled/new'), { form: true, id: null });
  assert.deepEqual(scheduledRoute('#/scheduled/look-at-it'), { form: true, id: 'look-at-it' });
  assert.deepEqual(scheduledRoute(scheduledHash('new')), { form: true, id: 'new' });
  assert.deepEqual(scheduledRoute('#/scheduled/a%20b'), { form: false, id: null });
  assert.deepEqual(scheduledRoute('#/scheduled/%E0'), { form: false, id: null });
  assert.equal(scheduledRoute('#/routines'), null);
  assert.equal(scheduledRoute('#/scheduledx'), null);
});

test('how long until a time is a few words, and a time that has passed is due now', () => {
  const after = ms => new Date(NOW + ms).toISOString();
  assert.equal(untilWords(after(30_000), NOW), 'in under a minute');
  assert.equal(untilWords(after(12 * 60_000), NOW), 'in 12 min');
  assert.equal(untilWords(after(5 * 3600_000), NOW), 'in 5 h');
  assert.equal(untilWords(after(86_400_000), NOW), 'in 1 day');
  assert.equal(untilWords(after(3 * 86_400_000), NOW), 'in 3 days');
  assert.equal(untilWords(after(-1000), NOW), 'due now');
  assert.equal(untilWords('nonsense', NOW), '');
});

test('a row in Home says when it starts, or why it did not, and a queued retry is amber', () => {
  assert.deepEqual(noteOf(entry(), NOW), { text: 'Starts Tomorrow, 09:00', tone: null });
  assert.deepEqual(noteOf(entry({ status: 'skipped', lastError: 'It was 14 h late.' }), NOW), { text: 'Skipped: It was 14 h late.', tone: 'problem' });
  assert.deepEqual(noteOf(entry({ status: 'skipped' }), NOW), { text: 'Skipped', tone: 'problem' });
  assert.deepEqual(noteOf(entry({ problem: 'That folder is gone.' }), NOW), { text: 'That folder is gone.', tone: 'problem' });
  const retry = { fireAt: '2026-10-30T09:00:00+10:00', tries: 1, nextAt: '2026-10-30T10:10:00+10:00' };
  assert.deepEqual(noteOf(entry({ retry }), NOW), { text: 'Retrying, next try at 10:10', tone: 'warning' });
});

test('the page says the status of an entry', () => {
  assert.equal(statusWords(entry(), NOW), 'Starts in 23 h');
  assert.deepEqual(['started', 'skipped', 'cancelled'].map(status => statusWords(entry({ status }), NOW)), ['Started', 'Skipped', 'Cancelled']);
});

test('Home shows the entries still to start and the skipped ones, and not those that started or were cancelled', () => {
  const list = ['pending', 'started', 'skipped', 'cancelled'].map(status => entry({ id: status, status }));
  assert.deepEqual(inSidebar(list).map(s => s.id), ['pending', 'skipped']);
  assert.deepEqual(inSidebar(null), []);
});

test('the page lists what is still to start soonest first, then the rest latest first', () => {
  const list = [
    entry({ id: 'later', at: '2026-11-02T09:00:00+10:00' }),
    entry({ id: 'old', status: 'started', at: '2026-10-01T09:00:00+10:00' }),
    entry({ id: 'sooner', at: '2026-10-31T09:00:00+10:00' }),
    entry({ id: 'newer', status: 'skipped', at: '2026-10-20T09:00:00+10:00' }),
  ];
  assert.deepEqual(ordered(list).map(s => s.id), ['sooner', 'later', 'newer', 'old']);
});

test('only a pending entry can be started, changed or called off, and any can be deleted', () => {
  assert.deepEqual(takes(entry()), { start: true, edit: true, cancel: true });
  for (const status of ['started', 'skipped', 'cancelled']) assert.deepEqual(takes(entry({ status })), { start: false, edit: false, cancel: false });
  assert.equal(deleteDetail(entry()), 'It will not start.');
  assert.equal(deleteDetail(entry({ status: 'started', sessionId: 's1' })), 'The session it started stays in the list.');
});

test('a new form starts tomorrow at nine and the request sends every field', () => {
  const form = newForm('/Users/me', new Date(2026, 9, 30, 10).getTime());
  assert.deepEqual([form.at, form.cwd, form.group], ['2026-10-31T09:00', '/Users/me', '']);
  assert.deepEqual(requestOf({ ...form, title: ' Look ', prompt: 'Go.' }), { title: 'Look', at: '2026-10-31T09:00', cwd: '/Users/me', model: null, effort: null, mode: null, group: null, prompt: 'Go.' });
});

test('an edit sends only what changed, so a time that has passed is not checked again', () => {
  const was = entry({ at: '2026-10-01T09:00:00+10:00', group: 'cg-work' });
  const form = formOf(was);
  assert.equal(form.at, '2026-10-01T09:00');
  assert.deepEqual(requestOf(form, was), {});
  assert.deepEqual(requestOf({ ...form, title: 'Two', group: '' }, was), { title: 'Two', group: null });
  assert.deepEqual(requestOf({ ...form, at: '2026-11-05T08:30' }, was), { at: '2026-11-05T08:30' });
});

test('refused fields come back in the form\'s order with the first to focus', () => {
  const error = { data: { problems: { prompt: 'Write a prompt.', cwd: 'No such folder.', bogus: 'x' } } };
  assert.deepEqual(refusals(error), { fields: { cwd: 'No such folder.', prompt: 'Write a prompt.' }, first: 'cwd' });
  assert.deepEqual(refusals(new Error('x')), { fields: {}, first: null });
});

test('the groups offered start with none, and a group that has gone is kept as its own option', () => {
  assert.deepEqual(groupChoices([{ id: 'cg-work', name: 'Work' }], ''), [['', 'No group'], ['cg-work', 'Work']]);
  assert.deepEqual(groupChoices([], 'cg-old').at(-1), ['cg-old', 'A group that has been deleted']);
});
