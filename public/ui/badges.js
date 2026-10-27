// A session's pull requests and issues as badges: a glyph, `repo#n` and a short status word, linked to GitHub. The header lists them with a remove
// button on each and a field to add one, and a card on the Sub sessions tab lists the ones its line does not speak of, without either.
import { html } from './html.js';
import { draw, icons } from './menu.js';
import { badgeOf } from './pull-rules.js';

const GLYPH = { pull: icons.gitPullRequest, issue: icons.circleDot };

// `items` are a session's list, whose address has passed itemsOf. `row` is the session's, whose state says whether it is working on a pull
// request. `remove(item, badge)` draws a remove button on each badge and is called as it is pressed, `busy` is the set of addresses it is out for,
// and `tail` is drawn after the last badge, as the header's add button is.
export function Badges({ items, row, label, remove, busy, tail }) {
  if (!items.length && !tail) return null;
  return html`<ul class="session-links" aria-label=${label}>
    ${items.map(item => {
      const badge = badgeOf(item, row);
      const gone = `Remove ${badge.label.toLowerCase()} ${badge.ref}`;
      return html`<li class="badge session-link-item" data-variant="outline" data-tone=${badge.tone} key=${item.url}>
        <a class="session-link-link" href=${badge.url} target="_blank" rel="noopener noreferrer" aria-label=${badge.name} data-tip=${badge.tip}>
          ${draw(GLYPH[badge.kind], 'icon')}<span class="session-link-ref">${badge.ref}</span><span class="session-link-word">${badge.word}</span>
        </a>
        ${remove ? html`<button class="session-link-remove" type="button" aria-label=${gone} data-tip=${gone} disabled=${busy?.has(item.url)} onClick=${e => remove(item, e.currentTarget)}>${draw(icons.x, 'icon')}</button>` : null}
      </li>`;
    })}
    ${tail}
  </ul>`;
}
