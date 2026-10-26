// What the header of an open chat renames it with, as rules that need no page, so node can test them.
import { TITLE_MAX } from './tree.js';

export const GROUP_NAME_MAX = 80;

// `edit(path, body)` sends a layout change and resolves { problem }. A session is renamed by its id and a group by the group's id, which
// is not its chat's. The server makes the text one clean line. A built-in section and a draft have no renamer, so nothing is offered for them.
export function renamerFor({ kind, id, edit }) {
  if (!id || !edit) return null;
  if (kind === 'group') return { label: 'Rename group', max: GROUP_NAME_MAX, save: text => edit('api/layout/group/rename', { id, name: text }) };
  if (kind === 'session') return { label: 'Rename session', max: TITLE_MAX, save: text => edit('api/layout/rename', { id, title: text }) };
  return null;
}
