// GhostShell's routine scheduler. Routines live in routines.json in its state folder and fire from here, each from a prompt file:
// GhostShell's own copy in its routines folder, or a file anywhere on the Mac that the routine points at.
// See docs/adr/20261015-capcom-runs-routines-itself.md and docs/adr/20261025-ghostshell-is-the-only-home-for-routines.md.
import fs from 'node:fs';
import path from 'node:path';
import { nextFire, parseCron } from './cron.mjs';
import { MAX_TITLE, cleanName, showsNothing } from './layout.mjs';

// A fire time that has passed is run once if it is under this late, and skipped if it is not.
export const CATCH_UP_MS = 12 * 3600_000;
// The check comes round every 30 seconds, so a run later than this is logged as a catch-up.
const ON_TIME_MS = 2 * 60_000;
// The wait after the first, second, third and fourth failed start of one fire, and after every later one the last of them.
export const RETRY_BACKOFF_MS = [1, 2, 5, 10, 15].map(minutes => minutes * 60_000);
const GAVE_UP = `could not start within the ${span(CATCH_UP_MS)} limit`;
// After a long stop the search for missed fires starts no further back than this, which keeps it short.
const LOOKBACK_MS = 7 * 86400_000;

// ---- the run's prompt ------------------------------------------------------------------------------

// NOTE: [15 Oct 2026] EK - Desktop's own wording for a routine run, copied byte for byte from its runs. It is the one place
// in this repo with an em dash. The routines were written against this text, so leave it exactly as it is.
export const PREAMBLE = 'This is an automated run of a scheduled task. The user is not present to answer questions. For implementation details, execute autonomously without asking clarifying questions — make reasonable choices and note them in your output. "write" actions (e.g. MCP tools that send, post, create, update, or delete), only take them if the task file asks for that specific action. When in doubt, producing a report of what you found is the correct output.';

const FRONTMATTER = /^---[ \t]*\r?\n(?:---|[\s\S]*?\r?\n---)[ \t]*(?:\r?\n|$)/;

// The first message of a run: the body of SKILL.md without its frontmatter, inside the tag Capcom's transcript reader looks for.
const bodyOf = text => text.replace(FRONTMATTER, '').trim();
export const wrapPrompt = (id, file, text) => `<scheduled-task name="${id}" file="${file}">\n${PREAMBLE}\n\n${bodyOf(text)}\n</scheduled-task>`;

// ---- times ----------------------------------------------------------------------------------------

const pad = n => String(n).padStart(2, '0');

// Local time as 2026-10-16 07:42:17, for the log.
export function stamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Local time with its offset, as 2026-10-16T07:42:17+11:00, for routines.json and the API. Date.parse reads it back.
export function localIso(ms) {
  const offset = -new Date(ms).getTimezoneOffset();
  return `${stamp(ms).replace(' ', 'T')}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

function span(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

const time = value => (typeof value === 'number' ? value : Date.parse(value)) || 0;

// The next `count` times a schedule fires after `from`, as localIso strings. A bad schedule throws parseCron's message, and one
// that never fires gives an empty list.
export function upcoming(cron, jitterSeconds, from, count = 3) {
  const times = [];
  for (let t = nextFire(cron, from, jitterSeconds); t !== null && times.length < count; t = nextFire(cron, t, jitterSeconds)) times.push(localIso(t));
  return times;
}

// Under a day, so a jittered fire stays on the day its schedule names.
export const MAX_JITTER_SECONDS = 86399;
export const JITTER_PROBLEM = `Use a whole number of seconds from 0 to ${MAX_JITTER_SECONDS}.`;
export const validJitter = n => Number.isInteger(n) && n >= 0 && n <= MAX_JITTER_SECONDS;

// Node keeps the time zone it started in, so a change of zone (a trip) is followed by watching the link macOS keeps at
// /etc/localtime. A name Intl refuses is ignored, because Node would read it as UTC.
export function makeZoneFollower({ link = '/etc/localtime', log = console.log } = {}) {
  const read = () => { try { return fs.readlinkSync(link); } catch { return null; } };
  let seen = read();
  return () => {
    const target = read();
    if (!target || target === seen) return;
    seen = target;
    const zone = target.split('/zoneinfo/')[1];
    if (!zone) return;
    try { new Intl.DateTimeFormat(undefined, { timeZone: zone }); } catch { return; }
    process.env.TZ = zone;
    log(`The Mac's time zone is now ${zone}, so routines follow it.`);
  };
}

// ---- routines.json --------------------------------------------------------------------------------

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (status, message) => Object.assign(new Error(message), { status });

// What GhostShell keeps for each routine beside what a person sets. `armedAt` is where the schedule counts from: the moment it
// was switched on, then each run or skipped fire. It is empty while the routine is off. `lastRunAt` is the last start or try.
// `retry` is the one fire that failed to start and is queued to be tried again: { fireAt, tries, nextAt }.
const BLANK = { enabled: false, armedAt: null, lastRunAt: null, lastSessionId: null, lastError: null, skipped: null, retry: null };

// The keys in the order a person reading routines.json wants them: what the routine is, then what has happened to it.
const KEYS = ['id', 'title', 'cron', 'jitterSeconds', 'file', 'cwd', 'model', 'effort', 'mode', ...Object.keys(BLANK)];
const ordered = r => ({ ...Object.fromEntries(KEYS.filter(k => k in r).map(k => [k, r[k]])), ...r });

// A new routine's id, from its title: lower case letters and digits with single dashes, at most 40 characters, and a number
// added until `taken` stops saying it is in use. It matches the route's ^[\w-]+$ and never changes once the routine is made.
export function routineId(title, taken = () => false) {
  const base = String(title ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '') || 'routine';
  // `new` is the add form's route, #/routines/new, so no new routine takes it.
  const free = id => id !== 'new' && !taken(id);
  if (free(base)) return base;
  for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
}

export function makeRoutines(stateDir) {
  const file = path.join(stateDir, 'routines.json');
  // The prompts GhostShell keeps itself, one plain text file for each routine. A prompt file anywhere else is only ever read.
  const promptDir = path.resolve(stateDir, 'routines');
  const promptFile = id => {
    if (!/^[\w-]+$/.test(id)) throw refuse(400, 'Bad routine id');
    return path.join(promptDir, `${id}.md`);
  };
  const ours = promptPath => typeof promptPath === 'string' && path.dirname(path.resolve(promptPath)) === promptDir;
  // Anywhere under the prompt folder, through a link too, which is edited as GhostShell's own text and so is not for a routine to point at.
  // `.native` gives the case the disk holds, so ROUTINES/ is the prompt folder on a Mac whose disk ignores case.
  const inPromptFolder = promptPath => {
    const real = p => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
    const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);
    return inside(path.resolve(promptPath), promptDir) || inside(real(promptPath), real(promptDir));
  };

  // Read from disk each time, so a hand edit shows on the next check. A missing file is an empty list. A file that cannot be read,
  // has a routine without an id or has an id twice is reported and left alone, so a typo is never written over and a copied
  // routine never runs twice.
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!isObject(data) || !Array.isArray(data.routines)) throw new Error('expected an object with a list of routines');
      const ids = data.routines.map(r => (isObject(r) ? r.id : undefined));
      if (ids.some(id => typeof id !== 'string')) throw new Error('every routine needs an id');
      const twice = ids.find((id, i) => ids.indexOf(id) !== i);
      if (twice !== undefined) throw new Error(`more than one routine has the id "${twice}"`);
      // enabledInDesktop is dropped here so the next write leaves it out of the file.
      const routines = data.routines.map(({ enabledInDesktop, ...r }) => ({ ...BLANK, ...r, title: typeof r.title === 'string' && r.title ? r.title : r.id, jitterSeconds: Math.round(Number(r.jitterSeconds)) || 0 }));
      return { routines };
    } catch (e) {
      return { routines: [], ...(e.code === 'ENOENT' ? {} : { problem: `routines.json cannot be read: ${e.message}` }) };
    }
  }

  function write(data) {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ ...data, routines: data.routines.map(ordered) }, null, 2)}\n`);
    fs.renameSync(temp, file);
  }

  function editable() {
    const data = read();
    if (data.problem) throw refuse(500, data.problem);
    return data;
  }

  return {
    read,
    promptFile,
    ours,
    inPromptFolder,
    hasPrompt: id => fs.existsSync(promptFile(id)),

    // Writes only inside GhostShell's own prompt folder, through a temporary file, as routines.json is written.
    writePrompt(promptPath, text) {
      if (!ours(promptPath)) throw new Error(`${promptPath} is not in GhostShell's prompt folder.`);
      // Written where `ours` resolved it, so a path with a `..` in it is never opened as it was typed.
      const target = path.resolve(promptPath);
      fs.mkdirSync(promptDir, { recursive: true, mode: 0o700 });
      const temp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temp, text, { mode: 0o600 });
      fs.renameSync(temp, target);
    },

    update(id, patch) {
      const data = editable();
      const routine = data.routines.find(r => r.id === id);
      if (!routine) throw refuse(404, 'No routine with that id.');
      const changed = { ...routine, ...patch };
      write({ ...data, routines: data.routines.map(r => (r === routine ? changed : r)) });
      return changed;
    },

    add(routine) {
      const data = editable();
      if (data.routines.some(r => r.id === routine.id)) throw refuse(409, `A routine with the id ${routine.id} already exists.`);
      const added = { ...BLANK, ...routine };
      write({ ...data, routines: [...data.routines, added] });
      return added;
    },

    remove(id) {
      const data = editable();
      const routine = data.routines.find(r => r.id === id);
      if (!routine) throw refuse(404, 'No routine with that id.');
      write({ ...data, routines: data.routines.filter(r => r !== routine) });
      return routine;
    },
  };
}

// ---- when a routine fires -------------------------------------------------------------------------

// What to do about one routine at `now`. It counts from `armedAt`, so a run uses up the fires already due but not the ones to
// come. Of several missed fires only the latest matters, and only if it is under 12 hours late.
export function dueAction(routine, now) {
  const since = time(routine.armedAt);
  if (!since) return { action: 'arm' };
  const after = fire => nextFire(routine.cron, fire, routine.jitterSeconds);
  let fireAt = null;
  for (let t = after(Math.max(since, now - LOOKBACK_MS)); t !== null && t <= now; t = after(t)) fireAt = t;
  if (fireAt === null) return { action: 'wait' };
  return { action: now - fireAt < CATCH_UP_MS ? 'run' : 'skip', fireAt, late: now - fireAt };
}

// ---- adding and editing ---------------------------------------------------------------------------

// The fields a request can set, in the order the form shows them, with what each is called in the one-line summary of a refusal.
const FIELD_NAMES = { title: 'title', cron: 'schedule', jitterSeconds: 'jitter', cwd: 'folder', model: 'model', effort: 'effort', mode: 'permission mode', file: 'prompt file', prompt: 'prompt' };
const CHOICES = ['model', 'effort', 'mode'];
const spaced = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const sentence = names => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

const FULL_PATH = 'Give the full path, starting with /.';

// What is wrong with a prompt file path a request sent, or null. It is read at each run, never written, and not in GhostShell's own
// prompt folder because that folder is edited as GhostShell's own text. The path goes in a quoted attribute of the run's wrapper.
function filePathProblem(value, inPromptFolder) {
  const given = typeof value === 'string' ? value.trim() : '';
  if (!given || !path.isAbsolute(given)) return FULL_PATH;
  if (/["\r\n]/.test(given)) return 'The path cannot hold a double quote or a line break.';
  const resolved = path.resolve(given);
  if (inPromptFolder(resolved)) return "That file is in GhostShell's own prompt folder. Choose GhostShell's own text instead.";
  let stat;
  try { stat = fs.statSync(resolved); } catch { return `Cannot read ${given}.`; }
  if (stat.isDirectory()) return `${given} is a folder, not a file.`;
  try {
    if (!stat.isFile()) throw new Error('not a regular file');
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch { return `Cannot read ${given}.`; }
  return null;
}

// What a request sent for each field, ready to save, and what is wrong with each field it sent, which a field the folder, model,
// effort and mode checks in `fieldProblems` add to. When adding, the title, schedule, folder and one of prompt or file are needed,
// and a field that is not sent is not checked or changed otherwise.
function readFields(input, adding, fieldProblems, inPromptFolder) {
  const fields = {};
  const problems = {};
  const sent = key => input[key] !== undefined;
  if (sent('title') || adding) {
    // A title is read as a group's name is, so one that draws nothing is refused and a bidi control is dropped.
    const title = cleanName(input.title);
    if (showsNothing(title)) problems.title = 'Give the routine a title.';
    else if ([...title].length > MAX_TITLE) problems.title = `A title runs to ${MAX_TITLE} characters at most.`;
    else fields.title = title;
  }
  if (sent('cron') || adding) {
    const cron = typeof input.cron === 'string' ? spaced(input.cron) : '';
    try {
      if (!cron) throw new Error('Give the schedule as five fields, for example 30 7 * * 1-5.');
      parseCron(cron);
      fields.cron = cron;
    } catch (e) {
      problems.cron = e.message;
    }
  }
  if (sent('jitterSeconds')) {
    const jitter = input.jitterSeconds === null || input.jitterSeconds === '' ? 0 : input.jitterSeconds;
    if (validJitter(jitter)) fields.jitterSeconds = jitter;
    else problems.jitterSeconds = JITTER_PROBLEM;
  } else if (adding) {
    fields.jitterSeconds = 0;
  }
  if (sent('cwd') || adding) {
    if (typeof input.cwd === 'string' && input.cwd.trim()) fields.cwd = input.cwd.trim();
    else problems.cwd = 'Give the full path of the folder the routine runs in.';
  }
  for (const key of CHOICES) {
    if (sent(key) && input[key] !== null && typeof input[key] !== 'string') problems[key] = `Unknown ${FIELD_NAMES[key]}.`;
    else if (sent(key) || adding) fields[key] = (input[key] ?? '').trim() || null;
  }
  if (sent('prompt') && sent('file')) {
    problems.prompt = 'Send the prompt text or the path of a file, not both.';
  } else if (sent('file')) {
    const problem = filePathProblem(input.file, inPromptFolder);
    if (problem) problems.file = problem;
    else fields.file = path.resolve(input.file.trim());
  } else if (sent('prompt') || adding) {
    if (typeof input.prompt === 'string' && input.prompt.trim()) fields.prompt = input.prompt;
    else problems.prompt = adding ? 'Write the prompt the routine will run, or give the path of a prompt file.' : 'Write the prompt the routine will run.';
  }
  const found = fieldProblems({ ...input, ...fields });
  for (const key of ['cwd', ...CHOICES]) if ((sent(key) || adding) && found[key] && !problems[key]) problems[key] = found[key];
  return { fields, problems };
}

function refusedFields(problems) {
  const names = Object.keys(FIELD_NAMES).filter(key => problems[key]);
  return Object.assign(refuse(400, `Nothing was saved. Check the ${sentence(names.map(key => FIELD_NAMES[key]))}.`), { problems: Object.fromEntries(names.map(key => [key, problems[key]])) });
}

// ---- the scheduler --------------------------------------------------------------------------------

// `start(routine, text)` starts a session with the wrapped prompt and resolves with its id. `working(sessionId)` says whether it is
// still busy, `waiting(sessionId)` whether that is only waiting for an answer, and `stop(sessionId)` ends it. `check(routine)`
// may name a reason the routine cannot run, and `fieldProblems(routine)` maps the folder, model, effort and mode of one to a sentence
// each, for adding and editing. `idTaken(id)` says whether something outside routines.json already holds an id, such as the runs
// of a deleted routine. `restarting()` says whether a restart of GhostShell is under way, and holds the retries of failed starts.
// `now`, `log` and `warn` let a test use a fake clock.
// At most `limit` routines run at once, which keeps fewer of them fighting over one Chrome. A run that is only
// waiting for an answer does not count, and is replaced when its routine is next due.
export function makeScheduler({ store, start, working, waiting = () => false, stop = () => {}, limit = Infinity, check = () => null, fieldProblems = () => ({}), idTaken = () => false, restarting = () => false, now = Date.now, log = console.log, warn = console.error }) {
  const starting = new Set();
  const warned = new Map();
  const told = new Map();
  // What this process launched while a routine was on, kept apart from routines.json because a person can save an older copy of
  // that file over it. `at` is a place in the schedule that the file cannot take back, and zero once the routine is off.
  const launched = new Map();

  // A routine that cannot be read is said once, not on every check.
  const complain = (key, message) => { if (warned.get(key) !== message) { warned.set(key, message); warn(message); } };

  // The same thing said again on the next check is not logged twice.
  const tell = (key, message) => { if (told.get(key) !== message) { told.set(key, message); log(message); } };

  const runs = r => [...new Set([r.lastSessionId, launched.get(r.id)?.sessionId])].filter(id => !!id && !!working(id));
  const busy = r => starting.has(r.id) || runs(r).length > 0;
  const stuck = r => !starting.has(r.id) && runs(r).length > 0 && runs(r).every(id => waiting(id));
  const occupying = r => starting.has(r.id) || runs(r).some(id => !waiting(id));

  function replaceStuck(r) {
    const old = runs(r);
    for (const id of old) stop(id);
    log(`Routine ${r.id}: stopped ${old.join(', ')}, which was waiting for an answer, to start the new run`);
  }

  // `fileReady` is for a routine whose prompt file is about to be written, so it is not looked for yet.
  function problemWith(r, { fileReady = false } = {}) {
    // A hand-added id the page's routes refuse, and the run's wrapper carries it in a quoted attribute too.
    if (!/^[\w-]+$/.test(r.id)) return 'The id can only hold letters, digits, dashes and underscores.';
    try { parseCron(r.cron); } catch (e) { return e.message; }
    if (typeof r.file !== 'string' || !path.isAbsolute(r.file)) return 'The prompt file needs a full path, starting with /.';
    // The run's wrapper carries the path in a quoted attribute, which the transcript reader splits on.
    if (/["\r\n]/.test(r.file)) return 'The prompt file path cannot hold a double quote or a line break.';
    if (!fileReady) try { fs.accessSync(r.file, fs.constants.R_OK); } catch { return `Cannot read ${r.file}.`; }
    return check(r);
  }

  function summary(r, at = now()) {
    let next = null;
    let problem = null;
    try {
      const fire = nextFire(r.cron, at, r.jitterSeconds);
      next = fire === null ? null : localIso(fire);
      problem = problemWith(r);
    } catch (e) {
      problem = e.message;
    }
    if (!problem && typeof r.enabled !== 'boolean') problem = 'The enabled flag must be true or false, so this routine is treated as off.';
    const { id, title, cron, jitterSeconds, file, cwd, model, effort, mode, enabled, armedAt, lastRunAt, lastSessionId, lastError, skipped, retry } = r;
    return { id, title, cron, jitterSeconds, file, cwd, model, effort, mode, enabled, armedAt, lastRunAt, lastSessionId, lastError, skipped, retry, running: busy(r), next, problem };
  }

  function find(id) {
    const data = store.read();
    if (data.problem) throw refuse(500, data.problem);
    const routine = data.routines.find(r => r.id === id);
    if (!routine) throw refuse(404, 'No routine with that id.');
    return routine;
  }

  const giveUp = (r, fireAt, t) => {
    log(`Routine ${r.id}: gave up the ${stamp(fireAt)} run (${GAVE_UP})`);
    return { fireAt: localIso(fireAt), at: localIso(t), reason: GAVE_UP };
  };

  // What a start that threw leaves queued: the fire tried again after the next wait, or nothing once that would be past the limit.
  function queueRetry(r, fireAt, at) {
    const tries = (r.retry?.fireAt === localIso(fireAt) ? r.retry.tries : 0) + 1;
    const nextAt = at + RETRY_BACKOFF_MS[Math.min(tries, RETRY_BACKOFF_MS.length) - 1];
    if (nextAt >= fireAt + CATCH_UP_MS) return { retry: null, skipped: giveUp(r, fireAt, at) };
    log(`Routine ${r.id}: will try the ${stamp(fireAt)} run again at ${stamp(nextAt)}`);
    return { retry: { fireAt: localIso(fireAt), tries, nextAt: localIso(nextAt) } };
  }

  // `fireAt` is the scheduled fire this launch is for, and is left out for a run now. The attempt is written down before the session
  // starts, so a crash mid-start is never retried into a second run. A start that threw queues its fire, and a refusal does not.
  async function launch(r, how, fireAt) {
    starting.add(r.id);
    try {
      let id;
      const at = now();
      let refused = false;
      try {
        store.update(r.id, { lastRunAt: localIso(at), lastSessionId: null, lastError: null, skipped: null, retry: null, ...(r.enabled === true && { armedAt: localIso(at) }) });
        launched.set(r.id, { at: r.enabled === true ? at : 0, sessionId: null });
        const problem = problemWith(r);
        if (problem) { refused = true; throw refuse(400, problem); }
        id = await start(r, wrapPrompt(r.id, r.file, fs.readFileSync(r.file, 'utf8')));
      } catch (e) {
        // A failed run now leaves a queued fire queued.
        const queued = fireAt === undefined ? (r.retry ? { retry: r.retry } : {}) : refused ? {} : queueRetry(r, fireAt, at);
        try { store.update(r.id, { lastError: e.message, ...queued }); } catch {}
        warn(`Routine ${r.id}: could not start (${e.message})`);
        throw e;
      }
      launched.get(r.id).sessionId = id;
      try { store.update(r.id, { lastSessionId: id }); } catch (e) { warn(`Routine ${r.id}: started session ${id} but could not save it (${e.message})`); }
      log(`Routine ${r.id}: started session ${id} (${how})`);
      return id;
    } finally {
      starting.delete(r.id);
    }
  }

  function skip(r, d, t, why) {
    store.update(r.id, { armedAt: localIso(t), skipped: { fireAt: localIso(d.fireAt), at: localIso(t), reason: why } });
    log(`Routine ${r.id}: skipped the ${stamp(d.fireAt)} run (${why})`);
  }

  // A fire that failed to start, tried again once its wait is over. It waits for a restart to finish, for a run of the routine to
  // end and for a free place, and says why once.
  function retryFailed(r, t, room) {
    const key = `retry:${r.id}`;
    const fireAt = time(r.retry.fireAt);
    const started = launched.get(r.id);
    if (started?.sessionId && started.at >= fireAt) {
      store.update(r.id, { retry: null });
    } else if (t - fireAt >= CATCH_UP_MS) {
      store.update(r.id, { retry: null, skipped: giveUp(r, fireAt, t) });
    } else if (t < time(r.retry.nextAt)) {
      return null;
    } else if (restarting()) {
      tell(key, `Routine ${r.id}: holding the retry of the ${stamp(fireAt)} run while GhostShell restarts`);
      return null;
    } else if (busy(r)) {
      tell(key, `Routine ${r.id}: holding the retry of the ${stamp(fireAt)} run while the routine is running`);
      return null;
    } else if (room.free <= 0) {
      tell(key, `Routine ${r.id}: waiting for a free place to retry the ${stamp(fireAt)} run, with ${limit} routines already running`);
      return null;
    } else {
      room.free -= 1;
      told.delete(key);
      return launch(r, `retry ${r.retry.tries + 1} for ${stamp(fireAt)}`, fireAt).catch(() => {});
    }
    told.delete(key);
    return null;
  }

  // What to do about one switched-on routine at `t`. It returns the promise of the run it started, if it started one. `room`
  // counts the free places under the limit, and a routine due while there are none stays due until one frees up.
  function consider(r, t, room) {
    const last = launched.get(r.id);
    const d = dueAction(last && last.at > time(r.armedAt) ? { ...r, armedAt: last.at } : r, t);
    warned.delete(r.id);
    if (d.action === 'wait') return r.retry ? retryFailed(r, t, room) : null;
    // A fire newer than the last try has come due, so it takes over from a queued retry of an older one.
    if (r.retry) {
      store.update(r.id, { retry: null });
      told.delete(`retry:${r.id}`);
    }
    if (d.action === 'arm') {
      store.update(r.id, { armedAt: localIso(t) });
      log(`Routine ${r.id}: is on but was never armed, so it counts from ${stamp(t)}`);
    } else if (d.action === 'skip') {
      skip(r, d, t, `${span(d.late)} late, over the ${span(CATCH_UP_MS)} limit`);
    } else if (busy(r) && !stuck(r)) {
      skip(r, d, t, 'the previous run is still working');
    } else if (room.free <= 0) {
      tell(`slot:${r.id}`, `Routine ${r.id}: waiting for a free place, with ${limit} routines already running`);
    } else {
      if (stuck(r)) replaceStuck(r);
      room.free -= 1;
      told.delete(`slot:${r.id}`);
      return launch(r, d.late < ON_TIME_MS ? `due ${stamp(d.fireAt)}` : `catch-up for ${stamp(d.fireAt)}, ${span(d.late)} late`, d.fireAt).catch(() => {});
    }
    return null;
  }

  // A routine that is off keeps no place in its schedule, so a hand edit that switches it on starts it from then, as the API does.
  function release(r) {
    if (typeof r.enabled !== 'boolean') complain(r.id, `Routine ${r.id}: the enabled flag must be true or false, so it is treated as off`);
    if (launched.has(r.id)) launched.get(r.id).at = 0;
    if (r.armedAt || r.retry) store.update(r.id, { ...(r.armedAt && { armedAt: null }), ...(r.retry && { retry: null }) });
    told.delete(`retry:${r.id}`);
  }

  return {
    // Fires whatever has come due. Safe to call while an earlier call is still starting a session.
    async tick() {
      const t = now();
      const data = store.read();
      if (data.problem) complain('routines.json', data.problem);
      else warned.delete('routines.json');
      const jobs = [];
      const room = { free: limit - data.routines.filter(occupying).length };
      for (const r of data.routines) {
        try {
          if (r.enabled !== true) {
            release(r);
          } else {
            const job = consider(r, t, room);
            if (job) jobs.push(job);
          }
        } catch (e) {
          complain(r.id, `Routine ${r.id}: ${e.message}`);
        }
      }
      await Promise.all(jobs);
    },

    // Runs a routine now, switched on or not, and over the limit if need be. On a routine that is on it uses up the fires
    // already due, as any run does. A run of it that is only waiting for an answer is replaced.
    async runNow(id) {
      const r = find(id);
      if (busy(r) && !stuck(r)) throw refuse(409, `${r.title} is still running.`);
      if (stuck(r)) replaceStuck(r);
      const sessionId = await launch(r, 'run now');
      return { sessionId, routine: summary(find(id)) };
    },

    // Switching on starts the schedule from now, so a fire time already past today is not run.
    setEnabled(id, enabled) {
      const r = find(id);
      if (typeof enabled !== 'boolean') throw refuse(400, 'Send enabled as true or false.');
      if (r.enabled === enabled) return summary(r);
      if (enabled) {
        const problem = problemWith(r);
        if (problem) throw refuse(400, `${r.title} cannot be switched on. ${problem}`);
      }
      const changed = store.update(id, enabled ? { enabled: true, armedAt: localIso(now()), skipped: null, retry: null } : { enabled: false, armedAt: null, retry: null });
      if (!enabled && launched.has(id)) launched.get(id).at = 0;
      log(`Routine ${id}: switched ${enabled ? 'on' : 'off'}`);
      return summary(changed);
    },

    // A new routine keeps its prompt in GhostShell's own folder, or points at a file it never writes. Everything is checked before
    // anything is written, so a refusal changes nothing.
    add(input) {
      if (!isObject(input)) throw refuse(400, 'Send the routine as a JSON object.');
      const data = store.read();
      if (data.problem) throw refuse(500, data.problem);
      const enabled = input.enabled === undefined ? true : input.enabled;
      if (typeof enabled !== 'boolean') throw refuse(400, 'Send enabled as true or false.');
      const { fields: { prompt, file, ...fields }, problems } = readFields(input, true, fieldProblems, store.inPromptFolder);
      if (Object.keys(problems).length) throw refusedFields(problems);
      const id = routineId(fields.title, taken => data.routines.some(r => r.id === taken) || store.hasPrompt(taken) || idTaken(taken));
      const promptPath = file ?? store.promptFile(id);
      const routine = { ...BLANK, id, ...fields, file: promptPath, enabled, armedAt: enabled ? localIso(now()) : null };
      const problem = enabled && problemWith(routine, { fileReady: file === undefined });
      if (problem) throw refuse(400, `${routine.title} cannot be switched on. ${problem}`);
      if (file === undefined) store.writePrompt(promptPath, `${prompt.trim()}\n`);
      try {
        store.add(routine);
      } catch (e) {
        if (file === undefined) fs.rmSync(promptPath, { force: true });
        throw e;
      }
      log(`Routine ${id}: added${enabled ? ' and switched on' : ''}`);
      return summary(find(id));
    },

    // A change of schedule on a routine that is on counts from now, as switching on does. Every other change applies from the next run.
    // New prompt text goes to GhostShell's own copy and a routine on a file elsewhere is moved onto it, so that file is never written.
    // A `file` points the routine at that path and leaves GhostShell's copy on disk.
    edit(id, patch) {
      const r = find(id);
      if (!isObject(patch)) throw refuse(400, 'Send the changes as a JSON object.');
      if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw refuse(400, 'Send enabled as true or false.');
      const { fields: { prompt, file, ...fields }, problems } = readFields(patch, false, fieldProblems, store.inPromptFolder);
      if (Object.keys(problems).length) throw refusedFields(problems);
      const flipped = patch.enabled !== undefined && patch.enabled !== r.enabled;
      const on = patch.enabled ?? r.enabled === true;
      const scheduled = (fields.cron !== undefined && fields.cron !== spaced(r.cron)) || (fields.jitterSeconds !== undefined && fields.jitterSeconds !== r.jitterSeconds);
      let write = false;
      let promptPath = file ?? r.file;
      if (prompt !== undefined) {
        if (store.ours(r.file)) {
          let current = null;
          try { current = bodyOf(fs.readFileSync(r.file, 'utf8')); } catch {}
          write = current !== prompt.trim();
        } else {
          write = true;
          promptPath = store.promptFile(id);
        }
      }
      const edited = { ...r, ...fields, file: promptPath };
      if (flipped && on) {
        // The saved folder may be gone though this edit did not send it, and the form can only mark a field the refusal names.
        const found = fieldProblems(edited);
        if (Object.keys(found).length) throw refusedFields(found);
        const problem = problemWith(edited, { fileReady: write });
        if (problem) throw refuse(400, `${edited.title} cannot be switched on. ${problem}`);
      }
      const changes = { ...fields, ...(promptPath !== r.file && { file: promptPath }) };
      if (flipped) Object.assign(changes, on ? { enabled: true, armedAt: localIso(now()), skipped: null, retry: null } : { enabled: false, armedAt: null, retry: null });
      else if (on && scheduled) Object.assign(changes, { armedAt: localIso(now()), skipped: null, retry: null });
      if (write) store.writePrompt(promptPath, `${prompt.trim()}\n`);
      const changed = Object.keys(changes).length ? store.update(id, changes) : r;
      if (flipped && !on && launched.has(id)) launched.get(id).at = 0;
      const edits = [...Object.keys(fields), ...(promptPath !== r.file ? ['file'] : []), ...(write ? ['prompt'] : [])];
      if (edits.length) log(`Routine ${id}: edited ${edits.join(', ')}`);
      if (flipped) log(`Routine ${id}: switched ${on ? 'on' : 'off'}`);
      return summary(changed);
    },

    // A routine that is running, or only waiting for an answer, stays until it ends. Its prompt file is kept, and so are the sessions it ran.
    remove(id) {
      const r = find(id);
      if (busy(r)) throw refuse(409, `${r.title} is still running, so it cannot be deleted yet.`);
      store.remove(id);
      launched.delete(id);
      warned.delete(id);
      told.delete(`slot:${id}`);
      told.delete(`retry:${id}`);
      log(`Routine ${id}: deleted`);
      return id;
    },

    // What a run of the routine sends, which file it is read from, and whether that file is GhostShell's own copy.
    prompt(id) {
      const r = find(id);
      const ours = store.ours(r.file);
      try {
        return { file: r.file, text: bodyOf(fs.readFileSync(r.file, 'utf8')), ours };
      } catch {
        return { file: r.file, text: '', ours, error: `Cannot read ${r.file}.` };
      }
    },

    list() {
      const data = store.read();
      return { routines: data.routines.map(r => summary(r)), problem: data.problem || null };
    },
  };
}
