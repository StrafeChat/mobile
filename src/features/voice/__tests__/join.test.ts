/**
 * joinVoiceFromUi and the incoming-call actions: the gates (voice off, no encryption, no
 * Connect), the switch-calls confirm, permission prompts that explain rather than block,
 * the web's error mapping, and not rejoining a call that ended during a prompt.
 */
import '@/ui/__tests__/setup';
import './voiceMocks';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { ApiError } from '@web/api/ApiError';
import * as voiceStore from '@web/stores/voice';
import { setVoice, voice } from '@web/stores/voice';
import { voicePermsFor } from '@web/lib/voice/perms';
import { callEncryptionSupported } from '@/platform/voice';
import { stopRingtone } from '@/platform/voice/ringtone';
import { shell } from '@/shell/state';
import { toastStore } from '@/ui';
import { callViewStore, closeCallScreen, setCallScreenMounted } from '../callView';
import { acceptIncomingFromUi, joinVoiceFromUi, joiningStore } from '../join';

jest.mock('@web/stores/confirmDialog', () => ({ confirmDialog: jest.fn(async () => true) }));
 
const { confirmDialog } = require('@web/stores/confirmDialog') as { confirmDialog: jest.Mock<(o: unknown) => Promise<boolean>> };
 
const { setInstance } = require('@web/stores/instance') as { setInstance: (p: object) => void };

const store = voiceStore as unknown as {
  joinVoiceRoom: jest.Mock<(roomId: string, opts?: { video?: boolean }) => Promise<void>>;
  acceptIncomingCall: jest.Mock<(video?: boolean) => Promise<void>>;
  setCameraEnabled: jest.Mock<(on: boolean) => Promise<void>>;
  CallEncryptionUnsupportedError: new () => Error;
  __idleSession: object;
};
const perm = { granted: true, canAskAgain: true };
type PermMock = jest.Mock<() => Promise<typeof perm>>;
const micGet = getRecordingPermissionsAsync as unknown as PermMock;
const micRequest = requestRecordingPermissionsAsync as unknown as PermMock;

function lastToast() {
  return toastStore.get();
}

beforeEach(() => {
  jest.clearAllMocks();
  setInstance({ voiceEnabled: true });
  setVoice('session', { ...(store.__idleSession as typeof voice.session) });
  setVoice('incoming', null);
  (callEncryptionSupported as jest.Mock<() => boolean>).mockReturnValue(true);
  micGet.mockResolvedValue(perm);
  micRequest.mockResolvedValue(perm);
  toastStore.set(null);
  joiningStore.set(null);
  while (callViewStore.get().mounted > 0) setCallScreenMounted(false);
});

describe('joinVoiceFromUi', () => {
  test('joins, opening the call screen on that room first', async () => {
    const ok = await joinVoiceFromUi('v1', { spaceId: 's1' });
    expect(ok).toBe(true);
    expect(store.joinVoiceRoom).toHaveBeenCalledWith('v1', { video: false });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/call', params: { roomId: 'v1', spaceId: 's1' } });
    expect(callViewStore.get().roomId).toBe('v1');
    expect(joiningStore.get()).toBeNull();
  });

  test('refuses when voice is off on the instance, without touching the store', async () => {
    setInstance({ voiceEnabled: false });
    expect(await joinVoiceFromUi('v1', { spaceId: 's1' })).toBe(false);
    expect(store.joinVoiceRoom).not.toHaveBeenCalled();
    expect(lastToast()?.message).toBe('Voice is not set up on this instance. Ask the person running it to configure LiveKit.');
  });

  test('never joins in the clear: no call encryption on this device is refused', async () => {
    (callEncryptionSupported as jest.Mock<() => boolean>).mockReturnValue(false);
    const onError = jest.fn<(m: string) => void>();
    expect(await joinVoiceFromUi('p1', { spaceId: null, onError })).toBe(false);
    expect(store.joinVoiceRoom).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("can't encrypt calls"));
    expect(lastToast()).toBeNull();
  });

  test('no Connect permission in a space room reads as the web says', async () => {
    (voicePermsFor as jest.Mock<() => object>).mockReturnValueOnce({ connect: false });
    expect(await joinVoiceFromUi('v1', { spaceId: 's1' })).toBe(false);
    expect(lastToast()?.message).toBe("You don't have permission to join this room.");
  });

  test('already in another call: asks first, and a "no" leaves the call alone', async () => {
    setVoice('session', { roomId: 'v0', spaceId: 's1', status: 'connected' });
    confirmDialog.mockResolvedValueOnce(false);
    expect(await joinVoiceFromUi('v1', { spaceId: 's1' })).toBe(false);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(store.joinVoiceRoom).not.toHaveBeenCalled();

    confirmDialog.mockResolvedValueOnce(true);
    expect(await joinVoiceFromUi('v1', { spaceId: 's1' })).toBe(true);
    expect(store.joinVoiceRoom).toHaveBeenCalledWith('v1', { video: false });
  });

  test('already in this call: just shows it (and turns the camera on for a video join)', async () => {
    setVoice('session', { roomId: 'p1', spaceId: null, status: 'connected', camera: false });
    expect(await joinVoiceFromUi('p1', { spaceId: null, video: true })).toBe(true);
    expect(store.joinVoiceRoom).not.toHaveBeenCalled();
    expect(store.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  test('a refused microphone still joins (to listen) and says why, with a way to Settings', async () => {
    micGet.mockResolvedValue({ granted: false, canAskAgain: true });
    micRequest.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await joinVoiceFromUi('p1', { spaceId: null })).toBe(true);
    expect(store.joinVoiceRoom).toHaveBeenCalled();
    const t = lastToast();
    expect(t?.tone).toBe('warning');
    expect(t?.action?.label).toBe('Settings');
  });

  test('server errors map like the web stage: 403, 409, a message, anything else', async () => {
    const cases: [unknown, string][] = [
      [new ApiError('forbidden', 403), "You don't have permission to join this room."],
      [new ApiError('conflict', 409), 'This room is full.'],
      [new ApiError('LiveKit is unreachable', 502), 'LiveKit is unreachable'],
      [new Error('boom'), 'Could not connect to voice. Try again.'],
      [new store.CallEncryptionUnsupportedError(), "This device can't encrypt calls, so it can't join. Calls are end-to-end encrypted and are never sent unencrypted."],
    ];
    for (const [err, text] of cases) {
      store.joinVoiceRoom.mockRejectedValueOnce(err);
      const onError = jest.fn<(m: string) => void>();
      expect(await joinVoiceFromUi('v1', { spaceId: 's1', onError })).toBe(false);
      expect(onError).toHaveBeenCalledWith(text);
    }
  });

  test('one join at a time', async () => {
    let release!: () => void;
    store.joinVoiceRoom.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const first = joinVoiceFromUi('v1', { spaceId: 's1' });
    await act(async () => {
      await Promise.resolve();
    });
    // The permission check is async; wait until the first join is actually in flight.
    for (let i = 0; i < 10 && !store.joinVoiceRoom.mock.calls.length; i++) await Promise.resolve();
    expect(joiningStore.get()).toBe('v1');
    expect(await joinVoiceFromUi('v2', { spaceId: 's1' })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(store.joinVoiceRoom).toHaveBeenCalledTimes(1);
  });
});

describe('call screen navigation', () => {
  test('an open call screen switches room in place; closing twice pops once', async () => {
    setCallScreenMounted(true);
    await joinVoiceFromUi('v1', { spaceId: 's1' });
    expect(router.push).not.toHaveBeenCalled();
    expect(callViewStore.get().roomId).toBe('v1');
    closeCallScreen();
    closeCallScreen();
    expect(router.back).toHaveBeenCalledTimes(1);
    setCallScreenMounted(false);
    expect(callViewStore.get()).toEqual({ roomId: null, spaceId: null, mounted: 0, closing: false });
  });
});

describe('incoming calls', () => {
  test('accepting stops the ring, opens the conversation and the call, then joins', async () => {
    setVoice('incoming', { roomId: 'p9', startedBy: 'a', since: 1 });
    expect(await acceptIncomingFromUi(true)).toBe(true);
    expect(stopRingtone).toHaveBeenCalled();
    expect(store.acceptIncomingCall).toHaveBeenCalledWith(true);
    const view = shell.view();
    expect(view.kind === 'room' && view.roomId).toBe('p9');
    expect(callViewStore.get().roomId).toBe('p9');
  });

  test('a call that ended while the OS asked for the microphone is not rejoined', async () => {
    setVoice('incoming', { roomId: 'p9', startedBy: 'a', since: 1 });
    micGet.mockImplementationOnce(async () => {
      setVoice('incoming', null);
      return perm;
    });
    expect(await acceptIncomingFromUi(false)).toBe(false);
    expect(store.acceptIncomingCall).not.toHaveBeenCalled();
  });
});
