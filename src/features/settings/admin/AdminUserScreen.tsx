/**
 * Admin -> one account (AdminPage's UserPanel): who it is (Administrator / remote / banned
 * chips, id, email with change, created), the ban (lift, or ban with reason, duration and the
 * sessions' addresses), badges, recovery-code regeneration, an official notice, and its
 * sessions, spaces and the reports about it - each linking on.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import {
  banUser,
  getUserDetail,
  regenerateUserRecoveryCodes,
  sendUserNotice,
  setUserBadges,
  setUserEmail,
  unbanUser,
  type RecoveryCodesResult,
  type UserDetail,
} from '@web/api/instance';
import { BADGES } from '@web/lib/badges';
import { confirmDialog } from '@web/stores/confirmDialog';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { useTheme } from '@/theme';
import { Avatar, Banner, Button, Checkbox, EmptyState, Icon, ListSection, MONO_FONT, Spinner, Text, TextArea, Touchable, haptics, withAlpha } from '@/ui';
import { FormCard, Note, SectionTitle, SettingItem } from '../components/rows';
import { TextPromptSheet } from '../components/sheets';
import { SettingsScreen } from '../components/SettingsScreen';
import { useCopy } from '../hooks/useCopy';
import { useLocale } from '../hooks/useLocale';
import { adminReportPath, adminSpacePath } from '../routes';
import { Chip, DurationPicker, adminName, adminTag, adminWhen, useAdminGate } from './shared';

function useUserIdParam(): string {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  return Array.isArray(userId) ? (userId[0] ?? '') : (userId ?? '');
}

export function AdminUserScreen() {
  useLocale();
  const theme = useTheme();
  const admin = useAdminGate();
  const userId = useUserIdParam();
  const [detail, setDetail] = useState<UserDetail | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [flags, setFlags] = useState<number | null>(null);
  const [badgeSaving, setBadgeSaving] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryCodesResult | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [noticeError, setNoticeError] = useState('');
  const [noticeSent, setNoticeSent] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [banSeconds, setBanSeconds] = useState(0);
  const [banIps, setBanIps] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const { copy, copied } = useCopy();

  const load = useCallback(async () => {
    try {
      const d = await getUserDetail(userId);
      setDetail(d);
      setFlags(d.user.public_flags ?? 0);
    } catch {
      setDetail(null);
    }
  }, [userId]);

  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  async function toggleBadge(bit: number) {
    if (!detail) return;
    const cur = flags ?? 0;
    const next = cur ^ bit;
    haptics.toggle((next & bit) !== 0);
    setFlags(next);
    setBadgeSaving(true);
    setError('');
    try {
      const res = await setUserBadges(detail.user.id, next);
      setFlags(res.public_flags);
    } catch {
      setFlags(cur);
      setError(t('admin.actionFailed'));
    } finally {
      setBadgeSaving(false);
    }
  }

  async function unban() {
    if (!detail) return;
    const ok = await confirmDialog({ title: t('admin.users.unbanTitle', { name: adminName(detail.user) }), body: t('admin.users.unbanBody'), confirmLabel: t('admin.users.unban') });
    if (!ok) return;
    try {
      await unbanUser(detail.user.id);
      await load();
    } catch {
      setError(t('admin.actionFailed'));
    }
  }

  async function regenerate() {
    if (!detail) return;
    const ok = await confirmDialog({
      title: t('admin.users.recoveryTitle', { name: adminName(detail.user) }),
      body: t('admin.users.recoveryBody'),
      confirmLabel: t('admin.users.recoveryRegen'),
      tone: 'danger',
    });
    if (!ok) return;
    setRecoveryBusy(true);
    setError('');
    setRecovery(null);
    try {
      setRecovery(await regenerateUserRecoveryCodes(detail.user.id));
    } catch {
      setError(t('admin.actionFailed'));
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function sendNotice() {
    if (!detail || !notice.trim()) return;
    setNoticeBusy(true);
    setNoticeError('');
    setNoticeSent(false);
    try {
      await sendUserNotice(detail.user.id, notice.trim());
      setNotice('');
      setNoticeSent(true);
    } catch (err) {
      setNoticeError(translateCaughtApiError(err, t).join(' ') || t('admin.actionFailed'));
    } finally {
      setNoticeBusy(false);
    }
  }

  if (admin === false) {
    return (
      <SettingsScreen title={t('admin.tabs.users')}>
        <EmptyState icon="fa-solid fa-lock" title={t('mobile.settings.adminOnly')} size="page" />
      </SettingsScreen>
    );
  }
  if (!detail) {
    return (
      <SettingsScreen title={t('admin.tabs.users')}>
        {detail === null ? <EmptyState icon="fa-solid fa-user-slash" title={t('admin.actionFailed')} size="page" /> : <Spinner fill />}
      </SettingsScreen>
    );
  }

  const u = detail.user;
  const local = !u.home_domain;

  return (
    <SettingsScreen title={adminName(u)} subtitle={adminTag(u)} error={error} onDismissError={() => setError('')} refreshing={false} onRefresh={() => void load()} testID="admin-user">
      <View style={{ marginHorizontal: 12, marginBottom: 16, borderRadius: theme.radii.xl, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, overflow: 'hidden' }}>
        <View style={{ height: 56, backgroundColor: withAlpha(theme.colors.primary, 0.2) }} />
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 14, marginTop: -28 }}>
          <View style={{ borderRadius: 40, borderWidth: 4, borderColor: theme.colors.card }}>
            <Avatar uri={u.avatar} name={adminName(u)} size="xl" />
          </View>
          <View style={{ flex: 1, paddingTop: 32, gap: 6 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {detail.instance_admin ? <Chip label={t('admin.users.adminBadge')} tone="primary" /> : null}
              {u.home_domain ? <Chip label={t('admin.users.remote', { domain: u.home_domain })} /> : null}
              {detail.ban ? <Chip label={t('admin.users.bannedBadge')} tone="danger" /> : null}
            </View>
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 6 }}>
          <Text variant="caption">
            {t('admin.users.id')}:{' '}
            <Text variant="caption" tone="default" selectable style={{ fontFamily: MONO_FONT }}>
              {u.id}
            </Text>
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="caption">
              {t('admin.users.email')}:{' '}
              <Text variant="caption" tone="default" selectable>
                {u.email || '—'}
              </Text>
            </Text>
            {local && !u.bot ? (
              <Text variant="caption" tone="link" accessibilityRole="button" onPress={() => setEmailOpen(true)}>
                {t('admin.users.changeEmail')}
              </Text>
            ) : null}
          </View>
          <Text variant="caption">
            {t('admin.users.created')}: {adminWhen(u.created_at) || '—'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Button title={copied('id') ? t('common.copied') : t('mobile.settings.copyId')} size="sm" variant="outline" icon="copy" onPress={() => void copy('id', u.id)} />
          </View>
        </View>
      </View>

      {detail.ban ? (
        <Banner
          tone="error"
          title={t('admin.users.bannedTitle')}
          message={`${detail.ban.reason || t('admin.users.noReason')}\n${t('admin.users.bannedSince', { when: adminWhen(detail.ban.created_at) })} · ${
            detail.ban.expires_at ? t('admin.users.bannedUntil', { when: adminWhen(detail.ban.expires_at) }) : t('admin.users.bannedForever')
          }`}
          action={{ label: t('admin.users.unban'), onPress: () => void unban() }}
          style={{ marginHorizontal: 12, marginBottom: 16 }}
        />
      ) : local ? (
        <View style={{ marginHorizontal: 12, marginBottom: 16, alignItems: 'flex-start' }}>
          <Button title={t('admin.users.ban')} icon="ban" variant="destructive" onPress={() => setBanOpen(true)} testID="admin-user-ban" />
        </View>
      ) : null}

      {local ? (
        <>
          <SectionTitle title={t('admin.users.badges')} />
          <Note>{t('mobile.settings.badgesHint')}</Note>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 16 }} accessibilityRole="none">
            {BADGES.map((b) => {
              const on = ((flags ?? 0) & b.bit) !== 0;
              return (
                <Touchable
                  key={b.id}
                  feedback="opacity"
                  disabled={badgeSaving}
                  onPress={() => void toggleBadge(b.bit)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: on, disabled: badgeSaving }}
                  accessibilityLabel={t(`badges.${b.id}`)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    minHeight: 40,
                    borderRadius: theme.radii.lg,
                    borderWidth: 1,
                    borderColor: on ? theme.colors.primary : theme.colors.border,
                    backgroundColor: on ? withAlpha(theme.colors.primary, 0.15) : theme.colors.card,
                  }}
                >
                  {/* Badge colours are data (recognised by colour + shape), as on the web. */}
                  <Icon name={b.icon} size={13} color={on ? b.color : theme.colors.mutedForeground} />
                  <Text variant="label">{t(`badges.${b.id}`)}</Text>
                  {on ? <Icon name="check" size={10} tone="primary" /> : null}
                </Touchable>
              );
            })}
          </View>

          <SectionTitle title={t('admin.users.recovery')} />
          <Note>{t('admin.users.recoveryHint')}</Note>
          <FormCard style={{ marginBottom: 16 }}>
            <Button title={t('admin.users.recoveryRegen')} icon="key" variant="outline" loading={recoveryBusy} onPress={() => void regenerate()} />
            {recovery ? (
              recovery.emailed ? (
                <Text tone="primary">{t('admin.users.recoveryEmailed')}</Text>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text variant="caption">{t('admin.users.recoveryCopyHint')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {(recovery.codes ?? []).map((c) => (
                      <Text key={c} selectable style={{ width: '50%', fontFamily: MONO_FONT, paddingVertical: 2 }}>
                        {c}
                      </Text>
                    ))}
                  </View>
                  <Button
                    title={copied('codes') ? t('common.copied') : t('admin.users.recoveryCopy')}
                    icon="copy"
                    variant="outline"
                    size="sm"
                    onPress={() => void copy('codes', (recovery.codes ?? []).join('\n'))}
                  />
                </View>
              )
            ) : null}
          </FormCard>
        </>
      ) : null}

      {local && !u.bot ? (
        <>
          <SectionTitle title={t('admin.users.notice')} />
          <Note>{t('admin.users.noticeHint')}</Note>
          <FormCard style={{ marginBottom: 16 }}>
            <TextArea
              value={notice}
              onChangeText={(v) => {
                setNotice(v);
                setNoticeSent(false);
              }}
              placeholder={t('admin.users.noticePlaceholder')}
              maxLength={2000}
              disabled={noticeBusy}
              error={noticeError || undefined}
              accessibilityLabel={t('admin.users.notice')}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Button title={t('admin.users.noticeSend')} icon="paper-plane" loading={noticeBusy} disabled={!notice.trim()} onPress={() => void sendNotice()} />
              {noticeSent ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="circle-check" size={12} tone="primary" />
                  <Text tone="primary">{t('admin.users.noticeSent')}</Text>
                </View>
              ) : null}
            </View>
          </FormCard>
        </>
      ) : null}

      <ListSection title={t('admin.users.sessions', { count: detail.sessions.length })}>
        {detail.sessions.length === 0 ? (
          <SettingItem title={t('admin.users.noSessions')} />
        ) : (
          detail.sessions.map((s) => (
            <SettingItem key={s.session_id} icon="laptop" title={s.user_agent || t('common.unknown')} description={`${s.ip_address} · ${adminWhen(s.created_at)}`} />
          ))
        )}
      </ListSection>

      <ListSection title={t('admin.users.spaces', { count: detail.spaces.length })}>
        {detail.spaces.length === 0 ? (
          <SettingItem title={t('admin.users.noSpaces')} />
        ) : (
          detail.spaces.map((sp) => (
            <SettingItem
              key={sp.id}
              leading={<Avatar uri={sp.icon} name={sp.name} size="md" shape="rounded" />}
              title={sp.name}
              value={sp.owner_id === u.id ? t('admin.space.ownerShort') : undefined}
              chevron
              onPress={() => router.push(adminSpacePath(sp.id) as Href)}
            />
          ))
        )}
      </ListSection>

      <ListSection title={t('admin.users.reportsAgainst', { count: detail.reports.length })}>
        {detail.reports.length === 0 ? (
          <SettingItem title={t('admin.users.noReports')} />
        ) : (
          detail.reports.map((r) => (
            <SettingItem
              key={r.id}
              icon="flag"
              title={t(`report.reasons.${r.reason}`)}
              description={`${t(`admin.reports.status.${r.status}`)} · ${adminWhen(r.created_at)}`}
              chevron
              onPress={() => router.push(adminReportPath(r.id) as Href)}
            />
          ))
        )}
      </ListSection>

      <TextPromptSheet
        open={banOpen}
        title={t('admin.users.banTitle', { name: adminName(u) })}
        description={t('admin.users.banBody')}
        icon="ban"
        tone="danger"
        label={t('admin.users.banReason')}
        placeholder={t('admin.users.banReasonPlaceholder')}
        maxLength={500}
        multiline
        allowEmpty
        confirmLabel={t('admin.users.confirmBan')}
        confirmVariant="destructive"
        onConfirm={async (reason) => {
          try {
            await banUser(u.id, { reason: reason.trim(), max_age_seconds: banSeconds, ban_ips: banIps && detail.sessions.length > 0 });
          } catch {
            throw new Error(t('admin.actionFailed'));
          }
          setBanOpen(false);
          setBanIps(false);
          await load();
        }}
        onClose={() => setBanOpen(false)}
      >
        <DurationPicker value={banSeconds} onChange={setBanSeconds} />
        {detail.sessions.length > 0 ? (
          <Checkbox checked={banIps} onChange={setBanIps} label={t('admin.users.banIPs', { count: detail.sessions.length })} description={t('admin.users.banIPsHint')} />
        ) : null}
      </TextPromptSheet>

      <TextPromptSheet
        open={emailOpen}
        title={t('admin.users.changeEmailTitle', { name: adminName(u) })}
        description={t('admin.users.changeEmailBody')}
        icon="envelope"
        label={t('admin.users.newEmail')}
        placeholder={u.email || 'name@example.com'}
        keyboardType="email-address"
        autoCapitalize="none"
        confirmLabel={t('admin.users.confirmChangeEmail')}
        onConfirm={async (email) => {
          try {
            await setUserEmail(u.id, email.trim());
          } catch (err) {
            throw new Error(translateCaughtApiError(err, t).join(' ') || t('admin.actionFailed'));
          }
          setEmailOpen(false);
          await load();
        }}
        onClose={() => setEmailOpen(false)}
      />
    </SettingsScreen>
  );
}
