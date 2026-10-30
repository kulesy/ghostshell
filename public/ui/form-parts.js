// The parts the Routines and Scheduled sessions pages share: their back arrow, the dots of a row's menu, a red or amber note, and a form field.
import { html } from './html.js';
import { draw, icons } from './menu.js';

export const chevron = () => html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`;
export const dots = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>`;

export const Alert = ({ children, tone }) => html`<p class="routine-alert" data-tone=${tone || null}>${draw(icons.triangleAlert)}<span>${children}</span></p>`;

export const aria = (id, hint, error) => ({
  'aria-invalid': error ? 'true' : null,
  'aria-describedby': [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || null,
});

export function Field({ id, label, hint, error, children }) {
  return html`<div class="routine-field">
    <label for=${id}>${label}</label>
    ${children}
    ${hint ? html`<p class="routine-hint" id=${`${id}-hint`}>${hint}</p>` : null}
    <p class="routine-error" id=${`${id}-error`}>${error}</p>
  </div>`;
}
