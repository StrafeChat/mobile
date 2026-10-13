/**
 * A notification tap opens its room in front of the person: with a thread, settings or the
 * media viewer pushed over the shell, moving the shell alone would change nothing visible.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { router } from 'expo-router';
import { setNotificationLaunchHandler } from './notifications';
import { installAppWiring } from './wiring';
import { closeView, shell } from '@/shell/state';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false), canDismiss: jest.fn(() => false), dismissAll: jest.fn() },
}));
let mockNavigate: ((path: string) => void) | null = null;
jest.mock('@web/lib/notifications', () => ({
  onNavigateRequest: (fn: (path: string) => void) => {
    mockNavigate = fn;
    return () => {
      mockNavigate = null;
    };
  },
}));
jest.mock('./shims/window', () => ({ bindLocation: jest.fn(), setLocationPath: jest.fn() }));
jest.mock('./reload', () => ({ reloadApp: jest.fn() }));
jest.mock('./notifications', () => ({ setNotificationLaunchHandler: jest.fn() }));
jest.mock('./push/lifecycle', () => ({ clearPushRoom: jest.fn(), installPushLifecycle: () => () => undefined }));
jest.mock('./media', () => ({ installMediaLifecycle: jest.fn(), setAudioSessionGuard: jest.fn() }));
jest.mock('./rooms', () => ({ spaceIdOfRoom: () => null }));

const canDismiss = router.canDismiss as jest.Mock;
const dismissAll = router.dismissAll as jest.Mock;
let uninstall: () => void = () => undefined;

beforeEach(() => {
  closeView();
  uninstall = installAppWiring();
});

afterEach(() => {
  uninstall();
  jest.clearAllMocks();
});

test('a tap on a live notification closes the screens pushed over the shell', () => {
  // A thread (or settings, or the media viewer) is in front of the shell.
  canDismiss.mockReturnValue(true);
  mockNavigate?.('/spaces/100/rooms/300');
  expect(shell.view()).toEqual({ kind: 'room', roomId: '300', spaceId: '100' });
  expect(shell.panel()).toBe('content');
  expect(dismissAll).toHaveBeenCalledTimes(1);
});

test('with the shell already in front there is nothing to close', () => {
  canDismiss.mockReturnValue(false);
  mockNavigate?.('/rooms/400');
  expect(shell.view()).toEqual({ kind: 'room', roomId: '400' });
  expect(dismissAll).not.toHaveBeenCalled();
});

test('a tap from an earlier run (no live handler) does the same', () => {
  const launch = (setNotificationLaunchHandler as jest.Mock).mock.calls[0]?.[0] as (data: Record<string, string>) => void;
  canDismiss.mockReturnValue(true);
  launch({ roomId: '500', spaceId: '' });
  expect(shell.view()).toEqual({ kind: 'room', roomId: '500' });
  expect(shell.selectedSpaceId()).toBeNull();
  expect(dismissAll).toHaveBeenCalledTimes(1);
});
