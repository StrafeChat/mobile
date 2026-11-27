/**
 * Space settings -> Emojis (SpaceEmojiSettings): upload one or many custom emoji, rename in
 * place (saved when the field is left or submitted, put back on failure), and delete.
 *
 * Uploading is the web's bulk flow on the web's own logic (`@web/lib/emojiBulk`): pick any
 * number of images from the photo library or Files, review the names (from the file names,
 * made unique) and the problems the server would refuse (type, size, name, slots), then upload
 * in batches with progress - one refusal never stops the rest, and a failed row stays to be
 * fixed and retried. The list refreshes from the server when the page opens and keeps the
 * shared emoji store current, so pickers everywhere see the change.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { t } from '@web/i18n/t';
import { EMOJIS_PER_SPACE, EMOJI_MAX_BYTES, deleteSpaceEmoji, listSpaceEmojis, renameSpaceEmoji, type CustomEmoji } from '@web/api/emojis';
import {
  EMOJI_MIME_TYPES,
  EMOJI_NAME_MAX,
  EMOJI_NAME_RE,
  EMOJI_PROBLEM_KEY,
  emojiDraftProblems,
  emojiUploadErrorText,
  freeEmojiSlots,
  namesForNewFiles,
  rememberSpaceEmoji,
  uploadEmojiItems,
} from '@web/lib/emojiBulk';
import { customEmojis, setCustomEmojis } from '@web/stores/customEmojis';
import { confirmDialog } from '@web/stores/confirmDialog';
import { formatFileSize } from '@web/lib/attachments/format';
import { pickDocuments, pickFromLibrary, type LocalFile, type PickResult } from '@/platform/media';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Button, EmptyState, IconButton, ListSection, MONO_FONT, Spinner, Text, fieldBoxStyle, showActionSheet, withAlpha } from '@/ui';
import { FormCard, Note } from '../components/rows';
import { asUploadFile } from '../hooks/pickImage';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

export { EMOJI_NAME_RE, emojiNameFromFile } from '@web/lib/emojiBulk';

function sortByName(list: CustomEmoji[]): CustomEmoji[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function EmojiRow({ spaceId, emoji, onError }: { spaceId: string; emoji: CustomEmoji; onError: (m: string) => void }) {
  const theme = useTheme();
  const [name, setName] = useState(emoji.name);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => setName(emoji.name), [emoji.name]);

  async function save() {
    const n = name.trim();
    if (n === emoji.name) return;
    if (!EMOJI_NAME_RE.test(n)) {
      onError(t('spaceEmoji.nameRule'));
      setName(emoji.name);
      return;
    }
    setBusy(true);
    onError('');
    try {
      const updated = await renameSpaceEmoji(spaceId, emoji.id, n);
      setCustomEmojis('byId', updated.id, updated);
      setCustomEmojis('bySpaceId', spaceId, (list) => (list ?? []).map((e) => (e.id === updated.id ? updated : e)));
    } catch (e) {
      onError(e instanceof Error ? e.message : t('spaceEmoji.renameFailed'));
      setName(emoji.name);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: t('spaceEmoji.deleteTitle'),
      body: t('spaceEmoji.deleteConfirm', { name: emoji.name }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
      icon: 'fa-solid fa-trash',
    });
    if (!ok) return;
    setBusy(true);
    onError('');
    try {
      await deleteSpaceEmoji(spaceId, emoji.id);
      setCustomEmojis('bySpaceId', spaceId, (list) => (list ?? []).filter((e) => e.id !== emoji.id));
    } catch (e) {
      onError(e instanceof Error ? e.message : t('spaceEmoji.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, minHeight: 52 }}>
      <Image source={{ uri: emoji.url }} style={{ width: 32, height: 32 }} contentFit="contain" accessibilityLabel={`:${emoji.name}:`} />
      <View style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 40, direction: 'ltr' }, fieldBoxStyle(theme, { focused, disabled: busy })]}>
        <Text tone="muted">:</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            void save();
          }}
          onSubmitEditing={() => void save()}
          editable={!busy}
          maxLength={32}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel={t('spaceEmoji.nameFor', { name: emoji.name })}
          style={{ flex: 1, color: theme.colors.foreground, fontFamily: MONO_FONT, fontSize: theme.font(14), paddingHorizontal: 2 }}
        />
        <Text tone="muted">:</Text>
      </View>
      {emoji.animated ? (
        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: withAlpha(theme.colors.primary, 0.15) }}>
          <Text variant="caption" tone="primary" weight="semibold">
            GIF
          </Text>
        </View>
      ) : null}
      <IconButton icon="trash" tone="danger" label={t('spaceEmoji.deleteNamed', { name: emoji.name })} disabled={busy} onPress={() => void remove()} />
    </View>
  );
}

/** One image under review. */
interface DraftRow {
  key: string;
  file: LocalFile;
  name: string;
  status: 'ready' | 'uploading' | 'error';
  error?: string;
}

let draftSeq = 0;

function DraftItem({ row, problem, busy, onName, onRemove }: { row: DraftRow; problem: string | null; busy: boolean; onName: (name: string) => void; onRemove: () => void }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const bad = row.status === 'error' || (row.status === 'ready' && problem !== null);
  const status =
    row.status === 'uploading'
      ? t('spaceEmoji.bulk.statusUploading')
      : row.status === 'error'
        ? (row.error ?? t('spaceEmoji.uploadFailed'))
        : (problem ?? t('spaceEmoji.bulk.statusReady'));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 }} testID="emoji-review-row">
      <Image source={{ uri: row.file.uri }} style={{ width: 40, height: 40 }} contentFit="contain" accessibilityIgnoresInvertColors />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={[{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 40, direction: 'ltr' }, fieldBoxStyle(theme, { focused, disabled: busy, error: bad })]}>
          <Text tone="muted">:</Text>
          <TextInput
            value={row.name}
            onChangeText={onName}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={!busy}
            maxLength={EMOJI_NAME_MAX + 2}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel={t('spaceEmoji.nameFor', { name: row.file.name })}
            style={{ flex: 1, color: theme.colors.foreground, fontFamily: MONO_FONT, fontSize: theme.font(14), paddingHorizontal: 2 }}
          />
          <Text tone="muted">:</Text>
        </View>
        <Text variant="caption" numberOfLines={1}>
          {row.file.name} · {formatFileSize(row.file.size)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {row.status === 'uploading' ? <Spinner decorative /> : null}
          <Text variant="caption" tone={bad ? 'danger' : 'muted'} testID="emoji-review-status">
            {status}
          </Text>
        </View>
      </View>
      <IconButton icon="xmark" label={t('spaceEmoji.bulk.remove', { name: row.file.name })} disabled={busy} onPress={onRemove} />
    </View>
  );
}

function Emojis({ data }: { data: SpaceSettingsData }) {
  const theme = useTheme();
  const list = useSolid(() => customEmojis.bySpaceId[data.spaceId] ?? [], [data.spaceId]) as CustomEmoji[];
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const free = freeEmojiSlots(list.length);

  const problems = useMemo(
    () =>
      emojiDraftProblems(
        rows.map((r) => ({ key: r.key, name: r.name, filename: r.file.name, size: r.file.size })),
        { existingNames: list.map((e) => e.name), free, maxBytes: EMOJI_MAX_BYTES },
      ),
    [rows, list, free],
  );
  const sendable = rows.filter((r) => r.status !== 'uploading' && problems[r.key] == null);

  useEffect(() => {
    listSpaceEmojis(data.spaceId)
      .then((emojis) => {
        setCustomEmojis('bySpaceId', data.spaceId, sortByName(emojis));
        for (const e of emojis) setCustomEmojis('byId', e.id, e);
      })
      .catch(() => undefined);
  }, [data.spaceId]);

  useEffect(() => () => abort.current?.abort(), []);

  // Count the rate-limit wait down, so the line under the bar stays true.
  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = setTimeout(() => setWaitSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  function addPicked(res: PickResult) {
    if (res.status === 'cancelled') return;
    if (res.status !== 'picked') {
      setError(res.status === 'denied' ? t('mobile.media.cameraDenied') : res.message || t('spaceEmoji.uploadFailed'));
      return;
    }
    setError('');
    setNotice('');
    setRows((prev) => {
      const names = namesForNewFiles(
        res.files.map((f) => f.name),
        [...list.map((e) => e.name), ...prev.map((r) => r.name)],
      );
      return [...prev, ...res.files.map((file, i): DraftRow => ({ key: `d${++draftSeq}`, file, name: names[i], status: 'ready' }))];
    });
  }

  async function choose() {
    let source: 'library' | 'files' | null = null;
    await showActionSheet(
      [
        { key: 'library', label: t('mobile.settings.chooseFromLibrary'), icon: 'images', onSelect: () => void (source = 'library') },
        { key: 'files', label: t('mobile.composer.files'), icon: 'folder-open', onSelect: () => void (source = 'files') },
      ],
      { title: t('spaceEmoji.bulk.chooseFiles') },
    );
    if (source === 'library') {
      // A selection never needs to be bigger than what the space can still take.
      addPicked(await pickFromLibrary({ limit: Math.max(1, free - rows.length), mediaTypes: ['images'] }));
    } else if (source === 'files') {
      addPicked(await pickDocuments({ multiple: true, types: [...EMOJI_MIME_TYPES] }));
    }
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function upload() {
    const items = sendable.map((r) => ({ key: r.key, file: asUploadFile(r.file), name: r.name.trim().replace(/^:+|:+$/g, ''), size: r.file.size }));
    if (items.length === 0) return;
    setError('');
    setNotice('');
    setBusy(true);
    setProgress({ done: 0, total: items.length });
    const controller = new AbortController();
    abort.current = controller;
    let done = 0;
    try {
      const summary = await uploadEmojiItems(data.spaceId, items, {
        signal: controller.signal,
        onSending: (keys) => {
          setWaitSeconds(0);
          setRows((prev) => prev.map((r) => (keys.includes(r.key) ? { ...r, status: 'uploading', error: undefined } : r)));
        },
        onWait: setWaitSeconds,
        onResult: (outcome) => {
          setProgress({ done: ++done, total: items.length });
          if (outcome.ok) {
            rememberSpaceEmoji(data.spaceId, outcome.emoji);
            setRows((prev) => prev.filter((r) => r.key !== outcome.key));
          } else {
            updateRow(outcome.key, { status: 'error', error: emojiUploadErrorText(outcome.error, t, EMOJI_MAX_BYTES, formatFileSize) });
          }
        },
      });
      setRows((prev) => prev.map((r) => (r.status === 'uploading' ? { ...r, status: 'ready' } : r)));
      const parts: string[] = [];
      if (summary.created > 0) parts.push(t('spaceEmoji.bulk.uploaded', { count: summary.created }));
      if (summary.failed > 0) parts.push(t('spaceEmoji.bulk.failedSome', { count: summary.failed }));
      if (summary.aborted) parts.push(t('spaceEmoji.bulk.stopped'));
      setNotice(parts.join(' '));
    } finally {
      abort.current = null;
      setBusy(false);
      setProgress(null);
      setWaitSeconds(0);
    }
  }

  return (
    <>
      {error ? <Note tone="danger">{error}</Note> : null}
      <ListSection title={t('spaceEmoji.uploadTitle')} card={false}>
        <FormCard>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="caption" style={{ flex: 1 }}>
              {t('spaceEmoji.uploadHint', { max: formatFileSize(EMOJI_MAX_BYTES) })} :name:.
            </Text>
            <Text variant="caption" weight="semibold">
              {list.length} / {EMOJIS_PER_SPACE}
            </Text>
          </View>
          <Button title={t('spaceEmoji.bulk.chooseFiles')} icon="images" variant="secondary" disabled={busy || free === 0} onPress={() => void choose()} testID="emoji-choose" />
          {notice ? <Note>{notice}</Note> : null}
        </FormCard>
      </ListSection>
      {rows.length > 0 ? (
        <ListSection title={t('spaceEmoji.bulk.reviewTitle')}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <Text variant="caption">
              {t('spaceEmoji.bulk.ready', { count: sendable.length })} · {t('spaceEmoji.bulk.slotsLeft', { count: free })}
            </Text>
          </View>
          {rows.map((r) => {
            const problem = problems[r.key];
            return (
              <DraftItem
                key={r.key}
                row={r}
                problem={problem ? t(EMOJI_PROBLEM_KEY[problem], { max: formatFileSize(EMOJI_MAX_BYTES) }) : null}
                busy={busy}
                onName={(name) => updateRow(r.key, r.status === 'error' ? { name, status: 'ready', error: undefined } : { name })}
                onRemove={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
              />
            );
          })}
          <View style={{ padding: 16, gap: 10 }}>
            {progress ? (
              <View style={{ gap: 6 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}>
                <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: withAlpha(theme.colors.foreground, 0.12) }}>
                  <View style={{ height: 6, width: `${(progress.done / Math.max(1, progress.total)) * 100}%`, backgroundColor: theme.colors.primary }} />
                </View>
                <Text variant="caption">
                  {waitSeconds > 0
                    ? t('spaceEmoji.bulk.waiting', { seconds: String(waitSeconds) })
                    : t('spaceEmoji.bulk.progress', { done: String(progress.done), total: String(progress.total) })}
                </Text>
              </View>
            ) : null}
            <Button
              title={t('spaceEmoji.bulk.uploadCount', { count: sendable.length })}
              icon="upload"
              loading={busy}
              disabled={sendable.length === 0}
              onPress={() => void upload()}
              testID="emoji-upload"
            />
            {busy ? (
              <Button title={t('spaceEmoji.bulk.stop')} variant="outline" onPress={() => abort.current?.abort()} />
            ) : (
              <Button title={t('spaceEmoji.bulk.clear')} variant="ghost" onPress={() => setRows([])} />
            )}
          </View>
        </ListSection>
      ) : null}
      <ListSection title={t('settings.appearance.emoji.title')}>
        {list.length === 0 ? (
          <EmptyState icon="fa-regular fa-face-smile" body={t('spaceEmoji.none')} />
        ) : (
          list.map((e) => <EmojiRow key={e.id} spaceId={data.spaceId} emoji={e} onError={setError} />)
        )}
      </ListSection>
    </>
  );
}

export function SpaceEmojisScreen() {
  return <SpacePage page="emojis">{(data) => <Emojis data={data} />}</SpacePage>;
}
