// What dragging a group's header can do, as rules that need no page, so node can test them. A group goes to another view, which is a
// target marked `to:` and the project's id (empty for Home), or to a place among the groups of its own view, which is `before:` or
// `after:` and the id of the group it lands beside.
import { HOME_VIEW } from './scopes.js';

export const MOVE = 'to:';

// Home and every project except the view the group is in.
export const viewTargets = (projects, view) => [
  ...(view === HOME_VIEW ? [] : [{ id: MOVE, project: null, label: 'Home' }]),
  ...projects.filter(p => p.id !== view).map(p => ({ id: `${MOVE}${p.id}`, project: p.id, label: p.name })),
];

// Whether a header is a handle: when the group can be ordered among others, or moved to another view.
export const canGrab = ({ edits, count, targets }) => (edits && count > 1) || targets > 0;

// Where a group carried at `at` would land among the groups of its view. `order` is their ids in order, the carried one included, and
// `mids` is the vertical middle of each header. The group goes after as many of the others as have their middle above the pointer, so an
// open group's rows count as below its header. `area` is the list's left and right and the top of the first group and bottom of the
// last, and the pointer counts only inside it. Returns { side, beside }, or null when there is no place or it is where the group is.
export function slotFor({ order, carried, mids, area, at }) {
  const others = order.filter(id => id !== carried);
  if (!area || !others.length || at.x < area.left || at.x > area.right || at.y < area.top || at.y > area.bottom) return null;
  const index = others.filter(id => mids[id] < at.y).length;
  if (index === order.indexOf(carried)) return null;
  return index < others.length ? { side: 'before', beside: others[index] } : { side: 'after', beside: others.at(-1) };
}

export const slotTarget = slot => (slot ? `${slot.side}:${slot.beside}` : null);

// The place a target names: { move: project id or null for Home }, { side, beside }, or null for anything else.
export function parseTarget(target) {
  if (typeof target !== 'string') return null;
  if (target.startsWith(MOVE)) return { move: target.slice(MOVE.length) || null };
  const side = /^(before|after):(.+)$/.exec(target);
  return side ? { side: side[1], beside: side[2] } : null;
}

// The note after a group is dropped beside another.
export const orderNote = (name, beside, side) => `Moved “${name}” ${side === 'before' ? 'above' : 'below'} “${beside}”.`;
