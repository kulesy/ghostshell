// Runs in a worker thread started by startPullLinks. It posts the whole map when it changes, and `reading: false` once the first pass ends.
import { parentPort, workerData } from 'node:worker_threads';
import { makeLinkScan } from './pull-links.mjs';

const scan = makeLinkScan(workerData.projectsDir);
let reading = true;
let told = '';
const post = () => parentPort.postMessage({ links: scan.links(), reading });

function run() {
  let changed = false;
  try {
    changed = scan.pass({ onProgress: post });
  } catch (err) {
    if (err.message !== told) console.error(`Could not read the pull requests in sessions: ${err.message}`);
    told = err.message;
  }
  if (changed || reading) {
    reading = false;
    post();
  }
  setTimeout(run, workerData.everyMs);
}

run();
