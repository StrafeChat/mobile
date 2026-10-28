/**
 * Space settings with space profiles: the audit log's two new entries (a moderator's nickname
 * change and profile reset - names there stay global), and the members page's search and sort,
 * which go by nickname too.
 */
import '@/data/testing/webMocks';
import { describe, expect, test } from '@jest/globals';
import i18next from 'i18next';
import type { AuditLogEntry, SpaceMember, SpaceRole, SpaceRoom, UserSummary } from '@web/api/spaces';
import type { SpaceProfileFields } from '@/data/spaceProfileCore';
import {
  AUDIT_ACTION_ICON,
  AUDIT_DESTRUCTIVE,
  auditChangeValue,
  auditLookups,
  auditSentence,
  auditTargetLabel,
  auditUserName,
} from '../space/auditFormat';
import { addableMembers, filterMembers } from '../space/roleLogic';

const users: Record<string, UserSummary> = {
  mod: { id: 'mod', username: 'mod', display_name: 'Moderator' } as UserSummary,
  t: { id: 't', username: 'target', display_name: 'Target' } as UserSummary,
};
const members: (SpaceMember & SpaceProfileFields)[] = [{ id: 't', username: 'target', display_name: 'Target', nick: 'Nicky' }];
const lookups = auditLookups(users, [] as SpaceRole[], [] as SpaceRoom[], members);

function entry(action: string, changes?: AuditLogEntry['changes']): AuditLogEntry {
  return { id: 'e', action_type: action, user_id: 'mod', target_id: 't', created_at: '2026-10-13T12:00:00Z', ...(changes ? { changes } : {}) };
}

describe('audit log', () => {
  test('a nickname change: its icon, not destructive, the target by their global name', () => {
    const e = entry('member_nick_update', { nick: { old: 'Nicky', new: 'Nick' } });
    expect(AUDIT_ACTION_ICON.member_nick_update).toBe('signature');
    expect(AUDIT_DESTRUCTIVE.has('member_nick_update')).toBe(false);
    expect(auditTargetLabel(e, lookups)).toBe('Target');
    expect(auditUserName('t', auditLookups({}, [], [], members))).toBe('Target');
    expect(auditSentence(e, lookups)).toBe('member_nick_update');
    expect(auditChangeValue('nick', 'Nick', lookups)).toBe('Nick');
    // A cleared nickname has no `new` side.
    expect(auditChangeValue('nick', undefined, lookups)).toBe('—');
  });

  test('a profile reset: its icon, destructive, the fields it cleared by name', () => {
    // The server's shape: the bare list of what was cleared, not an {old, new} pair.
    const e = entry('member_profile_reset', { fields: ['avatar', 'about_me'] } as unknown as AuditLogEntry['changes']);
    expect(AUDIT_ACTION_ICON.member_profile_reset).toBe('eraser');
    expect(AUDIT_DESTRUCTIVE.has('member_profile_reset')).toBe(true);
    expect(auditTargetLabel(e, lookups)).toBe('Target');
    expect(auditSentence(e, lookups)).toBe('member_profile_reset');
    expect(auditChangeValue('fields', ['avatar', 'about_me'], lookups)).toBe('avatar, about me');
    expect(auditChangeValue('fields', [], lookups)).toBe('—');
  });

  test("the reset's sentence is found under either key the web may use", () => {
    const e = entry('member_profile_reset');
    i18next.addResource('en', 'translation', 'spaceSettings.audit.memberProfileReset', "{{actor}} reset {{target}}'s space profile");
    expect(auditSentence(e, lookups)).toBe("Moderator reset Target's space profile");
    i18next.addResource('en', 'translation', 'spaceSettings.audit.actions.member_profile_reset', '{{actor}} cleared {{target}}');
    expect(auditSentence(e, lookups)).toBe('Moderator cleared Target');
  });
});

describe('members page search and sort', () => {
  const list: (SpaceMember & SpaceProfileFields)[] = [
    { id: '1', username: 'zed', display_name: 'Zed', nick: 'Aardvark', joined_at: '2026-01-01T00:00:00Z' },
    { id: '2', username: 'amy', display_name: 'Amy', joined_at: '2026-01-02T00:00:00Z' },
    { id: '3', username: 'bob', display_name: 'bob', nick: ' ', joined_at: '2026-01-03T00:00:00Z' },
  ];

  test('search matches the nickname, the name and the username', () => {
    expect(filterMembers(list, { query: 'aard', roleId: '', sort: 'name' }).map((m) => m.id)).toEqual(['1']);
    expect(filterMembers(list, { query: 'zed', roleId: '', sort: 'name' }).map((m) => m.id)).toEqual(['1']);
    expect(addableMembers(list, 'r', 'AARD').map((m) => m.id)).toEqual(['1']);
  });

  test('sort by name goes by the nickname, case-insensitively', () => {
    expect(filterMembers(list, { query: '', roleId: '', sort: 'name' }).map((m) => m.id)).toEqual(['1', '2', '3']);
  });
});
