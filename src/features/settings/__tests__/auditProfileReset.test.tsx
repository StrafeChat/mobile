/// <reference types="jest" />
/**
 * Space settings -> Audit log with a moderator's space-profile reset, as the server writes it:
 * its change is not an {old, new} pair but the bare list of what it cleared
 * (`{"fields": ["avatar", "about_me"]}`, equinox spaces/audit.go auditFields). The expanded
 * entry has to name those fields; reading the list as a pair showed only "—". A nickname
 * change next to it keeps the usual old -> new row.
 */
import './settingsTestSetup';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import type { AuditLogEntry } from '@web/api/spaces';
import { PermSendMessages } from '@web/lib/spacePermissions';
import { setSpaces } from '@web/stores/spaces';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { ME, member, resetStores, role, space } from '@/data/testing/fixtures';
import { isAuditChangePair } from '../space/auditFormat';
import { SpaceAuditLogScreen } from '../space/AuditLogScreen';

/** The two entries, built when the page asks (jest hoists the mock above the imports). */
function mockEntries(): AuditLogEntry[] {
  return [
    {
      id: 'E1',
      action_type: 'member_profile_reset',
      user_id: ME,
      target_id: 'u2',
      created_at: '2026-10-13T12:00:00Z',
      // The wire shape; AuditLogEntry's type only knows {old, new} pairs.
      changes: { fields: ['avatar', 'about_me'] } as unknown as AuditLogEntry['changes'],
    },
    {
      id: 'E2',
      action_type: 'member_nick_update',
      user_id: ME,
      target_id: 'u2',
      created_at: '2026-10-13T11:00:00Z',
      changes: { nick: { old: 'Bee', new: 'Buzz' } },
    },
  ];
}

jest.mock('@web/api/spaces', () => ({
  ...jest.requireActual('@web/api/spaces'),
  listSpaceAuditLog: jest.fn(async () => ({ entries: mockEntries(), users: {} })),
}));

const params = useLocalSearchParams as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  params.mockReturnValue({ spaceId: 'S' });
  setSpaces({ spaces: [space('S', [role('ev', 0, PermSendMessages, { name: '@everyone' })], { owner_id: ME })], spaceRoomsBySpaceId: {}, loading: false, hydrated: true });
  setSpaceMembers({ bySpaceId: { S: [member(ME), member('u2', [], { display_name: 'Bea' })] }, loading: {}, loadedAt: { S: Date.now() } });
});

afterAll(() => params.mockReturnValue({}));

describe('a space-profile reset in the audit log', () => {
  it('tells a pair from a bare list', () => {
    expect(isAuditChangePair({ old: 'a', new: 'b' })).toBe(true);
    expect(isAuditChangePair({ new: 'b' })).toBe(true);
    expect(isAuditChangePair(['avatar'])).toBe(false);
    expect(isAuditChangePair(null)).toBe(false);
    expect(isAuditChangePair('avatar')).toBe(false);
  });

  it('names the fields it cleared; a nickname change keeps old -> new', async () => {
    await render(<SpaceAuditLogScreen />);
    // The pinned web has no sentence for either action yet, so each reads as its id.
    await waitFor(() => expect(screen.getByText('member_profile_reset')).toBeTruthy());
    fireEvent.press(screen.getByText('member_profile_reset'));
    await waitFor(() => expect(screen.getByText('avatar, about me')).toBeTruthy());
    expect(screen.queryByText('—')).toBeNull();

    fireEvent.press(screen.getByText('member_nick_update'));
    await waitFor(() => expect(screen.getByText('Bee')).toBeTruthy());
    expect(screen.getByText(/Buzz/)).toBeTruthy();
    await screen.unmount();
  });
});
