// What dragging a group's header can do, as rules that need no page. A target is `to:` and a project id (empty for Home), or `before:`
// or `after:` and the id of the group the header lands beside.
import { HOME_VIEW } from './scopes.js';

export const MOVE = 'to:';

// Home and every project except the view the group is in.
export const viewTargets = (projects, view) => [
  ...(view === HOME_VIEW ? [] : [{ id: MOVE, project: null, label: 'Home' }]),
  ...projects.filter(p => p.id !== view).map(p => ({ id: `${MOVE}${p.id}`, project: p.id, label: p.name })),
];

// Whether a header is a handle: when the group can be ordered among others, or moved to another view.
export const canGrab = ({ edits, count, targets }) => (edits && count > 1) || targets > 0;

// The group lands after the others whose header middle is above the pointer, so an open group's rows count as below its header. The
// pointer counts only inside `area`. Returns { side, beside }, or null when there is no place or it is where the group is.
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
