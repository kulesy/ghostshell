// The button on a group's or built-in section's header in the sidebar that opens its own session. It is a link, so it opens in a new tab as a row
// does, and it carries a lamp while that session works or waits for the owner. The class `more` gives it the header's small button.
import { STATE_LABEL } from './format.js';
import { litState } from './group-rules.js';
import { html } from './html.js';
import { draw, icons } from './menu.js';

export function GroupChatButton({ group, current }) {
  const lit = litState(group.session);
  const label = `Open ${group.section ? `the ${group.name} section's` : `${group.name}'s`} session${lit ? `, ${STATE_LABEL[lit]}` : ''}`;
  return html`<a class="more chat-open" href=${`#/g/${encodeURIComponent(group.id)}`} aria-label=${label} data-tip=${label} aria-current=${current ? 'page' : null} data-state=${lit}>
    ${draw(icons.messageSquare)}${lit ? html`<span class="lamp" data-state=${lit} aria-hidden="true"></span>` : null}</a>`;
}
