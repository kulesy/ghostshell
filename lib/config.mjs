import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// npm run build-app puts the app here, and the launchd agent runs the server through its executable.
export const APP = path.join(os.homedir(), 'Library', 'Application Support', 'Capcom', 'Capcom.app');
const home = p => p.replace(/^~(?=\/|$)/, os.homedir());

const readJson = (name, optional) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8')); } catch (e) { if (optional && e.code === 'ENOENT') return {}; throw e; }
};

// config.local.json is git-ignored and wins over config.json, so one machine's values never reach the repo.
const file = { station: os.hostname().split('.')[0], ...readJson('config.json'), ...readJson('config.local.json', true) };

// CAPCOM_STATE points a test instance at its own login and registry, so it never touches the real ones.
export const cfg = {
  ...file,
  port: Number(process.env.PORT || file.port),
  claude: process.env.CAPCOM_CLAUDE || file.claude,
  gh: process.env.CAPCOM_GH || file.gh || 'gh',
  // Test instances point these at a stub keychain tool and a scratch folder, so none reads the real keychain or fetches the real repo, and shorten the
  // wait before the first check for updates.
  security: process.env.CAPCOM_SECURITY || 'security',
  updateRoot: process.env.CAPCOM_UPDATE_ROOT || ROOT,
  updateDelayMs: process.env.CAPCOM_UPDATE_DELAY_MS === undefined ? 60_000 : Number(process.env.CAPCOM_UPDATE_DELAY_MS),
  retireQuietMs: process.env.CAPCOM_RETIRE_QUIET_MS === undefined ? 15_000 : Number(process.env.CAPCOM_RETIRE_QUIET_MS),
  desktopHandoff: file.desktopHandoff === true,
  chrome: file.chrome !== false,
  groupUpdates: file.groupUpdates !== false,
  // Test instances only: divides the waits of the group updates, so a run takes seconds.
  groupUpdateScale: Number(process.env.CAPCOM_GROUP_UPDATE_SCALE) || 1,
  autoTitle: process.env.CAPCOM_AUTO_TITLE === undefined ? file.autoTitle !== false : process.env.CAPCOM_AUTO_TITLE !== '0',
  passkeyOrigins: [].concat(file.passkeyOrigins || []),
  desktopDir: home(file.desktopDir),
  projectsDir: home(file.projectsDir),
  stateDir: home(process.env.CAPCOM_STATE || file.stateDir),
};

fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
