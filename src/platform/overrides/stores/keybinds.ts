/**
 * Mobile replacement for web/src/stores/keybinds.ts.
 *
 * The bindings store, its persistence and the combo helpers are the web's (stores/voice uses
 * comboFromEvent, a settings page may list the bindings). The global dispatcher is not: React
 * Native delivers no window-level key events - a hardware keyboard's keys reach only the
 * focused text input - so initKeybinds has nothing to listen to and returns a no-op disposer.
 */
import type { KeybindAction } from '@web-original/stores/keybinds';

export * from '@web-original/stores/keybinds';

export function initKeybinds(_handlers: Partial<Record<KeybindAction, () => void>>): () => void {
  return () => undefined;
}
