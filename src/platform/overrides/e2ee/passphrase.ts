/**
 * The per-user passphrase the engine's store is encrypted with at rest, in the platform
 * keystore (expo-secure-store: iOS Keychain, Android Keystore-wrapped) rather than the web's
 * plain IndexedDB row - the one local secret now has hardware-backed protection.
 *
 * - THIS_DEVICE_ONLY: never synced to iCloud Keychain or restored onto another phone. It is
 *   purely local, like the store it opens; another device has its own identity.
 * - AFTER_FIRST_UNLOCK: readable while the phone is locked after its first unlock, so a
 *   to-device message processed with the screen off can still open the store.
 *
 * A Keychain entry can outlive an uninstall on iOS while the WebView's store does not; that
 * is harmless (a fresh store under an old passphrase). The reverse - a store whose passphrase
 * is gone - cannot be opened and goes to the reset path (machine.ts).
 */
import * as SecureStore from 'expo-secure-store';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * SecureStore keys may only hold [A-Za-z0-9._-]; the web's `passphrase:<userId>` has a ':'.
 * User ids are snowflakes, so the escape below never collides in practice; it exists so a
 * future id format cannot produce an invalid key.
 */
export function passphraseKey(userId: string): string {
  return `strafe_e2ee_passphrase_${userId.replace(/[^A-Za-z0-9._-]/g, (c) => `-${c.charCodeAt(0).toString(16)}-`)}`;
}

/** The stored passphrase, or null if there is none. Throws if the keystore cannot be read. */
export function readPassphrase(userId: string): Promise<string | null> {
  return SecureStore.getItemAsync(passphraseKey(userId), OPTIONS);
}

export async function createPassphrase(userId: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const passphrase = btoa(String.fromCharCode(...bytes));
  await SecureStore.setItemAsync(passphraseKey(userId), passphrase, OPTIONS);
  return passphrase;
}

/** Can the keystore be read at all? Probed by the reset, which drops an unreadable entry. */
export async function passphraseReadable(userId: string): Promise<boolean> {
  try {
    await readPassphrase(userId);
    return true;
  } catch {
    return false;
  }
}

export async function deletePassphrase(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(passphraseKey(userId), OPTIONS);
}
