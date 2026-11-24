// The account list the page holds, with no page code in it, so a chat's controller can watch it and node can run that controller.
import { api } from './api.js';
import { createStore } from './store.js';

const FRESH_MS = 3000;
export const accountList = createStore({ accounts: null, at: 0 });
let asking = null;

export function loadAccounts(force = false) {
  if (asking || (!force && Date.now() - accountList.get().at < FRESH_MS)) return asking;
  asking = api('api/accounts')
    .then(got => accountList.set({ accounts: got.accounts, at: Date.now() }))
    .catch(() => {})
    .finally(() => { asking = null; });
  return asking;
}
