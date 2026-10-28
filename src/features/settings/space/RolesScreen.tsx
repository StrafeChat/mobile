/**
 * Space settings -> Roles & permissions: the role list (highest first, @everyone pinned at the
 * bottom, each with its colour, a robot for bot-managed roles and its member count), creating
 * a role (it starts with @everyone's permissions, as on the web) and reordering.
 *
 * Reordering is an "Edit order" mode with up / down buttons on each custom role - precise,
 * accessible and thumb-sized. Only roles below the viewer's own move (the owner: all of them);
 * the rest show a lock. Saving is the web's: the moved roles swap the positions they already
 * hold (lib/roleOrder planRoleOrder), sent as one PATCH /spaces/:id/roles - or, on an instance
 * from before it, one PATCH per role (api/spaces saveSpaceRoleOrder) - and the answer is merged
 * into the space's roles rather than replacing them, since role events may have overtaken it.
 */
import { useMemo, useState } from 'react';
import { batch } from 'solid-js';
import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { createSpaceRole, saveSpaceRoleOrder, type SpaceRole } from '@web/api/spaces';
import { compareRolesHighestFirst, customRolesHighestFirst } from '@web/lib/roleOrder';
import { mergeSpaceRoles, upsertSpaceRole } from '@web/stores/spaces';
import { useTheme } from '@/theme';
import { Button, Icon, IconButton, ListSection, Spinner, haptics, toast } from '@/ui';
import { intToHex } from '../color';
import { Note, SettingItem } from '../components/rows';
import { TextPromptSheet } from '../components/sheets';
import { spaceRolePath } from '../routes';
import { canMoveRole, isEveryone, moveRole, roleErrorText, roleLocked, roleReorder } from './roleLogic';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

function RoleDot({ color }: { color: number }) {
  const theme = useTheme();
  return <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color ? intToHex(color) : theme.colors.mutedForeground, borderWidth: 1, borderColor: theme.colors.border }} />;
}

/** `edited` (highest first, as moved in Edit order) with each role replaced by its live copy from
 * `live` (highest first): roles gone from `live` are dropped, and roles missing from `edited` are
 * put in at their live place - before the first edited role that ranks below them. */
export function liveOrder(edited: readonly SpaceRole[], live: readonly SpaceRole[]): SpaceRole[] {
  const byId = new Map(live.map((r) => [r.id, r]));
  const out = edited.map((r) => byId.get(r.id)).filter((r): r is SpaceRole => !!r);
  const have = new Set(out.map((r) => r.id));
  for (const r of live) {
    if (have.has(r.id)) continue;
    const at = out.findIndex((o) => compareRolesHighestFirst(r, o) < 0);
    out.splice(at < 0 ? out.length : at, 0, r);
    have.add(r.id);
  }
  return out;
}

function Roles({ data, setError }: { data: SpaceSettingsData; setError: (m: string) => void }) {
  const canManage = data.gates.canManageRoles;
  const [createOpen, setCreateOpen] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [order, setOrder] = useState<SpaceRole[] | null>(null);
  const [saving, setSaving] = useState(false);
  const custom = useMemo(() => customRolesHighestFirst(data.roles), [data.roles]);
  const everyone = data.roles.find(isEveryone);
  // While editing, keep the edited order but read every role as it is now: a change made
  // elsewhere meanwhile (a role created below, another one moved) shifts positions, and the locks
  // and the save must follow the live positions, not the ones from when editing began. A deleted
  // role drops out; a new one joins at its live place.
  const shown = useMemo(() => (ordering && order ? liveOrder(order, custom) : custom), [ordering, order, custom]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const member of data.members) for (const id of member.roles ?? []) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [data.members]);

  async function saveOrder() {
    if (!order) return;
    const { plan, outOfReach } = roleReorder(data.roles, shown, data.gates.viewerHighestPosition);
    if (plan.positions.length === 0) {
      setOrdering(false);
      setOrder(null);
      return;
    }
    if (outOfReach) {
      setError(t('errors.api.roleHierarchyRole'));
      return;
    }
    const sid = data.spaceId;
    setSaving(true);
    setError('');
    try {
      const saved = await saveSpaceRoleOrder(sid, plan);
      // Merged, not swapped in: a role created, deleted or edited meanwhile may already have
      // come over the gateway, and replacing the list with this answer would undo it.
      if (saved.complete) mergeSpaceRoles(sid, saved.roles);
      else batch(() => saved.roles.forEach((role) => upsertSpaceRole(sid, role)));
      toast.success(t('mobile.settings.roleOrderSaved'));
      setOrdering(false);
      setOrder(null);
    } catch (e) {
      setError(roleErrorText(e, 'spaceSettings.reorderFailed'));
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
            throw new Error(roleErrorText(e, 'spaceSettings.createRoleFailed'));
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
