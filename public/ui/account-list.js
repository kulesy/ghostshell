// The accounts as the picks and the notices need them: one list for the page, asked for when something that shows a pick is on screen.
import { api } from './api.js';
import { supportsPins } from './account-rules.js';
import { useStore } from './hooks.js';
import { useEffect } from './html.js';
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

// The listed accounts, or null until they are known or when the server does not pin.
export function useAccounts(ix) {
  const on = supportsPins(ix);
  useEffect(() => { if (on) loadAccounts(); }, [on]);
  const accounts = useStore(accountList, s => s.accounts);
  return on ? accounts : null;
}
