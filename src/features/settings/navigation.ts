/**
 * Opening settings, from React and from the shared web code.
 *
 * The web opens its settings as modals driven by stores (`openUserSettings(section)` from the
 * user dock, the admin dashboard, keybinds...). Here every settings surface is a screen, so
 * the store is watched and turned into a navigation: whoever calls the web's
 * `openUserSettings('instance')` lands on the Instance page, and
 * `openUserSettings('spaceProfiles', { spaceId })` on Space Profiles for that space.
 *
 * Accessibility's "follow the system" motion setting is applied here too: the web mirrors
 * `prefers-reduced-motion` from a DOM media query in initAccessibility(), which cannot run in
 * the app, so the OS switch is read through AccessibilityInfo instead.
 */
import { AccessibilityInfo } from 'react-native';
import { router, type Href } from 'expo-router';
import { createEffect, createRoot, onCleanup, untrack } from 'solid-js';
import { closeUserSettings, takePendingSettingsSection, takePendingSpaceProfileSpaceId, userSettingsOpen } from '@web/stores/userSettingsModal';
import { accessibility } from '@web/stores/accessibility';
import { appearance, setReduceMotion } from '@web/stores/appearance';
import {
  adminPath,
  developerAppPath,
  oauthConsentPath,
  roomSettingsPath,
  spaceProfilePath,
  spaceSettingsPath,
  themeEditorPath,
  userSettingsPath,
  type AdminTabId,
} from './routes';

function go(path: string): void {
  try {
    router.push(path as Href);
  } catch (e) {
    // The navigator is not mounted yet (a store call during start-up): nothing to show it on.
    console.warn('[settings] navigation failed', e);
  }
}

/** User settings: the list, or straight to one page (the web's section ids). */
export function openSettings(section?: string): void {
  go(userSettingsPath(section));
}

/** Your space profile (Settings -> Space Profiles), on `spaceId` when given. Every member may
 * open it: it edits only your own profile there, never the space. */
export function openSpaceProfile(spaceId?: string | null): void {
  go(spaceProfilePath(spaceId));
}

/** A space's settings: the page list, or one page (`general`/`overview`, `roles`, `members`...). */
export function openSpaceSettings(spaceId: string, section?: string): void {
  go(spaceSettingsPath(spaceId, section));
}

/** A space room's (or section's) settings; `notifications` also works for PMs and groups. */
export function openRoomSettings(roomId: string, section?: string): void {
  go(roomSettingsPath(roomId, section));
}

/** The instance admin dashboard (the screen itself asks the server whether you may see it). */
export function openAdminDashboard(tab?: AdminTabId): void {
  go(adminPath(tab));
}

export function openDeveloperApp(appId: string): void {
  go(developerAppPath(appId));
}

export function openThemeEditor(baseThemeId?: string | null): void {
  go(themeEditorPath(baseThemeId));
}

/** The in-app OAuth2 consent screen for an authorize URL; false when it is not one. */
export function openOAuthConsent(url: string): boolean {
  const path = oauthConsentPath(url);
  if (!path) return false;
  go(path);
  return true;
}

/** Back out of a settings screen; a screen opened on its own (a deep link) goes home. */
export function leaveSettingsScreen(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/' as Href);
}

let disposeWiring: (() => void) | null = null;

/**
 * Turn web settings-store requests into navigations, and keep reduced motion following the OS
 * when the user asked for that. Idempotent; runs when this module loads, and the returned
 * function undoes it (tests).
 */
export function installSettingsWiring(): () => void {
  if (disposeWiring) return disposeWiring;
  const dispose = createRoot((disposeRoot) => {
    createEffect(() => {
      if (!userSettingsOpen()) return;
      untrack(() => {
        const section = takePendingSettingsSection();
        // Taken every time, so a space handed over once never sticks to a later opening.
        const spaceProfileSpaceId = takePendingSpaceProfileSpaceId();
        closeUserSettings();
        // After the store write settles: closing re-runs this effect, which must find it shut.
        queueMicrotask(() => (section === 'spaceProfiles' ? openSpaceProfile(spaceProfileSpaceId) : openSettings(section ?? undefined)));
      });
    });

    createEffect(() => {
      if (!accessibility.followSystemMotion) return;
      let live = true;
      const apply = (on: boolean) => {
        if (live && appearance.reduceMotion !== on) setReduceMotion(on);
      };
      void AccessibilityInfo.isReduceMotionEnabled()
        .then(apply)
        .catch(() => undefined);
      const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', apply);
      onCleanup(() => {
        live = false;
        sub.remove();
      });
    });
    return disposeRoot;
  });
  disposeWiring = () => {
    dispose();
    disposeWiring = null;
  };
  return disposeWiring;
}
