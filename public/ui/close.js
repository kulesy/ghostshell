// Archiving one session from a card, the way the sidebar's row does it: at once when it is idle, after a question when it is running, with Undo.
import { ask } from './ask.js';
import { familyDetail, withSubs } from './pick.js';
import { descendantsOf } from './sub-rules.js';
import { say } from './toast.js';

export const STOP_DETAIL = "Archiving stops Claude's turn and denies any approval it is waiting for. Undo brings the session back, but not the turn.";

export const isRunning = row => row.state === 'working' || row.state === 'waiting';

// How many sessions below `id`, at any depth, are running or waiting on the owner, which archiving it would stop too.
export const subsRunning = (rows, id) => descendantsOf(rows, id).filter(isRunning).length;

export const stopQuestion = (subs, self) => (subs ? familyDetail(subs, self) : STOP_DETAIL);

// A refusal keeps a retry on the note. `retry` is its label, Undo where this follows an archive.
export async function unarchiveSession({ archive, id, title, retry = 'Undo' }) {
  const { problem, subs } = await archive(id, false);
  if (problem) say(problem, { problem: true, action: { label: retry, onClick: () => unarchiveSession({ archive, id, title, retry }) } });
  else say(`Unarchived “${title}”${withSubs(subs)}.`);
}

// `archive(id, archived, { stop })` is the page's, and resolves with { problem, stopped, running, subs }, where `running` is { self, subs } when the server refused to stop a chat unasked. `subsRunning` is how many sessions below it
// the list shows running or waiting. `leaving` runs as the card is about to go, `settled` once the request has answered, `done` once the session is archived, `stayed` if it is not going after all, and `back` says where the focus goes if the owner declines.
export async function closeSession({ archive, id, title, running, subsRunning: below = 0, leaving, settled, done, stayed, back }) {
  const stop = (subs, self) => ask({ action: 'Stop and archive', title, detail: stopQuestion(subs, self), back, run: () => go(true) });
  async function go(stopping) {
    leaving?.();
    let reply;
    try { reply = await archive(id, true, { stop: stopping }); } finally { settled?.(); }
    const { problem, stopped, running: busy, subs } = reply;
    if (busy) {
      stayed?.();
      return stop(busy.subs, busy.self);
    }
    if (problem) {
      stayed?.();
      return say(problem, { problem: true });
    }
    done?.();
    return say(`${stopped ? 'Stopped and archived' : 'Archived'} “${title}”${withSubs(subs)}.`, { action: { label: 'Undo', onClick: () => unarchiveSession({ archive, id, title }) } });
  }
  return running || below ? stop(below, running) : go(false);
}
