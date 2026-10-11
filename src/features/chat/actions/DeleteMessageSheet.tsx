/**
 * "Delete Message" (the web's DeleteMessageModal, a bottom sheet on phones): danger tone, the
 * question, and a preview card of what is about to go - author, time, the raw text clamped to
 * six lines. Delete calls the API and drops the row locally; other clients drop it through
 * MESSAGE_DELETE. Unlike the web (which only logs), a failure says so. There is no Shift-click
 * on a phone, so the protip is not shown.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { deleteMessage as deleteMessageApi } from '@web/api/messages';
import { setMessages, type DecryptedMessage } from '@web/stores/messages';
import { getMessageBodyText } from '@web/components/messageList/utils';
import { formatMessageTimestamp } from '@web/lib/utils/datetime';
import { useUserDisplay } from '@/data';
import { useTheme } from '@/theme';
import { Avatar, Button, createExternalStore, haptics, Sheet, Text, toast, useExternalStore } from '@/ui';
import { useHostSlot } from '../hostSlot';
import { errorText } from '../navigation';

export interface DeleteRequest {
  roomId: string;
  spaceId: string | null;
  message: DecryptedMessage;
}

const deleteStore = createExternalStore<DeleteRequest | null>(null);

export function confirmDeleteMessage(req: DeleteRequest): void {
  deleteStore.set(req);
}

/** Delete now (after the confirmation): the web's doDelete, plus an error toast. */
export async function deleteMessageNow(roomId: string, messageId: string): Promise<boolean> {
  try {
    await deleteMessageApi(roomId, messageId);
    setMessages('byRoom', roomId, (prev: DecryptedMessage[] | undefined) => (prev ?? []).filter((m) => m.id !== messageId));
    return true;
  } catch (err) {
    toast.error(errorText(err) || t('common.deleteFailed'));
    return false;
  }
}

export function DeleteMessageHost() {
  const isHost = useHostSlot('chat.deleteMessage');
  const req = useExternalStore(deleteStore);
  if (!isHost) return null;
  return <DeleteMessageSheet request={req} onClose={() => deleteStore.set(null)} />;
}

function DeleteMessageSheet({ request, onClose }: { request: DeleteRequest | null; onClose: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const msg = request?.message;
  const sender = useUserDisplay(msg?.sender_id, { roomId: request?.roomId ?? null, spaceId: request?.spaceId ?? null });
  if (!request || !msg) return null;
  const confirm = async () => {
    setBusy(true);
    const ok = await deleteMessageNow(request.roomId, msg.id);
    setBusy(false);
    if (ok) {
      haptics.success();
      setOpen(false);
    }
  };
  return (
    <Sheet
      key={msg.id}
      open={open}
      onClose={() => {
        setOpen(true);
        onClose();
      }}
      title={t('messages.actions.delete')}
      description={t('messages.deleteConfirm')}
      icon="fa-solid fa-trash"
      tone="danger"
      dismissible={!busy}
    >
      <View style={[styles.preview, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, borderRadius: theme.radii.lg }]}>
        <Avatar uri={sender?.avatar ?? null} name={sender?.name ?? '?'} size="lg" />
        <View style={styles.flex}>
          <View style={styles.head}>
            <Text variant="label" weight="semibold" numberOfLines={1} style={styles.shrink}>
              {sender?.name ?? t('common.unknown')}
            </Text>
            <Text variant="caption">{formatMessageTimestamp(new Date(msg.created_at))}</Text>
          </View>
          <Text variant="body" tone="muted" numberOfLines={6}>
            {getMessageBodyText(msg)}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button title={t('common.cancel')} variant="outline" onPress={() => setOpen(false)} disabled={busy} style={styles.flex} />
        <Button title={t('common.delete')} variant="destructive" onPress={() => void confirm()} loading={busy} style={styles.flex} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 12 },
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 2 },
  shrink: { flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
});
