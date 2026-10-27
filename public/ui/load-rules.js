// What the chat body shows while a session's history loads, as a rule that needs no page, so node can test it.
// A new session has no history to load, and a message being sent already fills the body.
export function loadingView({ draft, loaded, failed, sending }) {
  if (draft) return null;
  if (failed) return 'failed';
  return !loaded && !sending ? 'loading' : null;
}
