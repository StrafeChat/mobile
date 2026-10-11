/**
 * The instance administrator's dashboard (AdminPage), as a native screen: the server is
 * asked whether this account administers the instance (never the cached flag), then a
 * scrollable tab bar - Overview, Users, Reports, Bans, Discover, Audit log, Federation - with
 * open reports and bans badged. Lists open detail screens (a user, a report, a space) instead
 * of the web's side-by-side panels; cross-links between them push the next screen.
 */
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { getInstanceStats, type InstanceStats } from '@web/api/instance';
import { Button, EmptyState, SegmentedControl, Spinner } from '@/ui';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { ADMIN_TABS, type AdminTabId } from '../routes';
import { leaveSettingsScreen } from '../navigation';
import { statCount, useAdminGate } from './shared';
import { AuditTab, BansTab, DiscoverTab, FederationTab, OverviewTab, ReportsTab, UsersTab } from './tabs';

export function tabLabel(tab: AdminTabId): string {
  return tab === 'federation' ? t('admin.federation.tab') : t(`admin.tabs.${tab}`);
}

export function AdminScreen() {
  useLocale();
  const admin = useAdminGate();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initial = (ADMIN_TABS as readonly string[]).includes(params.tab ?? '') ? (params.tab as AdminTabId) : 'overview';
  const [tab, setTab] = useState<AdminTabId>(initial);
  const [stats, setStats] = useState<InstanceStats | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadStats = useCallback(async () => {
    setStats(await getInstanceStats().catch(() => null));
  }, []);

  // Back from a detail screen (a report resolved, a ban lifted): fresh numbers and lists.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!admin) return;
      void loadStats();
      // Lists load when their tab mounts; only a return to this screen reloads them.
      if (focusedOnce.current) setReloadKey((k) => k + 1);
      focusedOnce.current = true;
    }, [admin, loadStats]),
  );

  async function refresh() {
    setRefreshing(true);
    await loadStats();
    setReloadKey((k) => k + 1);
    setRefreshing(false);
  }

  if (admin === null) {
    return (
      <SettingsScreen title={t('admin.title')} subtitle={t('admin.loadingHint')}>
        <Spinner fill label={t('admin.loading')} />
      </SettingsScreen>
    );
  }
  if (!admin) {
    return (
      <SettingsScreen title={t('admin.title')}>
        <EmptyState icon="fa-solid fa-lock" title={t('mobile.settings.adminOnly')} size="page" action={<Button title={t('admin.back')} variant="outline" onPress={() => router.dismissTo('/' as Href)} />} />
      </SettingsScreen>
    );
  }

  const items = ADMIN_TABS.map((id) => ({
    id,
    label: tabLabel(id),
    badge: id === 'reports' ? statCount(stats?.open_reports) : id === 'bans' ? statCount(stats?.bans) : undefined,
  }));

  return (
    <SettingsScreen title={t('admin.title')} subtitle={t('admin.subtitle')} onBack={leaveSettingsScreen} refreshing={refreshing} onRefresh={() => void refresh()} testID="admin-dashboard">
      <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        <SegmentedControl<AdminTabId> scrollable value={tab} onChange={setTab} items={items} accessibilityLabel={t('admin.title')} testID="admin-tabs" />
      </View>
      {tab === 'overview' ? <OverviewTab stats={stats} onTab={setTab} /> : null}
      {tab === 'users' ? <UsersTab /> : null}
      {tab === 'reports' ? <ReportsTab reloadKey={reloadKey} /> : null}
      {tab === 'bans' ? <BansTab reloadKey={reloadKey} onChanged={() => void loadStats()} /> : null}
      {tab === 'discover' ? <DiscoverTab reloadKey={reloadKey} /> : null}
      {tab === 'audit' ? <AuditTab reloadKey={reloadKey} /> : null}
      {tab === 'federation' ? <FederationTab reloadKey={reloadKey} /> : null}
    </SettingsScreen>
  );
}
