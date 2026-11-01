// The card the sidebar shows above its sections, for a sign-in that is ending, an update that is waiting and the passkey offer. A banner has a
// title, some words, optionally a list as its children, a problem (announced at once), a progress line and its buttons.
import { html } from './html.js';
import { draw, icons } from './menu.js';

export function Banner({ id, tone, title, text, problem = '', progress = '', actions, children }) {
  return html`<aside class="offer" data-tone=${tone || null} aria-labelledby=${`${id}-title`}>
    <h2 id=${`${id}-title`}>${tone === 'warning' ? draw(icons.triangleAlert) : null}${title}</h2>
    <p class="offer-text">${text}</p>
    ${children}
    <p class="notice" role="alert">${problem}</p>
    <p class="offer-progress" role="status">${progress}</p>
    <div class="offer-actions">${actions}</div>
  </aside>`;
}
