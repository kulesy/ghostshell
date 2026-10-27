// How sessions are put in order, with no DOM in it so the server and the page share one answer. These are Claude Desktop's own sorts,
// checked on Desktop 3.1623.0. A row's `sortAt` is when its last turn began or ended, and each list says how it sorts, as a Desktop
// section does. See docs/adr/20261022-list-order-and-row-marks.md.
export const UNTITLED = 'Untitled session';

// A list Desktop has no section for goes newest first.
export const DEFAULT_SORT = { by: 'recency', ascending: false };

// Every list goes A to Z by title, whatever sort Desktop holds for it.
export const TITLE_SORT = { by: 'alpha', ascending: false };

const titled = row => (row.title && row.title !== UNTITLED ? row.title : null);
// When the row was made, unless that is missing or later than its last turn, which then stands in for it.
const bornAt = row => (Number.isFinite(row.createdAt) && row.createdAt > 0 && row.createdAt <= row.sortAt ? row.createdAt : row.sortAt);

const BY = {
  recency: (a, b) => b.sortAt - a.sortAt,
  created: (a, b) => bornAt(b) - bornAt(a),
  alpha: (a, b) => {
    const [x, y] = [titled(a), titled(b)];
    return x === y ? 0 : x === null ? 1 : y === null ? -1 : x.localeCompare(y);
  },
};

const kindOf = ({ by }) => (Object.hasOwn(BY, by) ? by : 'recency');

// The comparator for a sort. Ascending turns a sort around, except that an alpha sort keeps the rows with no title last. A tie goes by
// id, so the same rows come out in the same order whatever order they came in.
export function comparator(sort = DEFAULT_SORT) {
  const kind = kindOf(sort);
  const forward = BY[kind];
  const sorted = !sort.ascending ? forward : kind === 'alpha' ? (a, b) => (titled(a) && titled(b) ? forward(b, a) : forward(a, b)) : (a, b) => forward(b, a);
  return (a, b) => sorted(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// Rows in the list's order. A family is placed by its head under the alpha and created sorts, and under recency by the member that
// sorts first, so a busy child does not drop out of view under an old parent.
export function sortRows(rows, sort = DEFAULT_SORT) {
  const compare = comparator(sort);
  const best = row => (kindOf(sort) === 'recency' && row.children?.length ? [row, ...row.children].reduce((first, m) => (compare(m, first) < 0 ? m : first)) : row);
  const placed = new Map(rows.map(r => [r, best(r)]));
  return [...rows].sort((a, b) => compare(placed.get(a), placed.get(b)));
}

const MAX_DEPTH = 32;

// A family's children depth first: each child of the head in the list's order, followed at once by those whose `via` names it, and so on.
// A child with no `via` nests under the head, and one that no walk reaches, deeper than the limit, goes last.
export function sortFamily(head, children, sort = DEFAULT_SORT) {
  const compare = comparator(sort);
  const under = new Map();
  for (const child of children) under.set(child.via ?? head.id, [...(under.get(child.via ?? head.id) ?? []), child]);
  const walked = new Set();
  const order = [];
  const walk = (id, depth) => {
    for (const child of [...(under.get(id) ?? [])].sort(compare)) {
      if (walked.has(child)) continue;
      walked.add(child);
      order.push(child);
      if (depth < MAX_DEPTH) walk(child.id, depth + 1);
    }
  };
  walk(head.id, 1);
  return [...order, ...children.filter(c => !walked.has(c)).sort(compare)];
}
