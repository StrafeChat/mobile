/**
 * Local notifications (expo-notifications) for the shared notification logic.
 *
 * The web decides *whether* something notifies (mute settings, mentions-only, the room you
 * are looking at); this shows it, and remembers what a tap should do. Notifications with the
 * same tag (one per room) replace each other, as the web's do.
 *
 * Push notifications (src/platform/push) share the stage with these, and three hooks let
 * the push side take its part without this module depending on it:
 * - a gate on local notifications: in the background, an account whose pushes arrive gets
 *   its message notifications from the push, so the local one would be a duplicate;
 * - the presentation of a remote push that reaches the running app (iOS asks the app):
 *   the open account's pushes were already notified here, other accounts' still show;
 * - responses to a push (iOS taps and buttons) are the push side's to route.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { t } from '@web/i18n/t';

export interface LocalNotification {
  title: string;
  body?: string;
  /** One per room: a newer one replaces the older. */
  tag?: string;
  /** What tapping it does. */
  onPress?: () => void;
  /** Routing data that survives an app restart (a tap that launches the app). */
  data?: Record<string, string>;
  /** Play the system notification sound (the person's "notification sound" setting). */
  sound?: boolean;
}

const pressHandlers = new Map<string, () => void>();
let configured = false;
let launchHandler: ((data: Record<string, string>) => void) | null = null;

/** Return true to keep a local notification from being posted. */
export type LocalNotificationGate = (n: LocalNotification) => boolean;
/** How a remote push reaching the running app is presented; null: not one of ours. */
export type RemotePushPresenter = (notification: Notifications.Notification) => { show: boolean; sound: boolean } | null;
/** Handle a response to a remote push; false when it is not one of ours. */
export type RemotePushResponder = (response: Notifications.NotificationResponse) => boolean;

let localGate: LocalNotificationGate | null = null;
let remotePresenter: RemotePushPresenter | null = null;
let remoteResponder: RemotePushResponder | null = null;

export function setLocalNotificationGate(gate: LocalNotificationGate | null): void {
  localGate = gate;
}

export function setRemotePushPresenter(presenter: RemotePushPresenter | null): void {
  remotePresenter = presenter;
}

/** Also replays the response that launched the app, if it was a push's and is unhandled. */
export function setRemotePushResponder(responder: RemotePushResponder | null): void {
  configure();
  remoteResponder = responder;
  if (!responder) return;
  void Notifications.getLastNotificationResponseAsync().then((last) => {
    if (last && responder(last)) void Notifications.clearLastNotificationResponseAsync?.();
  });
}

/**
 * Android channels, named in the current language (re-run when it changes: recreating a
 * channel with the same id renames it and keeps the person's settings for it). The native
 * push renderer posts to the same `messages` / `messages-silent` channels.
 */
export function localizeNotificationChannels(): void {
  if (Platform.OS !== 'android') return;
  void Notifications.setNotificationChannelAsync('messages', {
    name: t('mobile.push.channelMessages'),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 120, 60, 120],
    lightColor: '#509b6b',
  });
  // The person's "notification sound" setting decides per notification; Android fixes
  // sound per channel, hence a silent twin of the messages channel.
  void Notifications.setNotificationChannelAsync('messages-silent', {
    name: t('mobile.push.channelMessagesSilent'),
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
    vibrationPattern: [0, 120, 60, 120],
  });
  // Incoming calls ring on the push renderer's `calls-incoming` channel, which the native
  // side creates (ringtone audio usage, which this API cannot set). Once it exists, only its
  // name is ours to keep current - Android ignores everything else on an existing channel.
  void Notifications.getNotificationChannelAsync('calls-incoming')
    .then((existing) => {
      if (!existing) return;
      return Notifications.setNotificationChannelAsync('calls-incoming', {
        name: t('mobile.push.channelCalls'),
        importance: Notifications.AndroidImportance.HIGH,
      });
    })
    .catch(() => undefined);
  // An earlier build's `calls` channel, which nothing posts to: it would be a second
  // "Incoming calls" entry in the system settings.
  void Notifications.deleteNotificationChannelAsync('calls').catch(() => undefined);
}

function configure(): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // A push for an account (iOS hands the running app its remote notifications).
      const remote = remotePresenter?.(n);
      if (remote) {
        return { shouldShowBanner: remote.show, shouldShowList: remote.show, shouldPlaySound: remote.show && remote.sound, shouldSetBadge: false };
      }
      // While the app is open the shared code has already decided this deserves attention.
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        // Read from the notification itself: the handler can run before schedule resolves.
        shouldPlaySound: (n.request.content.data as Record<string, unknown> | undefined)?.strafeSound === '1',
        shouldSetBadge: false,
      };
    },
  });
  localizeNotificationChannels();
  Notifications.addNotificationResponseReceivedListener((response) => {
    const req = response.notification.request;
    const handler = pressHandlers.get(req.identifier);
    if (handler) {
      pressHandlers.delete(req.identifier);
      handler();
      return;
    }
    if (remoteResponder?.(response)) return;
    const data = (req.content.data ?? {}) as Record<string, string>;
    launchHandler?.(data);
  });
}

/** Where a tap on a notification from an earlier run (or with no live handler) goes. */
export function setNotificationLaunchHandler(fn: (data: Record<string, string>) => void): void {
  configure();
  launchHandler = fn;
  void Notifications.getLastNotificationResponseAsync().then((last) => {
    if (!last) return;
    // A push's response is the push side's (setRemotePushResponder replays it).
    if ((last.notification.request.content.data as { strafe?: unknown } | undefined)?.strafe) return;
    const data = (last.notification.request.content.data ?? {}) as Record<string, string>;
    fn(data);
    void Notifications.clearLastNotificationResponseAsync?.();
  });
}

export async function showLocalNotification(n: LocalNotification): Promise<boolean> {
  configure();
  if (localGate?.(n)) return false;
  try {
    const identifier = n.tag ?? undefined;
    if (identifier) await Notifications.dismissNotificationAsync(identifier).catch(() => undefined);
    const id = await Notifications.scheduleNotificationAsync({
      ...(identifier ? { identifier } : {}),
      content: {
        title: n.title,
        ...(n.body ? { body: n.body } : {}),
        data: { ...(n.data ?? {}), ...(n.sound ? { strafeSound: '1' } : {}) },
        ...(Platform.OS === 'android' ? {} : { sound: n.sound ? 'default' : false }),
      },
      trigger: Platform.OS === 'android' ? { channelId: n.sound ? 'messages' : 'messages-silent' } : null,
    });
    if (n.onPress) pressHandlers.set(id, n.onPress);
    return true;
  } catch (e) {
    console.warn('[notifications] could not show', e);
    return false;
  }
}

export async function clearRoomNotification(tag: string): Promise<void> {
  pressHandlers.delete(tag);
  await Notifications.dismissNotificationAsync(tag).catch(() => undefined);
}
