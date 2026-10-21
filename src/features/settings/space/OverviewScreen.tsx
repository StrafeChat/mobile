/**
 * Space settings -> Overview (SpaceOverviewPage + SpaceDangerZone): icon, name and
 * description; the banner; birthday announcements; and, for the owner only, transferring
 * ownership (searchable member picker, explicit acknowledgement) and deleting the space (type
 * its name; the server checks the name too). The picker names members by their space profile
 * (nickname, space avatar) beside their handle.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { deleteSpace, patchSpace, transferSpaceOwnership, uploadSpaceBanner, uploadSpaceIcon, type SpaceMember } from '@web/api/spaces';
import { addOrUpdateSpace, removeSpace } from '@web/stores/spaces';
import { formatHandle } from '@web/stores/instance';
import { setSelectedSpaceId, shell } from '@/shell/state';
import { resolveProfile, type MemberWithSpaceProfile } from '@/data';
import { useTheme } from '@/theme';
import { Avatar, Button, Input, ListSection, SearchInput, Select, Sheet, SheetFlatList, Text, TextArea, Toggle, Touchable, withAlpha } from '@/ui';
import { FormCard, Note, SectionTitle, SettingItem } from '../components/rows';
import { InlineError } from '../components/sheets';
import { asUploadFile, pickImage } from '../hooks/pickImage';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

const ROOM_TYPE_TEXT = 3;

/** Transfer candidates: everyone but the owner, filtered by nickname, name, username or exact id. */
export function transferCandidates(members: readonly SpaceMember[], ownerId: string | undefined, query: string): SpaceMember[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => m.id !== ownerId)
    .filter((m) => !q || [(m as MemberWithSpaceProfile).nick, m.display_name, m.username].some((n) => !!n && n.toLowerCase().includes(q)) || m.id === q);
}

/** A member as the picker names them: their space profile (the nickname, the space avatar). */
function profileOf(m: SpaceMember) {
  return resolveProfile(m, m as MemberWithSpaceProfile, m.username);
}

function TransferSheet({ data, open, onClose }: { data: SpaceSettingsData; open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<SpaceMember | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setQuery('');
      setTarget(null);
      setAck(false);
      setError('');
    }
  }, [open]);
  const list = useMemo(() => transferCandidates(data.members, data.space?.owner_id, query).slice(0, 100), [data.members, data.space?.owner_id, query]);
  const targetView = target ? profileOf(target) : null;

  async function transfer() {
    if (!target || !ack || busy) return;
    setBusy(true);
    setError('');
    try {
      addOrUpdateSpace(await transferSpaceOwnership(data.spaceId, target.id));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.danger.transferFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('spaceSettings.danger.transferDialogTitle', { name: data.space?.name ?? '' })}
      description={t('spaceSettings.danger.transferBody')}
      icon="crown"
      tone="danger"
      dismissible={!busy}
      closeButton
      snapPoints={['85%']}
      contentStyle={{ flex: 1 }}
    >
      <View style={{ flex: 1, gap: 10 }}>
        <Text variant="label">{t('spaceSettings.danger.transferSelect')}</Text>
        {target ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: theme.radii.md, backgroundColor: withAlpha(theme.colors.primary, 0.1) }}>
            <Avatar uri={targetView?.avatar} name={targetView?.name ?? ''} size="md" />
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{targetView?.name}</Text>
              <Text variant="caption">{formatHandle(target)}</Text>
            </View>
            <Button title={t('mobile.settings.change')} size="sm" variant="ghost" onPress={() => setTarget(null)} disabled={busy} />
          </View>
        ) : (
          <>
            <SearchInput value={query} onValueChange={setQuery} placeholder={t('spaceSettings.danger.transferPick')} />
            <SheetFlatList
              data={list}
              keyExtractor={(m: SpaceMember) => m.id}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }: { item: SpaceMember }) => {
                const view = profileOf(item);
                return (
                  <Touchable
                    onPress={() => setTarget(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${view.name}, ${formatHandle(item)}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 48 }}
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
          </>
        )}
        {target ? (
          <View style={{ gap: 12 }}>
            <Touchable
              onPress={() => setAck((a) => !a)}
              accessibilityRole="switch"
              accessibilityState={{ checked: ack, disabled: busy }}
              accessibilityLabel={t('spaceSettings.danger.transferConfirm')}
              disabled={busy}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border }}
            >
              <Text style={{ flex: 1 }}>{t('spaceSettings.danger.transferConfirm')}</Text>
              <Toggle value={ack} onValueChange={setAck} disabled={busy} accessibilityLabel={t('spaceSettings.danger.transferConfirm')} />
            </Touchable>
            <InlineError message={error} />
            <Button
              title={t('spaceSettings.danger.transferAction')}
              icon="crown"
              variant="destructive"
              loading={busy}
              disabled={!ack}
              fullWidth
              onPress={() => void transfer()}
              testID="space-transfer-confirm"
            />
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

function DeleteSheet({ data, open, onClose }: { data: SpaceSettingsData; open: boolean; onClose: () => void }) {
  const name = data.space?.name ?? '';
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setTyped('');
      setError('');
    }
  }, [open]);
  const matches = typed.trim() === name;

  async function destroy() {
    if (!matches || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteSpace(data.spaceId, name);
      // The SPACE_DELETE event does this for every other member; here it saves a round trip.
      removeSpace(data.spaceId);
      if (shell.selectedSpaceId() === data.spaceId) setSelectedSpaceId(null);
      onClose();
      router.dismissTo('/' as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.danger.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('spaceSettings.danger.deleteDialogTitle', { name })}
      description={t('spaceSettings.danger.deleteWarn')}
      icon="trash"
      tone="danger"
      dismissible={!busy}
      closeButton
    >
      <View style={{ gap: 12 }}>
        <Input
          label={t('spaceSettings.danger.deleteTypeName', { name })}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          disabled={busy}
          returnKeyType="done"
          onSubmitEditing={() => void destroy()}
          error={error || undefined}
          testID="space-delete-name"
        />
        <Button
          title={t('spaceSettings.danger.deleteAction')}
          icon="trash"
          variant="destructive"
          loading={busy}
          disabled={!matches}
          fullWidth
          onPress={() => void destroy()}
          testID="space-delete-confirm"
        />
      </View>
    </Sheet>
  );
}

function Overview({ data, setError }: { data: SpaceSettingsData; setError: (m: string) => void }) {
  const theme = useTheme();
  const space = data.space!;
  const canManage = data.gates.canManageSpace;
  const [name, setName] = useState(space.name ?? '');
  const [description, setDescription] = useState(space.description ?? '');
  const [saving, setSaving] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bdayChannel, setBdayChannel] = useState(space.birthday_channel_id ?? '');
  const [bdayMessage, setBdayMessage] = useState(space.birthday_message ?? '');
  const [bdaySaving, setBdaySaving] = useState(false);
  const [sheet, setSheet] = useState<'transfer' | 'delete' | null>(null);

  // Follow the store when another device or member changes the space.
  useEffect(() => {
    setName(space.name ?? '');
    setDescription(space.description ?? '');
  }, [space.name, space.description]);
  useEffect(() => {
    setBdayChannel(space.birthday_channel_id ?? '');
    setBdayMessage(space.birthday_message ?? '');
  }, [space.birthday_channel_id, space.birthday_message]);

  const dirty = name.trim() !== (space.name ?? '') || description.trim() !== (space.description ?? '');
  const bdayDirty = bdayChannel !== (space.birthday_channel_id ?? '') || bdayMessage.trim() !== (space.birthday_message ?? '');
  const textRooms = data.rooms.filter((r) => r.type === ROOM_TYPE_TEXT);
  const candidates = data.members.filter((m) => m.id !== space.owner_id);

  async function save() {
    const n = name.trim();
    if (!canManage || !dirty || !n) return;
    setSaving(true);
    setError('');
    try {
      addOrUpdateSpace(await patchSpace(data.spaceId, { name: n, description: description.trim() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.saveNameFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function saveBirthdays() {
    if (!canManage || !bdayDirty || bdaySaving) return;
    setBdaySaving(true);
    setError('');
    try {
      addOrUpdateSpace(await patchSpace(data.spaceId, { birthday_channel_id: bdayChannel, birthday_message: bdayMessage.trim() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.overview.birthdaySaveFailed'));
    } finally {
      setBdaySaving(false);
    }
  }

  async function upload(kind: 'icon' | 'banner') {
    if (!canManage) return;
    const pick = await pickImage({ title: kind === 'icon' ? t('spaceSettings.uploadIcon') : t('spaceSettings.overview.uploadBanner'), ...(kind === 'icon' ? { crop: { aspect: [1, 1] } } : {}) });
    if (pick.status === 'cancelled') return;
    if (pick.status === 'error') {
      setError(pick.message);
      return;
    }
    const setB = kind === 'icon' ? setIconBusy : setBannerBusy;
    setB(true);
    setError('');
    try {
      const updated = kind === 'icon' ? await uploadSpaceIcon(data.spaceId, asUploadFile(pick.file)) : await uploadSpaceBanner(data.spaceId, asUploadFile(pick.file));
      addOrUpdateSpace(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : kind === 'icon' ? t('spaceSettings.iconUploadFailed') : t('spaceSettings.overview.bannerUploadFailed'));
    } finally {
      setB(false);
    }
  }

  return (
    <>
      <SectionTitle title={t('spaceSettings.overview.identity')} />
      <FormCard style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar uri={space.icon} name={space.name} size={80} shape="rounded" />
          <Button
            title={t('spaceSettings.uploadIcon')}
            icon="camera"
            variant="outline"
            size="sm"
            loading={iconBusy}
            disabled={!canManage}
            onPress={() => void upload('icon')}
            testID="space-upload-icon"
          />
        </View>
        <Input label={t('common.name')} value={name} onChangeText={setName} maxLength={100} disabled={!canManage || saving} testID="space-name" />
        <TextArea
          label={t('spaceSettings.description')}
          value={description}
          onChangeText={setDescription}
          maxLength={1000}
          minRows={3}
          placeholder={t('spaceSettings.overview.descriptionPlaceholder')}
          hint={t('spaceSettings.overview.descriptionHint')}
          disabled={!canManage || saving}
        />
        {canManage ? (
          <Button title={t('common.saveChanges')} loading={saving} disabled={!dirty || !name.trim()} onPress={() => void save()} testID="space-save" />
        ) : null}
      </FormCard>

      <SectionTitle title={t('spaceSettings.overview.banner')} />
      <Note>{t('spaceSettings.overview.bannerHint')}</Note>
      <View style={{ marginHorizontal: 12, marginBottom: 10, aspectRatio: 16 / 6, borderRadius: theme.radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.muted, alignItems: 'center', justifyContent: 'center' }}>
        {space.banner ? (
          <Image source={{ uri: space.banner }} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <Text tone="muted">{t('spaceSettings.overview.noBanner')}</Text>
        )}
      </View>
      {canManage ? (
        <View style={{ marginHorizontal: 12, marginBottom: 16, alignItems: 'flex-start' }}>
          <Button title={t('spaceSettings.overview.uploadBanner')} icon="image" variant="outline" size="sm" loading={bannerBusy} onPress={() => void upload('banner')} />
        </View>
      ) : null}

      <SectionTitle title={t('spaceSettings.overview.birthdaysTitle')} />
      <Note>{t('spaceSettings.overview.birthdaysHint')}</Note>
      <FormCard style={{ marginBottom: 16 }}>
        <Select<string>
          label={t('spaceSettings.overview.birthdayChannel')}
          value={bdayChannel}
          disabled={!canManage || bdaySaving}
          options={[{ value: '', label: t('spaceSettings.overview.birthdayNoChannel') }, ...textRooms.map((r) => ({ value: r.id, label: `#${r.name}` }))]}
          onValueChange={setBdayChannel}
        />
        <Input
          label={t('spaceSettings.overview.birthdayMessage')}
          value={bdayMessage}
          onChangeText={setBdayMessage}
          maxLength={500}
          placeholder={t('spaceSettings.overview.birthdayMessagePlaceholder')}
          hint={t('spaceSettings.overview.birthdayMessageHint')}
          disabled={!canManage || bdaySaving || !bdayChannel}
        />
        {canManage && bdayDirty ? <Button title={t('common.saveChanges')} loading={bdaySaving} onPress={() => void saveBirthdays()} /> : null}
      </FormCard>

      {data.gates.isOwner ? (
        <>
          <ListSection title={t('spaceSettings.danger.title')} footer={candidates.length === 0 ? t('spaceSettings.danger.transferNoMembers') : undefined}>
            <SettingItem
              icon="crown"
              title={t('spaceSettings.danger.transferTitle')}
              description={t('spaceSettings.danger.transferBody')}
              destructive
              disabled={candidates.length === 0}
              onPress={() => setSheet('transfer')}
              testID="space-transfer"
            />
            <SettingItem
              icon="trash"
              title={t('spaceSettings.danger.deleteTitle')}
              description={t('spaceSettings.danger.deleteBody')}
              destructive
              onPress={() => setSheet('delete')}
              testID="space-delete"
            />
          </ListSection>
          <TransferSheet data={data} open={sheet === 'transfer'} onClose={() => setSheet((s) => (s === 'transfer' ? null : s))} />
          <DeleteSheet data={data} open={sheet === 'delete'} onClose={() => setSheet((s) => (s === 'delete' ? null : s))} />
        </>
      ) : null}
    </>
  );
}

export function SpaceOverviewScreen() {
  return <SpacePage page="overview">{(data, { setError }) => <Overview data={data} setError={setError} />}</SpacePage>;
}

