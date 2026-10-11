/**
 * Space settings -> Emojis (SpaceEmojiSettings): upload (an image under 512 KB, a name filled
 * in from the file name, 2-32 letters, numbers or underscores; at most 50 per space), rename
 * in place (saved when the field is left or submitted, put back on failure), and delete.
 * The list refreshes from the server when the page opens and keeps the shared emoji store
 * current, so pickers everywhere see the change.
 */
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { t } from '@web/i18n/t';
import { EMOJIS_PER_SPACE, EMOJI_MAX_BYTES, deleteSpaceEmoji, listSpaceEmojis, renameSpaceEmoji, uploadSpaceEmoji, type CustomEmoji } from '@web/api/emojis';
import { customEmojis, setCustomEmojis } from '@web/stores/customEmojis';
import { confirmDialog } from '@web/stores/confirmDialog';
import { formatFileSize } from '@web/lib/attachments/format';
import type { LocalFile } from '@/platform/media';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Button, EmptyState, Icon, IconButton, Input, ListSection, MONO_FONT, Text, Touchable, fieldBoxStyle, withAlpha } from '@/ui';
import { FormCard, Note } from '../components/rows';
import { asUploadFile, pickImage } from '../hooks/pickImage';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

export const EMOJI_NAME_RE = /^[A-Za-z0-9_]{2,32}$/;
const EMOJI_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** "Party Blob.png" -> "party_blob" (the web's nameFromFile). */
export function emojiNameFromFile(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 32);
}

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

function Emojis({ data }: { data: SpaceSettingsData }) {
  const theme = useTheme();
  const list = useSolid(() => customEmojis.bySpaceId[data.spaceId] ?? [], [data.spaceId]) as CustomEmoji[];
  const [error, setError] = useState('');
  const [file, setFile] = useState<LocalFile | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const full = list.length >= EMOJIS_PER_SPACE;

  useEffect(() => {
    listSpaceEmojis(data.spaceId)
      .then((emojis) => {
        setCustomEmojis('bySpaceId', data.spaceId, sortByName(emojis));
        for (const e of emojis) setCustomEmojis('byId', e.id, e);
      })
      .catch(() => undefined);
  }, [data.spaceId]);

  async function choose() {
    const pick = await pickImage({ title: t('spaceEmoji.chooseImage'), accept: EMOJI_TYPES, camera: false });
    if (pick.status === 'cancelled') return;
    if (pick.status === 'error') {
      setError(pick.message);
      return;
    }
    setFile(pick.file);
    if (!name) setName(emojiNameFromFile(pick.file.name));
    setError('');
  }

  async function upload() {
    if (!file) return;
    const n = name.trim();
    if (file.size > EMOJI_MAX_BYTES) {
      setError(t('spaceEmoji.tooLarge', { max: formatFileSize(EMOJI_MAX_BYTES) }));
      return;
    }
    if (!EMOJI_NAME_RE.test(n)) {
      setError(t('spaceEmoji.nameRule'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await uploadSpaceEmoji(data.spaceId, asUploadFile(file), n);
      setCustomEmojis('byId', created.id, created);
      setCustomEmojis('bySpaceId', data.spaceId, (prev) => sortByName([...(prev ?? []).filter((e) => e.id !== created.id), created]));
      setFile(null);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceEmoji.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <Note tone="danger">{error}</Note> : null}
      <ListSection title={t('spaceEmoji.uploadTitle')} card={false}>
        <FormCard>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" style={{ flex: 1 }}>
              {t('spaceEmoji.uploadHint', { max: formatFileSize(EMOJI_MAX_BYTES) })} :name:.
            </Text>
            <Text variant="caption" weight="semibold">
              {list.length} / {EMOJIS_PER_SPACE}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
            <Touchable
              feedback="opacity"
              onPress={() => void choose()}
              disabled={busy || full}
              accessibilityRole="button"
              accessibilityLabel={t('spaceEmoji.chooseImage')}
              style={{
                width: 72,
                height: 72,
                borderRadius: theme.radii.lg,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: theme.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {file ? <Image source={{ uri: file.uri }} style={{ width: 64, height: 64 }} contentFit="contain" /> : <Icon name="image" size={22} tone="muted" />}
            </Touchable>
            <View style={{ flex: 1 }}>
              <Input label={t('common.name')} value={name} placeholder="party_blob" maxLength={32} autoCapitalize="none" autoCorrect={false} onChangeText={setName} disabled={busy} testID="emoji-name" />
            </View>
          </View>
          <Button title={t('common.upload')} icon="upload" loading={busy} disabled={!file || !name.trim() || full} onPress={() => void upload()} testID="emoji-upload" />
        </FormCard>
      </ListSection>
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
