/**
 * Glue between the shared web code and the app's navigation, installed once by the root
 * layout. Everything here is "when the web code asks for X, the app does Y":
 *
 * - `window.location.assign(...)` (account switch, revoked session) navigates or restarts the
 *   app (shims/window.ts bindLocation).
 * - The shell's current screen is mirrored into `window.location.pathname`, which the web's
 *   notification logic reads to skip the room you are looking at.
 * - A notification tap (live or from a cold start) opens its room; opening a room clears its
 *   notifications - the app's own and the pushes' (src/platform/push, installed here: it
 *   registers this device for push, and routes push taps through the same shell).
 * - Voice-message audio never reconfigures the audio session while a call holds it.
 * - The media caches are swept at start and wiped on sign-out / account switch.
 */
import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { Dimensions } from 'react-native';
import { router } from 'expo-router';
import { onNavigateRequest } from '@web/lib/notifications';
import { voice } from '@web/stores/voice';
import { bindLocation, setLocationPath } from './shims/window';
import { reloadApp } from './reload';
import { setNotificationLaunchHandler } from './notifications';
import { clearPushRoom, installPushLifecycle } from './push/lifecycle';
import { installMediaLifecycle, setAudioSessionGuard } from './media';
import { spaceIdOfRoom } from './rooms';
import { currentRoomId, openRoom, shell } from '@/shell/state';
import { WIDE_BREAKPOINT } from '@/shell/SwipeShell';

/** '/rooms/:id' or '/spaces/:sid/rooms/:id' -> the room (and space) it names. */
export function parseRoomPath(path: string): { roomId: string; spaceId: string | null } | null {
  const m = /^\/(?:spaces\/([^/]+)\/)?rooms\/([^/?#]+)/.exec(path);
  if (!m) return null;
  return { roomId: m[2]!, spaceId: m[1] ?? null };
}

function openRoomPath(path: string): boolean {
  const target = parseRoomPath(path);
  if (!target) return false;
  openRoom(target.roomId, target.spaceId ?? spaceIdOfRoom(target.roomId));
  return true;
}

let installed = false;

export function installAppWiring(): () => void {
  if (installed) return () => undefined;
  installed = true;

  bindLocation(
    (path, replace) => {
      if (openRoomPath(path)) return;
      if (/^https?:\/\//.test(path)) return;
      if (replace) router.replace(path as never);
      else router.push(path as never);
    },
    () => void reloadApp(),
  );

  const stopNav = onNavigateRequest((path: string) => {
    openRoomPath(path);
  });

  setNotificationLaunchHandler((data) => {
    if (!data.roomId) return;
    // The space was written into the notification when it was posted ('' for a PM): a tap
    // that launches the app lands before READY, when the channel lists cannot say. Unknown
    // (an older notification) leaves the rail's selection alone rather than forcing Home.
    const spaceId = data.spaceId !== undefined ? data.spaceId || null : (spaceIdOfRoom(data.roomId) ?? undefined);
    openRoom(data.roomId, spaceId);
  });

  setAudioSessionGuard(() => voice.session.status !== 'idle');
  installMediaLifecycle();
  const uninstallPush = installPushLifecycle();

  // Tablet widths show the conversation beside the rails whichever panel is "in front".
  const [wide, setWide] = createSignal(Dimensions.get('window').width >= WIDE_BREAKPOINT);
  const dimensions = Dimensions.addEventListener('change', ({ window }) => setWide(window.width >= WIDE_BREAKPOINT));

  const disposeEffects = createRoot((dispose) => {
    // The visible screen, as the web's routes would name it. lib/notifications skips the
    // room named here, so it must be the room actually on screen.
    createEffect(() => {
      const view = shell.view();
      const showing = shell.panel() === 'content' || wide();
      if (view.kind === 'room' && showing) {
        setLocationPath(view.spaceId ? `/spaces/${view.spaceId}/rooms/${view.roomId}` : `/rooms/${view.roomId}`);
      } else {
        setLocationPath('/');
      }
    });
    createEffect(
      on(currentRoomId, (roomId) => {
        if (roomId) clearPushRoom(roomId);
      }),
    );
    return dispose;
  });

  return () => {
    stopNav?.();
    dimensions.remove();
    uninstallPush();
    disposeEffects();
    installed = false;
  };
}
