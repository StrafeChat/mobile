/**
 * Mobile replacement for web/src/desktop/native.ts - the native-shell hooks the shared
 * stores call when `isDesktop()` is true (which it is on mobile; see ./env.ts).
 *
 * Same exports as the desktop module; window chrome, autostart, Discord presence and game
 * detection have no meaning on a phone and are inert.
 */
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { router } from 'expo-router';
import { reloadApp } from '../../reload';
import { showLocalNotification } from '../../notifications';
import type { GameActivity, GameRow, GamesState, RunningProgram } from '@web-original/desktop/native';

export type { ScreenSource } from '@web-original/desktop/electronBridge';

// ---- window ----------------------------------------------------------------------------------

export const desktopWindow = {
  minimize: async () => undefined,
  toggleMaximize: async () => undefined,
  close: async () => undefined,
  isMaximized: async () => false,
  onMaximizeChange(_cb: (maximized: boolean) => void): Promise<() => void> {
    return Promise.resolve(() => undefined);
  },
  isPopup: () => false,
};

export function markDesktopReady(): Promise<void> {
  return Promise.resolve();
}

// ---- links and windows -----------------------------------------------------------------------

/**
 * External links open in an in-app browser tab (Custom Tabs / SFSafariViewController), or in
 * whatever handles the URL when that fails (a mailto:, a device without a browser tab). Never
 * rejects: stores/externalLink falls back to window.open, which an app does not have.
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    });
  } catch {
    await Linking.openURL(url).catch(() => undefined);
  }
}

/**
 * The web opens in-app pages (the OAuth consent screen a bot install starts) in a popup
 * window; the app pushes the matching screen instead. Anything that is not one of ours goes
 * to the browser.
 */
export function openPopupWindow(url: string, _opts: { width?: number; height?: number; title?: string } = {}): void {
  let path = url;
  try {
    const u = new URL(url, 'https://app.invalid');
    path = `${u.pathname}${u.search}`;
  } catch {
    /* keep it as given */
  }
  if (path.startsWith('/oauth2/authorize')) {
    router.push(path as never);
    return;
  }
  void openExternalUrl(url);
}

export function closeCurrentWindow(): Promise<void> {
  if (router.canGoBack()) router.back();
  return Promise.resolve();
}

// ---- notifications --------------------------------------------------------------------------

let granted: boolean | null = null;

export function nativeNotificationsGrantedSync(): boolean | null {
  return granted;
}

export async function nativeNotificationsGranted(): Promise<boolean> {
  try {
    const p = await Notifications.getPermissionsAsync();
    granted = p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  } catch {
    granted = false;
  }
  return granted;
}

export async function requestNativeNotifications(): Promise<boolean> {
  if (await nativeNotificationsGranted()) return true;
  try {
    const p = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    granted = p.granted;
  } catch {
    granted = false;
  }
  return granted;
}

export function sendNativeNotification(title: string, body?: string): void {
  void showLocalNotification({ title, body });
}

/** A phone has nothing to flash; the notification itself is the attention. */
export async function flashWindow(): Promise<void> {
  return undefined;
}

// ---- badge ------------------------------------------------------------------------------------

export async function setUnreadBadge(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    /* launcher without badge support */
  }
}

// ---- preferences -------------------------------------------------------------------------------

export interface DesktopPrefs {
  closeToTray: boolean;
  startMinimized: boolean;
  discordPresence: boolean;
}

export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = { closeToTray: false, startMinimized: false, discordPresence: false };

export function loadDesktopPrefs(): Promise<DesktopPrefs> {
  return Promise.resolve(DEFAULT_DESKTOP_PREFS);
}

export function saveDesktopPrefs(_prefs: DesktopPrefs): Promise<void> {
  return Promise.resolve();
}

export const desktopAutostart = {
  isEnabled: async () => false,
  enable: async () => undefined,
  disable: async () => undefined,
};

// ---- storage ------------------------------------------------------------------------------------

/**
 * Throw away the E2EE engine's storage and restart. On mobile that storage is the crypto
 * WebView's (IndexedDB inside it); it is cleared at the next start, before the WebView loads.
 */
export async function wipeWebviewStorageAndRestart(): Promise<void> {
  const { scheduleCryptoStorageWipe } = await import('../../crypto/host');
  scheduleCryptoStorageWipe();
  await reloadApp();
}

// ---- Discord -----------------------------------------------------------------------------------

export interface DiscordPresence {
  details?: string;
  state?: string;
  since?: number;
}

export function setDiscordPresence(_presence: DiscordPresence): Promise<void> {
  return Promise.resolve();
}

export function discordPresenceAvailable(): Promise<boolean> {
  return Promise.resolve(false);
}

// ---- app and screen share --------------------------------------------------------------------

/** The installed app's version, as the desktop shells report theirs. */
export function desktopAppVersion(): Promise<string> {
  return Promise.resolve(Application.nativeApplicationVersion ?? '0.0.0');
}

/** No app-drawn screen picker on a phone: the system's capture prompt chooses. */
export function screenShareSources(): Promise<null> {
  return Promise.resolve(null);
}

export function chooseScreenShareSource(_id: string): Promise<void> {
  return Promise.resolve();
}

// ---- games (activity) ------------------------------------------------------------------------

/*
 * Game detection ("Playing X") is the desktop shell's: it looks at what is running and says what
 * to share. A phone has no shell and never detects or reports a game - it only shows what other
 * people's desktops report, through the presence store. So gamesAvailable() answers false, which
 * is what every caller checks first (the web's stores/activity.ts and its Activity settings page,
 * neither of which the app loads: the one is started from desktop/boot, overridden by an inert
 * module here, the other is web UI). The reads answer "nothing", the writes refuse, as an older
 * desktop build without games does.
 */

export type { CurrentGame, GameActivity, GameRow, GameSource, GamesState, RunningProgram } from '@web-original/desktop/native';

const NO_GAMES = 'Game detection is only in the Strafe desktop app.';

export function gamesAvailable(): Promise<boolean> {
  return Promise.resolve(false);
}

/** Sharing off, no account, nothing playing, no games. */
export function gamesGetState(): Promise<GamesState> {
  return Promise.resolve({ share: false, account: null, current: null, games: [] });
}

export function gamesSetShare(_on: boolean, _account: string): Promise<void> {
  return Promise.reject(new Error(NO_GAMES));
}

export function gamesSetHidden(_key: string, _hidden: boolean): Promise<void> {
  return Promise.reject(new Error(NO_GAMES));
}

export function gamesRename(_key: string, _name: string | null): Promise<void> {
  return Promise.reject(new Error(NO_GAMES));
}

export function gamesRunningPrograms(): Promise<RunningProgram[]> {
  return Promise.resolve([]);
}

export function gamesAdd(_id: string, _name: string): Promise<GameRow | null> {
  return Promise.reject(new Error(NO_GAMES));
}

export function gamesRemove(_key: string): Promise<void> {
  return Promise.reject(new Error(NO_GAMES));
}

/** Never calls back: nothing on a phone detects a game. */
export function onActivityChanged(_cb: (activity: GameActivity | null) => void): Promise<() => void> {
  return Promise.resolve(() => undefined);
}
