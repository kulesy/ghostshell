// The accounts as the picks and the notices need them: one list for the page, asked for when something that shows a pick is on screen.
import { accountList, loadAccounts } from './account-store.js';
import { supportsPins } from './account-rules.js';
import { useStore } from './hooks.js';
import { useEffect } from './html.js';

export { accountList, loadAccounts };

// The listed accounts, or null until they are known or when the server does not pin.
export function useAccounts(ix) {
  const on = supportsPins(ix);
  useEffect(() => { if (on) loadAccounts(); }, [on]);
  const accounts = useStore(accountList, s => s.accounts);
  return on ? accounts : null;
}
