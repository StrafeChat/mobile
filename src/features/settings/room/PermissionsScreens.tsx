/**
 * Room permissions, Discord-mobile style: the overrides a room (or section) has, listed first -
 * role overrides, then member overrides - each opening its own editor with deny / inherit /
 * allow per permission; "Add a role" / "Add a member" start a new one. Above them, a section's
 * Private switch, or a channel's Sync-with-section switch (while synced, the overrides are the
 * section's and read-only here).
 *
 * Manage Roles edits overrides and privacy; Manage Rooms toggles sync (the server materialises
 * or clears the channel's overrides and the gateway updates the store).
 *
 * Members are named by their space profile here (nickname, space avatar) with the handle, and
 * the picker finds them by nickname, display name or username.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import {
  deleteRoomPermissionOverride,
  deleteRoomUserPermissionOverride,
  patchSpaceRoom,
  putRoomPermissionOverride,
  putRoomUserPermissionOverride,
  type SpaceMember,
} from '@web/api/spaces';
import { applyRoomRoleOverride, applyRoomUserOverride, refreshSpaceRooms, removeRoomRoleOverride, removeRoomUserOverride } from '@web/stores/spaces';
import { formatHandle } from '@web/stores/instance';
import { resolveProfile } from '@/data';
import { useTheme } from '@/theme';
import { Avatar, Button, ListSection, SearchInput, Sheet, SheetFlatList, Text, Touchable, showActionSheet } from '@/ui';
import { intToHex } from '../color';
import { Note, SettingItem, SettingToggle } from '../components/rows';
import { TriStateControl, applyOverrideState, overrideState, type TriState } from '../components/TriState';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { roomOverridePath, parseOverrideTarget, type OverrideTarget } from '../routes';
import { everyoneRoleId, isEveryone } from '../space/roleLogic';
import { isChannelInSection, isPrivateSection, isSyncLocked, overrideCounts, overrideRowsFor, privateSectionChange } from './overrideLogic';
import { RoomPage } from './RoomPage';
import { ROOM_TYPE_SECTION, type RoomSettingsData } from './useRoomSettings';

/** A member as these screens name them: their space profile (the nickname, the space avatar). */
function profileOf(m: SpaceMember) {
  return resolveProfile(m, m, m.username);
}

/** Members not yet overridden whose nickname, display name or username contains the query (first 100). */
export function pickableMembers(members: readonly SpaceMember[], exclude: ReadonlySet<string>, query: string): SpaceMember[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => !exclude.has(m.id))
    .filter((m) => !q || [m.nick, m.display_name, m.username].some((n) => !!n && n.toLowerCase().includes(q)))
    .slice(0, 100);
}

function MemberPickerSheet({
  open,
  members,
  exclude,
  onPick,
  onClose,
}: {
  open: boolean;
  members: SpaceMember[];
  exclude: Set<string>;
  onPick: (m: SpaceMember) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  const list = useMemo(() => pickableMembers(members, exclude, query), [members, exclude, query]);
  return (
    <Sheet open={open} onClose={onClose} title={t('mobile.settings.addMemberOverride')} icon="user" closeButton snapPoints={['80%']} contentStyle={{ flex: 1 }}>
      <View style={{ flex: 1, gap: 8 }}>
        <SearchInput value={query} onValueChange={setQuery} placeholder={t('spaceSettings.selectMember')} />
        <SheetFlatList
          data={list}
          keyExtractor={(m: SpaceMember) => m.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }: { item: SpaceMember }) => {
            const view = profileOf(item);
            return (
              <Touchable
                onPress={() => onPick(item)}
                accessibilityRole="button"
                accessibilityLabel={`${view.name}, ${formatHandle(item)}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 6 }}
              >
                <Avatar uri={view.avatar} name={view.name} size="md" />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1}>{view.name}</Text>
                  <Text variant="caption" numberOfLines={1}>
                    {formatHandle(item)}
                  </Text>
                </View>
              </Touchable>
            );
          }}
        />
      </View>
    </Sheet>
  );
}

function Permissions({ data, setError }: { data: RoomSettingsData; setError: (m: string) => void }) {
  const theme = useTheme();
  const room = data.room!;
  const [busy, setBusy] = useState(false);
  const [pickMember, setPickMember] = useState(false);
  const rows = overrideRowsFor(room);
  const section = room.type === ROOM_TYPE_SECTION;
  const inSection = isChannelInSection(room);
  const locked = isSyncLocked(room);
  const everyoneId = everyoneRoleId(data.space, data.roles);
  const roleOverrides = useMemo(() => {
    const byId = new Map(data.roles.map((r) => [r.id, r]));
    return (room.permission_overrides ?? [])
      .map((o) => ({ o, role: byId.get(o.role_id) }))
      .sort((a, b) => (b.role?.position ?? -1) - (a.role?.position ?? -1));
  }, [room.permission_overrides, data.roles]);
  const userOverrides = useMemo(() => {
    const byId = new Map(data.members.map((m) => [m.id, m]));
    return (room.user_overrides ?? []).map((o) => ({ o, member: byId.get(o.user_id) }));
  }, [room.user_overrides, data.members]);

  async function togglePrivate(next: boolean) {
    if (!data.spaceId || !everyoneId || !data.canManageRoles) return;
    setBusy(true);
    setError('');
    try {
      const existing = room.permission_overrides?.find((o) => o.role_id === everyoneId);
      const change = privateSectionChange(existing, next);
      const now = new Date().toISOString();
      if (change.action === 'delete') {
        await deleteRoomPermissionOverride(data.spaceId, room.id, everyoneId);
        removeRoomRoleOverride(data.spaceId, room.id, everyoneId);
      } else {
        await putRoomPermissionOverride(data.spaceId, room.id, everyoneId, { allow: change.allow, deny: change.deny });
        applyRoomRoleOverride(data.spaceId, room.id, { role_id: everyoneId, allow: change.allow, deny: change.deny, created_at: now, updated_at: now });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roomSettings.overrideSaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSync(next: boolean) {
    if (!data.spaceId || !data.canManageRooms) return;
    setBusy(true);
    setError('');
    try {
      await patchSpaceRoom(data.spaceId, room.id, { permissions_synced: next });
      void refreshSpaceRooms(data.spaceId).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roomSettings.overrideSaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const openEditor = (target: OverrideTarget) => router.push(roomOverridePath(room.id, target) as Href);

  function addRole() {
    const taken = new Set((room.permission_overrides ?? []).map((o) => o.role_id));
    const candidates = [...data.roles].sort((a, b) => b.position - a.position).filter((r) => !taken.has(r.id));
    void showActionSheet(
      candidates.map((r) => ({
        key: r.id,
        label: r.name,
        leading: <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: r.color ? intToHex(r.color) : theme.colors.mutedForeground }} />,
        onSelect: () => openEditor({ kind: 'role', id: r.id }),
      })),
      { title: t('mobile.settings.addRoleOverride') },
    );
  }

  const summary = (o: { allow: number; deny: number }) => {
    const c = overrideCounts(o, rows);
    return t('mobile.settings.overrideSummary', { allowed: c.allowed, denied: c.denied });
  };

  return (
    <>
      {section ? (
        <ListSection>
          <SettingToggle
            icon="lock"
            title={t('roomSettings.privateSection')}
            description={t('roomSettings.privateSectionHelp')}
            value={isPrivateSection(room.permission_overrides, everyoneId)}
            disabled={!data.canManageRoles || busy || !everyoneId}
            onValueChange={(on) => void togglePrivate(on)}
            testID="room-private-section"
          />
        </ListSection>
      ) : null}
      {inSection ? (
        <ListSection footer={locked ? t('roomSettings.syncedNote') : undefined}>
          <SettingToggle
            icon="rotate"
            title={t('roomSettings.syncSection')}
            description={t('roomSettings.syncSectionHelp')}
            value={room.permissions_synced === true}
            disabled={!data.canManageRooms || busy}
            onValueChange={(on) => void toggleSync(on)}
            testID="room-sync"
          />
        </ListSection>
      ) : null}

      <ListSection title={t('mobile.settings.roleOverrides')}>
        {roleOverrides.length === 0 ? <SettingItem title={t('mobile.settings.noOverrides')} /> : null}
        {roleOverrides.map(({ o, role }) => (
          <SettingItem
            key={o.role_id}
            leading={<View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: role?.color ? intToHex(role.color) : theme.colors.mutedForeground }} />}
            title={role?.name ?? o.role_id}
            description={summary(o)}
            chevron
            onPress={() => openEditor({ kind: 'role', id: o.role_id })}
          />
        ))}
        {data.canManageRoles && !locked ? <SettingItem icon="plus" title={t('mobile.settings.addRoleOverride')} onPress={addRole} testID="room-add-role-override" /> : null}
      </ListSection>

      <ListSection title={t('mobile.settings.memberOverrides')}>
        {userOverrides.length === 0 ? <SettingItem title={t('mobile.settings.noOverrides')} /> : null}
        {userOverrides.map(({ o, member }) => {
          const view = member ? profileOf(member) : undefined;
          return (
            <SettingItem
              key={o.user_id}
              leading={<Avatar uri={view?.avatar} name={view?.name ?? o.user_id} size="sm" />}
              title={view?.name ?? o.user_id}
              description={summary(o)}
              chevron
              onPress={() => openEditor({ kind: 'user', id: o.user_id })}
            />
          );
        })}
        {data.canManageRoles && !locked ? <SettingItem icon="plus" title={t('mobile.settings.addMemberOverride')} onPress={() => setPickMember(true)} testID="room-add-member-override" /> : null}
      </ListSection>
      <Note>{t('roomSettings.pages.overrides.description', { room: room.name })}</Note>

      <MemberPickerSheet
        open={pickMember}
        members={data.members}
        exclude={new Set((room.user_overrides ?? []).map((o) => o.user_id))}
        onPick={(m) => {
          setPickMember(false);
          openEditor({ kind: 'user', id: m.id });
        }}
        onClose={() => setPickMember(false)}
      />
    </>
  );
}

export function RoomPermissionsScreen() {
  return <RoomPage page="permissions">{(data, { setError }) => <Permissions data={data} setError={setError} />}</RoomPage>;
}

function OverrideEditor({ data, target, setError }: { data: RoomSettingsData; target: OverrideTarget; setError: (m: string) => void }) {
  const room = data.room!;
  const rows = overrideRowsFor(room);
  const existing =
    target.kind === 'role' ? room.permission_overrides?.find((o) => o.role_id === target.id) : room.user_overrides?.find((o) => o.user_id === target.id);
  const stored = { allow: existing?.allow ?? 0, deny: existing?.deny ?? 0 };
  const [masks, setMasks] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const locked = isSyncLocked(room);
  const canEdit = data.canManageRoles && !locked;
  const dirty = masks.allow !== stored.allow || masks.deny !== stored.deny;
  useUnsavedGuard(dirty && canEdit && !done);
  useEffect(() => {
    if (done && router.canGoBack()) router.back();
  }, [done]);
  // Follow the store until edited (another device saved this override).
  useEffect(() => {
    if (!dirty) setMasks(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.allow, existing?.deny]);

  const role = target.kind === 'role' ? data.roles.find((r) => r.id === target.id) : undefined;
  const member = target.kind === 'user' ? data.members.find((m) => m.id === target.id) : undefined;
  const memberView = member ? profileOf(member) : undefined;
  const name = target.kind === 'role' ? (role?.name ?? target.id) : (memberView?.name ?? target.id);

  async function save() {
    if (!data.spaceId || !canEdit) return;
    setBusy(true);
    setError('');
    try {
      const now = new Date().toISOString();
      if (target.kind === 'role') {
        await putRoomPermissionOverride(data.spaceId, room.id, target.id, masks);
        applyRoomRoleOverride(data.spaceId, room.id, { role_id: target.id, ...masks, created_at: now, updated_at: now });
      } else {
        await putRoomUserPermissionOverride(data.spaceId, room.id, target.id, masks);
        applyRoomUserOverride(data.spaceId, room.id, { user_id: target.id, ...masks, created_at: now, updated_at: now });
      }
      void refreshSpaceRooms(data.spaceId).catch(() => undefined);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roomSettings.overrideSaveFailed'));
      setBusy(false);
    }
  }

  async function clear() {
    if (!data.spaceId || !canEdit) return;
    setBusy(true);
    setError('');
    try {
      if (target.kind === 'role') {
        await deleteRoomPermissionOverride(data.spaceId, room.id, target.id);
        removeRoomRoleOverride(data.spaceId, room.id, target.id);
      } else {
        await deleteRoomUserPermissionOverride(data.spaceId, room.id, target.id);
        removeRoomUserOverride(data.spaceId, room.id, target.id);
      }
      void refreshSpaceRooms(data.spaceId).catch(() => undefined);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roomSettings.overrideClearFailed'));
      setBusy(false);
    }
  }

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 }}>
        {member ? <Avatar uri={memberView?.avatar} name={name} size="lg" /> : null}
        <View style={{ flex: 1 }}>
          <Text variant="heading">{name}</Text>
          <Text variant="caption">{target.kind === 'role' ? t('roomSettings.roleOverride') : t('roomSettings.memberOverride')}</Text>
        </View>
      </View>
      {locked ? <Note tone="warning">{t('roomSettings.syncedNote')}</Note> : null}
      {role && isEveryone(role) ? <Note>{t('mobile.settings.everyoneOverrideHint')}</Note> : null}
      <ListSection>
        {rows.map((row) => (
          <View key={row.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="medium">{row.label}</Text>
              <Text variant="caption">{row.description}</Text>
            </View>
            <TriStateControl
              name={row.label}
              value={overrideState(masks.allow, masks.deny, row.bit)}
              disabled={!canEdit || busy}
              onChange={(next: TriState) => setMasks((m) => applyOverrideState(m, row.bit, next))}
              testID={`override-${row.key}`}
            />
          </View>
        ))}
      </ListSection>
      {canEdit ? (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12 }}>
          <Button title={t('roomSettings.clearOverride')} variant="outline" style={{ flex: 1 }} disabled={busy || !existing} onPress={() => void clear()} testID="override-clear" />
          <Button title={t('roomSettings.saveOverride')} style={{ flex: 1 }} loading={busy} disabled={!dirty && !!existing} onPress={() => void save()} testID="override-save" />
        </View>
      ) : null}
    </>
  );
}

export function RoomOverrideScreen() {
  const { target: raw } = useLocalSearchParams<{ target: string }>();
  const target = parseOverrideTarget(Array.isArray(raw) ? raw[0] : raw);
  return (
    <RoomPage page="permissions">
      {(data, { setError }) => (target ? <OverrideEditor data={data} target={target} setError={setError} /> : <Note>{t('mobile.settings.noPermission')}</Note>)}
    </RoomPage>
  );
}
