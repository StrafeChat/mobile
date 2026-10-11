/**
 * Admin -> one report (AdminPage's ReportPanel): reason, status and date; reporter and target
 * (each opening its own screen); what they said; the cited message when the server could read
 * it (otherwise why not - deleted, or end-to-end encrypted); and for an open report the
 * actions - a note, a ban length for user targets, Dismiss, Resolve, Ban the account or Take
 * the space down (the last two confirmed). Acting goes back to the queue, refreshed.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { getReport, resolveReport, type ReportDetail, type ResolveAction } from '@web/api/instance';
import { confirmDialog } from '@web/stores/confirmDialog';
import { useTheme } from '@/theme';
import { Button, EmptyState, ListSection, Spinner, Text, TextArea } from '@/ui';
import { FormCard, SectionTitle, SettingItem } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { adminSpacePath, adminUserPath } from '../routes';
import { Chip, DurationPicker, adminName, adminTag, adminWhen, useAdminGate } from './shared';
import { ReasonChip } from './tabs';

export function AdminReportScreen() {
  useLocale();
  const theme = useTheme();
  const admin = useAdminGate();
  const { reportId: raw } = useLocalSearchParams<{ reportId: string }>();
  const reportId = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const [detail, setDetail] = useState<ReportDetail | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!admin) return;
    let live = true;
    getReport(reportId)
      .then((d) => live && setDetail(d))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [admin, reportId]);

  async function act(action: ResolveAction) {
    if (!detail) return;
    if (action === 'ban_user' || action === 'remove_space') {
      const ok = await confirmDialog({
        title: action === 'ban_user' ? t('admin.reports.confirmBanTitle') : t('admin.reports.confirmRemoveTitle'),
        body:
          action === 'ban_user'
            ? t('admin.reports.confirmBanBody', { name: adminName(detail.target_user) })
            : t('admin.reports.confirmRemoveBody', { name: detail.target_space?.name ?? '' }),
        confirmLabel: action === 'ban_user' ? t('admin.reports.banUser') : t('admin.reports.removeSpace'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    try {
      await resolveReport(detail.report.id, { action, note: note.trim(), max_age_seconds: seconds });
      if (router.canGoBack()) router.back();
    } catch {
      setError(t('admin.actionFailed'));
      setBusy(false);
    }
  }

  if (admin === false) {
    return (
      <SettingsScreen title={t('admin.tabs.reports')}>
        <EmptyState icon="fa-solid fa-lock" title={t('mobile.settings.adminOnly')} size="page" />
      </SettingsScreen>
    );
  }
  if (!detail) {
    return (
      <SettingsScreen title={t('admin.tabs.reports')}>
        {detail === null ? <EmptyState icon="fa-solid fa-flag" title={t('admin.actionFailed')} size="page" /> : <Spinner fill />}
      </SettingsScreen>
    );
  }

  const r = detail.report;
  const open = r.status === 'open';
  const userTarget = r.target_type === 'user';

  return (
    <SettingsScreen title={t(`report.reasons.${r.reason}`)} subtitle={adminWhen(r.created_at)} error={error} onDismissError={() => setError('')} testID="admin-report">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 12 }}>
        <ReasonChip reason={r.reason} />
        <Chip label={t(`admin.reports.status.${r.status}`)} />
      </View>
      <ListSection>
        <SettingItem
          icon="user"
          title={t('admin.reports.reporter')}
          value={`${adminName(detail.reporter)}`}
          description={adminTag(detail.reporter)}
          chevron={!!detail.reporter}
          onPress={detail.reporter ? () => router.push(adminUserPath(detail.reporter!.id) as Href) : undefined}
        />
        <SettingItem
          icon={userTarget ? 'user' : 'layer-group'}
          title={t('admin.reports.target')}
          value={userTarget ? adminName(detail.target_user) : (detail.target_space?.name ?? t('admin.space.gone'))}
          description={userTarget ? adminTag(detail.target_user) : undefined}
          chevron
          onPress={() => router.push((userTarget ? adminUserPath(r.target_id) : adminSpacePath(r.target_id)) as Href)}
        />
      </ListSection>

      <SectionTitle title={t('admin.reports.details')} />
      <FormCard style={{ marginBottom: 16 }}>
        <Text selectable tone={r.details ? 'default' : 'muted'}>
          {r.details || t('admin.reports.noDetails')}
        </Text>
        {detail.message ? (
          <View style={{ padding: 12, gap: 4, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.muted }}>
            <Text variant="caption" weight="semibold">
              {t('admin.reports.message', { room: detail.room?.name || t('common.unknown') })}
            </Text>
            {detail.message.readable ? (
              <Text selectable>{detail.message.text}</Text>
            ) : (
              <Text tone="muted" style={{ fontStyle: 'italic' }}>
                {detail.message.deleted ? t('admin.reports.messageDeleted') : t('admin.reports.messageEncrypted')}
              </Text>
            )}
          </View>
        ) : null}
        {!open ? (
          <Text variant="caption">
            {t('admin.reports.resolvedLine', { outcome: t(`admin.reports.resolution.${r.resolution ?? 'none'}`), when: adminWhen(r.resolved_at) })}
            {r.resolution_note ? ` · ${r.resolution_note}` : ''}
          </Text>
        ) : null}
      </FormCard>

      {open ? (
        <>
          <SectionTitle title={t('admin.reports.actions')} />
          <FormCard>
            <TextArea label={t('admin.reports.note')} placeholder={t('admin.reports.notePlaceholder')} value={note} onChangeText={setNote} maxLength={500} disabled={busy} />
            {userTarget ? <DurationPicker value={seconds} onChange={setSeconds} disabled={busy} /> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button title={t('admin.reports.dismiss')} variant="ghost" disabled={busy} onPress={() => void act('dismiss')} testID="report-dismiss" />
              <Button title={t('admin.reports.resolve')} variant="secondary" disabled={busy} onPress={() => void act('resolve')} testID="report-resolve" />
              {userTarget ? (
                <Button title={t('admin.reports.banUser')} variant="destructive" disabled={busy} onPress={() => void act('ban_user')} />
              ) : (
                <Button title={t('admin.reports.removeSpace')} variant="destructive" disabled={busy} onPress={() => void act('remove_space')} />
              )}
            </View>
          </FormCard>
        </>
      ) : null}
    </SettingsScreen>
  );
}
