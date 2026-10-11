/**
 * The voice UI through React: the dock, the call screen (tiles, spotlight, banners, gates,
 * controls, push-to-talk, joining), the incoming-call screen, the per-user sheet and the
 * keep-awake host - against a Solid stand-in of the voice store.
 */
import '@/ui/__tests__/setup';
import './voiceMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { reconcile } from 'solid-js/store';
import { router } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { VoiceState } from '@web/api/voice';
import * as voiceStore from '@web/stores/voice';
import { setVoice, voice } from '@web/stores/voice';
import { setVoiceSettings } from '@web/stores/voiceSettings';
import { voicePermsFor } from '@web/lib/voice/perms';
import { setPushToTalkHeld } from '@/platform/voice';
import { UiProvider, closeActionSheet } from '@/ui';
import { CallScreen } from '../CallScreen';
import { VoiceDock } from '../VoiceDock';
import { VoiceHosts } from '../VoiceHosts';
import { closeVoiceStats, closeVoiceUserSheet, openVoiceUserSheet, toggleVoiceStats, voiceUserSheetStore } from '../sheets';
import { RoomCallBanner } from '../RoomCallBanner';
import { VoiceUserRow } from '../VoiceUserRow';
import { callViewStore, setCallScreenMounted } from '../callView';
import { joiningStore } from '../join';

 
const { setRooms } = require('@web/stores/rooms') as { setRooms: (p: object) => void };
const { setSpaces } = require('@web/stores/spaces') as { setSpaces: (p: object) => void };
const { setInstance } = require('@web/stores/instance') as { setInstance: (p: object) => void };
 

const store = voiceStore as unknown as Record<string, jest.Mock> & { __idleSession: typeof voice.session };

function st(uid: string, over: Record<string, unknown> = {}): VoiceState {
  return ({
    user_id: uid,
    room_id: 'v1',
    session_id: `s-${uid}`,
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    self_video: false,
    self_stream: false,
    suppress: false,
    priority_speaker: false,
    connected: true,
    joined_at: `2026-10-01T00:00:0${uid === 'me' ? 0 : uid.charCodeAt(0) % 10}Z`,
    user: { id: uid, username: uid, display_name: uid === 'me' ? 'Me' : uid.toUpperCase() },
    ...over,
  }) as unknown as VoiceState;
}

function connect(roomId = 'v1', spaceId: string | null = 's1', over: Partial<typeof voice.session> = {}) {
  setVoice('session', { ...store.__idleSession, roomId, spaceId, status: 'connected', encrypted: true, quality: 'excellent', ...over });
}

async function layoutStage(width = 400, height = 600) {
  await fireEvent(screen.getByTestId('voice-stage'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  setInstance({ voiceEnabled: true });
  setVoice('session', { ...store.__idleSession });
  // Store setters merge: reconcile to really empty the maps between tests.
  setVoice('byRoom', reconcile({}));
  setVoice('calls', reconcile({}));
  setVoice('incoming', null);
  setVoice('speaking', reconcile({}));
  setVoice('media', reconcile({}));
  setVoice('focus', null);
  setVoice('stageVisible', false);
  setVoiceSettings({ inputMode: 'vad' });
  setSpaces({ spaces: [{ id: 's1', name: 'Space', owner_id: 'owner' }], spaceRoomsBySpaceId: { s1: [{ id: 'v1', name: 'Lounge', type: 4 }, { id: 'v2', name: 'Games', type: 4 }] } });
  setRooms({ rooms: [{ id: 'p1', type: 1, participants: [{ id: 'me', username: 'me' }, { id: 'ada', username: 'ada', display_name: 'Ada' }] }] });
  (voicePermsFor as jest.Mock).mockImplementation(() => ({ connect: true, speak: true, video: true, muteMembers: false, deafenMembers: false, moveMembers: false, vad: true, priority: false }));
  joiningStore.set(null);
  while (callViewStore.get().mounted > 0) setCallScreenMounted(false);
});

afterEach(async () => {
  await act(async () => {
    closeActionSheet();
    closeVoiceUserSheet();
    closeVoiceStats();
  });
});

describe('VoiceDock', () => {
  test('nothing while idle; status, room and controls while in a call', async () => {
    const { rerender } = await render(<VoiceDock />);
    expect(screen.queryByTestId('voice-dock')).toBeNull();

    await act(async () => {
      setVoice('byRoom', { v1: [st('me'), st('b')] });
      connect();
    });
    await rerender(<VoiceDock />);
    expect(screen.getByText('Voice connected')).toBeTruthy();
    expect(screen.getByText(/Lounge/)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Mute'));
    expect(store.toggleMute).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByLabelText('Disconnect'));
    expect(store.leaveVoiceRoom).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('voice-dock-open'));
    expect(router.push).toHaveBeenCalledWith('/call');
  });

  test('steps aside while the call stage is on screen; mute is locked under a server mute', async () => {
    await act(async () => connect('v1', 's1', { serverMute: true, status: 'connecting' }));
    await render(<VoiceDock />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.getByLabelText('Unmute')).toBeDisabled();
    await act(async () => setVoice('stageVisible', true));
    expect(screen.queryByTestId('voice-dock')).toBeNull();
  });
});

describe('CallScreen', () => {
  test('before joining: who is there and Join, which joins through joinVoiceFromUi', async () => {
    await act(async () => setVoice('byRoom', { v1: [st('b')] }));
    await render(
      <UiProvider>
        <CallScreen roomId="v1" spaceId="s1" />
      </UiProvider>,
    );
    await layoutStage();
    expect(screen.getByText('Lounge')).toBeTruthy();
    expect(screen.getByTestId('voice-tile-b')).toBeTruthy();
    await fireEvent.press(screen.getByText('Join voice'));
    expect(store.joinVoiceRoom).toHaveBeenCalledWith('v1', { video: false });
    expect(screen.getByText('Join with video')).toBeTruthy();
  });

  test('without Connect the Join buttons are disabled and say why', async () => {
    (voicePermsFor as jest.Mock).mockImplementation(() => ({ connect: false, video: false }));
    await render(
      <UiProvider>
        <CallScreen roomId="v1" spaceId="s1" />
      </UiProvider>,
    );
    expect(screen.getByTestId('voice-join')).toBeDisabled();
    expect(screen.queryByText('Join with video')).toBeNull();
    expect(screen.getByText("You don't have permission to join this room.")).toBeTruthy();
    expect(screen.getByText('No one is here yet. Join to start talking.')).toBeTruthy();
  });

  test('connected: tiles, the key-wait banner, spotlight on tap, controls, and leaving closes it', async () => {
    await act(async () => {
      setVoice('byRoom', { v1: [st('me'), st('b', { self_mute: true }), st('c', { mute: true })] });
      connect('v1', 's1', { keyed: ['me.s-me', 'b.s-b'] });
    });
    await render(
      <UiProvider>
        <CallScreen />
      </UiProvider>,
    );
    await layoutStage();
    expect(voice.stageVisible).toBe(true);
    expect(screen.getByText('Waiting for encryption keys from C…')).toBeTruthy();
    expect(screen.getByText('End-to-end encrypted')).toBeTruthy();
    // b muted themselves; c was muted by a moderator.
    expect(screen.getByLabelText(/^B, Muted$/)).toBeTruthy();
    expect(screen.getByLabelText(/^C, Muted by a moderator$/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('voice-tile-b'));
    expect(store.setVoiceFocus).toHaveBeenCalledWith('b');

    await fireEvent.press(screen.getByTestId('voice-mute'));
    expect(store.toggleMute).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('voice-leave'));
    expect(store.leaveVoiceRoom).toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  test('server mute and deafen lock their buttons and explain', async () => {
    await act(async () => {
      setVoice('byRoom', { v1: [st('me', { mute: true, deaf: true })] });
      connect('v1', 's1', { serverMute: true, serverDeaf: true });
    });
    await render(
      <UiProvider>
        <CallScreen />
      </UiProvider>,
    );
    expect(screen.getByTestId('voice-mute')).toBeDisabled();
    expect(screen.getByTestId('voice-deafen')).toBeDisabled();
    expect(screen.getByText('A moderator deafened you.')).toBeTruthy();
  });

  test('push to talk shows a hold button that transmits only while held', async () => {
    await act(async () => {
      setVoiceSettings({ inputMode: 'ptt' });
      setVoice('byRoom', { v1: [st('me')] });
      connect();
    });
    await render(
      <UiProvider>
        <CallScreen />
      </UiProvider>,
    );
    const ptt = screen.getByTestId('voice-ptt');
    await fireEvent(ptt, 'pressIn');
    expect(setPushToTalkHeld).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('Talking…')).toBeTruthy();
    await fireEvent(ptt, 'pressOut');
    expect(setPushToTalkHeld).toHaveBeenLastCalledWith(false);
  });

  test('a PM call offers ring again for people not in it, in the more sheet', async () => {
    await act(async () => {
      setVoice('byRoom', { p1: [st('me', { room_id: 'p1' })] });
      setVoice('calls', { p1: { room_id: 'p1', started_by: 'me', started_at: '', ringing: ['ada'] } });
      connect('p1', null);
    });
    await render(
      <UiProvider>
        <CallScreen />
      </UiProvider>,
    );
    expect(screen.getByText('Ringing Ada…')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('voice-more'));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Ring again' }));
    expect(store.ringMembers).toHaveBeenCalledWith('p1', ['ada']);
  });
});

describe('VoiceHosts', () => {
  test('the incoming call screen: who is calling, decline and accept', async () => {
    await act(async () => setVoice('incoming', { roomId: 'p1', startedBy: 'ada', since: 1 }));
    await render(
      <UiProvider>
        <VoiceHosts />
      </UiProvider>,
    );
    expect(screen.getByText('Ada is calling you')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('voice-incoming-decline'));
    expect(store.declineIncomingCall).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('voice-incoming-accept'));
    // Permission check, then the store's accept.
    for (let i = 0; i < 10 && !store.acceptIncomingCall.mock.calls.length; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(store.acceptIncomingCall).toHaveBeenCalledWith(false);
  });

  test('keeps the screen awake for the length of a call', async () => {
    await render(
      <UiProvider>
        <VoiceHosts />
      </UiProvider>,
    );
    expect(activateKeepAwakeAsync).not.toHaveBeenCalled();
    await act(async () => connect());
    expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    await act(async () => setVoice('session', { ...store.__idleSession }));
    expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
  });

  test('the user sheet: volume and mute for me for others, moderation with the permission', async () => {
    (voicePermsFor as jest.Mock).mockImplementation(() => ({ connect: true, video: true, muteMembers: true, deafenMembers: false, moveMembers: true }));
    await act(async () => {
      setVoice('byRoom', { v1: [st('me'), st('b')] });
      connect();
    });
    await render(
      <UiProvider>
        <VoiceHosts />
      </UiProvider>,
    );
    await act(async () => openVoiceUserSheet({ userId: 'b', roomId: 'v1', spaceId: 's1' }));
    expect(screen.getByLabelText('User volume')).toBeTruthy();
    expect(screen.getByText('Mute for me')).toBeTruthy();
    expect(screen.queryByText('Server deafen')).toBeNull();
    await fireEvent.press(screen.getByText('Mute for me'));
    expect(store.setUserLocalMuted).toHaveBeenCalledWith('b', true);
    await fireEvent.press(screen.getByText('Server mute'));
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(store.serverMute).toHaveBeenCalledWith('s1', 'b', true);
    // Move offers the space's other voice rooms.
    await act(async () => openVoiceUserSheet({ userId: 'b', roomId: 'v1', spaceId: 's1' }));
    await fireEvent.press(screen.getByText('Move to'));
    await fireEvent.press(screen.getByText('Games'));
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(store.moveMember).toHaveBeenCalledWith('s1', 'b', 'v2');
  });

  test('nobody but the owner moderates the owner; your own sheet has no volume', async () => {
    (voicePermsFor as jest.Mock).mockImplementation(() => ({ connect: true, muteMembers: true, deafenMembers: true, moveMembers: true }));
    await act(async () => {
      setVoice('byRoom', { v1: [st('me'), st('owner')] });
      connect();
    });
    await render(
      <UiProvider>
        <VoiceHosts />
      </UiProvider>,
    );
    await act(async () => openVoiceUserSheet({ userId: 'owner', roomId: 'v1', spaceId: 's1' }));
    expect(screen.getByLabelText('User volume')).toBeTruthy();
    expect(screen.queryByText('Server mute')).toBeNull();
    await act(async () => openVoiceUserSheet({ userId: 'me', roomId: 'v1', spaceId: 's1' }));
    expect(screen.queryByLabelText('User volume')).toBeNull();
    expect(screen.getByText('View profile')).toBeTruthy();
  });
});

describe('voice statistics', () => {
  test('polls readVoiceStats while open and lays out the reading', async () => {
    store.readVoiceStats.mockImplementation(async () => ({
      at: 1,
      transport: { protocol: 'udp', relay: true },
      rttMs: 42,
      outbound: { kbps: 48, lossPct: 0.5 },
      participants: [{ identity: 'b.s-b', microphone: { lossPct: 1.25, jitterMs: 12, concealedPct: 0, kbps: 40 } }],
    }));
    await act(async () => {
      setVoice('byRoom', { v1: [st('me'), st('b')] });
      connect();
    });
    await render(
      <UiProvider>
        <VoiceHosts />
      </UiProvider>,
    );
    await act(async () => toggleVoiceStats());
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(store.readVoiceStats).toHaveBeenCalled();
    expect(screen.getByText('UDP · relay')).toBeTruthy();
    expect(screen.getByText('42 ms')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText('loss 1.3% · jitter 12 ms · concealed 0.0% · 40 kbps')).toBeTruthy();
    // Hanging up closes it.
    await act(async () => setVoice('session', { ...store.__idleSession }));
    expect(screen.queryByText('UDP · relay')).toBeNull();
  });
});

describe('room list and conversation pieces', () => {
  test('a voice row shows the badges, opens the profile on tap and the voice sheet on long-press', async () => {
    await act(async () => {
      setVoice('byRoom', { v1: [st('b', { self_stream: true, mute: true })] });
      setVoice('speaking', { b: true });
    });
    await render(<VoiceUserRow roomId="v1" spaceId="s1" userId="b" />);
    const row = screen.getByTestId('voice-user-row-b');
    expect(row).toHaveProp('accessibilityLabel', 'B, Speaking, Sharing their screen, Muted by a moderator');
    expect(screen.getByText('LIVE')).toBeTruthy();
    await fireEvent(row, 'longPress');
    expect(voiceUserSheetStore.get()).toEqual({ userId: 'b', roomId: 'v1', spaceId: 's1' });
  });

  test('a PM shows "Call in progress" with Join, or "You are in this call" with Open', async () => {
    const { rerender } = await render(<RoomCallBanner roomId="p1" />);
    expect(screen.queryByTestId('voice-room-call-banner')).toBeNull();
    await act(async () => setVoice('byRoom', { p1: [st('ada', { room_id: 'p1' })] }));
    await rerender(<RoomCallBanner roomId="p1" />);
    expect(screen.getByText('Call in progress')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('voice-room-call-join'));
    for (let i = 0; i < 5 && !store.joinVoiceRoom.mock.calls.length; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(store.joinVoiceRoom).toHaveBeenCalledWith('p1', { video: false });
    await act(async () => connect('p1', null));
    expect(screen.getByText("You're in this call")).toBeTruthy();
  });
});
