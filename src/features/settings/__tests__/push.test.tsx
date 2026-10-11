/// <reference types="jest" />
/**
 * Settings -> Notifications -> Push notifications: the status line for every state, the
 * switch, the Android transport picker and the test button.
 */
import './settingsTestSetup';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import i18next from 'i18next';
import { setPushStatus, setPushCapabilities, type PushStatus } from '@/platform/push/status';
import { pushEnabled, setPushEnabled, setTransportPref, transportPref } from '@/platform/push/config';
import { PushSettings, pushStatusText } from '../user/PushSettings';

jest.mock('@/platform/push/registration', () => ({ ensurePushRegistration: jest.fn(async () => undefined) }));
jest.mock('@/platform/push/api', () => ({ sendTestPush: jest.fn() }));
jest.mock('@/platform/push/accounts', () => ({ activePushAccount: jest.fn(() => ({ id: 'a:1', slot: 's', apiBase: 'https://api.a', token: 't' })) }));

const registration = jest.requireMock('@/platform/push/registration') as { ensurePushRegistration: jest.Mock };
const api = jest.requireMock('@/platform/push/api') as { sendTestPush: jest.Mock };

const en = require('../../../i18n/locales/en').default as { mobile: Record<string, unknown> };
i18next.addResourceBundle('en', 'translation', { mobile: { push: en.mobile.push } }, true, true);

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as { OS: string }).OS = 'android';
  setPushEnabled(true);
  setTransportPref('auto');
  setPushStatus({ state: 'active', transport: { kind: 'fcm' } });
  setPushCapabilities({ fcm: true, apns: false, unifiedPush: true, distributors: [{ id: 'io.heckel.ntfy', name: 'ntfy' }], selectedDistributor: null });
});

describe('pushStatusText', () => {
  const cases: [PushStatus, string][] = [
    [{ state: 'active', transport: { kind: 'fcm' } }, 'Active · Firebase Cloud Messaging'],
    [{ state: 'active', transport: { kind: 'apns' } }, 'Active · Apple Push Notification service'],
    [{ state: 'active', transport: { kind: 'unifiedpush', distributorId: 'io.heckel.ntfy', distributorName: 'ntfy' } }, 'Active · UnifiedPush (ntfy)'],
    [{ state: 'permission' }, "Strafe isn't allowed to show notifications. Allow them in the system settings."],
    [{ state: 'no-transport', reason: 'none' }, 'No push service on this device: this build has no Firebase and no UnifiedPush distributor is installed.'],
    [{ state: 'no-transport', reason: 'choose-distributor' }, 'Several UnifiedPush distributors are installed. Choose one below.'],
    [{ state: 'error', where: 'gateway', transport: { kind: 'fcm' }, detail: 'unreachable' }, "Couldn't reach the push gateway (unreachable)."],
    [{ state: 'error', where: 'instance', transport: { kind: 'fcm' }, detail: 'endpoint host not allowed' }, 'Your instance refused this device (endpoint host not allowed).'],
    [{ state: 'error', where: 'unsupported', transport: null }, "Your instance doesn't send push notifications."],
    [{ state: 'disabled' }, "Off. You're notified only while Strafe is running."],
  ];
  it.each(cases)('%j', (status, text) => {
    expect(pushStatusText(status)).toBe(text);
  });
});

describe('PushSettings', () => {
  it('shows the status, re-checks on arrival, and turns push off', async () => {
    await render(<PushSettings />);
    expect(registration.ensurePushRegistration).toHaveBeenCalled();
    expect(screen.getByText('Active · Firebase Cloud Messaging')).toBeTruthy();
    expect(screen.getByText(/encrypted by your instance for this device/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('push-enabled'));
    expect(pushEnabled()).toBe(false);
  });

  it('offers Automatic, Firebase, each distributor and (in development) the debug transport', async () => {
    await render(<PushSettings />);
    expect(screen.getByTestId('push-transport-auto')).toBeTruthy();
    expect(screen.getByTestId('push-transport-fcm')).toBeTruthy();
    expect(screen.getByTestId('push-transport-debug')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('push-transport-unifiedpush:io.heckel.ntfy'));
    expect(transportPref()).toBe('unifiedpush:io.heckel.ntfy');
  });

  it('has no transport picker on iOS', async () => {
    (Platform as { OS: string }).OS = 'ios';
    await render(<PushSettings />);
    expect(screen.queryByTestId('push-transport-auto')).toBeNull();
  });

  it('sends a test push and re-registers when the instance did not know this device', async () => {
    api.sendTestPush.mockResolvedValueOnce({ delivered: true });
    await render(<PushSettings />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('push-test'));
    });
    await waitFor(() => expect(api.sendTestPush).toHaveBeenCalledTimes(1));

    api.sendTestPush.mockResolvedValueOnce({ delivered: false, missing: true });
    await act(async () => {
      fireEvent.press(screen.getByTestId('push-test'));
    });
    await waitFor(() => expect(registration.ensurePushRegistration).toHaveBeenCalledWith({ force: true }));
  });

  it('re-registers when the push service says the endpoint is gone, not on other failures', async () => {
    await render(<PushSettings />);
    registration.ensurePushRegistration.mockClear();
    api.sendTestPush.mockResolvedValueOnce({ delivered: false, status: 502, error: 'http 502' });
    await act(async () => {
      fireEvent.press(screen.getByTestId('push-test'));
    });
    await waitFor(() => expect(api.sendTestPush).toHaveBeenCalledTimes(1));
    expect(registration.ensurePushRegistration).not.toHaveBeenCalledWith({ force: true });

    api.sendTestPush.mockResolvedValueOnce({ delivered: false, status: 410, error: 'gone' });
    await act(async () => {
      fireEvent.press(screen.getByTestId('push-test'));
    });
    await waitFor(() => expect(registration.ensurePushRegistration).toHaveBeenCalledWith({ force: true }));
  });

  it('the test is offered only once push is active', async () => {
    setPushStatus({ state: 'permission' });
    await render(<PushSettings />);
    await fireEvent.press(screen.getByTestId('push-test'));
    expect(api.sendTestPush).not.toHaveBeenCalled();
  });
});
