/**
 * Network reachability and app foreground/background, turned into what the shared web code
 * listens for.
 *
 * The gateway client (services/stargate/client.ts) reconnects at once on window 'online',
 * pings on 'focus', and - after a long absence - checks a socket that claims to be open for
 * life and replaces it when it stays silent. A phone suspends sockets in the background
 * and often does not report them closed, so those wake-ups are what bring a conversation
 * back after the app has been away. The window shim already turns AppState into
 * focus/blur/visibilitychange; this adds the network (NetInfo) and the two things the web
 * gets from a browser that the app has to do itself:
 *
 * - The gateway's long-absence check is driven by `document` 'visibilitychange', and the
 *   app deliberately has no global `document`. Its 'online' path runs the same check, so
 *   coming back after a while dispatches that.
 * - The web flushes the read position with a keepalive request at page unload. The app's
 *   equivalent moment is going to the background, after which the OS may end it.
 *
 * Also retries the instance info (GET /) when the network or the app comes back, if it
 * could not be read before (see overrides/runtime/instance.ts).
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { createSignal } from 'solid-js';
import { ackRoomKeepalive } from '@web/api/rooms';
import { getPendingAck } from '@web/stores/pendingAck';
import { instanceInfoFailed, retryInstanceInfoNow } from './overrides/runtime/instance';
import { refreshActiveRoomQuietly } from './rooms';
import { reportOnline } from './shims/window';

/** The gateway client's own threshold for "away long enough that the socket may be dead". */
const LONG_ABSENCE_MS = 8_000;
/** Away this long, the room on screen re-pulls its newest page even if the socket lived. */
const REFRESH_ROOM_AFTER_MS = 30_000;

const [online, setOnline] = createSignal(true);

/** Whether the device has a usable network; reactive. Optimistic until NetInfo answers. */
export function isOnline(): boolean {
  return online();
}

/**
 * Only a definite "no" counts as offline. `isInternetReachable` is null until the OS has
 * checked, and treating that as offline would flash an offline banner (and hold the
 * gateway back) on every start.
 */
export function isReachable(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

function applyNetwork(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): void {
  const next = isReachable(state);
  if (next === online()) return;
  setOnline(next);
  reportOnline(next);
  if (next && instanceInfoFailed()) retryInstanceInfoNow();
}

function flushPendingAck(): void {
  const pending = getPendingAck();
  if (pending) ackRoomKeepalive(pending.roomId, pending.messageId);
}

function onForeground(awayMs: number): void {
  if (instanceInfoFailed()) retryInstanceInfoNow();
  if (awayMs >= LONG_ABSENCE_MS && online()) {
    // The gateway's 'online' wake-up: reconnect a closed socket, or ping an open one and
    // replace it if nothing comes back (see the file comment).
    reportOnline(true);
  }
  if (awayMs >= REFRESH_ROOM_AFTER_MS) refreshActiveRoomQuietly();
}

let stop: (() => void) | null = null;

/** Start watching; idempotent. Returns the stopper. */
export function startConnectivity(): () => void {
  if (stop) return stop;
  const offNetwork = NetInfo.addEventListener(applyNetwork);
  NetInfo.fetch()
    .then(applyNetwork)
    .catch(() => undefined);

  let awaySince = AppState.currentState === 'active' ? 0 : Date.now();
  const appState = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') {
      const away = awaySince ? Date.now() - awaySince : 0;
      awaySince = 0;
      onForeground(away);
      return;
    }
    // iOS passes through 'inactive' (a pulled-down notification centre) on the way out.
    if (!awaySince) awaySince = Date.now();
    if (state === 'background') flushPendingAck();
  });

  stop = () => {
    offNetwork();
    appState.remove();
    stop = null;
  };
  return stop;
}
