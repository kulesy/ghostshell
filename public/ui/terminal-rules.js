// What the terminal panel, the code blocks and the prompt box's ! mode decide, with no page in it so node can test it.
// public/md.mjs imports this too, so the server draws a block's Run button from the same rule the page runs it by.

const SHELL_BLOCKS = new Set(['bash', 'sh', 'zsh', 'shell']);

// The server refuses a longer command, so a block that long gets no Run button.
export const MAX_COMMAND = 100_000;

// What the owner cannot see in a block: controls other than tab and newline, format and line-separator characters, spaces other than a plain
// one, and the rest a browser draws as nothing. A command holding any of them is not the command the block shows, so Run refuses it.
const HIDDEN = /(?![\t\n ])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\p{Default_Ignorable_Code_Point}\u2800]/u;

export const hasHiddenCharacters = text => HIDDEN.test(text);

const isPrompt = line => line.trimStart().startsWith('$ ');

// The commands of a block written the way a terminal shows them, each { from, to } in lines with its text: each line after "$ ", a line
// ending in a backslash taking the next as its own, and every other line being output.
function promptCommands(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isPrompt(lines[i])) continue;
    const from = i;
    let command = lines[i].trimStart().slice(2);
    while (command.endsWith('\\') && i + 1 < lines.length) command += `\n${lines[++i]}`;
    out.push({ from, to: i, command });
  }
  return out;
}

// Run reads a console block, and a block of shell lines that all start with "$ ", as a terminal shows it, running only its commands.
const readsAsConsole = (kind, filled) => kind === 'console' || (SHELL_BLOCKS.has(kind) && filled.every(isPrompt)) || (kind === '' && filled.length === 1 && isPrompt(filled[0]));

// What Run would run for a fenced block, or null when the block is not a command. `lang` is the fence's word. A bash, sh, zsh or shell
// block runs as written, a console block runs only its "$ " lines, and a block with no word runs when it is a single line.
// A block of shell lines that all start with "$ " is read as a console block. `hidden` says the block holds characters the owner
// cannot see, and Run is then refused.
export function runnableBlock(lang, text) {
  if (typeof text !== 'string') return null;
  const kind = String(lang || '').toLowerCase();
  const lines = text.split('\n');
  const filled = lines.filter(line => line.trim());
  if (!filled.length) return null;
  let command;
  if (readsAsConsole(kind, filled)) command = promptCommands(lines).map(c => c.command).join('\n');
  else if (SHELL_BLOCKS.has(kind)) command = text;
  else if (kind === '') command = filled.length === 1 ? filled[0] : '';
  else return null;
  command = command.trim();
  if (!command || command.length > MAX_COMMAND) return null;
  return { command, hidden: hasHiddenCharacters(text) };
}

// The lines of a console block that are commands, as { from, to } line numbers with the last included, and none for a block that runs as
// written. The page draws them apart from the output, so the wrapped tail of a long command is seen to be part of it.
export function commandLines(lang, text) {
  const lines = String(text).split('\n');
  const kind = String(lang || '').toLowerCase();
  return readsAsConsole(kind, lines.filter(line => line.trim())) ? promptCommands(lines).map(({ from, to }) => ({ from, to })) : [];
}

const startsBang = text => text.startsWith('!');

// The prompt box is in command mode while its text starts with "!". A new session's box has no folder to run in, and a server with no
// terminal has nowhere to run it, so neither is ever in it. `command` is what follows the "!".
// NOTE: [23 Oct 2026] EK - Only the prompt box calls this. A widget's button sends its text through ctrl.prompt, so a "!" a widget
// writes is an ordinary message and never a command.
export function bangMode({ text, terminal, draft }) {
  if (!terminal || draft || typeof text !== 'string' || !startsBang(text)) return null;
  return { command: text.slice(1).trim() };
}

// The unsent text a chat opens with when it takes it over from the last one. A message follows you from chat to chat, but a command does
// not, because Enter would run it in the folder of whichever chat is open.
export const carriedText = text => (startsBang(text) ? '' : text);

// The text with command mode left: the "!" and the spaces after it go, and the command stays as a message.
export const leaveBang = text => (startsBang(text) ? text.slice(1).trimStart() : text);

// ---- the side panel ---------------------------------------------------------------------------------------

// Pixels. The panel is at least `min` wide and leaves the chat at least `chatMin`, and a session narrower than `overBelow` has no room
// for both, so the panel covers the chat there.
export const PANEL = { min: 288, fallback: 448, chatMin: 320, overBelow: 704, step: 16, bigStep: 64 };

export const panelMode = sessionWidth => (sessionWidth < PANEL.overBelow ? 'over' : 'side');

// The widest the panel can be in a session `sessionWidth` wide.
export const widestPanel = sessionWidth => Math.max(PANEL.min, sessionWidth - PANEL.chatMin);

export const clampWidth = (want, sessionWidth) => Math.round(Math.min(Math.max(Number(want) || PANEL.fallback, PANEL.min), widestPanel(sessionWidth)));

// The width a key gives the resize handle, or null when the key is not one of its keys. The panel is on the right, so moving the edge
// left (the left arrow) makes it wider, and Shift takes a bigger step.
export function widthByKey(key, shift, width, sessionWidth) {
  const step = shift ? PANEL.bigStep : PANEL.step;
  const next = { ArrowLeft: width + step, ArrowRight: width - step, Home: PANEL.min, End: widestPanel(sessionWidth) }[key];
  return next === undefined ? null : clampWidth(next, sessionWidth);
}

export const TAB_LABEL = { subs: 'Sub sessions', agents: 'Subagents', terminal: 'Terminal', file: 'File' };

// The tabs a panel offers, Sub sessions first: it when the chat has sub sessions to show, Subagents when it has had helpers, the terminal when
// the server has one, and the file while one is open.
export const panelTabs = ({ subs, agents, terminal, file }) => [...(subs ? ['subs'] : []), ...(agents ? ['agents'] : []), ...(terminal ? ['terminal'] : []), ...(file ? ['file'] : [])];

// What names the panel to a screen reader: the tabs it holds, as "Sub sessions, terminal and file".
export function panelName(tabs) {
  const names = tabs.map((tab, n) => (n ? TAB_LABEL[tab].toLowerCase() : TAB_LABEL[tab]));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
}

// What a header button for `tab` does: it closes the panel when that tab is on show, and otherwise opens the panel on it or switches to it.
// `shown` is the tab on show, or null while the panel is closed.
export const tabPress = (shown, tab) => (shown === tab ? 'close' : 'show');

// Whether a chat's panel opens by itself on the Sub sessions tab: only when the chat offers that tab, nothing is saved for the chat (so a
// panel the owner closed stays closed) and the session is wide enough for the panel to sit beside the chat.
export const opensByDefault = ({ saved, offered, mode }) => offered && !saved && mode === 'side';

// The tab on show: the one asked for if the panel offers it, else the first it does, else none.
export const tabShown = (tab, tabs) => (tabs.includes(tab) ? tab : tabs[0] ?? null);

// The tab a key moves to, with the arrows wrapping and Home and End going to the ends, or null when the key is not a tab key.
export function tabByKey(key, tab, tabs) {
  const at = tabs.indexOf(tab);
  const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[key];
  return next === undefined || at < 0 ? null : tabs[(next + tabs.length) % tabs.length];
}

// ---- the panel's input history ---------------------------------------------------------------------------

const HISTORY = 200;

// The commands the panel has run, oldest first, with a command run twice in a row listed once.
export function historyOf(runs) {
  const list = [];
  for (const { command } of runs) if (command && list.at(-1) !== command) list.push(command);
  return list.slice(-HISTORY);
}

// One press of Up (-1) or Down (1) in the input. `at` is the place in `list` being shown, or null when the input holds what was typed,
// which `draft` keeps while a command from the list is on show. Returns the new { at, draft, text }, or null when the key does nothing.
export function recall({ list, at, draft }, text, direction) {
  if (!list.length) return null;
  if (direction < 0) {
    if (at === 0) return null;
    const next = at === null ? list.length - 1 : at - 1;
    return { at: next, draft: at === null ? text : draft, text: list[next] };
  }
  if (at === null) return null;
  return at === list.length - 1 ? { at: null, draft: '', text: draft } : { at: at + 1, draft, text: list[at + 1] };
}

// ---- the runs the page holds ------------------------------------------------------------------------------

// How much output the page keeps for a run. The server keeps 1 MB and sends a summary's last 64 KB.
export const KEEP = 256 * 1024;

// The words of a run's output with the page's own echo of what was typed to it left out, which is how two accounts of it are compared.
export const textOf = chunks => chunks.filter(c => c.stream !== 'in').map(c => c.text).join('');

// A summary carries only the last 64 KB of a run. What the page already holds is kept when it ends with those words, because it is the
// fuller account, and otherwise the summary wins, since the page has missed some.
export function mergeOutput(held, tail) {
  if (!held.length) return tail;
  return textOf(held).endsWith(textOf(tail)) ? held : tail;
}

// `output` with `chunks` after it, joined to the last piece when it is the same stream, and the oldest words dropped past `cap`.
export function appendChunks(output, chunks, cap = KEEP) {
  const next = output.slice();
  for (const { stream, text } of chunks) {
    if (!text) continue;
    const last = next.at(-1);
    if (last?.stream === stream) next[next.length - 1] = { stream, text: last.text + text };
    else next.push({ stream, text });
  }
  let size = next.reduce((n, c) => n + c.text.length, 0);
  while (size > cap && next.length) {
    const over = size - cap;
    if (next[0].text.length <= over) {
      size -= next.shift().text.length;
    } else {
      next[0] = { ...next[0], text: next[0].text.slice(over) };
      size = cap;
    }
  }
  return next;
}

const RUNS_KEPT = 100;

// A run in `runs` with the server's summary of it. A summary of a run the page does not know yet takes the place of the one the page
// drew while it waited for the server, which is a run with `pending` set and the same command and source, so it never shows twice.
export function upsertRun(runs, incoming) {
  const known = runs.findIndex(r => r.id === incoming.id);
  if (known >= 0) {
    const held = runs[known];
    // The answer to the request that started a run can arrive after the event that says it ended, and is then the older account.
    if (!held.running && incoming.running) return runs;
    const next = runs.slice();
    next[known] = { ...held, ...incoming, key: held.key, pending: false, output: mergeOutput(held.output, incoming.output) };
    return next;
  }
  const waiting = runs.findIndex(r => r.pending && r.command === incoming.command && r.source === incoming.source);
  if (waiting >= 0) {
    const next = runs.slice();
    next[waiting] = { ...incoming, key: runs[waiting].key, pending: false };
    return next;
  }
  return [...runs, { ...incoming, key: incoming.id, pending: false }].slice(-RUNS_KEPT);
}

// The page's runs after the server sends all of them: each summary joined to the run held for it, and the runs still waiting for the
// server kept at the end.
export function replaceRuns(held, summaries) {
  const byId = new Map(held.map(r => [r.id, r]));
  const runs = summaries.map(s => {
    const was = byId.get(s.id);
    return was ? { ...was, ...s, key: was.key, pending: false, output: mergeOutput(was.output, s.output) } : { ...s, key: s.id, pending: false };
  });
  return [...runs, ...held.filter(r => r.pending)].slice(-RUNS_KEPT);
}

// The newest run the server knows is running.
export const lastRunning = runs => runs.findLast(r => r.running && !r.pending) ?? null;

// ---- where the panel's input sends --------------------------------------------------------------------------

// An empty input follows the newest running run. The first text typed pins it to the run it shows then, or to none, until the box is empty
// again, so a run that starts from another tab mid-typing does not take an Enter or Ctrl+C meant for something else.
export const pinAfter = (pin, runs, text) => (text ? pin ?? { run: lastRunning(runs)?.id ?? null } : null);

// Where Enter, Ctrl+C and Ctrl+D in the input go: `run` is the running run, or null when Enter runs a command. `ended` says the pinned run has
// finished, and the text, which was meant as input to it, is then not run as a command.
export function inputTarget(runs, pin) {
  if (!pin) return { run: lastRunning(runs), ended: false };
  if (pin.run === null) return { run: null, ended: false };
  const run = runs.find(r => r.id === pin.run && r.running && !r.pending) ?? null;
  return { run, ended: !run };
}

// ---- how a run reads ---------------------------------------------------------------------------------------

// A folder with the home folder written as ~, only where the path starts with it.
export function inHome(path, home) {
  if (!path) return '';
  if (!home) return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// The last folder of a path, which is how a run's prompt names where it ran, with the home folder as ~ and the root as /.
export function folderOf(path, home) {
  if (!path) return '';
  if (path === home) return '~';
  return path.replace(/\/+$/, '').split('/').pop() || '/';
}

// How long a run took: tenths of a second up to ten seconds, then whole seconds, minutes and hours.
export function took(ms) {
  if (!(ms >= 0)) return '';
  if (ms < 9950) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// How a finished run ended, in words: `Exit 0`, `Stopped`, or the signal that ended it.
export function ending(run) {
  if (run.stopped) return 'Stopped';
  if (run.signal) return `Ended by ${run.signal}`;
  return `Exit ${run.exitCode ?? '?'}`;
}

// The state a run is in, which colours its footer: running, stopped, finished with exit 0, or failed.
export const runState = run => (run.running ? 'running' : run.stopped || run.signal ? 'stopped' : run.exitCode === 0 ? 'ok' : 'failed');

// How a run stands, in the words its footer uses: how long it has run, or how it ended and how long it took and what became of its result.
export function runStanding(run, now = Date.now()) {
  if (run.pending) return 'Starting';
  if (run.running) return `Running ${took(now - run.startedAt)}`;
  return [ending(run), took(run.endedAt - run.startedAt), run.truncated && 'Output cut', deliveredWords(run.delivered)].filter(Boolean).join(' · ');
}

// What the panel says aloud when a run ends, since the output itself is not read out as it arrives.
export function endedAloud(run) {
  const words = run.stopped ? 'was stopped' : run.signal ? `ended with ${run.signal}` : `finished with exit code ${run.exitCode ?? 'unknown'}`;
  const line = run.command.split('\n')[0];
  return `Command ${words}: ${line.length > 80 ? `${line.slice(0, 80)}...` : line}`;
}

// What the server did with the result of a command run with !, in the words the footer uses.
export const deliveredWords = delivered => (delivered === 'sent' ? 'Sent to Claude' : delivered === 'held' ? 'Added to your next message' : '');

// ---- the transcript's bash items ---------------------------------------------------------------------------

const joined = new WeakMap();

// An older CLI wrote a command and its output as two items, the second with no command. They read as one, and a pair is joined once
// so its row keeps the identity it had.
export function joinBash(items) {
  if (!items.some(i => i.kind === 'bash' && i.command === '')) return items;
  const out = [];
  for (const item of items) {
    const before = out.at(-1);
    if (item.kind === 'bash' && item.command === '' && before?.kind === 'bash' && before.command !== '') {
      const cached = joined.get(item);
      if (cached?.first === before) { out[out.length - 1] = cached.merged; continue; }
      const merged = { ...before, stdout: before.stdout + item.stdout, stderr: before.stderr + item.stderr };
      joined.set(item, { first: before, merged });
      out[out.length - 1] = merged;
    } else out.push(item);
  }
  return out;
}

// A bash item is written after the command ran, and a little clock difference should not hide that.
const SLACK_MS = 2000;

const sameCommand = (a, b) => a.trim() === b.trim();

// The ids of the runs started with ! that the transcript already holds. Each bash item takes the earliest run with its command that
// started before the item was written, and a run is taken once, so two runs of one command match two items.
export function landedRuns(runs, items) {
  const taken = new Set();
  for (const item of items) {
    if (item.kind !== 'bash') continue;
    const wrote = Date.parse(item.at);
    const run = runs.find(r => r.source === 'bang' && !taken.has(r.id) && sameCommand(r.command, item.command) && (Number.isNaN(wrote) || r.startedAt <= wrote + SLACK_MS));
    if (run) taken.add(run.id);
  }
  return taken;
}

// The runs started with ! that the transcript does not hold yet, to be drawn after it. When earlier messages are not loaded, a run that
// started before the oldest message on show may be in them, so it is left out.
export function pendingBangs({ runs, items, hasEarlier }) {
  const bangs = runs.filter(r => r.source === 'bang');
  if (!bangs.length) return bangs;
  const landed = landedRuns(bangs, items);
  const times = items.map(i => Date.parse(i.at)).filter(t => !Number.isNaN(t));
  const oldest = hasEarlier && times.length ? Math.min(...times) : -Infinity;
  return bangs.filter(r => !landed.has(r.id) && r.startedAt >= oldest);
}

// The run in the panel that a bash item in the transcript came from, or null: the latest run with its command that started before it.
export function runOfItem(runs, item) {
  const wrote = Date.parse(item.at);
  return runs.findLast(r => r.source === 'bang' && sameCommand(r.command, item.command) && (Number.isNaN(wrote) || r.startedAt <= wrote + SLACK_MS)) ?? null;
}
