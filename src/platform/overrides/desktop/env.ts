/**
 * Mobile replacement for web/src/desktop/env.ts.
 *
 * In the web client `isDesktop()` separates "a browser tab served by one instance" from "a
 * native shell that can talk to any instance": it is what makes runtimeConfig take the
 * instance from the signed-in account, notifications go through the OS, and links open in
 * the system browser. The mobile app is that second kind of client, so it answers true.
 */
import { Platform } from 'react-native';

export function isDesktop(): boolean {
  return true;
}

export type DesktopPlatform = 'mac' | 'windows' | 'linux';

/** Only used for desktop window chrome, which the app does not have. */
export function desktopPlatform(): DesktopPlatform {
  return Platform.OS === 'ios' ? 'mac' : 'linux';
}
