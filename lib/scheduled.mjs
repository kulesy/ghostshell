// GhostShell's one-off scheduled sessions. They live in scheduled.json in its state folder and start once, from the same 30 second check as
// the routines, whose catch-up limit, retry queue and wrapper they borrow. See docs/adr/20261030-a-one-off-is-its-own-list.md.
import path from 'node:path';
import { groupNamed } from './layout-tools.mjs';
import { CATCH_UP_MS, COMMON_NAMES, GAVE_UP, ON_TIME_MS, PREAMBLE, isObject, localIso, makeListFile, makeNotes, nextTry, readCommonFields, refuse, refusedFields, routineId, span, stamp, time } from './routines.mjs';

// `status` is pending until the session starts, then started. It is skipped when the time had passed by too much or the start could not
// be made, and cancelled when the owner called it off. `lastError` says why. `retry` is a start that threw and is queued to be tried again:
// { tries, nextAt }. A status outside STATUSES is a hand edit gone wrong, and the entry never starts.
const STATUSES = ['pending', 'started', 'skipped', 'cancelled'];
const BLANK = { group: null, status: 'pending', sessionId: null, startedAt: null, lastError: null, retry: null };
const KEYS = ['id', 'title', 'at', 'cwd', 'prompt', 'model', 'effort', 'mode', ...Object.keys(BLANK)];
const FIELD_NAMES = { title: COMMON_NAMES.title, at: 'date and time', cwd: COMMON_NAMES.cwd, model: COMMON_NAMES.model, effort: COMMON_NAMES.effort, mode: COMMON_NAMES.mode, group: 'group', prompt: 'prompt' };

export const makeScheduledFile = stateDir => makeListFile({
  file: path.join(stateDir, 'scheduled.json'),
  key: 'scheduled',
  noun: 'scheduled session',
  blank: BLANK,
  keys: KEYS,
  prepare: s => ({ ...BLANK, ...s, title: typeof s.title === 'string' && s.title ? s.title : s.id }),
});

// The routines' preamble says "the task file", and a one-off has a prompt, so the session reads it as the thing that allows its write actions.
const ONE_OFF_PREAMBLE = PREAMBLE.replace('if the task file asks', 'if the prompt asks');

// The first message of a session, in the routines' tag. It names no file, and `once` tells the transcript reader that it is not a routine's run.
export const wrapOneOff = (id, text) => `<scheduled-task name="${id}" once="true">\n${ONE_OFF_PREAMBLE}\n\n${text.trim()}\n</scheduled-task>`;

// What a request sent for each field, ready to save, and what is wrong with each. The title, folder, model, effort and mode are read as a
// routine's are. A group is sent by id or by name and saved by id. When adding, the title, time, folder and prompt are needed, and a field
// that is not sent is not checked or changed otherwise. `current` is the entry being edited, whose own time may stay as it is though it is past.
function readFields(input, adding, { fieldProblems, groups, now }, current) {
  const { fields, problems } = readCommonFields(input, adding, { noun: 'scheduled session', startsIn: 'starts in' }, fieldProblems);
  const sent = key => input[key] !== undefined;
  if (sent('at') || adding) {
    const ms = typeof input.at === 'string' ? Date.parse(input.at) : NaN;
    if (Number.isNaN(ms)) problems.at = 'Give the date and time it should start, for example 2026-11-02T09:00.';
    else if (current && ms === time(current.at)) fields.at = current.at;
    else if (ms <= now()) problems.at = 'That time has already passed. Pick one in the future.';
    else fields.at = localIso(ms);
  }
  const given = typeof input.group === 'string' ? input.group.trim() : input.group;
  if (!sent('group') || given === null || given === '') {
    if (sent('group') || adding) fields.group = null;
  } else {
    const picked = typeof given === 'string' ? groupNamed(given, groups(), 'GhostShell', found => `Use the id of one of them instead: ${found.map(g => g.id).join(', ')}.`) : { refusal: 'Send the group as its name or its id.' };
    if (picked.group) fields.group = picked.group.id;
    else problems.group = picked.refusal;
  }
  if (sent('prompt') || adding) {
    if (typeof input.prompt === 'string' && input.prompt.trim()) fields.prompt = input.prompt.trim();
    else problems.prompt = 'Write the prompt the session will start with.';
  }
  return { fields, problems };
}

// `start(entry, text)` starts a session with the wrapped prompt and resolves with its id. `groups()` lists the groups that exist and
// `place(sessionId, groupId)` puts a started session into one and says whether it did. `working(sessionId)` says whether a started session
// is still busy and `waiting(sessionId)` whether that is only waiting for an answer, which the limit on sessions running at once does not
// count, as the routines' does not. `elsewhere()` counts the routines' sessions that are running, which share the limit. `check(entry)` may name a reason it cannot start, `fieldProblems(entry)` maps the folder, model, effort
// and mode to a sentence each, and `restarting()` says whether a restart of GhostShell is under way, which holds the retries. `now`, `log`
// and `warn` let a test use a fake clock.
export function makeScheduledSessions({ store, start, groups = () => [], place = () => true, working = () => false, waiting = () => false, limit = Infinity, elsewhere = () => 0, check = () => null, fieldProblems = () => ({}), restarting = () => false, now = Date.now, log = console.log, warn = console.error }) {
  const starting = new Set();
  const { warned, told, complain, tell } = makeNotes(log, warn);
  // The entries this process started, by id, with the time each was for and the session. A person can save an older copy of scheduled.json
  // over the file, which puts a started entry back to pending, so this decides whether an entry has started and the file does not.
  // A new time is a new start, so an edit to the time lets the entry go again.
  const launched = new Map();
  const occupying = s => starting.has(s.id) || (s.status === 'started' && !!s.sessionId && !!working(s.sessionId) && !waiting(s.sessionId));

  // The sentence a start is refused with, or null. The id goes in the wrapper's quoted attribute.
  function problemWith(s) {
    if (!/^[\w-]+$/.test(s.id)) return 'The id can only hold letters, digits, dashes and underscores.';
    if (typeof s.prompt !== 'string' || !s.prompt.trim()) return 'The prompt is empty.';
    return check(s);
  }

  // What is wrong with an entry as it stands, or null. A pending one is checked as it would be started. One that started and kept no session
  // is a crash mid-start, and a status GhostShell does not know is a hand edit, which never starts.
  function problemOf(s) {
    if (!STATUSES.includes(s.status)) return `The status "${s.status}" is not one of ${STATUSES.join(', ')}, so it never starts.`;
    if (s.status === 'started') return s.sessionId || starting.has(s.id) ? null : 'Started, but no session was recorded.';
    if (s.status !== 'pending') return null;
    return time(s.at) ? problemWith(s) : 'The date and time cannot be read.';
  }

  function summary(s) {
    const problem = problemOf(s);
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
    const { tries, nextAt, gaveUp } = nextTry(Number.isInteger(s.retry?.tries) && s.retry.tries > 0 ? s.retry.tries : 0, failedAt, time(s.at));
    if (gaveUp) {
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
        launched.set(s.id, { at: time(s.at), sessionId: null });
        const problem = problemWith(s);
        if (problem) { refused = true; throw refuse(400, problem); }
        sessionId = await start(s, wrapOneOff(s.id, s.prompt));
      } catch (e) {
        launched.delete(s.id);
        const back = !queued ? { status: 'pending', startedAt: null, lastError: s.lastError, retry: s.retry }
          : refused ? { status: 'skipped', startedAt: null, retry: null }
            : queueRetry(s, now());
        try { store.update(s.id, { lastError: e.message, ...back }); } catch {}
        warn(`Scheduled session ${s.id}: could not start (${e.message})`);
        throw e;
      }
      launched.get(s.id).sessionId = sessionId;
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
      tell(key, `Scheduled session ${s.id}: waiting for a free place to retry the ${stamp(due)} start, with ${limit} automated sessions already running`);
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
    // This process started it for this time, so a file that says pending is an older copy saved over it. The entry goes back to what happened.
    const done = launched.get(s.id);
    if (done?.at === due) {
      store.update(s.id, { status: 'started', sessionId: done.sessionId, retry: null });
      log(`Scheduled session ${s.id}: already started for ${stamp(due)}, so the pending entry in the file was put back to started`);
      return null;
    }
    const late = t - due;
    if (late >= CATCH_UP_MS) {
      const why = s.retry ? GAVE_UP : `${span(late)} late, over the ${span(CATCH_UP_MS)} limit`;
      store.update(s.id, { status: 'skipped', retry: null, lastError: why });
      log(`Scheduled session ${s.id}: skipped the ${stamp(due)} start (${why})`);
      return null;
    }
    if (s.retry) return retryFailed(s, t, room);
    if (room.free <= 0) {
      tell(`slot:${s.id}`, `Scheduled session ${s.id}: waiting for a free place, with ${limit} automated sessions already running`);
      return null;
    }
    room.free -= 1;
    told.delete(`slot:${s.id}`);
    return launch(s, late < ON_TIME_MS ? `due ${stamp(due)}` : `catch-up for ${stamp(due)}, ${span(late)} late`, true).catch(() => {});
  }

  const forget = id => {
    launched.delete(id);
    warned.delete(id);
    warned.delete(`status:${id}`);
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
      const room = { free: limit - elsewhere() - data.scheduled.filter(occupying).length };
      for (const s of data.scheduled) {
        if (!STATUSES.includes(s.status)) complain(`status:${s.id}`, `Scheduled session ${s.id}: ${problemOf(s)}`);
        else warned.delete(`status:${s.id}`);
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
      if (Object.keys(problems).length) throw refusedFields(problems, FIELD_NAMES);
      const id = routineId(fields.title, taken => data.scheduled.some(s => s.id === taken), 'scheduled-session');
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
      if (Object.keys(problems).length) throw refusedFields(problems, FIELD_NAMES);
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

    // How many of the sessions started from here are starting or working now, which the routines count against the shared limit.
    occupied: () => store.read().scheduled.filter(occupying).length,

    list() {
      const data = store.read();
      return { scheduled: data.scheduled.map(summary), problem: data.problem || null };
    },
  };
}
