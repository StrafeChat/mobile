/**
 * One role (SpaceSettingsModal's role editor), in three tabs:
 *
 * - Display: name (not for @everyone), colour (Discord's swatches, a picker, hex), shown
 *   separately (hoist), mentionable.
 * - Permissions: the permission matrix grouped like the web's, searchable, each group with an
 *   all-on/off switch, plus Clear all.
 * - Members: who holds the role (remove), and adding members by search. Not for @everyone
 *   (everyone has it), a bot's managed role, or a role at or above the viewer's own. Members
 *   are named by their space profile (nickname, space avatar) with the handle under it.
 *
 * Display and Permissions edits are a draft with an unsaved-changes bar (Reset / Save) and a
 * prompt when leaving with it; membership changes save at once, as on the web. Per-room
 * overrides live in each room's settings on mobile (the web repeats them here as "This room").
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { t } from '@web/i18n/t';
import { deleteSpaceRole, patchSpaceRole, setMemberSpaceRoles, type SpaceMember, type SpaceRole } from '@web/api/spaces';
import { SPACE_ROLE_PERM_GROUPS, hasPerm, togglePerm } from '@web/lib/spacePermissions';
import { removeSpaceRole, upsertSpaceRole } from '@web/stores/spaces';
import { loadSpaceMembers } from '@web/stores/spaceMembers';
import { confirmDialog } from '@web/stores/confirmDialog';
import { formatHandle } from '@web/stores/instance';
import { resolveProfile } from '@/data';
import { Avatar, BotTag, Button, EmptyState, Icon, IconButton, Input, ListSection, SearchInput, SegmentedControl, Text, Toggle, toast } from '@/ui';
import { ROLE_COLOR_SWATCHES, hexToInt, intToHex } from '../color';
import { ColorField } from '../components/ColorField';
import { FormCard, Note, SectionTitle, SettingItem, SettingToggle } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { addableMembers, canAssignRoleTo, isEveryone, memberRolesWith, roleLocked } from './roleLogic';
import { useSpaceIdParam } from './SpacePage';
import { pageAllowed, useSpaceSettings } from './useSpaceSettings';

type Tab = 'display' | 'permissions' | 'members';

interface RoleDraft {
  name: string;
  color: string;
  hoist: boolean;
  mentionable: boolean;
  permissions: number;
}

function draftOf(r: SpaceRole): RoleDraft {
  return { name: r.name, color: intToHex(r.color ?? 0), hoist: !!r.hoist, mentionable: !!r.mentionable, permissions: r.permissions };
}

/** Whether the draft differs from the role (the web's roleDirty; a blank name is no change). */
export function roleDraftDirty(r: SpaceRole, d: RoleDraft): boolean {
  return (
    (!isEveryone(r) && d.name.trim() !== r.name && d.name.trim() !== '') ||
    hexToInt(d.color) !== (r.color ?? 0) ||
    d.hoist !== !!r.hoist ||
    d.mentionable !== !!r.mentionable ||
    d.permissions !== r.permissions
  );
}

/**
 * The PATCH body for a role draft (no name for @everyone, nor a blank one). The permissions go
 * only when they changed: the server checks every bit sent against what the editor may grant,
 * so resending a bit the editor lacks (one the role already had) would refuse a colour change.
 */
export function rolePatch(r: SpaceRole, d: RoleDraft): { permissions?: number; color: number; hoist: boolean; mentionable: boolean; name?: string } {
  const body: { permissions?: number; color: number; hoist: boolean; mentionable: boolean; name?: string } = {
    color: hexToInt(d.color),
    hoist: d.hoist,
    mentionable: d.mentionable,
  };
  if (d.permissions !== r.permissions) body.permissions = d.permissions;
  if (!isEveryone(r) && d.name.trim()) body.name = d.name.trim();
  return body;
}

/** A member as these lists name them: their space profile (the nickname, the space avatar). */
function profileOf(m: SpaceMember) {
  return resolveProfile(m, m, m.username);
}

function MemberAvatar({ member }: { member: SpaceMember }) {
  const view = profileOf(member);
  return <Avatar uri={view.avatar} name={view.name} size="md" />;
}

export function RoleEditorScreen() {
  useLocale();
  const spaceId = useSpaceIdParam();
  const { roleId } = useLocalSearchParams<{ roleId: string }>();
  const data = useSpaceSettings(spaceId);
  const role = data.roles.find((r) => r.id === roleId);
  // A role at or above the viewer's own is out of reach: the server refuses any edit to it
  // (@everyone excepted), so it is shown read-only rather than as a form that cannot save.
  const locked = !!role && !isEveryone(role) && roleLocked(role, data.gates.viewerHighestPosition);
  const canManage = data.gates.canManageRoles && !locked;
  const [tab, setTab] = useState<Tab>('display');
  const [draft, setDraft] = useState<RoleDraft | null>(role ? draftOf(role) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [permQuery, setPermQuery] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [leaving, setLeaving] = useState(false);

  const dirty = !!role && !!draft && roleDraftDirty(role, draft);
  useUnsavedGuard(dirty && canManage && !leaving);

  // Seed from the role, and follow it while there are no local edits (another device saved).
  useEffect(() => {
    if (role && (!draft || !roleDraftDirty(role, draft))) setDraft(draftOf(role));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    if (leaving && router.canGoBack()) router.back();
  }, [leaving]);

  const filteredGroups = useMemo(() => {
    const q = permQuery.trim().toLowerCase();
    if (!q) return SPACE_ROLE_PERM_GROUPS;
    return SPACE_ROLE_PERM_GROUPS.map((g) => ({
      category: g.category,
      rows: g.rows.filter((row) => row.label.toLowerCase().includes(q) || row.description.toLowerCase().includes(q)),
    })).filter((g) => g.rows.length > 0);
    // Labels are translated getters; recompute when the language changes too.
  }, [permQuery]);

  const ownerId = data.space?.owner_id;
  const ctx = useMemo(() => ({ ownerId, viewerId: data.viewerId }), [ownerId, data.viewerId]);
  const holders = useMemo(() => (role ? data.members.filter((m) => m.roles?.includes(role.id)) : []), [data.members, role]);
  const addable = useMemo(() => (role ? addableMembers(data.members, role.id, memberQuery, ctx) : []), [data.members, role, memberQuery, ctx]);

  if (!data.space || !role || !draft) {
    return (
      <SettingsScreen title={t('spaceSettings.rolesPerms')}>
        <EmptyState icon="fa-solid fa-shield-halved" title={t('mobile.settings.roleGone')} size="page" />
      </SettingsScreen>
    );
  }
  if (!pageAllowed('roles', data.gates)) {
    return (
      <SettingsScreen title={role.name}>
        <EmptyState icon="fa-solid fa-lock" title={t('mobile.settings.noPermission')} size="page" />
      </SettingsScreen>
    );
  }

  const everyone = isEveryone(role);
  const edit = (patch: Partial<RoleDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  async function save() {
    if (!role || !draft || !canManage) return;
    setBusy(true);
    setError('');
    try {
      upsertSpaceRole(spaceId, await patchSpaceRole(spaceId, role.id, rolePatch(role, draft)));
      toast.success(t('mobile.settings.roleSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!role || everyone || role.bot_id || !canManage) return;
    const ok = await confirmDialog({
      title: t('spaceSettings.deleteRole'),
      body: t('mobile.settings.deleteRoleConfirm', { name: role.name }),
      confirmLabel: t('spaceSettings.deleteRole'),
      tone: 'danger',
      icon: 'fa-solid fa-trash',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await deleteSpaceRole(spaceId, role.id);
      removeSpaceRole(spaceId, role.id);
      setLeaving(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.deleteFailed'));
      setBusy(false);
    }
  }

  async function toggleMember(userId: string, add: boolean) {
    if (!role || everyone || !canManage || !canAssignRoleTo(userId, ctx) || locked) return;
    const member = data.members.find((m) => m.id === userId);
    if (!member) return;
    setBusy(true);
    setError('');
    try {
      await setMemberSpaceRoles(spaceId, userId, memberRolesWith(member, data.roles, role.id, add));
      await loadSpaceMembers(spaceId).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.memberUpdateFailed'));
    } finally {
      setBusy(false);
    }
  }

  const footer =
    canManage && dirty && tab !== 'members' ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="caption" style={{ flex: 1 }}>
          {t('spaceSettings.unsavedRoleChanges')}
        </Text>
        <Button title={t('spaceSettings.resetRole')} variant="outline" size="sm" disabled={busy} onPress={() => setDraft(draftOf(role))} />
        <Button title={t('common.saveChanges')} size="sm" loading={busy} onPress={() => void save()} testID="role-save" />
      </View>
    ) : undefined;

  return (
    <SettingsScreen
      title={role.name}
      subtitle={data.space.name}
      error={error}
      onDismissError={() => setError('')}
      footer={footer}
      actions={canManage && !everyone && !role.bot_id ? [{ icon: 'trash', label: t('spaceSettings.deleteRole'), onPress: () => void remove(), testID: 'role-delete' }] : undefined}
      testID="role-editor"
    >
      <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          accessibilityLabel={t('spaceSettings.roleSection')}
          items={[
            { id: 'display', label: t('spaceSettings.tabDisplay') },
            { id: 'permissions', label: t('spaceSettings.tabPermissions') },
            { id: 'members', label: t('mobile.settings.tabMembers') },
          ]}
        />
      </View>
      {role.bot_id ? <Note>{t('spaceSettings.botRoleHint')}</Note> : null}
      {locked && !everyone ? <Note tone="warning">{t('spaceSettings.members.roleLocked')}</Note> : null}

      {tab === 'display' ? (
        <>
          <FormCard style={{ marginBottom: 16 }}>
            <Input
              label={t('spaceSettings.roleName')}
              value={draft.name}
              onChangeText={(v) => edit({ name: v })}
              maxLength={100}
              disabled={!canManage || everyone}
              testID="role-name"
            />
            <ColorField
              label={t('spaceSettings.roleColor')}
              name={t('spaceSettings.roleColor')}
              value={draft.color}
              swatches={ROLE_COLOR_SWATCHES}
              disabled={!canManage}
              onChange={(hex) => edit({ color: hex })}
            />
          </FormCard>
          <ListSection>
            <SettingToggle
              icon="layer-group"
              title={t('spaceSettings.hoist')}
              description={t('spaceSettings.hoistHint')}
              value={draft.hoist}
              disabled={!canManage}
              onValueChange={(on) => edit({ hoist: on })}
            />
            <SettingToggle
              icon="at"
              title={t('spaceSettings.mentionable')}
              description={t('spaceSettings.mentionableHint')}
              value={draft.mentionable}
              disabled={!canManage}
              onValueChange={(on) => edit({ mentionable: on })}
            />
          </ListSection>
        </>
      ) : null}

      {tab === 'permissions' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <SearchInput value={permQuery} onValueChange={setPermQuery} placeholder={t('spaceSettings.searchPerms')} />
            </View>
            {canManage ? <Button title={t('spaceSettings.clearAll')} variant="outline" size="sm" onPress={() => edit({ permissions: 0 })} /> : null}
          </View>
          {filteredGroups.map((group) => {
            const allOn = group.rows.every((row) => hasPerm(draft.permissions, row.bit));
            return (
              <ListSection key={group.category}>
                <SectionTitle
                  title={group.category}
                  right={
                    canManage ? (
                      <Toggle
                        value={allOn}
                        accessibilityLabel={t('mobile.settings.groupToggle', { group: group.category })}
                        onValueChange={(on) => edit({ permissions: group.rows.reduce((acc, row) => togglePerm(acc, row.bit, on), draft.permissions) })}
                      />
                    ) : null
                  }
                />
                {group.rows.map((row) => (
                  <SettingToggle
                    key={row.key}
                    title={row.label}
                    description={row.description}
                    value={hasPerm(draft.permissions, row.bit)}
                    disabled={!canManage}
                    onValueChange={(on) => edit({ permissions: togglePerm(draft.permissions, row.bit, on) })}
                    testID={`perm-${row.key}`}
                  />
                ))}
              </ListSection>
            );
          })}
        </>
      ) : null}

      {tab === 'members' ? (
        everyone ? (
          <Note>{t('spaceSettings.everyoneAllMembers')}</Note>
        ) : (
          <>
            <ListSection title={t('spaceSettings.membersWithRole', { count: holders.length })}>
              {holders.length === 0 ? (
                <SettingItem title={t('spaceSettings.noMembersWithRole')} />
              ) : (
                holders.map((m) => (
                  <SettingItem
                    key={m.id}
                    leading={<MemberAvatar member={m} />}
                    title={profileOf(m).name}
                    titleAccessory={m.bot ? <BotTag bot /> : null}
                    description={formatHandle(m)}
                    trailing={
                      canManage && canAssignRoleTo(m.id, ctx) && !locked && !role.bot_id ? (
                        <IconButton icon="xmark" label={t('spaceSettings.removeFromRole')} tone="danger" disabled={busy} onPress={() => void toggleMember(m.id, false)} />
                      ) : null
                    }
                  />
                ))
              )}
            </ListSection>
            {canManage && !locked && !role.bot_id ? (
              <>
                <SectionTitle title={t('spaceSettings.addMembers')} />
                <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                  <SearchInput value={memberQuery} onValueChange={setMemberQuery} placeholder={t('spaceSettings.searchMembers')} />
                </View>
                <ListSection>
                  {addable.length === 0 ? (
                    <SettingItem title={t('spaceSettings.noMembersToAdd')} />
                  ) : (
                    addable.map((m) => (
                      <SettingItem
                        key={m.id}
                        leading={<MemberAvatar member={m} />}
                        title={profileOf(m).name}
                        titleAccessory={m.bot ? <BotTag bot /> : null}
                        description={formatHandle(m)}
                        disabled={busy}
                        onPress={() => void toggleMember(m.id, true)}
                        accessibilityHint={t('mobile.settings.addToRoleHint', { role: role.name })}
                        trailing={<Icon name="plus" size={13} tone="muted" />}
                      />
                    ))
                  )}
                </ListSection>
              </>
            ) : null}
          </>
        )
      ) : null}
    </SettingsScreen>
  );
}
