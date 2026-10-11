/**
 * Authorized Apps (AuthorizedAppsSettingsPage): every application this account granted
 * access to, what each may do, and Revoke - which ends the application's tokens for this
 * account at once.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { formatDate, t } from '@web/i18n/t';
import { listGrants, revokeGrant, scopeKey, type OAuthGrant } from '@web/api/developers';
import { confirmDialog } from '@web/stores/confirmDialog';
import { Avatar, Button, EmptyState, Icon, ListSection, Spinner, Text } from '@/ui';
import { useTheme } from '@/theme';
import { Note } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { useLoad } from '../hooks/useLoad';

const appName = (g: OAuthGrant) => g.application?.name || t('settings.authorizedApps.unknownApp');

function GrantRow({ grant, busy, onRevoke }: { grant: OAuthGrant; busy: boolean; onRevoke: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14, alignItems: 'flex-start' }}>
      <Avatar uri={grant.application?.icon} name={appName(grant)} size="lg" shape="rounded" />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text variant="body" weight="semibold">
          {appName(grant)}
        </Text>
        <Text variant="caption">{t('settings.authorizedApps.since', { when: formatDate(grant.created_at, { dateStyle: 'medium' }) })}</Text>
        {grant.application?.description ? <Text variant="caption">{grant.application.description}</Text> : null}
        <View style={{ gap: 4, marginTop: 4 }}>
          {grant.scopes.map((scope) => (
            <View key={scope} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="check" size={11} color={theme.colors.primary} />
              <Text variant="caption" tone="default" style={{ flex: 1 }}>
                {t(`oauth.scopes.${scopeKey(scope)}`, { defaultValue: scope })}
              </Text>
            </View>
          ))}
        </View>
        <Button
          title={t('settings.authorizedApps.revoke')}
          variant="destructive"
          size="sm"
          loading={busy}
          onPress={onRevoke}
          style={{ alignSelf: 'flex-start', marginTop: 8 }}
          accessibilityLabel={`${t('settings.authorizedApps.revoke')}, ${appName(grant)}`}
        />
      </View>
    </View>
  );
}

export function AuthorizedAppsScreen() {
  useLocale();
  const grants = useLoad(() => listGrants());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function revoke(g: OAuthGrant) {
    const ok = await confirmDialog({
      title: t('settings.authorizedApps.revoke'),
      body: t('settings.authorizedApps.revokeConfirm', { name: appName(g) }),
      confirmLabel: t('settings.authorizedApps.revoke'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(g.application_id);
    try {
      await revokeGrant(g.application_id);
      grants.setData((prev) => (prev ?? []).filter((x) => x.application_id !== g.application_id));
      setError('');
    } catch {
      setError(t('settings.authorizedApps.revokeFailed'));
    } finally {
      setBusy('');
    }
  }

  const list = grants.data ?? [];
  return (
    <SettingsScreen
      title={t('settings.sections.authorizedApps.title')}
      error={error || (grants.error ? t('settings.authorizedApps.loadFailed') : '')}
      refreshing={grants.refreshing}
      onRefresh={() => void grants.reload()}
      testID="settings-authorized-apps"
    >
      <Note>{t('settings.authorizedApps.intro')}</Note>
      {grants.loading && !grants.data ? (
        <Spinner fill />
      ) : list.length === 0 ? (
        <EmptyState icon="fa-solid fa-plug" title={t('settings.authorizedApps.empty')} />
      ) : (
        <ListSection>
          {list.map((g) => (
            <GrantRow key={g.application_id} grant={g} busy={busy === g.application_id} onRevoke={() => void revoke(g)} />
          ))}
        </ListSection>
      )}
    </SettingsScreen>
  );
}
