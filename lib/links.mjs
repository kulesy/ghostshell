// The pull requests and issues the owner attached to a session, and the ones GhostShell found that he hid, in links.json in the state folder:
// { <session id>: { added: [url], hidden: [url] } }. Desktop's records are read only, so this is kept apart from them, as picks.json is.
import fs from 'node:fs';
import path from 'node:path';
import { kindOfUrl } from '../public/ui/pull-url.js';

export const MOST_ADDED = 20;

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const has = (list, url) => list.some(u => same(u, url));
const without = (list, url) => list.filter(u => !same(u, url));
const clean = list => (Array.isArray(list) ? list : []).filter(u => kindOfUrl(u)).reduce((kept, url) => (has(kept, url) ? kept : [...kept, url]), []);

const problem = message => Object.assign(new Error(message), { status: 400 });

// A session's entry from the whole file, with anything that is not a plain address dropped, so an edited file cannot put one on the page.
const entryOf = (all, id) => {
  const entry = Object.hasOwn(all, id) ? all[id] : null;
  return { added: clean(entry?.added), hidden: clean(entry?.hidden) };
};

// What a session's list holds: the items found in its transcript that are not hidden, then the added ones in the order they were added, each
// address once without regard to case.
export function shown(all, id, found) {
  const { added, hidden } = entryOf(all, id);
  return clean([...found.filter(url => !has(hidden, url)), ...added]).map(url => ({ url, attached: has(added, url) }));
}

export function makeLinks(stateDir) {
  const file = path.join(stateDir, 'links.json');
  const read = () => {
    try {
      const all = JSON.parse(fs.readFileSync(file, 'utf8'));
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
      return {};
    }
  };

  // Adds `url` to a session or takes it off, where `found` is what GhostShell finds in the transcript. The file is read again here and the
  // session's entry merged into it, so a write never drops another session's. Adding something hidden shows it again, and removing a found
  // item hides it.
  function set(id, url, attached, found) {
    const all = read();
    let { added, hidden } = entryOf(all, id);
    if (attached) {
      hidden = without(hidden, url);
      if (!has(found, url) && !has(added, url)) {
        if (added.length >= MOST_ADDED) throw problem(`A session holds at most ${MOST_ADDED} added items.`);
        added = [...added, url];
      }
    } else {
      added = without(added, url);
      if (has(found, url) && !has(hidden, url)) hidden = [...hidden, url];
    }
    const { [id]: gone, ...rest } = all;
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(added.length || hidden.length ? { ...rest, [id]: { added, hidden } } : rest));
    fs.renameSync(temp, file);
  }

  return { read, set };
}
