// The owner's setting for how far a session's send_session goes without a card, and each session's count of sends made without one since the owner last wrote to it.
// Only the owner's page and apps set it, and no tool reads it. See docs/adr/20261023-roll-sub-session-status-up.md (amended 2026-11-24).
import fs from 'node:fs';
import path from 'node:path';

export const REACHES = ['family', 'project', 'any'];
export const SEND_LIMIT = 10;

const whole = n => Number.isSafeInteger(n) && n > 0;

export function makeSendReach(stateDir, { warn = () => {} } = {}) {
  const file = path.join(stateDir, 'send-reach.json');
  let reach = 'family';
  // A Map, so an id such as __proto__ is an ordinary key.
  const sent = new Map();

  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (text !== null) try {
    const got = JSON.parse(text);
    if (!got || typeof got !== 'object' || Array.isArray(got)) throw new Error('not an object');
    if (REACHES.includes(got.reach)) reach = got.reach;
    // An entry that is not a whole count is kept at the limit, so a damaged file cannot give a session a fresh 10.
    const counts = got.sent && typeof got.sent === 'object' && !Array.isArray(got.sent) ? got.sent : {};
    for (const [id, n] of Object.entries(counts)) sent.set(id, whole(n) ? Math.min(n, SEND_LIMIT) : SEND_LIMIT);
  } catch {
    // The next save would overwrite a corrupt file, so it is moved aside. Its content is not quoted.
    try {
      fs.renameSync(file, `${file}.bad-${Date.now()}`);
      warn('send-reach.json could not be read and was moved aside. Sends ask for a card as they do by default.');
    } catch { /* the default alone */ }
  }

  const save = () => {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ reach, sent: Object.fromEntries(sent) }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  };

  return {
    reach: () => reach,
    setReach(value) {
      if (!REACHES.includes(value)) return false;
      const was = reach;
      reach = value;
      try { save(); } catch (e) { reach = was; throw e; }
      return true;
    },
    // Counts a send made with no card, and says whether it may go. A count that cannot be saved is not let through, so a restart cannot hand back the sends.
    take(id) {
      if (typeof id !== 'string' || !id) return false;
      const n = sent.get(id) ?? 0;
      if (n >= SEND_LIMIT) return false;
      sent.set(id, n + 1);
      try { save(); } catch { sent.set(id, n); if (!n) sent.delete(id); return false; }
      return true;
    },
    // The owner wrote to the session, so its count starts again.
    ownerSpoke(id) {
      if (!sent.has(id)) return;
      const n = sent.get(id);
      sent.delete(id);
      try { save(); } catch { sent.set(id, n); }
    },
  };
}
