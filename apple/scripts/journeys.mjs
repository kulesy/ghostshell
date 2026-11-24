// The tasks both apps are walked through, one step at a time, with a shot after each step. Plain data: shots.mjs plays it on the Mac app and
// page-shots.mjs plays it on the web page, each mapping the verbs below onto its own driver. See apple/README.md "Journeys".
//
// A step is { id, do, expect }. `do` has one verb, with the argument a person would give it:
//   { open: '<chat id>' }                     choose that chat in the sidebar
//   { type: '<text>' }                        type into the focused box, the composer unless a form is open
//   { key: 'Enter' | 'Escape' }               press a real key
//   { press: '<button>', mac, card, nth }     press a button by its name (`mac` where the Mac's name differs); `card` and `nth` name a card's buttons by hover text and place, which the Mac can't read by name
//   { pick: ['<question>', <option>, ...] }   choose options (counted from 0) on a question card
//   { link: '<link text>' }                   follow a link in the chat
//   { search: '<text>' }                      open the sidebar's search and type into it
//   { choose: <n> }                           choose the nth result (from 0) of the search
//   { menu: '<button>' }                      open the menu a button holds, leaving it open
//   { item: '<name>' }                        choose an item of the open menu by its name
//   { route: 'routines' }                     open a page from the sidebar footer
//   { fill: { field: '<label>', text } }      set a form field
// `expect` is what both apps should show after the step: { text } (a string, or a list that must all show), { gone } or { results } (how many
// search results). `stub` is the throwaway server both runners start for the journey: 'chat', 'files', 'routines' or 'chip'.
export const JOURNEYS = [
  { id: 'chat', stub: 'chat', steps: [
    { id: 'open', do: { open: 'composer' }, expect: { text: 'I renamed it in 4 files' } },
    { id: 'type', do: { type: 'Thanks, that is all' } },
    { id: 'send', do: { key: 'Enter' }, expect: { text: ['Thanks, that is all', 'Got it.'] } },
  ] },
  { id: 'approvals-question', stub: 'chat', steps: [
    { id: 'open', do: { open: 'ask-question' }, expect: { text: 'Claude is asking' } },
    { id: 'pick-runner', do: { pick: ['Which test runner should the new tests use?', 0] } },
    { id: 'pick-checks', do: { pick: ['Which checks should run before each commit?', 0, 1] } },
    { id: 'send-answers', do: { press: 'Send answers' }, expect: { gone: 'Claude is asking' } },
  ] },
  { id: 'approvals-bash', stub: 'chat', steps: [
    { id: 'open', do: { open: 'ask-bash' }, expect: { text: 'Bash wants to run a command' } },
    { id: 'allow', do: { press: 'Allow', card: 'Bash wants to run a command', nth: 0 }, expect: { gone: 'Bash wants to run a command' } },
  ] },
  { id: 'files', stub: 'files', steps: [
    { id: 'open', do: { open: 'files' }, expect: { text: 'All five match the notes.' } },
    { id: 'link', do: { link: 'NOTES.md:14' }, expect: { text: 'Upload notes' } },
    { id: 'close', do: { press: 'Close file', mac: 'Close' }, expect: { gone: 'Upload notes' } },
  ] },
  { id: 'routines', stub: 'routines', steps: [
    { id: 'route', do: { route: 'routines' }, expect: { text: 'Weekdays at 07:30' } },
    { id: 'new', do: { press: 'New routine' }, expect: { text: 'The full path of the folder each run starts in.' } },
    { id: 'title', do: { fill: { field: 'Title', text: 'Weekly digest' } } },
    { id: 'schedule', do: { fill: { field: 'Schedule', text: '0 8 * * 1' } } },
    { id: 'prompt', do: { fill: { field: 'Prompt text', text: 'Write the weekly digest from the merged pull requests.' } } },
    { id: 'save', do: { press: 'Save' }, expect: { text: 'Weekly digest' } },
  ] },
  { id: 'chip-account', stub: 'chip', steps: [
    { id: 'open', do: { open: 'chip-named' }, expect: { text: 'Starts on Second, chosen by this chip.' } },
    { id: 'menu', do: { menu: 'Change account' } },
    { id: 'pick', do: { item: 'Main' }, expect: { text: 'Starts on Main, picked here.' } },
    { id: 'start', do: { press: 'Start session', mac: 'Start' }, expect: { text: 'Opened in Release' } },
    { id: 'signed-out', do: { open: 'chip-out' }, expect: { text: 'Third, chosen by this chip, is signed out.' } },
    { id: 'pins', do: { open: 'chip-pins' }, expect: { text: 'Starts on Second, pinned to the group Release.' } },
  ] },
  { id: 'search', stub: 'chat', steps: [
    { id: 'query', do: { search: 'flaky' }, expect: { results: 1 } },
    { id: 'choose', do: { choose: 0 }, expect: { text: 'Done. I added' } },
  ] },
];

// The verb of a step's `do`, which is its only key.
export const verbOf = step => Object.keys(step.do)[0];

// The shot a step is saved under, without the Mac's `-light-default` ending or the page's folder: `j-chat-1-open`.
export const shotName = (journey, n, step) => `j-${journey}-${n}-${step}`;

// Every step in order, each with its journey, its number from 1 and its shot name.
export const journeySteps = (journeys = JOURNEYS) => journeys.flatMap(journey => journey.steps.map((step, i) => (
  { journey: journey.id, step: step.id, n: i + 1, name: shotName(journey.id, i + 1, step.id), do: step.do, expect: step.expect })));

// The pairs parity-pairs.json would hold for these shots: the Mac and the page name each step's shot the same.
export const journeyPairs = (journeys = JOURNEYS) => journeySteps(journeys).map(({ name }) => ({ mac: name, page: name }));
