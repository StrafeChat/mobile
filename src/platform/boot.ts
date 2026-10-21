/**
 * Start-up and the realtime session: what the web client runs when a page loads, in the
 * same order, minus the DOM.
 *
 * On the web that work is spread over src/App.tsx (appearance, accessibility, the desktop
 * shell), the router's RootLayout (hydrateAuth) and components/StargateProvider.tsx (every
 * gateway handler, the READY side effects, connect-on-token, the REST fallback, the E2EE
 * device bootstrap, the channel subscriptions, voice settings reaching a live call).
 * startApp() runs all of it once, from the root layout, after the shims.
 *
 * Where mobile differs, on purpose:
 * - the session is only ever ended by the server (session.ts): an offline start shows the
 *   app with what it has and waits for the network, instead of signing out;
 * - every way a session ends restarts the JS (session.ts), so nothing of one account is
 *   left in memory for the next;
 * - ROOM_LEAVE is handled for every room, not only the one on screen (the web leaves a
 *   group PM you were removed from in the list until a reload);
 * - after any reconnect, rooms already loaded re-pull their newest page - the first READY
 *   included, since on a phone a room can be read from the REST fallback before it;
 * - no push-to-talk keyboard listener (a phone has no keys; the voice UI holds the mic),
 *   no window title, update banner or Discord presence.
 *
 * bootState() is what the router gates on.
 */
import { createEffect, createMemo, createRoot, createSignal, on, onCleanup, untrack } from 'solid-js';
import { AccessibilityInfo } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { initDesktopAccounts } from '@web/desktop/accounts';
import { setUnreadBadge } from '@web/desktop/native';
import { resyncDevice } from '@web/lib/e2ee/service';
import { initRoomNotifySettingsHandler } from '@web/lib/roomNotify';
import {
  connectStargate,
  disconnectStargate,
  onStargateEvent,
  onStargateReady,
  resubscribeAll,
  subscribe,
  unsubscribe,
  type ReadyPayload,
} from '@web/services/stargate/client';
import { accessibility } from '@web/stores/accessibility';
import { activeTheme, appearance, setReduceMotion } from '@web/stores/appearance';
import { auth, hydrateAuth, hydrateFromReady } from '@web/stores/auth';
import { initCustomEmojiHandlers, loadCustomEmojis } from '@web/stores/customEmojis';
import { bootstrapE2EEDevice } from '@web/stores/e2eeBootstrap';
import { initE2EESyncHandlers } from '@web/stores/e2eeSync';
import { clearMessages, initStargateMessageHandler, loadMessages, messages } from '@web/stores/messages';
import { initPinHandlers } from '@web/stores/pinnedMessages';
import { initPresenceHandler } from '@web/stores/presence';
import { initReadStateHandler, readState } from '@web/stores/readState';
import { initRelationshipHandlers } from '@web/stores/relationships';
import { initRoomHandlers, removeRoom, rooms } from '@web/stores/rooms';
import { initSpaceMembersHandlers, markSpaceMembersStale } from '@web/stores/spaceMembers';
import { initSpaceHandlers, spaces } from '@web/stores/spaces';
import { stargate } from '@web/stores/stargate';
import { initTypingHandler } from '@web/stores/typing';
import { initUserProfileHandler } from '@web/stores/userProfile';
import { applyVoiceSettingsToSession, initVoiceHandlers, voice } from '@web/stores/voice';
import { voiceSettings } from '@web/stores/voiceSettings';
import { useSolid } from '@/bridge/solid';
import { closeView, currentRoomId } from '@/shell/state';
import { isOnline, startConnectivity } from './connectivity';
import { announceRoomGone } from './roomGone';
import {
  initInstanceHandlers,
  instanceInfoFailed,
  loadInstanceCapabilities,
  loadInstanceInfo,
  retryInstanceInfoNow,
} from './overrides/runtime/instance';
import { runSelfCheck } from './overrides/runtime/selfcheck';
import {
  confirmSessionOrExpire,
  initSessionLifecycle,
  installSessionGuard,
  isLeavingSession,
  noteSessionValid,
  restoreFromRest,
  seedUserFromAccount,
  settleStoredSession,
} from './session';

/**
 * How long to wait for READY before restoring over REST (the web's value). Skipped when the
 * device is known to be offline: the REST attempt then fails at once and the app shows.
 */
const READY_FALLBACK_MS = 5_000;
/** At most one session check per this long while the gateway keeps failing. */
const GATEWAY_CHECK_INTERVAL_MS = 30_000;
/** Re-assert subscriptions after a new space appears (the web's two delays). */
const RESUBSCRIBE_DELAYS_MS = [1_500, 4_000];

export type BootState = 'booting' | 'signed-out' | 'ready' | 'error';

const [started, setStarted] = createSignal(false);
const [failure, setFailure] = createSignal<string | null>(null);
/** The REST restore could not reach the instance; the app shows without READY. */
const [restoredOffline, setRestoredOffline] = createSignal(false);

/**
 * Where start-up stands; reactive (read it through useSolid / useBootState):
 * - 'booting': starting, restoring a stored session, or restarting after a session ended
 *   (keep the splash up);
 * - 'signed-out': no session - the sign-in screens;
 * - 'ready': signed in, and either READY (or the REST fallback) has arrived, or the
 *   instance cannot be reached right now and the app shows what it has (sessionUnsynced());
 * - 'error': start-up itself threw (a bug); bootError() says what. reloadApp() retries.
 */
export function bootState(): BootState {
  if (failure()) return 'error';
  if (!started() || isLeavingSession()) return 'booting';
  if (!auth.token) return 'signed-out';
  if (auth.hydrated || restoredOffline()) return 'ready';
  return 'booting';
}

/** Why start-up failed, when bootState() is 'error'. */
export function bootError(): string | null {
  return failure();
}

/**
 * Signed in and showing, but neither READY nor the REST restore has come through (an
 * offline start): lists may be empty and the user is the saved account's name until the
 * instance answers. For an "offline" / "connecting" indicator.
 */
export function sessionUnsynced(): boolean {
  return !!auth.token && !auth.hydrated && restoredOffline();
}

/** The boot gate's view of the above, for React. */
export function useBootState(): { state: BootState; error: string | null; unsynced: boolean } {
  return useSolid(() => ({ state: bootState(), error: bootError(), unsynced: sessionUnsynced() }));
}

let starting: Promise<void> | null = null;

/** Run start-up once; later calls return the same promise. Never rejects (see bootState). */
export function startApp(): Promise<void> {
  if (!starting) {
    starting = start().catch((e: unknown) => {
      console.error('[boot] start-up failed', e);
      setFailure(e instanceof Error ? e.message : String(e));
    });
  }
  return starting;
}

async function start(): Promise<void> {
  // Before any request goes out: a 401 to this session, from anywhere, gets checked.
  installSessionGuard();

  // App.tsx at module load: appearance, accessibility, then the desktop shell's accounts
  // (awaited here: the stored session is checked against them before it is used).
  startAppearance();
  startAccessibility();
  await initDesktopAccounts();
  await settleStoredSession();

  // StargateProvider's mount: every gateway handler, once. The session lifecycle first: it
  // records why a revoked session ended before stores/instance's handler signs it out.
  initSessionLifecycle();
  registerGatewayHandlers();
  onStargateReady(handleReady);
  void loadInstanceInfo();

  // RootLayout's mount: the stored session, if any. User, rooms and the rest come with READY.
  await hydrateAuth();
  seedUserFromAccount();

  // StargateProvider's effects, and desktop/boot's badge.
  createRoot(() => {
    sessionEffects();
    subscriptionEffects();
    voiceEffects();
    badgeEffect();
  });

  startConnectivity();
  setStarted(true);

  if (__DEV__) void runSelfCheck();
}

// ---- appearance and accessibility --------------------------------------------------------------

/**
 * initAppearance() writes the theme into the document; the native screens read it through
 * useTheme(). What remains is the root view behind them (seen during rotation and keyboard
 * animations), which follows the theme's background.
 */
function startAppearance(): void {
  createRoot(() => {
    createEffect(() => {
      const background = activeTheme().colors.background;
      SystemUI.setBackgroundColorAsync(background).catch(() => undefined);
    });
  });
}

/**
 * initAccessibility()'s "follow the system's reduced motion" setting (Settings ->
 * Accessibility), from the OS setting instead of a media query. Saturation and link
 * underlines are read straight from the store by the screens that apply them.
 */
function startAccessibility(): void {
  createRoot(() => {
    createEffect(() => {
      if (!accessibility.followSystemMotion) return;
      let active = true;
      const apply = (reduce: boolean) => {
        if (active && appearance.reduceMotion !== reduce) setReduceMotion(reduce);
      };
      AccessibilityInfo.isReduceMotionEnabled()
        .then(apply)
        .catch(() => undefined);
      const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', apply);
      onCleanup(() => {
        active = false;
        sub.remove();
      });
    });
  });
}

// ---- gateway handlers ----------------------------------------------------------------------------

function registerGatewayHandlers(): void {
  initStargateMessageHandler();
  initPresenceHandler();
  initReadStateHandler();
  initPinHandlers();
  initTypingHandler();
  initRelationshipHandlers();
  initRoomHandlers();
  initSpaceHandlers();
  initSpaceMembersHandlers();
  initUserProfileHandler();
  initE2EESyncHandlers();
  initCustomEmojiHandlers();
  initRoomNotifySettingsHandler();
  initVoiceHandlers();
  // SESSION_REVOKED: signs out; the session lifecycle restarts the app with the reason.
  initInstanceHandlers();
  initRoomLeaveHandler();
}

/**
 * Removed from a group PM (or it was deleted): drop it from the list wherever you are,
 * leave it if it is on screen, and let go of what was decrypted for it. RoomPage on the
 * web handles this only for the room it is showing.
 */
function initRoomLeaveHandler(): () => void {
  return onStargateEvent((event) => {
    if (event.t !== 'ROOM_LEAVE') return;
    const d = ((event.d as { d?: unknown } | undefined)?.d ?? event.d) as { room_id?: unknown } | undefined;
    const roomId = d?.room_id != null ? String(d.room_id) : '';
    if (!roomId) return;
    if (currentRoomId() === roomId) closeView();
    removeRoom(roomId);
    clearMessages(roomId);
    // Its unsent draft (the plaintext of an encrypted conversation) and queued file copies go too.
    announceRoomGone(roomId);
  });
}

function handleReady(payload: ReadyPayload): void {
  // The gateway accepted the token at the upgrade just now.
  noteSessionValid();
  // READY's spaces are the ones this connection starts with, not ones just joined.
  knownSpaceIds = null;
  hydrateFromReady(payload);
  knownSpaceIds = untrack(spaceIdSet);
  // Custom emoji are not in READY; one fetch per connection (membership may have changed).
  void loadCustomEmojis();
  // Member lists are cached per connection; whatever changed while down was not seen.
  markSpaceMembersStale();
  // Room keys pushed while disconnected wait as to-device messages.
  const uid = auth.user?.id;
  if (uid) resyncDevice(uid).catch((err: unknown) => console.warn('[e2ee] device resync after reconnect failed', err));
  void loadInstanceCapabilities();
  // GET / failed earlier (an offline start); the instance is evidently reachable now.
  if (instanceInfoFailed()) retryInstanceInfoNow();
}

// ---- the session ----------------------------------------------------------------------------------

function sessionEffects(): void {
  // Connected while there is a token.
  createEffect(() => {
    const token = auth.token;
    if (token) connectStargate(token);
    else disconnectStargate();
  });

  // Every time the socket comes (back) up, rooms already loaded pull their newest page in
  // place, so what arrived while it was down shows without re-entering them. The web skips
  // the first READY; here a room may have been read from the REST fallback before it.
  let wasReady = stargate.ready;
  createEffect(() => {
    const ready = stargate.ready;
    const before = wasReady;
    wasReady = ready;
    if (!ready || before) return;
    for (const roomId of Object.keys(untrack(() => messages.byRoom))) {
      loadMessages(roomId, undefined, undefined, { quiet: true }).catch(() => undefined);
    }
  });

  // READY has not come: restore over REST, which keeps the session unless the server
  // rejects it (session.ts restoreFromRest). Re-armed when the network comes back.
  let restoring = false;
  createEffect(() => {
    const token = auth.token;
    if (!token || auth.hydrated) return;
    const delay = isOnline() ? READY_FALLBACK_MS : 0;
    const timer = setTimeout(() => {
      if (restoring || auth.hydrated || auth.token !== token) return;
      restoring = true;
      void restoreFromRest()
        .then((outcome) => {
          if (outcome === 'offline') setRestoredOffline(true);
        })
        .finally(() => {
          restoring = false;
        });
    }, delay);
    onCleanup(() => clearTimeout(timer));
  });

  // The gateway answers a dead token with an HTTP 401 at the upgrade, which a WebSocket
  // only sees as a close: it would retry forever. While it keeps failing on a working
  // network, ask the API whether the session is still good.
  let lastCheck = 0;
  createEffect(() => {
    const status = stargate.status;
    if (!auth.token || !isOnline()) return;
    if (status !== 'reconnecting' && status !== 'failed') return;
    const now = Date.now();
    if (now - lastCheck < GATEWAY_CHECK_INTERVAL_MS) return;
    lastCheck = now;
    void confirmSessionOrExpire();
  });

  // This device's E2EE identity, once the user is known (READY, sign-in, or the saved
  // account on an offline start). The engine waits for the instance's domain itself.
  const userId = createMemo(() => auth.user?.id);
  createEffect(() => {
    const uid = userId();
    if (!uid) return;
    untrack(() => bootstrapE2EEDevice(uid)).catch((err: unknown) => console.error('E2EE device bootstrap failed:', err));
  });
}

/**
 * The gateway only sends what is subscribed: the user channel, every space, every channel
 * of every space (so unread badges and typing stay live for channels not on screen), and
 * every PM. Subscriptions are ref-counted in the client, so a screen's own is independent.
 *
 * The web re-subscribes a whole list whenever anything in it changes (a space renamed
 * unsubscribes and resubscribes every space); here only the ids that came or went are
 * sent. Losing the socket drops them all, and READY brings them back.
 */
function holdSubscriptions(ids: () => readonly string[]): void {
  let held = new Set<string>();
  createEffect(() => {
    const next = new Set<string>(stargate.ready ? ids() : []);
    for (const id of held) if (!next.has(id)) unsubscribe(id, undefined);
    for (const id of next) if (!held.has(id)) subscribe(id, undefined);
    held = next;
  });
}

function spaceIdSet(): Set<string> {
  return new Set(spaces.spaces.map((s) => s.id).filter((id): id is string => !!id));
}

/**
 * The spaces as of the last READY plus those seen joining since; null while READY is being
 * applied. Upstream, resubscribeAll splits subRefCounts' NUL-joined keys on ' ', so each
 * frame it sends carries a bad id and the gateway answers 4403 - harmless for the space
 * channel it still re-asserts, but only worth it after a real join.
 */
let knownSpaceIds: Set<string> | null = null;
let resubscribeTimers: ReturnType<typeof setTimeout>[] = [];

function subscriptionEffects(): void {
  const me = createMemo(() => auth.user?.id);
  createEffect(() => {
    const id = me();
    if (!stargate.ready || !id) return;
    subscribe(undefined, id);
    onCleanup(() => unsubscribe(undefined, id));
  });

  holdSubscriptions(() => spaces.spaces.map((s) => s.id).filter((id): id is string => !!id));
  holdSubscriptions(() =>
    Object.values(spaces.spaceRoomsBySpaceId).flatMap((list) => (list ?? []).map((r) => r.id).filter((id): id is string => !!id)),
  );
  holdSubscriptions(() => rooms.rooms.map((r) => r.id).filter((id): id is string => !!id));

  // A space joined mid-session: the gateway can refuse its channels' subscriptions for a
  // moment (the membership is not visible to its authorisation read yet), so re-assert
  // them twice. Only a space that appears between READYs counts: handleReady sets the
  // baseline from what READY brought. Deriving it from the store instead (as the web does,
  // and this did) took the empty list a fresh sign-in or the REST fallback leaves - both
  // set `hydrated` before READY, and `ready` flips before READY's spaces are stored - so
  // every sign-in re-asserted every subscription twice, and resubscribeAll's frames are
  // malformed upstream (a 4403 per channel each time; see knownSpaceIds).
  createEffect(() => {
    const current = spaceIdSet();
    if (!stargate.ready || knownSpaceIds === null) return;
    const added = [...current].some((id) => !knownSpaceIds!.has(id));
    knownSpaceIds = current;
    if (!added) return;
    // Not cleared by the effect's next run: a rename landing within 4 s of the join would
    // otherwise cancel the re-assertion. resubscribeAll is a no-op on a closed socket.
    resubscribeTimers.forEach(clearTimeout);
    resubscribeTimers = RESUBSCRIBE_DELAYS_MS.map((ms) => setTimeout(resubscribeAll, ms));
  });
}

/**
 * Settings changed during a call reach it at once: the microphone pipeline is rebuilt for
 * input changes, the output or camera switched, levels re-applied. The voice store does
 * the work; these only say when.
 */
function voiceEffects(): void {
  const whenLive = (changed: Parameters<typeof applyVoiceSettingsToSession>[0]) => {
    if (voice.session.status !== 'idle') void applyVoiceSettingsToSession(changed);
  };
  createEffect(
    on(
      () =>
        [
          voiceSettings.inputDeviceId,
          voiceSettings.echoCancellation,
          voiceSettings.noiseSuppression,
          voiceSettings.autoGainControl,
        ] as const,
      () => whenLive({ input: true }),
      { defer: true },
    ),
  );
  createEffect(on(() => voiceSettings.outputDeviceId, () => whenLive({ output: true }), { defer: true }));
  createEffect(on(() => voiceSettings.cameraDeviceId, () => whenLive({ camera: true }), { defer: true }));
  createEffect(
    on(
      () =>
        [
          voiceSettings.inputVolume,
          voiceSettings.outputVolume,
          voiceSettings.sensitivityDb,
          voiceSettings.autoSensitivity,
        ] as const,
      () => whenLive({}),
      { defer: true },
    ),
  );
}

/** desktop/boot.ts: unread mentions, summed over every room, on the app icon. */
function badgeEffect(): void {
  const total = createMemo(() => {
    let n = 0;
    for (const r of Object.values(readState.byRoom)) n += r?.mentionCount || 0;
    return n;
  });
  createEffect(() => {
    const n = total();
    void setUnreadBadge(n).catch(() => undefined);
  });
}
