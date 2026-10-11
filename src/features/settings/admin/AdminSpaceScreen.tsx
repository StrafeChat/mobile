/**
 * Admin -> one space (AdminPage's SpaceDrawer): owner (opens the account), member count,
 * created, id, the reports about it, the instance-official switch, and taking it down (with
 * a reason for the audit log; confirmed). Leaves once it is gone.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { getSpaceDetail, setSpaceOfficial, takeDownSpace, type SpaceDetail } from '@web/api/instance';
import { confirmDialog } from '@web/stores/confirmDialog';
import { useTheme } from '@/theme';
import { Avatar, Button, EmptyState, ListSection, MONO_FONT, Spinner, Text, TextArea, withAlpha } from '@/ui';
import { FormCard, Note, SectionTitle, SettingItem, SettingToggle } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { adminReportPath, adminUserPath } from '../routes';
import { adminName, adminWhen, useAdminGate } from './shared';

export function AdminSpaceScreen() {
  useLocale();
  const theme = useTheme();
  const admin = useAdminGate();
  const { spaceId: raw } = useLocalSearchParams<{ spaceId: string }>();
  const spaceId = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const [detail, setDetail] = useState<SpaceDetail | null | undefined>(undefined);
  const [official, setOfficial] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!admin) return;
    let live = true;
    getSpaceDetail(spaceId)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setOfficial(d.space.official === true);
      })
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [admin, spaceId]);

  async function toggleOfficial(on: boolean) {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      const res = await setSpaceOfficial(detail.space.id, on);
      setOfficial(res.official);
    } catch {
      setError(t('admin.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function takeDown() {
    if (!detail) return;
    const ok = await confirmDialog({
      title: t('admin.space.takeDownTitle', { name: detail.space.name }),
      body: t('admin.space.takeDownBody'),
      confirmLabel: t('admin.space.takeDown'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await takeDownSpace(detail.space.id, reason.trim());
      if (router.canGoBack()) router.back();
    } catch {
      setError(t('admin.actionFailed'));
      setBusy(false);
    }
  }

  if (admin === false) {
    return (
      <SettingsScreen title={t('mobile.settings.adminSpace')}>
        <EmptyState icon="fa-solid fa-lock" title={t('mobile.settings.adminOnly')} size="page" />
      </SettingsScreen>
    );
  }
  if (!detail) {
    return (
      <SettingsScreen title={t('mobile.settings.adminSpace')}>
        {detail === null ? <EmptyState icon="fa-solid fa-layer-group" title={t('admin.space.gone')} size="page" /> : <Spinner fill />}
      </SettingsScreen>
    );
  }

  const sp = detail.space;
  return (
    <SettingsScreen title={sp.name} error={error} onDismissError={() => setError('')} testID="admin-space">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 }}>
        <Avatar uri={sp.icon} name={sp.name} size="xl" shape="rounded" />
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={2}>
            {sp.name}
          </Text>
          <Text variant="caption" selectable style={{ fontFamily: MONO_FONT }}>
            {sp.id}
          </Text>
        </View>
      </View>
      <ListSection>
        <SettingItem
          icon="crown"
          title={t('admin.space.owner')}
          value={adminName(detail.owner)}
          chevron
          onPress={() => router.push(adminUserPath(sp.owner_id) as Href)}
        />
        <SettingItem icon="users" title={t('admin.space.members')} value={String(detail.member_count)} />
        <SettingItem icon="calendar" title={t('admin.users.created')} value={adminWhen(sp.created_at)} />
      </ListSection>

      {detail.reports.length > 0 ? (
        <ListSection title={t('admin.users.reportsAgainst', { count: detail.reports.length })}>
          {detail.reports.map((r) => (
            <SettingItem
              key={r.id}
              icon="flag"
              title={t(`report.reasons.${r.reason}`)}
              description={`${t(`admin.reports.status.${r.status}`)} · ${adminWhen(r.created_at)}`}
              chevron
              onPress={() => router.push(adminReportPath(r.id) as Href)}
            />
          ))}
        </ListSection>
      ) : null}

      <ListSection>
        <SettingToggle
          icon="certificate"
          title={t('admin.space.official')}
          description={t('admin.space.officialHint')}
          value={official}
          busy={busy}
          onValueChange={(on) => void toggleOfficial(on)}
          testID="admin-space-official"
        />
      </ListSection>

      <SectionTitle title={t('admin.space.takeDown')} />
      <Note>{t('admin.space.takeDownHint')}</Note>
      <FormCard style={{ borderColor: withAlpha(theme.colors.destructive, 0.4) }}>
        <TextArea label={t('admin.space.takeDownReason')} value={reason} onChangeText={setReason} maxLength={500} disabled={busy} />
        <Button title={t('admin.space.takeDown')} icon="trash" variant="destructive" loading={busy} onPress={() => void takeDown()} testID="admin-space-takedown" />
      </FormCard>
    </SettingsScreen>
  );
}
