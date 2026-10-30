// GhostShell's one-off scheduled sessions. They live in scheduled.json in its state folder and start once, from the same 30 second check as
// the routines, whose catch-up limit, retry queue and wrapper they borrow. See docs/adr/20261030-a-one-off-is-its-own-list.md.
import path from 'node:path';
import { MAX_TITLE, cleanName, showsNothing } from './layout.mjs';
import { CATCH_UP_MS, GAVE_UP, ON_TIME_MS, PREAMBLE, RETRY_BACKOFF_MS, isObject, localIso, makeListFile, refuse, routineId, span, stamp, time } from './routines.mjs';

// `status` is pending until the session starts, then started. It is skipped when the time had passed by too much or the start could not
// be made, and cancelled when the owner called it off. `lastError` says why. `retry` is a start that threw and is queued to be tried again:
// { tries, nextAt }.
const BLANK = { group: null, status: 'pending', sessionId: null, startedAt: null, lastError: null, retry: null };
const KEYS = ['id', 'title', 'at', 'cwd', 'prompt', 'model', 'effort', 'mode', ...Object.keys(BLANK)];
const FIELD_NAMES = { title: 'title', at: 'date and time', cwd: 'folder', model: 'model', effort: 'effort', mode: 'permission mode', group: 'group', prompt: 'prompt' };
const CHOICES = ['model', 'effort', 'mode'];
const sentence = names => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

export const makeScheduledFile = stateDir => makeListFile({
  file: path.join(stateDir, 'scheduled.json'),
  key: 'scheduled',
  noun: 'scheduled session',
  blank: BLANK,
  keys: KEYS,
  prepare: s => ({ ...BLANK, ...s, title: typeof s.title === 'string' && s.title ? s.title : s.id }),
});

// The first message of a session, in the routines' tag with their preamble. It names no file, and `once` tells the transcript reader that
// it is not a routine's run.
export const wrapOneOff = (id, text) => `<scheduled-task name="${id}" once="true">\n${PREAMBLE}\n\n${text.trim()}\n</scheduled-task>`;

// What a request sent for each field, ready to save, and what is wrong with each, which `fieldProblems` adds the folder, model, effort and
// mode to. A group is sent by id or by name and saved by id. When adding, the title, time, folder and prompt are needed, and a field that
// is not sent is not checked or changed otherwise. `current` is the entry being edited, whose own time may stay as it is though it is past.
function readFields(input, adding, { fieldProblems, groups, now }, current) {
  const fields = {};
  const problems = {};
  const sent = key => input[key] !== undefined;
  if (sent('title') || adding) {
    const title = cleanName(input.title);
    if (showsNothing(title)) problems.title = 'Give the session a title.';
    else if ([...title].length > MAX_TITLE) problems.title = `A title runs to ${MAX_TITLE} characters at most.`;
    else fields.title = title;
  }
  if (sent('at') || adding) {
    const ms = typeof input.at === 'string' ? Date.parse(input.at) : NaN;
    if (Number.isNaN(ms)) problems.at = 'Give the date and time it should start, for example 2026-11-02T09:00.';
    else if (current && ms === time(current.at)) fields.at = current.at;
    else if (ms <= now()) problems.at = 'That time has already passed. Pick one in the future.';
    else fields.at = localIso(ms);
  }
  if (sent('cwd') || adding) {
    if (typeof input.cwd === 'string' && input.cwd.trim()) fields.cwd = input.cwd.trim();
    else problems.cwd = 'Give the full path of the folder the session starts in.';
  }
  for (const key of CHOICES) {
    if (sent(key) && input[key] !== null && typeof input[key] !== 'string') problems[key] = `Unknown ${FIELD_NAMES[key]}.`;
    else if (sent(key) || adding) fields[key] = (input[key] ?? '').trim() || null;
  }
  const given = typeof input.group === 'string' ? input.group.trim() : input.group;
  if (!sent('group') || given === null || given === '') {
    if (sent('group') || adding) fields.group = null;
  } else {
    const list = groups();
    const named = typeof given === 'string' ? cleanName(given).toLowerCase() : '';
    const byName = list.filter(g => cleanName(g.name).toLowerCase() === named);
    const match = list.find(g => g.id === given) ?? (byName.length === 1 ? byName[0] : null);
    if (match) fields.group = match.id;
    else problems.group = byName.length > 1 ? `More than one group is called ${given}.` : `There is no group called ${given}.`;
  }
  if (sent('prompt') || adding) {
    if (typeof input.prompt === 'string' && input.prompt.trim()) fields.prompt = input.prompt.trim();
    else problems.prompt = 'Write the prompt the session will start with.';
  }
  const found = fieldProblems({ ...input, ...fields });
  for (const key of ['cwd', ...CHOICES]) if ((sent(key) || adding) && found[key] && !problems[key]) problems[key] = found[key];
  return { fields, problems };
}

function refusedFields(problems) {
  const names = Object.keys(FIELD_NAMES).filter(key => problems[key]);
  return Object.assign(refuse(400, `Nothing was saved. Check the ${sentence(names.map(key => FIELD_NAMES[key]))}.`), { problems: Object.fromEntries(names.map(key => [key, problems[key]])) });
}

// `start(entry, text)` starts a session with the wrapped prompt and resolves with its id. `groups()` lists the groups that exist and
// `place(sessionId, groupId)` puts a started session into one and says whether it did. `working(sessionId)` says whether a started session
// is still busy and `waiting(sessionId)` whether that is only waiting for an answer, which the limit on sessions running at once does not
// count, as the routines' does not. `check(entry)` may name a reason it cannot start, `fieldProblems(entry)` maps the folder, model, effort
// and mode to a sentence each, and `restarting()` says whether a restart of GhostShell is under way, which holds the retries. `now`, `log`
// and `warn` let a test use a fake clock.
export function makeScheduledSessions({ store, start, groups = () => [], place = () => true, working = () => false, waiting = () => false, limit = Infinity, check = () => null, fieldProblems = () => ({}), restarting = () => false, now = Date.now, log = console.log, warn = console.error }) {
  const starting = new Set();
  const warned = new Map();
  const told = new Map();

  // An entry that cannot be read is said once, not on every check. The same goes for a wait said again on the next check.
  const complain = (key, message) => { if (warned.get(key) !== message) { warned.set(key, message); warn(message); } };
  const tell = (key, message) => { if (told.get(key) !== message) { told.set(key, message); log(message); } };
  const occupying = s => starting.has(s.id) || (s.status === 'started' && !!s.sessionId && !!working(s.sessionId) && !waiting(s.sessionId));

  // The sentence a start is refused with, or null. The id goes in the wrapper's quoted attribute.
  function problemWith(s) {
    if (!/^[\w-]+$/.test(s.id)) return 'The id can only hold letters, digits, dashes and underscores.';
    if (typeof s.prompt !== 'string' || !s.prompt.trim()) return 'The prompt is empty.';
    return check(s);
  }

  function summary(s) {
    const problem = s.status !== 'pending' ? null : time(s.at) ? problemWith(s) : 'The date and time cannot be read.';
    const { id, title, at, cwd, prompt, model, effort, mode, group, status, sessionId, startedAt, lastError, retry } = s;
    return { id, title, at, cwd, prompt, model, effort, mode, group, groupName: groups().find(g => g.id === group)?.name ?? null, status, sessionId, startedAt, lastError, retry, running: occupying(s), problem };
  }

  function find(id) {
    const data = store.read();
    if (data.problem) throw refuse(500, data.problem);
    const entry = data.scheduled.find(s => s.id === id);
    if (!entry) throw refuse(404, 'No scheduled session with that id.');
    return entry;
  }

  const pendingOnly = (s, action) => {
    if (starting.has(s.id)) throw refuse(409, `${s.title} is starting.`);
    if (s.status !== 'pending') throw refuse(409, `${s.title} is ${s.status}, so it cannot be ${action}.`);
  };

  // What a start that threw leaves: the entry queued for another try, or skipped once the next try would be past the limit. The wait counts
  // from `failedAt`, since a start that never comes up fails only at its timeout.
  function queueRetry(s, failedAt) {
    const tries = (Number.isInteger(s.retry?.tries) && s.retry.tries > 0 ? s.retry.tries : 0) + 1;
    const nextAt = failedAt + RETRY_BACKOFF_MS[Math.min(tries, RETRY_BACKOFF_MS.length) - 1];
    if (nextAt >= time(s.at) + CATCH_UP_MS) {
      log(`Scheduled session ${s.id}: gave up the ${stamp(time(s.at))} start (${GAVE_UP})`);
      return { status: 'skipped', startedAt: null, retry: null, lastError: GAVE_UP };
    }
    log(`Scheduled session ${s.id}: will try the ${stamp(time(s.at))} start again at ${stamp(nextAt)}`);
    return { status: 'pending', startedAt: null, retry: { tries, nextAt: localIso(nextAt) } };
  }

  // `queued` is a start at the set time, which a failure queues. A start now that fails leaves the entry as it was. The entry is marked
  // started before the session starts, so a crash mid-start is never retried into a second session. A start that threw is queued and a
  // refusal is not, since it is a problem with the entry and no try will fix it.
  async function launch(s, how, queued) {
    starting.add(s.id);
    try {
      let sessionId;
      let refused = false;
      try {
        store.update(s.id, { status: 'started', startedAt: localIso(now()), sessionId: null, lastError: null, retry: null });
        const problem = problemWith(s);
        if (problem) { refused = true; throw refuse(400, problem); }
        sessionId = await start(s, wrapOneOff(s.id, s.prompt));
      } catch (e) {
        const back = !queued ? { status: 'pending', startedAt: null, lastError: s.lastError, retry: s.retry }
          : refused ? { status: 'skipped', startedAt: null, retry: null }
            : queueRetry(s, now());
        try { store.update(s.id, { lastError: e.message, ...back }); } catch {}
        warn(`Scheduled session ${s.id}: could not start (${e.message})`);
        throw e;
      }
      // The session is running by now, so a group that is gone or cannot take it is told in lastError and the session stays on Home.
      const home = s.group ? groups().find(g => g.id === s.group) : null;
      const note = !s.group ? null : !home ? 'Its group was deleted, so it started on Home.' : place(sessionId, home.id) ? null : `It started, but could not be put in the group ${home.name}.`;
      try { store.update(s.id, { sessionId, ...(note && { lastError: note }) }); } catch (e) { warn(`Scheduled session ${s.id}: started session ${sessionId} but could not save it (${e.message})`); }
      log(`Scheduled session ${s.id}: started session ${sessionId} (${how})${note ? `. ${note}` : ''}`);
      return sessionId;
    } finally {
      starting.delete(s.id);
    }
  }

  // A start that failed, tried again once its wait is over. It waits for a restart to finish and for a free place, and says why once.
  function retryFailed(s, t, room) {
    const key = `retry:${s.id}`;
    const due = time(s.at);
    if (t < time(s.retry.nextAt)) return null;
    if (restarting()) {
      tell(key, `Scheduled session ${s.id}: holding the retry of the ${stamp(due)} start while GhostShell restarts`);
      return null;
    }
    if (room.free <= 0) {
      tell(key, `Scheduled session ${s.id}: waiting for a free place to retry the ${stamp(due)} start, with ${limit} sessions already running`);
      return null;
    }
    room.free -= 1;
    told.delete(key);
    return launch(s, `try ${s.retry.tries + 1} for ${stamp(due)}`, true).catch(() => {});
  }

  // What to do about one pending entry at `t`. It returns the promise of the session it started, if it started one. `room` counts the free
  // places under the limit, and an entry due while there are none stays due until one frees up.
  function consider(s, t, room) {
    const due = time(s.at);
    if (!due) {
      complain(s.id, `Scheduled session ${s.id}: the date and time cannot be read, so it never starts`);
      return null;
    }
    warned.delete(s.id);
    if (due > t || starting.has(s.id)) return null;
    const late = t - due;
    if (late >= CATCH_UP_MS) {
      const why = s.retry ? GAVE_UP : `${span(late)} late, over the ${span(CATCH_UP_MS)} limit`;
      store.update(s.id, { status: 'skipped', retry: null, lastError: why });
      log(`Scheduled session ${s.id}: skipped the ${stamp(due)} start (${why})`);
      return null;
    }
    if (s.retry) return retryFailed(s, t, room);
    if (room.free <= 0) {
      tell(`slot:${s.id}`, `Scheduled session ${s.id}: waiting for a free place, with ${limit} sessions already running`);
      return null;
    }
    room.free -= 1;
    told.delete(`slot:${s.id}`);
    return launch(s, late < ON_TIME_MS ? `due ${stamp(due)}` : `catch-up for ${stamp(due)}, ${span(late)} late`, true).catch(() => {});
  }

  const forget = id => {
    warned.delete(id);
    told.delete(`slot:${id}`);
    told.delete(`retry:${id}`);
  };

  return {
    // Starts whatever has come due. Safe to call while an earlier call is still starting a session.
    async tick() {
      const t = now();
      const data = store.read();
      if (data.problem) complain('scheduled.json', data.problem);
      else warned.delete('scheduled.json');
      const jobs = [];
      const room = { free: limit - data.scheduled.filter(occupying).length };
      for (const s of data.scheduled) {
        if (s.status !== 'pending') continue;
        try {
          const job = consider(s, t, room);
          if (job) jobs.push(job);
        } catch (e) {
          complain(s.id, `Scheduled session ${s.id}: ${e.message}`);
        }
      }
      await Promise.all(jobs);
    },

    // Starts a pending session now, over the limit if need be. A start that fails leaves it pending, as it was.
    async startNow(id) {
      const s = find(id);
      pendingOnly(s, 'started now');
      const sessionId = await launch(s, 'start now', false);
      return { sessionId, scheduled: summary(find(id)) };
    },

    // Everything is checked before anything is written, so a refusal changes nothing.
    add(input) {
      if (!isObject(input)) throw refuse(400, 'Send the scheduled session as a JSON object.');
      const data = store.read();
      if (data.problem) throw refuse(500, data.problem);
      const { fields, problems } = readFields(input, true, { fieldProblems, groups, now });
      if (Object.keys(problems).length) throw refusedFields(problems);
      const id = routineId(fields.title, taken => data.scheduled.some(s => s.id === taken));
      store.add({ id, ...fields });
      log(`Scheduled session ${id}: added for ${stamp(time(fields.at))}`);
      return summary(find(id));
    },

    // Only a pending session can be edited. A new time also clears its queued retry and the record of a failed try.
    edit(id, patch) {
      const s = find(id);
      pendingOnly(s, 'edited');
      if (!isObject(patch)) throw refuse(400, 'Send the changes as a JSON object.');
      const { fields, problems } = readFields(patch, false, { fieldProblems, groups, now }, s);
      if (Object.keys(problems).length) throw refusedFields(problems);
      const changes = { ...fields, ...(fields.at !== undefined && fields.at !== s.at && { retry: null, lastError: null }) };
      const changed = Object.keys(changes).length ? store.update(id, changes) : s;
      if (Object.keys(fields).length) log(`Scheduled session ${id}: edited ${Object.keys(fields).join(', ')}`);
      return summary(changed);
    },

    // Keeps the entry, as cancelled, so the list still says what was planned.
    cancel(id) {
      const s = find(id);
      pendingOnly(s, 'cancelled');
      const changed = store.update(id, { status: 'cancelled', retry: null });
      forget(id);
      log(`Scheduled session ${id}: cancelled`);
      return summary(changed);
    },

    // Removes the entry whatever it has become. The session it started stays.
    remove(id) {
      const s = find(id);
      if (starting.has(id)) throw refuse(409, `${s.title} is starting, so it cannot be deleted yet.`);
      store.remove(id);
      forget(id);
      log(`Scheduled session ${id}: deleted`);
      return id;
    },

    list() {
      const data = store.read();
      return { scheduled: data.scheduled.map(summary), problem: data.problem || null };
    },
  };
}
