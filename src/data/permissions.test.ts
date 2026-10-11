import { describe, expect, test } from '@jest/globals';
import './testing/webMocks';
import {
  PermAddReactions,
  PermAdministrator,
  PermAttachFiles,
  PermCreatePublicThreads,
  PermManageMessages,
  PermManageThreads,
  PermMentionEveryone,
  PermReadMessageHistory,
  PermSendMessages,
  PermSendMessagesInThreads,
  PermUseExternalEmojis,
  PermViewChannel,
} from '@web/lib/spacePermissions';
import { VERIFICATION_MEDIUM } from '@web/api/spaces';
import type { SpaceRoom } from '@web/api/spaces';
import { channelGates, composerLockText, messageActions, pmGates, type ChannelGatesInput } from './permissions';
import { ME, member, role, space, sroom, user } from './testing/fixtures';

const BASIC = PermViewChannel | PermSendMessages | PermReadMessageHistory | PermAddReactions | PermAttachFiles;
const everyone = (perms: number) => role('ev', 0, perms, { name: '@everyone' });

function input(perms: number, room: SpaceRoom, extra: Partial<ChannelGatesInput> = {}): ChannelGatesInput {
  const sp = space('s1', [everyone(perms), role('mod', 5, PermManageMessages | PermManageThreads)]);
  return {
    space: sp,
    room,
    allRooms: [room],
    roles: sp.roles,
    member: member(ME, []),
    userId: ME,
    verifiedEmail: true,
    accountCreatedAt: '2020-01-01T00:00:00Z',
    emailEnabled: true,
    ...extra,
  };
}

describe('space channel gates', () => {
  const text = sroom('t', 3, { slowmode_seconds: 30 });

  test('a plain member', () => {
    const g = channelGates(input(BASIC, text));
    expect(g).toMatchObject({
      kind: 'space',
      canSend: true,
      canReply: true,
      canAttach: true,
      canMentionEveryone: false,
      canPin: false,
      canDeleteOthers: false,
      canReact: true,
      canJoinReactions: true,
      customEmojiSpaceId: 's1',
      canCreatePublicThreads: false,
      canOfferCreateThread: false,
      slowmodeSeconds: 30,
      lock: null,
    });
  });

  test('no Send Messages locks the composer and takes attach/@everyone with it', () => {
    const g = channelGates(input(PermViewChannel | PermAttachFiles | PermMentionEveryone, text));
    expect(g).toMatchObject({ canSend: false, canReply: false, canAttach: false, canMentionEveryone: false, lock: { kind: 'noPermission' } });
  });

  test('Manage Messages: pins, deletes others, exempt from slowmode', () => {
    const sp = input(BASIC, text);
    const g = channelGates({ ...sp, member: member(ME, ['mod']) });
    expect(g).toMatchObject({ canPin: true, canDeleteOthers: true, slowmodeSeconds: 0 });
  });

  test('the owner gets every room bit and no moderation ceiling', () => {
    const base = input(0, text);
    const g = channelGates({ ...base, space: { ...base.space, owner_id: ME } });
    expect(g).toMatchObject({
      canSend: true,
      canMentionEveryone: true,
      canPin: true,
      canOfferCreateThread: true,
      slowmodeSeconds: 0,
      canKickMembers: true,
      viewerHighestRolePosition: Number.MAX_SAFE_INTEGER,
    });
    expect(g.customEmojiSpaceId).toBeUndefined();
  });

  test('Administrator through a role', () => {
    const base = input(BASIC, text);
    const roles = [...base.roles!, role('admin', 9, PermAdministrator)];
    const g = channelGates({ ...base, roles, space: { ...base.space, roles }, member: member(ME, ['admin']) });
    expect(g).toMatchObject({ canMentionEveryone: true, canDeleteOthers: true, canManageThreads: true, viewerHighestRolePosition: 9 });
  });

  test('while roles or overrides are unknown: permissive for own actions, closed for the rest', () => {
    const g = channelGates(input(BASIC, sroom('t', 3, { permission_overrides: undefined })));
    expect(g).toMatchObject({
      mask: null,
      canSend: true,
      canAttach: true,
      canPin: true,
      canReact: true,
      canMentionEveryone: false,
      canCreatePublicThreads: false,
    });
    expect(g.customEmojiSpaceId).toBeUndefined();
  });

  test('a room override wins over the role', () => {
    const room = sroom('t', 3, {
      permission_overrides: [{ role_id: 'ev', allow: PermMentionEveryone | PermUseExternalEmojis, deny: PermAddReactions, created_at: '', updated_at: '' }],
    });
    const g = channelGates(input(BASIC, room));
    expect(g).toMatchObject({ canMentionEveryone: true, canReact: false, canJoinReactions: true });
    expect(g.customEmojiSpaceId).toBeUndefined();
  });

  test('a synced channel takes its section\'s overrides', () => {
    const section = sroom('sec', 5, {
      permission_overrides: [{ role_id: 'ev', allow: 0, deny: PermSendMessages, created_at: '', updated_at: '' }],
    });
    const child = sroom('t', 3, { parent_id: 'sec', permissions_synced: true });
    const g = channelGates({ ...input(BASIC, child), allRooms: [section, child] });
    expect(g.canSend).toBe(false);
  });

  describe('threads', () => {
    const parent = sroom('t', 3);
    const th = (locked: boolean) => sroom('th', 6, { parent_id: 't', thread: { archived: false, locked, private: false, invitable: true, auto_archive_minutes: 60, owner_id: 'x', message_count: 0, member_count: 0, joined: true } });

    test('Send Messages In Threads, not Send Messages, decides', () => {
      expect(channelGates({ ...input(BASIC, th(false)), allRooms: [parent, th(false)] }).canSend).toBe(false);
      const g = channelGates({ ...input(BASIC | PermSendMessagesInThreads, th(false)), allRooms: [parent, th(false)] });
      expect(g).toMatchObject({ canSend: true, canOfferCreateThread: false });
    });

    test('a locked thread takes nothing without Manage Threads', () => {
      const perms = BASIC | PermSendMessagesInThreads;
      const g = channelGates({ ...input(perms, th(true)), allRooms: [parent, th(true)] });
      expect(g).toMatchObject({ canSend: false, lock: { kind: 'threadLocked' } });
      const mod = channelGates({ ...input(perms, th(true)), allRooms: [parent, th(true)], member: member(ME, ['mod']) });
      expect(mod.canSend).toBe(true);
    });

    test('Create Public Threads offers "Create thread" in the channel, never inside a thread', () => {
      expect(channelGates(input(BASIC | PermCreatePublicThreads, parent)).canOfferCreateThread).toBe(true);
    });
  });

  test('verification level: account age counts down, a role exempts', () => {
    const base = input(BASIC, text);
    const sp = { ...base.space, verification_level: VERIFICATION_MEDIUM };
    const young = new Date(Date.now() - 60_000).toISOString();
    const g = channelGates({ ...base, space: sp, accountCreatedAt: young });
    expect(g.lock).toMatchObject({ kind: 'verification', requirement: 'account_age' });
    const unlockAt = g.lock && g.lock.kind === 'verification' ? g.lock.unlockAt! : 0;
    expect(composerLockText(g.lock!, unlockAt - 125_000)).toBe('space.verification.accountAge');
    expect(channelGates({ ...base, space: sp, accountCreatedAt: young, member: member(ME, ['mod']) }).lock).toBeNull();
  });
});

describe('PM gates', () => {
  test('1:1: anyone pins, nobody deletes others, no @everyone', () => {
    expect(pmGates({ type: 1, participants: [user(ME), user('a')] }, ME)).toMatchObject({
      kind: 'pm',
      canSend: true,
      canPin: true,
      canDeleteOthers: false,
      canMentionEveryone: false,
      lock: null,
    });
  });

  test('groups offer @everyone', () => {
    expect(pmGates({ type: 2, participants: [] }, ME).canMentionEveryone).toBe(true);
  });

  test('the official account is read-only', () => {
    const g = pmGates({ type: 1, participants: [user(ME), user('sys', { system: true })] }, ME);
    expect(g).toMatchObject({ canSend: false, lock: { kind: 'officialReadOnly' } });
    expect(composerLockText(g.lock!, Date.now())).toBe('room.officialReadOnly');
  });
});

describe('message actions (web context-menu order and gates)', () => {
  const pmG = pmGates({ type: 1, participants: [] }, ME);

  test('someone else\'s message in a PM', () => {
    expect(messageActions({ sender_id: 'a' }, ME, pmG)).toEqual(['addReaction', 'copyText', 'copyId', 'reply', 'pin', 'report']);
  });

  test('your own pinned message', () => {
    expect(messageActions({ sender_id: ME, pinned: true }, ME, pmG)).toEqual(['addReaction', 'copyText', 'copyId', 'reply', 'unpin', 'edit', 'delete']);
  });

  test('a moderator in a channel with thread creation; no Create thread once one exists', () => {
    const g = { canReact: false, canReply: true, canPin: true, canDeleteOthers: true, canOfferCreateThread: true };
    expect(messageActions({ sender_id: 'a' }, ME, g)).toEqual(['copyText', 'copyId', 'reply', 'createThread', 'pin', 'report', 'delete']);
    expect(messageActions({ sender_id: 'a', thread_id: 't' }, ME, g)).not.toContain('createThread');
  });

  test('system messages have no sheet', () => {
    expect(messageActions({ sender_id: 'a', system_type: 'member_added' }, ME, pmG)).toEqual([]);
  });
});
