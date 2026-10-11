/**
 * "Create a thread" (the web's CreateThreadModal) from a message: the starter's preview, a
 * name prefilled from it (mention / emoji syntax resolved the way a preview reads), and how
 * long until it archives. Standalone threads (with the private option) are created by the
 * room area; pass `allowPrivate` and no starter to reuse this sheet for that.
 * On success the thread opens.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import {
  DEFAULT_THREAD_AUTO_ARCHIVE,
  MAX_THREAD_NAME_LENGTH,
  THREAD_AUTO_ARCHIVE_OPTIONS,
  createThread,
  createThreadFromMessage,
} from '@web/api/threads';
import { upsertSpaceRoomFromPayload } from '@web/stores/spaces';
import { spaceMembers } from '@web/stores/spaceMembers';
import { auth } from '@web/stores/auth';
import { messagePreviewText } from '@web/components/messageList/utils';
import { Button, Checkbox, createExternalStore, haptics, Input, Select, Sheet, Text, useExternalStore, withAlpha } from '@/ui';
import { useTheme } from '@/theme';
import { useHostSlot } from '../hostSlot';
import { errorText, openThread } from '../navigation';

export interface CreateThreadRequest {
  spaceId: string;
  /** The text channel the thread goes in. */
  roomId: string;
  starter?: { id: string; preview: string } | null;
  allowPrivate?: boolean;
  privateDefault?: boolean;
}

const threadStore = createExternalStore<CreateThreadRequest | null>(null);

export function openCreateThread(req: CreateThreadRequest): void {
  threadStore.set(req);
}

function durationLabel(minutes: number): string {
  switch (minutes) {
    case 60:
      return t('threads.autoArchive.hour');
    case 1440:
      return t('threads.autoArchive.day');
    case 4320:
      return t('threads.autoArchive.threeDays');
    default:
      return t('threads.autoArchive.week');
  }
}

export function CreateThreadHost() {
  const isHost = useHostSlot('chat.createThread');
  const req = useExternalStore(threadStore);
  if (!isHost || !req) return null;
  return <CreateThreadSheet key={`${req.roomId}:${req.starter?.id ?? ''}`} request={req} onClose={() => threadStore.set(null)} />;
}

export function CreateThreadSheet({ request, onClose }: { request: CreateThreadRequest; onClose: () => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  const [autoArchive, setAutoArchive] = useState(String(DEFAULT_THREAD_AUTO_ARCHIVE));
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(request.starter ? request.starter.preview.slice(0, MAX_THREAD_NAME_LENGTH) : '');
    setAutoArchive(String(DEFAULT_THREAD_AUTO_ARCHIVE));
    setIsPrivate(!!request.privateDefault && !!request.allowPrivate && !request.starter);
    setError('');
  }, [request]);

  const submit = async () => {
    const n = messagePreviewText(name.trim(), spaceMembers.bySpaceId[request.spaceId] ?? [], auth.user?.id, 1000)
      .slice(0, MAX_THREAD_NAME_LENGTH)
      .trim();
    if (!n) {
      setError(t('threads.nameRequired'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const input = { name: n, auto_archive_minutes: Number(autoArchive) };
      const raw = request.starter
        ? await createThreadFromMessage(request.roomId, request.starter.id, input)
        : await createThread(request.roomId, { ...input, private: isPrivate });
      const room = upsertSpaceRoomFromPayload(request.spaceId, raw);
      haptics.success();
      setOpen(false);
      if (room) openThread(room.id);
    } catch (err) {
      setError(errorText(err) || t('threads.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon="fa-solid fa-comments"
      title={request.starter ? t('threads.createFromMessageTitle') : t('threads.createTitle')}
      description={request.starter ? t('threads.createFromMessageBody') : t('threads.createBody')}
      dismissible={!loading}
      scrollable
    >
      <View style={styles.body}>
        {request.starter ? (
          <Text
            variant="caption"
            numberOfLines={2}
            style={[styles.starter, { borderColor: withAlpha(theme.colors.border, 0.7), backgroundColor: withAlpha(theme.colors.muted, 0.2), borderRadius: theme.radii.md }]}
          >
            {request.starter.preview}
          </Text>
        ) : null}
        <Input
          label={t('threads.nameLabel')}
          placeholder={t('threads.namePlaceholder')}
          value={name}
          onChangeText={setName}
          maxLength={MAX_THREAD_NAME_LENGTH}
          autoFocus
          disabled={loading}
          error={error || undefined}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        <Select
          label={t('threads.autoArchiveLabel')}
          value={autoArchive}
          onValueChange={setAutoArchive}
          options={THREAD_AUTO_ARCHIVE_OPTIONS.map((m) => ({ value: String(m), label: durationLabel(m) }))}
          disabled={loading}
        />
        {!request.starter && request.allowPrivate ? (
          <Checkbox
            checked={isPrivate}
            onChange={setIsPrivate}
            disabled={loading}
            label={t('threads.privateLabel')}
            description={t('threads.privateHint')}
          />
        ) : null}
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="ghost" onPress={() => setOpen(false)} disabled={loading} style={styles.flex} />
          <Button title={t('threads.create')} onPress={() => void submit()} loading={loading} style={styles.flex} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16, paddingTop: 12 },
  starter: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  actions: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
