/**
 * Nicknames and space profiles in the room area: the menu entries (who may change whose
 * nickname, when the moderator reset shows - the web's buildSpaceModerationItems, given
 * nicknameSheet's fields), their place in the member drawer's and the message author's menus,
 * the "Change Nickname" sheet (with the server's limits checked as you type), the web's reset
 * flow, and the profile sheet's own actions and global-name line.
 */
import './roomTestSetup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ApiError } from '@web/api/ApiError';
import { t } from '@web/i18n/t';
import { PermKickMembers, PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import { confirmResetSpaceProfile } from '@web/lib/userContextMenu';
import { confirmDialogState, settleConfirmDialog } from '@web/stores/confirmDialog';
import { setSpaces } from '@web/stores/spaces';
import { setSpaceMembers, spaceMembers } from '@web/stores/spaceMembers';
import { ME, member, resetStores, role, space } from '@/data/testing/fixtures';
import { PermChangeNickname, PermManageNicknames } from '@/data/spaceProfileCore';
import { profileSubject } from '@/data';
import { dismissProfileSheet, presentProfileSheet, presentProfileSheetForParticipant, profileSheet } from '@/platform/presenters';
import { runActionItem, type ActionItem } from '@/ui';

// roomTestSetup stubs the space-profile API calls (src/data re-exports them from api/spaces).
const compat = jest.requireMock('@web/api/spaces') as { patchSpaceMember: jest.Mock };
// roomTestSetup stands in for the settings area (its openers).
const settings = jest.requireMock('@/features/settings') as { openSpaceProfile: jest.Mock };
const { nicknameSheetStore, presentNicknameSheet, dismissNicknameSheet } = require('../nicknameSheet') as typeof import('../nicknameSheet');
const { NicknameSheetHost } = require('../members/NicknameSheet') as typeof import('../members/NicknameSheet');
const { memberMenuItems } = require('../members/memberActions') as typeof import('../members/memberActions');
const { ProfileSheetHost } = require('../profile/ProfileSheetHost') as typeof import('../profile/ProfileSheetHost');
const { authorMenuItems, openUserProfile } = require('@/features/chat/people') as typeof import('@/features/chat/people');
const { showUserProfile, spaceRoleContextFor } = require('../profile/present') as typeof import('../profile/present');

const EVERYONE = role('ev', 0, PermViewChannel | PermSendMessages | PermChangeNickname, { name: '@everyone' });
const LOW = role('low', 2, 0, { name: 'Low' });
const MOD = role('mod', 5, PermManageNicknames | PermKickMembers, { name: 'Mod' });

/** The space S: you are a moderator (Manage Nicknames + Kick), b is below you with a space
 * profile, c below you without one, peer at your rank, and the owner above everyone. */
function seed(opts: { everyone?: number; myRoles?: string[] } = {}) {
  const everyone = { ...EVERYONE, permissions: opts.everyone ?? EVERYONE.permissions };
  setSpaces({ spaces: [space('S', [everyone, LOW, MOD], { owner_id: 'owner', name: 'Garden' })], spaceRoomsBySpaceId: {}, loading: false, hydrated: true });
  setSpaceMembers({
    bySpaceId: {
      S: [
        member(ME, opts.myRoles ?? ['mod'], { nick: 'Captain' }),
        member('b', ['low'], { display_name: 'Bea', nick: 'Bee', space_bio: 'buzz' }),
        member('c', ['low'], { display_name: 'Cy' }),
        member('peer', ['mod'], { display_name: 'Pia' }),
        member('owner', [], { display_name: 'Olive' }),
      ],
    },
    loading: {},
    loadedAt: { S: Date.now() },
  });
}

function labels(items: readonly { label: string }[]): string[] {
  return items.map((i) => i.label);
}

const CHANGE = 'Change Nickname';
const EDIT = 'Edit Space Profile';
const RESET = 'Reset Space Profile';

/** The nickname and space-profile entries of `userId`'s menu in a space (as a message author,
 * outside any loaded room - the space's own rules decide). */
function spaceProfileMenuItems(spaceId: string | null, userId: string): ActionItem[] {
  return (authorMenuItems(userId, { roomId: 'c1', spaceId }) as ActionItem[]).filter((i) => [EDIT, CHANGE, RESET].includes(i.label));
}

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  jest.clearAllMocks();
  dismissNicknameSheet();
});

afterEach(async () => {
  settleConfirmDialog(false);
  await act(async () => {
    dismissProfileSheet();
    dismissNicknameSheet();
  });
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('nickname menu entries', () => {
  test('your own row: Edit Space Profile, and Change Nickname while @everyone has it', () => {
    seed();
    expect(labels(spaceProfileMenuItems('S', ME))).toEqual([EDIT, CHANGE]);
    seed({ everyone: PermViewChannel | PermSendMessages, myRoles: [] });
    expect(labels(spaceProfileMenuItems('S', ME))).toEqual([EDIT]);
  });

  test('someone below you: Change Nickname, and the reset only when they set something', () => {
    seed();
    expect(labels(spaceProfileMenuItems('S', 'b'))).toEqual([CHANGE, RESET]);
    expect(labels(spaceProfileMenuItems('S', 'c'))).toEqual([CHANGE]);
  });

  test('nothing for your own rank, the owner, a former member, or outside a space', () => {
    seed();
    expect(spaceProfileMenuItems('S', 'peer')).toEqual([]);
    expect(spaceProfileMenuItems('S', 'owner')).toEqual([]);
    expect(spaceProfileMenuItems('S', 'gone')).toEqual([]);
    expect(spaceProfileMenuItems(null, 'b')).toEqual([]);
  });

  test('without Manage Nicknames others get nothing', () => {
    seed({ myRoles: [] });
    expect(spaceProfileMenuItems('S', 'c')).toEqual([]);
  });

  test('the member drawer and the message author menu put them before Kick', () => {
    seed();
    const drawer = labels(memberMenuItems({ id: 'b', username: 'userb', displayName: 'Bee', roleIds: ['low'], bot: false } as never, { spaceId: 'S', roomId: 'c1' }));
    expect(drawer).toContain(CHANGE);
    expect(drawer.indexOf(CHANGE)).toBeLessThan(drawer.indexOf(RESET));
    expect(drawer.indexOf(RESET)).toBeLessThan(drawer.indexOf(t('room.members.kick')));

    const author = labels(authorMenuItems('b', { roomId: 'c1', spaceId: 'S' }));
    expect(author).toContain(CHANGE);
    expect(author).toContain(RESET);
    expect(labels(authorMenuItems(ME, { roomId: 'c1', spaceId: 'S' }))).toEqual(expect.arrayContaining([EDIT, CHANGE]));
  });

  test('an old message author who has left gets no nickname entries, even from a moderator', () => {
    seed();
    // buildSpaceModerationItems offers Change Nickname without a member row, and the PATCH
    // would answer 404 - nicknameSheet's spaceProfileMenuFields gates onEditNickname on one.
    const gone = labels(authorMenuItems('gone', { roomId: 'c1', spaceId: 'S' }));
    expect(gone).not.toContain(CHANGE);
    expect(gone).not.toContain(RESET);
  });

  test('the entries open the sheet and the space profile screen', () => {
    seed();
    const [change] = spaceProfileMenuItems('S', 'b');
    runActionItem(change as ActionItem);
    expect(nicknameSheetStore.get()).toMatchObject({ spaceId: 'S', userId: 'b' });
    const [edit] = spaceProfileMenuItems('S', ME);
    runActionItem(edit as ActionItem);
    expect(settings.openSpaceProfile).toHaveBeenCalledWith('S');
  });
});

describe('a moderator reset (the web\'s confirmResetSpaceProfile)', () => {
  test('confirms, clears the five fields (never the nickname) and shows the answer', async () => {
    seed();
    compat.patchSpaceMember.mockImplementationOnce(async () => member('b', ['low'], { display_name: 'Bea', nick: 'Bee', space_bio: null }));
    const done = confirmResetSpaceProfile('S', 'b');
    await act(async () => {
      await Promise.resolve();
    });
    expect(confirmDialogState.pending?.options.body).toBe(
      "Reset Bee's space profile? Their avatar, banner, pronouns, About Me and bio in this space go back to their main profile. Their nickname stays.",
    );
    settleConfirmDialog(true);
    await act(async () => {
      await done;
    });
    expect(compat.patchSpaceMember).toHaveBeenCalledWith('S', 'b', { avatar: null, banner: null, about_me: null, bio: null, pronouns: null });
    const b = spaceMembers.bySpaceId.S?.find((m) => m.id === 'b') as { space_bio?: string | null; nick?: string };
    expect(b.space_bio).toBeNull();
    expect(b.nick).toBe('Bee');
  });

  test('a cancelled confirm sends nothing', async () => {
    seed();
    const done = confirmResetSpaceProfile('S', 'b');
    await act(async () => {
      await Promise.resolve();
    });
    settleConfirmDialog(false);
    await act(async () => {
      await done;
    });
    expect(compat.patchSpaceMember).not.toHaveBeenCalled();
  });
});

describe('the nickname sheet', () => {
  test("someone else's: prefilled, saved trimmed to their id, and into the store", async () => {
    seed();
    compat.patchSpaceMember.mockImplementationOnce(async () => member('b', ['low'], { display_name: 'Bea', nick: 'Buzz' }));
    await render(<NicknameSheetHost />);
    await act(async () => {
      presentNicknameSheet({ spaceId: 'S', userId: 'b' });
    });
    expect(screen.getByText('Change nickname for Bee')).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('Bee'), '  Buzz ');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('nickname-save'));
    });
    expect(compat.patchSpaceMember).toHaveBeenCalledWith('S', 'b', { nick: 'Buzz' });
    expect((spaceMembers.bySpaceId.S?.find((m) => m.id === 'b') as { nick?: string }).nick).toBe('Buzz');
    expect(nicknameSheetStore.get()).toBeNull();
  });

  test('your own goes to @me; Reset clears it', async () => {
    seed();
    compat.patchSpaceMember.mockImplementationOnce(async () => member(ME, ['mod'], { nick: null }));
    await render(<NicknameSheetHost />);
    await act(async () => {
      presentNicknameSheet({ spaceId: 'S', userId: ME });
    });
    expect(screen.getAllByText('Change Nickname').length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.press(screen.getByTestId('nickname-reset'));
    });
    expect(compat.patchSpaceMember).toHaveBeenCalledWith('S', '@me', { nick: null });
  });

  test("the server's refusal stays in the sheet", async () => {
    seed();
    compat.patchSpaceMember.mockImplementationOnce(async () => {
      throw new ApiError('nickname must be at most 32 characters, on one line', 400);
    });
    await render(<NicknameSheetHost />);
    await act(async () => {
      presentNicknameSheet({ spaceId: 'S', userId: 'c' });
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('nickname-input'), 'x');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('nickname-save'));
    });
    // The server's sentence, in the reader's language (lib/formatApiError).
    expect(screen.getByText(t('errors.api.nicknameInvalid'))).toBeTruthy();
    expect(nicknameSheetStore.get()).not.toBeNull();
  });

  test('lengths count as the server does: 32 emoji fit, a 33rd or a line break is refused before sending', async () => {
    seed();
    await render(<NicknameSheetHost />);
    await act(async () => {
      presentNicknameSheet({ spaceId: 'S', userId: 'c' });
    });
    // Each of these is two UTF-16 units: the field must not stop at 16.
    expect(screen.getByTestId('nickname-input').props.maxLength).toBeGreaterThanOrEqual(64);
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('nickname-input'), '🐢'.repeat(32));
    });
    expect(screen.queryByText(t('errors.api.nicknameInvalid'))).toBeNull();
    expect(screen.getByTestId('nickname-save').props.accessibilityState?.disabled).toBeFalsy();

    for (const refused of ['🐢'.repeat(33), 'two\nlines']) {
      await act(async () => {
        fireEvent.changeText(screen.getByTestId('nickname-input'), refused);
      });
      expect(screen.getByText(t('errors.api.nicknameInvalid'))).toBeTruthy();
      await act(async () => {
        fireEvent.press(screen.getByTestId('nickname-save'));
      });
      expect(compat.patchSpaceMember).not.toHaveBeenCalled();
    }
  });
});

describe('the profile sheet in a space', () => {
  test('your own: the global name under the nickname, and Edit Space Profile', async () => {
    seed();
    await render(<ProfileSheetHost />);
    await act(async () => {
      presentProfileSheet({ subject: { userId: ME, displayName: 'Captain', globalName: 'Me', username: 'me', spaceId: 'S' }, currentUserId: ME });
    });
    expect(screen.getByText('Captain')).toBeTruthy();
    expect(screen.getByText('Me')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('profile-edit-space-profile'));
    });
    expect(settings.openSpaceProfile).toHaveBeenCalledWith('S');
  });

  test("someone below you offers Change Nickname; someone at your rank does not", async () => {
    seed();
    await render(<ProfileSheetHost />);
    await act(async () => {
      presentProfileSheet({ subject: { userId: 'b', displayName: 'Bee', globalName: 'Bea', username: 'userb', spaceId: 'S' }, currentUserId: ME });
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('profile-change-nickname'));
    });
    expect(nicknameSheetStore.get()).toMatchObject({ spaceId: 'S', userId: 'b' });

    await act(async () => {
      presentProfileSheet({ subject: { userId: 'peer', displayName: 'Pia', username: 'userpeer', spaceId: 'S' }, currentUserId: ME });
    });
    expect(screen.queryByTestId('profile-change-nickname')).toBeNull();
    expect(screen.queryByTestId('profile-edit-space-profile')).toBeNull();
  });

  test('every way mobile opens it keeps the space and offers Change Nickname', async () => {
    seed();
    await render(<ProfileSheetHost />);
    const row = spaceMembers.bySpaceId.S!.find((m) => m.id === 'b')!;
    // subject.spaceId comes from the web builders, which set it only when handed the space, and
    // the gate is computed from the stores - mobile's role contexts never carry
    // canEditNickname, and the voice row and voice sheet pass none.
    const opens: [string, () => void][] = [
      ['message author', () => openUserProfile('b', { roomId: 'c1', spaceId: 'S' })],
      ['room surface', () => showUserProfile('b', { spaceId: 'S' })],
      ['participant', () => presentProfileSheetForParticipant({ participant: row, currentUserId: ME, spaceRoleContext: spaceRoleContextFor('S', 'b') })],
      ['voice row', () => presentProfileSheet({ subject: profileSubject('b', { spaceId: 'S' }), currentUserId: ME })],
    ];
    for (const [via, open] of opens) {
      await act(async () => {
        dismissProfileSheet();
      });
      await act(async () => {
        open();
      });
      expect({ via, spaceId: profileSheet.subject?.spaceId, offered: !!screen.queryByTestId('profile-change-nickname') }).toEqual({
        via,
        spaceId: 'S',
        offered: true,
      });
    }
  });

  test('outside a space neither shows', async () => {
    seed();
    await render(<ProfileSheetHost />);
    await act(async () => {
      presentProfileSheet({ subject: { userId: ME, displayName: 'Me', username: 'me' }, currentUserId: ME });
    });
    expect(screen.queryByTestId('profile-edit-space-profile')).toBeNull();
    expect(screen.queryByTestId('profile-change-nickname')).toBeNull();
  });
});
