/**
 * src/platform/voice/callService.ts against a fake native module: the first call starts
 * the service, a mute change only updates its notification (Android forbids a new start
 * from the background, where the notification's buttons are pressed), a camera change
 * restarts it with the new types, and the module's events reach the caller.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { CALL_SERVICE_EVENT, callServiceRunningWith, onCallServiceEvent, startCallService, stopCallService } from './callService';

Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

const calls: string[] = [];
let updateResult = true;
(NativeModules as Record<string, unknown>).StrafeCallService = {
  start: async (o: { camera: boolean; muted: boolean }) => {
    calls.push(`start camera=${o.camera} muted=${o.muted}`);
    return true;
  },
  update: async (o: { muted: boolean; muteLabel: string | null }) => {
    calls.push(`update muted=${o.muted} button=${o.muteLabel}`);
    return updateResult;
  },
  stop: async () => {
    calls.push('stop');
    return true;
  },
};

const content = (muteLabel: string | null) => ({ title: 'T', text: 'E2EE', channelName: 'Calls', muteLabel, hangUpLabel: 'Disconnect' });

describe('callService', () => {
  beforeEach(async () => {
    await stopCallService();
    calls.length = 0;
    updateResult = true;
  });

  it('starts once, then updates the notification in place for a mute change', async () => {
    await startCallService(content('Mute'), { camera: false, muted: false });
    await startCallService(content('Mute'), { camera: false, muted: false });
    await startCallService(content('Unmute'), { camera: false, muted: true });
    expect(calls).toEqual(['start camera=false muted=false', 'update muted=true button=Unmute']);
    expect(callServiceRunningWith(false)).toBe(true);
    expect(callServiceRunningWith(true)).toBe(false);
  });

  it('starts again for a camera change, or when the update finds no service', async () => {
    await startCallService(content('Mute'), { camera: false, muted: false });
    await startCallService(content('Mute'), { camera: true, muted: false });
    updateResult = false;
    await startCallService(content('Unmute'), { camera: true, muted: true });
    expect(calls).toEqual([
      'start camera=false muted=false',
      'start camera=true muted=false',
      'update muted=true button=Unmute',
      'start camera=true muted=true',
    ]);
  });

  it('hands notification buttons to the caller and forgets a service that stopped', async () => {
    await startCallService(content('Mute'), { camera: false, muted: false });
    const action = jest.fn();
    const stopped = jest.fn();
    const off = onCallServiceEvent({ action, stopped });
    DeviceEventEmitter.emit(CALL_SERVICE_EVENT, { type: 'action', action: 'mute' });
    DeviceEventEmitter.emit(CALL_SERVICE_EVENT, { type: 'action', action: 'hangup' });
    DeviceEventEmitter.emit(CALL_SERVICE_EVENT, { type: 'action', action: 'bogus' });
    expect(action.mock.calls).toEqual([['mute'], ['hangup']]);

    DeviceEventEmitter.emit(CALL_SERVICE_EVENT, { type: 'stopped' });
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(callServiceRunningWith(false)).toBe(false);
    // Not running any more, so the next call starts it rather than updating nothing.
    await startCallService(content('Mute'), { camera: false, muted: false });
    expect(calls.at(-1)).toBe('start camera=false muted=false');
    off();
  });
});
