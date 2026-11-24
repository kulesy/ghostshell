// The Settings pane. It holds how far a session's send_session goes with no card, which only a change the owner makes to the control writes: never the load, the address or a message.
import { api } from './api.js';
import { chevron } from './form-parts.js';
import { useDocumentTitle } from './hooks.js';
import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';

const CHOICES = [
  { value: 'family', name: 'Its own family', fallback: true, words: 'Its parent, the sessions beside it and the ones below it. A steered session can start turns only in its own family, including any in Bypass.' },
  { value: 'project', name: 'Its own project', words: 'Its family and any session in its project. Sessions in no project count as one project. A steered session can start turns across the project, including any in Bypass.' },
  { value: 'any', name: 'Any session', words: "Every session that isn't archived, in any project or account. A steered session can start turns in all of them, including any in Bypass." },
];

export function SettingsPane() {
  useDocumentTitle('Settings · GhostShell');
  const [saved, setSaved] = useState(null);
  const [shown, setShown] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [status, setStatus] = useState('');
  const group = useRef(null);
  const refocus = useRef(false);

  useEffect(() => {
    let live = true;
    api('api/settings').then(
      got => { if (live) { setSaved(got.sendReach); setShown(got.sendReach); } },
      e => { if (live) setProblem(`Could not load the settings: ${e.message}`); },
    );
    return () => { live = false; };
  }, []);

  // A radio that was chosen and then refused is no longer the checked one, so the focus goes back to the one that is, once the disabled ones are enabled again.
  useLayoutEffect(() => {
    if (saving || !refocus.current) return;
    refocus.current = false;
    group.current?.querySelector('input:checked')?.focus();
  }, [saving]);

  // The other radios are disabled while a save runs, so no newer choice can start and a late answer is always the latest. The chosen one stays enabled to keep the focus.
  const pick = async e => {
    const { value } = e.currentTarget;
    setShown(value);
    setSaving(true);
    setProblem('');
    setStatus('');
    try {
      const got = await api('api/settings', { sendReach: value });
      setSaved(got.sendReach);
      setShown(got.sendReach);
      setStatus('Saved.');
    } catch (err) {
      // The server may have saved it and the answer been lost, so it is asked what it holds.
      const held = await api('api/settings').then(got => got.sendReach, () => saved);
      refocus.current = !!group.current?.contains(document.activeElement);
      setSaved(held);
      setShown(held);
      setProblem(err.message);
    } finally {
      setSaving(false);
    }
  };

  return html`<section class="session" id="settings">
    <header class="chat-head">
      <a class="btn back" data-variant="ghost" data-size="sm" href="#/" aria-label="Back to sessions">${chevron()}Sessions</a>
      <div class="chat-title"><h2>Settings</h2></div>
    </header>
    <div class="settings-body">
      <div class="settings-inner">
        ${shown
          ? html`<fieldset class="send-reach" ref=${group} aria-describedby="send-reach-lead">
              <legend><h3>Messages between sessions</h3></legend>
              <p class="quiet send-reach-lead" id="send-reach-lead">Choose which messages a session can send without asking you. A message starts a turn in the session it reaches, and text on a web page, in an email or in a pull request comment could steer a session into sending one.</p>
              <div class="send-choices">${CHOICES.map(c => html`<label class="send-choice" key=${c.value}>
                <input type="radio" name="send-reach" value=${c.value} checked=${shown === c.value} disabled=${saving && shown !== c.value} aria-labelledby=${`send-reach-${c.value}`} aria-describedby=${`send-reach-${c.value}-words`} onChange=${pick} />
                <span class="send-choice-name" id=${`send-reach-${c.value}`}>${c.name}${c.fallback ? html`<span class="badge" data-variant="outline">Default</span>` : null}</span>
                <span class="quiet send-choice-words" id=${`send-reach-${c.value}-words`}>${c.words}</span>
              </label>`)}</div>
              <p class="quiet account-hint send-reach-note">Outside its family, a session can send 10 messages without asking. Then it asks again until you next write to it. A group's or section's chat always asks.</p>
            </fieldset>`
          : problem ? null : html`<p class="quiet">Loading settings</p>`}
        <p class="account-progress" role="status">${saving ? 'Saving' : status}</p>
        <p class="notice" role="alert">${problem}</p>
      </div>
    </div>
  </section>`;
}
