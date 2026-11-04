// Run with `npm test`. Archiving the session on screen opens the next one in the sidebar, whichever way the archive happens: the row menu, the chat header, Cmd+A,
// the pick bar, a swipe, or a write from elsewhere. It also covers what must not move the window: an archive of another session, a refusal, and a phone swipe from the
// list. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, PASSWORD, request, signIn, start, until } from './harness.mjs';

const GROUPS = [{ id: 'cg-a', name: 'Reviewing' }, { id: 'cg-b', name: 'Backlog' }];
const SESSIONS = [
  { id: 's1', title: 'Align login redirect', group: 'cg-a', ago: 1 },
  { id: 's2', title: 'Billing copy update', group: 'cg-a', ago: 2 },
  { id: 's3', title: 'Changelog tidy', group: 'cg-a', ago: 3 },
  { id: 's4', title: 'Dependency review', group: 'cg-a', ago: 4 },
  { id: 'b1', title: 'Plan the quarter', group: 'cg-b', ago: 5 },
  { id: 'b2', title: 'Sort old tickets', group: 'cg-b', ago: 6 },
  { id: 'l1', title: 'Loose notes', ago: 7 },
  { id: 'old', title: 'Long gone', archived: true, ago: 30 },
];
const FAMILY = [
  { id: 'boss', title: 'Boss', group: 'cg-a', ago: 1 },
  { id: 'kid', title: 'Kid', parent: 'boss', ago: 2 },
  { id: 'grand', title: 'Grand', parent: 'kid', ago: 3 },
  { id: 'p1', title: 'Peer one', group: 'cg-a', ago: 4 },
  { id: 'p2', title: 'Peer two', group: 'cg-a', ago: 5 },
];
const MEMBERS = ['s1', 's2', 's3', 's4'];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let browser;

before(async () => {
  if (skip) return;
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const BUTTON = `#archiveButton`;
const LABEL = `(document.querySelector('${BUTTON}')?.getAttribute('aria-label') ?? null)`;
const NOTE = `[...document.querySelectorAll('[data-sonner-toast] [data-title]')].map(el => el.textContent).join('|')`;
const MENU = `.menu:not([data-sub])`;
const ASK = `document.querySelector('#ask-title')?.textContent ?? null`;
const BAR = `.pick-bar .btn[data-variant="outline"]:not(.pick-new)`;

async function login(page) {
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (!(await page.evaluate(LOGIN))) return;
  await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
  await page.click('.gate-actions button[type=submit]');
  await page.until(LIST, 10_000);
  if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
    await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
    await page.until(`!document.querySelector('.offer')`);
  }
}

// A signed-in page at `hash` once the list has drawn. `phone` is a narrow screen touched by a finger.
async function appPage(t, s, hash = '#/', { phone = false, rows = 5 } = {}) {
  const setter = await browser.open(`${s.origin}/healthz`);
  await setter.evaluate(`['groupShut', 'groupMore', 'collapsed', 'folded'].forEach(key => localStorage.removeItem('capcom.' + key)); localStorage.setItem('capcom.scope', 'null')`);
  await setter.close();
  const page = await browser.open(`${s.origin}/${hash}`, { phone });
  t.after(() => page.close());
  await login(page);
  if ((await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.until(`document.querySelectorAll('a.row[data-id]').length >= ${rows}`);
  if (hash.startsWith('#/s/')) await page.until(`!!document.querySelector('.chat-head')`);
  return page;
}

const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const hashOf = page => page.evaluate('location.hash');
const inOrder = page => page.evaluate(`[...document.querySelectorAll('a.row[data-id]')].map(a => a.dataset.id)`);
const noteIs = (page, text) => page.until(`${NOTE}.includes(${JSON.stringify(text)})`, 10_000);
const pressNoteButton = async page => {
  await page.until(`(b => !!b && b.getBoundingClientRect().bottom <= innerHeight)(document.querySelector('[data-sonner-toast] [data-action]'))`);
  await page.evaluate(`document.querySelector('[data-sonner-toast] [data-action]').click()`);
};
const rightClick = async (page, id) => {
  await page.evaluate(`(a => { const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 40, clientY: r.y + r.height / 2 })); })(document.querySelector('a.row[data-id="${id}"]'))`);
  await page.until(`!!document.querySelector('${MENU}') && document.querySelector('${MENU}').dataset.state === 'open'`);
};
const choose = async (page, label) => {
  await page.evaluate(`[...document.querySelectorAll('${MENU} > [role=menuitem]')].find(el => el.querySelector('.menu-text').textContent === ${JSON.stringify(label)}).setAttribute('data-picked', '')`);
  await page.click(`${MENU} [data-picked]`);
};
const pickRows = (page, ...ids) => page.evaluate(`(() => {
  const mac = navigator.platform.startsWith('Mac');
  for (const id of ${JSON.stringify(ids)}) document.querySelector('a.row[data-id="' + id + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
})()`);
const startedRunning = async (s, id) => {
  const { token } = await signIn(s);
  assert.equal((await request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text: 'begin a session' } })).status, 200);
  await until(() => cliCalls(s).some(c => c.user === 'begin a session'));
};
// The posts the page makes from now on.
const watchPosts = page => page.evaluate(`(() => {
  const real = window.fetch;
  window.__posts = [];
  window.fetch = (url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') window.__posts.push(String(url));
    return real(url, init);
  };
})()`);
// A refused archive: the server answers 500.
const refuseArchive = page => page.evaluate(`(() => {
  const real = window.fetch;
  window.fetch = (url, init) => (String(url).includes('api/layout/archive')
    ? Promise.resolve(new Response(JSON.stringify({ error: 'Could not archive that.' }), { status: 500, headers: { 'content-type': 'application/json' } }))
    : real(url, init));
})()`);
// The sessions of the Reviewing group in the order the sidebar draws them, with the one on screen's neighbours.
async function neighbours(page, id) {
  const group = (await inOrder(page)).filter(r => MEMBERS.includes(r));
  const at = group.indexOf(id);
  return { group, below: group[at + 1], above: group[at - 1] };
}
const swipeLeft = async (page, id) => {
  const y = await page.evaluate(`document.querySelector('a.row[data-id="${id}"]').getBoundingClientRect().y + 20`);
  await page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y }] });
  for (const x of [310, 270, 220, 160, 100, 40]) await page.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

test('the chat header archives the session on screen and opens the one below it, and Undo reopens the archived one', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  const { below } = await neighbours(page, 's2');
  assert.ok(below, 'the seed has a row below');
  await page.until(`${LABEL} === 'Archive'`);
  await page.click(BUTTON);
  await noteIs(page, 'Archived “Billing copy update”.');
  assert.equal(await hashOf(page), `#/s/${below}`);
  await page.until(`!!document.querySelector('.chat-head') && document.querySelector('${BUTTON}')?.getAttribute('aria-label') === 'Archive'`);
  assert.ok(onDisk(s).archived?.s2);

  await pressNoteButton(page);
  await noteIs(page, 'Unarchived “Billing copy update”.');
  assert.equal(await hashOf(page), '#/s/s2');
  assert.equal(onDisk(s).archived?.s2, undefined);
  assert.deepEqual(page.problems, []);
});

test('the opening is a plain hash change: the archive is the only write, and Back does not return to the archived chat', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  const { below } = await neighbours(page, 's2');
  await page.until(`${LABEL} === 'Archive'`);
  await watchPosts(page);
  const length = await page.evaluate('history.length');
  await page.click(BUTTON);
  await noteIs(page, 'Archived “Billing copy update”.');
  await page.until(`location.hash === '#/s/${below}'`);
  assert.equal(await page.evaluate('history.length'), length, 'the archived chat\'s entry was replaced, not added to');
  // The context meter reads over a POST, and the open chat asks for it by itself.
  assert.deepEqual((await page.evaluate('window.__posts')).filter(url => !url.includes('api/layout/archive') && !url.endsWith('/context')), []);
  assert.deepEqual(page.problems, []);
});

test('the row menu on the open session archives it and opens the one below', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  const { below } = await neighbours(page, 's2');
  await rightClick(page, 's2');
  await choose(page, 'Archive');
  await noteIs(page, 'Archived “Billing copy update”.');
  assert.equal(await hashOf(page), `#/s/${below}`);

  await pressNoteButton(page);
  await noteIs(page, 'Unarchived “Billing copy update”.');
  assert.equal(await hashOf(page), '#/s/s2');
  assert.deepEqual(page.problems, []);
});

test('Cmd+A archives the session on screen and opens the one below', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  const { below } = await neighbours(page, 's2');
  await page.evaluate(`Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }); document.activeElement?.blur?.()`);
  await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', metaKey: true, bubbles: true, cancelable: true }))`);
  await noteIs(page, 'Archived “Billing copy update”.');
  assert.equal(await hashOf(page), `#/s/${below}`);
  assert.deepEqual(page.problems, []);
});

test('with several rows picked the window opens the row below the last one picked, and Undo reopens the session that was on screen', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  const { group } = await neighbours(page, 's2');
  const picked = group.slice(group.indexOf('s2'), group.indexOf('s2') + 2);
  const after = group[group.indexOf('s2') + 2];
  assert.ok(after, 'the seed has a row below the picked ones');
  await pickRows(page, ...picked);
  await page.until(`!!document.querySelector('.pick-bar')`);
  await page.click(BAR);
  await noteIs(page, 'Archived 2 sessions.');
  assert.equal(await hashOf(page), `#/s/${after}`);
  assert.deepEqual(Object.keys(onDisk(s).archived).filter(id => picked.includes(id)).sort(), [...picked].sort());

  await pressNoteButton(page);
  await noteIs(page, 'Unarchived 2 sessions.');
  assert.equal(await hashOf(page), '#/s/s2');
  assert.deepEqual(page.problems, []);
});

test('an archive made elsewhere moves the window on to the next session when the page next looks, and Undo reopens the archived one', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  const { below } = await neighbours(page, 's2');
  const { token } = await signIn(s);
  assert.equal((await request(s, 'POST', '/api/layout/archive', { headers: as(token), json: { id: 's2', archived: true } })).status, 200);
  await page.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
  await noteIs(page, 'Archived “Billing copy update”.');
  assert.equal(await hashOf(page), `#/s/${below}`);

  await pressNoteButton(page);
  await noteIs(page, 'Unarchived “Billing copy update”.');
  assert.equal(await hashOf(page), '#/s/s2');
  assert.deepEqual(page.problems, []);
});

test('an archive made elsewhere of a session not on screen leaves the window alone', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  const { token } = await signIn(s);
  assert.equal((await request(s, 'POST', '/api/layout/archive', { headers: as(token), json: { id: 's4', archived: true } })).status, 200);
  await page.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
  await page.until(`!document.querySelector('a.row[data-id="s4"]')`);
  assert.equal(await hashOf(page), '#/s/s2');
  assert.equal(await page.evaluate(NOTE), '');
});

test('archiving another session from the sidebar leaves the window on the open one', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s1');
  await rightClick(page, 's3');
  await choose(page, 'Archive');
  await noteIs(page, 'Archived “Changelog tidy”.');
  assert.equal(await hashOf(page), '#/s/s1');
  assert.deepEqual(page.problems, []);
});

test('Undo reopens the archived session only when the page is still where the archive left it', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  await page.until(`${LABEL} === 'Archive'`);
  await page.click(BUTTON);
  await noteIs(page, 'Archived “Billing copy update”.');
  await page.evaluate(`location.hash = '#/s/b1'`);
  await page.until(`!!document.querySelector('.chat-head')`);
  await pressNoteButton(page);
  await noteIs(page, 'Unarchived “Billing copy update”.');
  assert.equal(await hashOf(page), '#/s/b1');
  assert.equal(onDisk(s).archived?.s2, undefined);
  assert.deepEqual(page.problems, []);
});

test('a session whose parent is archived from the sidebar while the session is on screen opens the next row outside the family', { skip, timeout }, async t => {
  const s = await start({ sessions: FAMILY, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/kid', { rows: FAMILY.length });
  const order = await inOrder(page);
  const after = order.slice(order.indexOf('boss') + 1).find(id => !['kid', 'grand'].includes(id));
  assert.ok(after);
  await rightClick(page, 'boss');
  await choose(page, 'Archive');
  await noteIs(page, 'Archived “Boss” and 2 sub sessions.');
  assert.equal(await hashOf(page), `#/s/${after}`);

  await pressNoteButton(page);
  await noteIs(page, 'Unarchived “Boss” and 2 sub sessions.');
  assert.equal(await hashOf(page), '#/s/kid');
  assert.deepEqual(page.problems, []);
});

test('the last session left goes to the list', { skip, timeout }, async t => {
  const s = await start({ sessions: [{ id: 'only', title: 'Only one', ago: 1 }], claude: true });
  const page = await appPage(t, s, '#/s/only', { rows: 1 });
  await page.until(`${LABEL} === 'Archive'`);
  await page.click(BUTTON);
  await noteIs(page, 'Archived “Only one”.');
  assert.equal(await hashOf(page), '#/');
  await pressNoteButton(page);
  await noteIs(page, 'Unarchived “Only one”.');
  assert.equal(await hashOf(page), '#/s/only');
  assert.deepEqual(page.problems, []);
});

test('two quick clicks on the header button archive once and open the next session once', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  const { below } = await neighbours(page, 's2');
  await page.until(`${LABEL} === 'Archive'`);
  await page.evaluate(`(() => {
    const real = window.fetch;
    window.__posts = [];
    window.fetch = async (url, init) => {
      if (String(url).includes('api/layout/archive')) {
        window.__posts.push(String(url));
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      return real(url, init);
    };
    const b = document.querySelector('${BUTTON}');
    b.click();
    b.click();
  })()`);
  await noteIs(page, 'Archived “Billing copy update”.');
  assert.equal(await page.evaluate('window.__posts.length'), 1);
  assert.equal(await hashOf(page), `#/s/${below}`);
  assert.deepEqual(Object.keys(onDisk(s).archived).filter(id => id !== 'old'), ['s2']);
  assert.deepEqual(page.problems, []);
});

test('an archived session opened from a search or a link stays open, through a refresh and through its own Unarchive', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/old');
  await page.until(`${LABEL} === 'Unarchive'`);
  await page.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(await hashOf(page), '#/s/old');
  await page.click(BUTTON);
  await noteIs(page, 'Unarchived “Long gone”.');
  await page.until(`${LABEL} === 'Archive'`);
  assert.equal(await hashOf(page), '#/s/old');
  assert.deepEqual(page.problems, []);
});

test('the next session opens with the draft that was left in it', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2');
  const { below } = await neighbours(page, 's2');
  await page.evaluate(`location.hash = '#/s/${below}'`);
  await page.until(`!!document.querySelector('#text')`);
  await page.click('#text');
  await page.insert('half written');
  await page.until(`JSON.parse(localStorage.getItem('capcom.drafts') ?? '{}')['${below}'] === 'half written'`);
  await page.evaluate(`location.hash = '#/s/s2'`);
  await page.until(`document.querySelector('#text')?.value === ''`);
  await page.until(`${LABEL} === 'Archive'`);
  await page.click(BUTTON);
  await noteIs(page, 'Archived “Billing copy update”.');
  assert.equal(await hashOf(page), `#/s/${below}`);
  await page.until(`document.querySelector('#text')?.value === 'half written'`);
  assert.deepEqual(page.problems, []);
});

for (const phone of [false, true]) {
  const where = phone ? 'on a phone' : 'on a desktop';
  const press = (page, selector) => (phone ? page.tap(selector) : page.click(selector));

  test(`${where}, a server that refuses the archive leaves the window on the session and the button ready`, { skip, timeout }, async t => {
    const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
    const page = await appPage(t, s, '#/s/s2', { phone });
    await page.until(`${LABEL} === 'Archive'`);
    await refuseArchive(page);
    await press(page, BUTTON);
    await page.until(`/Could not archive that/.test(${NOTE})`, 10_000);
    assert.equal(await hashOf(page), '#/s/s2');
    await page.until(`${LABEL} === 'Archive'`);
    assert.equal(onDisk(s).archived?.s2, undefined);
  });

  test(`${where}, Cancel on the question for a running session leaves the window on it`, { skip, timeout }, async t => {
    const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
    await startedRunning(s, 's2');
    const page = await appPage(t, s, '#/s/s2', { phone });
    await page.until(`${LABEL} === 'Stop and archive'`);
    await press(page, BUTTON);
    await page.until(`${ASK} === 'Stop and archive “Billing copy update”?'`);
    await page.evaluate(`document.querySelector('[data-slot="alert-dialog-cancel"]').click()`);
    await page.until(`!document.querySelector('#ask-title')`);
    assert.equal(await hashOf(page), '#/s/s2');
    assert.equal(onDisk(s).archived?.s2, undefined);
    assert.equal(await page.evaluate(LABEL), 'Stop and archive');
    assert.deepEqual(page.problems, []);
  });
}

test('on a phone the header archive opens the next session, and Undo opens the archived one', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/s/s2', { phone: true });
  const { below } = await neighbours(page, 's2');
  await page.until(`${LABEL} === 'Archive'`);
  await page.tap(BUTTON);
  await noteIs(page, 'Archived “Billing copy update”.');
  assert.equal(await hashOf(page), `#/s/${below}`);
  await pressNoteButton(page);
  await noteIs(page, 'Unarchived “Billing copy update”.');
  assert.equal(await hashOf(page), '#/s/s2');
  assert.deepEqual(page.problems, []);
});

test('on a phone a swipe in the list archives the row and opens nothing', { skip, timeout }, async t => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  const page = await appPage(t, s, '#/', { phone: true });
  await swipeLeft(page, 's2');
  await noteIs(page, 'Archived “Billing copy update”.');
  await page.until(`!document.querySelector('a.row[data-id="s2"]')`);
  assert.equal(await hashOf(page), '#/');
  assert.equal(await page.evaluate(`!!document.querySelector('.chat-head')`), false);
  assert.deepEqual(page.problems, []);
});
