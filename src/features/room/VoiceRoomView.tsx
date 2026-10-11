/**
 * A space voice room on the content panel (the web shows its VoiceStage there): who is in it,
 * and Join - or, when this device is already in it, the way to the call screen. Joining goes
 * through the voice area (permissions, E2EE support, errors as toasts).
 */
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@web/i18n/t';
import { useInstance, useIsConnectedTo, useVoiceOccupants, type RoomInfo } from '@/data';
import { joinVoiceFromUi, openCallScreen } from '@/features/voice';
import { useTheme } from '@/theme';
import { Avatar, Button, EmptyState, Header, Icon, ListRow, ListSection, withAlpha } from '@/ui';
import { showUserProfile } from './profile/present';

export function VoiceRoomView({ info, onBack, onOpenInfo }: { info: RoomInfo; onBack?: () => void; onOpenInfo?: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const instance = useInstance();
  const connected = useIsConnectedTo(info.id);
  const occupants = useVoiceOccupants(info.id, info.spaceId ?? null);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header title={info.name} leadingIcon="volume-high" onBack={onBack} onTitlePress={onOpenInfo} subtitle={occupants.length ? t('voice.participants', { count: occupants.length }) : undefined} />
      {!instance.voiceEnabled ? (
        <EmptyState icon="volume-xmark" body={t('space.voiceUnsupported')} size="page" />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }}>
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 16 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(theme.colors.primary, 0.2) }}>
              <Icon name="volume-high" size={28} />
            </View>
            {connected ? (
              <Button title={t('mobile.room.openCall')} icon="phone" size="lg" onPress={() => openCallScreen({ roomId: info.id, spaceId: info.spaceId ?? null })} />
            ) : (
              <Button
                title={t('voice.join')}
                icon="phone"
                size="lg"
                onPress={() => void joinVoiceFromUi(info.id, { video: false, spaceId: info.spaceId ?? null })}
              />
            )}
          </View>
          {occupants.length ? (
            <ListSection title={t('voice.participants', { count: occupants.length })}>
              {occupants.map((o) => (
                <ListRow
                  key={o.userId}
                  title={o.name}
                  leading={<Avatar uri={o.avatar} name={o.name} size="md" />}
                  trailing={
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {o.video ? <Icon name="video" size={13} tone="muted" accessibilityLabel={t('voice.status.video')} /> : null}
                      {o.streaming ? <Icon name="display" size={13} tone="danger" accessibilityLabel={t('voice.status.streaming')} /> : null}
                      {o.selfDeaf || o.serverDeaf ? (
                        <Icon name="headphones" size={13} tone={o.serverDeaf ? 'danger' : 'muted'} accessibilityLabel={o.serverDeaf ? t('voice.status.serverDeafened') : t('voice.status.deafened')} />
                      ) : o.selfMute || o.serverMute ? (
                        <Icon name="microphone-slash" size={13} tone={o.serverMute ? 'danger' : 'muted'} accessibilityLabel={o.serverMute ? t('voice.status.serverMuted') : t('voice.status.muted')} />
                      ) : null}
                    </View>
                  }
                  onPress={() => showUserProfile(o.userId, { roomId: info.id, spaceId: info.spaceId })}
                />
              ))}
            </ListSection>
          ) : (
            <EmptyState icon="user-group" body={t('voice.empty')} />
          )}
        </ScrollView>
      )}
    </View>
  );
}
