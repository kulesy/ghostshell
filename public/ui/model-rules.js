// What the model menu offers and what its button says, with no page in it so node can test it. The names are Claude Desktop's.
import { modelLabel } from './format.js';

// NOTE: [8 Nov 2026] EK - MAIN, LONG and EFFORTS are copied in apple/GhostShellKit/Sources/GhostShellKit/Models/Choices.swift. A new model or effort here needs the same line there.
export const MAIN = [['claude-opus-5-5', 'Opus 5.5'], ['claude-fable-5-1', 'Fable 5.1'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']];
export const LONG = ['claude-opus-5-5[1m]', 'Opus 5.5 (1M)'];
export const EFFORTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra'], ['max', 'Max']];
export const MAX_TIP = 'May use excessive tokens resulting in long response times and may hit token limits. Use sparingly for the hardest tasks.';

// Until the CLI's list arrives only Opus 5.5 is known to take fast mode, and from then on the list's own flag decides.
const FAST_BEFORE_LIST = ['claude-opus-5-5'];
const NAMES = new Map([...MAIN, LONG]);
const MAIN_IDS = new Set([...MAIN.map(([id]) => id), LONG[0]]);

// The CLI lists no [1m] ids, so its list is asked about the model without that suffix.
export function takesFast(model, listed) {
  const id = (model || '').replace(/\[1m\]$/i, '');
  const found = listed?.find(m => m.id === id);
  return found ? found.fast : FAST_BEFORE_LIST.includes(id);
}

// A model the lists do not hold, such as one Desktop recorded, is named by what its id says.
export const modelName = (model, listed) => NAMES.get(model) ?? listed?.find(m => m.id === model)?.label ?? modelLabel(model || '');

export const effortName = effort => EFFORTS.find(([id]) => id === effort)?.[1] ?? effort ?? '';

// The words on the button: the model (null before there is one), whether Fast shows, the effort (null when none is set) and whether it is max.
export function buttonOf({ model, effort, fast, listed }) {
  return {
    model: model ? modelName(model, listed) : null,
    fast: !!model && !!fast && takesFast(model, listed),
    effort: effort ? effortName(effort) : null,
    max: effort === 'max',
  };
}

// The button's name for assistive technology, which begins with the words it shows.
export function buttonLabel({ model, fast, effort }) {
  return `${[model || 'Model', fast && 'Fast'].filter(Boolean).join(' ')}${effort ? `, ${effort} effort` : ''}`;
}

// The menu's items. `listed` is the CLI's models while they are known and null before, `error` says why they could not be loaded,
// and `pick(kind, value)` is what a row does. A checked row does nothing, and a model or effort the lists do not hold gets one of its own.
// A row's id is its kind and value, so the row the focus is on stays under it when the CLI's list arrives and adds rows before it.
export function modelMenu({ model, effort, fast, listed, error, pick }) {
  const row = (kind, now, [id, label], extra) => ({ id: `${kind}:${id}`, label, checked: id === now, run: id === now ? undefined : () => pick(kind, id), ...extra });
  const main = MAIN.map((entry, n) => row('model', model, entry, { key: String(n + 1), hint: String(n + 1) }));

  const efforts = EFFORTS.map(entry => row('effort', effort, entry, entry[0] === 'max' ? { warn: true, tip: MAX_TIP } : null));
  if (effort && !EFFORTS.some(([id]) => id === effort)) efforts.push({ id: `effort:${effort}`, label: effort, checked: true });

  const more = [LONG, ...(listed || []).filter(m => !MAIN_IDS.has(m.id)).map(m => [m.id, m.label])];
  const models = more.map(entry => row('model', model, entry));
  if (model && !MAIN_IDS.has(model) && !more.some(([id]) => id === model)) models.push({ id: `model:${model}`, label: modelLabel(model), checked: true });
  if (error) models.push({ label: error, disabled: true });
  else if (!listed) models.push({ label: 'Loading models', disabled: true });

  return [
    { group: 'Model', heading: false, items: main },
    { separator: true },
    { label: 'Effort', value: effort ? effortName(effort) : null, warn: effort === 'max', items: efforts },
    { separator: true },
    { label: 'More models', items: models },
    ...(model && takesFast(model, listed) ? [{ separator: true }, { group: 'Fast mode', items: [{ label: 'Enable fast mode', switch: !!fast, run: () => pick('fast', !fast) }] }] : []),
  ];
}
