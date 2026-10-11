/**
 * The notification decision on mobile: the web's rules (web/src/lib/notifications.ts) run
 * through the override, with the app's visibility from AppState and the room on screen from
 * the window shim's location. The stores it reads are replaced with plain objects; the rules
 * themselves (lib/notifications, lib/roomNotify, readState's mention parsing,
 * messageList/utils) are real.
 */
import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AppState } from 'react-native';
import i18next from 'i18next';

const mockAuth = { user: { id: '100', username: 'me' } as { id: string; username: string } | null };
const mockMessages = { byRoom: {} as Record<string, unknown[]> };
const mockRooms = { rooms: [] as Record<string, unknown>[] };
const mockSpaces = { spaces: [] as Record<string, unknown>[], spaceRoomsBySpaceId: {} as Record<string, Record<string, unknown>[]> };
const mockSpaceMembers = { bySpaceId: {} as Record<string, Record<string, unknown>[]> };
const mockPrefs = {
  desktop: true,
  preview: true,
  whileFocused: false,
  sounds: true,
  volume: 0.6,
  spaceMode: 'mentions' as 'all' | 'mentions' | 'none',
  pmMode: 'all' as 'all' | 'none',
};
const mockPlaySound = jest.fn();
const mockShow = jest.fn((_opts: { title: string; body?: string; tag?: string; onClick?: () => void }) => true);
const mockDnd = jest.fn(() => false);

jest.mock('@web/stores/auth', () => ({ auth: mockAuth }));
jest.mock('@web/stores/messages', () => ({ messages: mockMessages }));
jest.mock('@web/stores/rooms', () => ({
  rooms: mockRooms,
  roomDisplayName: (r: { name?: string }) => r.name ?? 'Group',
  patchRoomNotifySettings: jest.fn(),
}));
jest.mock('@web/stores/spaces', () => ({ spaces: mockSpaces, patchSpaceRoomNotifySettings: jest.fn() }));
jest.mock('@web/stores/spaceMembers', () => ({ spaceMembers: mockSpaceMembers }));
jest.mock('@web/stores/presence', () => ({ notificationsSuppressedByStatus: () => mockDnd() }));
jest.mock('@web/stores/notificationPrefs', () => ({
  notificationPrefs: mockPrefs,
  playNotificationSound: (v: number) => mockPlaySound(v),
  showDesktopNotification: (o: { title: string; body?: string; tag?: string; onClick?: () => void }) => mockShow(o),
}));
jest.mock('@web/services/stargate/client', () => ({ onStargateEvent: () => () => undefined }));
jest.mock('@web/api/rooms', () => ({ ackRoom: jest.fn(), setRoomNotifySettings: jest.fn() }));
// The web i18n barrel re-exports Solid components; the mobile one (Metro does this swap).
jest.mock('@web/i18n/index', () => jest.requireActual('../i18n/index'));

// The app's window shim: window events, CustomEvent, and location.pathname kept by the shell.
// Required (not imported) so it and the module under test load after the mock state above.
const { setLocationPath } = require('../../shims/window') as typeof import('../../shims/window');
const { maybeNotifyMessage, onNavigateRequest, requestNavigate } = require('./notifications') as typeof import('./notifications');

const g = globalThis as unknown as { document?: unknown };

beforeAll(async () => {
  // Just the strings these rules use.
  await i18next.init({
    lng: 'en',
    initAsync: false,
    resources: { en: { translation: { notifications: { newMessage: 'New message' }, common: { someone: 'Someone' } } } },
  });
});

function setAppState(state: 'active' | 'background' | 'inactive'): void {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true, writable: true });
}

function message(id: string, senderId: string, text: string, extra: Record<string, unknown> = {}) {
  return { id, sender_id: senderId, plaintext: text, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { id: '100', username: 'me' };
  Object.assign(mockPrefs, { desktop: true, preview: true, whileFocused: false, sounds: true, spaceMode: 'mentions', pmMode: 'all' });
  mockDnd.mockReturnValue(false);
  mockRooms.rooms = [
    { id: '1', type: 1, name: 'pm', participants: [{ id: '200', username: 'alice', display_name: 'Alice' }] },
    { id: '2', type: 2, name: 'Friends', recipients: [{}, {}], participants: [{ id: '200', username: 'alice' }] },
  ];
  mockSpaces.spaces = [{ id: '50', name: 'Home Space', default_message_notifications: 0 }];
  mockSpaces.spaceRoomsBySpaceId = { '50': [{ id: '3', name: 'general', type: 3 }] };
  mockSpaceMembers.bySpaceId = { '50': [{ id: '300', username: 'bob', display_name: 'Bob', roles: [] }, { id: '100', roles: ['9'] }] };
  mockMessages.byRoom = {};
  setLocationPath('/');
  setAppState('active');
});

describe('maybeNotifyMessage (mobile)', () => {
  it('notifies a PM with sound, tagged per room, and leaves no global document behind', () => {
    mockMessages.byRoom['1'] = [message('900', '200', 'hello there')];
    maybeNotifyMessage('1', '900');
    expect(mockPlaySound).toHaveBeenCalledWith(0.6);
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow.mock.calls[0]![0]).toMatchObject({ title: 'Alice', body: 'hello there', tag: 'room:1' });
    expect(g.document).toBeUndefined();
  });

  it('skips the room on screen while the app is in front, but not once it is backgrounded', () => {
    mockMessages.byRoom['1'] = [message('900', '200', 'hi')];
    setLocationPath('/rooms/1');
    maybeNotifyMessage('1', '900');
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockPlaySound).not.toHaveBeenCalled();

    setAppState('background');
    maybeNotifyMessage('1', '900');
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('notifies the room on screen when "while focused" is on', () => {
    mockPrefs.whileFocused = true;
    mockMessages.byRoom['1'] = [message('900', '200', 'hi')];
    setLocationPath('/rooms/1');
    maybeNotifyMessage('1', '900');
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('never notifies under Do Not Disturb, for your own messages, or for system messages', () => {
    mockMessages.byRoom['1'] = [
      message('900', '200', 'hi'),
      message('901', '100', 'mine'),
      message('902', '200', '', { system_type: 'pin' }),
    ];
    mockDnd.mockReturnValue(true);
    maybeNotifyMessage('1', '900');
    mockDnd.mockReturnValue(false);
    maybeNotifyMessage('1', '901');
    maybeNotifyMessage('1', '902');
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockPlaySound).not.toHaveBeenCalled();
  });

  it('respects a muted room and the room notify-mode override', () => {
    mockRooms.rooms[0]!.muted = true;
    mockMessages.byRoom['1'] = [message('900', '200', 'hi')];
    maybeNotifyMessage('1', '900');
    expect(mockShow).not.toHaveBeenCalled();

    mockRooms.rooms[0]!.muted = false;
    mockRooms.rooms[0]!.notify_mode = 3; // nothing
    maybeNotifyMessage('1', '900');
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('uses the space rules for a space channel - mentions only by default', () => {
    // The channel is also in the rooms store (for its mute state); it must not take PM rules.
    mockRooms.rooms.push({ id: '3', type: 3, name: 'general' });
    mockMessages.byRoom['3'] = [message('900', '300', 'just chatting'), message('901', '300', 'hey <@100>')];
    maybeNotifyMessage('3', '900');
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockPlaySound).not.toHaveBeenCalled();

    maybeNotifyMessage('3', '901');
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow.mock.calls[0]![0]).toMatchObject({ title: 'Bob (#general · Home Space)', tag: 'room:3' });
  });

  it('counts a mention of one of my roles', () => {
    mockMessages.byRoom['3'] = [message('900', '300', 'ping <@&9>')];
    maybeNotifyMessage('3', '900');
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('hides the preview text when previews are off', () => {
    mockPrefs.preview = false;
    mockMessages.byRoom['1'] = [message('900', '200', 'secret')];
    maybeNotifyMessage('1', '900');
    expect(mockShow.mock.calls[0]![0].body).toBe('New message');
  });

  it('plays only the sound when system notifications are off', () => {
    mockPrefs.desktop = false;
    mockMessages.byRoom['1'] = [message('900', '200', 'hi')];
    maybeNotifyMessage('1', '900');
    expect(mockPlaySound).toHaveBeenCalledTimes(1);
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('routes a tap through the navigate event without a DOM', () => {
    const seen: string[] = [];
    const off = onNavigateRequest((p) => seen.push(p));
    mockMessages.byRoom['3'] = [message('900', '300', 'hey <@100>')];
    maybeNotifyMessage('3', '900');
    mockShow.mock.calls[0]![0].onClick?.();
    requestNavigate('/rooms/1');
    off();
    requestNavigate('/rooms/2');
    expect(seen).toEqual(['/spaces/50/rooms/3', '/rooms/1']);
  });

  it('warns rather than throws when the decision fails', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockMessages.byRoom['1'] = [message('900', '200', 'hi')];
    mockShow.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => maybeNotifyMessage('1', '900')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(g.document).toBeUndefined();
    warn.mockRestore();
  });
});
