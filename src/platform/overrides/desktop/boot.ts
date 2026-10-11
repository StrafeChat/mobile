/**
 * Mobile replacement for web/src/desktop/boot.ts.
 *
 * The desktop boot styles the window chrome, shows the Tauri window after the first paint,
 * starts the auto-updater and publishes Discord Rich Presence. None of that exists on a phone,
 * and the parts that do have a mobile counterpart are owned elsewhere: accounts are restored by
 * the app's own start-up, the notification permission is primed by stores/notificationPrefs,
 * and app updates come from the stores. So initDesktop is inert, with the same signature.
 */
export function initDesktop(): void {
  /* nothing to do on mobile */
}
