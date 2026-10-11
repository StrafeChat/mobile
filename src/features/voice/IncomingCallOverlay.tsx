/**
 * An incoming PM call, full screen (the web's IncomingCallModal, as a phone's incoming-call
 * screen): the caller's avatar pulsing, "Incoming call", who is calling (or who started a
 * call in which group), and Decline / With video / Accept. The ringtone and vibration are
 * the voice store's (they start with the ring and stop when it is answered, declined,
 * cancelled or times out after 45 s). Android's back button declines, as Escape does on
 * the web.
 *
 * Only while the app is running: without a server push pipeline nothing rings a
 * backgrounded or closed app (see the voice engine's open issues).
 */
import { useEffect, useState } from 'react';
import { Modal, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@web/i18n/t';
import { useIncomingCall } from '@/data/voice';
import { useMyId } from '@/data/me';
import { pmDisplayName, usePmRoom } from '@/data/rooms';
import { useTheme } from '@/theme';
import { Avatar, Icon, Spinner, Text, Touchable, useReduceMotion, withAlpha } from '@/ui';
import { acceptIncomingFromUi, declineIncomingFromUi } from './join';
import { PulseRings } from './Pulse';

const ROOM_TYPE_GROUP = 2;

export function IncomingCallOverlay() {
  const incoming = useIncomingCall();
  const reduce = useReduceMotion();
  // Keep the last call's content while the modal fades out.
  const [shown, setShown] = useState(incoming);
  useEffect(() => {
    if (incoming) setShown(incoming);
  }, [incoming]);

  return (
    <Modal
      visible={!!incoming}
      animationType={reduce ? 'none' : 'fade'}
      onRequestClose={() => void declineIncomingFromUi()}
      onDismiss={() => setShown(null)}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      {shown ? <IncomingCallBody key={`${shown.roomId}:${shown.since}`} roomId={shown.roomId} startedBy={shown.startedBy} /> : null}
    </Modal>
  );
}

function IncomingCallBody({ roomId, startedBy }: { roomId: string; startedBy: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const meId = useMyId();
  const room = usePmRoom(roomId);
  const caller = room?.participants?.find((p) => p.id === startedBy);
  const callerName = caller?.display_name || caller?.username || t('common.someone');
  const isGroup = room?.type === ROOM_TYPE_GROUP;
  const roomName = room && meId ? pmDisplayName(room, meId) : '';
  const subtitle = isGroup ? t('voice.incoming.group', { name: callerName, room: roomName }) : t('voice.incoming.from', { name: callerName });
  const [busy, setBusy] = useState<'audio' | 'video' | null>(null);
  const avatarSize = height < 640 ? 88 : 112;

  async function accept(video: boolean) {
    if (busy) return;
    setBusy(video ? 'video' : 'audio');
    try {
      await acceptIncomingFromUi(video);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View
      testID="voice-incoming-call"
      accessibilityViewIsModal
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 28,
        paddingHorizontal: 24,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text variant="overline" accessibilityRole="header">
          {t('voice.incoming.title')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="lock" size={10} color={theme.colors.primary} />
          <Text variant="caption">{t('voice.e2ee')}</Text>
        </View>
      </View>

      <View style={{ alignItems: 'center', gap: 20, maxWidth: 420 }} accessible accessibilityLabel={`${t('voice.incoming.title')}. ${subtitle}`} accessibilityLiveRegion="assertive">
        <PulseRings color={withAlpha(theme.colors.primary, 0.5)} size={avatarSize}>
          <Avatar uri={caller?.avatar} name={callerName} size={avatarSize} />
        </PulseRings>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text variant="title" align="center" numberOfLines={2}>
            {isGroup ? roomName || callerName : callerName}
          </Text>
          <Text tone="muted" align="center">
            {subtitle}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', alignSelf: 'stretch', maxWidth: 420, width: '100%' }}>
        <CallAction
          testID="voice-incoming-decline"
          icon="phone-slash"
          label={t('voice.incoming.decline')}
          bg={theme.colors.destructive}
          fg={theme.colors.destructiveForeground}
          disabled={!!busy}
          onPress={() => void declineIncomingFromUi()}
        />
        <CallAction
          testID="voice-incoming-video"
          icon="video"
          label={t('voice.incoming.acceptVideo')}
          bg={theme.colors.secondary}
          fg={theme.colors.secondaryForeground}
          busy={busy === 'video'}
          disabled={!!busy}
          onPress={() => void accept(true)}
        />
        <CallAction
          testID="voice-incoming-accept"
          icon="phone"
          label={t('voice.incoming.accept')}
          bg={theme.colors.success}
          fg={theme.colors.primaryForeground}
          busy={busy === 'audio'}
          disabled={!!busy}
          onPress={() => void accept(false)}
        />
      </View>
    </View>
  );
}

function CallAction({
  icon,
  label,
  bg,
  fg,
  busy,
  disabled,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  bg: string;
  fg: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 8, width: 96 }}>
      <Touchable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        pressedColor={withAlpha(bg, 0.8)}
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled, busy: !!busy }}
        style={{
          width: 68,
          height: 68,
          borderRadius: 34,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled && !busy ? 0.6 : 1,
        }}
      >
        {busy ? <Spinner decorative color={fg} /> : <Icon name={icon} size={26} color={fg} />}
      </Touchable>
      <Text variant="caption" align="center" numberOfLines={2} accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
    </View>
  );
}
