/**
 * The signed-in accounts, as push sees them: the desktop accounts store (reused as the
 * app's account list; see session.ts) with each account's slot attached.
 *
 * The active account's token is the live session's (auth.token): the stored copy can lag a
 * moment behind a fresh sign-in, and the live one is what the instance knows.
 */
import { activeDesktopAccountId, desktopAccounts, type DesktopAccount } from '@web/desktop/accounts';
import { auth } from '@web/stores/auth';
import { unreadableAccountIds } from '../overrides/packages/tauri-core';
import type { PushAccount } from './api';
import { slotFor } from './slots';

function toPushAccount(a: DesktopAccount, active: boolean): PushAccount {
  return {
    id: a.id,
    slot: slotFor(a.id),
    userId: a.userId,
    username: a.username,
    domain: a.instance.domain,
    apiBase: a.instance.apiUrl.replace(/\/+$/, ''),
    token: active && auth.token ? auth.token : a.token,
  };
}

/**
 * Every account on this device, the active one first. `excludeId` leaves one out before
 * anything is looked up for it (an account on its way out must not be given a slot again).
 */
export function pushAccounts(excludeId?: string): PushAccount[] {
  const activeId = activeDesktopAccountId();
  const list = desktopAccounts()
    .filter((a) => a.id !== excludeId)
    .map((a) => toPushAccount(a, a.id === activeId));
  return list.sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
}

/**
 * Whether pushAccounts() is every account on this device. Not after a start that could not
 * read some account's token (overrides/packages/tauri-core.ts: iOS, launched in the
 * background while the phone is locked) until that account is in the list again (READY
 * brings the open one back): it is still here, only missing from the list, so its slot must
 * not be taken for an orphan, nor dropped from the renderer's config. Checked against the
 * live list, not the saved one, so a run that READY starts does not wait for the save behind
 * it. Only those two steps wait on it (registration.ts).
 */
export function pushAccountsComplete(): boolean {
  const unreadable = unreadableAccountIds();
  if (unreadable.length === 0) return true;
  const present = new Set(desktopAccounts().map((a) => a.id));
  return unreadable.every((id) => present.has(id));
}

/** The account the app is signed in as right now, if any. */
export function activePushAccount(): PushAccount | null {
  const activeId = activeDesktopAccountId();
  if (!activeId || !auth.token) return null;
  const a = desktopAccounts().find((x) => x.id === activeId);
  return a ? toPushAccount(a, true) : null;
}

/** The active account's slot, or null when signed out. */
export function activeSlot(): string | null {
  return activePushAccount()?.slot ?? null;
}

/**
 * `@name` for an account on the active account's instance, `@name@domain` otherwise - the
 * handle as the active session would write it. Shown under a notification when several
 * accounts are on this device.
 */
export function accountLabel(account: Pick<PushAccount, 'username' | 'domain'>, localDomain: string | null): string {
  return localDomain && account.domain.toLowerCase() === localDomain.toLowerCase() ? `@${account.username}` : `@${account.username}@${account.domain}`;
}
