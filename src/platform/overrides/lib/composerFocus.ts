/**
 * Mobile replacement for web/src/lib/composerFocus.ts.
 *
 * The web's "just start typing" has two halves, and neither applies to a phone:
 *
 * - focusing the composer on entering a room - which the web itself skips on a coarse pointer,
 *   because it pops the on-screen keyboard unbidden ("the textbox keeps popping up");
 * - redirecting a printable keystroke made with nothing focused into the composer - React
 *   Native has no document-level key events to redirect.
 *
 * So the primitive is a no-op with the web's signature. (The web version would throw here: it
 * registers a `document` keydown listener on mount.)
 */
import type { ComposerAutoFocusOptions } from '@web-original/lib/composerFocus';

export type { ComposerAutoFocusOptions };

export function createComposerAutoFocus(_opts: ComposerAutoFocusOptions): void {
  /* nothing to do on touch devices */
}
