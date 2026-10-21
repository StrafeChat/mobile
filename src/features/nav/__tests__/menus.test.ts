/**
 * The long-press menus: the web's items and gates, evaluated against the real stores, and the
 * flows behind them (confirm first, API, store update, the shell moving off a room that went
 * away, rollback when a status save fails).
 */
import './navTestSetup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { setSpaces, spaces } from '@web/stores/spaces';
import { setRooms, rooms } from '@web/stores/rooms';
import { setReadState } from '@web/stores/readState';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { presence, setPresence } from '@web/stores/presence';
import { confirmDialogState, settleConfirmDialog } from '@web/stores/confirmDialog';
import {
  PermCreateInvite,
  PermManageRooms,
  PermSendMessages,
  PermViewChannel,
} from '@web/lib/spacePermissions';
import { ME, group, member, pm, resetStores, role, space, sroom, user } from '@/data/testing/fixtures';
import { closeView, openNav, openRoom, setSelectedSpaceId, setShellFocused, shell } from '@/shell/state';
import { cleanEntries, isActionItem, runActionItem, type ActionItem, type ActionSheetEntry } from '@/ui';

import * as spacesApi from '@web/api/spaces';
import * as usersApi from '@web/api/users';
import * as roomsApi from '@web/api/rooms';
import { channelMenuEntries, pmMenuEntries, sectionMenuEntries, spaceMenuEntries, threadMenuEntries } from '../menus';
import { deleteRoomFlow, leaveGroupFlow, leaveSpaceFlow } from '../actions';
import { moveRoomStep } from '../reorder';
import { setOwnCustomStatus, setOwnStatus } from '../you/ownPresence';

// navTestSetup stands in for the other feature areas (links.ts).
const links = jest.requireMock('../links') as { openSpaceProfile: jest.Mock };

jest.mock('@web/api/spaces', () => ({
  ...jest.requireActual<object>('@web/api/spaces'),
  leaveSpace: jest.fn(async () => undefined),
  deleteSpaceRoom: jest.fn(async () => undefined),
  ackAllSpaceRooms: jest.fn(async () => undefined),
  reorderSpaceRooms: jest.fn(async () => undefined),
  moveSpaceChannel: jest.fn(async () => undefined),
  getSpaceRooms: jest.fn(async () => []),
}));
jest.mock('@web/api/users', () => ({
  ...jest.requireActual<object>('@web/api/users'),
  patchMe: jest.fn(async () => ({})),
}));
jest.mock('@web/api/rooms', () => ({
  ...jest.requireActual<object>('@web/api/rooms'),
  removeRoomParticipant: jest.fn(async () => undefined),
}));

const EVERYONE = role('ev', 0, PermViewChannel | PermSendMessages, { name: '@everyone' });
const MANAGER = role('mgr', 5, PermManageRooms | PermCreateInvite, { name: 'Manager' });

function keys(entries: readonly ActionSheetEntry[]): string[] {
  return cleanEntries(entries).map((e) => (e === 'separator' ? '---' : isActionItem(e) ? (e.key ?? e.label) : `#${e.section}`));
}

function item(entries: readonly ActionSheetEntry[], key: string): ActionItem {
  const found = cleanEntries(entries).find((e) => isActionItem(e) && e.key === key);
  if (!found || !isActionItem(found)) throw new Error(`no item ${key}`);
  return found;
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function seedSpace(opts: { owner?: boolean; manager?: boolean } = {}) {
  setSpaces({
    spaces: [space('s1', [EVERYONE, MANAGER], { owner_id: opts.owner ? ME : 'owner', name: 'Garden' })],
    spaceRoomsBySpaceId: {
      s1: [
        sroom('sec', 5, { position: 1, name: 'Text rooms' }),
        sroom('t1', 3, { position: 1, parent_id: 'sec', last_message_id: '50', last_read_message_id: '40' }),
        sroom('t2', 3, { position: 2, parent_id: 'sec', muted: true }),
        sroom('top', 3, { position: 1 }),
        sroom('th', 6, { parent_id: 't1', last_message_id: '9', thread: { joined: true } as never }),
      ],
    },
  });
  setSpaceMembers({ bySpaceId: { s1: [member(ME, opts.manager ? ['mgr'] : [])] }, loading: {}, loadedAt: {} });
  setReadState({ byRoom: { t1: { lastReadMessageId: '40', mentionCount: 1 } } });
}

beforeEach(() => {
  resetStores();
  jest.clearAllMocks();
  closeView();
  setSelectedSpaceId(null);
});

afterEach(() => {
  settleConfirmDialog(false);
});

describe('space menu', () => {
  test('a plain member: their space profile, mark read, copy id, leave on the rail; report and leave in the header', () => {
    seedSpace();
    expect(keys(spaceMenuEntries('s1', 'rail'))).toEqual(['space-profile', 'mark-read', 'copy-id', 'leave']);
    expect(keys(spaceMenuEntries('s1', 'header'))).toEqual(['space-profile', '---', 'mark-read', 'copy-id', '---', 'report', 'leave']);
    expect(item(spaceMenuEntries('s1', 'rail'), 'mark-read').disabled).toBe(false);
  });

  test('the owner can invite and manage, and never leaves', () => {
    seedSpace({ owner: true });
    expect(keys(spaceMenuEntries('s1', 'rail'))).toEqual(['invite', 'space-profile', 'settings', 'mark-read', 'copy-id']);
    expect(keys(spaceMenuEntries('s1', 'header'))).toEqual(['invite', 'space-profile', 'settings', 'create-room', 'create-section', '---', 'mark-read', 'copy-id']);
  });

  test('"Edit Space Profile" opens Settings -> Space Profiles on that space, from both menus', () => {
    seedSpace();
    for (const variant of ['rail', 'header'] as const) {
      links.openSpaceProfile.mockClear();
      const entry = item(spaceMenuEntries('s1', variant), 'space-profile');
      expect(entry.icon).toBe('fa-id-badge');
      runActionItem(entry);
      expect(links.openSpaceProfile).toHaveBeenCalledWith('s1');
    }
  });

  test('"Mark space as read" is greyed out with nothing unread', () => {
    seedSpace();
    setSpaces('spaceRoomsBySpaceId', 's1', (list) => list.map((r) => ({ ...r, last_message_id: undefined })));
    setReadState({ byRoom: {} });
    expect(item(spaceMenuEntries('s1', 'rail'), 'mark-read').disabled).toBe(true);
  });

  test('leaving confirms, calls the API, drops the space and moves off its room', async () => {
    seedSpace();
    setSelectedSpaceId('s1');
    openRoom('t1', 's1');
    const done = leaveSpaceFlow('s1');
    await flush();
    expect(confirmDialogState.pending?.options.title).toBe('Leave space');
    settleConfirmDialog(true);
    expect(await done).toBe(true);
    expect(spacesApi.leaveSpace).toHaveBeenCalledWith('s1');
    expect(spaces.spaces.find((s) => s.id === 's1')).toBeUndefined();
    expect(shell.selectedSpaceId()).toBeNull();
    expect(shell.view().kind).toBe('empty');
  });

  test('cancelling the confirm leaves nothing', async () => {
    seedSpace();
    const done = leaveSpaceFlow('s1');
    await flush();
    settleConfirmDialog(false);
    expect(await done).toBe(false);
    expect(spacesApi.leaveSpace).not.toHaveBeenCalled();
  });
});

describe('room, section and thread menus', () => {
  test('a manager gets settings, reordering and delete; a member does not', () => {
    seedSpace({ manager: true });
    const mgr = keys(channelMenuEntries('s1', 't1'));
    expect(mgr).toEqual(['invite', 'settings', 'mark-read', 'mute', 'notify', 'copy-link', 'copy-id', '---', 'move-down', 'move-section', '---', 'delete']);
    seedSpace();
    expect(keys(channelMenuEntries('s1', 't1'))).toEqual(['mark-read', 'mute', 'notify', 'copy-link', 'copy-id']);
  });

  test('a muted room offers Unmute; mute takes a duration', () => {
    seedSpace();
    expect(keys(channelMenuEntries('s1', 't2'))).toContain('unmute');
    const mute = item(channelMenuEntries('s1', 't1'), 'mute');
    const durations = typeof mute.submenu === 'function' ? mute.submenu() : mute.submenu;
    expect(keys(durations ?? [])).toEqual(['mute-15m', 'mute-1h', 'mute-8h', 'mute-24h', 'mute-forever']);
  });

  test('section menu: create in it, mark read, mute all, settings, copy, delete', () => {
    seedSpace({ manager: true });
    // The only section: nowhere to move it, so no move items.
    expect(keys(sectionMenuEntries('s1', 'sec'))).toEqual(['create-room', 'mark-read', 'mute', 'settings', 'copy-id', '---', 'delete']);
    seedSpace();
    expect(keys(sectionMenuEntries('s1', 'sec'))).toEqual(['mark-read', 'mute', 'copy-id']);
  });

  test('thread menu: leave a joined thread, mark read, mute, copy', () => {
    seedSpace();
    expect(keys(threadMenuEntries('s1', 'th'))).toEqual(['leave', 'mark-read', 'mute', 'notify', 'copy-id']);
  });

  test('deleting the open room asks, deletes, and lands in the next text room', async () => {
    seedSpace({ manager: true });
    openRoom('t1', 's1');
    const done = deleteRoomFlow('s1', 't1');
    await flush();
    settleConfirmDialog(true);
    await done;
    expect(spacesApi.deleteSpaceRoom).toHaveBeenCalledWith('s1', 't1');
    expect(spaces.spaceRoomsBySpaceId.s1!.some((r) => r.id === 't1')).toBe(false);
    const v = shell.view();
    expect(v.kind === 'room' && v.roomId).toBe('top');
  });

  test('move down sends the scope’s whole new order', async () => {
    seedSpace({ manager: true });
    await moveRoomStep('s1', 't1', 1);
    expect(spacesApi.reorderSpaceRooms).toHaveBeenCalledWith('s1', { scope: 'channels', parent_section_id: 'sec', room_ids: ['t2', 't1'] });
  });
});

describe('conversation menu', () => {
  test('a group can be left (after a confirm); a 1:1 offers the profile', async () => {
    setRooms({ rooms: [group('g', [user('a'), user('b')], { name: 'Pals' }), pm('p', user('a'))], loading: false, hydrated: true });
    expect(keys(pmMenuEntries('g'))).toEqual(['mute', 'notify', 'leave', 'copy-id']);
    expect(keys(pmMenuEntries('p'))).toEqual(['profile', 'mute', 'notify', 'copy-id']);
    openRoom('g', null);
    const done = leaveGroupFlow('g');
    await flush();
    settleConfirmDialog(true);
    await done;
    expect(roomsApi.removeRoomParticipant).toHaveBeenCalledWith('g', ME);
    expect(rooms.rooms.some((r) => r.id === 'g')).toBe(false);
    expect(shell.view().kind).toBe('empty');
  });
});

describe('the selected conversation', () => {
  afterEach(() => {
    setShellFocused(false);
  });

  test('can be marked as read once the rails cover it, not while it is on screen', () => {
    setRooms({ rooms: [pm('p', user('a'), { last_message_id: '20', last_read_message_id: '10' })], loading: false, hydrated: true });
    setReadState({ byRoom: { p: { lastReadMessageId: '10', mentionCount: 0 } } });
    setShellFocused(true); // SwipeShell's to keep: the shell is the screen in front
    openRoom('p', null);
    expect(keys(pmMenuEntries('p'))).not.toContain('mark-read');
    openNav();
    expect(keys(pmMenuEntries('p'))).toContain('mark-read');
  });
});

describe('own presence', () => {
  test('a status change is optimistic and rolls back when the save fails', async () => {
    setPresence({ byUser: { [ME]: { status: 'online', custom_status: 'hi' } } });
    (usersApi.patchMe as jest.Mock).mockImplementationOnce(async () => {
      expect(presence.byUser[ME]?.status).toBe('dnd');
      throw new Error('nope');
    });
    expect(await setOwnStatus('dnd')).toBe(false);
    expect(presence.byUser[ME]).toEqual({ status: 'online', custom_status: 'hi' });
  });

  test('a custom status saves trimmed, clears with empty text, and rolls back on failure', async () => {
    setPresence({ byUser: { [ME]: { status: 'idle' } } });
    expect(await setOwnCustomStatus('  at lunch  ')).toBe(true);
    expect(usersApi.patchMe).toHaveBeenLastCalledWith({ presence: { custom_status: 'at lunch' } });
    expect(presence.byUser[ME]).toEqual({ status: 'idle', custom_status: 'at lunch' });
    (usersApi.patchMe as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('nope');
    });
    expect(await setOwnCustomStatus('')).toBe(false);
    expect(presence.byUser[ME]?.custom_status).toBe('at lunch');
  });

  test('clearing sends an empty custom status (a missing field leaves the old one on the server)', async () => {
    setPresence({ byUser: { [ME]: { status: 'online', custom_status: 'busy' } } });
    expect(await setOwnCustomStatus('   ')).toBe(true);
    expect(usersApi.patchMe).toHaveBeenLastCalledWith({ presence: { custom_status: '' } });
    expect(presence.byUser[ME]?.custom_status).toBeUndefined();
  });
});
