// The account line on a chip card and the buttons that go with it. See docs/adr/20261104-pin-work-to-an-account.md.
import { api } from './api.js';
import { loadAccounts } from './account-list.js';
import { chipAccountItems } from './account-rules.js';
import { Button } from './banners.js';
import { html, useRef, useState } from './html.js';
import { layerId, Menu, opener } from './menu.js';

const enc = encodeURIComponent;

export function ChipAccountLine({ line, problem }) {
  return html`<p class="chip-folder chip-account" data-state=${line.state}>${line.line}</p>
    ${line.replaces ? html`<p class="chip-folder chip-account">${line.replaces}</p>` : null}
    <p class="chip-folder chip-account" data-state="refused" role="alert">${problem}</p>`;
}

// `line` is chipAccount's answer, `card` the server's words for the place, and `onPick(id)` takes an account id, or null to follow the pins.
export function ChipAccountActions({ line, card, accounts, tool, onPick, onProblem }) {
  const [shown, setShown] = useState(null);
  const opened = useRef(0);
  const pop = button => setShown(open => (open ? null : { id: `chip-account-${tool}-${++opened.current}`, anchor: button }));
  const items = shown && chipAccountItems({ accounts, card, line, pick: id => { shown.anchor.focus({ preventScroll: true }); onPick(id); } });
  const signIn = async () => {
    onProblem('');
    try {
      await api(`api/accounts/${enc(line.id)}/sign-in`, {});
      await loadAccounts(true);
    } catch (e) { onProblem(e.message); }
  };
  return html`${line.state === 'signedOut' ? html`<${Button} action=${{ label: `Sign in to ${line.name}`, variant: 'outline' }} onClick=${signIn} />` : null}
    <button class="btn" type="button" data-variant="ghost" data-chip="account" data-tool=${tool} aria-haspopup="menu" aria-expanded=${!!shown} aria-controls=${shown ? layerId(shown.id) : null} ...${opener(pop)}>Change account</button>
    <${Menu} menu=${shown && { ...shown, label: 'Account', items }} onClose=${() => setShown(null)} />`;
}
