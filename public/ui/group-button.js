// The header of a group or built-in section in the sidebar, which opens its own session, and the button on it that starts a new session there.
// The header is a link, so it opens in a new tab as a row does, and it carries a lamp while that session works or waits for the owner.
// See docs/adr/20261023-a-session-for-each-group.md.
import { STATE_LABEL } from './format.js';
import { litState } from './group-rules.js';
import { html } from './html.js';
import { draw, icons } from './menu.js';

export function GroupChatHead({ group, name, count, current }) {
  const lit = litState(group.session);
  const label = `Open ${group.section ? `the ${group.name} section's` : `${group.name}'s`} session${lit ? `, ${STATE_LABEL[lit]}` : ''}`;
  return html`<a class="group-head" href=${`#/g/${encodeURIComponent(group.id)}`} data-key=${group.id} draggable=${false} aria-label=${label} aria-current=${current ? 'page' : null}>
    <span class="name">${name}</span> <span class="badge count">${count}</span>${lit ? html`<span class="lamp" data-state=${lit} aria-hidden="true"></span>` : null}</a>`;
}

// The class `more` gives it the header's small button, which a press does not lift for a drag.
export function NewHereButton({ group, start }) {
  const label = `New session in ${group.name}`;
  return html`<button class="more head-tool" type="button" aria-label=${label} data-tip=${label} onClick=${start}>${draw(icons.messageSquarePlus)}</button>`;
}
