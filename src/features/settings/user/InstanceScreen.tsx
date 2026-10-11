/**
 * Instance (InstanceSettingsPage), administrators only: the admin dashboard, and the invite
 * codes that admit new accounts while registration is invite-only - create (note, uses,
 * expiry), copy, share and revoke.
 *
 * The page re-asks the server whether this account administers the instance (the settings
 * list hides the entry otherwise, but a deep link could land here); everything is also
 * checked server-side.
 */
import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { formatDate, t } from '@web/i18n/t';
import { createInstanceInvite, getInstanceCapabilities, listInstanceInvites, revokeInstanceInvite, type InstanceInvite } from '@web/api/instance';
import { confirmDialog } from '@web/stores/confirmDialog';
import { useInstance } from '@/data';
import { Button, EmptyState, IconButton, Input, ListSection, SegmentedControl, Spinner, Text } from '@/ui';
import { FormCard, Note, SettingItem } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useCopy } from '../hooks/useCopy';
import { useLoad } from '../hooks/useLoad';
import { useLocale } from '../hooks/useLocale';
import { openAdminDashboard } from '../navigation';

const DAY = 24 * 60 * 60;
/** The server's limits (instance.MaxInviteAgeSeconds / MaxInviteUses). */
export const INVITE_EXPIRY_CHOICES = [
  { seconds: 0, labelKey: 'settings.instance.noExpiry' },
  { seconds: DAY, labelKey: 'settings.instance.day' },
  { seconds: 7 * DAY, labelKey: 'settings.instance.week' },
  { seconds: 30 * DAY, labelKey: 'settings.instance.month' },
] as const;
export const INVITE_USES_CHOICES = [0, 1, 5, 25] as const;

export function inviteUsesText(inv: Pick<InstanceInvite, 'uses' | 'max_uses'>): string {
  return inv.max_uses > 0
    ? t('settings.instance.uses', { uses: String(inv.uses), max: String(inv.max_uses) })
    : t('settings.instance.usesUnlimited', { uses: String(inv.uses) });
}

export function inviteExpiryText(inv: Pick<InstanceInvite, 'expires_at'>): string {
  return inv.expires_at
    ? t('settings.instance.expires', { when: formatDate(inv.expires_at, { dateStyle: 'medium' }) || inv.expires_at })
    : t('settings.instance.never');
}

export function InstanceScreen() {
  useLocale();
  const info = useInstance();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const invites = useLoad(() => listInstanceInvites());
  const [note, setNote] = useState('');
  const [maxAge, setMaxAge] = useState(0);
  const [maxUses, setMaxUses] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const { copy, copied } = useCopy();

  useEffect(() => {
    let live = true;
    getInstanceCapabilities()
      .then((r) => live && setAdmin(r.instance_admin === true))
      .catch(() => live && setAdmin(false));
    return () => {
      live = false;
    };
  }, []);

  async function create() {
    setCreating(true);
    try {
      const inv = await createInstanceInvite({ max_age_seconds: maxAge, max_uses: maxUses, note: note.trim() });
      invites.setData((prev) => [inv, ...(prev ?? [])]);
      setNote('');
      setError('');
    } catch {
      setError(t('settings.instance.createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(code: string) {
    const ok = await confirmDialog({ title: t('settings.instance.revoke'), body: code, confirmLabel: t('settings.instance.revoke'), tone: 'danger' });
    if (!ok) return;
    try {
      await revokeInstanceInvite(code);
      invites.setData((prev) => (prev ?? []).filter((i) => i.code !== code));
    } catch {
      setError(t('settings.instance.loadFailed'));
    }
  }

  if (admin === false) {
    return (
      <SettingsScreen title={t('settings.sections.instance.title')}>
        <EmptyState icon="fa-solid fa-lock" title={t('mobile.settings.adminOnly')} />
      </SettingsScreen>
    );
  }

  const list = invites.data ?? [];
  return (
    <SettingsScreen
      title={t('settings.sections.instance.title')}
      error={error || (invites.error ? t('settings.instance.loadFailed') : '')}
      onDismissError={() => setError('')}
      refreshing={invites.refreshing}
      onRefresh={() => void invites.reload()}
      testID="settings-instance"
    >
      <ListSection>
        <SettingItem
          icon="shield-halved"
          title={t('settings.instance.dashboard')}
          description={t('settings.instance.dashboardHint')}
          chevron
          onPress={() => openAdminDashboard()}
          testID="instance-dashboard"
        />
      </ListSection>

      <ListSection title={t('settings.instance.invitesTitle')} card={false}>
        <Note>{t('settings.instance.invitesDescription')}</Note>
        {!info.inviteOnly ? <Note tone="warning">{t('settings.instance.openNotice')}</Note> : null}
        <FormCard>
          <Input
            label={t('settings.instance.note')}
            placeholder={t('settings.instance.notePlaceholder')}
            value={note}
            onChangeText={setNote}
            maxLength={100}
            disabled={creating}
          />
          <View style={{ gap: 6 }}>
            <Text variant="label">{t('settings.instance.maxUses')}</Text>
            <SegmentedControl<string>
              value={String(maxUses)}
              onChange={(v) => setMaxUses(Number(v))}
              accessibilityLabel={t('settings.instance.maxUses')}
              items={INVITE_USES_CHOICES.map((n) => ({ id: String(n), label: n === 0 ? t('settings.instance.unlimited') : String(n) }))}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label">{t('settings.instance.expiry')}</Text>
            <SegmentedControl<string>
              value={String(maxAge)}
              onChange={(v) => setMaxAge(Number(v))}
              accessibilityLabel={t('settings.instance.expiry')}
              items={INVITE_EXPIRY_CHOICES.map((c) => ({ id: String(c.seconds), label: t(c.labelKey) }))}
            />
          </View>
          <Button title={t('settings.instance.create')} icon="plus" loading={creating} onPress={() => void create()} testID="instance-create" />
        </FormCard>
      </ListSection>

      {invites.loading && !invites.data ? (
        <Spinner fill />
      ) : list.length === 0 ? (
        <Note>{t('settings.instance.empty')}</Note>
      ) : (
        <ListSection>
          {list.map((inv) => (
            <SettingItem
              key={inv.code}
              icon="ticket"
              title={inv.code}
              description={[`${inviteUsesText(inv)} · ${inviteExpiryText(inv)}`, inv.note].filter(Boolean).join('\n')}
              accessibilityLabel={`${inv.code}, ${inviteUsesText(inv)}, ${inviteExpiryText(inv)}`}
              trailing={
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  <IconButton
                    icon={copied(inv.code) ? 'check' : 'copy'}
                    label={copied(inv.code) ? t('settings.instance.copied') : t('settings.instance.copy')}
                    size="sm"
                    onPress={() => void copy(inv.code, inv.code)}
                  />
                  <IconButton icon="share-nodes" label={t('mobile.settings.share')} size="sm" onPress={() => void Share.share({ message: inv.code }).catch(() => undefined)} />
                  <IconButton icon="trash" label={t('settings.instance.revoke')} size="sm" tone="danger" onPress={() => void revoke(inv.code)} />
                </View>
              }
            />
          ))}
        </ListSection>
      )}
    </SettingsScreen>
  );
}
