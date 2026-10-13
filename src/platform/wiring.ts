/**
 * Glue between the shared web code and the app's navigation, installed once by the root
 * layout. Everything here is "when the web code asks for X, the app does Y":
 *
 * - `window.location.assign(...)` (account switch, revoked session) navigates or restarts the
 *   app (shims/window.ts bindLocation).
 * - The conversation on screen (shell/state.ts roomOnScreen: the shell's room while it shows,
 *   or one a screen pushed over it claims - a thread, the media viewer) is mirrored into
 *   `window.location.pathname`, which the web's notification logic reads to skip the room you
 *   are looking at.
 * - A notification tap (live or from a cold start) opens its room, closing whatever screens
 *   are pushed over the shell; opening a room clears its notifications - the app's own and
 *   the pushes' (src/platform/push, installed here: it registers this device for push, and
 *   routes push taps through the same shell).
 * - Voice-message audio never reconfigures the audio session while a call holds it.
 * - The media caches are swept at start and wiped on sign-out / account switch.
 */
import { createEffect, createRoot, on } from 'solid-js';
import { router } from 'expo-router';
import { onNavigateRequest } from '@web/lib/notifications';
import { voice } from '@web/stores/voice';
import { bindLocation, setLocationPath } from './shims/window';
import { reloadApp } from './reload';
import { setNotificationLaunchHandler } from './notifications';
import { clearPushRoom, installPushLifecycle } from './push/lifecycle';
import { installMediaLifecycle, setAudioSessionGuard } from './media';
import { spaceIdOfRoom } from './rooms';
import { currentRoomId, openRoom, roomOnScreen } from '@/shell/state';
import { backToShell } from '@/features/nav/navigation';

/** '/rooms/:id' or '/spaces/:sid/rooms/:id' -> the room (and space) it names. */
export function parseRoomPath(path: string): { roomId: string; spaceId: string | null } | null {
  const m = /^\/(?:spaces\/([^/]+)\/)?rooms\/([^/?#]+)/.exec(path);
  if (!m) return null;
  return { roomId: m[2]!, spaceId: m[1] ?? null };
}

/**
 * Open a room and bring the shell back to the front. openRoom alone only moves the shell, so
 * with a thread, settings or the media viewer pushed over it a notification tap would change
 * nothing visible - while still clearing the notification.
 */
function showRoom(roomId: string, spaceId: string | null | undefined): void {
  openRoom(roomId, spaceId);
  backToShell();
}

function openRoomPath(path: string): boolean {
  const target = parseRoomPath(path);
  if (!target) return false;
  showRoom(target.roomId, target.spaceId ?? spaceIdOfRoom(target.roomId));
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
    showRoom(data.roomId, spaceId);
  });

  setAudioSessionGuard(() => voice.session.status !== 'idle');
  installMediaLifecycle();
  const uninstallPush = installPushLifecycle();

  const disposeEffects = createRoot((dispose) => {
    // The visible conversation, as the web's routes would name it. lib/notifications skips the
    // room named here, so it must be the room actually on screen - by the same definition the
    // read cursor follows (lib/viewportAck), or a message could notify and then be marked read
    // without anyone having seen it.
    createEffect(() => {
      const room = roomOnScreen();
      if (!room) setLocationPath('/');
      else setLocationPath(room.spaceId ? `/spaces/${room.spaceId}/rooms/${room.roomId}` : `/rooms/${room.roomId}`);
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
    uninstallPush();
    disposeEffects();
    installed = false;
  };
}
