/**
 * When push registration runs, and how pushes meet the running app. Installed once by the
 * app wiring (src/platform/wiring.ts).
 *
 * Registration (registration.ts) re-runs when anything it depends on may have changed:
 * - the gateway session comes up (READY): signed in, or back after a disconnect;
 * - the app comes to the foreground - at most once an hour, unless the OS permission or the
 *   device's transports changed meanwhile (the person was in the system settings, installed
 *   or removed a distributor);
 * - the notification preferences the instance filters by or the renderer uses, push on/off
 *   or the transport choice, the language (the strings, and the gateway's fallback text);
 * - an account was added or removed, or another one became the open one;
 * - Firebase issued a new token, UnifiedPush a new endpoint or dropped one.
 *
 * And while the app runs: its local message notifications stand aside in the background
 * for an account whose pushes arrive (suppression.ts); iOS pushes reaching the foreground
 * app are presented by the same rule; taps and buttons route (routing.ts, actions.ts); a
 * conversation that is opened or read loses its notifications.
 */
import * as StrafePush from '@strafe/push';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { createEffect, createRoot, on, onCleanup, untrack } from 'solid-js';
import { activeDesktopAccountId, desktopAccounts, desktopAccountsLoaded } from '@web/desktop/accounts';
import { currentLanguage } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { notificationPrefs } from '@web/stores/notificationPrefs';
import { readState } from '@web/stores/readState';
import { jumpToMessage } from '@web/stores/messages';
import { stargate } from '@web/stores/stargate';
import { voice, voiceStatesForRoom } from '@web/stores/voice';
import { requestComposerFocus } from '@/features/composer/state';
import { backToShell } from '@/features/nav/navigation';
import { acceptIncomingFromUi, joinVoiceFromUi } from '@/features/voice/join';
import { openRoom } from '@/shell/state';
import { bootState } from '../boot';
import {
  clearRoomNotification,
  localizeNotificationChannels,
  setLocalNotificationGate,
  setRemotePushPresenter,
  setRemotePushResponder,
} from '../notifications';
import { spaceIdOfRoom } from '../rooms';
import { setAccountLeavingHook, switchAccount } from '../session';
import { activeSlot } from './accounts';
import { handlePushResponse, registerPushCategories } from './actions';
import { pushEnabled, transportPref } from './config';
import { ensurePushRegistration, forgetPushAccount, hasStoredSubscription } from './registration';
import { pendingPushTargetTick, processPendingPushTarget, setPushRoutingHost } from './routing';
import { pushIsActive, pushStatus } from './status';
import { presentRemoteNotification, suppressLocalNotification } from './suppression';

/** Foreground re-checks: at most this often when nothing seems to have changed. */
export const FOREGROUND_INTERVAL_MS = 60 * 60 * 1000;
/** Preference edits come in bursts (a row of toggles); settle before re-registering. */
const PREFS_DEBOUNCE_MS = 800;

let lastForegroundRun = 0;
let lastDeviceSignature: string | null = null;

/** The things a foreground can change behind the app's back. */
async function deviceSignature(): Promise<string> {
  const [perm, caps] = await Promise.all([
    Notifications.getPermissionsAsync().catch(() => null),
    StrafePush.getCapabilities().catch(() => null),
  ]);
  return JSON.stringify([
    perm?.status ?? null,
    caps ? [caps.fcm, caps.apns, caps.distributors.map((d) => d.id).sort(), caps.selectedDistributor] : null,
  ]);
}

async function onForeground(): Promise<void> {
  const signature = await deviceSignature();
  const changed = lastDeviceSignature !== null && signature !== lastDeviceSignature;
  lastDeviceSignature = signature;
  if (!changed && Date.now() - lastForegroundRun < FOREGROUND_INTERVAL_MS) return;
  lastForegroundRun = Date.now();
  await ensurePushRegistration();
}

/**
 * Pushes reach this device for the open account: the last run said so, or - before this
 * start's first run has finished - the instance accepted a subscription earlier and push
 * is still on.
 */
function pushCoversOpenAccount(): boolean {
  if (pushIsActive()) return true;
  const state = pushStatus().state;
  if (state !== 'idle' && state !== 'registering') return false;
  const slot = activeSlot();
  return pushEnabled() && !!slot && hasStoredSubscription(slot);
}

function clearRoomEverywhere(roomId: string): void {
  void clearRoomNotification(`room:${roomId}`);
  const slot = activeSlot();
  if (slot && StrafePush.isAvailable()) void StrafePush.clearRoom(slot, roomId).catch(() => undefined);
}

let installed = false;

export function installPushLifecycle(): () => void {
  if (installed) return () => undefined;
  installed = true;

  setPushRoutingHost({
    ready: () => bootState() === 'ready',
    switchAccount,
    // Then back to the shell: openRoom alone only moves it, so a push tapped while a thread,
    // settings or the media viewer is in front (the usual case after leaving the app mid-thread)
    // would change nothing visible - as wiring.ts's showRoom does for local notifications.
    openRoom: (roomId, spaceId) => {
      openRoom(roomId, spaceId ?? spaceIdOfRoom(roomId));
      backToShell();
    },
    jumpToMessage: (roomId, messageId) => void jumpToMessage(roomId, messageId).catch((err: unknown) => console.warn('[push] jump failed', err)),
    focusComposer: requestComposerFocus,
    callState: (roomId) => {
      if (voice.incoming?.roomId === roomId) return 'ringing';
      // READY sets voice.incoming only for a call that started within the ring timeout; one
      // still ringing this account past that, in voice.calls, is joined like an ongoing one.
      const me = auth.user?.id;
      const ringingMe = !!me && (voice.calls[roomId]?.ringing.includes(me) ?? false);
      return ringingMe || voiceStatesForRoom(roomId).length > 0 ? 'ongoing' : 'none';
    },
    acceptIncomingCall: () => acceptIncomingFromUi(),
    joinCall: (roomId, spaceId) => joinVoiceFromUi(roomId, { spaceId: spaceId ?? spaceIdOfRoom(roomId) }),
  });
  setLocalNotificationGate((n) => suppressLocalNotification(n, AppState.currentState, pushCoversOpenAccount()));
  // The same app state and the same "push covers it" as the gate above: one notification
  // per message, whichever side shows it.
  setRemotePushPresenter((n) => {
    const trigger = n.request.trigger as { type?: string; payload?: unknown } | null;
    return presentRemoteNotification(
      n.request.content,
      trigger?.type === 'push' ? trigger.payload : undefined,
      activeSlot(),
      notificationPrefs.sounds,
      AppState.currentState,
      pushCoversOpenAccount(),
    );
  });
  setRemotePushResponder(handlePushResponse);
  setAccountLeavingHook(forgetPushAccount);
  void registerPushCategories().catch(() => undefined);

  const subs: { remove(): void }[] = [];
  subs.push(
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void onForeground();
    }),
  );
  if (StrafePush.isAvailable()) {
    subs.push(
      StrafePush.addListener('fcmToken', () => void ensurePushRegistration()),
      StrafePush.addListener('unifiedPushEndpoint', () => void ensurePushRegistration()),
      StrafePush.addListener('unifiedPushUnregistered', () => void ensurePushRegistration()),
      StrafePush.addListener('unifiedPushFailed', (e) => console.warn(`[push] UnifiedPush failed for ${e.slot}: ${e.reason}`)),
    );
  }
  if (Platform.OS === 'ios') subs.push(Notifications.addPushTokenListener(() => void ensurePushRegistration()));

  const dispose = createRoot((disposeRoot) => {
    // READY: every (re)connection of a signed-in session.
    createEffect(
      on(
        () => stargate.ready && !!auth.user?.id,
        (up) => {
          if (!up) return;
          lastForegroundRun = Date.now();
          void deviceSignature().then((s) => (lastDeviceSignature = s));
          void ensurePushRegistration();
        },
      ),
    );

    // The account list loaded, changed, or another account is the open one. (Also the
    // first run on a signed-out start: other accounts' registrations stay current.)
    createEffect(
      on(
        () => [desktopAccountsLoaded(), desktopAccounts().map((a) => `${a.id}\u0000${a.username}\u0000${a.token}`).join('\u0001'), activeDesktopAccountId(), auth.token] as const,
        ([loaded]) => {
          if (loaded) void ensurePushRegistration();
        },
      ),
    );

    // Push on/off and the transport: at once.
    createEffect(on(() => [pushEnabled(), transportPref()] as const, () => void ensurePushRegistration(), { defer: true }));

    // What the instance filters by, and what the renderer shows: after the edits settle.
    let prefsTimer: ReturnType<typeof setTimeout> | null = null;
    onCleanup(() => {
      if (prefsTimer) clearTimeout(prefsTimer);
    });
    createEffect(
      on(
        () => [notificationPrefs.preview, notificationPrefs.pmMode, notificationPrefs.spaceMode, notificationPrefs.sounds] as const,
        () => {
          if (prefsTimer) clearTimeout(prefsTimer);
          prefsTimer = setTimeout(() => {
            prefsTimer = null;
            void ensurePushRegistration();
          }, PREFS_DEBOUNCE_MS);
        },
        { defer: true },
      ),
    );

    // The language: channel names, iOS buttons, every native string, the gateway fallback.
    createEffect(
      on(
        currentLanguage,
        () => {
          localizeNotificationChannels();
          void registerPushCategories().catch(() => undefined);
          void ensurePushRegistration();
        },
        { defer: true },
      ),
    );

    // A tap's target, settled as the session moves (start-up, account switch, READY).
    createEffect(() => {
      pendingPushTargetTick();
      bootState();
      desktopAccountsLoaded();
      activeDesktopAccountId();
      untrack(() => processPendingPushTarget());
    });

    // Read here or elsewhere: the room's notifications go (the push sends `read` to a
    // closed app; this covers the running one). The first value seen per room is the
    // starting point, not a read.
    const lastRead = new Map<string, string | null>();
    createEffect(() => {
      for (const [roomId, state] of Object.entries(readState.byRoom)) {
        const id = state?.lastReadMessageId ?? null;
        const had = lastRead.has(roomId);
        const previous = lastRead.get(roomId);
        lastRead.set(roomId, id);
        if (had && id && id !== previous) untrack(() => clearRoomEverywhere(roomId));
      }
    });

    return disposeRoot;
  });

  return () => {
    for (const s of subs) s.remove();
    dispose();
    setPushRoutingHost(null);
    setLocalNotificationGate(null);
    setRemotePushPresenter(null);
    setRemotePushResponder(null);
    setAccountLeavingHook(null);
    installed = false;
  };
}

export { clearRoomEverywhere as clearPushRoom };
