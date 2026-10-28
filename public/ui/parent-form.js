// The form the pick bar turns into to name a new parent for the picked sessions, and to say where it goes when they are in different places.
import { NameForm } from './forms.js';
import { html, useRef, useState } from './html.js';
import { placeOptions, parentTitle, sessions } from './pick.js';
import { UNTITLED } from './order.js';
import { TITLE_MAX } from './tree.js';

// `onCreate(title, place, { ring })` resolves false when the server refused, and the form stays open. `place` is undefined when the rows
// share one. `ring` says the keyboard made it, so the focus it hands on shows its ring.
export function ParentForm({ rows, groups, onCreate, onCancel }) {
  const options = placeOptions(rows, groups);
  const asks = options.length > 1;
  const [chosen, setChosen] = useState('');
  const select = useRef(null);
  const pointed = useRef(false);
  const found = options.find(o => o.key === chosen);
  const create = text => {
    if (asks && !found) { select.current?.focus(); return false; }
    return onCreate(text, found?.place, { ring: !pointed.current });
  };
  return html`<div class="pick-bar pick-making" role="group" aria-label="New parent session" onPointerDown=${() => { pointed.current = true; }} onKeyDown=${() => { pointed.current = false; }}>
    <p class="pick-count pick-heading">New parent of ${sessions(rows.length)}</p>
    <${NameForm} label=${`Title of the new parent of ${sessions(rows.length)}`} value=${parentTitle(rows.map(r => r.title || UNTITLED))} was="" max=${TITLE_MAX} blurSaves=${false}
      onCancel=${onCancel} onSubmit=${create}>
      <div class="pick-actions">
        ${asks
          ? html`<select class="input" aria-label="Where the new parent goes" value=${chosen} ref=${select} onChange=${e => setChosen(e.target.value)}>
            <option value="" disabled>Choose where it goes</option>
            ${options.map(o => html`<option key=${o.key} value=${o.key}>${o.label}</option>`)}
          </select>`
          : null}
        <button class="btn" data-size="sm" type="submit" disabled=${asks && !found}>Create</button>
        <button class="btn" data-variant="ghost" data-size="sm" type="button" onClick=${() => onCancel(false)}>Cancel</button>
      </div>
    <//>
  </div>`;
}
