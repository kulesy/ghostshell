// Which sessions show under which. A link points from a session to the one it nests under, and a family shows in the place of
// the topmost session its links reach. See docs/adr/20261022-nest-sessions-under-a-parent.md.

// The sessions a row's links lead through, nearest first, archived ones among them. A chain ends at a session with no link, at one
// that is not in `rows`, at a routine run, which never holds children, and where a link comes back to a session it has met.
export function chainOf(rows, linkOf, row) {
  const chain = [];
  const seen = new Set([row.id]);
  for (let id = linkOf(row.id); rows.has(id) && !rows.get(id).routine && !seen.has(id); id = linkOf(id)) {
    seen.add(id);
    chain.push(rows.get(id));
  }
  return chain;
}

// The chain without a cycle. A chain back to its own row is a cycle, so that row has no ancestors. One that runs into a cycle
// without the row in it stops at the first session of the cycle it reaches, which then shows at the top level.
function ancestorsOf(rows, linkOf, row) {
  const chain = chainOf(rows, linkOf, row);
  const back = linkOf((chain.at(-1) ?? row).id);
  if (back === row.id) return [];
  const entry = chain.findIndex(a => a.id === back);
  return entry < 0 ? chain : chain.slice(0, entry + 1);
}

// For every row: `holder`, the id of the topmost ancestor its links reach (itself when none), `parent`, the id of the topmost one that is
// not archived, or `root` when none is, `root`, the id of the topmost one the listing shows, or null, and `near`, the id of the nearest
// one the listing shows, or null. Archived sessions are not shown unless `archived` is set, so without it `root` is `parent`. Every
// parent is top level, and the children of an archived parent move up to its place.
// NOTE: [2 Nov 2026] EK - `parent` is the head the live list shows, never `near`. The list, archive and the sub session tools all walk
// `parent`, so a chain of links is one level deep in each of them alike, and only an archived `root` sits above a live head.
// See docs/adr/20261022-nest-sessions-under-a-parent.md, amended 2026-11-02.
export function familiesOf(rows, linkOf, { archived = false } = {}) {
  const families = new Map();
  for (const row of rows.values()) {
    const above = ancestorsOf(rows, linkOf, row);
    const shown = above.filter(a => archived || !a.archived);
    const root = shown.at(-1)?.id ?? null;
    const live = above.filter(a => !a.archived).at(-1)?.id;
    families.set(row.id, { holder: (above.at(-1) ?? row).id, parent: live ?? root, root, near: shown[0]?.id ?? null });
  }
  return families;
}
