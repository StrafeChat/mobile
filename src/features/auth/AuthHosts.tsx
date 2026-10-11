/**
 * What the auth area mounts once at the app root (inside UiProvider): the account switcher
 * sheet that openAccountSwitcher() opens. Without it, openAccountSwitcher() still works - it
 * falls back to the shared action sheet.
 */
import { AccountSwitcherSheet } from './accounts';

export function AuthHosts() {
  return <AccountSwitcherSheet />;
}
