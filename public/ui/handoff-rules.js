// What a chat and its row say about the handoff a session saved before its prompt cache went cold. The server's row has `cold` and `coldAt` while the
// handoff waits, `continuedIn` on the session the work left, and `continues` on the one it went to.
import { sentAt } from './format.js';

export const COLD_LABEL = 'Handoff saved';

const hash = id => `#/s/${encodeURIComponent(id)}`;

// The lines drawn by the prompt box, each { text, href, label }, for a row the server listed. The link is left out when there is none.
export function handoffLines(row) {
  if (!row) return [];
  const at = row.coldAt ? sentAt(new Date(row.coldAt).toISOString()) : '';
  return [
    row.cold && { text: `Handoff saved${at ? ` at ${at}` : ''}, your next message starts a fresh session from it.` },
    row.continues && { text: 'This session carries on from an earlier one.', href: hash(row.continues), label: 'Open the earlier session' },
    row.continuedIn && { text: 'This work carries on in a fresh session.', href: hash(row.continuedIn), label: 'Open it' },
  ].filter(Boolean);
}
