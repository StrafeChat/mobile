/**
 * Links to rooms and messages (the web's lib/roomLinks, shared with the app): which links the
 * app opens itself (this instance, or another instance's room mirrored here), what they lead
 * to, what "Copy message link" copies, and what tapping one does - the room opens and the
 * message is jumped to, a thread opens on its own screen, and a room that cannot be opened
 * says so instead of doing nothing.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockOpenRoom = jest.fn();
const mockPush = jest.fn();
const mockToast = Object.assign(jest.fn(), { error: jest.fn() });
const mockGetRoom = jest.fn<(id: string) => Promise<unknown>>();
const mockGetThread = jest.fn<(id: string) => Promise<unknown>>();

jest.mock('expo-router', () => ({
  router: { push: mockPush, back: jest.fn(), canGoBack: () => false, canDismiss: () => false, dismissAll: jest.fn() },
}));
jest.mock('@/shell/state', () => ({ openRoom: mockOpenRoom, openNav: jest.fn(), setSelectedSpaceId: jest.fn() }));
jest.mock('@/ui', () => ({ toast: mockToast, showActionSheet: jest.fn() }));
jest.mock('@web/api/rooms', () => ({
  ...jest.requireActual<object>('@web/api/rooms'),
  getRoom: (id: string) => mockGetRoom(id),
}));
jest.mock('@web/api/threads', () => ({
  ...jest.requireActual<object>('@web/api/threads'),
  getThread: (id: string) => mockGetThread(id),
}));

// The app's window.location shim: the signed-in instance's web origin.
const w = ((globalThis as { window?: object }).window ??= globalThis) as { location?: unknown };
Object.defineProperty(w, 'location', {
  configurable: true,
  value: { origin: 'https://chat.example', protocol: 'https:', host: 'chat.example', hostname: 'chat.example', href: 'https://chat.example/', pathname: '/' },
});

// After the mocks and the location.
const { setSpaces } = require('@web/stores/spaces') as typeof import('@web/stores/spaces');
const { setRooms } = require('@web/stores/rooms') as typeof import('@web/stores/rooms');
const { setSpaceMembers } = require('@web/stores/spaceMembers') as typeof import('@web/stores/spaceMembers');
const { setMessages, jumpToMessage } = require('@web/stores/messages') as typeof import('@web/stores/messages');
const { externalLink, setExternalLink } = require('@web/stores/externalLink') as typeof import('@web/stores/externalLink');
const { PermViewChannel } = require('@web/lib/spacePermissions') as typeof import('@web/lib/spacePermissions');
const { findRoomLinkTarget, messageLinkUrl, roomLinkFromUrl } = require('@web/lib/roomLinks') as typeof import('@web/lib/roomLinks');
const { openMessageLink, openRoomLink } = require('../navigation') as typeof import('../navigation');
const { t } = require('@web/i18n/t') as typeof import('@web/i18n/t');
const { ME, member, message, pm, resetStores, role, space, sroom, user } = require('@/data/testing/fixtures') as typeof import('@/data/testing/fixtures');

const jump = jumpToMessage as unknown as jest.Mock<(roomId: string, messageId: string) => Promise<void>>;

const EVERYONE = role('E', 0, PermViewChannel, { name: '@everyone' });
const DENY_VIEW = { role_id: 'E', allow: 0, deny: PermViewChannel, created_at: '', updated_at: '' };

function seed(): void {
  setSpaces({
    spaces: [space('1', [EVERYONE]), space('2', [EVERYONE], { federation: { origin_domain: 'origin.example', origin_id: '77' } })],
    spaceRoomsBySpaceId: {
      1: [
        sroom('10', 3, { name: 'general' }),
        sroom('11', 3, { name: 'staff', permission_overrides: [DENY_VIEW] }),
        sroom('12', 5, { name: 'Section' }),
        sroom('13', 4, { name: 'Lounge' }),
      ],
      2: [sroom('20', 3, { name: 'bridged', federation: { origin_domain: 'origin.example', origin_id: '99' } })],
    },
  });
  setSpaceMembers({ bySpaceId: { 1: [member(ME)], 2: [member(ME)] }, loading: {}, loadedAt: {} });
  setRooms({ rooms: [pm('30', user('200', { username: 'friend', display_name: 'Friend' }))] });
}

beforeEach(() => {
  resetStores();
  seed();
  jest.clearAllMocks();
  jump.mockImplementation(async () => undefined);
  setExternalLink('pendingUrl', null);
});

describe('which links are room links', () => {
  test('this instance: with or without the space, with or without a message', () => {
    expect(roomLinkFromUrl('https://chat.example/spaces/1/rooms/2/3')).toEqual({ roomId: '2', spaceId: '1', messageId: '3' });
    expect(roomLinkFromUrl('https://chat.example/spaces/1/rooms/2')).toEqual({ roomId: '2', spaceId: '1', messageId: null });
    expect(roomLinkFromUrl('https://chat.example/rooms/2/')).toEqual({ roomId: '2', spaceId: null, messageId: null });
    expect(roomLinkFromUrl('https://CHAT.example/rooms/2/3')).toEqual({ roomId: '2', spaceId: null, messageId: '3' });
  });

  test('anything else stays a link: another site, another path, a non-id segment', () => {
    expect(roomLinkFromUrl('https://elsewhere.example/rooms/2')).toBeNull();
    expect(roomLinkFromUrl('https://chat.example/settings')).toBeNull();
    expect(roomLinkFromUrl('https://chat.example/rooms/2/abc')).toBeNull();
    expect(roomLinkFromUrl('https://chat.example/rooms/2/3/4')).toBeNull();
    expect(roomLinkFromUrl('not a url')).toBeNull();
  });

  test("another instance's room mirrored here maps to our copy, message id kept", () => {
    expect(roomLinkFromUrl('https://origin.example/spaces/77/rooms/99/555')).toEqual({ roomId: '20', spaceId: '2', messageId: '555' });
    // Not a room we mirror from there.
    expect(roomLinkFromUrl('https://origin.example/spaces/77/rooms/98')).toBeNull();
    expect(roomLinkFromUrl('https://third.example/spaces/77/rooms/99')).toBeNull();
  });

  test('a mirrored room that maps two ways is not guessed', () => {
    setSpaces('spaceRoomsBySpaceId', '1', (list) => [...list, sroom('21', 3, { federation: { origin_domain: 'origin.example', origin_id: '99' } })]);
    expect(roomLinkFromUrl('https://origin.example/spaces/77/rooms/99')).toBeNull();
  });
});

describe('copying a message link', () => {
  test("this instance's address, with the room's space or as a PM", () => {
    expect(messageLinkUrl('10', '500')).toBe('https://chat.example/spaces/1/rooms/10/500');
    expect(messageLinkUrl('30', '500', null)).toBe('https://chat.example/rooms/30/500');
  });

  test("a federated space's origin, every id the origin's, so any member can open it", () => {
    expect(messageLinkUrl('20', '500', '2')).toBe('https://origin.example/spaces/77/rooms/99/500');
    // ...and it comes back to our copy here.
    expect(roomLinkFromUrl(messageLinkUrl('20', '500', '2'))).toEqual({ roomId: '20', spaceId: '2', messageId: '500' });
  });
});

describe('where a link leads', () => {
  test('a visible space room, found with or without the space in the link', () => {
    expect(findRoomLinkTarget({ roomId: '10', spaceId: '1', messageId: '5' })).toMatchObject({ spaceId: '1', type: 3, name: 'general', messageId: '5' });
    expect(findRoomLinkTarget({ roomId: '10', spaceId: null, messageId: null })).toMatchObject({ spaceId: '1' });
    expect(findRoomLinkTarget({ roomId: '30', spaceId: null, messageId: '5' })).toMatchObject({ spaceId: null, type: 1, name: 'Friend' });
  });

  test('hidden rooms and sections lead nowhere; a voice room has no message to jump to', () => {
    expect(findRoomLinkTarget({ roomId: '11', spaceId: '1', messageId: null })).toBeNull();
    expect(findRoomLinkTarget({ roomId: '12', spaceId: '1', messageId: null })).toBeNull();
    expect(findRoomLinkTarget({ roomId: '13', spaceId: '1', messageId: '5' })).toMatchObject({ type: 4, messageId: null });
  });
});

describe('tapping one', () => {
  test('opens the room in the shell and jumps to the message', async () => {
    setMessages('byRoom', '10', [message('10', '500', '1')]);
    openMessageLink('https://chat.example/spaces/1/rooms/10/500');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockOpenRoom).toHaveBeenCalledWith('10', '1');
    expect(jump).toHaveBeenCalledWith('10', '500');
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  test('a link to a room mirrored here opens our copy instead of the browser', async () => {
    openMessageLink('https://origin.example/spaces/77/rooms/99');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockOpenRoom).toHaveBeenCalledWith('20', '2');
    expect(externalLink.pendingUrl).toBeNull();
  });

  test('a room that does not exist or is hidden says so and opens nothing', async () => {
    mockGetRoom.mockRejectedValue(new Error('404'));
    expect(await openRoomLink({ roomId: '404', spaceId: null, messageId: null })).toBe(false);
    expect(await openRoomLink({ roomId: '11', spaceId: '1', messageId: null })).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith(t('messages.roomLink.unavailableBody'));
    expect(mockOpenRoom).not.toHaveBeenCalled();
    // A hidden room is not even asked about.
    expect(mockGetRoom).toHaveBeenCalledTimes(1);
  });

  test('an archived thread is fetched into its space and opens on its own screen', async () => {
    mockGetThread.mockResolvedValue({ id: '40', type: 6, name: 'old thread', parent_id: '10', space_id: '1', thread: { archived: true } });
    expect(await openRoomLink({ roomId: '40', spaceId: '1', messageId: '600' })).toBe(true);
    expect(mockGetThread).toHaveBeenCalledWith('40');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/thread/[threadId]', params: { threadId: '40', spaceId: '1' } });
    expect(jump).toHaveBeenCalledWith('40', '600');
  });

  test('a message that cannot be loaded or no longer exists is reported after the room opens', async () => {
    jump.mockRejectedValueOnce(new Error('403'));
    await openRoomLink({ roomId: '10', spaceId: '1', messageId: '501' });
    expect(mockOpenRoom).toHaveBeenCalledWith('10', '1');
    expect(mockToast.error).toHaveBeenCalledWith(t('messages.roomLink.messageMissingBody'));

    // Loaded around it, but it is not there (deleted).
    setMessages('byRoom', '10', [message('10', '499', '1')]);
    await openRoomLink({ roomId: '10', spaceId: '1', messageId: '501' });
    expect(mockToast).toHaveBeenCalledWith(t('messages.roomLink.messageMissingTitle'));
  });

  test('other links still go through the leaving-Strafe guard', () => {
    openMessageLink('https://elsewhere.example/rooms/2');
    expect(externalLink.pendingUrl).toBe('https://elsewhere.example/rooms/2');
    expect(mockOpenRoom).not.toHaveBeenCalled();
  });
});
