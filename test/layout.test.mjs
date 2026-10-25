// Run with `npm test`. Capcom's own layout file: what it keeps, what it refuses to write over, and the changes it makes, nesting included.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeLayout } from '../lib/layout.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-layout-test-'));

function folder(contents) {
  const dir = fs.mkdtempSync(path.join(base, 'state-'));
  const file = path.join(dir, 'layout.json');
  if (contents !== undefined) fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return { layout: makeLayout(dir), file, onDisk: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

const OLD = { seededAt: '2026-10-15T05:44:17.563Z', groups: [{ id: 'cg-a', name: 'Reviewing' }, { id: 'cg-b', name: 'Backlog' }], pinned: ['p1'], assignments: { s1: 'cg-a', s2: 'cg-b' } };

const FIRST = '2026-10-17T09:30:00.000Z';

// A write replaces the file, so a file dated 1970 shows whether a call wrote it.
const backdate = f => fs.utimesSync(f.file, 1, 1);
const rewritten = f => fs.statSync(f.file).mtimeMs !== 1000;

test('a layout file from before projects, unarchiving and archiving loads as it was, and a missing file is an empty layout', () => {
  const { layout } = folder(OLD);
  assert.deepEqual(layout.read(), { ...OLD, projects: [], retired: [], sections: {}, unarchived: [], archived: {}, titles: {}, parents: {} });
  assert.deepEqual(folder().layout.read(), { seededAt: null, projects: [], groups: [], retired: [], sections: {}, pinned: [], assignments: {}, unarchived: [], archived: {}, titles: {}, parents: {} });
});

test('archiving records when, takes the session out of the unarchived list, and keeps everything else in the file, including keys this version does not know', () => {
  const f = folder({ ...OLD, later: { kept: true }, unarchived: ['s1', 's2'] });
  const before = Date.now();
  f.layout.archive('s1');
  const { archived } = f.onDisk();
  assert.deepEqual(Object.keys(archived), ['s1']);
  assert.equal(new Date(archived.s1).toISOString(), archived.s1);
  assert.ok(Date.parse(archived.s1) >= before && Date.parse(archived.s1) <= Date.now(), archived.s1);
  assert.deepEqual(f.onDisk(), { ...OLD, later: { kept: true }, projects: [], retired: [], sections: {}, titles: {}, parents: {}, archived, unarchived: ['s2'] });
  assert.deepEqual(f.layout.read().archived, archived);
});

test('a session that is archived already keeps its first time, and archiving it again writes nothing', () => {
  const f = folder({ ...OLD, archived: { s1: FIRST } });
  backdate(f);
  f.layout.archive('s1');
  assert.equal(rewritten(f), false);
  assert.deepEqual(f.onDisk().archived, { s1: FIRST });
  f.layout.archive('s2');
  assert.deepEqual(Object.keys(f.onDisk().archived), ['s1', 's2'], 'a second session is added beside the first');
  assert.equal(f.onDisk().archived.s1, FIRST);
});

test('unarchiving takes a session out of the archived list, adds it to the unarchived list once, and keeps everything else in the file, including keys this version does not know', () => {
  const f = folder({ ...OLD, later: { kept: true }, archived: { s1: FIRST, s2: FIRST } });
  f.layout.unarchive('s1');
  f.layout.unarchive('s1');
  f.layout.unarchive('s3');
  assert.deepEqual(f.onDisk(), { ...OLD, later: { kept: true }, projects: [], retired: [], sections: {}, titles: {}, parents: {}, archived: { s2: FIRST }, unarchived: ['s1', 's3'] });
});

test('unarchiving writes nothing when the session is unarchived already, and a session in both lists leaves the archived one', () => {
  const f = folder({ ...OLD, archived: { s2: FIRST }, unarchived: ['s1'] });
  backdate(f);
  f.layout.unarchive('s1');
  assert.equal(rewritten(f), false);
  const both = folder({ ...OLD, archived: { s1: FIRST }, unarchived: ['s1'] });
  both.layout.unarchive('s1');
  assert.deepEqual({ archived: both.onDisk().archived, unarchived: both.onDisk().unarchived }, { archived: {}, unarchived: ['s1'] });
});

test('archiving and unarchiving leave a session in its group or pin, so it comes back where it was', () => {
  const f = folder({ ...OLD, pinned: ['p1'], assignments: { s1: 'cg-a' } });
  for (const id of ['s1', 'p1']) f.layout.archive(id);
  assert.deepEqual({ pinned: f.onDisk().pinned, assignments: f.onDisk().assignments }, { pinned: ['p1'], assignments: { s1: 'cg-a' } });
  for (const id of ['s1', 'p1']) f.layout.unarchive(id);
  assert.deepEqual({ pinned: f.onDisk().pinned, assignments: f.onDisk().assignments }, { pinned: ['p1'], assignments: { s1: 'cg-a' } });
  assert.deepEqual(f.onDisk().archived, {});
});

test('the parents in a layout file load as they are, a null included, and an entry that is neither null nor a session id is dropped', () => {
  const { layout } = folder({ ...OLD, parents: { s1: 's2', s3: null, s4: 5, s5: '', s6: ['s1'], s7: {}, s8: false } });
  assert.deepEqual(layout.read().parents, { s1: 's2', s3: null });
});

test('nesting a session under another writes the link, takes the session out of its pin and group, and keeps everything else in the file, including keys this version does not know', () => {
  const f = folder({ ...WITH_PROJECTS, later: { kept: true }, pinned: ['s1', 'p1'], assignments: { s1: 'cg-a', s2: 'cg-b' } });
  f.layout.nest('s1', 's2');
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, later: { kept: true }, pinned: ['p1'], assignments: { s2: 'cg-b' }, parents: { s1: 's2' } });
  f.layout.nest('s1', 's3');
  assert.deepEqual(f.onDisk().parents, { s1: 's3' }, 'nesting it again moves it');
});

test('nesting under nothing, or under the session itself, is refused with a 400 and writes nothing', () => {
  const f = folder(WITH_PROJECTS);
  const before = fs.readFileSync(f.file, 'utf8');
  for (const parent of [undefined, null, '', 5, {}, ['s2'], 's1']) assert.throws(() => f.layout.nest('s1', parent), { status: 400, message: 'Nest it under another session.' }, JSON.stringify(parent));
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('taking a session out of its parent writes a null, which stands over a link Desktop makes, and leaves it in the group or Pinned it is given', () => {
  const f = folder({ ...WITH_PROJECTS, pinned: ['p1'], assignments: { s2: 'cg-b' }, parents: { s1: 's2', s4: 's2', s5: 's2', s6: 's2' } });
  f.layout.unnest('s1', { group: 'cg-a' });
  f.layout.unnest('s4', { pinned: true });
  f.layout.unnest('s5');
  f.layout.unnest('s6', { group: 'cg-a', pinned: true });
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, pinned: ['p1', 's4', 's6'], assignments: { s2: 'cg-b', s1: 'cg-a' }, parents: { s1: null, s4: null, s5: null, s6: null } });
  f.layout.unnest('s1');
  assert.deepEqual(f.onDisk().assignments, { s2: 'cg-b' }, 'a session in no group is taken out of the one it had');
});

test('taking a session out into a group that is not there is refused with a 400 and writes nothing', () => {
  const f = folder({ ...WITH_PROJECTS, parents: { s1: 's2' } });
  const before = fs.readFileSync(f.file, 'utf8');
  assert.throws(() => f.layout.unnest('s1', { group: 'cg-none' }), { status: 400, message: 'Unknown group.' });
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('moving or pinning a session leaves its parent alone, unless the caller says it is linked, and then writes a null so it leaves the family', () => {
  const f = folder({ ...WITH_PROJECTS, parents: { s1: 's2' } });
  f.layout.move('s1', 'cg-b');
  f.layout.pin('s3', true);
  f.layout.pin('s1', true);
  assert.deepEqual(f.onDisk().parents, { s1: 's2' });
  f.layout.move('s1', 'cg-b', { unlink: true });
  assert.deepEqual(f.onDisk().parents, { s1: null });
  f.layout.pin('s4', true, { unlink: true });
  f.layout.move('s5', null, { unlink: true });
  assert.deepEqual(f.onDisk().parents, { s1: null, s4: null, s5: null });
  assert.deepEqual(f.onDisk().pinned, ['p1', 's3', 's4'], 'moving s1 took it out of Pinned');
});

test('a change writes the links it is given for other sessions in the same write, and its own link wins over one given for the same session', () => {
  const relink = { s7: 's2', s8: 's2', s1: 's9' };
  const fresh = () => folder({ ...WITH_PROJECTS, parents: { s9: 's8' } });
  const other = { s9: 's8', s7: 's2', s8: 's2' };
  const parentsAfter = edit => {
    const f = fresh();
    edit(f.layout);
    return f.onDisk().parents;
  };
  assert.deepEqual(parentsAfter(l => l.move('s1', 'cg-b', { unlink: true, relink })), { ...other, s1: null });
  assert.deepEqual(parentsAfter(l => l.pin('s1', true, { unlink: true, relink })), { ...other, s1: null });
  assert.deepEqual(parentsAfter(l => l.nest('s1', 's2', { relink })), { ...other, s1: 's2' });
  assert.deepEqual(parentsAfter(l => l.unnest('s1', { group: 'cg-a', relink })), { ...other, s1: null });
  assert.deepEqual(parentsAfter(l => l.move('s1', 'cg-b', { relink: { s7: 's2' } })), { s9: 's8', s7: 's2' }, 'with no unlink the session gets no entry');
});

test('the links go in the one write that makes the change, and none are written when the change is refused or has nothing to do', () => {
  const f = folder({ ...WITH_PROJECTS, parents: { s9: 's8' } });
  const before = fs.readFileSync(f.file, 'utf8');
  const relink = { s7: 's2' };
  assert.throws(() => f.layout.move('s1', 'cg-none', { unlink: true, relink }), { status: 400, message: 'Unknown group.' });
  assert.throws(() => f.layout.pin('s1', 'yes', { unlink: true, relink }), { status: 400, message: 'Pinned or not?' });
  assert.throws(() => f.layout.nest('s1', 's1', { relink }), { status: 400, message: 'Nest it under another session.' });
  assert.throws(() => f.layout.unnest('s1', { group: 'cg-none', relink }), { status: 400, message: 'Unknown group.' });
  f.layout.archive('s6');
  assert.equal(fs.readFileSync(f.file, 'utf8'), before, 's6 is archived already, so there is nothing to write');
});

test('a layout file that cannot be read is reported, and no change is written over it', () => {
  const edits = [
    l => l.move('s1', null),
    l => l.pin('s1', true),
    l => l.archive('s1'),
    l => l.unarchive('s1'),
    l => l.nest('s1', 's2'),
    l => l.unnest('s1'),
    l => l.rename('s1', 'New title'),
    l => l.addProject('Work'),
    l => l.renameProject('cp-a', 'Home'),
    l => l.removeProject('cp-a'),
    l => l.addGroup('Notes'),
    l => l.moveGroup('cg-a', null),
  ];
  for (const text of ['{ not json', JSON.stringify({ ...OLD, groups: 'Reviewing' }), JSON.stringify({ ...OLD, projects: {} }), JSON.stringify({ ...OLD, unarchived: {} }), JSON.stringify({ ...OLD, archived: [] }), JSON.stringify({ ...OLD, archived: 'yesterday' }), JSON.stringify({ ...OLD, archived: null }), JSON.stringify({ ...OLD, titles: [] }), JSON.stringify({ ...OLD, titles: 'Plan' }), JSON.stringify({ ...OLD, titles: null }), JSON.stringify({ ...OLD, parents: [] }), JSON.stringify({ ...OLD, parents: 'p1' }), JSON.stringify({ ...OLD, parents: null }), '[]']) {
    const f = folder(text);
    assert.match(f.layout.read().problem, /^layout\.json cannot be read: /, text);
    for (const edit of edits) assert.throws(() => edit(f.layout), { status: 500, message: /layout\.json cannot be read/ }, `${edit} on ${text}`);
    assert.equal(fs.readFileSync(f.file, 'utf8'), text, 'the file is as it was');
  }
});

test('the first copy from Desktop keeps what was already in the file, the projects, the unarchived list, the archived sessions and the parents included', () => {
  const f = folder({ seededAt: null, projects: [{ id: 'cp-x', name: 'Mine' }], groups: [{ id: 'cg-mine', name: 'Mine', project: 'cp-x' }], pinned: [], assignments: { s9: 'cg-mine' }, unarchived: ['s9'], archived: { s1: FIRST }, parents: { s9: 's1', s8: null } });
  const desk = {
    problem: null,
    sessions: [{ id: 's1', localId: 'local_1' }, { id: 's9', localId: 'local_9' }],
    groups: [{ id: 'cg-d', name: 'From Desktop' }],
    pinned: [],
    assignments: { local_1: 'cg-d', local_9: 'cg-d' },
  };
  const made = f.layout.seed(desk);
  assert.deepEqual(made.groups, [{ id: 'cg-mine', name: 'Mine', project: 'cp-x' }, { id: 'cg-d', name: 'From Desktop' }]);
  assert.deepEqual(made.projects, [{ id: 'cp-x', name: 'Mine' }]);
  assert.deepEqual(made.assignments, { s1: 'cg-d', s9: 'cg-mine' });
  assert.deepEqual(made.unarchived, ['s9']);
  assert.deepEqual(made.archived, { s1: FIRST });
  assert.deepEqual(made.parents, { s9: 's1', s8: null });
  assert.deepEqual(f.onDisk().archived, { s1: FIRST });
  assert.deepEqual(f.onDisk().parents, { s9: 's1', s8: null });
  assert.equal(f.layout.seed(desk), null, 'it copies once');
});

const WITH_PROJECTS = {
  ...OLD,
  projects: [{ id: 'cp-a', name: 'Capcom' }, { id: 'cp-b', name: 'Garden' }],
  groups: [{ id: 'cg-a', name: 'Reviewing', project: 'cp-a', colour: 'blue' }, { id: 'cg-b', name: 'Backlog', project: 'cp-b' }, { id: 'cg-c', name: 'Loose' }],
  retired: [], sections: {},
  unarchived: ['s5'],
  archived: { s6: FIRST },
  titles: { s7: 'Named here' },
  parents: {},
};
const ID = /^c[pg]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('a project is added after the others, with an id like a group has, and its name is kept as one line of text', () => {
  const f = folder(WITH_PROJECTS);
  const made = f.layout.addProject('  <img src=x onerror=alert(1)>\n\tand   more  ');
  assert.match(made.id, ID);
  assert.equal(made.id.slice(0, 3), 'cp-');
  assert.equal(made.name, '<img src=x onerror=alert(1)> and more');
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, projects: [...WITH_PROJECTS.projects, made] });
  assert.notEqual(f.layout.addProject('Capcom').id, f.layout.read().projects[0].id, 'a name used already is allowed, and gets its own id');
});

test('a name must be text with something in it and no more than 80 characters, and a refused name writes nothing', () => {
  const f = folder(WITH_PROJECTS);
  const before = fs.readFileSync(f.file, 'utf8');
  const invisible = ['\u200B', ' \u2060 \u00AD ', '\u3164', '\uFEFF', '\u200D', '\uFE0F', '\u2800', '\u202E', '\u2066\u2069'];
  for (const bad of [undefined, null, 5, {}, ['a'], '', '   ', '\n\t', '\u0000\u0007', ...invisible, 'x'.repeat(81), '🙂'.repeat(81)]) {
    for (const edit of [l => l.addProject(bad), l => l.renameProject('cp-a', bad), l => l.addGroup(bad), l => l.addGroup(bad, 'cp-a')]) {
      assert.throws(() => edit(f.layout), { status: 400 }, JSON.stringify(bad));
    }
  }
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal(f.layout.addProject('x'.repeat(80)).name.length, 80);
  assert.equal([...f.layout.addProject('🙂'.repeat(80)).name].length, 80);
});

test('a name keeps the invisible characters that make up an emoji and loses the ones that reorder the text around it', () => {
  const f = folder(WITH_PROJECTS);
  for (const name of ['\u{1F469}\u200D\u{1F4BB} Dev', '\u{1F6E2}\uFE0F Pump', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F} Wales', '\u05E9\u05DC\u05D5\u05DD\u200F']) {
    assert.equal(f.layout.addProject(name).name, name, name);
  }
  assert.equal(f.layout.addProject('abc\u202Edef\u2066 ghi\u2069').name, 'abcdef ghi');
  assert.equal(f.layout.renameProject('cp-a', '\u202Bnotes\u202C').name, 'notes');
});

test('renaming a project changes its name and nothing else', () => {
  const f = folder(WITH_PROJECTS);
  const renamed = f.layout.renameProject('cp-b', ' Garden plans ');
  assert.deepEqual(renamed, { id: 'cp-b', name: 'Garden plans' });
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, projects: [WITH_PROJECTS.projects[0], renamed] });
});

test('renaming a session keeps its title by id as one line of text, replaces an earlier one, and keeps everything else in the file', () => {
  const f = folder({ ...WITH_PROJECTS, later: { kept: true } });
  assert.equal(f.layout.rename('s1', '  <b>Plan</b>\n\tthe   week \u202E '), '<b>Plan</b> the week');
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, later: { kept: true }, titles: { s7: 'Named here', s1: '<b>Plan</b> the week' } });
  assert.equal(f.layout.rename('s1', 'Plan the month'), 'Plan the month');
  assert.equal(f.layout.rename('s7', 'Renamed'), 'Renamed');
  assert.deepEqual(f.layout.read().titles, { s7: 'Renamed', s1: 'Plan the month' });
  assert.deepEqual({ ...f.onDisk(), titles: WITH_PROJECTS.titles }, { ...WITH_PROJECTS, later: { kept: true } }, 'only the titles changed');
});

test('a title must be text with something in it and no more than 120 characters, and a refused title writes nothing', () => {
  const f = folder(WITH_PROJECTS);
  const before = fs.readFileSync(f.file, 'utf8');
  for (const bad of [undefined, null, 5, {}, ['a'], '', '   ', '\n\t', '\u0000\u0007', '\u200B', '\u2800', '\u202E', 'x'.repeat(121), '🙂'.repeat(121)]) {
    assert.throws(() => f.layout.rename('s1', bad), { status: 400 }, JSON.stringify(bad));
  }
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal(f.layout.rename('s1', 'x'.repeat(120)).length, 120);
  assert.equal([...f.layout.rename('s2', '🙂'.repeat(120))].length, 120);
  assert.equal(f.layout.rename('s3', `${'x'.repeat(120)}   `).length, 120, 'spaces that are trimmed off do not count');
});

test('a group is added to the end of the groups, inside a project or at the top level', () => {
  const f = folder(WITH_PROJECTS);
  const inside = f.layout.addGroup('Inside', 'cp-b');
  const top = f.layout.addGroup('Top level');
  assert.match(inside.id, ID);
  assert.equal(inside.id.slice(0, 3), 'cg-');
  assert.deepEqual(inside, { id: inside.id, name: 'Inside', project: 'cp-b' });
  assert.deepEqual(top, { id: top.id, name: 'Top level' }, 'a top-level group looks like one Desktop made');
  assert.deepEqual(f.onDisk().groups, [...WITH_PROJECTS.groups, inside, top]);
  assert.deepEqual({ ...f.onDisk(), groups: WITH_PROJECTS.groups }, WITH_PROJECTS);
});

test('a group moves into a project, between projects and back to the top level, and keeps its place and its sessions', () => {
  const f = folder(WITH_PROJECTS);
  const order = () => f.onDisk().groups.map(g => g.id);
  assert.deepEqual(f.layout.moveGroup('cg-c', 'cp-a'), { id: 'cg-c', name: 'Loose', project: 'cp-a' });
  assert.deepEqual(f.layout.moveGroup('cg-a', 'cp-b'), { id: 'cg-a', name: 'Reviewing', project: 'cp-b', colour: 'blue' });
  assert.deepEqual(f.layout.moveGroup('cg-b', null), { id: 'cg-b', name: 'Backlog' });
  assert.deepEqual(f.onDisk().groups, [{ id: 'cg-a', name: 'Reviewing', project: 'cp-b', colour: 'blue' }, { id: 'cg-b', name: 'Backlog' }, { id: 'cg-c', name: 'Loose', project: 'cp-a' }]);
  assert.deepEqual(order(), ['cg-a', 'cg-b', 'cg-c']);
  assert.deepEqual({ ...f.onDisk(), groups: WITH_PROJECTS.groups }, WITH_PROJECTS);
  assert.deepEqual(f.layout.moveGroup('cg-c', null), { id: 'cg-c', name: 'Loose' }, 'a group already at the top level can be moved there');
});

test('deleting a project sends its groups back to the top level and deletes no group, session or pin', () => {
  const f = folder(WITH_PROJECTS);
  assert.deepEqual(f.layout.removeProject('cp-a'), { id: 'cp-a', name: 'Capcom' });
  assert.deepEqual(f.onDisk(), {
    ...WITH_PROJECTS,
    projects: [{ id: 'cp-b', name: 'Garden' }],
    groups: [{ id: 'cg-a', name: 'Reviewing', colour: 'blue' }, { id: 'cg-b', name: 'Backlog', project: 'cp-b' }, { id: 'cg-c', name: 'Loose' }],
  });
  f.layout.removeProject('cp-b');
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, projects: [], groups: [{ id: 'cg-a', name: 'Reviewing', colour: 'blue' }, { id: 'cg-b', name: 'Backlog' }, { id: 'cg-c', name: 'Loose' }] });
});

test('a project or group that is not there is refused with a 404, and a refused change writes nothing', () => {
  const f = folder(WITH_PROJECTS);
  const before = fs.readFileSync(f.file, 'utf8');
  const l = f.layout;
  for (const [edit, what] of [
    [() => l.renameProject('cp-none', 'x'), /Unknown project/],
    [() => l.renameProject('cg-a', 'x'), /Unknown project/],
    [() => l.removeProject('cp-none'), /Unknown project/],
    [() => l.removeProject(undefined), /Unknown project/],
    [() => l.addGroup('x', 'cp-none'), /Unknown project/],
    [() => l.addGroup('x', 'cg-a'), /Unknown project/],
    [() => l.moveGroup('cg-none', null), /Unknown group/],
    [() => l.moveGroup('cp-a', null), /Unknown group/],
    [() => l.moveGroup('cg-a', 'cp-none'), /Unknown project/],
    [() => l.moveGroup('cg-a', ''), /Unknown project/],
  ]) assert.throws(edit, { status: 404, message: what }, String(edit));
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('every other edit keeps the projects and the project of each group', () => {
  const f = folder(WITH_PROJECTS);
  f.layout.move('s1', 'cg-b');
  f.layout.pin('s2', true);
  f.layout.archive('s4');
  f.layout.unarchive('s3');
  const after = f.onDisk();
  assert.deepEqual(after.projects, WITH_PROJECTS.projects);
  assert.deepEqual(after.groups, WITH_PROJECTS.groups);
});

test('every other edit keeps the parents, the nulls included', () => {
  const parents = { s1: 's2', s8: null };
  const f = folder({ ...WITH_PROJECTS, parents });
  f.layout.move('s2', 'cg-b');
  f.layout.pin('s2', true);
  f.layout.archive('s4');
  f.layout.unarchive('s3');
  f.layout.rename('s1', 'Plan');
  f.layout.addProject('Work');
  f.layout.renameProject('cp-a', 'Home');
  f.layout.addGroup('Notes');
  f.layout.moveGroup('cg-c', 'cp-a');
  f.layout.removeProject('cp-b');
  assert.deepEqual(f.onDisk().parents, parents);
});

const SESSION = '0f3c2a9e-6b1d-4c58-9e27-5a8d41b7c3f0';
const OTHER = '9d6e1b84-2c7a-4f03-8b59-e1a07c4d2f66';

test('a group keeps its session link when it is read, and a link that is not a UUID, or that an earlier group holds, is dropped with the group kept', () => {
  const group = (id, session) => ({ id, name: id, ...(session !== undefined && { session }) });
  const { layout } = folder({
    ...OLD,
    groups: [group('cg-a', SESSION), group('cg-b', SESSION), group('cg-c', OTHER), group('cg-d', 'not-a-uuid'), group('cg-e', 5), group('cg-f', ''), group('cg-g', SESSION.toUpperCase()), group('cg-h', null), group('cg-i')],
  });
  assert.deepEqual(layout.read().groups, [group('cg-a', SESSION), group('cg-b'), group('cg-c', OTHER), group('cg-d'), group('cg-e'), group('cg-f'), group('cg-g'), group('cg-h'), group('cg-i')]);
});

test('booking a group\'s session writes a new id once, returns the same one after, and keeps everything else in the file, including keys this version does not know', () => {
  const f = folder({ ...WITH_PROJECTS, later: { kept: true } });
  let minted = 0;
  const mint = () => { minted++; return SESSION; };
  assert.equal(f.layout.claimGroupSession('cg-a', mint), SESSION);
  assert.equal(f.layout.claimGroupSession('cg-a', mint), SESSION);
  assert.equal(minted, 1, 'the id is made only for a group that has none');
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, later: { kept: true }, projects: WITH_PROJECTS.projects, groups: WITH_PROJECTS.groups.map(g => (g.id === 'cg-a' ? { ...g, session: SESSION } : g)), titles: WITH_PROJECTS.titles, parents: {} });
});

test('booking again writes nothing, and a group with a session that was dropped on read is booked a new one', () => {
  const f = folder({ ...OLD, groups: [{ id: 'cg-a', name: 'A', session: SESSION }, { id: 'cg-b', name: 'B', session: SESSION }] });
  backdate(f);
  assert.equal(f.layout.claimGroupSession('cg-a', () => assert.fail('a group with a session is not booked another')), SESSION);
  assert.equal(rewritten(f), false);
  assert.equal(f.layout.claimGroupSession('cg-b', () => OTHER), OTHER);
  assert.deepEqual(f.layout.read().groups.map(g => g.session), [SESSION, OTHER]);
});

test('booking for a group that is not there is a 404, an id that is not new is refused, and a refusal writes nothing', () => {
  const f = folder({ ...OLD, groups: [{ id: 'cg-a', name: 'A', session: SESSION }, { id: 'cg-b', name: 'B' }] });
  const before = fs.readFileSync(f.file, 'utf8');
  assert.throws(() => f.layout.claimGroupSession('cg-none', () => OTHER), { status: 404, message: 'Unknown group.' });
  assert.throws(() => f.layout.claimGroupSession('s1', () => OTHER), { status: 404 });
  for (const bad of [SESSION, 'nope', undefined, 5]) assert.throws(() => f.layout.claimGroupSession('cg-b', () => bad), { status: 500 }, String(bad));
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('every other edit keeps a group\'s session, and so does moving it between projects', () => {
  const f = folder({ ...WITH_PROJECTS, groups: WITH_PROJECTS.groups.map(g => (g.id === 'cg-a' ? { ...g, session: SESSION } : g)) });
  f.layout.move('s1', 'cg-b');
  f.layout.pin('s2', true);
  f.layout.archive('s4');
  f.layout.nest('s3', 's2');
  f.layout.addGroup('Notes');
  f.layout.removeProject('cp-a');
  f.layout.moveGroup('cg-a', 'cp-b');
  assert.equal(f.layout.read().groups.find(g => g.id === 'cg-a').session, SESSION);
  f.layout.moveGroup('cg-a', null);
  assert.equal(f.layout.read().groups.find(g => g.id === 'cg-a').session, SESSION);
});

const MEMBERS = {
  ...WITH_PROJECTS,
  assignments: { s1: 'cg-a', s2: 'cg-b', s3: 'cg-a', s4: 'cg-c' },
  archived: { s3: FIRST },
  parents: { s9: 's1', s8: null },
  groups: [...WITH_PROJECTS.groups, { id: 'cg-d', name: 'Notes', session: SESSION }],
};

test('deleting a group takes it out of the groups and puts every session in it, archived ones too, back to ungrouped, and leaves the others where they are', () => {
  const f = folder(MEMBERS);
  assert.deepEqual(f.layout.removeGroup('cg-a'), { id: 'cg-a', name: 'Reviewing', project: 'cp-a', colour: 'blue' });
  assert.deepEqual(f.onDisk(), { ...MEMBERS, groups: MEMBERS.groups.filter(g => g.id !== 'cg-a'), assignments: { s2: 'cg-b', s4: 'cg-c' }, retired: [], sections: {} });
});

test('deleting a group keeps a family together, since a nested session shows in its holder\'s place, and keeps pins, parents and titles', () => {
  const f = folder({ ...MEMBERS, assignments: { ...MEMBERS.assignments, s9: 'cg-a', s10: 'cg-b' }, parents: { ...MEMBERS.parents, s10: 's1' }, pinned: ['p1', 's9'], titles: { s1: 'Held', s7: 'Named here' } });
  f.layout.removeGroup('cg-a');
  const after = f.onDisk();
  assert.equal('s1' in after.assignments, false, 'the holder is ungrouped');
  assert.equal('s9' in after.assignments, false, 'and so is a child that was held in the deleted group');
  assert.equal(after.assignments.s10, 'cg-b', 'but a child held in another group keeps it');
  assert.deepEqual(after.parents, { ...MEMBERS.parents, s10: 's1' }, 'and both still show under the holder');
  assert.deepEqual(after.pinned, ['p1', 's9']);
  assert.deepEqual(after.titles, { s1: 'Held', s7: 'Named here' });
});

test('deleting a group with a session retires it with the group\'s id, name and session and no project, and writes the layout once', t => {
  const inProject = { ...MEMBERS, groups: MEMBERS.groups.map(g => (g.id === 'cg-d' ? { ...g, project: 'cp-a' } : g)) };
  const f = folder(inProject);
  const write = t.mock.method(fs, 'writeFileSync');
  assert.deepEqual(f.layout.removeGroup('cg-d'), { id: 'cg-d', name: 'Notes', session: SESSION, project: 'cp-a' });
  assert.equal(write.mock.callCount(), 1);
  write.mock.restore();
  assert.deepEqual(f.onDisk(), { ...inProject, groups: WITH_PROJECTS.groups, retired: [{ id: 'cg-d', name: 'Notes', session: SESSION }] });
});

test('deleting a group with a session leaves its chat out of the archive: nothing is archived, unarchived or titled, whatever the chat held before', () => {
  const held = { unarchived: ['s5', SESSION], archived: { ...MEMBERS.archived, [SESSION]: FIRST }, titles: { ...MEMBERS.titles, [SESSION]: 'My own name' } };
  const f = folder({ ...MEMBERS, ...held });
  f.layout.removeGroup('cg-d');
  const after = f.onDisk();
  assert.deepEqual({ unarchived: after.unarchived, archived: after.archived, titles: after.titles }, held);
  assert.deepEqual(after.retired, [{ id: 'cg-d', name: 'Notes', session: SESSION }]);
  const plain = folder(MEMBERS);
  plain.layout.removeGroup('cg-d');
  assert.deepEqual({ unarchived: plain.onDisk().unarchived, archived: plain.onDisk().archived, titles: plain.onDisk().titles }, { unarchived: MEMBERS.unarchived, archived: MEMBERS.archived, titles: MEMBERS.titles });
});

test('deleting more groups with a session adds to the retired list in order, and a group with no session retires nothing', () => {
  const second = { id: 'cg-e', name: 'Later', session: OTHER };
  const f = folder({ ...MEMBERS, groups: [...MEMBERS.groups, second] });
  f.layout.removeGroup('cg-d');
  f.layout.removeGroup('cg-b');
  f.layout.removeGroup('cg-e');
  assert.deepEqual(f.onDisk().retired, [{ id: 'cg-d', name: 'Notes', session: SESSION }, { id: 'cg-e', name: 'Later', session: OTHER }]);
  assert.deepEqual(f.layout.read().groups.map(g => g.id), ['cg-a', 'cg-c']);
});

test('a retired list is read with the entries that have an id and a session UUID, and a layout without one, or with a retired list that is not a list, loads or is reported as the other lists are', () => {
  const entry = (id, session) => ({ id, name: id, ...(session !== undefined && { session }) });
  const { layout } = folder({ ...OLD, retired: [entry('cg-x', SESSION), entry('cg-y', 'not-a-uuid'), entry('cg-z'), { name: 'No id', session: OTHER }, null, 5, entry('cg-w', OTHER)] });
  assert.deepEqual(layout.read().retired, [entry('cg-x', SESSION), entry('cg-w', OTHER)]);
  assert.deepEqual(folder(OLD).layout.read().retired, []);
  const bad = folder({ ...OLD, retired: { 'cg-x': SESSION } });
  assert.match(bad.layout.read().problem, /^layout\.json cannot be read: /);
  assert.throws(() => bad.layout.removeGroup('cg-a'), { status: 500, message: /layout\.json cannot be read/ });
});

test('deleting a group with no session retires, archives and titles nothing, and keeps keys this version does not know', () => {
  const f = folder({ ...MEMBERS, later: { kept: true } });
  f.layout.removeGroup('cg-b');
  const after = f.onDisk();
  assert.deepEqual({ retired: after.retired, archived: after.archived, unarchived: after.unarchived, titles: after.titles, later: after.later }, { retired: [], archived: MEMBERS.archived, unarchived: MEMBERS.unarchived, titles: MEMBERS.titles, later: { kept: true } });
});

test('a group that is not there cannot be deleted or ordered, and a refused change writes nothing', () => {
  const f = folder(MEMBERS);
  const before = fs.readFileSync(f.file, 'utf8');
  const l = f.layout;
  for (const edit of [() => l.removeGroup('cg-none'), () => l.removeGroup(undefined), () => l.removeGroup('cp-a'), () => l.removeGroup('s1'),
    () => l.orderGroup('cg-none', { before: 'cg-a' }), () => l.orderGroup('cg-a', { before: 'cg-none' }), () => l.orderGroup('cg-a', { after: 'cp-a' })]) {
    assert.throws(edit, { status: 404, message: 'Unknown group.' }, String(edit));
  }
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

// Home holds h1 to h3, project cp-a holds p1 and p2, and their places among each other in `groups` are mixed.
const ORDERED = {
  ...OLD,
  projects: [{ id: 'cp-a', name: 'Capcom' }],
  groups: [{ id: 'h1', name: 'One' }, { id: 'p1', name: 'P one', project: 'cp-a' }, { id: 'h2', name: 'Two', colour: 'blue' }, { id: 'p2', name: 'P two', project: 'cp-a' }, { id: 'h3', name: 'Three' }],
};
const idsOf = f => f.onDisk().groups.map(g => g.id);

test('a group goes before or after another in its view, and the groups of the other views and the others in its view keep their order', () => {
  const f = folder(ORDERED);
  assert.deepEqual(f.layout.orderGroup('h3', { before: 'h1' }), { id: 'h3', name: 'Three' });
  assert.deepEqual(idsOf(f), ['h3', 'h1', 'p1', 'h2', 'p2']);
  assert.deepEqual(f.layout.orderGroup('h3', { after: 'h2' }), { id: 'h3', name: 'Three' });
  assert.deepEqual(idsOf(f), ['h1', 'p1', 'h2', 'h3', 'p2']);
  assert.deepEqual(f.layout.orderGroup('h1', { after: 'h3' }), { id: 'h1', name: 'One' });
  assert.deepEqual(idsOf(f), ['p1', 'h2', 'h3', 'h1', 'p2']);
  assert.deepEqual(f.layout.orderGroup('h2', { before: 'h1' }), { id: 'h2', name: 'Two', colour: 'blue' }, 'what a group holds comes back with it');
  assert.deepEqual(idsOf(f), ['p1', 'h3', 'h2', 'h1', 'p2']);
  assert.deepEqual(f.onDisk().groups.find(g => g.id === 'h2'), ORDERED.groups[2], 'and nothing about the group changes');
  assert.deepEqual({ ...f.onDisk(), groups: [] }, { ...ORDERED, groups: [], projects: ORDERED.projects, retired: [], sections: {}, unarchived: [], archived: {}, titles: {}, parents: {} });
});

test('groups in a project are ordered among themselves', () => {
  const f = folder(ORDERED);
  f.layout.orderGroup('p2', { before: 'p1' });
  assert.deepEqual(idsOf(f), ['h1', 'p2', 'p1', 'h2', 'h3']);
  f.layout.orderGroup('p2', { after: 'p1' });
  assert.deepEqual(idsOf(f), ['h1', 'p1', 'p2', 'h2', 'h3']);
});

test('a group whose project is gone is at the top level, so it is ordered with the groups there and not with the project\'s', () => {
  const f = folder({ ...ORDERED, groups: [...ORDERED.groups, { id: 'lost', name: 'Lost', project: 'cp-gone' }] });
  f.layout.orderGroup('lost', { before: 'h1' });
  assert.deepEqual(idsOf(f), ['lost', 'h1', 'p1', 'h2', 'p2', 'h3']);
  assert.deepEqual(f.onDisk().groups[0], { id: 'lost', name: 'Lost', project: 'cp-gone' }, 'its link to the gone project is left as it was');
  assert.throws(() => f.layout.orderGroup('lost', { after: 'p1' }), { status: 400 });
  assert.throws(() => f.layout.orderGroup('p1', { after: 'lost' }), { status: 400 });
  f.layout.orderGroup('h3', { after: 'lost' });
  assert.deepEqual(idsOf(f), ['lost', 'h3', 'h1', 'p1', 'h2', 'p2']);
});

test('ordering needs exactly one other group in the same view, and a refusal writes nothing', () => {
  const f = folder(ORDERED);
  const before = fs.readFileSync(f.file, 'utf8');
  for (const [id, where, what] of [
    ['h1', { before: 'p1' }, /different views/],
    ['p1', { after: 'h1' }, /different views/],
    ['h1', { before: 'h1' }, /another group/],
    ['h1', { after: 'h1' }, /another group/],
    ['h1', {}, /before or after one other/],
    ['h1', undefined, /before or after one other/],
    ['h1', { before: null, after: undefined }, /before or after one other/],
    ['h1', { before: 'h2', after: 'h3' }, /before or after one other/],
    ['h1', { before: 'h2', after: 'h2' }, /before or after one other/],
    ['h1', { before: 5 }, /before or after one other/],
    ['h1', { after: ['h2'] }, /before or after one other/],
  ]) assert.throws(() => f.layout.orderGroup(id, where), { status: 400, message: what }, `${id} ${JSON.stringify(where)}`);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.deepEqual(f.layout.orderGroup('h1', { before: 'h2', after: null }), { id: 'h1', name: 'One' }, 'a null is no answer');
});

const THIRD = '5a2f8c61-7d40-4b9e-a3c6-1e94b0d7f258';
const FOURTH = 'c8b35e07-1f92-4a6d-8e40-72d9a1b6c503';

test('the built-in sections keep their session links when read: only the five sections, only UUIDs, and one holder for each UUID across groups, retired groups and sections', () => {
  const { layout } = folder({
    ...OLD,
    groups: [{ id: 'cg-a', name: 'A', session: SESSION }],
    retired: [{ id: 'cg-r', name: 'R', session: OTHER }],
    sections: { routines: THIRD, pinned: SESSION, started: OTHER, ungrouped: FOURTH, other: THIRD, 'cg-a': FOURTH, nope: THIRD },
  });
  assert.deepEqual(layout.read().sections, { routines: THIRD, ungrouped: FOURTH }, 'a group or retired group holds the first two, and an earlier section holds the third');
  for (const bad of ['not-a-uuid', 5, null, '', SESSION.toUpperCase(), ['x']]) assert.deepEqual(folder({ ...OLD, sections: { pinned: bad, started: THIRD } }).layout.read().sections, { started: THIRD }, String(bad));
});

test('a layout without sections, or with sections that are not an object, loads or is reported as the other objects are', () => {
  assert.deepEqual(folder(OLD).layout.read().sections, {});
  const bad = folder({ ...OLD, sections: [SESSION] });
  assert.match(bad.layout.read().problem, /^layout\.json cannot be read: /);
  assert.throws(() => bad.layout.claimGroupSession('pinned', () => THIRD), { status: 500, message: /layout\.json cannot be read/ });
});

test('booking a section\'s session writes a new id once, returns the same one after, and keeps everything else in the file, including keys this version does not know', () => {
  const f = folder({ ...WITH_PROJECTS, later: { kept: true } });
  let minted = 0;
  const mint = () => { minted++; return SESSION; };
  assert.equal(f.layout.claimGroupSession('pinned', mint), SESSION);
  assert.equal(f.layout.claimGroupSession('pinned', mint), SESSION);
  assert.equal(minted, 1, 'the id is made only for a section that has none');
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, later: { kept: true }, sections: { pinned: SESSION } });
  assert.equal(f.layout.claimGroupSession('other', () => OTHER), OTHER);
  assert.deepEqual(f.layout.read().sections, { pinned: SESSION, other: OTHER });
  assert.deepEqual(f.layout.read().groups.map(g => g.session), [undefined, undefined, undefined], 'no group was given one');
});

test('two bookings of one section in a process give one id, because each is one read and write', async () => {
  const f = folder(OLD);
  const ids = [OTHER, THIRD];
  const books = await Promise.all([0, 1].map(async n => f.layout.claimGroupSession('routines', () => ids[n])));
  assert.deepEqual(books, [OTHER, OTHER]);
  assert.deepEqual(f.onDisk().sections, { routines: OTHER });
});

test('booking a section refuses an id that a group, a retired group or another section holds, and a refusal writes nothing', () => {
  const f = folder({ ...OLD, groups: [{ id: 'cg-a', name: 'A', session: SESSION }], retired: [{ id: 'cg-r', name: 'R', session: OTHER }], sections: { started: THIRD } });
  const before = fs.readFileSync(f.file, 'utf8');
  for (const taken of [SESSION, OTHER, THIRD, 'nope', undefined, 5]) assert.throws(() => f.layout.claimGroupSession('pinned', () => taken), { status: 500 }, String(taken));
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.throws(() => f.layout.claimGroupSession('Pinned', () => FOURTH), { status: 404, message: 'Unknown group.' }, 'a section is named by its id');
  assert.equal(f.layout.claimGroupSession('cg-a', () => assert.fail('a group with a session is not booked another')), SESSION);
  const group = folder({ ...OLD, groups: [{ id: 'cg-b', name: 'B' }], sections: { started: THIRD } });
  assert.throws(() => group.layout.claimGroupSession('cg-b', () => THIRD), { status: 500 }, 'a group cannot take the id a section holds');
});

test('every other edit keeps the sections\' sessions, and so does deleting a group', () => {
  const sections = { pinned: THIRD, other: FOURTH };
  const f = folder({ ...MEMBERS, sections });
  f.layout.move('s1', 'cg-b');
  f.layout.pin('s2', true);
  f.layout.archive('s4');
  f.layout.unarchive('s4');
  f.layout.nest('s3', 's2');
  f.layout.unnest('s3');
  f.layout.rename('s1', 'Named');
  f.layout.addProject('New');
  f.layout.addGroup('Notes');
  f.layout.moveGroup('cg-a', 'cp-b');
  f.layout.orderGroup('cg-a', { before: 'cg-b' });
  f.layout.removeProject('cp-a');
  assert.deepEqual(f.layout.read().sections, sections);
  f.layout.removeGroup('cg-a');
  assert.deepEqual(f.onDisk().sections, sections);
  assert.deepEqual(f.layout.seed({ problem: null, groups: [], pinned: [], assignments: {}, sessions: [] }), null, 'a layout that is seeded already is left alone');
});

test('seeding from Desktop keeps the sections that were booked before the copy', () => {
  const f = folder({ sections: { pinned: SESSION } });
  const desk = { groups: [{ id: 'cg-d', name: 'Desk' }], pinned: [], assignments: {}, sessions: [] };
  assert.ok(f.layout.seed(desk));
  assert.deepEqual(f.onDisk().sections, { pinned: SESSION });
});
