/**
 * The mobile notification primitives: a posted notification carries the chime requested in
 * the same turn; without one, the chime is a haptic tap; the room id rides in the data.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGranted = { value: true as boolean | null };
const mockNative = {
  isDesktop: () => true,
  nativeNotificationsGrantedSync: () => mockGranted.value,
  nativeNotificationsGranted: jest.fn(async () => mockGranted.value === true),
  requestNativeNotifications: jest.fn(async () => true),
  sendNativeNotification: jest.fn(),
  flashWindow: jest.fn(async () => undefined),
};
const mockShowLocal = jest.fn(async (_n: Record<string, unknown>) => true);
const mockImpact = jest.fn(async (_style: string) => undefined);

// The web module's own imports (desktop/env, desktop/native) and the override's native module.
jest.mock('@web/desktop/env', () => ({ isDesktop: () => true }));
jest.mock('@web/desktop/native', () => mockNative);
jest.mock('../desktop/native', () => mockNative);
jest.mock('../../notifications', () => ({ showLocalNotification: (n: Record<string, unknown>) => mockShowLocal(n) }));
jest.mock('../../rooms', () => ({ spaceIdOfRoom: (id: string) => (id === '456' ? '9' : null) }));
jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: (style: string) => mockImpact(style),
}));

// The app's localStorage is MMKV (shims/localStorage.ts); a map stands in for it here.
const stored = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
};
stored.set('strafe_notifications', JSON.stringify({ desktop: true, volume: 0.25 }));

const prefs = require('./notificationPrefs') as typeof import('./notificationPrefs');

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockGranted.value = true;
});

describe('showDesktopNotification', () => {
  it('posts nothing without permission', () => {
    mockGranted.value = false;
    expect(prefs.showDesktopNotification({ title: 't' })).toBe(false);
    mockGranted.value = null; // not asked yet
    expect(prefs.showDesktopNotification({ title: 't' })).toBe(false);
    expect(mockShowLocal).not.toHaveBeenCalled();
  });

  it('posts a tagged notification whose tap runs onClick and whose data names the room', () => {
    const onClick = jest.fn();
    expect(prefs.showDesktopNotification({ title: 'Alice', body: 'hi', tag: 'room:123', onClick })).toBe(true);
    expect(mockShowLocal).toHaveBeenCalledWith({
      title: 'Alice',
      body: 'hi',
      tag: 'room:123',
      onPress: onClick,
      data: { roomId: '123', spaceId: '' },
      sound: false,
    });
  });

  it("names a channel's space, so a tap that cold-starts the app opens it in its space", () => {
    prefs.showDesktopNotification({ title: 'Alice', tag: 'room:456' });
    expect(mockShowLocal.mock.calls[0]![0]).toMatchObject({ data: { roomId: '456', spaceId: '9' } });
  });

  it('leaves out room data for a tag that is not a room', () => {
    prefs.showDesktopNotification({ title: 'Test', tag: 'strafe-test' });
    expect(mockShowLocal.mock.calls[0]![0]).not.toHaveProperty('data');
  });
});

describe('playNotificationSound', () => {
  it('rides on a notification posted in the same turn', async () => {
    prefs.playNotificationSound(0.5);
    prefs.showDesktopNotification({ title: 'Alice', tag: 'room:1' });
    await flush();
    expect(mockShowLocal.mock.calls[0]![0]).toMatchObject({ sound: true });
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('is a single haptic tap when no notification follows', async () => {
    prefs.playNotificationSound(0.5);
    prefs.playNotificationSound(0.5);
    await flush();
    expect(mockImpact).toHaveBeenCalledTimes(1);
    // The request was used up: a later notification is silent.
    prefs.showDesktopNotification({ title: 'later' });
    expect(mockShowLocal.mock.calls[0]![0]).toMatchObject({ sound: false });
  });

  it('does nothing at volume 0', async () => {
    prefs.playNotificationSound(0);
    prefs.showDesktopNotification({ title: 'x' });
    await flush();
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockShowLocal.mock.calls[0]![0]).toMatchObject({ sound: false });
  });
});

describe('the kept web store', () => {
  it('loads and persists preferences as the web does', () => {
    expect(prefs.notificationPrefs).toMatchObject({ desktop: true, volume: 0.25, sounds: true });
    prefs.setNotificationPrefs({ spaceMode: 'all' });
    expect(prefs.notificationPrefs.spaceMode).toBe('all');
    expect(JSON.parse(stored.get('strafe_notifications') ?? '{}')).toMatchObject({ spaceMode: 'all', volume: 0.25 });
  });

  it('answers the permission from the native module', async () => {
    mockGranted.value = true;
    expect(prefs.desktopPermission()).toBe('granted');
    mockGranted.value = false;
    expect(prefs.desktopPermission()).toBe('denied');
    await expect(prefs.requestDesktopPermission()).resolves.toBe('granted');
  });
});
