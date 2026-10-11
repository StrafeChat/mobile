/**
 * `navigator.clipboard` for the shared web code, on expo-clipboard.
 *
 * The web's menu builders copy with `navigator.clipboard?.writeText(...)` (lib/userContextMenu:
 * "Copy username", "Copy user ID"). React Native has no `navigator.clipboard`, so the optional
 * call silently did nothing. Installing the two text methods makes those actions work without
 * touching the builders. Only text: nothing shared copies anything else.
 */
import * as Clipboard from 'expo-clipboard';

interface TextClipboard {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export const textClipboard: TextClipboard = {
  async writeText(text: string): Promise<void> {
    await Clipboard.setStringAsync(String(text));
  },
  readText(): Promise<string> {
    return Clipboard.getStringAsync();
  },
};

/** Install `navigator.clipboard` unless something already provides it. Idempotent. */
export function installClipboard(): void {
  const g = globalThis as unknown as { navigator?: Record<string, unknown> };
  const nav = g.navigator ?? (g.navigator = {});
  if (!nav.clipboard) nav.clipboard = textClipboard;
}

installClipboard();
