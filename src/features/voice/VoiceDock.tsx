/**
 * The in-call bar (the web's VoiceDock, mobile variant): visible on every screen while this
 * device is in a call, except while the call's own stage is on screen.
 *
 *   [status · room / space]  (avatars)  [hold to talk] [mute] [deafen] [hang up]
 *
 * Status reads "Connecting…" / "Reconnecting…" in amber or "Voice connected" in green, with
 * the quality icon. Tapping the bar opens the call screen; long-pressing it lists who is in
 * the call (each opens their voice sheet) beside camera and screen share - the web dock's
 * second row. Unlike the mobile web dock it carries mute and deafen: on a phone there is no
 * user area under it to hold them.
 *
 * The integrator places it (under the shell, src/app/(main)/index.tsx); it renders nothing
 * when idle and takes a `style` for its position. useVoiceDockVisible() says whether it shows,
 * so the integrator can make room for it (the system inset goes under the bar, not the shell).
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@web/i18n/t';
import { leaveVoiceRoom, setScreenShareEnabled, toggleDeafen, toggleMute, voice } from '@web/stores/voice';
import { useSolid } from '@/bridge/solid';
import { useIsSpeaking } from '@/data/voice';
import { useRoomInfo } from '@/data/rooms';
import { useSpace } from '@/data/spaces';
import { screenShareSupported } from '@/platform/voice';
import { useTheme } from '@/theme';
import { Avatar, Icon, IconButton, Text, Touchable, haptics, showActionSheet, withAlpha, type ActionSheetEntry } from '@/ui';
import { openCallScreen } from './callView';
import { toggleCameraFromUi } from './join';
import { PushToTalkButton } from './CallControls';
import { useCallSession, useCallSettings, useOtherOccupants, useRoomVoicePerms } from './hooks';
import { DOCK_MAX_AVATARS, avatarOverflow, qualityIcon, statusKey } from './model';
import { openScreenShareSheet, openVoiceUserSheet } from './sheets';

export interface VoiceDockProps {
  style?: StyleProp<ViewStyle>;
}

/** Whether the bar shows: this device is in a call and the call's own stage is not on screen. */
export function useVoiceDockVisible(): boolean {
  return useSolid(() => voice.session.status !== 'idle' && !!voice.session.roomId && !voice.stageVisible);
}

export function VoiceDock({ style }: VoiceDockProps) {
  const s = useCallSession();
  const visible = useVoiceDockVisible();
  if (!visible || !s.roomId) return null;
  return <DockBar roomId={s.roomId} spaceId={s.spaceId} style={style} />;
}

function DockBar({ roomId, spaceId, style }: { roomId: string; spaceId: string | null; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const s = useCallSession();
  const settings = useCallSettings();
  const info = useRoomInfo(roomId, spaceId);
  const space = useSpace(spaceId);
  const others = useOtherOccupants(roomId, spaceId);
  const perms = useRoomVoicePerms(spaceId, roomId);
  const { shown, overflow } = avatarOverflow(others, DOCK_MAX_AVATARS);

  const connected = s.status === 'connected';
  const statusColor = connected ? theme.colors.success : theme.colors.warning;
  const status = t(statusKey(s.status));
  const roomName = info?.name ?? '';
  const where = spaceId ? (space?.name ?? '') : t('nav.privateMessages');
  const micOff = s.selfMute || s.selfDeaf || s.serverMute || s.suppress;
  const deafened = s.selfDeaf || s.serverDeaf;

  const sheetEntries = (): ActionSheetEntry[] => [
    others.length > 0 && { section: t('voice.participants', { count: others.length }) },
    ...others.map((o) => ({
      key: `user-${o.userId}`,
      label: o.name,
      leading: <Avatar uri={o.avatar} name={o.name} size="sm" />,
      onSelect: () => openVoiceUserSheet({ userId: o.userId, roomId, spaceId }),
    })),
    others.length > 0 && 'separator',
    {
      key: 'camera',
      label: s.camera ? t('voice.cameraOff') : t('voice.cameraOn'),
      icon: s.camera ? 'video' : 'video-slash',
      selected: s.camera,
      disabled: !perms.video,
      onSelect: () => toggleCameraFromUi(),
    },
    screenShareSupported() && {
      key: 'screen',
      label: s.screen ? t('voice.stopSharing') : t('voice.shareScreen'),
      icon: 'display',
      selected: s.screen,
      disabled: !perms.video,
      onSelect: () => (s.screen ? setScreenShareEnabled(false) : openScreenShareSheet()),
    },
    { key: 'open', label: t('mobile.voice.openCall'), icon: 'up-right-and-down-left-from-center', onSelect: () => openCallScreen() },
  ];

  return (
    <View
      testID="voice-dock"
      style={[
        {
          marginHorizontal: 8,
          marginVertical: 4,
          borderRadius: theme.radii.xl,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
          flexDirection: 'row',
          alignItems: 'center',
          paddingStart: 4,
          paddingEnd: 6,
          minHeight: 56,
        },
        style,
      ]}
    >
      <Touchable
        feedback="opacity"
        onPress={() => openCallScreen()}
        onLongPress={() => {
          haptics.longPress();
          void showActionSheet(sheetEntries(), { title: roomName, subtitle: where });
        }}
        accessibilityLabel={`${status}, ${roomName} / ${where}`}
        accessibilityHint={t('mobile.voice.openCallHint')}
        style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8, borderRadius: theme.radii.lg }}
        testID="voice-dock-open"
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name={qualityIcon(s.quality)} size={11} color={statusColor} />
            <Text variant="label" weight="semibold" color={statusColor} numberOfLines={1} style={{ flexShrink: 1 }}>
              {status}
            </Text>
          </View>
          <Text variant="caption" numberOfLines={1}>
            {roomName}
            <Text variant="caption" color={withAlpha(theme.colors.mutedForeground, 0.7)}>
              {` / ${where}`}
            </Text>
          </Text>
        </View>
        {shown.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {shown.map((o, i) => (
              <DockAvatar key={o.userId} userId={o.userId} name={o.name} avatar={o.avatar} first={i === 0} />
            ))}
            {overflow > 0 ? (
              <View
                style={{
                  marginStart: -6,
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.muted,
                  borderWidth: 2,
                  borderColor: theme.colors.card,
                }}
              >
                <Text variant="caption" weight="semibold" style={{ fontSize: 10, lineHeight: 12 }} allowFontScaling={false}>
                  +{overflow}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Touchable>

      {settings.inputMode === 'ptt' ? <PushToTalkButton compact disabled={micOff} /> : null}
      <IconButton
        testID="voice-dock-mute"
        icon={micOff ? 'microphone-slash' : 'microphone'}
        label={micOff ? t('voice.unmute') : t('voice.mute')}
        active={micOff}
        color={micOff ? theme.colors.destructive : undefined}
        disabled={s.serverMute || s.suppress}
        onPress={() => {
          haptics.toggle(micOff);
          toggleMute();
        }}
      />
      <IconButton
        testID="voice-dock-deafen"
        icon={deafened ? 'volume-xmark' : 'headphones'}
        label={s.selfDeaf ? t('voice.undeafen') : t('voice.deafen')}
        active={s.selfDeaf}
        color={deafened ? theme.colors.destructive : undefined}
        disabled={s.serverDeaf}
        onPress={() => {
          haptics.toggle(!s.selfDeaf);
          toggleDeafen();
        }}
      />
      <IconButton
        testID="voice-dock-leave"
        icon="phone-slash"
        label={t('voice.leave')}
        tone="danger"
        onPress={() => {
          haptics.impact('medium');
          void leaveVoiceRoom();
        }}
      />
    </View>
  );
}

function DockAvatar({ userId, name, avatar, first }: { userId: string; name: string; avatar?: string; first: boolean }) {
  const theme = useTheme();
  const speaking = useIsSpeaking(userId);
  return (
    <View
      style={{
        marginStart: first ? 0 : -6,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: speaking ? theme.colors.success : theme.colors.card,
      }}
    >
      <Avatar uri={avatar} name={name} size={22} />
    </View>
  );
}
