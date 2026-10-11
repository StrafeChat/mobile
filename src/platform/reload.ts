/**
 * Restart the JavaScript side of the app.
 *
 * The shared web stores are module singletons that belong to one signed-in account (the
 * gateway socket, the E2EE engine, the voice session, every cache). Switching accounts or
 * instances on the web is a page load for exactly that reason; here it is a JS reload, which
 * `reloadAppAsync` performs in release builds as well as development ones.
 */
import { reloadAppAsync } from 'expo';

let reloading = false;

export async function reloadApp(reason = 'strafe: session changed'): Promise<void> {
  if (reloading) return;
  reloading = true;
  try {
    await reloadAppAsync(reason);
  } finally {
    reloading = false;
  }
}
