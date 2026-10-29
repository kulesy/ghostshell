// Archiving one session from a card, the way the sidebar's row does it: at once when it is idle, after a question when it is running, with Undo.
import { ask } from './ask.js';
import { say } from './toast.js';

export const STOP_DETAIL = "Archiving stops Claude's turn and denies any approval it is waiting for. Undo brings the session back, but not the turn.";

export const isRunning = row => row.state === 'working' || row.state === 'waiting';

// A refusal keeps a retry on the note. `retry` is its label, Undo where this follows an archive.
export async function unarchiveSession({ archive, id, title, retry = 'Undo' }) {
  const { problem } = await archive(id, false);
  if (problem) say(problem, { problem: true, action: { label: retry, onClick: () => unarchiveSession({ archive, id, title, retry }) } });
  else say(`Unarchived “${title}”.`);
}

// `archive(id, archived, { stop })` is the page's, and resolves with { problem, stopped, running }. `leaving` runs as the card is about to go,
// `settled` once the request has answered, `done` once the session is archived, `stayed` if it is not going after all, and `back` says where the focus goes if the owner declines.
export async function closeSession({ archive, id, title, running, leaving, settled, done, stayed, back }) {
  const stop = () => ask({ action: 'Stop and archive', title, detail: STOP_DETAIL, back, run: () => go(true) });
  async function go(stopping) {
    leaving?.();
    let reply;
    try { reply = await archive(id, true, { stop: stopping }); } finally { settled?.(); }
    const { problem, stopped, running: busy } = reply;
    if (busy) {
      stayed?.();
      return stop();
    }
    if (problem) {
      stayed?.();
      return say(problem, { problem: true });
    }
    done?.();
    return say(`${stopped ? 'Stopped and archived' : 'Archived'} “${title}”.`, { action: { label: 'Undo', onClick: () => unarchiveSession({ archive, id, title }) } });
  }
  return running ? stop() : go(false);
}
