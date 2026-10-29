/**
 * A conversation's header (the web's RoomHeader, laid out the way Discord mobile does it):
 * back (on a phone: the rails), the room's glyph or the other person's avatar, the name with
 * its BOT / OFFICIAL tags, the encryption lock and a muted bell, and a second line - presence
 * for a PM (a custom status, else what they are playing, else the status), the topic for a channel, the channel for a thread. Tapping the title opens the
 * room's info sheet, which holds everything; the bar itself keeps the two or three actions
 * that matter for the kind of room (calls in PMs, threads and members in channels, search
 * everywhere). Wider screens have room for pins and notifications too.
 */
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import {
  pmStatusLine,
  useCallActive,
  useInstance,
  usePinsState,
  usePresence,
  type RoomInfo,
} from '@/data';
import { shell } from '@/shell/state';
import { useIsWide } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { BotTag, Header, Icon, OfficialTag, UserAvatar, presenceLabel, withAlpha, type HeaderAction } from '@/ui';
import { openPinsScreen, openSearchScreen, openThreadsScreen } from './navigation';
import { openRoomNotifySheet } from './presenters';
import { startOrJoinCall, toggleMembers, type RoomMode } from './roomActions';
import { roomKindIcon } from './util';
import { headerActionKeys, type HeaderActionKey } from './headerModel';

export interface RoomHeaderProps {
  info: RoomInfo;
  mode: RoomMode;
  /** Back: the rails on a phone (shell), the previous screen (pushed); none on a tablet's shell. */
  onBack?: () => void;
  onOpenInfo: () => void;
}

function useSubtitle(info: RoomInfo): string | undefined {
  const presence = usePresence(info.kind === 'pm' ? info.otherUserId : null);
  if (info.kind === 'pm') {
    if (info.official) return undefined;
    return pmStatusLine(presence, presenceLabel);
  }
  if (info.kind === 'group') return t('threads.memberCount', { count: info.participantCount });
  if (info.kind === 'thread') return info.parentName ? `#${info.parentName}` : undefined;
  if (info.kind === 'text') return info.topic?.trim() || undefined;
  return undefined;
}

/** The header's action buttons for a room, in the bar's order (headerModel picks which). */
export function headerActions(
  info: RoomInfo,
  opts: { wide: boolean; voiceEnabled: boolean; callActive: boolean; hasPins: boolean; membersOpen: boolean; mode: RoomMode },
): HeaderAction[] {
  const spaceId = info.spaceId ?? null;
  const build: Record<HeaderActionKey, () => HeaderAction> = {
    call: () => ({
      icon: 'phone',
      label: opts.callActive ? t('voice.joinCall') : t('room.callVoice'),
      active: opts.callActive,
      onPress: () => startOrJoinCall(info.id, false, spaceId),
    }),
    video: () => ({
      icon: 'video',
      label: opts.callActive ? t('voice.joinWithVideo') : t('room.callVideo'),
      active: opts.callActive,
      onPress: () => startOrJoinCall(info.id, true, spaceId),
    }),
    threads: () => ({ icon: 'comments', label: t('threads.title'), onPress: () => spaceId && openThreadsScreen(info.id, spaceId) }),
    pins: () => ({
      icon: 'thumbtack',
      label: opts.hasPins ? t('room.pinned') : t('room.noPinned'),
      onPress: () => openPinsScreen(info.id, spaceId),
    }),
    notify: () => ({
      icon: info.muted ? 'bell-slash' : 'bell',
      label: info.muted ? t('room.notify.muted') : t('room.notify.title'),
      onPress: () => openRoomNotifySheet(info.id, spaceId),
    }),
    search: () => ({ icon: 'magnifying-glass', label: t('room.searchMessages'), onPress: () => openSearchScreen(info.id, spaceId) }),
    members: () => ({
      icon: 'user-group',
      label: opts.membersOpen ? t('room.hideMembers') : t('room.showMembers'),
      active: opts.mode === 'shell' && opts.membersOpen,
      onPress: () => toggleMembers(info.id, spaceId, opts.mode),
    }),
  };
  return headerActionKeys(info, opts).map((k) => build[k]());
}

export function RoomHeader({ info, mode, onBack, onOpenInfo }: RoomHeaderProps) {
  const theme = useTheme();
  const wide = useIsWide();
  const instance = useInstance();
  const callActive = useCallActive(info.callable ? info.id : null);
  const pins = usePinsState(info.id);
  const membersOpen = useSolid(() => shell.membersOpen());
  const subtitle = useSubtitle(info);

  const leading =
    info.kind === 'pm' && info.otherUserId ? (
      <UserAvatar userId={info.otherUserId} name={info.name} size="md" ringColor={theme.colors.card} />
    ) : (
      <Icon name={roomKindIcon(info.kind, { privateThread: info.thread?.private })} size={16} tone="muted" />
    );

  const accessory = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginStart: 4 }}>
      {info.kind === 'pm' ? <BotTag bot={info.bot} size="sm" /> : null}
      {info.kind === 'pm' ? <OfficialTag system={info.official} size="sm" /> : null}
      {info.e2ee ? (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('room.e2eeBadge')}
          style={{ width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(theme.colors.primary, 0.15) }}
        >
          <Icon name="lock" size={10} tone="primary" />
        </View>
      ) : null}
      {info.muted ? <Icon name="bell-slash" size={11} tone="muted" accessibilityLabel={t('room.notify.muted')} /> : null}
    </View>
  );

  return (
    <Header
      title={info.name}
      subtitle={subtitle}
      onBack={onBack}
      backLabel={mode === 'shell' ? t('mobile.room.openRooms') : undefined}
      leading={leading}
      titleAccessory={accessory}
      onTitlePress={onOpenInfo}
      actions={headerActions(info, {
        wide,
        voiceEnabled: instance.voiceEnabled,
        callActive,
        hasPins: pins.count > 0,
        membersOpen,
        mode,
      })}
      testID="room-header"
    />
  );
}
