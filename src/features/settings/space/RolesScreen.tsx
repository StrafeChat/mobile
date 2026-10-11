/**
 * Space settings -> Roles & permissions: the role list (highest first, @everyone pinned at the
 * bottom, each with its colour, a robot for bot-managed roles and its member count), creating
 * a role (it starts with @everyone's permissions, as on the web) and reordering.
 *
 * Reordering is an "Edit order" mode with up / down buttons on each custom role - precise,
 * accessible and thumb-sized - committing by PATCHing the positions that change, as the web's
 * drag does (custom roles hold 1..N, @everyone stays at 0).
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { createSpaceRole, patchSpaceRole, type SpaceRole } from '@web/api/spaces';
import { upsertSpaceRole } from '@web/stores/spaces';
import { useTheme } from '@/theme';
import { Button, Icon, IconButton, ListSection, Spinner, haptics, toast } from '@/ui';
import { intToHex } from '../color';
import { Note, SettingItem } from '../components/rows';
import { TextPromptSheet } from '../components/sheets';
import { spaceRolePath } from '../routes';
import { canMoveRole, customRolesDesc, isEveryone, moveRole, roleLocked, rolePositionPatches } from './roleLogic';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

function RoleDot({ color }: { color: number }) {
  const theme = useTheme();
  return <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color ? intToHex(color) : theme.colors.mutedForeground, borderWidth: 1, borderColor: theme.colors.border }} />;
}

function Roles({ data, setError }: { data: SpaceSettingsData; setError: (m: string) => void }) {
  const canManage = data.gates.canManageRoles;
  const [createOpen, setCreateOpen] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [order, setOrder] = useState<SpaceRole[] | null>(null);
  const [saving, setSaving] = useState(false);
  const custom = useMemo(() => customRolesDesc(data.roles), [data.roles]);
  const everyone = data.roles.find(isEveryone);
  const shown = ordering && order ? order : custom;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const member of data.members) for (const id of member.roles ?? []) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [data.members]);

  async function saveOrder() {
    if (!order) return;
    const patches = rolePositionPatches(order);
    if (patches.length === 0) {
      setOrdering(false);
      return;
    }
    setSaving(true);
    setError('');
    try {
      for (const p of patches) upsertSpaceRole(data.spaceId, await patchSpaceRole(data.spaceId, p.id, { position: p.position }));
      toast.success(t('mobile.settings.roleOrderSaved'));
      setOrdering(false);
      setOrder(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.reorderFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (!data.rolesLoaded) return <Spinner fill />;

  return (
    <>
      {canManage ? (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
          {ordering ? (
            <>
              <Button title={t('common.cancel')} variant="outline" style={{ flex: 1 }} disabled={saving} onPress={() => {
                  setOrdering(false);
                  setOrder(null);
                }} />
              <Button title={t('mobile.settings.saveOrder')} style={{ flex: 1 }} loading={saving} onPress={() => void saveOrder()} testID="roles-save-order" />
            </>
          ) : (
            <>
              <Button title={t('mobile.settings.newRole')} icon="plus" style={{ flex: 1 }} onPress={() => setCreateOpen(true)} testID="roles-new" />
              <Button
                title={t('mobile.settings.editOrder')}
                icon="arrow-down-up-across-line"
                variant="outline"
                style={{ flex: 1 }}
                disabled={custom.length < 2}
                onPress={() => {
                  setOrder(custom);
                  setOrdering(true);
                }}
                testID="roles-edit-order"
              />
            </>
          )}
        </View>
      ) : null}

      <ListSection title={t('profile.roles')} footer={ordering ? t('mobile.settings.editOrderHint') : t('spaceSettings.editRoleHint')}>
        {shown.map((r, i) => (
          <SettingItem
            key={r.id}
            leading={<RoleDot color={r.color} />}
            title={r.name}
            titleAccessory={
              r.bot_id ? (
                <Icon name="robot" size={11} tone="primary" accessibilityLabel={t('spaceSettings.botRole')} />
              ) : roleLocked(r, data.gates.viewerHighestPosition) ? (
                <Icon name="lock" size={10} tone="muted" accessibilityLabel={t('spaceSettings.members.roleLocked')} />
              ) : null
            }
            description={t('mobile.settings.roleMemberCount', { count: counts.get(r.id) ?? 0 })}
            chevron={!ordering}
            onPress={ordering ? undefined : () => router.push(spaceRolePath(data.spaceId, r.id) as Href)}
            testID={`role-${r.id}`}
            trailing={
              ordering ? (
                <View style={{ flexDirection: 'row' }}>
                  <IconButton
                    icon="arrow-up"
                    label={t('mobile.settings.moveUp', { name: r.name })}
                    disabled={saving || !canMoveRole(shown, i, 'up', data.gates.viewerHighestPosition)}
                    onPress={() => {
                      haptics.selection();
                      setOrder((o) => moveRole(o ?? custom, r.id, 'up'));
                    }}
                  />
                  <IconButton
                    icon="arrow-down"
                    label={t('mobile.settings.moveDown', { name: r.name })}
                    disabled={saving || !canMoveRole(shown, i, 'down', data.gates.viewerHighestPosition)}
                    onPress={() => {
                      haptics.selection();
                      setOrder((o) => moveRole(o ?? custom, r.id, 'down'));
                    }}
                  />
                </View>
              ) : null
            }
          />
        ))}
        {everyone ? (
          <SettingItem
            leading={<RoleDot color={everyone.color} />}
            title={everyone.name}
            description={t('spaceSettings.everyoneAllMembers')}
            chevron={!ordering}
            disabled={ordering}
            onPress={ordering ? undefined : () => router.push(spaceRolePath(data.spaceId, everyone.id) as Href)}
            testID="role-everyone"
          />
        ) : null}
      </ListSection>
      {custom.length === 0 ? <Note>{t('spaceSettings.members.noCustomRoles')}</Note> : null}

      <TextPromptSheet
        open={createOpen}
        title={t('mobile.settings.newRole')}
        icon="shield-halved"
        label={t('spaceSettings.newRoleName')}
        placeholder={t('spaceSettings.newRoleName')}
        maxLength={100}
        confirmLabel={t('common.create')}
        onConfirm={async (name) => {
          const everyonePerms = everyone?.permissions ?? 0;
          let role: SpaceRole;
          try {
            role = await createSpaceRole(data.spaceId, { name: name.trim(), permissions: everyonePerms });
          } catch (e) {
            throw new Error(e instanceof Error ? e.message : t('spaceSettings.createRoleFailed'));
          }
          upsertSpaceRole(data.spaceId, role);
          setCreateOpen(false);
          router.push(spaceRolePath(data.spaceId, role.id) as Href);
        }}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}

export function SpaceRolesScreen() {
  return <SpacePage page="roles">{(data, { setError }) => <Roles data={data} setError={setError} />}</SpacePage>;
}
