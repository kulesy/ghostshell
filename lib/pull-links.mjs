// Every pull request each session names, kept in memory for search. A worker thread reads the transcripts, because the first pass takes
// tens of seconds and one big file blocks for over a second. See docs/adr/20261104-search-sessions-by-pull-request.md.
import { Worker } from 'node:worker_threads';
import { urlsOfItem } from './pulls.mjs';
import { indexTranscripts, itemsFromEntry, keepScans } from './transcripts.mjs';
import { PULL_URL } from '../public/ui/pull-url.js';

const FIRST_REPORT_EVERY = 100;
const NEEDLE = Buffer.from('/pull/');

// A link is owner/repo#7969, in the case it was written in. GitHub ignores case in a name, so two spellings count once.
function onLine(scan, line) {
  let items = [];
  try { items = itemsFromEntry(JSON.parse(line), '', Infinity, 0); } catch {}
  for (const item of items) {
    for (const url of urlsOfItem(item)) {
      const [, owner, repo, number] = PULL_URL.exec(url);
      const link = `${owner}/${repo}#${number}`;
      if (!scan.links.has(link.toLowerCase())) scan.links.set(link.toLowerCase(), link);
    }
  }
}

// The scan of a projects folder as plain calls, so it runs in the worker and in a test alike. `pass()` visits the newest transcripts first, skips a
// file whose size and time are as they were, and reads only what a changed one gained. It returns whether any session's links changed, and
// calls `onProgress` along the way once every FIRST_REPORT_EVERY files read, so a first pass gives recent sessions at once.
export function makeLinkScan(projectsDir) {
  const read = keepScans({ needles: [NEEDLE], fresh: () => ({ links: new Map() }), onLine, kept: Infinity });
  const held = new Map();
  return {
    pass({ onProgress = () => {} } = {}) {
      const files = [...indexTranscripts(projectsDir, 0).values()].sort((a, b) => b.mtime - a.mtime);
      let changed = false;
      let done = 0;
      for (const t of files) {
        const known = held.get(t.id);
        if (known?.size === t.size && known.mtime === t.mtime) continue;
        let links;
        try {
          links = [...read(t).links.values()];
        } catch {
          continue;
        }
        if (links.join() !== (known?.links ?? []).join()) changed = true;
        held.set(t.id, { size: t.size, mtime: t.mtime, links });
        if (++done % FIRST_REPORT_EVERY === 0 && changed) {
          onProgress();
          changed = false;
        }
      }
      const present = new Set(files.map(t => t.id));
      for (const id of held.keys()) if (!present.has(id)) { held.delete(id); changed = true; }
      return changed;
    },
    links: () => Object.fromEntries([...held].filter(([, h]) => h.links.length).map(([id, h]) => [id, h.links])),
  };
}

// What the server holds: the latest links the worker sent and whether its first pass is still going. If the worker dies, search keeps what it
// had and falls back to titles for the rest.
export function startPullLinks({ projectsDir, everyMs = 15_000, log = console.error, worker = new URL('./pull-links-worker.mjs', import.meta.url) }) {
  let state = { links: {}, reading: true };
  const thread = new Worker(worker, { workerData: { projectsDir, everyMs } });
  thread.on('message', message => { state = message; });
  thread.on('error', err => log(`Pull request search stopped reading: ${err.message}`));
  thread.on('exit', () => { state = { ...state, reading: false }; });
  // Last, because adding a message listener takes the unref back and the worker would then keep the process alive.
  thread.unref();
  return { get: () => state };
}
