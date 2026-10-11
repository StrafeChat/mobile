/**
 * Picking friends: start a group PM (CreateGroupModal) and add people to one (AddPeopleModal).
 *
 * Group: every friend with a check box - plus a search field and the chosen people as chips at
 * the top, which the web lacks and a phone needs - then POST the group with recipient_ids,
 * store it and open it. Add people: friends not already in the group, each with an Add button
 * (addRoomParticipant), closing on success.
 */
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { createGroupPM, addRoomParticipant } from '@web/api/rooms';
import { addOrUpdateRoom, rooms } from '@web/stores/rooms';
import { friendDisplayName, relationships, RelType } from '@web/stores/relationships';
import { formatHandle } from '@web/stores/instance';
import { useSolid } from '@/bridge/solid';
import { openRoom } from '@/shell/state';
import { useTheme } from '@/theme';
import { Avatar, Button, EmptyState, FieldError, Icon, SearchInput, Sheet, Text, Touchable, withAlpha } from '@/ui';
import { errorMessage } from '../actions';

export interface FriendOption {
  id: string;
  name: string;
  handle: string;
  avatar?: string;
}

/** Friends as picker rows, optionally without some ids (people already in the group). */
function useFriendOptions(exclude?: ReadonlySet<string>): FriendOption[] {
  return useSolid(
    () =>
      relationships.relationships
        .filter((r) => r.type === RelType.Friend && !exclude?.has(r.user.id))
        .map((r) => ({
          id: r.user.id,
          name: friendDisplayName(r),
          handle: formatHandle(r.user),
          ...(r.user.avatar ? { avatar: r.user.avatar } : {}),
        })),
    [exclude],
  );
}

/** Case-insensitive match on the shown name or the handle. Pure. */
export function filterFriends(list: readonly FriendOption[], query: string): FriendOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((f) => f.name.toLowerCase().includes(q) || f.handle.toLowerCase().includes(q));
}

export interface CreateGroupSheetProps {
  open: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
}

export function CreateGroupSheet({ open, onRequestClose, onClosed }: CreateGroupSheetProps) {
  const theme = useTheme();
  const friends = useFriendOptions();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const shown = useMemo(() => filterFriends(friends, query), [friends, query]);
  const chosen = useMemo(() => selected.map((id) => friends.find((f) => f.id === id)).filter(Boolean) as FriendOption[], [selected, friends]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setError('');
  }

  async function submit() {
    if (selected.length === 0) {
      setError(t('createGroup.selectOne'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const room = await createGroupPM({ recipient_ids: selected });
      addOrUpdateRoom(room);
      setLoading(false);
      onRequestClose();
      openRoom(room.id, null);
    } catch (err) {
      setError(errorMessage(err, 'createGroup.failed'));
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClosed}
      title={t('createGroup.title')}
      description={t('createGroup.description')}
      dismissible={!loading}
      snapPoints={['88%']}
      scrollable
    >
      <View style={styles.body}>
        {friends.length === 0 ? (
          <EmptyState icon="fa-solid fa-user-group" body={t('createGroup.noFriends')} />
        ) : (
          <>
            <SearchInput value={query} onValueChange={setQuery} placeholder={t('common.search')} size="sm" />
            {chosen.length > 0 ? (
              <View style={styles.selectedRow}>
                <Text variant="caption">{t('createGroup.selected', { count: chosen.length })}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {chosen.map((f) => (
                    <Touchable
                      key={f.id}
                      feedback="opacity"
                      onPress={() => toggle(f.id)}
                      accessibilityLabel={`${t('common.remove')} ${f.name}`}
                      style={[styles.chip, { borderRadius: theme.radii.full, backgroundColor: withAlpha(theme.colors.primary, 0.15) }]}
                    >
                      <Avatar name={f.name} uri={f.avatar} size="xs" />
                      <Text variant="caption" tone="default" numberOfLines={1} style={styles.chipText}>
                        {f.name}
                      </Text>
                      <Icon name="fa-xmark" size={10} tone="muted" />
                    </Touchable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
            <View style={[styles.list, { borderColor: theme.colors.border, borderRadius: theme.radii.lg }]}>
              {shown.map((f) => {
                const on = selected.includes(f.id);
                return (
                  <Touchable
                    key={f.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${f.name}, ${f.handle}`}
                    accessibilityState={{ checked: on, disabled: loading }}
                    disabled={loading}
                    onPress={() => toggle(f.id)}
                    style={[styles.friendRow, { borderRadius: theme.radii.md }, on ? { backgroundColor: withAlpha(theme.colors.primary, 0.15) } : null]}
                  >
                    <View
                      style={[
                        styles.check,
                        {
                          borderRadius: theme.radii.sm,
                          borderColor: on ? theme.colors.primary : theme.colors.input,
                          backgroundColor: on ? theme.colors.primary : 'transparent',
                        },
                      ]}
                    >
                      {on ? <Icon name="fa-check" size={11} color={theme.colors.primaryForeground} /> : null}
                    </View>
                    <Avatar name={f.name} uri={f.avatar} size="md" />
                    <View style={styles.flex}>
                      <Text variant="label" numberOfLines={1}>
                        {f.name}
                      </Text>
                      <Text variant="caption" numberOfLines={1}>
                        @{f.handle}
                      </Text>
                    </View>
                  </Touchable>
                );
              })}
              {shown.length === 0 ? <Text variant="caption" style={styles.none}>{t('discover.noResults')}</Text> : null}
            </View>
          </>
        )}
        <FieldError message={error || undefined} />
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="outline" disabled={loading} onPress={onRequestClose} style={styles.flex} />
          <Button
            title={t('createGroup.title')}
            loading={loading}
            disabled={selected.length === 0}
            onPress={() => void submit()}
            style={styles.flex}
          />
        </View>
      </View>
    </Sheet>
  );
}

export interface AddPeopleSheetProps {
  roomId: string;
  open: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
}

export function AddPeopleSheet({ roomId, open, onRequestClose, onClosed }: AddPeopleSheetProps) {
  const theme = useTheme();
  const participantIds = useSolid(() => (rooms.rooms.find((r) => r.id === roomId)?.participants ?? []).map((p) => p.id), [roomId]);
  const exclude = useMemo(() => new Set(participantIds), [participantIds]);
  const friends = useFriendOptions(exclude);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const shown = useMemo(() => filterFriends(friends, query), [friends, query]);

  async function add(userId: string) {
    setError('');
    setBusy(userId);
    try {
      await addRoomParticipant(roomId, userId);
      setBusy(null);
      onRequestClose();
    } catch (err) {
      setError(errorMessage(err, 'addPeople.failed'));
      setBusy(null);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClosed}
      title={t('room.addPeople')}
      description={t('addPeople.description')}
      dismissible={busy === null}
      scrollable
    >
      <View style={styles.body}>
        {friends.length === 0 ? (
          <EmptyState icon="fa-solid fa-user-check" body={t('addPeople.everyoneAdded')} />
        ) : (
          <>
            {friends.length > 8 ? <SearchInput value={query} onValueChange={setQuery} placeholder={t('common.search')} size="sm" /> : null}
            <View style={[styles.list, { borderColor: theme.colors.border, borderRadius: theme.radii.lg }]}>
              {shown.map((f) => (
                <View key={f.id} style={styles.friendRow}>
                  <Avatar name={f.name} uri={f.avatar} size="md" />
                  <View style={styles.flex}>
                    <Text variant="label" numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Text variant="caption" numberOfLines={1}>
                      @{f.handle}
                    </Text>
                  </View>
                  <Button
                    title={t('common.add')}
                    size="sm"
                    loading={busy === f.id}
                    disabled={busy !== null}
                    onPress={() => void add(f.id)}
                    accessibilityLabel={`${t('common.add')} ${f.name}`}
                  />
                </View>
              ))}
            </View>
          </>
        )}
        <FieldError message={error || undefined} />
        <Button title={t('common.done')} variant="outline" disabled={busy !== null} onPress={onRequestClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingTop: 8 },
  flex: { flex: 1, minWidth: 0 },
  selectedRow: { gap: 6 },
  chips: { gap: 6, paddingEnd: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 4, paddingEnd: 10, minHeight: 32, maxWidth: 180 },
  chipText: { flexShrink: 1 },
  list: { borderWidth: StyleSheet.hairlineWidth, padding: 4, gap: 2 },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 8 },
  none: { padding: 12, textAlign: 'center' },
  check: { width: 20, height: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
});
