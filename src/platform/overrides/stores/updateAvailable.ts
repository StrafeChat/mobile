/**
 * Mobile replacement for web/src/stores/updateAvailable.ts.
 *
 * The web client polls /version.json and offers a reload when a new build is deployed. The
 * app's code ships in the binary (and through store updates), so there is nothing to poll.
 */
import { createSignal } from 'solid-js';

const [updateAvailable] = createSignal(false);

export { updateAvailable };

export function initUpdateCheck(): void {
  /* nothing to do: updates come through the app stores */
}
