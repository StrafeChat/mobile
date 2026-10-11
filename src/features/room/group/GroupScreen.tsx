/**
 * A group PM's details (the web's group settings dialog, its add-people dialog and the member
 * list's remove buttons, gathered into one screen the way Discord mobile does):
 *
 * - the group's name and end-to-end encryption - editable by its creator (updateRoom; a
 *   "renamed" system message follows), read-only for everyone else;
 * - notification settings;
 * - the members, online first, with the creator's crown; the creator can remove anyone else
 *   (after a confirm - the web removes without asking);
 * - Add people (the nav area's sheet: your friends not already in it) and Leave group.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { updateRoom } from '@web/api/rooms';
import { addOrUpdateRoom } from '@web/stores/rooms';
import { t } from '@web/i18n/t';
import { useMemberList, useMemberRow, useMyId, usePmRoom, useRoomInfo, type MemberSource } from '@/data';
import { useTheme } from '@/theme';
import {
  BotTag,
  Button,
  EmptyState,
  Header,
  Icon,
  IconButton,
  Input,
  ListRow,
  ListSection,
  ToggleRow,
  UserAvatar,
  haptics,
  showActionSheet,
  toast,
  useLongPress,
  withAlpha,
} from '@/ui';
import { openAddPeopleSheet } from '@/features/nav';
import { goBack } from '../navigation';
import { openRoomNotifySheet } from '../presenters';
import { leaveGroup, removeFromGroup } from '../roomActions';
import { memberMenuItems } from '../members/memberActions';
import { showUserProfile } from '../profile/present';
import { errorMessage } from '../util';
import { ReadableWidth } from '../shared/ReadableWidth';

function GroupMemberRow({ roomId, userId, dim, canRemove }: { roomId: string; userId: string; dim: boolean; canRemove: boolean }) {
  const theme = useTheme();
  const source: MemberSource = { pmRoomId: roomId };
  const row = useMemberRow(source, userId);
  const me = useMyId();
  const longPress = useLongPress(() => {
    if (row) void showActionSheet(memberMenuItems(row, { spaceId: null, roomId }), { title: row.displayName });
  });
  if (!row) return null;
  const isSelf = row.id === me;
  return (
    <ListRow
      title={isSelf ? `${row.displayName} (${t('common.you')})` : row.displayName}
      subtitle={row.subline}
      leading={<UserAvatar userId={row.id} uri={row.avatar} name={row.displayName} size="md" ringColor={theme.colors.card} />}
      titleAccessory={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginStart: 4 }}>
          <BotTag bot={row.bot} size="xs" />
          {row.isOwner ? <Icon name="crown" size={11} color={theme.colors.warning} accessibilityLabel={t('room.members.owner')} /> : null}
        </View>
      }
      trailing={
        canRemove && !isSelf ? (
          <IconButton
            icon="user-minus"
            tone="danger"
            size="sm"
            label={t('room.members.removeNamed', { name: row.displayName })}
            onPress={() => void removeFromGroup(roomId, row.id, row.displayName)}
          />
        ) : undefined
      }
      onPress={() => showUserProfile(row.id, { roomId })}
      {...longPress}
      style={dim ? { opacity: 0.6 } : undefined}
    />
  );
}

export function GroupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ roomId: string }>();
  const roomId = String(params.roomId ?? '');
  const room = usePmRoom(roomId);
  const info = useRoomInfo(roomId, null);
  const members = useMemberList({ pmRoomId: roomId });
  const isCreator = !!info?.isCreator;

  const currentName = room?.name ?? '';
  const currentE2ee = room?.e2ee_enabled !== false;
  const [name, setName] = useState(currentName);
  const [e2ee, setE2ee] = useState(currentE2ee);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = name.trim() !== currentName.trim() || e2ee !== currentE2ee;
  // Follow changes made elsewhere while nothing is being edited here.
  useEffect(() => {
    if (saving) return;
    setName(currentName);
    setE2ee(currentE2ee);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentName, currentE2ee]);

  if (!room || !info || info.kind !== 'group') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header title={t('mobile.room.groupDetails')} onBack={goBack} />
        <EmptyState icon="user-group" body={t('room.notFound')} size="page" />
      </View>
    );
  }

  async function save() {
    const n = name.trim();
    setError('');
    if (!n) {
      setError(t('room.groupSettings.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const updated = await updateRoom(roomId, { name: n, e2ee_enabled: e2ee });
      addOrUpdateRoom(updated);
      haptics.success();
      toast.success(t('mobile.room.saved'));
    } catch (e) {
      setError(errorMessage(e, 'common.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const memberRows = members.filter((m): m is Extract<typeof m, { kind: 'member' }> => m.kind === 'member');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header title={info.name} subtitle={t('mobile.room.groupDetails')} leadingIcon="user-group" onBack={goBack} />
      <ReadableWidth>
        {/* The name field sits above the Save row: keep both clear of the keyboard. */}
        <KeyboardAwareScrollView
          bottomOffset={96}
          contentContainerStyle={{ paddingVertical: 16, gap: 20, paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {isCreator ? (
            <ListSection title={t('room.groupSettings.title')} footer={t('room.groupSettings.description')}>
              <View style={{ padding: 16, gap: 12 }}>
                <Input
                  label={t('room.groupSettings.name')}
                  placeholder={t('room.groupSettings.namePlaceholder')}
                  value={name}
                  onChangeText={(v) => {
                    setName(v);
                    setError('');
                  }}
                  disabled={saving}
                  error={error || undefined}
                  maxLength={100}
                />
              </View>
              <ToggleRow
                title={t('room.groupSettings.e2ee')}
                subtitle={t('room.groupSettings.e2eeDescription')}
                icon="lock"
                value={e2ee}
                onValueChange={setE2ee}
                disabled={saving}
              />
              {dirty ? (
                <View style={{ flexDirection: 'row', gap: 8, padding: 16 }}>
                  <Button
                    title={t('common.revert')}
                    variant="ghost"
                    style={{ flex: 1 }}
                    disabled={saving}
                    onPress={() => {
                      setName(currentName);
                      setE2ee(currentE2ee);
                      setError('');
                    }}
                  />
                  <Button title={t('common.save')} style={{ flex: 1 }} loading={saving} disabled={!name.trim()} onPress={() => void save()} />
                </View>
              ) : null}
            </ListSection>
          ) : (
            <ListSection>
              <ListRow
                title={t('room.groupSettings.e2ee')}
                icon={currentE2ee ? 'lock' : 'lock-open'}
                iconColor={currentE2ee ? theme.colors.primary : undefined}
                value={currentE2ee ? t('common.enabled') : t('common.disabled')}
              />
            </ListSection>
          )}

          <ListSection>
            <ListRow
              title={t('room.notify.title')}
              icon={info.muted ? 'bell-slash' : 'bell'}
              value={info.muted ? t('room.notify.muted') : undefined}
              chevron
              onPress={() => openRoomNotifySheet(roomId, null)}
            />
          </ListSection>

          <ListSection title={t('room.members.section', { label: t('room.members.title'), count: memberRows.length })}>
            <ListRow
              title={t('room.addPeople')}
              icon="user-plus"
              iconColor={theme.colors.primary}
              onPress={() => openAddPeopleSheet(roomId)}
              style={{ backgroundColor: withAlpha(theme.colors.primary, 0.04) }}
            />
            {memberRows.map((m) => (
              <GroupMemberRow key={m.key} roomId={roomId} userId={m.userId} dim={m.dim} canRemove={isCreator} />
            ))}
          </ListSection>

          <ListSection>
            <ListRow title={t('contextMenu.leaveGroup')} icon="right-from-bracket" destructive onPress={() => void leaveGroup(roomId, info.name)} />
          </ListSection>
        </KeyboardAwareScrollView>
      </ReadableWidth>
    </View>
  );
}
