/**
 * A conversation's info sheet - what tapping the header's title opens, Discord mobile's
 * channel / PM details: the room (name, topic or presence, whether it is end-to-end encrypted
 * and what that means), quick actions (search, pins, notifications, members, threads), and
 * everything else the web keeps in its header: the other person's profile and safety number,
 * group details / add people / leave, creating a thread and the room's settings, a thread's
 * own actions, mark as read, copy the room's id.
 */
import { useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import {
  useInstance,
  usePinsState,
  usePresence,
  useRoomGates,
  useSpaceAbilities,
  type RoomInfo,
} from '@/data';
import { openAddPeopleSheet } from '@/features/nav';
import { openRoomSettings } from '@/features/settings';
import { useTheme } from '@/theme';
import {
  BotTag,
  Divider,
  Icon,
  ListRow,
  ListSection,
  OfficialTag,
  Sheet,
  Text,
  Touchable,
  UserAvatar,
  isActionItem,
  presenceLabel,
  runActionItem,
  withAlpha,
} from '@/ui';
import {
  openGroupScreen,
  openPinsScreen,
  openProfileScreen,
  openSafetyScreen,
  openSearchScreen,
  openThreadsScreen,
} from './navigation';
import { openCreateThread, openRoomNotifySheet } from './presenters';
import { leaveGroup, markRoomRead, openParentChannel, startOrJoinCall, toggleMembers, type RoomMode } from './roomActions';
import { threadActionEntries } from './threads/threadActions';
import { useStoredThread } from './threads/data';
import { useRoomUnreadCount } from './hooks';
import { copyText, roomKindIcon } from './util';

export interface RoomInfoSheetProps {
  info: RoomInfo;
  mode: RoomMode;
  open: boolean;
  onClose: () => void;
  /** After a thread is deleted from here. */
  onThreadDeleted: (parentId: string | undefined) => void;
}

function QuickAction({ icon, label, onPress, badge }: { icon: string; label: string; onPress: () => void; badge?: string }) {
  const theme = useTheme();
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      feedback="highlight"
      style={{
        flexGrow: 1,
        flexBasis: 72,
        minHeight: 64,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: 4,
        borderRadius: theme.radii.lg,
        backgroundColor: withAlpha(theme.colors.muted, 0.45),
      }}
    >
      <Icon name={icon} size={18} />
      <Text variant="caption" tone="default" numberOfLines={1} align="center">
        {badge ? `${label} · ${badge}` : label}
      </Text>
    </Touchable>
  );
}

export function RoomInfoSheet({ info, mode, open, onClose, onThreadDeleted }: RoomInfoSheetProps) {
  const theme = useTheme();
  const spaceId = info.spaceId ?? null;
  const instance = useInstance();
  const pins = usePinsState(info.id);
  const gates = useRoomGates(info.id, spaceId);
  const abilities = useSpaceAbilities(spaceId);
  const presence = usePresence(info.kind === 'pm' ? info.otherUserId : null);
  const unread = useRoomUnreadCount(info.id, spaceId, info.kind);
  const thread = useStoredThread(spaceId, info.kind === 'thread' ? info.id : '');
  /** Run after the sheet has closed, so what it opens doesn't fight the closing sheet. */
  const pending = useRef<(() => void) | null>(null);
  const then = (fn: () => void) => () => {
    pending.current = fn;
    onClose();
  };
  const handleClosed = () => {
    const fn = pending.current;
    pending.current = null;
    onClose();
    fn?.();
  };

  const canCall = info.callable && instance.voiceEnabled;
  const hero: ReactNode =
    info.kind === 'pm' && info.otherUserId ? (
      <UserAvatar userId={info.otherUserId} name={info.name} size="xl" ringColor={theme.colors.card} />
    ) : (
      <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(theme.colors.primary, 0.2) }}>
        <Icon name={roomKindIcon(info.kind, { privateThread: info.thread?.private })} size={26} />
      </View>
    );

  let line: string | undefined;
  if (info.kind === 'pm' && !info.official) {
    // A custom status reads as current only while the person is around (the web's rule).
    const present = presence.status === 'online' || presence.status === 'idle' || presence.status === 'dnd';
    line = present && presence.custom_status ? presence.custom_status : presenceLabel(presence.status);
  }
  else if (info.kind === 'group') line = t('threads.memberCount', { count: info.participantCount });
  else if (info.kind === 'thread' && info.parentName) line = `#${info.parentName}`;
  else if (info.kind === 'text') line = info.topic?.trim() || undefined;

  const e2eeNote =
    info.kind === 'pm' || info.kind === 'group' || info.kind === 'notes'
      ? info.official
        ? null
        : t('intro.pmEncrypted')
      : t('intro.roomEncrypted');

  const threadRows =
    info.kind === 'thread' && thread && spaceId
      ? threadActionEntries(thread, { spaceId, canManageThreads: !!gates?.canManageThreads, onDeleted: onThreadDeleted }).filter(isActionItem)
      : [];

  return (
    <Sheet open={open} onClose={handleClosed} scrollable testID="room-info-sheet">
      <View style={{ alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 12 }}>
        {hero}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Text variant="title" align="center" accessibilityRole="header">
            {info.kind === 'text' || info.kind === 'thread' ? `${info.kind === 'text' ? '#' : ''}${info.name}` : info.name}
          </Text>
          {info.kind === 'pm' ? <BotTag bot={info.bot} size="md" /> : null}
          {info.kind === 'pm' ? <OfficialTag system={info.official} size="md" /> : null}
        </View>
        {line ? (
          <Text tone="muted" align="center">
            {line}
          </Text>
        ) : null}
        {info.e2ee && e2eeNote ? (
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              marginTop: 6,
              padding: 10,
              borderRadius: theme.radii.md,
              borderWidth: 1,
              borderColor: withAlpha(theme.colors.primary, 0.3),
              backgroundColor: withAlpha(theme.colors.primary, 0.1),
            }}
          >
            <Icon name="lock" size={12} tone="primary" style={{ marginTop: 3 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label">{t('room.e2eeBadge')}</Text>
              <Text variant="caption">{e2eeNote}</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <QuickAction icon="magnifying-glass" label={t('common.search')} onPress={then(() => openSearchScreen(info.id, spaceId))} />
        <QuickAction
          icon="thumbtack"
          label={t('room.pinned')}
          badge={pins.count > 0 ? String(pins.count) : undefined}
          onPress={then(() => openPinsScreen(info.id, spaceId))}
        />
        <QuickAction
          icon={info.muted ? 'bell-slash' : 'bell'}
          label={info.muted ? t('room.notify.muted') : t('mobile.room.notifications')}
          onPress={then(() => openRoomNotifySheet(info.id, spaceId))}
        />
        {info.hasMemberList ? (
          <QuickAction icon="user-group" label={t('room.members.title')} onPress={then(() => toggleMembers(info.id, spaceId, mode))} />
        ) : null}
        {info.kind === 'text' && spaceId ? (
          <QuickAction icon="comments" label={t('threads.title')} onPress={then(() => openThreadsScreen(info.id, spaceId))} />
        ) : null}
      </View>

      <View style={{ gap: 12, marginTop: 16 }}>
        {info.kind === 'pm' && info.otherUserId ? (
          <ListSection>
            <ListRow
              title={t('profile.viewFull')}
              icon="user"
              chevron
              onPress={then(() => openProfileScreen(info.otherUserId!, { roomId: info.id }))}
            />
            {!info.official ? (
              <ListRow
                title={t('safety.title')}
                icon="shield-halved"
                chevron
                onPress={then(() => openSafetyScreen(info.otherUserId!, info.name))}
              />
            ) : null}
            {canCall ? <ListRow title={t('room.callVoice')} icon="phone" onPress={then(() => startOrJoinCall(info.id, false, spaceId))} /> : null}
            {canCall ? <ListRow title={t('room.callVideo')} icon="video" onPress={then(() => startOrJoinCall(info.id, true, spaceId))} /> : null}
          </ListSection>
        ) : null}

        {info.kind === 'group' ? (
          <ListSection>
            <ListRow title={t('mobile.room.groupDetails')} icon="user-group" chevron onPress={then(() => openGroupScreen(info.id))} />
            <ListRow title={t('room.addPeople')} icon="user-plus" chevron onPress={then(() => openAddPeopleSheet(info.id))} />
            {canCall ? <ListRow title={t('room.callVoice')} icon="phone" onPress={then(() => startOrJoinCall(info.id, false, spaceId))} /> : null}
          </ListSection>
        ) : null}

        {info.kind === 'text' && spaceId ? (
          <ListSection>
            {gates?.canCreatePublicThreads ? (
              <ListRow title={t('threads.new')} icon="plus" onPress={then(() => openCreateThread({ spaceId, roomId: info.id }))} />
            ) : null}
            {abilities.canManageRooms ? (
              <ListRow title={t('mobile.room.roomSettings')} icon="gear" chevron onPress={then(() => openRoomSettings(info.id))} />
            ) : null}
          </ListSection>
        ) : null}

        {info.kind === 'thread' ? (
          <ListSection title={t('threads.actions')}>
            {info.parentId && info.parentName ? (
              <ListRow
                title={`#${info.parentName}`}
                icon="hashtag"
                chevron
                onPress={then(() => openParentChannel(info.parentId!, spaceId, mode))}
              />
            ) : null}
            {threadRows.map((item) => (
              <ListRow
                key={item.key ?? item.label}
                title={item.label}
                icon={item.icon}
                destructive={item.danger}
                onPress={then(() => runActionItem(item))}
              />
            ))}
          </ListSection>
        ) : null}

        <Divider />
        <ListSection>
          {unread > 0 ? <ListRow title={t('contextMenu.markAsRead')} icon="check-double" onPress={then(() => markRoomRead(info.id))} /> : null}
          <ListRow title={t('contextMenu.copyRoomId')} icon="copy" onPress={then(() => void copyText(info.id))} />
          {info.kind === 'group' ? (
            <ListRow
              title={t('contextMenu.leaveGroup')}
              icon="right-from-bracket"
              destructive
              onPress={then(() => void leaveGroup(info.id, info.name))}
            />
          ) : null}
        </ListSection>
      </View>
    </Sheet>
  );
}
