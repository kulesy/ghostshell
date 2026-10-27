// Run with `npm test`. What the header of an open chat renames it with: the route and body for a session and for a group, the limit of each, and
// nothing for a chat that cannot be renamed there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_NAME_MAX, renamerFor } from '../public/ui/chat-rename.js';

const calls = [];
const edit = async (path, body) => { calls.push([path, body]); return { problem: '' }; };

test('a session is renamed by its own id with a title of up to 120 characters, as typed', async () => {
  const renamer = renamerFor({ kind: 'session', id: 's1', edit });
  assert.deepEqual([renamer.label, renamer.max], ['Rename session', 120]);
  assert.deepEqual(await renamer.save('New title'), { problem: '' });
  assert.deepEqual(calls.pop(), ['api/layout/rename', { id: 's1', title: 'New title' }]);
});

test('a group is renamed by the group\'s id with a name of up to 80 characters', async () => {
  const renamer = renamerFor({ kind: 'group', id: 'cg-a', edit });
  assert.deepEqual([renamer.label, renamer.max, GROUP_NAME_MAX], ['Rename group', 80, 80]);
  await renamer.save('Reviews');
  assert.deepEqual(calls.pop(), ['api/layout/group/rename', { id: 'cg-a', name: 'Reviews' }]);
});

test('a draft, a section and a chat with nothing to send through have no renamer', () => {
  assert.equal(renamerFor({ kind: 'session', id: null, edit }), null);
  assert.equal(renamerFor({ kind: 'section', id: 'pinned', edit }), null);
  assert.equal(renamerFor({ kind: 'group', id: 'cg-a' }), null);
  assert.equal(renamerFor({ kind: 'session', id: 's1' }), null);
});
