// Run with `npm test`. What the Routines page says and sends: a schedule in words, a fire time as the Mac's clock reads it, the list's order, the
// words for a prompt on a file, and the form's request, which sends only what changed. Also which routines the sidebar draws with no run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ago, byTitle, choices, deleteDetail, effortChoices, FIELDS, fireTime, formOf, idleWords, jitterOf, jitterWords, modelChoices, newForm, promptHint, promptSource, refusals, requestOf, routineFor, routineHash,
  routineRoute, scheduleWords, skippedWords, supportsRoutineEdits, supportsRoutineFiles, unrunRoutines, wasOf,
} from '../public/ui/routine-rules.js';

test('a server that does not set routineEdits leaves the page read-only', () => {
  assert.equal(supportsRoutineEdits({ features: { routineEdits: true } }), true);
  assert.equal(supportsRoutineEdits({ features: { groups: true } }), false);
  assert.equal(supportsRoutineEdits({}), false);
  assert.equal(supportsRoutineEdits(null), false);
});

test('only a server that sets routineFiles offers the choice of a prompt file', () => {
  assert.equal(supportsRoutineFiles({ features: { routineFiles: true } }), true);
  assert.equal(supportsRoutineFiles({ features: { routineEdits: true } }), false);
  assert.equal(supportsRoutineFiles(null), false);
});

test('the plain schedules are said in words', () => {
  const words = {
    '30 7 * * 1-5': 'Weekdays at 07:30',
    '0 9 * * *': 'Every day at 09:00',
    '0 8 * * 1': 'Mondays at 08:00',
    '0 8 * * 1,3,5': 'Mon, Wed and Fri at 08:00',
    '*/15 * * * *': 'Every 15 minutes',
    '0 * * * *': 'Every hour, on the hour',
    '0 9 1 * *': 'The 1st of each month at 09:00',
    '* * * * *': 'Every minute',
    '*/5 * * * 1-5': 'Weekdays, every 5 minutes',
    '15 * * * *': 'Every hour, at 15 minutes past',
    '0 9,17 * * *': 'Every day at 09:00 and 17:00',
    '0 9-17 * * 1-5': 'Weekdays, every hour from 09:00 to 17:00',
    '0 10 * * 0,6': 'Weekends at 10:00',
    '0 10 * * 6,7': 'Weekends at 10:00',
    '0 10 * * 0-6': 'Every day at 10:00',
    '0 7 * * 7': 'Sundays at 07:00',
    '5 6 1,15 * *': 'The 1st and 15th of each month at 06:05',
    '0 8 2,3,22 * *': 'The 2nd, 3rd and 22nd of each month at 08:00',
    '0 8 11,12,13 * *': 'The 11th, 12th and 13th of each month at 08:00',
    '  30   7 *  * 1-5 ': 'Weekdays at 07:30',
    '0 0 * * 2-4': 'Tue, Wed and Thu at 00:00',
    '0 0-23 * * *': 'Every hour from 00:00 to 23:00',
  };
  for (const [cron, said] of Object.entries(words)) assert.equal(scheduleWords(cron), said, cron);
});

test('a schedule that is not a plain shape has no words, so the page shows the cron alone', () => {
  for (const cron of ['0 9 * 6 *', '0 9 1 * 1', '*/7 * * * *', '*/90 * * * *', '0 */2 * * *', '0-30 9 * * *', '0 9 * * 8', '0 24 * * *', '60 9 * * *',
    '0 9 * *', '0 9 * * * *', '', 'nonsense', '@daily', '0 9 32 * *', '0,5,10,15,20,25,30 9 * * *']) {
    assert.equal(scheduleWords(cron), null, cron);
  }
  assert.equal(scheduleWords(undefined), null);
  assert.equal(scheduleWords(null), null);
  assert.equal(scheduleWords(30), null);
});

test('jitter is said in the units a person would use and added after the schedule', () => {
  assert.equal(jitterWords(737), '12 min 17 s');
  assert.equal(jitterWords(45), '45 s');
  assert.equal(jitterWords(60), '1 min');
  assert.equal(jitterWords(3600), '1 h');
  assert.equal(jitterWords(3725), '1 h 2 min 5 s');
  assert.equal(jitterWords(0), '');
  assert.equal(jitterWords(null), '');
  assert.equal(scheduleWords('30 7 * * 1-5', 737), 'Weekdays at 07:30, plus 12 min 17 s');
  assert.equal(scheduleWords('*/15 * * * *', 30), 'Every 15 minutes, plus 30 s');
  assert.equal(scheduleWords('30 7 * * 1-5', 0), 'Weekdays at 07:30');
  assert.equal(scheduleWords('nonsense', 737), null);
});

const NOW = Date.parse('2026-10-23T09:30:00+10:00');

test('a fire time is Today, Tomorrow, Yesterday or the weekday and date, in the clock the server wrote', () => {
  assert.equal(fireTime('2026-10-23T07:42:17+10:00', NOW), 'Today, 07:42');
  assert.equal(fireTime('2026-10-23T23:59:59+10:00', NOW), 'Today, 23:59');
  assert.equal(fireTime('2026-10-24T07:42:17+10:00', NOW), 'Tomorrow, 07:42');
  assert.equal(fireTime('2026-10-22T18:05:00+10:00', NOW), 'Yesterday, 18:05');
  assert.equal(fireTime('2026-10-30T07:42:17+10:00', NOW), 'Fri 30 Oct, 07:42');
  assert.equal(fireTime('2026-10-25T00:00:00+10:00', NOW), 'Sun 25 Oct, 00:00');
  assert.equal(fireTime('2027-01-04T09:00:00+11:00', NOW), 'Mon 4 Jan 2027, 09:00');
});

test('today is the Mac\'s today, so a reader in another zone sees the same words', () => {
  const late = Date.parse('2026-10-22T23:30:00Z');
  assert.equal(fireTime('2026-10-23T07:42:00+10:00', late), 'Today, 07:42');
  assert.equal(fireTime('2026-10-24T07:42:00+10:00', late), 'Tomorrow, 07:42');
  assert.equal(fireTime('2026-10-22T20:00:00-05:00', Date.parse('2026-10-23T03:00:00Z')), 'Today, 20:00');
  assert.equal(fireTime('2026-10-23T00:10:00Z', Date.parse('2026-10-23T23:50:00Z')), 'Today, 00:10');
});

test('a time with no offset is read in the reader\'s own day, and one that cannot be read is an empty string', () => {
  const noon = new Date(2026, 9, 23, 12, 0, 0).getTime();
  assert.equal(fireTime('2026-10-23T07:42:00', noon), 'Today, 07:42');
  assert.equal(fireTime('2026-10-24T07:42', noon), 'Tomorrow, 07:42');
  for (const bad of [null, undefined, '', 'tomorrow', 12345, '2026-10-23']) assert.equal(fireTime(bad, NOW), '');
});

test('the list goes by title, ignoring case and counting numbers as numbers, with the id breaking a tie', () => {
  const list = [
    { id: 'c', title: 'weekly report' }, { id: 'b', title: 'Check 10' }, { id: 'a', title: 'check 2' }, { id: 'e', title: 'Morning' },
    { id: 'd', title: 'Morning' }, { id: 'f', title: 'Archive' },
  ];
  assert.deepEqual(byTitle(list).map(r => r.id), ['f', 'a', 'b', 'd', 'e', 'c']);
  assert.deepEqual(list.map(r => r.id), ['c', 'b', 'a', 'e', 'd', 'f']);
  assert.deepEqual(byTitle([{ id: 'zed' }, { id: 'alpha', title: 'Mid' }]).map(r => r.id), ['alpha', 'zed']);
  assert.deepEqual(byTitle([]), []);
});

test('a delete says the runs stay and where the prompt file is, and a server without routineFiles says which file a prompt comes from', () => {
  assert.equal(deleteDetail({ file: '/state/routines/a.md' }), 'It stops running. Its earlier runs stay in the list, and its prompt file stays at /state/routines/a.md.');
  assert.equal(promptSource({ ours: true, file: '/state/routines/a.md', copyTo: null }), 'Read from and saved to /state/routines/a.md');
  assert.equal(promptSource({ ours: false, file: '/desk/a/SKILL.md', copyTo: '/state/routines/a.md' }),
    'Read from /desk/a/SKILL.md. Saving copies it to /state/routines/a.md, and the file in Claude Desktop stays as it is.');
});

test('a new form starts in the home folder, switched on, with the defaults and no jitter', () => {
  assert.deepEqual(newForm('/Users/me'), { title: '', cron: '', jitterSeconds: '0', cwd: '/Users/me', model: '', effort: '', mode: '', promptKind: 'text', file: '', prompt: '', enabled: true });
});

const ROUTINE = { id: 'morning', title: 'Morning', cron: '30 7 * * 1-5', jitterSeconds: 737, cwd: '/work', model: 'claude-opus-5-5', effort: null, mode: 'plan', enabled: false, file: '/state/routines/morning.md' };

const OWN = { file: '/state/routines/morning.md', text: 'Do it.', ours: true };
const ELSEWHERE = { file: '/Users/you/prompts/daily-scrum.md', text: 'Run the scrum.', ours: false };

test('an edit form is filled from the routine with null as Default, on the kind of prompt the routine uses', () => {
  assert.deepEqual(formOf(ROUTINE, OWN), {
    title: 'Morning', cron: '30 7 * * 1-5', jitterSeconds: '737', cwd: '/work', model: 'claude-opus-5-5', effort: '', mode: 'plan', promptKind: 'text', file: '', prompt: 'Do it.', enabled: false,
  });
  assert.equal(formOf({ ...ROUTINE, jitterSeconds: undefined }, { text: '', ours: true }).jitterSeconds, '0');
});

test('a routine on a file elsewhere opens on its path, with the file\'s text ready for a switch to GhostShell\'s own text', () => {
  const form = formOf(ROUTINE, ELSEWHERE);
  assert.equal(form.promptKind, 'file');
  assert.equal(form.file, '/Users/you/prompts/daily-scrum.md');
  assert.equal(form.prompt, 'Run the scrum.');
  assert.deepEqual(wasOf(ROUTINE, ELSEWHERE), { routine: ROUTINE, kind: 'file', file: '/Users/you/prompts/daily-scrum.md', prompt: 'Run the scrum.' });
  assert.equal(wasOf(ROUTINE, OWN).kind, 'text');
});

test('a prompt from a server that copies it on save stays a text, so a page on an older server has no file to offer', () => {
  const old = { ours: false, file: '/somewhere/SKILL.md', text: 'Old.', copyTo: '/state/routines/morning.md' };
  assert.equal(formOf(ROUTINE, old).promptKind, 'text');
  assert.equal(wasOf(ROUTINE, old).kind, 'text');
});

test('the file field is refused before the prompt text, so the first refusal gets the focus', () => {
  assert.deepEqual(FIELDS.slice(-2), ['file', 'prompt']);
  const error = Object.assign(new Error('Nothing was saved.'), { status: 400, data: { problems: { file: 'Cannot read /nope.md.' } } });
  assert.deepEqual(refusals(error), { fields: { file: 'Cannot read /nope.md.' }, first: 'file' });
});

test('a new routine sends every field, with Default as null, and the text of its prompt', () => {
  const form = { ...newForm('/work'), title: '  Morning  ', cron: '30  7 * * 1-5', prompt: 'Do it.\n' };
  assert.deepEqual(requestOf(form, null), {
    title: 'Morning', cron: '30 7 * * 1-5', jitterSeconds: 0, cwd: '/work', model: null, effort: null, mode: null, enabled: true, prompt: 'Do it.\n',
  });
});

test('a new routine on a file sends the path and no text, even if the box holds some', () => {
  const form = { ...newForm('/work'), title: 'Morning', cron: '30 7 * * 1-5', promptKind: 'file', file: '  /Users/you/prompts/daily-scrum.md ', prompt: 'left over' };
  const body = requestOf(form, null);
  assert.equal(body.file, '/Users/you/prompts/daily-scrum.md');
  assert.equal('prompt' in body, false);
});

test('an edit sends only what changed, and the prompt only when its text did', () => {
  const was = wasOf(ROUTINE, OWN);
  const form = formOf(ROUTINE, OWN);
  assert.deepEqual(requestOf(form, was), {});
  assert.deepEqual(requestOf({ ...form, title: 'Evening' }, was), { title: 'Evening' });
  assert.deepEqual(requestOf({ ...form, title: ' Morning ' }, was), {});
  assert.deepEqual(requestOf({ ...form, cron: '30   7 * * 1-5' }, was), {});
  assert.deepEqual(requestOf({ ...form, cron: '0 8 * * *', jitterSeconds: '0' }, was), { cron: '0 8 * * *', jitterSeconds: 0 });
  assert.deepEqual(requestOf({ ...form, cwd: '/other', model: '', effort: 'high', mode: '' }, was), { cwd: '/other', model: null, effort: 'high', mode: null });
  assert.deepEqual(requestOf({ ...form, enabled: true }, was), { enabled: true });
  assert.deepEqual(requestOf({ ...form, prompt: 'Do it twice.' }, was), { prompt: 'Do it twice.' });
});

test('text to text sends the prompt only when it changed, and never a file', () => {
  const was = wasOf(ROUTINE, OWN);
  const form = formOf(ROUTINE, OWN);
  assert.deepEqual(requestOf({ ...form, file: '/Users/you/ignored.md' }, was), {});
  assert.deepEqual(requestOf({ ...form, prompt: 'Changed.' }, was), { prompt: 'Changed.' });
});

test('file to file sends the path only when it changed, and never the text', () => {
  const was = wasOf(ROUTINE, ELSEWHERE);
  const form = formOf(ROUTINE, ELSEWHERE);
  assert.deepEqual(requestOf(form, was), {});
  assert.deepEqual(requestOf({ ...form, title: 'Evening' }, was), { title: 'Evening' });
  assert.deepEqual(requestOf({ ...form, prompt: 'Typed while it was hidden.' }, was), {});
  assert.deepEqual(requestOf({ ...form, file: ' /Users/you/prompts/weekly.md ' }, was), { file: '/Users/you/prompts/weekly.md' });
});

test('file to text always sends the prompt, even when the text is the file\'s own', () => {
  const was = wasOf(ROUTINE, ELSEWHERE);
  const form = { ...formOf(ROUTINE, ELSEWHERE), promptKind: 'text' };
  assert.deepEqual(requestOf(form, was), { prompt: 'Run the scrum.' });
  assert.deepEqual(requestOf({ ...form, prompt: 'Rewritten.' }, was), { prompt: 'Rewritten.' });
});

test('text to file always sends the file, even when the path is empty so the server can say why not', () => {
  const was = wasOf(ROUTINE, OWN);
  const form = { ...formOf(ROUTINE, OWN), promptKind: 'file', file: '/Users/you/prompts/daily-scrum.md' };
  assert.deepEqual(requestOf(form, was), { file: '/Users/you/prompts/daily-scrum.md' });
  assert.deepEqual(requestOf({ ...form, file: '' }, was), { file: '' });
});

test('no edit sends both a prompt and a file', () => {
  for (const [prompt, kind] of [[OWN, 'text'], [OWN, 'file'], [ELSEWHERE, 'text'], [ELSEWHERE, 'file']]) {
    const body = requestOf({ ...formOf(ROUTINE, prompt), promptKind: kind, file: '/Users/you/prompts/other.md', prompt: 'Another.' }, wasOf(ROUTINE, prompt));
    assert.equal('prompt' in body && 'file' in body, false, `${prompt.ours ? 'text' : 'file'} to ${kind}`);
  }
});

test('the hint under each choice says who edits the prompt, and what is left behind by a switch', () => {
  assert.equal(promptHint('text'), 'GhostShell keeps the text in its own folder, and you edit it here.');
  assert.equal(promptHint('text', 'text'), promptHint('text'));
  assert.equal(promptHint('text', 'file'), 'GhostShell keeps the text in its own folder, and you edit it here. The file stays as it is.');
  assert.equal(promptHint('file'), 'GhostShell reads the file at each run and never writes it, so you edit it outside GhostShell.');
  assert.equal(promptHint('file', 'file'), promptHint('file'));
  assert.equal(promptHint('file', 'text'), 'GhostShell reads the file at each run and never writes it, so you edit it outside GhostShell. GhostShell\'s own copy stays in its folder.');
});

test('a jitter is a whole number of seconds from 0 to 86399, and empty is 0', () => {
  assert.equal(jitterOf('737'), 737);
  assert.equal(jitterOf(' 12 '), 12);
  assert.equal(jitterOf(''), 0);
  assert.equal(jitterOf('86399'), 86399);
  for (const bad of ['86400', '-1', '1.5', 'abc', '1e3', '0x10']) assert.equal(jitterOf(bad), null, bad);
});

test('a refusal gives each field its sentence, in the form\'s order, and ignores what the form has no field for', () => {
  const error = Object.assign(new Error('Nothing was saved.'), { status: 400, data: { problems: { prompt: 'Write the prompt.', cwd: 'No such folder.', other: 'x', title: '' } } });
  assert.deepEqual(refusals(error), { fields: { cwd: 'No such folder.', prompt: 'Write the prompt.' }, first: 'cwd' });
  assert.deepEqual(refusals(new Error('Offline')), { fields: {}, first: null });
  assert.deepEqual(refusals(null), { fields: {}, first: null });
  assert.deepEqual(refusals({ data: { problems: 'no' } }), { fields: {}, first: null });
});

test('each select offers Default first and keeps a value the lists do not hold', () => {
  assert.deepEqual(modelChoices('').map(([id]) => id), ['', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5[1m]']);
  assert.equal(modelChoices('')[0][1], 'Default');
  assert.deepEqual(modelChoices('claude-opus-5-5[1m]').length, 6);
  const odd = modelChoices('claude-opus-4-8');
  assert.deepEqual(odd.at(-1), ['claude-opus-4-8', 'Opus 4.8']);
  assert.deepEqual(effortChoices(null).map(([id]) => id), ['', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(effortChoices('turbo').at(-1), ['turbo', 'turbo']);
  assert.deepEqual(choices([['a', 'A']], 'b', id => id.toUpperCase()), [['', 'Default'], ['a', 'A'], ['b', 'B']]);
});

test('a skipped fire says which run it was and why, and nothing for a record it cannot read', () => {
  assert.equal(skippedWords({ fireAt: '2026-10-22T07:42:17+10:00', at: '2026-10-22T07:43:00+10:00', reason: 'the previous run is still working' }, NOW),
    'Skipped the run due yesterday, 07:42: the previous run is still working.');
  assert.equal(skippedWords({ fireAt: '2026-10-30T07:42:17+10:00', reason: '5 h late, over the 12 h limit' }, NOW), 'Skipped the run due Fri 30 Oct, 07:42: 5 h late, over the 12 h limit.');
  assert.equal(skippedWords({ reason: 'busy' }, NOW), 'Skipped the run: busy.');
  for (const bad of [null, undefined, 'yes', { fireAt: '2026-10-22T07:42:17+10:00' }, 5]) assert.equal(skippedWords(bad, NOW), '', String(bad));
});

test('the routes are the list, the add form and a routine\'s form, and anything odd under #/routines is the list', () => {
  assert.deepEqual(routineRoute('#/routines'), { form: false, id: null });
  assert.deepEqual(routineRoute('#/routines/new'), { form: true, id: null });
  assert.deepEqual(routineRoute('#/routines/morning-check'), { form: true, id: 'morning-check' });
  assert.deepEqual(routineRoute('#/routines/'), { form: false, id: null });
  assert.deepEqual(routineRoute('#/routines/a%20b'), { form: false, id: null });
  assert.deepEqual(routineRoute('#/routines/%E0%A4%A'), { form: false, id: null });
  assert.deepEqual(routineRoute('#/routines/a/b'), { form: false, id: null });
  for (const other of ['#/', '#/new', '#/passkeys', '#/s/abc', '#/routinesx', '']) assert.equal(routineRoute(other), null, other);
});

test('a routine whose id is new is still reached by its own address and not the add form\'s', () => {
  assert.equal(routineHash('morning'), '#/routines/morning');
  assert.equal(routineHash('new'), '#/routines/%6Eew');
  assert.deepEqual(routineRoute(routineHash('new')), { form: true, id: 'new' });
  assert.deepEqual(routineRoute('#/routines/new'), { form: true, id: null });
  for (const id of ['morning', 'a-b_c', 'new', 'newer']) assert.deepEqual(routineRoute(routineHash(id)), { form: true, id });
});

test('only the latest run of a routine that routines.json holds has a routine, and an earlier run or another session has none', () => {
  const ix = { routines: [{ name: 'morning', latest: { id: 's2', routine: 'morning' }, earlier: [{ id: 's1', routine: 'morning' }] }, { name: 'gone', latest: { id: 's9', routine: 'gone' }, earlier: [] }] };
  const routines = { routines: [{ id: 'morning', title: 'Morning' }, { id: 'other', title: 'Other' }] };
  assert.equal(routineFor(ix, routines, 's2').title, 'Morning');
  assert.equal(routineFor(ix, routines, 's1'), undefined);
  assert.equal(routineFor(ix, routines, 's9'), undefined);
  assert.equal(routineFor(ix, routines, 'nope'), undefined);
  assert.equal(routineFor(ix, null, 's2'), undefined);
  assert.equal(routineFor(null, routines, 's2'), undefined);
  assert.equal(routineFor({ routines: [] }, routines, 's2'), undefined);
});

// ---- routines with no run in the sidebar ---------------------------------------------------------

const row = (id, routine = null) => ({ id, routine });
const index = (over = {}) => ({ pinned: [], groups: [], routines: [], started: [], ungrouped: [], other: [], ...over });
const MORNING = { id: 'morning', title: 'Morning', enabled: true, lastRunAt: null };
const EVENING = { id: 'evening', title: 'Evening', enabled: true, lastRunAt: null };

test('a routine with no run anywhere in the list is one the sidebar draws with no run', () => {
  const none = index();
  assert.deepEqual(unrunRoutines(none, { routines: [MORNING, EVENING] }).map(r => r.id), ['evening', 'morning']);
});

test('a routine whose run is only pinned has a row, so it is not drawn as never run', () => {
  const ix = index({ pinned: [row('s1', 'morning')] });
  assert.deepEqual(unrunRoutines(ix, { routines: [MORNING, EVENING] }).map(r => r.id), ['evening']);
});

test('a routine whose run is only in a group has a row, and so has one whose run is nested under another session', () => {
  const ix = index({ groups: [{ id: 'g', sessions: [row('s1', 'morning')] }], started: [{ id: 'host', routine: null, children: [row('s2', 'evening')] }] });
  assert.deepEqual(unrunRoutines(ix, { routines: [MORNING, EVENING] }), []);
});

test('a routine with runs among the routines, or only earlier runs, has a row', () => {
  const ix = index({ routines: [{ name: 'morning', latest: row('s2', 'morning'), earlier: [row('s1', 'morning')] }] });
  assert.deepEqual(unrunRoutines(ix, { routines: [MORNING, EVENING] }).map(r => r.id), ['evening']);
});

test('a routine whose runs were all archived has no row, and says when it last ran', () => {
  const archived = { ...MORNING, lastRunAt: '2026-10-24T07:42:00+11:00' };
  const [found] = unrunRoutines(index(), { routines: [archived] });
  assert.equal(found.lastRunAt, '2026-10-24T07:42:00+11:00');
});

test('the routines with no run come in title order and the routines given are left as they were', () => {
  const list = [{ id: 'c', title: 'weekly report' }, { id: 'a', title: 'Check 10' }, { id: 'b', title: 'check 2' }];
  assert.deepEqual(unrunRoutines(index(), { routines: list }).map(r => r.id), ['b', 'a', 'c']);
  assert.deepEqual(list.map(r => r.id), ['c', 'a', 'b']);
});

test('nothing is drawn with no run when every routine has a row, or the routines or the list have not arrived', () => {
  const ix = index({ routines: [{ name: 'morning', latest: row('s1', 'morning'), earlier: [] }, { name: 'evening', latest: row('s2', 'evening'), earlier: [] }] });
  assert.deepEqual(unrunRoutines(ix, { routines: [MORNING, EVENING] }), []);
  assert.deepEqual(unrunRoutines(ix, null), []);
  assert.deepEqual(unrunRoutines(index(), { routines: [] }), []);
  assert.deepEqual(unrunRoutines(null, { routines: [MORNING] }), []);
});

test('a run row of another kind with no routine does not hide a routine', () => {
  const ix = index({ started: [row('s1', null), row('s2', undefined)] });
  assert.deepEqual(unrunRoutines(ix, { routines: [MORNING] }).map(r => r.id), ['morning']);
});

const SUNDAY = Date.parse('2026-10-25T12:00:00+11:00');

test('a last run is said in minutes, hours and days, then by its date as the Mac wrote it', () => {
  assert.equal(ago('2026-10-25T11:59:40+11:00', SUNDAY), 'just now');
  assert.equal(ago('2026-10-25T11:48:00+11:00', SUNDAY), '12 min ago');
  assert.equal(ago('2026-10-25T09:00:00+11:00', SUNDAY), '3 h ago');
  assert.equal(ago('2026-10-24T11:00:00+11:00', SUNDAY), '1 day ago');
  assert.equal(ago('2026-10-21T12:00:00+11:00', SUNDAY), '4 days ago');
  assert.equal(ago('2026-10-12T07:42:00+11:00', SUNDAY), '12 Oct');
  assert.equal(ago('2025-10-12T07:42:00+11:00', SUNDAY), '12 Oct 2025');
  assert.equal(ago('2026-10-26T07:42:00+11:00', SUNDAY), 'just now');
  for (const bad of [null, undefined, '', 'soon', 12]) assert.equal(ago(bad, SUNDAY), '', String(bad));
});

test('the quiet part of a routine with no run says Off, when it last ran, or that it has not run yet', () => {
  assert.equal(idleWords(MORNING, SUNDAY), "Hasn't run yet");
  assert.equal(idleWords({ ...MORNING, lastRunAt: '2026-10-25T11:48:00+11:00' }, SUNDAY), 'Last run 12 min ago');
  assert.equal(idleWords({ ...MORNING, lastRunAt: '2026-10-12T07:42:00+11:00' }, SUNDAY), 'Last run 12 Oct');
  assert.equal(idleWords({ ...MORNING, enabled: false }, SUNDAY), 'Off');
  assert.equal(idleWords({ ...MORNING, enabled: false, lastRunAt: '2026-10-25T11:48:00+11:00' }, SUNDAY), 'Off');
  assert.equal(idleWords({ ...MORNING, lastRunAt: 'garbled' }, SUNDAY), "Hasn't run yet");
  const failed = { ...MORNING, lastRunAt: '2026-10-25T11:48:00+11:00', lastError: 'Cannot read /tmp/gone.md.' };
  assert.equal(idleWords(failed, SUNDAY), "Couldn't start 12 min ago");
  assert.equal(idleWords({ ...failed, lastSessionId: 'abc' }, SUNDAY), 'Last run 12 min ago');
  assert.equal(idleWords({ ...failed, enabled: false }, SUNDAY), 'Off');
});
