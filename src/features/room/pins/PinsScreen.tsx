/**
 * Pinned messages (the web's RoomPinnedPanel) as a pushed screen. Pins live on the server and
 * are shared by everyone in the room; the list is decrypted like history, newest pin first.
 * Tap a card: back to the conversation, scrolled to the message (an around-window is loaded
 * when it is not). Long press: Jump / Copy text / Unpin. Unpinning (anyone in a PM, Manage
 * Messages in a space) also has its own button, and can be undone from the toast. Pull to
 * refresh re-reads the pins.
 */
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pinMessage, refreshRoomPins, unpinMessage } from '@web/stores/pinnedMessages';
import { getMessageBodyText } from '@web/components/messageList/utils';
import type { DecryptedMessage } from '@web/stores/messages';
import { t } from '@web/i18n/t';
import { isPlaceholderBody, useEnsureRoomPins, usePinnedMessage, usePinnedMessageIds, usePinsState, useRoomGates, useRoomInfo } from '@/data';
import { useTheme } from '@/theme';
import { EmptyState, Header, IconButton, Spinner, showActionSheet, toast } from '@/ui';
import { MessageCard } from '../shared/MessageCard';
import { goBack, goToMessage } from '../navigation';
import { copyText, errorMessage } from '../util';
import { ReadableWidth } from '../shared/ReadableWidth';

function unpin(roomId: string, messageId: string) {
  void unpinMessage(roomId, messageId)
    .then(() =>
      toast({
        message: t('mobile.room.unpinned'),
        action: { label: t('mobile.room.undo'), onPress: () => void pinMessage(roomId, messageId).catch((e: unknown) => toast.error(errorMessage(e))) },
      }),
    )
    .catch((e: unknown) => toast.error(errorMessage(e)));
}

function PinCard({ roomId, spaceId, messageId, canPin }: { roomId: string; spaceId: string | null; messageId: string; canPin: boolean }) {
  const msg = usePinnedMessage(roomId, messageId);
  if (!msg) return null;
  const jump = () => goToMessage({ roomId, messageId, spaceId, originRoomId: roomId });
  const actions = (m: DecryptedMessage) => {
    void showActionSheet([
      { label: t('mobile.room.jumpToMessage'), icon: 'arrow-right', onSelect: jump },
      !isPlaceholderBody(m) && m.plaintext ? { label: t('messages.actions.copyText'), icon: 'copy', onSelect: () => void copyText(getMessageBodyText(m)) } : null,
      canPin && { label: t('room.unpin'), icon: 'thumbtack', danger: true, onSelect: () => unpin(roomId, messageId) },
    ]);
  };
  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
      <MessageCard
        message={msg}
        roomId={roomId}
        spaceId={spaceId}
        onPress={jump}
        onLongPress={() => actions(msg)}
        trailing={canPin ? <IconButton icon="xmark" size="sm" tone="subtle" label={t('room.unpin')} onPress={() => unpin(roomId, messageId)} /> : null}
        testID={`pin-${messageId}`}
      />
    </View>
  );
}

export function PinsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ roomId: string; spaceId?: string }>();
  const roomId = String(params.roomId ?? '');
  const info = useRoomInfo(roomId, typeof params.spaceId === 'string' ? params.spaceId : null);
  const spaceId = (typeof params.spaceId === 'string' && params.spaceId) || info?.spaceId || null;
  useEnsureRoomPins(roomId);
  const ids = usePinnedMessageIds(roomId);
  const state = usePinsState(roomId);
  const gates = useRoomGates(roomId, spaceId);
  const [refreshing, setRefreshing] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header
        title={t('room.pinned')}
        subtitle={info ? (state.count ? `${info.name} · ${state.count}` : info.name) : undefined}
        leadingIcon="thumbtack"
        onBack={goBack}
      />
      {!state.loaded && ids.length === 0 ? (
        <Spinner fill label={t('common.loading')} />
      ) : (
        <ReadableWidth>
          <FlashList
            data={ids}
            keyExtractor={(id) => id}
            extraData={!!gates?.canPin}
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: insets.bottom + 16 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void refreshRoomPins(roomId)
                    .catch((e: unknown) => toast.error(errorMessage(e)))
                    .finally(() => setRefreshing(false));
                }}
                tintColor={theme.colors.primary}
                colors={[theme.colors.primary]}
              />
            }
            ListEmptyComponent={<EmptyState icon="thumbtack" body={t('room.pinnedEmpty')} size="page" />}
            renderItem={({ item }) => <PinCard roomId={roomId} spaceId={spaceId} messageId={item} canPin={!!gates?.canPin} />}
          />
        </ReadableWidth>
      )}
    </View>
  );
}
