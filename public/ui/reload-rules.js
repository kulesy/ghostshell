// When an open page reloads itself after the server moved to a new commit, as rules that need no page, so node can test them.

// `seen` is the first commit this page was given. A server that sends none, or a page that has not seen one yet, never counts as a change.
export function noticeCommit(seen, ix) {
  const commit = ix?.commit || null;
  return { seen: seen ?? commit, changed: !!seen && !!commit && seen !== commit };
}

// A page with nothing to lose reloads at once. One with unsent words or an open approval card asks first.
export const reloadStep = ({ changed, unsent, approving }) => (!changed ? 'none' : unsent || approving ? 'bar' : 'now');

export const RELOAD_TITLE = 'GhostShell was updated';
