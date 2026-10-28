/**
 * The room area's screens and hosts against the web stores: the conversation frame (header,
 * info sheet, the member drawer's availability), the member list, the profile sheet's role
 * editor, the report sheet, the recovery prompts, the external-link guard and the text
 * prompt. (Notification settings are the settings area's page: review.test.tsx.)
 */
import './roomTestSetup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setRooms } from '@web/stores/rooms';
import { setPresence } from '@web/stores/presence';
import { userProfileFullModal } from '@web/stores/userProfileFullModal';
import { promptRecoveryCode, promptShowRecoveryCode, RecoveryPromptCancelled, recoveryPrompt } from '@web/stores/recoveryPrompt';
import type { SpaceRole } from '@web/api/spaces';
import { ME, group, pm, resetStores, user } from '@/data/testing/fixtures';
import { shell } from '@/shell/state';
import { presentProfileSheet, dismissProfileSheet, presentReportSheet, dismissReportSheet } from '@/platform/presenters';

 
const { RoomView } = require('../RoomView') as typeof import('../RoomView');
const { MembersList } = require('../members/MembersList') as typeof import('../members/MembersList');
const { ProfileSheetHost } = require('../profile/ProfileSheetHost') as typeof import('../profile/ProfileSheetHost');
const { ReportSheetHost } = require('../report/ReportSheetHost') as typeof import('../report/ReportSheetHost');
const { RecoveryHost } = require('../e2ee/RecoveryHost') as typeof import('../e2ee/RecoveryHost');
const { ExternalLinkHost } = require('../links/ExternalLinkHost') as typeof import('../links/ExternalLinkHost');
const { TextPromptHost } = require('../TextPromptHost') as typeof import('../TextPromptHost');
const { promptText } = require('../presenters') as typeof import('../presenters');
const reports = require('@web/api/reports') as { createReport: jest.Mock };
const spacesApi = require('@web/api/spaces') as { setMemberSpaceRoles: jest.Mock };
const externalLink = require('@web/stores/externalLink') as { requestOpenExternalLink: (u: string) => void; confirmExternalLink: jest.Mock };
const navArea = require('@/features/nav') as { openAddPeopleSheet: jest.Mock };
 

beforeEach(() => {
  // Fake timers: the data layer disposes idle shared memos on a 2 s timer, which would
  // otherwise outlive the run.
  jest.useFakeTimers();
  resetStores();
});

afterEach(async () => {
  await act(async () => {
    dismissProfileSheet();
    dismissReportSheet();
  });
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('conversation frame', () => {
  test('a PM shows its header, the list, and the info sheet on a title tap', async () => {
    setRooms({ rooms: [pm('r', user('a', { display_name: 'Alice' }))] });
    await render(<RoomView roomId="r" spaceId={null} mode="shell" />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByTestId('message-list')).toBeTruthy();
    expect(screen.getByLabelText('End-to-end encrypted')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText(/^Alice/));
    });
    expect(screen.getByText('View full profile')).toBeTruthy();
    expect(screen.getByText('Verify encryption')).toBeTruthy();
    expect(shell.membersAvailable()).toBe(false);
  });

  test('a group offers the member drawer; an unknown room says so', async () => {
    setRooms({ rooms: [group('g', [user('a'), user('b')], { name: 'Weekend' })] });
    const view = await render(<RoomView roomId="g" spaceId={null} mode="shell" />);
    expect(screen.getByText('Weekend')).toBeTruthy();
    expect(shell.membersAvailable()).toBe(true);
    await view.unmount();
    expect(shell.membersAvailable()).toBe(false);

    await render(<RoomView roomId="nope" spaceId={null} mode="shell" />);
    expect(screen.getByText('Conversation not found.')).toBeTruthy();
  });
});

describe('member list', () => {
  test('a group lists everyone with the creator able to remove others', async () => {
    setRooms({ rooms: [group('g', [user('a', { display_name: 'Ann' }), user('b', { display_name: 'Ben' })], { creator_id: ME })] });
    setPresence({ byUser: { a: { status: 'online' } } });
    await render(<MembersList roomId="g" spaceId={null} />);
    expect(screen.getByText('Members — 3')).toBeTruthy();
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.getByText('Ben')).toBeTruthy();
    expect(screen.getByLabelText('Remove Ann from group')).toBeTruthy();
    expect(screen.getByLabelText('Remove Ben from group')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Add people'));
    });
    expect(navArea.openAddPeopleSheet).toHaveBeenCalledWith('g');
  });
});

function role(id: string, position: number, extra: Partial<SpaceRole> = {}): SpaceRole {
  return { id, name: id, permissions: 0, position, color: 0, hoist: false, mentionable: false, created_at: '', updated_at: '', ...extra };
}

describe('profile sheet', () => {
  test('shows the person and edits roles under the hierarchy rules', async () => {
    const roles = [role('everyone', 0, { name: '@everyone' }), role('helper', 2), role('admin', 9)];
    await render(<ProfileSheetHost />);
    await act(async () => {
      presentProfileSheet({
        subject: { userId: '200', displayName: 'Bob', username: 'bob', aboutMe: 'hello there' },
        currentUserId: ME,
        onMessageUser: jest.fn(),
        spaceRoleContext: {
          spaceId: 's',
          spaceOwnerId: 'owner',
          subjectRoleIds: ['everyone', 'helper', 'admin'],
          spaceRoles: roles,
          canManageMemberRoles: true,
          viewerHighestPosition: 5,
        },
      });
    });
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('hello there')).toBeTruthy();
    // "admin" sits above the viewer: shown, but not removable.
    expect(screen.queryByLabelText('Remove role admin')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Remove role helper'));
    });
    expect(spacesApi.setMemberSpaceRoles).toHaveBeenCalledWith('s', '200', ['admin']);

    await act(async () => {
      fireEvent.press(screen.getByText('View full profile'));
    });
    expect(userProfileFullModal.open).toBe(true);
    expect(userProfileFullModal.subject?.userId).toBe('200');
  });

  test("edits the owner's roles too, by each role's position, and words a refusal for the role", async () => {
    const { ApiError } = require('@web/api/ApiError') as typeof import('@web/api/ApiError');
    const roles = [role('everyone', 0, { name: '@everyone' }), role('helper', 2), role('admin', 9)];
    spacesApi.setMemberSpaceRoles.mockImplementationOnce(async () => {
      throw new ApiError('cannot manage a role or member at or above your own highest role', 403);
    });
    await render(<ProfileSheetHost />);
    await act(async () => {
      presentProfileSheet({
        subject: { userId: 'owner', displayName: 'Olga', username: 'olga' },
        currentUserId: ME,
        spaceRoleContext: {
          spaceId: 's',
          spaceOwnerId: 'owner',
          subjectRoleIds: ['everyone', 'helper', 'admin'],
          spaceRoles: roles,
          canManageMemberRoles: true,
          viewerHighestPosition: 5,
        },
      });
    });
    // The owner (who outranks everyone) is editable all the same; only "admin" (above the viewer) is locked.
    expect(screen.queryByLabelText('Remove role admin')).toBeNull();
    expect(screen.getByLabelText('Add role')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Remove role helper'));
    });
    expect(spacesApi.setMemberSpaceRoles).toHaveBeenCalledWith('s', 'owner', ['admin']);
    expect(screen.getByText(/^That role is at or above your highest role/)).toBeTruthy();
    // Put back as it was.
    expect(screen.getByLabelText('Remove role helper')).toBeTruthy();
  });
});

describe('report sheet', () => {
  test('needs a reason, then sends and says so', async () => {
    await render(<ReportSheetHost />);
    await act(async () => {
      presentReportSheet({ targetType: 'user', targetId: '200', targetName: 'Bob' });
    });
    expect(screen.getByText('Report Bob')).toBeTruthy();
    const send = () => screen.getByRole('button', { name: 'Send report' });
    expect(send().props.accessibilityState?.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByText('Spam or scams'));
    });
    await act(async () => {
      fireEvent.press(send());
    });
    expect(reports.createReport).toHaveBeenCalledWith(expect.objectContaining({ target_type: 'user', target_id: '200', reason: 'spam' }));
    expect(screen.getByText('Thanks, your report is in.')).toBeTruthy();
  });
});

describe('recovery prompts', () => {
  test('a new code needs "I\'ve saved it" before Done', async () => {
    await render(<RecoveryHost />);
    let done: string | undefined;
    await act(async () => {
      void promptShowRecoveryCode('ABCD-EFGH-JKMN').then((v) => (done = v));
    });
    expect(screen.getByText('Save your recovery code')).toBeTruthy();
    expect(screen.getByText('ABCD-EFGH-JKMN')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' }).props.accessibilityState?.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByText("I've saved my recovery code"));
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    });
    expect(done).toBe('');
  });

  test('the code field re-groups as it is typed; Later declines', async () => {
    await render(<RecoveryHost />);
    let failure: unknown;
    await act(async () => {
      promptRecoveryCode().catch((e: unknown) => (failure = e));
    });
    expect(screen.getByText('Restore your messages')).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'), 'abcd2345');
    });
    expect(screen.getByDisplayValue('ABCD-2345')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore' }).props.accessibilityState?.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByText('Later'));
    });
    expect(failure).toBeInstanceOf(RecoveryPromptCancelled);
    expect((failure as RecoveryPromptCancelled).reason).toBe('dismissed');
    expect(recoveryPrompt.pending).toBeNull();
  });
});

describe('external links and prompts', () => {
  test('"Leaving Strafe" shows the destination and can trust the domain', async () => {
    await render(<ExternalLinkHost />);
    await act(async () => {
      externalLink.requestOpenExternalLink('https://example.com/page');
    });
    expect(screen.getByText('https://example.com/page')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Always trust example.com'));
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Visit site'));
    });
    expect(externalLink.confirmExternalLink).toHaveBeenCalledWith(true);
  });

  test('a text prompt resolves with what was typed', async () => {
    await render(<TextPromptHost />);
    let value: string | null | undefined;
    await act(async () => {
      void promptText({ title: 'Rename thread', initial: 'old', confirmLabel: 'Save' }).then((v) => (value = v));
    });
    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('old'), 'new name');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Save'));
    });
    expect(value).toBe('new name');
  });
});
