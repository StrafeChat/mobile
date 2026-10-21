/// <reference types="jest" />
/**
 * Settings -> Space Profiles: the pure rules (which space it opens on, the PATCH a draft
 * makes, member pickers finding nicknames) and the screen against the real stores - loading
 * your row, saving only what changed, the locked nickname and the reset that then leaves it
 * out, removing an image, switching spaces with unsaved edits, and having no spaces at all.
 */
import './settingsTestSetup';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import { confirmDialogState, settleConfirmDialog } from '@web/stores/confirmDialog';
import { setSpaces } from '@web/stores/spaces';
import { setSpaceMembers, spaceMembers } from '@web/stores/spaceMembers';
import { ME, member, resetStores, role, space } from '@/data/testing/fixtures';
import { PermChangeNickname } from '@/data/spaceProfileCore';
import { actionSheetStore, isActionItem, runActionItem } from '@/ui';
import { initialSpaceProfileSpace, spaceProfileDraftFrom, spaceProfileDraftPatch, SpaceProfileScreen } from '../user/SpaceProfileScreen';
import { pickableMembers } from '../room/PermissionsScreens';
import { transferCandidates } from '../space/OverviewScreen';

jest.mock('@/data/spaceProfileCompat', () => {
  const actual = jest.requireActual<Record<string, unknown>>('@/data/spaceProfileCompat');
  return { ...actual, getSpaceMember: jest.fn(), patchSpaceMember: jest.fn(), uploadSpaceMemberAvatar: jest.fn(), uploadSpaceMemberBanner: jest.fn() };
});

const compat = jest.requireMock('@/data/spaceProfileCompat') as { getSpaceMember: jest.Mock; patchSpaceMember: jest.Mock };

const CAN_NICK = PermViewChannel | PermSendMessages | PermChangeNickname;

function seed(opts: { everyone?: number; spaces?: string[]; mine?: Parameters<typeof member>[2] } = {}) {
  const ids = opts.spaces ?? ['S'];
  setSpaces({
    spaces: ids.map((id) => space(id, [role(`ev-${id}`, 0, opts.everyone ?? CAN_NICK, { name: '@everyone' })], { name: `Space ${id}` })),
    spaceRoomsBySpaceId: {},
    loading: false,
    hydrated: true,
  });
  setSpaceMembers({ bySpaceId: Object.fromEntries(ids.map((id) => [id, [member(ME, [], opts.mine ?? {})]])), loading: {}, loadedAt: {} });
}

/** The server's answer: your row as stored after the call. */
function answer(fields: Parameters<typeof member>[2]) {
  return member(ME, [], { username: 'me', display_name: 'Me', ...fields });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  compat.getSpaceMember.mockImplementation(async (spaceId: string) => (spaceMembers.bySpaceId[spaceId]?.find((m) => m.id === ME) ?? answer({})) as never);
});

afterEach(() => {
  settleConfirmDialog(false);
  actionSheetStore.set(null);
});

describe('space profile rules', () => {
  it('opens on the space asked for, else the one on the rail, else the first', () => {
    expect(initialSpaceProfileSpace(['a', 'b', 'c'], 'c', 'b')).toBe('c');
    expect(initialSpaceProfileSpace(['a', 'b'], 'gone', 'b')).toBe('b');
    expect(initialSpaceProfileSpace(['a', 'b'], null, null)).toBe('a');
    expect(initialSpaceProfileSpace([], 'a', 'a')).toBeNull();
  });

  it('sends only what changed, trimmed, an emptied field as null, and never a locked nickname', () => {
    const saved = spaceProfileDraftFrom({ nick: 'Cap', space_pronouns: 'she/her', space_about_me: null, space_bio: 'bio' });
    expect(spaceProfileDraftPatch(saved, saved, { canChangeNick: true })).toEqual({});
    expect(spaceProfileDraftPatch({ ...saved, nick: '  Captain ', bio: '   ' }, saved, { canChangeNick: true })).toEqual({ nick: 'Captain', bio: null });
    expect(spaceProfileDraftPatch({ ...saved, nick: '', aboutMe: 'hi' }, saved, { canChangeNick: false })).toEqual({ about_me: 'hi' });
    // Only whitespace around the same text is no change.
    expect(spaceProfileDraftPatch({ ...saved, pronouns: ' she/her ' }, saved, { canChangeNick: true })).toEqual({});
  });

  it('member pickers find people by nickname too', () => {
    const members = [member('o', [], { display_name: 'Owner' }), member('a', [], { display_name: 'Amy', nick: 'Sparrow' })];
    expect(pickableMembers(members, new Set(), 'spar').map((m) => m.id)).toEqual(['a']);
    expect(pickableMembers(members, new Set(['a']), 'spar')).toEqual([]);
    expect(transferCandidates(members, 'o', 'sparrow').map((m) => m.id)).toEqual(['a']);
  });
});

describe('space profile screen', () => {
  it('loads your row, then saves only the field that changed and shows the answer', async () => {
    seed();
    compat.getSpaceMember.mockImplementationOnce(async () => answer({ nick: 'Cap', space_bio: 'old bio' }) as never);
    compat.patchSpaceMember.mockImplementationOnce(async () => answer({ nick: 'Cap', space_bio: 'old bio', space_pronouns: 'they/them' }) as never);
    await render(<SpaceProfileScreen initialSpaceId="S" />);
    await waitFor(() => expect(screen.getByTestId('space-profile-nick').props.value).toBe('Cap'));
    expect(compat.getSpaceMember).toHaveBeenCalledWith('S', '@me');
    expect(screen.getByText('Space S')).toBeTruthy();
    expect(screen.queryByTestId('space-profile-save')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('space-profile-pronouns'), ' they/them ');
    await fireEvent.press(screen.getByTestId('space-profile-save'));
    await waitFor(() => expect(compat.patchSpaceMember).toHaveBeenCalledWith('S', '@me', { pronouns: 'they/them' }));
    await waitFor(() => expect(screen.queryByTestId('space-profile-save')).toBeNull());
    expect((spaceMembers.bySpaceId.S?.find((m) => m.id === ME) as { space_pronouns?: string }).space_pronouns).toBe('they/them');
    await screen.unmount();
  });

  it('an emptied nickname is cleared with null', async () => {
    seed({ mine: { nick: 'Cap' } });
    compat.patchSpaceMember.mockImplementationOnce(async () => answer({ nick: null }) as never);
    await render(<SpaceProfileScreen initialSpaceId="S" />);
    await waitFor(() => expect(screen.getByTestId('space-profile-nick').props.value).toBe('Cap'));
    await fireEvent.changeText(screen.getByTestId('space-profile-nick'), '');
    await fireEvent.press(screen.getByTestId('space-profile-save'));
    await waitFor(() => expect(compat.patchSpaceMember).toHaveBeenCalledWith('S', '@me', { nick: null }));
    await screen.unmount();
  });

  it('without Change Nickname the nickname is locked, and a reset leaves it out', async () => {
    seed({ everyone: PermViewChannel | PermSendMessages, mine: { nick: 'Set by a mod', space_bio: 'mine' } });
    compat.patchSpaceMember.mockImplementationOnce(async () => answer({ nick: 'Set by a mod' }) as never);
    await render(<SpaceProfileScreen initialSpaceId="S" />);
    await waitFor(() => expect(screen.getByTestId('space-profile-nick').props.value).toBe('Set by a mod'));
    expect(screen.getByTestId('space-profile-nick').props.editable).toBe(false);
    expect(screen.getByText("This space doesn't let you change your nickname.")).toBeTruthy();

    await fireEvent.press(screen.getByTestId('space-profile-reset'));
    await waitFor(() => expect(confirmDialogState.pending).not.toBeNull());
    expect(confirmDialogState.pending?.options.body).toBe('Your avatar, banner, pronouns, About Me and bio in Space S go back to your main profile. Your nickname stays.');
    await act(async () => settleConfirmDialog(true));
    await waitFor(() =>
      expect(compat.patchSpaceMember).toHaveBeenCalledWith('S', '@me', { avatar: null, banner: null, about_me: null, bio: null, pronouns: null }),
    );
    await screen.unmount();
  });

  it('a reset with only a locked nickname set is not offered', async () => {
    seed({ everyone: PermViewChannel | PermSendMessages, mine: { nick: 'Set by a mod' } });
    await render(<SpaceProfileScreen initialSpaceId="S" />);
    await waitFor(() => expect(screen.getByTestId('space-profile-nick').props.value).toBe('Set by a mod'));
    expect(screen.getByTestId('space-profile-reset')).toBeDisabled();
    await screen.unmount();
  });

  it('removes a space avatar on its own', async () => {
    seed({ mine: { space_avatar: 'https://cdn.example/v1/spaces/members/S/100/avatar-0123456789abcdef.png' } });
    compat.patchSpaceMember.mockImplementationOnce(async () => answer({ space_avatar: null }) as never);
    await render(<SpaceProfileScreen initialSpaceId="S" />);
    await fireEvent.press(await screen.findByTestId('space-profile-remove-avatar'));
    await waitFor(() => expect(compat.patchSpaceMember).toHaveBeenCalledWith('S', '@me', { avatar: null }));
    await waitFor(() => expect(screen.queryByTestId('space-profile-remove-avatar')).toBeNull());
    await screen.unmount();
  });

  it('asks before switching spaces with unsaved edits', async () => {
    seed({ spaces: ['S', 'T'] });
    await render(<SpaceProfileScreen initialSpaceId="S" />);
    await waitFor(() => expect(compat.getSpaceMember).toHaveBeenCalledWith('S', '@me'));
    await fireEvent.changeText(screen.getByTestId('space-profile-bio'), 'typed');
    await fireEvent.press(screen.getByTestId('space-profile-space'));
    const other = actionSheetStore.get()?.entries.find((e) => isActionItem(e) && e.key === 'T');
    expect(other && isActionItem(other)).toBe(true);
    await act(async () => runActionItem(other as never));
    await waitFor(() => expect(confirmDialogState.pending?.options.body).toBe('You have unsaved changes to this space profile. Discard them and switch?'));
    await act(async () => settleConfirmDialog(false));
    expect(screen.getByText('Space S')).toBeTruthy();
    expect(compat.getSpaceMember).not.toHaveBeenCalledWith('T', '@me');
    await screen.unmount();
  });

  it('says so when you are in no space', async () => {
    seed({ spaces: [] });
    await render(<SpaceProfileScreen />);
    expect(screen.getByText("You're not in any spaces yet. Join one to give yourself a space profile.")).toBeTruthy();
    await screen.unmount();
  });
});
