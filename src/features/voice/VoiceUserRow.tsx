/**
 * One person in a voice room, listed under the room's row in a space's room list (the web's
 * VoiceChannelUsers entry): avatar with the speaking ring - the name brightens too - then the
 * LIVE / camera / muted / deafened badges, red when a moderator imposed them.
 *
 * Tap opens their profile; long-press opens the voice sheet (volume, mute for me,
 * moderation). The nav area renders one per `voiceUser` item of useSpaceRoomTree.
 */
import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { useSolid } from '@/bridge/solid';
import { useIsSpeaking } from '@/data/voice';
import { profileSubject } from '@/data/users';
import { presentProfileSheet } from '@/platform/presenters';
import { useTheme } from '@/theme';
import { Avatar, Icon, Text, Touchable, useLongPress } from '@/ui';
import { callParticipantAvatar, callParticipantName, useVoiceStateOf } from './hooks';
import { openVoiceUserSheet } from './sheets';

export interface VoiceUserRowProps {
  roomId: string;
  spaceId: string;
  userId: string;
  /** Start padding, to sit under the room's name (default 40). */
  indent?: number;
  style?: StyleProp<ViewStyle>;
}

export const VoiceUserRow = memo(function VoiceUserRow({ roomId, spaceId, userId, indent = 40, style }: VoiceUserRowProps) {
  const theme = useTheme();
  const st = useVoiceStateOf(roomId, userId);
  const who = useSolid(
    () => {
      const ref = st ?? { user_id: userId };
      return { name: callParticipantName(ref, roomId, spaceId), avatar: callParticipantAvatar(ref, roomId, spaceId) };
    },
    [st, userId, roomId, spaceId],
  );
  const speaking = useIsSpeaking(userId);
  const longPress = useLongPress(() => openVoiceUserSheet({ userId, roomId, spaceId }));
  if (!st) return null;

  const muted = st.self_mute || st.mute;
  const deafened = st.self_deaf || st.deaf;
  const label = [
    who.name,
    speaking ? t('mobile.voice.speaking') : null,
    st.self_stream ? t('voice.status.streaming') : null,
    st.self_video ? t('voice.status.video') : null,
    muted ? t(st.mute ? 'voice.status.serverMuted' : 'voice.status.muted') : null,
    deafened ? t(st.deaf ? 'voice.status.serverDeafened' : 'voice.status.deafened') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Touchable
      testID={`voice-user-row-${userId}`}
      onPress={() => presentProfileSheet({ subject: profileSubject(userId, { roomId, spaceId }), currentUserId: auth.user?.id })}
      {...longPress}
      accessibilityLabel={label}
      hitSlop={{ top: 4, bottom: 4 }}
      style={[
        {
          minHeight: 36,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingStart: indent,
          paddingEnd: 12,
          paddingVertical: 4,
          borderRadius: theme.radii.md,
        },
        style,
      ]}
    >
      <View style={{ borderRadius: 14, borderWidth: 2, borderColor: speaking ? theme.colors.success : 'transparent' }}>
        <Avatar uri={who.avatar} name={who.name} size="sm" />
      </View>
      <Text variant="label" weight="regular" numberOfLines={1} color={speaking ? theme.colors.foreground : theme.colors.mutedForeground} style={{ flex: 1, minWidth: 0 }}>
        {who.name}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {st.self_stream ? (
          <View style={{ borderRadius: 4, backgroundColor: theme.colors.destructive, paddingHorizontal: 4, paddingVertical: 1 }}>
            <Text weight="bold" color={theme.colors.destructiveForeground} style={{ fontSize: 9, lineHeight: 12, letterSpacing: 0.5 }}>
              {t('voice.liveBadge').toUpperCase()}
            </Text>
          </View>
        ) : null}
        {st.self_video ? <Icon name="video" size={11} tone="muted" /> : null}
        {muted ? <Icon name="microphone-slash" size={11} color={st.mute ? theme.colors.dnd : theme.colors.mutedForeground} /> : null}
        {deafened ? <Icon name="volume-xmark" size={11} color={st.deaf ? theme.colors.dnd : theme.colors.mutedForeground} /> : null}
      </View>
    </Touchable>
  );
});
