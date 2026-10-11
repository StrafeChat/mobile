/**
 * How a space audit-log entry reads (SpaceAuditLogPage): the sentence, the target's label,
 * the icon, whether it was destructive, and the before/after values of each change -
 * prettified the web's way (role ids become names, room ids #names, the notification level a
 * word, the inactive timeout minutes, booleans Enabled/Disabled). Pure, for tests.
 */
import { t } from '@web/i18n/t';
import type { AuditLogEntry, SpaceMember, SpaceRole, SpaceRoom, UserSummary } from '@web/api/spaces';

export const AUDIT_ACTION_ICON: Record<string, string> = {
  space_update: 'sliders',
  room_create: 'hashtag',
  room_update: 'hashtag',
  room_delete: 'hashtag',
  role_create: 'shield-halved',
  role_update: 'shield-halved',
  role_delete: 'shield-halved',
  member_kick: 'user-minus',
  member_ban_add: 'ban',
  member_ban_remove: 'user-check',
  member_roles_update: 'user-tag',
  bot_add: 'robot',
  invite_create: 'link',
  invite_delete: 'link-slash',
  emoji_create: 'face-smile',
  emoji_update: 'face-smile',
  emoji_delete: 'face-smile',
  override_update: 'lock',
  override_delete: 'lock-open',
  member_voice_mute: 'microphone-slash',
  member_voice_deafen: 'volume-xmark',
  member_voice_move: 'arrow-right-arrow-left',
  member_voice_disconnect: 'phone-slash',
};

export const AUDIT_DESTRUCTIVE = new Set(['room_delete', 'role_delete', 'member_kick', 'member_ban_add', 'invite_delete', 'emoji_delete', 'override_delete', 'member_voice_disconnect']);

export interface AuditLookups {
  users: Record<string, UserSummary>;
  roles: Map<string, SpaceRole>;
  rooms: Map<string, SpaceRoom>;
  members: Map<string, SpaceMember>;
}

export function auditLookups(users: Record<string, UserSummary>, roles: readonly SpaceRole[], rooms: readonly SpaceRoom[], members: readonly SpaceMember[]): AuditLookups {
  return {
    users,
    roles: new Map(roles.map((r) => [r.id, r])),
    rooms: new Map(rooms.map((r) => [r.id, r])),
    members: new Map(members.map((m) => [m.id, m])),
  };
}

export function auditUserName(id: string, l: AuditLookups): string {
  const u = l.users[id];
  if (u) return u.display_name || u.username;
  const m = l.members.get(id);
  if (m) return m.display_name || m.username;
  return t('common.someone');
}

export function auditTargetLabel(e: AuditLogEntry, l: AuditLookups): string {
  const fromChanges = (): string | undefined => {
    const n = e.changes?.name;
    return (n?.new ?? n?.old) as string | undefined;
  };
  switch (e.action_type) {
    case 'member_kick':
    case 'member_ban_add':
    case 'member_ban_remove':
    case 'member_roles_update':
    case 'bot_add':
    case 'member_voice_mute':
    case 'member_voice_deafen':
    case 'member_voice_move':
    case 'member_voice_disconnect':
      return auditUserName(e.target_id, l);
    case 'role_create':
    case 'role_update':
    case 'role_delete':
      return l.roles.get(e.target_id)?.name ?? fromChanges() ?? e.target_id;
    case 'room_create':
    case 'room_update':
    case 'room_delete': {
      const r = l.rooms.get(e.target_id);
      const n = r?.name ?? fromChanges();
      return n ? (r?.type === 5 ? n : `#${n}`) : e.target_id;
    }
    case 'emoji_create':
    case 'emoji_update':
    case 'emoji_delete':
      return fromChanges() ? `:${fromChanges()}:` : e.target_id;
    case 'override_update':
    case 'override_delete': {
      const [roomId, kind, subject] = e.target_id.split(':');
      const room = l.rooms.get(roomId ?? '');
      const who = kind === 'role' ? (l.roles.get(subject ?? '')?.name ?? subject) : auditUserName(subject ?? '', l);
      return `${who} · #${room?.name ?? roomId}`;
    }
    case 'space_update':
      return t('space.thisSpace');
    default:
      return e.target_id;
  }
}

export function auditSentence(e: AuditLogEntry, l: AuditLookups): string {
  return t(`spaceSettings.audit.actions.${e.action_type}`, { actor: auditUserName(e.user_id, l), target: auditTargetLabel(e, l), defaultValue: e.action_type });
}

export function auditFieldLabel(key: string): string {
  return t(`spaceSettings.audit.fields.${key}`, { defaultValue: key.replace(/_/g, ' ') });
}

function fmtValue(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? t('common.enabled') : t('common.disabled');
  return String(v);
}

export function auditChangeValue(key: string, v: unknown, l: AuditLookups): string {
  if (key === 'roles' && Array.isArray(v)) return v.map((rid) => l.roles.get(String(rid))?.name ?? String(rid)).join(', ') || '—';
  if ((key === 'system_room_id' || key === 'afk_room_id' || key === 'widget_room_id') && typeof v === 'string' && v) {
    return `#${l.rooms.get(v)?.name ?? v}`;
  }
  if (key === 'default_message_notifications') return v === 1 ? t('spaceSettings.system.notifMentions') : t('spaceSettings.system.notifAll');
  if (key === 'afk_timeout' && typeof v === 'number') return t('spaceSettings.system.minutes', { count: v / 60 });
  return fmtValue(v);
}
