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

/** Marks a clipboard installed by this module (any instance of it). */
const OURS = Symbol.for('strafe.textClipboard');

export const textClipboard: TextClipboard & { [OURS]: true } = {
  [OURS]: true,
  async writeText(text: string): Promise<void> {
    await Clipboard.setStringAsync(String(text));
  },
  readText(): Promise<string> {
    return Clipboard.getStringAsync();
  },
};

/**
 * Install `navigator.clipboard` unless something else already provides it. Idempotent. One
 * installed by another instance of this module (a Fast Refresh, or another jest test file on
 * a Node whose built-in `navigator` is shared between them) is replaced: that instance may
 * be bound to a clipboard module that is no longer the live one.
 */
export function installClipboard(): void {
  const g = globalThis as unknown as { navigator?: Record<string | symbol, unknown> };
  const nav = g.navigator ?? (g.navigator = {});
  const existing = nav.clipboard as Record<symbol, unknown> | undefined;
  if (!existing || existing[OURS] === true) nav.clipboard = textClipboard;
}

installClipboard();
