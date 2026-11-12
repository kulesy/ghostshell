// The terminal tab: the commands run for this chat as blocks with their output, and the line that runs the next one. A command runs only
// when the owner presses Enter or Run here; nothing on the page, in an event or in a reply starts one on its own.
import { plainOf } from './ansi.js';
import { copyText } from './clipboard.js';
import { NO_GRAMMARLY } from './composer.js';
import { useClock, useFields, usePin, useStick, useStore } from './hooks.js';
import { html, memo, useEffect, useLayoutEffect, useRef } from './html.js';
import { draw, icons } from './menu.js';
import { Output } from './output.js';
import { panels } from './panel-state.js';
import { folderOf, historyOf, inHome, inputTarget, recall, runStanding, runState } from './terminal-rules.js';
import { toast } from './toast.js';

const LINES = 2000;

const fine = () => matchMedia('(pointer: fine)').matches;

function Tool({ label, icon, onClick }) {
  return html`<button class="btn" type="button" data-variant="ghost" data-size="icon-xs" aria-label=${label} data-tip=${label} onClick=${onClick}>${draw(icons[icon], 'icon')}</button>`;
}

const RunBlock = memo(function RunBlock({ run, home, term }) {
  useClock(run.running && !run.pending, run.startedAt);
  const live = run.running && !run.pending;
  const copy = async () => toast((await copyText(plainOf(run.output))) ? 'Output copied' : 'Could not copy the output', { duration: 2000 });
  return html`<section class="run" role="group" aria-label=${`Command ${run.command.split('\n')[0]}`} data-run=${run.key} data-state=${runState(run)} data-source=${run.source} tabindex="-1">
    <div class="run-head">
      <span class="run-prompt"><span class="run-cwd" title=${inHome(run.cwd, home)}>${folderOf(run.cwd, home)}</span> <span class="run-sign" aria-hidden="true">${run.source === 'bang' ? '!' : '$'}</span></span>
      <code class="run-command">${run.command}</code>
      <span class="run-tools">
        ${live ? html`<${Tool} label="Stop command" icon="square" onClick=${() => term.stop(run.id)} />` : null}
        ${run.output.length ? html`<${Tool} label="Copy output" icon="copy" onClick=${copy} />` : null}
        ${!run.running ? html`<${Tool} label="Run again" icon="rotateCcw" onClick=${() => term.run(run.command, 'panel').then(problem => problem && term.report(problem))} />` : null}
      </span>
    </div>
    ${run.output.length ? html`<${Output} class="run-out" chunks=${run.output} maxLines=${LINES} />` : null}
    <p class="run-foot">${run.running ? html`<span class="lamp" data-state="working" aria-hidden="true"></span>` : null}${runStanding(run)}</p>
  </section>`;
}, (a, b) => a.run === b.run && a.home === b.home && a.term === b.term);

// `onLeave` is where Esc in the input goes: back to the prompt box beside the chat, or off the panel when it covers the chat.
export function TerminalTab({ ctrl, active, onLeave }) {
  const term = ctrl.term;
  const { runs, cwd, home, ready, input, sendTo, error, announce } = useFields(term.store, 'runs', 'cwd', 'home', 'ready', 'input', 'sendTo', 'error', 'announce');
  const goto = useStore(panels, s => s.goto);
  const out = useRef(null);
  const area = useRef(null);
  const history = useRef({ at: null, draft: '' });
  const pin = usePin(out);
  useStick(out, pin);
  const shown = inputTarget(runs, sendTo);
  // The target at the moment of a key, which a redraw may not have caught up with.
  const now = () => inputTarget(term.store.get().runs, term.store.get().sendTo);

  useLayoutEffect(() => { if (active) out.current.scrollTop = out.current.scrollHeight; }, [active]);

  // "Open in terminal" scrolls to the run and puts the focus on it, and lets the output stop following the end.
  useEffect(() => {
    if (!goto) return;
    const block = out.current.querySelector(`[data-run="${CSS.escape(goto.key)}"]`);
    if (!block) return;
    pin.current = false;
    block.scrollIntoView({ block: 'nearest' });
    block.focus({ preventScroll: true });
    panels.set({ goto: null });
  }, [goto]);

  useLayoutEffect(() => {
    const el = area.current;
    el.style.height = 'auto';
    const max = parseFloat(getComputedStyle(el).lineHeight) * 8;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [input]);

  const submit = async () => {
    const text = area.current.value;
    const { run, ended } = now();
    if (ended) {
      term.report('That command has ended, so nothing was sent. Clear the box to run a command.');
      return;
    }
    history.current = { at: null, draft: '' };
    if (run) {
      term.setInput('');
      await term.input(run.id, `${text}\n`);
      return;
    }
    const command = text.trim();
    if (!command) return;
    term.setInput('');
    const problem = await term.run(command, 'panel');
    if (problem) {
      term.report(problem);
      if (!term.store.get().input) term.setInput(text, { run: null });
    }
  };

  const walk = (e, direction) => {
    const next = recall({ list: historyOf(runs), ...history.current }, area.current.value, direction);
    if (!next) return;
    e.preventDefault();
    history.current = { at: next.at, draft: next.draft };
    term.setInput(next.text);
  };

  const onKeyDown = e => {
    if (e.isComposing) return;
    const el = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey && fine()) { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') { e.preventDefault(); onLeave(); return; }
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const { run } = now();
      if (e.key === 'c' && el.selectionStart === el.selectionEnd) {
        e.preventDefault();
        if (run) term.stop(run.id);
        else term.setInput('');
        return;
      }
      if (e.key === 'd' && !el.value && run) { e.preventDefault(); term.input(run.id, '', true); return; }
    }
    if (shown.run || shown.ended || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowUp' && el.selectionStart === 0 && el.selectionEnd === 0) walk(e, -1);
    else if (e.key === 'ArrowDown' && el.selectionStart === el.value.length) walk(e, 1);
  };

  const first = shown.run?.command.split('\n')[0];
  return html`<div class="term">
    <div class="term-out" ref=${out} role="region" aria-label="Terminal output" tabindex="0">
      ${runs.length ? runs.map(run => html`<${RunBlock} key=${run.key} run=${run} home=${home} term=${term} />`)
        : html`<p class="term-empty">${ready ? `Commands start in ${inHome(cwd, home)}. Type one below, or press Run on a code block in the chat.` : 'Connecting to the terminal'}</p>`}
    </div>
    <p class="sr" role="status">${announce}</p>
    ${error ? html`<p class="term-error" role="alert"><span>${error}</span><${Tool} label="Dismiss" icon="x" onClick=${() => term.report('')} /></p>` : null}
    <form class="term-in" onSubmit=${e => { e.preventDefault(); submit(); }}>
      <label class="term-cwd" for="term-input">${shown.run ? html`<span class="sr">Send to </span>${first}` : shown.ended ? 'That command has ended' : html`<span class="sr">Command in </span>${inHome(cwd, home)}`}</label>
      <div class="term-field">
        <span class="term-sign" aria-hidden="true">${shown.run || shown.ended ? '>' : '$'}</span>
        <textarea id="term-input" class="term-input" ...${NO_GRAMMARLY} ref=${area} rows="1" value=${input} spellcheck=${false} autocomplete="off" autocapitalize="off" autocorrect=${false}
          placeholder=${shown.run ? 'Send a line to the running command' : 'Run a command'} aria-describedby="term-hint"
          onInput=${e => term.setInput(e.currentTarget.value)} onKeyDown=${onKeyDown}></textarea>
        <button class="btn" type="submit" data-size="icon-sm" aria-label=${shown.run || shown.ended ? 'Send line' : 'Run command'} data-tip=${shown.run || shown.ended ? 'Send line' : 'Run command'} disabled=${shown.ended || (!shown.run && !input.trim())}>${draw(icons.play, 'icon')}</button>
      </div>
      <p class="term-hint" id="term-hint">${shown.run ? 'Ctrl+C stops it. Ctrl+D ends its input.' : shown.ended ? 'Ctrl+C clears the box.' : fine() ? 'Enter runs. Shift+Enter adds a line.' : 'Enter adds a line. The button runs it.'}</p>
    </form>
  </div>`;
}
