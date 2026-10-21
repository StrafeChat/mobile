/**
 * Space settings -> Members (SpaceMembersPage): every member, searchable (nickname, name,
 * username or exact id), filterable by role and sortable (newest, oldest, name), as a
 * virtualised list of cells - avatar, name, BOT tag, owner crown, online dot, up to four role
 * chips and the join date. Members are shown by their space profile here (nickname and space
 * avatar), with the handle beside it. Tapping a member (or long-pressing) opens Edit roles /
 * Change Nickname / Reset Space Profile / Kick / Ban, with the web's hierarchy rules: actions
 * on someone ranked at or above you are shown disabled, so the rule is visible; the reset is
 * offered only when there is something to reset.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { formatDate, t } from '@web/i18n/t';
import { banSpaceMember, kickSpaceMember, setMemberSpaceRoles, type SpaceMember, type SpaceRole } from '@web/api/spaces';
import { loadSpaceMembers } from '@web/stores/spaceMembers';
import { confirmDialog } from '@web/stores/confirmDialog';
import { formatHandle } from '@web/stores/instance';
import { isVisibleStatus, presence } from '@web/stores/presence';
import { useSolid } from '@/bridge/solid';
import { confirmResetSpaceProfile } from '@web/lib/userContextMenu';
import { hasResettableSpaceProfile, memberCanEditNickname, memberCanResetSpaceProfile, resolveProfile, useSpaceAbilities } from '@/data';
// The room area's nickname sheet (mounted app-wide); its module directly, not the room index,
// which pulls the conversation screens.
import { presentNicknameSheet } from '@/features/room/nicknameSheet';
import { useTheme } from '@/theme';
import {
  Avatar,
  BotTag,
  Button,
  EmptyState,
  Icon,
  Select,
  SearchInput,
  Sheet,
  Spinner,
  Text,
  ToggleVisual,
  Touchable,
  haptics,
  showActionSheet,
  toast,
  withAlpha,
  type ActionSheetEntry,
} from '@/ui';
import { intToHex } from '../color';
import { TextPromptSheet } from '../components/sheets';
import { canEditMemberRoles, canModerateMember, customRolesDesc, everyoneRoleId, filterMembers, roleLocked, type HierarchyContext, type MemberSort } from './roleLogic';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

/** A member as this page names them: their space profile (the nickname, the space avatar). */
function profileOf(m: SpaceMember) {
  return resolveProfile(m, m, m.username);
}

function RoleChip({ role }: { role: SpaceRole }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.muted }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: role.color ? intToHex(role.color) : theme.colors.mutedForeground }} />
      <Text variant="caption" tone="default" numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {role.name}
      </Text>
    </View>
  );
}

function MemberCell({
  member,
  roles,
  isOwner,
  onPress,
}: {
  member: SpaceMember;
  roles: SpaceRole[];
  isOwner: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const status = useSolid(() => presence.byUser[member.id]?.status ?? member.presence?.status, [member.id]);
  const online = isVisibleStatus(status);
  const view = profileOf(member);
  const name = view.name;
  const joined = member.joined_at ? formatDate(member.joined_at, { dateStyle: 'medium' }) : '—';
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={[name, view.nick ? view.globalName : '', formatHandle(member), isOwner ? t('room.members.owner') : '', roles.map((r) => r.name).join(', '), joined].filter(Boolean).join(', ')}
      accessibilityHint={onPress ? t('mobile.settings.memberActionsHint') : undefined}
      style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56, alignItems: 'center' }}
    >
      <Avatar uri={view.avatar} name={name} size="lg" overlay={<View style={{ position: 'absolute', bottom: -1, end: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.background, backgroundColor: online ? theme.colors.success : withAlpha(theme.colors.mutedForeground, 0.5) }} />} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          {member.bot ? <BotTag bot /> : null}
          {isOwner ? <Icon name="crown" size={11} color={theme.colors.warning} /> : null}
        </View>
        <Text variant="caption" numberOfLines={1}>
          {/* Under a nickname, who they are everywhere too (SpaceMembersPage shows both). */}
          {[view.nick ? view.globalName : '', formatHandle(member), t('mobile.settings.joinedOn', { date: joined })].filter(Boolean).join(' · ')}
        </Text>
        {roles.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {roles.slice(0, 4).map((r) => (
              <RoleChip key={r.id} role={r} />
            ))}
            {roles.length > 4 ? <Text variant="caption">+{roles.length - 4}</Text> : null}
          </View>
        ) : null}
      </View>
      {onPress ? <Icon name="ellipsis-vertical" size={14} tone="muted" /> : null}
    </Touchable>
  );
}

function EditRolesSheet({
  data,
  member,
  onClose,
}: {
  data: SpaceSettingsData;
  member: SpaceMember | null;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const memberId = member?.id;
  useEffect(() => {
    if (!member) return;
    setPicked(new Set(member.roles ?? []));
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);
  const custom = customRolesDesc(data.roles);

  async function save() {
    if (!member) return;
    setBusy(true);
    setError('');
    try {
      await setMemberSpaceRoles(data.spaceId, member.id, custom.filter((r) => picked.has(r.id)).map((r) => r.id));
      await loadSpaceMembers(data.spaceId).catch(() => undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.memberUpdateFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!member}
      onClose={onClose}
      title={member ? t('spaceSettings.members.editRolesTitle', { name: profileOf(member).name }) : undefined}
      description={t('spaceSettings.membersExplain')}
      dismissible={!busy}
      closeButton
      scrollable
    >
      <View style={{ gap: 4 }}>
        {custom.length === 0 ? <Text tone="muted">{t('spaceSettings.members.noCustomRoles')}</Text> : null}
        {custom.map((role) => {
          const locked = roleLocked(role, data.gates.viewerHighestPosition);
          const on = picked.has(role.id);
          return (
            <Touchable
              key={role.id}
              disabled={busy || locked}
              onPress={() => {
                haptics.toggle(!on);
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (on) next.delete(role.id);
                  else next.add(role.id);
                  return next;
                });
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: on, disabled: busy || locked }}
              accessibilityLabel={locked ? `${role.name}, ${t('spaceSettings.members.roleLocked')}` : role.name}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, opacity: locked ? 0.5 : 1 }}
            >
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: role.color ? intToHex(role.color) : undefined }} />
              <Text style={{ flex: 1 }} numberOfLines={1}>
                {role.name}
              </Text>
              {locked ? <Icon name="lock" size={11} tone="muted" /> : null}
              <ToggleVisual value={on} disabled={busy || locked} />
            </Touchable>
          );
        })}
        {error ? (
          <Text variant="caption" tone="danger">
            {error}
          </Text>
        ) : null}
        <Button title={t('common.save')} loading={busy} fullWidth onPress={() => void save()} style={{ marginTop: 8 }} testID="member-roles-save" />
      </View>
    </Sheet>
  );
}

function Members({ data, setError }: { data: SpaceSettingsData; setError: (m: string) => void }) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sort, setSort] = useState<MemberSort>('joined_desc');
  const [rolesTarget, setRolesTarget] = useState<SpaceMember | null>(null);
  const [banTarget, setBanTarget] = useState<SpaceMember | null>(null);
  const space = data.space!;
  const { canKick, canBan, canManageRoles } = data.gates;
  const { canManageNicknames, canChangeOwnNickname } = useSpaceAbilities(data.spaceId);
  const viewerRow = data.members.find((m) => m.id === data.viewerId);
  const everyoneId = everyoneRoleId(space, data.roles);
  const ctx: HierarchyContext = { ownerId: space.owner_id, viewerId: data.viewerId, roles: data.roles, everyoneId, viewerHighest: data.gates.viewerHighestPosition };
  const rolesById = useMemo(() => new Map(data.roles.map((r) => [r.id, r])), [data.roles]);
  const list = useMemo(() => filterMembers(data.members, { query, roleId: roleFilter, sort }), [data.members, query, roleFilter, sort]);
  const customOf = (m: SpaceMember) =>
    (m.roles ?? [])
      .filter((id) => id !== everyoneId)
      .map((id) => rolesById.get(id))
      .filter((r): r is SpaceRole => !!r)
      .sort((a, b) => b.position - a.position);

  const isOwner = (id: string) => id === space.owner_id;
  const isSelf = (id: string) => id === data.viewerId;
  // Your own row: Change Nickname needs that bit (or Manage Nicknames); anyone else's needs
  // Manage Nicknames, and is then shown - disabled when outranked - except on the owner.
  const offersNickname = (m: SpaceMember) => (isSelf(m.id) ? canChangeOwnNickname : canManageNicknames && !isOwner(m.id));
  const nicknameAllowed = (m: SpaceMember) => memberCanEditNickname(space, data.roles, viewerRow, m);
  const hasMenu = (m: SpaceMember) =>
    (canManageRoles && (canEditMemberRoles(m, ctx, canManageRoles) || !isOwner(m.id))) || canKick || canBan || offersNickname(m) || nicknameAllowed(m);

  async function kick(m: SpaceMember) {
    const ok = await confirmDialog({
      title: t('room.members.kick'),
      body: t('spaceSettings.members.kickBody', { name: profileOf(m).name }),
      confirmLabel: t('room.members.kick'),
      tone: 'danger',
      icon: 'fa-solid fa-user-minus',
    });
    if (!ok) return;
    setError('');
    try {
      await kickSpaceMember(data.spaceId, m.id);
      await loadSpaceMembers(data.spaceId).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.members.kickFailed'));
    }
  }

  function openMenu(m: SpaceMember) {
    haptics.longPress();
    const mod = canModerateMember(m, ctx);
    const entries: ActionSheetEntry[] = [
      canManageRoles &&
        (canEditMemberRoles(m, ctx, canManageRoles) || !isOwner(m.id)) && {
          key: 'roles',
          label: t('spaceSettings.members.editRoles'),
          icon: 'shield-halved',
          disabled: !canEditMemberRoles(m, ctx, canManageRoles),
          onSelect: () => setRolesTarget(m),
        },
      // This page's own entries, not the shared menu builders' (as on the web's
      // SpaceMembersPage), with the web's reset flow behind Reset Space Profile.
      (offersNickname(m) || nicknameAllowed(m)) && {
        key: 'nickname',
        label: t('spaceProfile.changeNickname'),
        icon: 'pen',
        disabled: !nicknameAllowed(m),
        onSelect: () => presentNicknameSheet({ spaceId: data.spaceId, userId: m.id }),
      },
      // Someone else's, when you may and they have set something (their nickname stays).
      memberCanResetSpaceProfile(space, data.roles, viewerRow, m) &&
        hasResettableSpaceProfile(m, { ignoreNick: true }) && {
          key: 'reset-profile',
          label: t('contextMenu.resetSpaceProfile'),
          icon: 'eraser',
          danger: true,
          // A failure lands in this page's error line, as the web's page passes its onError.
          onSelect: () => {
            setError('');
            void confirmResetSpaceProfile(data.spaceId, m.id, setError);
          },
        },
      canKick && { key: 'kick', label: t('room.members.kick'), icon: 'user-minus', danger: true, disabled: !mod, onSelect: () => void kick(m) },
      canBan && { key: 'ban', label: t('room.members.ban'), icon: 'ban', danger: true, disabled: !mod, onSelect: () => setBanTarget(m) },
    ];
    void showActionSheet(entries, { title: profileOf(m).name, subtitle: formatHandle(m) });
  }

  const header = (
    <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 8 }}>
      <SearchInput value={query} onValueChange={setQuery} placeholder={t('spaceSettings.members.search')} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Select<string>
          style={{ flex: 1 }}
          value={roleFilter}
          sheetTitle={t('spaceSettings.members.filterRole')}
          options={[{ value: '', label: t('spaceSettings.members.allRoles') }, ...customRolesDesc(data.roles).map((r) => ({ value: r.id, label: r.name }))]}
          onValueChange={setRoleFilter}
        />
        <Select<MemberSort>
          style={{ flex: 1 }}
          value={sort}
          sheetTitle={t('spaceSettings.members.sort')}
          options={[
            { value: 'joined_desc', label: t('spaceSettings.members.sortNewest') },
            { value: 'joined_asc', label: t('spaceSettings.members.sortOldest') },
            { value: 'name', label: t('spaceSettings.members.sortName') },
          ]}
          onValueChange={setSort}
        />
      </View>
      <Text variant="caption">{t('spaceSettings.members.showing', { shown: list.length, total: data.members.length })}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlashList
        data={list}
        keyExtractor={(m) => m.id}
        ListHeaderComponent={header}
        ListEmptyComponent={data.membersLoading ? <Spinner fill /> : <EmptyState icon="fa-solid fa-user-group" body={t('spaceSettings.members.none')} />}
        ListFooterComponent={canKick || canBan ? <Text variant="caption" style={{ padding: 16 }}>{t('spaceSettings.members.hierarchyHint')}</Text> : null}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <MemberCell member={item} roles={customOf(item)} isOwner={isOwner(item.id)} onPress={hasMenu(item) ? () => openMenu(item) : undefined} />}
        onRefresh={() => void loadSpaceMembers(data.spaceId).catch(() => undefined)}
        refreshing={false}
      />
      <EditRolesSheet data={data} member={rolesTarget} onClose={() => setRolesTarget(null)} />
      <TextPromptSheet
        open={!!banTarget}
        title={banTarget ? t('spaceSettings.members.banTitle', { name: profileOf(banTarget).name }) : ''}
        description={t('spaceSettings.members.banBody')}
        icon="ban"
        tone="danger"
        label={t('spaceSettings.members.banReason')}
        placeholder={t('spaceSettings.members.banReasonPlaceholder')}
        maxLength={512}
        multiline
        allowEmpty
        confirmLabel={t('room.members.ban')}
        confirmVariant="destructive"
        onConfirm={async (reason) => {
          if (!banTarget) return;
          try {
            await banSpaceMember(data.spaceId, banTarget.id, reason.trim() || undefined);
          } catch (e) {
            throw new Error(e instanceof Error ? e.message : t('spaceSettings.members.banFailed'));
          }
          toast.success(t('mobile.settings.memberBanned', { name: profileOf(banTarget).name }));
          setBanTarget(null);
          await loadSpaceMembers(data.spaceId).catch(() => undefined);
        }}
        onClose={() => setBanTarget(null)}
      />
    </View>
  );
}

export function SpaceMembersScreen() {
  return (
    <SpacePage page="members" scroll={false}>
      {(data, { setError }) => <Members data={data} setError={setError} />}
    </SpacePage>
  );
}
