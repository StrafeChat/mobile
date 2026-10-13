/**
 * The nav's long-press menus, as action-sheet entries.
 *
 * Each builder is the web's right-click menu for the same thing (SpaceBar's space menu,
 * SpaceRoomsBar's room / section / thread menus and space header dropdown, RoomsBar's
 * conversation menu), with the same gates and order, evaluated at press time
 * from the stores - so they always reflect current permissions. What a phone adds:
 *  - the row hover actions (invite, room settings) live here, since touch has no hover;
 *  - mute takes a duration and the notification level is a submenu (the web keeps both in
 *    the room header's bell menu);
 *  - "Move up / Move down / Move to section" stand in for drag-to-reorder;
 *  - actions the viewer cannot use are left out rather than shown disabled, except "Mark space
 *    as read", which the web shows greyed when there is nothing to mark.
 */
import { t } from '@web/i18n/t';
import { spaces } from '@web/stores/spaces';
import { rooms } from '@web/stores/rooms';
import { auth } from '@web/stores/auth';
import { isRoomMuted, NotifyModeAll, NotifyModeDefault, NotifyModeMentions, NotifyModeNone, type RoomLike } from '@web/lib/roomNotify';
import {
  channelRowView,
  mySpaceMember,
  pmRowView,
  ROOM_TYPE_GROUP,
  sectionRowView,
  spaceAbilities,
  spaceMentionCount,
  spaceUnreadCount,
  threadRowView,
  type SpaceAbilities,
} from '@/data';
import { presentProfileSheetForParticipant, presentReportSheet } from '@/platform/presenters';
import { roomOnScreen } from '@/shell/state';
import type { ActionItem, ActionSheetEntry } from '@/ui';
import {
  copyText,
  deleteRoomFlow,
  deleteSectionFlow,
  leaveGroupFlow,
  leaveSpaceFlow,
  markRoomRead,
  markRoomsRead,
  markSpaceRead,
  moveStep,
  moveToSection,
  setNotifyMode,
  setRoomMuted,
  setSectionMuted,
  setThreadJoined,
} from './actions';
import { roomLink } from './invites';
import { openPmWith } from './navigation';
import { moveOptions } from './reorder';
import { openCreateRoomSheet, openCreateSectionSheet, openInviteSheet } from './sheets/store';
import { openRoomSettings, openSpaceSettings } from './links';

/**
 * The room whose unread the menus leave out, as the rows do: the one on screen, being read as
 * messages arrive. Not the selected one behind the rails, whose unread is real and can be marked.
 */
function onScreenRoomId(): string | null {
  return roomOnScreen()?.roomId ?? null;
}

/** The bell menu's timed mutes (RoomNotifyMenu.DURATIONS). */
export const MUTE_DURATIONS: readonly { key: string; ms: number | null }[] = [
  { key: '15m', ms: 15 * 60 * 1000 },
  { key: '1h', ms: 60 * 60 * 1000 },
  { key: '8h', ms: 8 * 60 * 60 * 1000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: 'forever', ms: null },
];

const NOTIFY_MODES = [NotifyModeDefault, NotifyModeAll, NotifyModeMentions, NotifyModeNone];

/** The viewer's abilities in a space, read now. */
export function abilitiesNow(spaceId: string): SpaceAbilities {
  const sp = spaces.spaces.find((s) => s.id === spaceId);
  return spaceAbilities(sp, sp?.roles, mySpaceMember(spaceId), auth.user?.id);
}

function muteDurationEntries(onPick: (ms: number | null) => void): ActionSheetEntry[] {
  return MUTE_DURATIONS.map((d) => ({
    key: `mute-${d.key}`,
    label: t(`room.notify.duration.${d.key}`),
    onSelect: () => onPick(d.ms),
  }));
}

/** Mute (with a duration) / Unmute, then the notification level. */
export function notifyEntries(roomId: string, room: RoomLike | undefined): ActionSheetEntry[] {
  const muted = isRoomMuted(room);
  const mode = (room as { notify_mode?: number } | undefined)?.notify_mode ?? NotifyModeDefault;
  return [
    muted
      ? { key: 'unmute', label: t('contextMenu.unmute'), icon: 'fa-bell', onSelect: () => setRoomMuted(roomId, false) }
      : {
          key: 'mute',
          label: t('contextMenu.mute'),
          icon: 'fa-bell-slash',
          submenu: muteDurationEntries((ms) => setRoomMuted(roomId, true, ms)),
        },
    {
      key: 'notify',
      label: t('room.notify.title'),
      icon: 'fa-sliders',
      trailing: t(`room.notify.modes.${mode}`),
      submenu: NOTIFY_MODES.map((m) => ({
        key: `notify-${m}`,
        label: t(`room.notify.modes.${m}`),
        selected: m === mode,
        onSelect: () => setNotifyMode(roomId, m),
      })),
    },
  ];
}

/** Move up / Move down / Move to section, for someone with Manage Rooms. */
function positionEntries(spaceId: string, roomId: string): ActionSheetEntry[] {
  const opts = moveOptions(spaceId, roomId);
  if (!opts) return [];
  const sectionTargets: ActionSheetEntry[] = [
    opts.canMoveToTop && { key: 'move-top', label: t('mobile.nav.noSection'), icon: 'fa-arrow-up-wide-short', onSelect: () => moveToSection(spaceId, roomId, null) },
    ...opts.targets.map((s) => ({
      key: `move-${s.id}`,
      label: s.name || t('space.unnamed'),
      icon: 'fa-folder',
      onSelect: () => moveToSection(spaceId, roomId, s.id),
    })),
  ];
  return [
    opts.canMoveUp && { key: 'move-up', label: t('mobile.nav.moveUp'), icon: 'fa-arrow-up', onSelect: () => moveStep(spaceId, roomId, -1) },
    opts.canMoveDown && { key: 'move-down', label: t('mobile.nav.moveDown'), icon: 'fa-arrow-down', onSelect: () => moveStep(spaceId, roomId, 1) },
    (opts.canMoveToTop || opts.targets.length > 0) && {
      key: 'move-section',
      label: t('mobile.nav.moveToSection'),
      icon: 'fa-folder-open',
      submenu: sectionTargets,
    },
  ];
}

// ---- spaces --------------------------------------------------------------------------------------

/**
 * A space's menu. `rail` is the rail icon's long-press (SpaceBar's context menu); `header` is the
 * space name's sheet (SpaceRoomsBar's dropdown, plus mark-read and copy-id, which a phone has
 * nowhere else to put).
 */
export function spaceMenuEntries(spaceId: string, variant: 'rail' | 'header'): ActionSheetEntry[] {
  const sp = spaces.spaces.find((s) => s.id === spaceId);
  if (!sp) return [];
  const ab = abilitiesNow(spaceId);
  const hasUnread = spaceUnreadCount(spaceId, onScreenRoomId()) > 0 || spaceMentionCount(spaceId) > 0;
  const invite: ActionSheetEntry = ab.canInvite && {
    key: 'invite',
    label: t('space.inviteMembers'),
    icon: 'fa-user-plus',
    onSelect: () => openInviteSheet(spaceId),
  };
  const settings: ActionSheetEntry = ab.showSettings && {
    key: 'settings',
    label: t('space.settings'),
    icon: 'fa-sliders',
    onSelect: () => openSpaceSettings(spaceId),
  };
  const markRead: ActionItem = {
    key: 'mark-read',
    label: t('contextMenu.markSpaceAsRead'),
    icon: 'fa-check-double',
    disabled: !hasUnread,
    onSelect: () => markSpaceRead(spaceId),
  };
  const copyId: ActionItem = { key: 'copy-id', label: t('contextMenu.copySpaceId'), icon: 'fa-copy', onSelect: () => void copyText(spaceId) };
  const leave: ActionSheetEntry = ab.canLeave && {
    key: 'leave',
    label: t('space.leave'),
    icon: 'fa-right-from-bracket',
    danger: true,
    onSelect: () => void leaveSpaceFlow(spaceId),
  };
  if (variant === 'rail') return [invite, settings, markRead, copyId, leave];
  return [
    invite,
    settings,
    ab.canManageRooms && {
      key: 'create-room',
      label: t('createRoom.submit'),
      icon: 'fa-hashtag',
      onSelect: () => openCreateRoomSheet(spaceId, null),
    },
    ab.canManageRooms && {
      key: 'create-section',
      label: t('createSection.submit'),
      icon: 'fa-folder',
      onSelect: () => openCreateSectionSheet(spaceId),
    },
    'separator',
    markRead,
    copyId,
    !ab.isOwner && 'separator',
    !ab.isOwner && {
      key: 'report',
      label: t('space.report'),
      icon: 'fa-flag',
      danger: true,
      onSelect: () => presentReportSheet({ targetType: 'space', targetId: sp.id, targetName: sp.name, spaceId: sp.id }),
    },
    leave,
  ];
}

// ---- rooms in a space ----------------------------------------------------------------------------

/** A text or voice room's long-press menu (SpaceRoomsBar.openRoomMenu + the row's hover actions). */
export function channelMenuEntries(spaceId: string, roomId: string): ActionSheetEntry[] {
  const room = spaces.spaceRoomsBySpaceId[spaceId]?.find((r) => r.id === roomId);
  const row = channelRowView(spaceId, roomId, onScreenRoomId());
  if (!room || !row) return [];
  const ab = abilitiesNow(spaceId);
  return [
    ab.canInvite && { key: 'invite', label: t('space.inviteMembers'), icon: 'fa-user-plus', onSelect: () => openInviteSheet(spaceId) },
    // Manage Roles opens it too: room permission overrides live there (the web's rule).
    (ab.canManageRooms || ab.canManageRoles) && {
      key: 'settings',
      label: t('space.roomSettings'),
      icon: 'fa-gear',
      onSelect: () => openRoomSettings(roomId),
    },
    !!row.latestMessageId && row.hasUnreadOrMentions && {
      key: 'mark-read',
      label: t('contextMenu.markAsRead'),
      icon: 'fa-check-double',
      onSelect: () => markRoomRead(roomId, row.latestMessageId),
    },
    ...notifyEntries(roomId, room),
    { key: 'copy-link', label: t('contextMenu.copyRoomLink'), icon: 'fa-link', onSelect: () => void copyText(roomLink(spaceId, roomId)) },
    { key: 'copy-id', label: t('contextMenu.copyRoomId'), icon: 'fa-copy', onSelect: () => void copyText(roomId) },
    ...(ab.canManageRooms ? ['separator' as const, ...positionEntries(spaceId, roomId)] : []),
    ab.canManageRooms && 'separator',
    ab.canManageRooms && {
      key: 'delete',
      label: t('space.deleteRoom'),
      icon: 'fa-trash',
      danger: true,
      onSelect: () => void deleteRoomFlow(spaceId, roomId),
    },
  ];
}

/** A section header's long-press menu (SpaceRoomsBar.openSectionMenu). */
export function sectionMenuEntries(spaceId: string, sectionId: string): ActionSheetEntry[] {
  const row = sectionRowView(spaceId, sectionId, onScreenRoomId());
  if (!row) return [];
  const ab = abilitiesNow(spaceId);
  const name = row.name || t('space.section');
  return [
    ab.canManageRooms && {
      key: 'create-room',
      label: t('space.createRoomIn', { name }),
      icon: 'fa-plus',
      onSelect: () => openCreateRoomSheet(spaceId, sectionId),
    },
    row.hasUnread && {
      key: 'mark-read',
      label: t('contextMenu.markAsRead'),
      icon: 'fa-check-double',
      onSelect: () => markRoomsRead(row.markReadTargets),
    },
    row.anyUnmuted
      ? {
          key: 'mute',
          label: t('contextMenu.muteSection'),
          icon: 'fa-bell-slash',
          onSelect: () => setSectionMuted(row.childIds, true),
        }
      : {
          key: 'unmute',
          label: t('contextMenu.unmuteSection'),
          icon: 'fa-bell',
          onSelect: () => setSectionMuted(row.childIds, false),
        },
    (ab.canManageRooms || ab.canManageRoles) && {
      key: 'settings',
      label: t('space.sectionSettings'),
      icon: 'fa-gear',
      onSelect: () => openRoomSettings(sectionId),
    },
    { key: 'copy-id', label: t('contextMenu.copySectionId'), icon: 'fa-copy', onSelect: () => void copyText(sectionId) },
    ...(ab.canManageRooms ? ['separator' as const, ...positionEntries(spaceId, sectionId)] : []),
    ab.canManageRooms && 'separator',
    ab.canManageRooms && {
      key: 'delete',
      label: t('space.deleteSection'),
      icon: 'fa-trash',
      danger: true,
      onSelect: () => void deleteSectionFlow(spaceId, sectionId),
    },
  ];
}

/** A joined thread's long-press menu (SpaceRoomsBar.openThreadMenu). */
export function threadMenuEntries(spaceId: string, threadId: string): ActionSheetEntry[] {
  const room = spaces.spaceRoomsBySpaceId[spaceId]?.find((r) => r.id === threadId);
  const row = threadRowView(spaceId, threadId, onScreenRoomId());
  if (!room || !row) return [];
  return [
    row.joined
      ? { key: 'leave', label: t('threads.leave'), icon: 'fa-right-from-bracket', onSelect: () => setThreadJoined(threadId, false) }
      : { key: 'join', label: t('threads.join'), icon: 'fa-right-to-bracket', onSelect: () => setThreadJoined(threadId, true) },
    !!row.latestMessageId && row.hasUnreadOrMentions && {
      key: 'mark-read',
      label: t('contextMenu.markAsRead'),
      icon: 'fa-check-double',
      onSelect: () => markRoomRead(threadId, row.latestMessageId),
    },
    ...notifyEntries(threadId, room),
    { key: 'copy-id', label: t('contextMenu.copyRoomId'), icon: 'fa-copy', onSelect: () => void copyText(threadId) },
  ];
}

// ---- private messages ----------------------------------------------------------------------------

/** A conversation's long-press menu (RoomsBar's ConvItem menu). */
export function pmMenuEntries(roomId: string): ActionSheetEntry[] {
  const room = rooms.rooms.find((r) => r.id === roomId);
  const row = pmRowView(roomId, onScreenRoomId());
  if (!room || !row) return [];
  const uid = auth.user?.id;
  const other = room.type === ROOM_TYPE_GROUP ? undefined : room.participants?.find((p) => p.id !== uid);
  return [
    other && {
      key: 'profile',
      label: t('mobile.nav.viewProfile'),
      icon: 'fa-user',
      onSelect: () =>
        presentProfileSheetForParticipant({ participant: other, currentUserId: uid, onMessageUser: (id) => void openPmWith(id) }),
    },
    row.canMarkRead && {
      key: 'mark-read',
      label: t('contextMenu.markAsRead'),
      icon: 'fa-check-double',
      onSelect: () => markRoomRead(roomId, row.latestMessageId),
    },
    ...notifyEntries(roomId, room),
    room.type === ROOM_TYPE_GROUP && {
      key: 'leave',
      label: t('contextMenu.leaveGroup'),
      icon: 'fa-right-from-bracket',
      danger: true,
      onSelect: () => void leaveGroupFlow(roomId),
    },
    { key: 'copy-id', label: t('contextMenu.copyRoomId'), icon: 'fa-copy', onSelect: () => void copyText(roomId) },
  ];
}
