/**
 * Local notifications (expo-notifications) for the shared notification logic.
 *
 * The web decides *whether* something notifies (mute settings, mentions-only, the room you
 * are looking at); this shows it, and remembers what a tap should do. Notifications with the
 * same tag (one per room) replace each other, as the web's do.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export interface LocalNotification {
  title: string;
  body?: string;
  /** One per room: a newer one replaces the older. */
  tag?: string;
  /** What tapping it does. */
  onPress?: () => void;
  /** Routing data that survives an app restart (a tap that launches the app). */
  data?: Record<string, string>;
}

const pressHandlers = new Map<string, () => void>();
let configured = false;
let launchHandler: ((data: Record<string, string>) => void) | null = null;

function configure(): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    // While the app is open the shared code has already decided this deserves attention.
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 120, 60, 120],
      lightColor: '#509b6b',
    });
    void Notifications.setNotificationChannelAsync('calls', {
      name: 'Calls',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
    });
  }
  Notifications.addNotificationResponseReceivedListener((response) => {
    const req = response.notification.request;
    const handler = pressHandlers.get(req.identifier);
    if (handler) {
      pressHandlers.delete(req.identifier);
      handler();
      return;
    }
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
    const data = (last.notification.request.content.data ?? {}) as Record<string, string>;
    fn(data);
    void Notifications.clearLastNotificationResponseAsync?.();
  });
}

export async function showLocalNotification(n: LocalNotification): Promise<boolean> {
  configure();
  try {
    const identifier = n.tag ?? undefined;
    if (identifier) await Notifications.dismissNotificationAsync(identifier).catch(() => undefined);
    const id = await Notifications.scheduleNotificationAsync({
      ...(identifier ? { identifier } : {}),
      content: {
        title: n.title,
        ...(n.body ? { body: n.body } : {}),
        data: n.data ?? {},
        ...(Platform.OS === 'android' ? {} : { sound: false }),
      },
      trigger: Platform.OS === 'android' ? { channelId: 'messages' } : null,
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
