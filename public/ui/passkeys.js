// Passkeys in the signed-in page: the pane that lists, adds and removes them, and the one-time offer after a password sign-in.
import { api } from './api.js';
import { Banner } from './banner.js';
import { useDocumentTitle } from './hooks.js';
import { html, useEffect, useRef, useState } from './html.js';
import { local } from './storage.js';
import { describeFailure, makePasskey, passkeySupport } from './webauthn.js';

const DAY = 86_400_000;
const listUrl = () => `api/passkeys?origin=${encodeURIComponent(location.origin)}`;

async function addPasskey() {
  const options = await api('api/passkeys/options', { origin: location.origin });
  return (await api('api/passkeys', await makePasskey(options))).passkeys;
}

const date = iso => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

function lastUsed(iso) {
  if (!iso) return 'Never used';
  const midnight = ms => new Date(ms).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(Date.now()) - midnight(Date.parse(iso))) / DAY);
  if (days <= 0) return 'Used today';
  if (days === 1) return 'Used yesterday';
  return days < 30 ? `Used ${days} days ago` : `Used ${date(iso)}`;
}

// A password sign-in lands on ./?signed-in. The offer is made once per browser, and only where this address can use
// passkeys and none is added for it yet. Marking it made when it is shown keeps it from coming back.
export function usePasskeyOffer() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('signed-in')) return;
    history.replaceState(null, '', location.pathname + location.hash);
    if (local.get('passkeyOffered', false) || !passkeySupport().ok) return;
    api(listUrl()).then(({ available, passkeys }) => {
      if (!available || passkeys.some(p => p.rpId === location.hostname)) return;
      local.set('passkeyOffered', true);
      setShown(true);
    }).catch(() => {});
  }, []);
  return [shown, () => setShown(false)];
}

export function PasskeyOffer({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(onDone, 6000);
    return () => clearTimeout(timer);
  }, [added]);

  const add = async () => {
    setBusy(true);
    setProblem('');
    try {
      await addPasskey();
      setAdded(true);
    } catch (e) {
      setProblem(describeFailure(e));
    } finally {
      setBusy(false);
    }
  };

  if (added) return html`<aside class="offer" role="status"><p class="offer-text">Passkey added. It is listed under Passkeys.</p></aside>`;
  return html`<${Banner} id="offer" title="Sign in with a passkey" text="Skip the password next time. A passkey signs you in with a fingerprint, face or screen lock." problem=${problem}
    actions=${html`
      <button class="btn" type="button" disabled=${busy} onClick=${add}>${busy ? 'Adding a passkey' : 'Add a passkey'}</button>
      <button class="btn" data-variant="ghost" type="button" onClick=${onDone}>Not now</button>`} />`;
}

function PasskeyRow({ p, asking, ask, remove }) {
  const keep = useRef(null);
  const start = useRef(null);
  const was = useRef(false);
  useEffect(() => {
    if (asking) keep.current?.focus();
    else if (was.current) start.current?.focus();
    was.current = asking;
  }, [asking]);

  return html`<li class="passkey">
    <div class="passkey-info">
      <p class="passkey-name">${p.device || 'Unknown browser'}</p>
      <p class="passkey-meta"><span>${p.rpId}</span><span>Added ${date(p.created)}</span><span>${lastUsed(p.used)}</span></p>
    </div>
    ${asking
      ? html`<div class="passkey-ask" role="group" aria-label="Remove this passkey?" onKeyDown=${e => { if (e.key === 'Escape') ask(null); }}>
          <span>Remove this passkey?</span>
          <button class="btn" data-variant="outline" data-size="sm" type="button" ref=${keep} onClick=${() => ask(null)}>Keep</button>
          <button class="btn" data-variant="destructive" data-size="sm" type="button" onClick=${() => remove(p.id)}>Remove</button>
        </div>`
      : html`<button class="btn" data-variant="outline" data-size="sm" type="button" ref=${start} aria-label=${`Remove the passkey for ${p.device || 'an unknown browser'}, added ${date(p.created)}`} onClick=${() => ask(p.id)}>Remove</button>`}
  </li>`;
}

export function PasskeysPane() {
  useDocumentTitle('Passkeys · GhostShell');
  const [shown, setShown] = useState(null);
  const [problem, setProblem] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(null);
  const adder = useRef(null);
  const support = passkeySupport();

  useEffect(() => {
    api(listUrl()).then(setShown).catch(e => setProblem(`Could not load passkeys: ${e.message}`));
  }, []);

  const add = async () => {
    setBusy(true);
    setProblem('');
    setStatus('');
    try {
      const passkeys = await addPasskey();
      setShown(s => ({ ...s, passkeys }));
      setStatus('Passkey added.');
    } catch (e) {
      setProblem(describeFailure(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async id => {
    setProblem('');
    setStatus('');
    try {
      const { passkeys } = await api('api/passkeys/remove', { id });
      setShown(s => ({ ...s, passkeys }));
      setStatus('Passkey removed.');
      adder.current?.focus();
    } catch (e) {
      setProblem(e.message);
    } finally {
      setAsking(null);
    }
  };

  const list = shown?.passkeys;
  const why = !support.ok ? support.why : shown && !shown.available ? 'This address is not in passkeyOrigins, so GhostShell cannot use passkeys here.' : '';

  return html`<section class="session" id="passkeys">
    <header class="chat-head">
      <a class="btn back" data-variant="ghost" data-size="sm" href="#/" aria-label="Back to sessions"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Sessions</a>
      <div class="chat-title"><h2>Passkeys</h2></div>
    </header>
    <div class="passkeys-body">
      <div class="passkeys-inner">
        <p class="quiet passkey-lead">A passkey signs you in with a fingerprint, face or screen lock. The password keeps working.</p>
        ${list
          ? list.length
            ? html`<ul class="passkey-list">${list.map(p => html`<${PasskeyRow} key=${p.id} p=${p} asking=${asking === p.id} ask=${setAsking} remove=${remove} />`)}</ul>`
            : html`<p class="passkey-none">No passkeys added yet.</p>`
          : problem ? null : html`<p class="quiet">Loading passkeys</p>`}
        <div class="passkey-add">
          <button class="btn" type="button" ref=${adder} disabled=${!shown || !!why || busy} aria-describedby="passkey-why" onClick=${add}>${busy ? 'Adding a passkey' : 'Add a passkey'}</button>
          <p class="quiet passkey-why" id="passkey-why">${why}</p>
        </div>
        <p class="notice" role="alert">${problem}</p>
        <p class="passkey-status" role="status">${status}</p>
        ${list?.length ? html`<p class="quiet passkey-fine">Removing a passkey here stops it signing in. Delete it from the device or password manager that holds it as well.</p>` : null}
      </div>
    </div>
  </section>`;
}
