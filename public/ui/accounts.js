// The Claude accounts in the page: the pane that lists, adds, signs in, renames and switches them, the sidebar banners for an account that is out of
// usage and for a switch GhostShell made by itself, and the button in a chat that switches and carries on. See docs/adr/20261102-switch-claude-accounts.md.
import { api } from './api.js';
import { Banner } from './banner.js';
import { autoBanner, needsSignIn, outBanner, planAsOf, sameAccountWords, signInLine, waitingWords } from './account-rules.js';
import { Button, useRefusal } from './banners.js';
import { Plan } from './context.js';
import { planRows } from './context-rules.js';
import { clean, NameForm } from './forms.js';
import { Alert, chevron } from './form-parts.js';
import { useDocumentTitle } from './hooks.js';
import { html, useCallback, useEffect, useRef, useState } from './html.js';

const enc = encodeURIComponent;
const STATES = { idle: 'Idle', working: 'Working', waiting: 'Waiting for approval' };
const SLOW_MS = 5000;
const FAST_MS = 2000;
const PLAN_MS = 60_000;

// The list as the server last gave it. A reading older than the one on screen is dropped. `act` posts, shows what the server answers with, and resolves
// with its refusal, or an empty string.
function useAccountList() {
  const [list, setList] = useState(null);
  const [problem, setProblem] = useState('');
  const count = useRef({ asked: 0, drawn: 0 });
  const show = useCallback((mine, got) => { if (mine > count.current.drawn) { count.current.drawn = mine; setList(got); } }, []);
  const load = useCallback(async () => {
    const mine = ++count.current.asked;
    try {
      show(mine, await api('api/accounts'));
      setProblem('');
    } catch (e) {
      setProblem(`Could not load the accounts: ${e.message}`);
    }
  }, []);
  const act = useCallback(async (path, body = {}) => {
    const mine = ++count.current.asked;
    try {
      show(mine, await api(path, body));
      return '';
    } catch (e) {
      return e.message;
    }
  }, []);
  const waiting = !!list?.waiting;
  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, waiting ? FAST_MS : SLOW_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  // The plan usage of each account is asked for when the pane opens, and again each minute while it stays open.
  useEffect(() => {
    act('api/accounts/plan');
    const timer = setInterval(() => { if (!document.hidden) act('api/accounts/plan'); }, PLAN_MS);
    return () => clearInterval(timer);
  }, []);
  return { list, problem, act, load };
}

function Chats({ chats }) {
  if (!chats.length) return null;
  return html`<div class="account-chats">
    <p class="account-sub">Running chats</p>
    <ul>${chats.map(c => html`<li key=${c.id}><a href=${`#/s/${enc(c.id)}`}>${c.title}</a><span class="quiet">${STATES[c.state] || c.state}</span></li>`)}</ul>
  </div>`;
}

function AccountRow({ a, list, act }) {
  const [renaming, setRenaming] = useState(false);
  const [refused, setRefused] = useState('');
  const pencil = useRef(null);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !renaming) pencil.current?.focus();
    was.current = renaming;
  }, [renaming]);
  const waiting = a.stage === 'waiting';
  const idle = list.waiting && !waiting;
  const run = async path => { setRefused(''); setRefused(await act(path)); };
  const rows = a.plan ? planRows(a.plan.limits) : [];
  const same = a.sameAs ? sameAccountWords(a, list) : '';

  return html`<li class="account" aria-labelledby=${`account-${a.id}`}>
    <div class="account-head">
      <div class="account-info">
        ${renaming
          ? html`<${NameForm} label=${`Rename ${a.name}`} value=${a.name} max=${40} blurSaves=${false} onCancel=${() => setRenaming(false)}
              onSubmit=${async text => {
                const problem = await act(`api/accounts/${enc(a.id)}/rename`, { name: clean(text) });
                setRefused(problem);
                if (!problem) setRenaming(false);
                return !problem;
              }} />`
          : html`<p class="account-name"><span id=${`account-${a.id}`}>${a.name}</span>${a.active ? html` <span class="badge" data-variant="secondary">Active</span>` : null}</p>`}
        <p class="account-meta">${a.email ? html`<span>${a.email}</span>` : null}${a.planType ? html`<span>${a.planType}</span>` : null}</p>
        <p class="account-line">${signInLine(a)}</p>
      </div>
      <div class="account-actions">
        ${!a.active && !a.signedOut ? html`<button class="btn" data-variant="outline" data-size="sm" type="button" onClick=${() => run(`api/accounts/${enc(a.id)}/use`)}>Switch to this</button>` : null}
        ${needsSignIn(a) ? html`<${Button} action=${{ label: waiting ? 'Waiting for the Mac' : 'Sign in', busy: waiting || idle, variant: a.signedOut ? null : 'outline' }} onClick=${() => run(`api/accounts/${enc(a.id)}/sign-in`)} />` : null}
        ${renaming ? null : html`<button class="btn" data-variant="ghost" data-size="sm" type="button" ref=${pencil} aria-label=${`Rename ${a.name}`} onClick=${() => setRenaming(true)}>Rename</button>`}
      </div>
    </div>
    ${a.out ? html`<${Alert} tone="warning">Out of usage: ${a.out.text}<//>` : null}
    ${same ? html`<${Alert} tone="warning">${same}<//>` : null}
    <p class="account-progress" role="status">${waiting ? waitingWords(a) : ''}</p>
    <p class="notice" role="alert">${refused || (a.stage === 'failed' ? a.problem : '')}</p>
    ${rows.length ? html`<div class="account-plan"><${Plan} id=${`account-${a.id}`} rows=${rows} /><p class="plan-reset">As of ${planAsOf(a.plan.at)}</p></div>` : null}
    <${Chats} chats=${a.chats} />
  </li>`;
}

function AddForm({ list, act }) {
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const blocked = list.waiting;
  const add = async e => {
    e.preventDefault();
    if (busy || blocked) return;
    setBusy(true);
    setProblem('');
    const refused = await act('api/accounts', { name: clean(name) });
    setBusy(false);
    setProblem(refused);
    if (!refused) setName('');
    else input.current?.focus();
  };
  return html`<form class="account-add" onSubmit=${add}>
    <label for="account-name">Add an account</label>
    <div class="account-add-row">
      <input class="input" id="account-name" ref=${input} value=${name} maxlength="80" autocomplete="off" aria-describedby="account-add-hint" aria-invalid=${problem ? 'true' : null} placeholder="Name, such as Work" onInput=${e => setName(e.currentTarget.value)} />
      <button class="btn" type="submit" aria-disabled=${blocked || busy || !clean(name) ? 'true' : null} data-disabled=${blocked || busy || !clean(name) || null}>Add and sign in</button>
    </div>
    <p class="quiet account-hint" id="account-add-hint">Signing in opens a page in the browser on the Mac. Approve it with the Claude account you want to add.</p>
    <p class="notice" role="alert">${problem}</p>
  </form>`;
}

export function AccountsPane() {
  useDocumentTitle('Accounts · GhostShell');
  const { list, problem, act } = useAccountList();
  const [refused, setRefused] = useState('');
  const toggle = async e => { setRefused(''); setRefused(await act('api/accounts/auto', { on: e.currentTarget.checked })); };

  return html`<section class="session" id="accounts">
    <header class="chat-head">
      <a class="btn back" data-variant="ghost" data-size="sm" href="#/" aria-label="Back to sessions">${chevron()}Sessions</a>
      <div class="chat-title"><h2>Accounts</h2></div>
    </header>
    <div class="accounts-body">
      <div class="accounts-inner">
        <p class="quiet account-lead">Chats and routines run on the active account. Switching takes one click and no sign-in, and a chat carries on where it was.</p>
        ${list
          ? html`<ul class="account-list">${list.accounts.map(a => html`<${AccountRow} key=${a.id} a=${a} list=${list} act=${act} />`)}</ul>
            <${AddForm} list=${list} act=${act} />
            <div class="account-auto">
              <label><input type="checkbox" checked=${list.autoSwitch} onChange=${toggle} aria-describedby="account-auto-hint" /> Switch accounts by itself</label>
              <p class="quiet account-hint" id="account-auto-hint">When the active account runs out of usage, new messages go to another signed-in account. A chat that is mid-turn finishes where it is.</p>
              <p class="notice" role="alert">${refused}</p>
            </div>`
          : problem ? null : html`<p class="quiet">Loading accounts</p>`}
        <p class="notice" role="alert">${problem}</p>
      </div>
    </div>
  </section>`;
}

// The sidebar banner for an active account that is out of usage and has another to go to.
export function OutBanner({ banners, load }) {
  const view = outBanner(banners?.accounts);
  const [refused, setRefused] = useRefusal(view?.to.id, banners?.accounts?.out?.at);
  if (!view) return null;
  const go = async () => {
    setRefused('');
    try { await api(`api/accounts/${enc(view.to.id)}/use`, {}); await load(); } catch (e) { setRefused(e.message); }
  };
  return html`<${Banner} ...${view} problem=${refused} actions=${html`<${Button} action=${{ label: view.label }} onClick=${go} />`} />`;
}

// The notice that GhostShell switched by itself, which stays until it is dismissed.
export function AutoBanner({ banners, load }) {
  const view = autoBanner(banners?.accounts);
  const [refused, setRefused] = useRefusal(banners?.accounts?.auto?.at);
  if (!view) return null;
  const dismiss = async () => {
    setRefused('');
    try { await api('api/accounts/seen', {}); await load(); } catch (e) { setRefused(e.message); }
  };
  return html`<${Banner} ...${view} problem=${refused} actions=${html`<${Button} action=${{ label: 'Dismiss', variant: 'ghost' }} onClick=${dismiss} />`} />`;
}

// Under a chat's error notice, when its turn ran out of usage and another account can take over: switches to the one the server picks for the banner and sends "Continue.".
export function SwitchAndContinue({ ctrl, on }) {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    setTarget(null);
    if (!on) return undefined;
    let live = true;
    api('api/banners').then(banners => { if (live) setTarget(banners?.accounts?.out?.to ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [on]);
  if (!on || !target) return null;
  const go = async () => {
    try { await api(`api/accounts/${enc(target.id)}/use`, { continue: ctrl.id }); ctrl.notice(''); } catch (e) { ctrl.notice(e.message); }
  };
  return html`<div class="notice-action"><${Button} action=${{ label: `Switch to ${target.name} and continue`, variant: 'outline' }} onClick=${go} /></div>`;
}
