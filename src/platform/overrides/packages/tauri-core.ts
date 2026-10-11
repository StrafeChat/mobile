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
 */
import * as SecureStore from 'expo-secure-store';
import { appStorage } from '../../storage';

const ACCOUNTS_KEY = 'accounts.v1';
const TOKEN_PREFIX = 'strafe.token.';

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

/** SecureStore keys allow [A-Za-z0-9._-]; account ids are `${domain}:${userId}`. */
function tokenKey(accountId: string): string {
  return TOKEN_PREFIX + accountId.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function loadAccounts(): Promise<AccountsFile | null> {
  const raw = appStorage.getString(ACCOUNTS_KEY);
  if (!raw) return null;
  let file: AccountsFile;
  try {
    file = JSON.parse(raw) as AccountsFile;
  } catch {
    return null;
  }
  const accounts: StoredAccount[] = [];
  for (const a of file.accounts ?? []) {
    const token = await SecureStore.getItemAsync(tokenKey(a.id)).catch(() => null);
    if (token) accounts.push({ ...a, token });
  }
  return { version: 1, active: file.active ?? null, accounts };
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
  for (const a of value.accounts) {
    if (typeof a.token === 'string' && a.token) await SecureStore.setItemAsync(tokenKey(a.id), a.token);
  }
  for (const a of previous) {
    if (!keep.has(a.id)) await SecureStore.deleteItemAsync(tokenKey(a.id)).catch(() => undefined);
  }
  const withoutTokens = value.accounts.map(({ token: _t, ...rest }) => rest);
  appStorage.set(ACCOUNTS_KEY, JSON.stringify({ version: 1, active: value.active, accounts: withoutTokens }));
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
