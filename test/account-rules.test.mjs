// Run with `npm test`. What the Chrome banner says, as rules that need no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeBanner } from '../public/ui/account-rules.js';

const second = { id: 'second', name: 'Second' };
const main = { id: 'main', name: 'Main' };
const WARNING = "Logging out deletes the extension's saved shortcuts and scheduled tasks.";

test('there is no banner without a state, or while the first check runs', () => {
  assert.equal(chromeBanner(null), null);
  assert.equal(chromeBanner(undefined), null);
  assert.equal(chromeBanner({ checking: true }), null);
});

test('Chrome on another account is a warning that names both accounts', () => {
  const view = chromeBanner({ state: 'elsewhere', to: second, on: main, email: 'work@example.com', opened: false });
  assert.deepEqual(view, {
    id: 'banner-chrome',
    tone: 'warning',
    title: 'Chrome is still on Main',
    text: "Chats on Second can't use Chrome until the Claude extension is on Second too.",
    steps: ['Press Log out in the settings.', 'Log in with work@example.com, picking it on the sign-in page.'],
    warning: WARNING,
    label: 'Open in Chrome on the Mac',
    progress: '',
  });
});

test('an unsure check asks the owner to look, with no warning tone', () => {
  const view = chromeBanner({ state: 'unknown', to: second, email: '', opened: false });
  assert.equal(view.tone, null);
  assert.equal(view.title, 'Check Chrome is on Second');
  assert.equal(view.text, 'Chrome may be closed, or on another account. Chats on Second reach Chrome only when the Claude extension is on Second too.');
  assert.deepEqual(view.steps, ['Open the settings. If Chrome was only closed, this banner clears.', 'If it stays, press Log out, then log in with the Second account.'], 'no logout until opening Chrome has had its chance, and no email known');
});

test('the warning about the extension\'s shortcuts is in both states, and the progress line only once opened', () => {
  for (const state of ['elsewhere', 'unknown']) {
    const chrome = { state, to: second, on: main, email: '', opened: false };
    assert.equal(chromeBanner(chrome).warning, WARNING);
    assert.equal(chromeBanner(chrome).progress, '');
    assert.equal(chromeBanner({ ...chrome, opened: true }).progress, 'Opened on the Mac. This clears once Chrome is on Second.');
  }
});
