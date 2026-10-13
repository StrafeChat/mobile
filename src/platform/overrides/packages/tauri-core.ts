/**
 * Stand-in for `@tauri-apps/api/core` on mobile.
 *
 * The desktop modules the app reuses (desktop/accounts.ts above all: the multi-account,
 * multi-instance switcher) talk to their Rust side through `invoke(command, args)`. Each
 * command they use is answered here with the mobile equivalent; anything else rejects, so a
 * new desktop command shows up as an error rather than silently doing nothing.
 *
 * Accounts: the list (instance, user, names, avatar) is kept in MMKV and each account's
 * session token in the OS keystore (expo-secure-store: Keychain / Android Keystore), keyed
 * by account id - the desktop keeps the whole file owner-only on disk for the same reason.
 *
 * The app also starts with the phone locked: a notification button that does not open it, or
 * a silent push (a room read on another device), launches it in the background. The list it
 * loads then has to be the whole list, or what is decided from it - which push slots are
 * orphans, what the notification renderer knows, which tokens a save deletes - wipes accounts
 * that are still here. Hence the keystore class below, and unreadableAccountIds().
 */
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { reloadApp } from '../../reload';
import { appStorage } from '../../storage';

const ACCOUNTS_KEY = 'accounts.v1';
const TOKEN_PREFIX = 'strafe.token.';
/** Every stored token has been re-written with OPTIONS (iOS; see migrateTokens). */
const TOKENS_MIGRATED_KEY = 'accounts.tokensAfterFirstUnlock';
/** A restart to read tokens the keystore refused has been tried (see reloadWhenReadable). */
const RELOAD_TRIED_KEY = 'accounts.unreadableReloadTried';

/**
 * Tokens are read by a start in the background, with the phone locked. AFTER_FIRST_UNLOCK:
 * readable once the phone has been unlocked after booting (the keychain's default, only while
 * unlocked, refuses a locked start). THIS_DEVICE_ONLY: never synced to iCloud Keychain or
 * restored onto another phone - a session belongs to this device, like its push keys and its
 * E2EE identity (overrides/e2ee/passphrase.ts makes the same choice). Android ignores it: its
 * Keystore works while the phone is locked.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

interface StoredAccount {
  id: string;
  token?: string;
  [k: string]: unknown;
}

interface AccountsFile {
  version: 1;
  active: string | null;
  accounts: StoredAccount[];
}

/**
 * Entries whose token the keystore refused to read at start-up - which is not the same as
 * having no token. Those accounts are still on this device; this run just cannot see them, so
 * the app's list leaves them out. Saving keeps them (and their tokens) until the app has seen
 * them (signed in to one again): a refusal signs nobody out, whatever caused it.
 */
let unreadable: StoredAccount[] = [];

/**
 * Whether those refusals may be the lock: on iOS, a start in the background (before the first
 * unlock since boot, or while locked with a token saved before OPTIONS). Only then is the
 * list's gap worth waiting for (unreadableAccountIds) and a restart worth trying
 * (reloadWhenReadable). Android's Keystore works while the phone is locked, and an iPhone with
 * the app in the foreground is unlocked, so a refusal there is a keystore fault, which no
 * restart is known to cure: waiting for it would hold push up for every account for as long
 * as the fault lasts, and a restart armed from the foreground would go off under the person
 * the next time the app came back (from the camera, a permission dialog).
 */
let mayBeLocked = false;

/**
 * Accounts on this device that the loaded list leaves out because the phone may have been
 * locked at start-up. Until each is in the app's list again, nothing may be released, wiped or
 * handed to the notification renderer on the strength of that list (the next foreground
 * restarts the app to read it whole; see reloadWhenReadable).
 */
export function unreadableAccountIds(): readonly string[] {
  return mayBeLocked ? unreadable.map((a) => a.id) : [];
}

/** SecureStore keys allow [A-Za-z0-9._-]; account ids are `${domain}:${userId}`. */
function tokenKey(accountId: string): string {
  return TOKEN_PREFIX + accountId.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function loadAccounts(): Promise<AccountsFile | null> {
  // Where the start was when it read, not where it is after: opened meanwhile, it may still
  // have been refused by the lock.
  const inBackground = AppState.currentState === 'background';
  const raw = appStorage.getString(ACCOUNTS_KEY);
  let file: AccountsFile | null = null;
  try {
    file = raw ? (JSON.parse(raw) as AccountsFile) : null;
  } catch {
    file = null;
  }
  const accounts: StoredAccount[] = [];
  const refused: StoredAccount[] = [];
  for (const a of file?.accounts ?? []) {
    let token: string | null;
    try {
      token = await SecureStore.getItemAsync(tokenKey(a.id), OPTIONS);
    } catch {
      refused.push(a);
      continue;
    }
    // No token at all is an account that is gone (a sign-out the restart cut short).
    if (token) accounts.push({ ...a, token });
  }
  unreadable = refused;
  mayBeLocked = refused.length > 0 && Platform.OS === 'ios' && inBackground;
  if (mayBeLocked) {
    reloadWhenReadable();
  } else if (refused.length === 0) {
    appStorage.remove(RELOAD_TRIED_KEY);
    await migrateTokens(accounts);
  }
  return file ? { version: 1, active: file.active ?? null, accounts } : null;
}

/**
 * Tokens saved before OPTIONS keep the keychain's default class (only while unlocked), and
 * saving one again does not change that: expo-secure-store updates an existing item's value,
 * never its attributes. So each is deleted and written afresh, once, by a start that could
 * read them all (iOS only; the class does not exist on Android). One that fails midway is
 * tried again next start; a token deleted but not re-written is still in the list in memory,
 * and the next save (every sign-in and READY saves) writes it - as a new item, with OPTIONS.
 */
async function migrateTokens(accounts: readonly StoredAccount[]): Promise<void> {
  if (Platform.OS !== 'ios' || appStorage.getBoolean(TOKENS_MIGRATED_KEY) === true) return;
  try {
    for (const a of accounts) {
      if (typeof a.token !== 'string' || !a.token) continue;
      await SecureStore.deleteItemAsync(tokenKey(a.id), OPTIONS);
      await SecureStore.setItemAsync(tokenKey(a.id), a.token, OPTIONS);
    }
    appStorage.set(TOKENS_MIGRATED_KEY, true);
  } catch (e) {
    console.warn('[accounts] could not move the stored tokens to the after-first-unlock class', e);
  }
}

let reloadArmed = false;

/**
 * Read the list again once the keystore can be: the next time the app comes to the
 * foreground (the phone is unlocked by then), restart the JS - the app's start-up is what
 * reads the list, and the shared stores cannot take accounts in afterwards. Not if the app has
 * seen every refused account by then (signed in again). Tried once per failure: a fault that
 * outlasts the restart (refused in the foreground, so not the lock) does not restart every
 * background start the person opens; the next start that reads everything allows it again.
 */
function reloadWhenReadable(): void {
  if (reloadArmed || appStorage.getBoolean(RELOAD_TRIED_KEY) === true) return;
  reloadArmed = true;
  const onActive = () => {
    sub.remove();
    reloadArmed = false;
    if (unreadable.length === 0) return;
    appStorage.set(RELOAD_TRIED_KEY, true);
    void reloadApp('strafe: accounts unreadable at start-up');
  };
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') onActive();
  });
  // Opened while it read: that change has gone by, and waiting for the next one would restart
  // the app in the middle of its use (back from a dialog). Now is the moment it was opened.
  if (AppState.currentState === 'active') onActive();
}

async function saveAccounts(value: AccountsFile): Promise<void> {
  const previous = (() => {
    try {
      return (JSON.parse(appStorage.getString(ACCOUNTS_KEY) ?? '{}') as AccountsFile).accounts ?? [];
    } catch {
      return [] as StoredAccount[];
    }
  })();
  const keep = new Set(value.accounts.map((a) => a.id));
  // A refused account the app has since seen (signed in to again) is the app's to keep or
  // remove from here on, like any other.
  unreadable = unreadable.filter((a) => !keep.has(a.id));
  for (const a of value.accounts) {
    if (typeof a.token === 'string' && a.token) await SecureStore.setItemAsync(tokenKey(a.id), a.token, OPTIONS);
  }
  // Left out of `value` because the app never saw them is not removed: their entries and
  // tokens stay for the start that can read them.
  const held = new Set(unreadable.map((a) => a.id));
  for (const a of previous) {
    if (!keep.has(a.id) && !held.has(a.id)) await SecureStore.deleteItemAsync(tokenKey(a.id), OPTIONS).catch(() => undefined);
  }
  const withoutTokens = value.accounts.map(({ token: _t, ...rest }) => rest);
  appStorage.set(ACCOUNTS_KEY, JSON.stringify({ version: 1, active: value.active, accounts: [...withoutTokens, ...unreadable] }));
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case 'desktop_accounts_load':
      return (await loadAccounts()) as T;
    case 'desktop_accounts_save':
      await saveAccounts(args?.value as AccountsFile);
      return undefined as T;
    case 'desktop_ready':
      return undefined as T;
    case 'desktop_prefs_load':
      return { closeToTray: false, startMinimized: false, discordPresence: false } as T;
    case 'desktop_prefs_save':
    case 'desktop_discord_presence_set':
      return undefined as T;
    case 'desktop_discord_presence_available':
      return false as T;
    default:
      throw new Error(`[mobile] no native handler for "${cmd}"`);
  }
}

/** Tauri's isTauri(); the desktop modules only use invoke, but keep the shape. */
export function isTauri(): boolean {
  return false;
}
