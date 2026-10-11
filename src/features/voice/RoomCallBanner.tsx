/**
 * The strip a PM or group shows above its messages while a call is up there (the phone
 * version of the web's call panel over a PM): "Call in progress" with who is in it and Join
 * call, or - from this device - "You're in this call" with Open, back to the call screen.
 * Renders nothing when no call is ringing or running in the room, or voice is off on the
 * instance. For the room area to place under its header.
 */
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useCallActive, useIsConnectedTo } from '@/data/voice';
import { useInstance } from '@/data/me';
import { useTheme } from '@/theme';
import { Avatar, Button, Icon, Text, useExternalStore, withAlpha } from '@/ui';
import { openCallScreen } from './callView';
import { useOtherOccupants } from './hooks';
import { joinVoiceFromUi, joiningStore } from './join';
import { avatarOverflow } from './model';

export function RoomCallBanner({ roomId }: { roomId: string }) {
  const theme = useTheme();
  const instance = useInstance();
  const active = useCallActive(roomId);
  const connected = useIsConnectedTo(roomId);
  const others = useOtherOccupants(roomId, null);
  const joining = useExternalStore(joiningStore);
  if (!instance.voiceEnabled || (!active && !connected)) return null;
  const { shown, overflow } = avatarOverflow(others, 4);

  return (
    <View
      testID="voice-room-call-banner"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: withAlpha(theme.colors.success, 0.12),
        borderBottomWidth: 1,
        borderBottomColor: withAlpha(theme.colors.success, 0.3),
      }}
    >
      <Icon name={connected ? 'phone-volume' : 'phone'} size={14} color={theme.colors.success} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text variant="label" weight="semibold" numberOfLines={1}>
          {connected ? t('mobile.voice.inThisCall') : t('mobile.voice.callInProgress')}
        </Text>
        {shown.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel={t('voice.participants', { count: others.length })}>
            {shown.map((o, i) => (
              <View key={o.userId} style={{ marginStart: i === 0 ? 0 : -6, borderRadius: 12, borderWidth: 2, borderColor: theme.colors.background }}>
                <Avatar uri={o.avatar} name={o.name} size={20} />
              </View>
            ))}
            {overflow > 0 ? (
              <Text variant="caption" style={{ marginStart: 6 }}>
                +{overflow}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {connected ? (
        <Button size="sm" variant="secondary" icon="up-right-and-down-left-from-center" title={t('mobile.voice.openCall')} onPress={() => openCallScreen({ roomId, spaceId: null })} />
      ) : (
        <Button
          size="sm"
          icon="phone"
          title={t('voice.joinCall')}
          loading={joining === roomId}
          disabled={!!joining}
          onPress={() => void joinVoiceFromUi(roomId, { spaceId: null })}
          testID="voice-room-call-join"
        />
      )}
    </View>
  );
}
