/**
 * Space settings -> Invites (SpaceInvitesPage): create an invite (expiry and use limit; its
 * link is copied at once, as on the web, and can be shared), and every live invite as a card -
 * inviter, code, uses, expiry, creation date - with copy link, share and revoke.
 */
import { useState } from 'react';
import { Share, View } from 'react-native';
import { formatDate, t } from '@web/i18n/t';
import { createSpaceInvite, deleteSpaceInvite, listSpaceInvites, type SpaceInvite } from '@web/api/spaces';
import { confirmDialog } from '@web/stores/confirmDialog';
import { useTheme } from '@/theme';
import { Avatar, Button, EmptyState, IconButton, ListSection, MONO_FONT, Select, Spinner, Text, toast } from '@/ui';
import { FormCard, Note } from '../components/rows';
import { useCopy } from '../hooks/useCopy';
import { useLoad } from '../hooks/useLoad';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

export const INVITE_EXPIRY_OPTIONS = [0, 1800, 3600, 21600, 43200, 86400, 604800] as const;
export const INVITE_USES_OPTIONS = [0, 1, 5, 10, 25, 50, 100] as const;

/** The invite page on this instance's web origin. */
export function spaceInviteUrl(code: string): string {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  return `${origin}/invite/${code}`;
}

export function inviteExpiryLabel(seconds: number): string {
  if (seconds === 0) return t('spaceSettings.invites.never');
  if (seconds < 3600) return t('spaceSettings.system.minutes', { count: seconds / 60 });
  if (seconds < 86400) return t('spaceSettings.invites.hours', { count: seconds / 3600 });
  return t('spaceSettings.invites.days', { count: seconds / 86400 });
}

function sortInvites(list: SpaceInvite[]): SpaceInvite[] {
  return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function InviteCard({ invite, busy, onRevoke }: { invite: SpaceInvite; busy: boolean; onRevoke: () => void }) {
  const theme = useTheme();
  const { copy, copied } = useCopy();
  const url = spaceInviteUrl(invite.code);
  const inviter = invite.inviter?.display_name || invite.inviter?.username || t('common.someone');
  const uses = `${invite.current_uses} / ${invite.max_uses > 0 ? invite.max_uses : '∞'}`;
  const expires = invite.expires_at ? formatDate(invite.expires_at, { dateStyle: 'medium', timeStyle: 'short' }) : t('spaceSettings.invites.never');
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar uri={invite.inviter?.avatar} name={inviter} size="md" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text weight="semibold" numberOfLines={1}>
            {inviter}
          </Text>
          <Text selectable style={{ fontFamily: MONO_FONT, fontSize: theme.font(13), writingDirection: 'ltr' }}>
            {invite.code}
          </Text>
        </View>
        <IconButton icon={copied('link') ? 'check' : 'copy'} label={t('spaceSettings.invites.copyLink')} onPress={() => void copy('link', url)} />
        <IconButton icon="share-nodes" label={t('mobile.settings.share')} onPress={() => void Share.share({ message: url }).catch(() => undefined)} />
        <IconButton icon="trash" label={t('spaceSettings.invites.revoke')} tone="danger" disabled={busy} onPress={onRevoke} />
      </View>
      <Text variant="caption">
        {t('spaceSettings.invites.colUses')}: {uses} · {t('spaceSettings.invites.colExpires')}: {expires} · {t('spaceSettings.invites.colCreated')}:{' '}
        {formatDate(invite.created_at, { dateStyle: 'medium' })}
      </Text>
    </View>
  );
}

function Invites({ data, setError }: { data: SpaceSettingsData; setError: (m: string) => void }) {
  const invites = useLoad(async () => sortInvites(await listSpaceInvites(data.spaceId)), [data.spaceId]);
  const [maxAge, setMaxAge] = useState('0');
  const [maxUses, setMaxUses] = useState('0');
  const [creating, setCreating] = useState(false);
  const [busyCode, setBusyCode] = useState('');
  const { copy } = useCopy();
  const canManage = data.gates.canManageSpace;

  async function create() {
    setCreating(true);
    setError('');
    try {
      const inv = await createSpaceInvite(data.spaceId, { max_age_seconds: Number(maxAge) || 0, max_uses: Number(maxUses) || 0 });
      invites.setData((prev) => [inv, ...(prev ?? [])]);
      if (await copy(`new:${inv.code}`, spaceInviteUrl(inv.code))) toast.success(t('mobile.settings.inviteCopied'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('invite.failed'));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(inv: SpaceInvite) {
    const ok = await confirmDialog({
      title: t('spaceSettings.invites.revokeTitle'),
      body: t('spaceSettings.invites.revokeBody', { code: inv.code }),
      confirmLabel: t('spaceSettings.invites.revoke'),
      tone: 'danger',
      icon: 'fa-solid fa-link-slash',
    });
    if (!ok) return;
    setBusyCode(inv.code);
    setError('');
    try {
      await deleteSpaceInvite(data.spaceId, inv.code);
      invites.setData((prev) => (prev ?? []).filter((i) => i.code !== inv.code));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.invites.revokeFailed'));
    } finally {
      setBusyCode('');
    }
  }

  const list = invites.data ?? [];
  return (
    <>
      {canManage ? (
        <ListSection title={t('spaceSettings.invites.createTitle')} card={false}>
          <FormCard>
            <Select<string>
              label={t('spaceSettings.invites.expireAfter')}
              value={maxAge}
              disabled={creating}
              options={INVITE_EXPIRY_OPTIONS.map((s) => ({ value: String(s), label: inviteExpiryLabel(s) }))}
              onValueChange={setMaxAge}
            />
            <Select<string>
              label={t('spaceSettings.invites.maxUses')}
              value={maxUses}
              disabled={creating}
              options={INVITE_USES_OPTIONS.map((n) => ({ value: String(n), label: n === 0 ? t('spaceSettings.invites.unlimited') : t('spaceSettings.invites.uses', { count: n }) }))}
              onValueChange={setMaxUses}
            />
            <Button title={t('spaceSettings.invites.create')} icon="link" loading={creating} onPress={() => void create()} testID="invite-create" />
          </FormCard>
          <Note style={{ paddingTop: 6 }}>{t('spaceSettings.invites.createHint')}</Note>
        </ListSection>
      ) : null}
      {invites.loading && !invites.data ? (
        <Spinner fill />
      ) : invites.error && !invites.data ? (
        <EmptyState icon="fa-solid fa-triangle-exclamation" title={t('spaceSettings.invites.loadFailed')} action={<Button title={t('common.retry')} variant="outline" onPress={() => void invites.reload()} />} />
      ) : list.length === 0 ? (
        <EmptyState icon="fa-solid fa-link" body={t('spaceSettings.invites.none')} />
      ) : (
        <ListSection title={t('spaceSettings.invites.activeTitle', { count: list.length })}>
          {list.map((inv) => (
            <InviteCard key={inv.code} invite={inv} busy={busyCode === inv.code} onRevoke={() => void revoke(inv)} />
          ))}
        </ListSection>
      )}
    </>
  );
}

export function SpaceInvitesScreen() {
  // Pull to refresh reaches the list through a remount key.
  const [key, setKey] = useState(0);
  return (
    <SpacePage page="invites" onRefresh={() => setKey((k) => k + 1)} refreshing={false}>
      {(data, { setError }) => <Invites key={key} data={data} setError={setError} />}
    </SpacePage>
  );
}
