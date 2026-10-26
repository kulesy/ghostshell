// Run with `npm test`. A chat's controller is plain functions on plain data, so it runs here against a fake page,
// event stream and server, with no browser.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const streams = [];
class FakeStream {
  constructor(url) { this.url = url; this.heard = {}; streams.push(this); }
  addEventListener(type, fn) { this.heard[type] = fn; }
  close() {}
  emit(type, data) { this.heard[type]({ data: JSON.stringify(data) }); }
}
globalThis.document = { getElementById: () => ({ dataset: { home: '/Users/someone' } }), addEventListener() {}, removeEventListener() {}, hidden: false };
globalThis.EventSource = FakeStream;
globalThis.fetch = async url => {
  const body = String(url).endsWith('/chips') ? { chips: [] } : { items: [], start: 0, end: 0, hasEarlier: false };
  return { status: 200, ok: true, json: async () => body };
};
// The page reads the document as the module loads, so the fake has to be in place first.
const { createChat } = await import('../public/ui/session.js');

async function openChat(id) {
  let reloads = 0;
  const chat = createChat({ id, refreshIndex() { reloads++; } });
  await chat.open();
  return { chat, stream: streams.at(-1), reloads: () => reloads };
}
const undelivered = id => ({ id, from: 'Worker', state: 'dropped', outcome: 'expired' });
const cards = chat => chat.store.get().holdsEnded.map(d => d.id);

test('the grey cards of a chat are still there when the owner opens another chat and comes back', async () => {
  const one = await openChat('chat-switch');
  one.stream.emit('hold-ended', undelivered('a'));
  one.stream.emit('hold-ended', { id: 'r', from: 'Worker', state: 'released', outcome: '' });
  one.stream.emit('hold-ended', undelivered('b'));
  one.chat.close();
  const other = await openChat('chat-elsewhere');
  assert.deepEqual(cards(other.chat), [], 'another chat has none of them');
  other.chat.close();
  assert.deepEqual(cards(createChat({ id: 'chat-switch', refreshIndex() {} })), ['a', 'b'], 'there as the pane is built, and a released hold left none');
});

test('a card goes when the owner dismisses it, and stays gone the next time the chat is opened', async () => {
  const one = await openChat('chat-dismiss');
  for (const id of ['a', 'b', 'c']) one.stream.emit('hold-ended', undelivered(id));
  one.chat.dismissHold(['a', 'b']);
  assert.deepEqual(cards(one.chat), ['c']);
  one.chat.close();
  assert.deepEqual(cards(createChat({ id: 'chat-dismiss', refreshIndex() {} })), ['c']);
});

test('a chat keeps its 100 newest undelivered messages and drops the oldest first', async () => {
  const one = await openChat('chat-many');
  for (let n = 0; n < 105; n++) one.stream.emit('hold-ended', undelivered(`m${n}`));
  one.chat.close();
  const kept = cards(createChat({ id: 'chat-many', refreshIndex() {} }));
  assert.equal(kept.length, 100);
  assert.deepEqual([kept[0], kept.at(-1)], ['m5', 'm104']);
});

// The changes a chat posts, for one test: `sent` lists them as [url, body], and `answer(url)` is what each one gets back.
async function withChanges(answer, run) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (init?.method !== 'POST') return real(url, init);
    sent.push([String(url), JSON.parse(init.body)]);
    return answer(String(url));
  };
  try { await run(sent); } finally { globalThis.fetch = real; }
}
const SETTINGS = { state: 'idle', running: true, mode: 'manual', model: 'claude-opus-5-5', shownModel: 'claude-opus-5-5', effort: 'high', fast: false, pending: [] };

test('fast mode shows at once, is posted to its own route as true or false, and takes the status Capcom answers with', async () => {
  await withChanges(() => ({ status: 200, ok: true, json: async () => ({ ...SETTINGS, fast: true }) }), async sent => {
    const { chat, stream } = await openChat('chat-fast');
    stream.emit('status', SETTINGS);
    const picking = chat.pick('fast', true);
    assert.equal(chat.store.get().status.fast, true, 'it shows before Capcom has answered');
    await picking;
    assert.deepEqual(sent.filter(([url]) => !url.endsWith('/context')), [['api/sessions/chat-fast/fast', { fast: true }]]);
    assert.equal(chat.store.get().status.fast, true);
    chat.close();
  });
});

test('a fast mode change that Capcom refuses is put back, with the reason in a notice', async () => {
  await withChanges(() => ({ status: 400, ok: false, json: async () => ({ error: 'Not on this model.' }) }), async () => {
    const { chat, stream } = await openChat('chat-fast-refused');
    stream.emit('status', { ...SETTINGS, fast: true });
    await chat.pick('fast', false);
    assert.equal(chat.store.get().status.fast, true);
    assert.equal(chat.store.get().notice, 'Not on this model.');
    chat.close();
  });
});

test('a refused pick shows the status Capcom answers with, so two quick picks that are both refused leave the model the chat is on', async () => {
  const held = [];
  const refusal = { status: 400, ok: false, json: async () => ({ error: 'Claude refused that change.', status: SETTINGS }) };
  await withChanges(url => (url.endsWith('/model') ? new Promise(resolve => held.push(resolve)) : { status: 200, ok: true, json: async () => ({}) }), async () => {
    const { chat, stream } = await openChat('chat-two-picks');
    stream.emit('status', SETTINGS);
    const first = chat.pick('model', 'claude-haiku-5-5');
    const second = chat.pick('model', 'claude-sonnet-5-5');
    assert.equal(chat.store.get().status.model, 'claude-sonnet-5-5');
    held[0](refusal);
    await first;
    held[1](refusal);
    await second;
    assert.equal(chat.store.get().status.model, 'claude-opus-5-5', 'the first pick is not put back over the second');
    assert.equal(chat.store.get().notice, 'Claude refused that change.');
    chat.close();
  });
});

test('a fast event from Capcom, as when another page switches it, changes the status', async () => {
  const { chat, stream } = await openChat('chat-fast-event');
  stream.emit('status', SETTINGS);
  stream.emit('fast', { fast: true });
  assert.equal(chat.store.get().status.fast, true);
  stream.emit('fast', { fast: false });
  assert.equal(chat.store.get().status.fast, false);
  chat.close();
});

test('a send reply that reaches the page after a fast event leaves fast mode as the event set it, and the rest of the reply still applies', async () => {
  let reply;
  const held = new Promise(resolve => { reply = resolve; });
  await withChanges(() => held, async () => {
    const { chat, stream } = await openChat('chat-fast-send');
    stream.emit('status', SETTINGS);
    const sending = chat.send('hello', []);
    stream.emit('fast', { fast: true });
    reply({ status: 200, ok: true, json: async () => ({ ...SETTINGS, fast: false, effort: 'max' }) });
    await sending;
    assert.deepEqual([chat.store.get().status.fast, chat.store.get().status.effort], [true, 'max']);
    chat.close();
  });
});

test('a send reply is the whole status for a page that has none yet', async () => {
  await withChanges(() => ({ status: 200, ok: true, json: async () => ({ ...SETTINGS, fast: true }) }), async () => {
    const { chat } = await openChat('chat-fast-send-first');
    assert.equal(chat.store.get().status, null);
    await chat.send('hello', []);
    assert.equal(chat.store.get().status.fast, true);
    chat.close();
  });
});

test('a new chat holds fast mode as a pick and sends it to the new session only once it has been picked', async () => {
  globalThis.location = {};
  try {
    await withChanges(() => ({ status: 200, ok: true, json: async () => ({ id: 'made' }) }), async sent => {
      const plain = createChat({ draft: true, refreshIndex() {} });
      await plain.startNew('hello', [], () => {});
      assert.equal('fast' in sent[0][1], false);

      const fast = createChat({ draft: true, refreshIndex() {} });
      assert.equal(fast.store.get().status.fast, false, 'a new chat starts with it off');
      await fast.pick('fast', true);
      assert.equal(fast.store.get().status.fast, true);
      assert.equal(sent.length, 1, 'nothing is posted before the session exists');
      await fast.startNew('hello', [], () => {});
      assert.equal(sent[1][0], 'api/new');
      assert.equal(sent[1][1].fast, true);
    });
  } finally {
    delete globalThis.location;
  }
});

test('a new chat asks for the home folder\'s defaults, never lists folders, and starts its session in the home folder', async () => {
  globalThis.location = {};
  const real = globalThis.fetch;
  const asked = [];
  const reply = body => ({ status: 200, ok: true, json: async () => body });
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    asked.push([address, init?.method === 'POST' ? JSON.parse(init.body) : null]);
    return reply(address === 'api/new' ? { id: 'made-in-home' } : { mode: 'plan', model: 'claude-opus-5-5', shownModel: 'claude-opus-5-5', effort: 'high' });
  };
  try {
    const chat = createChat({ draft: true, refreshIndex() {} });
    await chat.open();
    assert.deepEqual(asked.map(([address]) => address), ['api/defaults?cwd=%2FUsers%2Fsomeone']);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(chat.store.get().status.mode, 'plan', 'the mode is the one Desktop would use in the home folder');
    await chat.startNew('hello', [], () => {});
    assert.deepEqual(asked.map(([address]) => address), ['api/defaults?cwd=%2FUsers%2Fsomeone', 'api/new']);
    assert.equal(asked[1][1].cwd, '/Users/someone');
    chat.close();
  } finally {
    globalThis.fetch = real;
    delete globalThis.location;
  }
});

// A fake server for one test: the chat opens on `starts[0]`, each Load earlier moves to the next start, and `pictures` answers the list of pictures.
async function withServer({ starts, pictures }, run) {
  const real = globalThis.fetch;
  const asked = [];
  let moved = 0;
  const reply = body => ({ status: 200, ok: true, json: async () => body });
  globalThis.fetch = async url => {
    const address = String(url);
    if (address.includes('/images?')) { asked.push(address); return pictures(address); }
    if (address.endsWith('/chips')) return reply({ chips: [] });
    const start = starts[address.includes('/messages?before=') ? ++moved : 0];
    return reply({ items: [], start, end: 900, hasEarlier: start > 0 });
  };
  try { await run(asked); } finally { globalThis.fetch = real; }
}
const failure = error => ({ status: 500, ok: false, json: async () => ({ error }) });
const listing = ref => ({ status: 200, ok: true, json: async () => ({ items: [{ kind: 'user', images: [{ ref, type: 'image/png' }] }] }) });

test('the viewer asks for the pictures before the loaded messages once for each start, again after Load earlier, and again after a failed answer', async () => {
  let failing = false;
  const pictures = address => (failing ? failure('Could not list the pictures.') : listing(`${/before=(\d+)/.exec(address)[1]}.0.u`));
  await withServer({ starts: [600, 200, 100], pictures }, async asked => {
    const { chat } = await openChat('chat-pictures');
    const refs = async () => (await chat.earlierImages()).map(item => item.images[0].ref);
    assert.deepEqual(await refs(), ['600.0.u']);
    assert.deepEqual(await refs(), ['600.0.u']);
    assert.deepEqual(asked, ['api/sessions/chat-pictures/images?before=600'], 'once for the start the chat opened with');

    await chat.loadEarlier();
    assert.deepEqual(await refs(), ['200.0.u']);
    assert.deepEqual(await refs(), ['200.0.u']);
    assert.deepEqual(asked.slice(1), ['api/sessions/chat-pictures/images?before=200'], 'and once more now that the start has moved');

    await chat.loadEarlier();
    failing = true;
    await assert.rejects(chat.earlierImages(), /Could not list the pictures/);
    failing = false;
    assert.deepEqual(await refs(), ['100.0.u'], 'a failed answer is not kept');
    assert.deepEqual(await refs(), ['100.0.u']);
    assert.equal(asked.length, 4);
    chat.close();
  });
});

test('an answer that fails after the start has moved on is dropped without taking away the answer for the new start', async () => {
  let failSlow;
  const pictures = address => (address.endsWith('before=600')
    ? new Promise(resolve => { failSlow = () => resolve(failure('Too slow.')); })
    : listing('200.0.u'));
  await withServer({ starts: [600, 200], pictures }, async asked => {
    const { chat } = await openChat('chat-moved-on');
    const slow = assert.rejects(chat.earlierImages(), /Too slow/);
    await chat.loadEarlier();
    const fresh = await chat.earlierImages();
    failSlow();
    await slow;
    assert.equal(await chat.earlierImages(), fresh, 'the answer for the new start is still the one kept');
    assert.equal(asked.length, 2);
    chat.close();
  });
});

test('connector names that Desktop gives after the chat opened reach it, and the same names again leave its session as it was', async () => {
  const real = globalThis.fetch;
  const planner = '5b6c7d8e-2222-4f3a-8b9c-abcdef012345';
  let connectors = {};
  globalThis.fetch = async url => {
    const body = String(url).endsWith('/chips')
      ? { chips: [] }
      : { items: [], start: 0, end: 10, hasEarlier: false, session: connectors && { id: 'chat-names', title: 'Moved to Desktop', connectors: { ...connectors } } };
    return { status: 200, ok: true, json: async () => body };
  };
  const settled = () => new Promise(resolve => setImmediate(resolve));
  try {
    const { chat, stream } = await openChat('chat-names');
    const session = () => chat.store.get().session;
    assert.deepEqual(session().connectors, {}, 'Desktop had no record when the chat opened');

    connectors = { [planner]: 'Planner' };
    stream.emit('changed', {});
    await settled();
    assert.deepEqual(session(), { id: 'chat-names', title: 'Moved to Desktop', connectors: { [planner]: 'Planner' } });

    const held = session();
    stream.emit('changed', {});
    await settled();
    assert.equal(session(), held, 'the same names again change nothing');

    connectors = null;
    stream.emit('changed', {});
    await settled();
    assert.equal(session(), held, 'a reply with no session keeps the names');
    chat.close();
  } finally {
    globalThis.fetch = real;
  }
});

// The page times a turn by its own clock, so the tests below set the clock the handlers read and put it back after.
const turnOf = (startedAt, turnMs) => ({ tools: [], tokens: 0, turnMs, startedAt });
async function onClock(id, run) {
  const { chat, stream } = await openChat(id);
  const real = Date.now;
  const clock = at => { Date.now = () => at; };
  try {
    run({ stream, clock, now: () => chat.store.get() });
  } finally {
    Date.now = real;
    chat.close();
  }
}

test('the start of a turn another app runs only moves earlier while it is the same turn, begins again for a new turn, and clears when the turn ends', async () => {
  await onClock('chat-outside-start', ({ stream, clock, now }) => {
    clock(1_000_000);
    stream.emit('outside', turnOf(5000, 30_000));
    assert.deepEqual([now().outside.startedAt, now().outsideStart], [5000, 970_000], 'timed from the page\'s clock');

    clock(1_002_000);
    stream.emit('outside', turnOf(5000, 31_000));
    assert.equal(now().outsideStart, 970_000, 'a report that is late for the same turn does not step the timer back');

    clock(1_003_000);
    stream.emit('outside', turnOf(5000, 40_000));
    assert.equal(now().outsideStart, 963_000, 'one that puts the start earlier moves it');

    clock(1_004_000);
    stream.emit('outside', turnOf(9000, 2000));
    assert.equal(now().outsideStart, 1_002_000, 'a new turn starts the timer again, though that is later');

    stream.emit('outside', null);
    assert.deepEqual([now().outside, now().outsideStart], [null, 0]);

    clock(1_005_000);
    stream.emit('outside', turnOf(9000, 4000));
    assert.equal(now().outsideStart, 1_001_000, 'after an end the same start is a turn of its own, with nothing earlier to keep');
  });
});

test('the status sets the turn another app runs and its timer, and a status without one clears them', async () => {
  await onClock('chat-outside-status', ({ stream, clock, now }) => {
    clock(2_000_000);
    stream.emit('status', { state: 'idle', pending: [], outside: turnOf(7000, 60_000) });
    assert.deepEqual([now().outside.startedAt, now().outsideStart], [7000, 1_940_000]);
    assert.equal(now().work, null);
    assert.equal(now().turnStart, 0);

    stream.emit('status', { state: 'idle', pending: [], outside: null });
    assert.deepEqual([now().outside, now().outsideStart], [null, 0], 'a status with no turn');

    stream.emit('status', { state: 'idle', pending: [], outside: turnOf(7000, 60_000) });
    stream.emit('status', { state: 'idle', pending: [] });
    assert.deepEqual([now().outside, now().outsideStart], [null, 0], 'and one from a server that does not say');
  });
});

test('Capcom\'s work in a chat takes over from the turn another app ran, and the end of that work leaves a turn that came back as it is', async () => {
  await onClock('chat-outside-state', ({ stream, clock, now }) => {
    clock(3_000_000);
    stream.emit('outside', turnOf(7000, 60_000));
    stream.emit('work', { thinking: false, writing: false, tools: [], tokens: 5, turnMs: 1000 });
    assert.deepEqual([now().outsideStart, now().turnStart], [2_940_000, 2_999_000]);

    for (const state of ['working', 'waiting']) {
      stream.emit('outside', turnOf(7000, 60_000));
      stream.emit('state', { state });
      assert.deepEqual([now().outside, now().outsideStart], [null, 0], `the turn of the other app goes when the chat is ${state}`);
      assert.equal(now().status.state, state);
      assert.equal(now().work.tokens, 5, 'and Capcom\'s own work stays');
      assert.equal(now().turnStart, 2_999_000);
    }

    stream.emit('outside', turnOf(7000, 61_000));
    stream.emit('state', { state: 'idle' });
    assert.deepEqual([now().work, now().turnStart], [null, 0], 'Capcom\'s work goes when the chat is idle');
    assert.deepEqual([now().outside.startedAt, now().outsideStart], [7000, 2_939_000], 'and a turn of another app is left alone');
    assert.equal(now().status.state, 'idle');
  });
});

// The work snapshot Capcom's stream gives a page: `startedAt` names the turn and the rest moves as the turn goes on.
const workOf = (startedAt, tokens = 0) => ({ thinking: false, writing: false, tools: [], tokens, turnMs: 1000, startedAt });

test('a turn that begins in a chat reloads the list once, when its work first arrives, and the next turn reloads it again', async () => {
  const { chat, stream, reloads } = await openChat('chat-list-work');
  stream.emit('status', { state: 'idle', pending: [], work: null });
  stream.emit('state', { state: 'working' });
  assert.equal(reloads(), 0, 'the state cannot tell which turn it is');
  stream.emit('work', workOf(1000));
  assert.equal(reloads(), 1);
  stream.emit('work', workOf(1000, 40));
  assert.equal(reloads(), 1, 'more of the same turn');

  stream.emit('state', { state: 'idle' });
  stream.emit('work', null);
  assert.equal(reloads(), 1, 'no work is not a turn');
  stream.emit('work', workOf(2000));
  assert.equal(reloads(), 2, 'a new turn');
  stream.emit('state', { state: 'working' });
  assert.equal(reloads(), 2, 'and the state that follows the work adds none');
  chat.close();
});

test('a message sent from the page reloads the list when its turn reports work, though the reply to it already set the state to working', async () => {
  await withChanges(() => ({ status: 200, ok: true, json: async () => ({ ...SETTINGS, state: 'working' }) }), async () => {
    const { chat, stream, reloads } = await openChat('chat-list-sent');
    stream.emit('status', SETTINGS);
    await chat.send('keep going', [], 'manual');
    assert.equal(chat.store.get().status.state, 'working', 'the reply is there before the stream is');
    stream.emit('work', workOf(3000));
    stream.emit('state', { state: 'working' });
    assert.equal(reloads(), 1, 'once, for the work, and not again for the state that follows');
    chat.close();
  });
});

test('a chat opened in the middle of a turn does not reload the list as that turn\'s work arrives', async () => {
  const { chat, stream, reloads } = await openChat('chat-list-midway');
  stream.emit('status', { state: 'working', pending: [], work: workOf(4000, 10) });
  stream.emit('work', workOf(4000, 25));
  stream.emit('work', workOf(4000, 60));
  assert.equal(reloads(), 0);
  chat.close();
});

test('a turn another app begins and the end of it each reload the list once, and more of the same turn does not', async () => {
  const { chat, stream, reloads } = await openChat('chat-list-outside');
  stream.emit('status', { state: 'idle', pending: [], outside: null });
  stream.emit('outside', turnOf(5000, 1000));
  assert.equal(reloads(), 1);
  stream.emit('outside', { ...turnOf(5000, 4000), tokens: 40 });
  assert.equal(reloads(), 1, 'the same turn with more tokens');
  stream.emit('outside', null);
  assert.equal(reloads(), 2);
  chat.close();
});

// A fake server for the context. `respond(detail, n)` gives the reply to the nth request, which asks for `detail`, and every request is logged.
const answer = body => ({ status: 200, ok: true, json: async () => body });
const figure = { source: 'process', detail: 'summary', total: 47_760, window: 300_000, autoCompactAt: 267_000, model: 'claude-haiku-5-5' };
const counted = {
  ...figure, detail: 'full',
  categories: [{ id: 'messages', name: 'Messages', tokens: 30_000 }, { id: 'system_prompt', name: 'System prompt', tokens: 14_300 }],
  buffer: { name: 'Autocompact buffer', tokens: 33_000 },
  free: { name: 'Free space', tokens: 219_240 },
};
const settled = () => new Promise(resolve => setImmediate(resolve));

async function withContext(respond, run) {
  const real = globalThis.fetch;
  const asked = [];
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.endsWith('/context')) {
      calls.push({ address, method: options?.method, body: options?.body });
      asked.push(JSON.parse(options.body).detail);
      return respond(asked.at(-1), asked.length);
    }
    if (address.endsWith('/model')) return answer({ state: 'idle', pending: [], model: JSON.parse(options.body).model });
    return real(url, options);
  };
  try { await run(asked, calls); } finally { globalThis.fetch = real; }
}

test('a chat asks for its context when the first status arrives, by POST because an ask can save a window, and keeps the figure that comes back', async () => {
  await withContext(() => answer(figure), async (asked, calls) => {
    const { chat, stream } = await openChat('chat-context');
    assert.equal(chat.store.get().context, null, 'nothing before the first status');
    stream.emit('status', { state: 'idle', pending: [] });
    await settled();
    assert.deepEqual(asked, ['summary']);
    assert.deepEqual(calls, [{ address: 'api/sessions/chat-context/context', method: 'POST', body: '{"detail":"summary"}' }]);
    assert.deepEqual(chat.store.get().context, figure);
    chat.close();
  });
});

test('the context is counted at most once in 5 seconds, what comes sooner is counted when they are up, and a closed chat counts nothing more', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    await withContext(() => answer(figure), async asked => {
      const { chat, stream } = await openChat('chat-throttle');
      stream.emit('status', { state: 'idle', pending: [] });
      await settled();
      assert.equal(asked.length, 1, 'the first is counted at once');

      stream.emit('changed', {});
      stream.emit('changed', {});
      stream.emit('turn-end', {});
      mock.timers.tick(4999);
      await settled();
      assert.equal(asked.length, 1, 'three events inside the 5 seconds wait');
      mock.timers.tick(1);
      await settled();
      assert.equal(asked.length, 2, 'and are one count once the 5 seconds are up');

      stream.emit('exit', {});
      mock.timers.tick(5000);
      await settled();
      assert.equal(asked.length, 3, 'the end of the process is counted too');

      stream.emit('changed', {});
      chat.close();
      mock.timers.tick(10_000);
      await settled();
      assert.equal(asked.length, 3, 'a count that was waiting is dropped with the chat');
    });
  } finally {
    mock.timers.reset();
  }
});

test('a new session that has not started has no window to count', async () => {
  await withContext(() => answer(figure), async asked => {
    const chat = createChat({ draft: true, refreshIndex() {} });
    assert.equal(await chat.loadContext(), null);
    assert.equal(await chat.loadContext('full'), null);
    assert.deepEqual(asked, []);
    assert.equal(chat.store.get().context, null);
  });
});

test('an answer that comes after the chat has closed is dropped', async () => {
  let release;
  await withContext(() => new Promise(resolve => { release = () => resolve(answer(figure)); }), async () => {
    const { chat, stream } = await openChat('chat-late');
    stream.emit('status', { state: 'idle', pending: [] });
    await settled();
    chat.close();
    release();
    await settled();
    assert.equal(chat.store.get().context, null);
  });
});

test('a count that fails, or comes back as something else, leaves the last figure on show', async () => {
  const replies = [answer(figure), failure('Boom.'), answer({ items: [], start: 0, end: 0, hasEarlier: false }), answer({ source: 'none', compacted: true })];
  await withContext((detail, n) => replies[n - 1], async () => {
    const { chat } = await openChat('chat-failing');
    assert.deepEqual(await chat.loadContext(), figure);
    assert.equal(await chat.loadContext(), null, 'a failure gives nothing');
    assert.deepEqual(chat.store.get().context, figure);
    assert.deepEqual(await chat.loadContext(), figure, 'the page of messages is not a figure');
    assert.deepEqual(chat.store.get().context, figure);
    assert.deepEqual(await chat.loadContext(), { source: 'none', compacted: true }, 'a real answer that there is no figure now');
    assert.deepEqual(chat.store.get().context, { source: 'none', compacted: true });
    chat.close();
  });
});

test('a full count is asked for once however many ask, brings the parts, and is kept by a summary of the same count', async () => {
  let now = figure;
  await withContext(detail => answer(detail === 'full' ? counted : now), async asked => {
    const { chat } = await openChat('chat-parts');
    const first = chat.loadContext('full');
    assert.equal(chat.loadContext('full'), first, 'the second asker waits for the first');
    assert.deepEqual(await first, counted);
    assert.deepEqual(asked, ['full']);

    await chat.loadContext('summary');
    assert.deepEqual(chat.store.get().context.categories, counted.categories, 'the same count keeps its parts');

    now = { ...figure, total: 52_000 };
    await chat.loadContext('summary');
    assert.deepEqual(chat.store.get().context, now, 'a count that has moved on does not');
    chat.close();
  });
});

test('picking a model counts the window again, because a model can have a window of its own', async () => {
  await withContext(() => answer(figure), async asked => {
    const { chat } = await openChat('chat-model');
    await chat.pick('model', 'claude-haiku-5-5');
    await settled();
    assert.deepEqual(asked, ['summary']);
    await chat.pick('effort', 'high');
    await settled();
    assert.equal(asked.length, 1, 'an effort does not change it');
    chat.close();
  });
});

test('a model changed in another tab counts the window again, because the new model can have a window of its own', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    await withContext(() => answer(figure), async asked => {
      const { chat, stream } = await openChat('chat-other-tab');
      stream.emit('status', { state: 'idle', pending: [] });
      await settled();
      assert.equal(asked.length, 1);

      stream.emit('model', { model: 'claude-opus-5-5[1m]' });
      await settled();
      assert.equal(chat.store.get().status.model, 'claude-opus-5-5[1m]');
      assert.equal(asked.length, 1, 'inside the 5 seconds it waits like any other count');
      mock.timers.tick(5000);
      await settled();
      assert.deepEqual(asked, ['summary', 'summary']);
      chat.close();
    });
  } finally {
    mock.timers.reset();
  }
});

// The reply to each full count waits for the test to let it go.
const holding = (replies, otherwise) => {
  const release = [];
  const respond = (detail, n) => {
    if (detail !== 'full') return otherwise(n);
    const reply = answer(replies[release.length]);
    return new Promise(resolve => release.push(() => resolve(reply)));
  };
  return { respond, release };
};

test('a full count that lands after a newer summary does not put the older total back: it is asked for again, and whoever waited gets the parts', async () => {
  const older = { ...counted, total: 40_000 };
  const newer = { ...counted, total: 52_000 };
  const { respond, release } = holding([older, newer], () => answer({ ...figure, total: 52_000 }));
  await withContext(respond, async asked => {
    const { chat } = await openChat('chat-race');
    const totals = [];
    chat.store.subscribe(() => totals.push(chat.store.get().context?.total));
    const waiting = chat.loadContext('full');
    await chat.loadContext('summary');
    assert.equal(chat.store.get().context.total, 52_000);

    release[0]();
    await settled();
    assert.deepEqual(asked, ['full', 'summary', 'full'], 'the older count was dropped and counted again');
    assert.equal(chat.store.get().context.categories, undefined, 'the table waits for the new count');
    assert.equal(chat.loadContext('full'), waiting, 'and a new asker waits for the same one');

    release[1]();
    assert.deepEqual(await waiting, newer);
    assert.deepEqual(chat.store.get().context, newer);
    assert.equal(totals.includes(40_000), false, 'the older total was never on show');
    chat.close();
  });
});

test('a full count dropped twice is not asked for a third time, and the figure on show stays', async () => {
  const { respond, release } = holding([{ ...counted, total: 40_000 }, { ...counted, total: 52_000 }], n => answer({ ...figure, total: n === 2 ? 51_000 : 53_000 }));
  await withContext(respond, async asked => {
    const { chat } = await openChat('chat-twice');
    const waiting = chat.loadContext('full');
    await chat.loadContext('summary');
    release[0]();
    await settled();
    await chat.loadContext('summary');
    release[1]();
    const got = await waiting;
    await settled();
    assert.deepEqual(asked, ['full', 'summary', 'full', 'summary'], 'no third full count');
    assert.deepEqual([got.total, got.categories], [53_000, undefined]);
    assert.deepEqual(chat.store.get().context, got);
    assert.equal(chat.loadContext('full') === waiting, false, 'and the next ask starts fresh');
    chat.close();
  });
});

test('a summary that lands after a newer full count is dropped, so the parts stay and it is not asked for again', async () => {
  let release;
  await withContext(detail => (detail === 'summary' ? new Promise(resolve => { release = () => resolve(answer({ ...figure, total: 40_000 })); }) : answer(counted)), async asked => {
    const { chat } = await openChat('chat-slow-summary');
    const slow = chat.loadContext('summary');
    await chat.loadContext('full');
    release();
    assert.deepEqual(await slow, counted);
    assert.deepEqual(chat.store.get().context, counted);
    assert.deepEqual(asked, ['summary', 'full']);
    chat.close();
  });
});

test('a count that failed does not stand in the way of an older one that comes back', async () => {
  let release;
  await withContext((detail, n) => (n === 1 ? new Promise(resolve => { release = () => resolve(answer(figure)); }) : failure('Boom.')), async () => {
    const { chat } = await openChat('chat-failed-newer');
    const older = chat.loadContext('full');
    assert.equal(await chat.loadContext('summary'), null, 'the newer count failed');
    release();
    assert.deepEqual(await older, figure, 'so the older one is still the newest there is');
    assert.deepEqual(chat.store.get().context, figure);
    chat.close();
  });
});

const attachedFile = (id, name) => ({ key: `file-${id}`, id, name, size: 12, type: 'text/plain' });

test('a send names its files by id beside the text, and a send without files says nothing of them', async () => {
  await withChanges(() => ({ status: 200, ok: true, json: async () => SETTINGS }), async sent => {
    const { chat, stream } = await openChat('chat-files-send');
    stream.emit('status', SETTINGS);
    await chat.send('compare them', [], 'manual', [attachedFile('u1', 'a.html'), attachedFile('u2', 'b.md')]);
    await chat.send('plain', []);
    const posts = sent.filter(([url]) => url.endsWith('/send'));
    assert.deepEqual(posts.map(([, body]) => body.files), [['u1', 'u2'], undefined]);
    assert.equal('files' in posts[1][1], false);
    chat.close();
  });
});

test('a new chat posts the ids of its files with the first message, and remembers them for the bubble until the transcript has it', async () => {
  globalThis.location = {};
  try {
    await withChanges(() => ({ status: 200, ok: true, json: async () => ({ id: 'made-with-files' }) }), async sent => {
      const chat = createChat({ draft: true, refreshIndex() {} });
      await chat.startNew('hello', [], () => {}, [attachedFile('u1', 'a.html')]);
      assert.deepEqual(sent[0][1].files, ['u1']);
      const next = createChat({ id: 'made-with-files', refreshIndex() {} });
      assert.deepEqual(next.store.get().sending.map(m => [m.text, m.files.map(f => f.name)]), [['hello', ['a.html']]]);

      const plain = createChat({ draft: true, refreshIndex() {} });
      await plain.startNew('hello', [], () => {});
      assert.equal('files' in sent[1][1], false);
    });
  } finally {
    delete globalThis.location;
  }
});

test('a bubble of files stays until the transcript has a message with the same words and number of files, and then goes', async () => {
  const real = globalThis.fetch;
  let items = [];
  const reply = body => ({ status: 200, ok: true, json: async () => body });
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (init?.method === 'POST') return reply(SETTINGS);
    if (address.endsWith('/chips')) return reply({ chips: [] });
    if (address.includes('/messages')) return reply({ items, start: 0, end: 900, hasEarlier: false });
    return real(url, init);
  };
  try {
    const { chat, stream } = await openChat('chat-files-reconcile');
    stream.emit('status', SETTINGS);
    await chat.send('compare them', [], 'manual', [attachedFile('u1', 'a.html')]);
    assert.equal(chat.store.get().sending.length, 1);
    items = [{ kind: 'user', text: 'compare them', at: null }];
    await chat.fetchNew();
    assert.equal(chat.store.get().sending.length, 1, 'a message with no files is another message');
    items = [{ kind: 'user', text: 'compare them', files: [{ name: 'a.html', type: 'text/plain', size: 12, path: '/up/u1.html' }], at: null }];
    await chat.fetchNew();
    assert.equal(chat.store.get().sending.length, 0);
    chat.close();
  } finally {
    globalThis.fetch = real;
  }
});

test('a typed first line of mentions comes back from the transcript stripped and counted as files, and still clears the bubble it was sent from', async () => {
  const real = globalThis.fetch;
  let items = [];
  const reply = body => ({ status: 200, ok: true, json: async () => body });
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (init?.method === 'POST') return reply(SETTINGS);
    if (address.endsWith('/chips')) return reply({ chips: [] });
    if (address.includes('/messages')) return reply({ items, start: 0, end: 900, hasEarlier: false });
    return real(url, init);
  };
  const still = async chat => { await chat.fetchNew(); return chat.store.get().sending.length; };
  try {
    const { chat, stream } = await openChat('chat-typed-mention');
    stream.emit('status', SETTINGS);
    await chat.send('@"/etc/hosts"\nlook at this', [], 'manual', []);
    await chat.send('@"/etc/hosts"', [], 'manual', []);
    await chat.send('@"/a" @"/b"\nboth', [], 'manual', []);
    assert.equal(chat.store.get().sending.length, 3);
    items = [{ kind: 'user', text: 'look at this', files: [{ name: 'hosts', path: '/etc/hosts', size: null }], at: null }];
    assert.equal(await still(chat), 2, 'the first is the same message as the transcript\'s');
    items = [{ kind: 'user', text: '', files: [{ name: 'hosts', path: '/etc/hosts', size: null }], at: null }];
    assert.equal(await still(chat), 1, 'a line of only a mention is a message of one file');
    items = [{ kind: 'user', text: 'both', files: [{ name: 'a', path: '/a' }], at: null }];
    assert.equal(await still(chat), 1, 'one file where two were typed is another message');
    items = [{ kind: 'user', text: 'both', files: [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }], at: null }];
    assert.equal(await still(chat), 0);
    chat.close();
  } finally {
    globalThis.fetch = real;
  }
});

test('with files attached, a mention the owner typed stays in the words and counts as text, so the bubble clears on the server\'s copy', async () => {
  const real = globalThis.fetch;
  let items = [];
  const reply = body => ({ status: 200, ok: true, json: async () => body });
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (init?.method === 'POST') return reply(SETTINGS);
    if (address.endsWith('/chips')) return reply({ chips: [] });
    if (address.includes('/messages')) return reply({ items, start: 0, end: 900, hasEarlier: false });
    return real(url, init);
  };
  try {
    const { chat, stream } = await openChat('chat-typed-mention-and-file');
    stream.emit('status', SETTINGS);
    await chat.send('@"/etc/hosts"\nlook', [], 'manual', [attachedFile('u1', 'a.html')]);
    items = [{ kind: 'user', text: '@"/etc/hosts"\nlook', files: [{ name: 'a.html', path: '/up/u1.html' }, { name: 'hosts', path: '/etc/hosts' }], at: null }];
    await chat.fetchNew();
    assert.equal(chat.store.get().sending.length, 1, 'the typed mention is not a second file when files are attached, so two files is another message');
    items = [{ kind: 'user', text: '@"/etc/hosts"\nlook', files: [{ name: 'a.html', path: '/up/u1.html', size: 12 }], at: null }];
    await chat.fetchNew();
    assert.equal(chat.store.get().sending.length, 0);
    chat.close();
  } finally {
    globalThis.fetch = real;
  }
});

test('a slash command with files that the server refuses leaves no bubble, tells the box to put the message back, and shows the server\'s words', async () => {
  const words = 'Send a slash command on its own, without files.';
  const refuse = () => ({ status: 400, ok: false, json: async () => ({ error: words }) });
  await withChanges(refuse, async () => {
    const { chat, stream } = await openChat('chat-slash-refused');
    stream.emit('status', SETTINGS);
    assert.equal(await chat.send('/compact', [], 'manual', [attachedFile('u1', 'a.html')]), false, 'false is what makes the box restore the text and the files');
    assert.equal(chat.store.get().sending.length, 0);
    assert.equal(chat.store.get().notice, `Not sent: ${words}`);
    chat.close();

    globalThis.location = {};
    try {
      const draft = createChat({ draft: true, refreshIndex() {} });
      let cleared = 0;
      await draft.startNew('/compact', [], () => { cleared++; }, [attachedFile('u1', 'a.html')]);
      assert.equal(cleared, 0, 'the box keeps its text and files');
      assert.equal(draft.store.get().notice, words);
      assert.equal(draft.store.get().starting, false);
    } finally {
      delete globalThis.location;
    }
  });
});

// A new session's controller, started the way the page does: the group is chosen on its store, and `log` lists the calls in order.
async function startFrom(group, { moveFails = false, changeTo } = {}) {
  const log = [];
  const notes = [];
  const here = { hash: '#/new' };
  let posted = [];
  globalThis.location = here;
  const chat = createChat({ draft: true, refreshIndex: async () => { log.push('refresh'); }, toast: (text, options) => notes.push([text, options]) });
  chat.store.set({ group });
  await withChanges(url => (url === 'api/new' && changeTo !== undefined && chat.store.set({ group: changeTo }), url === 'api/layout/move' && moveFails
    ? { status: 400, ok: false, json: async () => ({ error: 'Unknown group.' }) }
    : { status: 200, ok: true, json: async () => ({ id: 'made-1' }) }), async sent => {
    const originalPush = sent.push.bind(sent);
    sent.push = entry => { log.push(entry[0]); return originalPush(entry); };
    await chat.startNew('hello', [], () => log.push('cleared'));
    posted = sent;
  });
  return { chat, log, notes, here, posted };
}

test('a new session started in a group is created, then placed in the group before the list is read and the page moves on', async () => {
  const { log, here, notes, posted } = await startFrom('cg-a');
  assert.deepEqual(log, ['api/new', 'cleared', 'api/layout/move', 'refresh']);
  assert.deepEqual(posted.find(([url]) => url === 'api/layout/move')[1], { id: 'made-1', group: 'cg-a' });
  assert.equal(here.hash, '#/s/made-1');
  assert.deepEqual(notes, []);
});

test('a new session with no group chosen, as when the owner cleared it, is not moved anywhere', async () => {
  const { log, here } = await startFrom(null);
  assert.deepEqual(log, ['api/new', 'cleared', 'refresh']);
  assert.equal(here.hash, '#/s/made-1');
});

test('when the group will not take the session it still opens, with a note that says so and why', async () => {
  const { log, here, notes } = await startFrom('cg-gone', { moveFails: true });
  assert.deepEqual(log, ['api/new', 'cleared', 'api/layout/move', 'refresh']);
  assert.equal(here.hash, '#/s/made-1');
  assert.deepEqual(notes, [['Started the session, but could not put it in the group: Unknown group.', { problem: true }]]);
});

test('the group a new session is placed in is the one at send time, whatever is chosen while the request is in flight', async () => {
  const { posted } = await startFrom('cg-a', { changeTo: 'cg-b' });
  assert.deepEqual(posted.find(([url]) => url === 'api/layout/move')[1], { id: 'made-1', group: 'cg-a' });
  const none = await startFrom(null, { changeTo: 'cg-b' });
  assert.equal(none.posted.some(([url]) => url === 'api/layout/move'), false, 'a group picked after sending does not attach');
});
