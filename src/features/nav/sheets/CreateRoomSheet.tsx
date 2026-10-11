/**
 * Create a room (CreateSpaceRoomModal) or a section (CreateSpaceSectionModal).
 *
 * Room: Text or Voice, a name (max 100), end-to-end encryption for text rooms, and - an
 * addition on the phone, where there is no "+" beside every section to aim with - a section
 * picker. It starts on the section the sheet was opened from, else the web's default: the
 * first section whose name contains "text" / "voice" for that type, else the top level.
 * POST /spaces/:sid/rooms, then refreshSpaceRooms. Both sheets keep errors inline and cannot be
 * dismissed while the request is in flight.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { createSpaceRoom } from '@web/api/spaces';
import { refreshSpaceRooms, spaces } from '@web/stores/spaces';
import { useSolid } from '@/bridge/solid';
import { ROOM_TYPE_SECTION, ROOM_TYPE_TEXT, ROOM_TYPE_VOICE } from '@/data';
import { Button, Checkbox, Input, SegmentedControl, Select, Sheet, Text } from '@/ui';
import { errorMessage } from '../actions';

type RoomKind = 'text' | 'voice';

/** The web's default parent: a section named like the room type, when the space still has one. */
export function defaultParentSection(sections: readonly { id: string; name: string }[], kind: RoomKind): string | null {
  const want = kind === 'voice' ? 'voice' : 'text';
  return sections.find((s) => (s.name ?? '').toLowerCase().includes(want))?.id ?? null;
}

export interface CreateRoomSheetProps {
  spaceId: string;
  parentSectionId: string | null;
  open: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
}

export function CreateRoomSheet({ spaceId, parentSectionId, open, onRequestClose, onClosed }: CreateRoomSheetProps) {
  const sections = useSolid(
    () =>
      (spaces.spaceRoomsBySpaceId[spaceId] ?? [])
        .filter((r) => r.type === ROOM_TYPE_SECTION)
        .sort((a, b) => a.position - b.position)
        .map((r) => ({ id: r.id, name: r.name })),
    [spaceId],
  );
  const [kind, setKind] = useState<RoomKind>('text');
  const [name, setName] = useState('');
  const [e2ee, setE2ee] = useState(false);
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const parent = picked !== undefined ? picked : (parentSectionId ?? defaultParentSection(sections, kind));
  const forcedName = parentSectionId ? sections.find((s) => s.id === parentSectionId)?.name : undefined;
  const options = useMemo(
    () => [
      { value: '', label: t('mobile.nav.noSection'), icon: 'fa-layer-group' },
      ...sections.map((s) => ({ value: s.id, label: s.name || t('space.unnamed'), icon: 'fa-folder' })),
    ],
    [sections],
  );

  async function submit() {
    const n = name.trim();
    setError('');
    if (!n) {
      setError(t('common.nameRequired'));
      return;
    }
    setLoading(true);
    try {
      await createSpaceRoom(spaceId, {
        name: n,
        type: kind === 'voice' ? ROOM_TYPE_VOICE : ROOM_TYPE_TEXT,
        ...(parent ? { parent_id: parent } : {}),
        ...(e2ee && kind === 'text' ? { e2ee_enabled: true } : {}),
      });
    } catch (err) {
      setError(errorMessage(err, 'createRoom.failed'));
      setLoading(false);
      return;
    }
    // Created: a list refresh that fails is not a failed create (saying so would invite a
    // second, duplicate room); the gateway's room event or the next refresh brings it in.
    await refreshSpaceRooms(spaceId).catch(() => undefined);
    setLoading(false);
    onRequestClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClosed}
      title={t('createRoom.title')}
      description={
        forcedName
          ? `${t('createRoom.underSectionBefore')} ${forcedName}${t('createRoom.underSectionAfter')}`
          : t('createRoom.description')
      }
      dismissible={!loading}
      scrollable
    >
      <View style={styles.body}>
        <SegmentedControl<RoomKind>
          value={kind}
          onChange={setKind}
          accessibilityLabel={t('createRoom.typeLabel')}
          items={[
            { id: 'text', label: t('createRoom.typeText'), icon: 'fa-hashtag', disabled: loading },
            { id: 'voice', label: t('createRoom.typeVoice'), icon: 'fa-volume-high', disabled: loading },
          ]}
        />
        <Text variant="caption">{kind === 'voice' ? t('createRoom.typeVoiceHint') : t('createRoom.typeTextHint')}</Text>
        <Input
          label={t('createRoom.name')}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError('');
          }}
          placeholder={kind === 'voice' ? t('createRoom.voicePlaceholder') : t('space.defaultRoom')}
          leftIcon={kind === 'voice' ? 'fa-volume-high' : 'fa-hashtag'}
          maxLength={100}
          disabled={loading}
          error={error || undefined}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        {sections.length > 0 ? (
          <Select
            label={t('mobile.nav.section')}
            value={parent ?? ''}
            options={options}
            onValueChange={(v) => setPicked(v || null)}
            sheetTitle={t('mobile.nav.section')}
            disabled={loading}
          />
        ) : null}
        {kind === 'text' ? (
          <Checkbox
            checked={e2ee}
            onChange={setE2ee}
            disabled={loading}
            label={t('createRoom.e2ee')}
            description={t('createRoom.e2eeDescription')}
          />
        ) : null}
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="outline" disabled={loading} onPress={onRequestClose} style={styles.flex} />
          <Button title={t('createRoom.submit')} loading={loading} disabled={!name.trim()} onPress={() => void submit()} style={styles.flex} />
        </View>
      </View>
    </Sheet>
  );
}

export interface CreateSectionSheetProps {
  spaceId: string;
  open: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
}

export function CreateSectionSheet({ spaceId, open, onRequestClose, onClosed }: CreateSectionSheetProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const n = name.trim();
    setError('');
    if (!n) {
      setError(t('common.nameRequired'));
      return;
    }
    setLoading(true);
    try {
      await createSpaceRoom(spaceId, { name: n, type: ROOM_TYPE_SECTION });
    } catch (err) {
      setError(errorMessage(err, 'createSection.failed'));
      setLoading(false);
      return;
    }
    await refreshSpaceRooms(spaceId).catch(() => undefined);
    setLoading(false);
    onRequestClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClosed}
      title={t('createSection.title')}
      description={t('createSection.description')}
      icon="fa-folder"
      dismissible={!loading}
    >
      <View style={styles.body}>
        <Input
          label={t('createSection.name')}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError('');
          }}
          placeholder={t('createSection.namePlaceholder')}
          maxLength={100}
          disabled={loading}
          error={error || undefined}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="outline" disabled={loading} onPress={onRequestClose} style={styles.flex} />
          <Button title={t('createSection.submit')} loading={loading} disabled={!name.trim()} onPress={() => void submit()} style={styles.flex} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
});
