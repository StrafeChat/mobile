/**
 * Discord's "Create Thread" form (the web's CreateThreadModal) as a bottom sheet: the
 * starting message's preview (when started from one - the name is suggested from it), the
 * name (plain text, up to 100 characters), how long until it archives without activity, and
 * - for a thread not started from a message, with Create Private Threads - whether it is
 * private. Creating puts the thread in the store and opens it. The sheet can't be dismissed
 * while the request is in flight; errors are the server's own, translated.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  DEFAULT_THREAD_AUTO_ARCHIVE,
  MAX_THREAD_NAME_LENGTH,
  THREAD_AUTO_ARCHIVE_OPTIONS,
  createThread,
  createThreadFromMessage,
} from '@web/api/threads';
import { upsertSpaceRoomFromPayload } from '@web/stores/spaces';
import { messages } from '@web/stores/messages';
import { spaceMembers } from '@web/stores/spaceMembers';
import { auth } from '@web/stores/auth';
import { getMessageBodyText, messagePreviewText } from '@web/components/messageList/utils';
import { t } from '@web/i18n/t';
import { useRoomGates } from '@/data';
import { useTheme } from '@/theme';
import { Button, Checkbox, Input, SegmentedControl, Sheet, Text, haptics, useExternalStore, withAlpha } from '@/ui';
import { closeCreateThread, createThreadStore, type CreateThreadRequest } from '../presenters';
import { errorMessage } from '../util';
import { openThreadScreen } from '../navigation';
import { plainThreadName } from './threadActions';

type Minutes = `${(typeof THREAD_AUTO_ARCHIVE_OPTIONS)[number]}`;

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

/** The starting message as people read it - never the wire form (`<#id>` would sit in the name). */
export function starterPreview(roomId: string, messageId: string, spaceId: string): string {
  const m = messages.byRoom[roomId]?.find((x) => x.id === messageId);
  if (!m) return '';
  return messagePreviewText(getMessageBodyText(m), spaceMembers.bySpaceId[spaceId] ?? [], auth.user?.id, MAX_THREAD_NAME_LENGTH);
}

function CreateThreadForm({ request, busy, setBusy }: { request: CreateThreadRequest; busy: boolean; setBusy: (b: boolean) => void }) {
  const theme = useTheme();
  const gates = useRoomGates(request.roomId, request.spaceId);
  const allowPrivate = !!gates?.canCreatePrivateThreads;
  const starter = request.starterMessageId ? starterPreview(request.roomId, request.starterMessageId, request.spaceId) : null;
  const [name, setName] = useState(() => (starter ?? '').slice(0, MAX_THREAD_NAME_LENGTH));
  const [archive, setArchive] = useState<Minutes>(String(DEFAULT_THREAD_AUTO_ARCHIVE) as Minutes);
  const [isPrivate, setIsPrivate] = useState(() => !!request.privateDefault && allowPrivate && !request.starterMessageId);
  const [error, setError] = useState('');

  async function create() {
    const n = plainThreadName(name, request.spaceId);
    if (!n) {
      setError(t('threads.nameRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const input = { name: n, auto_archive_minutes: Number(archive) };
      const raw = request.starterMessageId
        ? await createThreadFromMessage(request.roomId, request.starterMessageId, input)
        : await createThread(request.roomId, { ...input, private: isPrivate && allowPrivate });
      const room = upsertSpaceRoomFromPayload(request.spaceId, raw);
      haptics.success();
      setBusy(false);
      closeCreateThread();
      if (room) openThreadScreen(room.id, request.spaceId);
    } catch (e) {
      setError(errorMessage(e, 'threads.createFailed'));
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 16, paddingTop: 8 }}>
      {starter ? (
        <View style={{ padding: 10, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: withAlpha(theme.colors.muted, 0.2) }}>
          <Text variant="caption" numberOfLines={3}>
            {starter}
          </Text>
        </View>
      ) : null}
      <Input
        label={t('threads.nameLabel')}
        placeholder={t('threads.namePlaceholder')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError('');
        }}
        maxLength={MAX_THREAD_NAME_LENGTH}
        autoFocus
        disabled={busy}
        error={error || undefined}
        returnKeyType="done"
        onSubmitEditing={() => void create()}
      />
      <View style={{ gap: 6 }}>
        <Text variant="label">{t('threads.autoArchiveLabel')}</Text>
        <SegmentedControl<Minutes>
          value={archive}
          onChange={setArchive}
          accessibilityLabel={t('threads.autoArchiveLabel')}
          items={THREAD_AUTO_ARCHIVE_OPTIONS.map((m) => ({ id: String(m) as Minutes, label: durationLabel(m) }))}
        />
      </View>
      {!request.starterMessageId && allowPrivate ? (
        <Checkbox checked={isPrivate} onChange={setIsPrivate} disabled={busy} label={t('threads.privateLabel')} description={t('threads.privateHint')} />
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={t('common.cancel')} variant="ghost" style={{ flex: 1 }} disabled={busy} onPress={closeCreateThread} />
        <Button title={t('threads.create')} style={{ flex: 1 }} loading={busy} disabled={busy} onPress={() => void create()} />
      </View>
    </View>
  );
}

/** Root-mounted: renders whatever openCreateThread asked for. */
export function CreateThreadSheetHost() {
  const request = useExternalStore(createThreadStore);
  const [busy, setBusy] = useState(false);
  const last = useRef(request);
  if (request) last.current = request;
  const shown = last.current;
  useEffect(() => {
    if (!request) setBusy(false);
  }, [request]);
  const formKey = shown ? String(shown.id) : '';
  return (
    <Sheet
      open={!!request}
      onClose={() => {
        if (!busy) closeCreateThread();
      }}
      dismissible={!busy}
      icon="comments"
      title={shown?.starterMessageId ? t('threads.createFromMessageTitle') : t('threads.createTitle')}
      description={shown?.starterMessageId ? t('threads.createFromMessageBody') : t('threads.createBody')}
      scrollable
      testID="create-thread-sheet"
    >
      {shown ? <CreateThreadForm key={formKey} request={shown} busy={busy} setBusy={setBusy} /> : null}
    </Sheet>
  );
}
