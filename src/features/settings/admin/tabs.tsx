/**
 * The admin dashboard's tabs (AdminPage.tsx, DiscoverQueue.tsx): Overview stat cards; Users
 * search; the Reports queue by status; account and network bans; the Discover review queue;
 * the audit timeline; the federation allow / block lists. Rows open the detail screens.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import {
  banIP,
  listAudit,
  listBans,
  listFederationPolicy,
  listIPBans,
  listReports,
  removeFederationPolicy,
  searchUsers,
  setFederationPolicy,
  unbanIP,
  unbanUser,
  type AdminUser,
  type AuditRow,
  type FederationPolicy,
  type InstanceStats,
  type ReportRow,
  type ReportStatus,
} from '@web/api/instance';
import { listDiscoverQueue, reviewDiscoverListing, type DiscoverEntry, type DiscoverStatus } from '@web/api/discover';
import { confirmDialog } from '@web/stores/confirmDialog';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { useTheme } from '@/theme';
import {
  Avatar,
  Banner,
  Button,
  EmptyState,
  Icon,
  Input,
  ListSection,
  SearchInput,
  SegmentedControl,
  Skeleton,
  Spinner,
  Text,
  Touchable,
  WIDE_BREAKPOINT,
  withAlpha,
} from '@/ui';
import { FormCard, Note, SectionTitle, SettingItem } from '../components/rows';
import { TextPromptSheet } from '../components/sheets';
import { openSettings } from '../navigation';
import { adminReportPath, adminSpacePath, adminUserPath, type AdminTabId } from '../routes';
import { DurationPicker, adminName, adminTag, adminWhen, statNumber } from './shared';

const goUser = (id: string) => router.push(adminUserPath(id) as Href);
const goReport = (id: string) => router.push(adminReportPath(id) as Href);
const goSpace = (id: string) => router.push(adminSpacePath(id) as Href);

// ---- overview --------------------------------------------------------------------------

type StatTone = 'primary' | 'sky' | 'blue' | 'amber' | 'red' | 'violet';

function StatCard({ label, value, icon, tone, onPress, width }: { label: string; value: string; icon: string; tone: StatTone; onPress?: () => void; width: number }) {
  const theme = useTheme();
  // The web's stat chips use fixed Tailwind hues for at-a-glance grouping; mapped to theme colours here.
  const color =
    tone === 'red' ? theme.colors.destructive : tone === 'amber' ? theme.colors.warning : tone === 'primary' ? theme.colors.primary : tone === 'sky' ? theme.colors.link : tone === 'blue' ? theme.colors.ring : theme.colors.mention;
  return (
    <Touchable
      onPress={onPress}
      disabled={!onPress}
      feedback={onPress ? 'opacity' : 'none'}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${label}: ${value}`}
      style={{ width, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: theme.radii.xl, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card }}
    >
      <View style={{ width: 40, height: 40, borderRadius: theme.radii.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(color, 0.15) }}>
        <Icon name={icon} size={16} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="title" style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1}>
          {value}
        </Text>
        <Text variant="caption" numberOfLines={2}>
          {label}
        </Text>
      </View>
      {onPress ? <Icon name="chevron-right" size={11} tone="muted" /> : null}
    </Touchable>
  );
}

export function OverviewTab({ stats, onTab }: { stats: InstanceStats | null | undefined; onTab: (tab: AdminTabId) => void }) {
  const { width } = useWindowDimensions();
  const columns = width >= WIDE_BREAKPOINT ? 3 : 2;
  const cardWidth = Math.floor((Math.min(width, 720) - 24 - (columns - 1) * 10) / columns);
  if (stats === undefined) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 12 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} width={cardWidth} height={72} radius={16} />
        ))}
      </View>
    );
  }
  if (stats === null) return <EmptyState icon="fa-solid fa-triangle-exclamation" title={t('admin.actionFailed')} />;
  const grid = (cards: ReactNode) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 12, marginBottom: 16 }}>{cards}</View>;
  return (
    <View>
      <SectionTitle title={t('admin.overview.activity')} />
      {grid(
        <>
          <StatCard width={cardWidth} label={t('admin.overview.accounts')} value={statNumber(stats.accounts)} icon="users" tone="primary" />
          <StatCard width={cardWidth} label={t('admin.overview.online')} value={statNumber(stats.online)} icon="signal" tone="sky" />
          <StatCard width={cardWidth} label={t('admin.overview.spaces')} value={statNumber(stats.spaces)} icon="layer-group" tone="blue" />
        </>,
      )}
      <SectionTitle title={t('admin.overview.moderation')} />
      {grid(
        <>
          <StatCard width={cardWidth} label={t('admin.overview.openReports')} value={String(stats.open_reports)} icon="flag" tone="amber" onPress={() => onTab('reports')} />
          <StatCard width={cardWidth} label={t('admin.overview.bans')} value={String(stats.bans)} icon="ban" tone="red" onPress={() => onTab('bans')} />
          <StatCard width={cardWidth} label={t('admin.overview.ipBans')} value={String(stats.ip_bans ?? 0)} icon="network-wired" tone="red" onPress={() => onTab('bans')} />
        </>,
      )}
      <SectionTitle title={t('admin.overview.instance')} />
      {grid(
        <>
          <StatCard width={cardWidth} label={t('admin.overview.invites')} value={String(stats.invites)} icon="ticket" tone="violet" onPress={() => openSettings('instance')} />
          <StatCard
            width={cardWidth}
            label={t('admin.overview.registration')}
            value={stats.invite_only ? t('admin.overview.inviteOnly') : t('admin.overview.open')}
            icon={stats.invite_only ? 'lock' : 'door-open'}
            tone="violet"
            onPress={() => openSettings('instance')}
          />
        </>,
      )}
      <Note>{t('mobile.settings.adminOverviewHint')}</Note>
    </View>
  );
}

// ---- users -----------------------------------------------------------------------------

export function UsersTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  async function search() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError('');
    try {
      const r = await searchUsers(q);
      setResults(r);
      if (r.length === 1) goUser(r[0]!.id);
    } catch {
      setError(t('admin.users.searchFailed'));
    } finally {
      setSearching(false);
    }
  }

  return (
    <View>
      <FormCard style={{ marginBottom: 12 }}>
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('admin.users.searchPlaceholder')}
          onSubmit={() => void search()}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          testID="admin-user-search"
        />
        <Button title={t('admin.users.search')} icon="magnifying-glass" loading={searching} disabled={!query.trim()} onPress={() => void search()} />
        <Text variant="caption">{t('admin.users.searchHint')}</Text>
      </FormCard>
      {error ? <Note tone="danger">{error}</Note> : null}
      {results && results.length === 0 && !error ? <EmptyState icon="fa-solid fa-user-slash" title={t('admin.users.noResults')} /> : null}
      {results && results.length > 0 ? (
        <ListSection title={t('admin.users.results', { count: results.length })}>
          {results.map((u) => (
            <SettingItem
              key={u.id}
              leading={<Avatar uri={u.avatar} name={adminName(u)} size="lg" />}
              title={adminName(u)}
              description={[adminTag(u), u.email].filter(Boolean).join(' · ')}
              chevron
              onPress={() => goUser(u.id)}
            />
          ))}
        </ListSection>
      ) : null}
      {!results ? <EmptyState icon="fa-solid fa-users-viewfinder" title={t('admin.users.pickOne')} /> : null}
    </View>
  );
}

// ---- reports ---------------------------------------------------------------------------

export function ReportsTab({ reloadKey }: { reloadKey: number }) {
  const [status, setStatus] = useState<ReportStatus>('open');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(false);
    listReports(status)
      .then((r) => live && setRows(r))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [status, reloadKey]);

  const targetLabel = (r: ReportRow) => (r.report.target_type === 'user' ? adminName(r.target_user) : r.target_space?.name || t('admin.space.gone'));

  return (
    <View>
      <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        <SegmentedControl<ReportStatus>
          value={status}
          onChange={setStatus}
          accessibilityLabel={t('admin.tabs.reports')}
          items={[
            { id: 'open', icon: 'inbox', label: t('admin.reports.status.open') },
            { id: 'resolved', icon: 'circle-check', label: t('admin.reports.status.resolved') },
            { id: 'dismissed', icon: 'circle-xmark', label: t('admin.reports.status.dismissed') },
          ]}
        />
      </View>
      {error ? (
        <EmptyState icon="fa-solid fa-triangle-exclamation" title={t('admin.actionFailed')} />
      ) : rows === null ? (
        <Spinner fill />
      ) : rows.length === 0 ? (
        <EmptyState icon="fa-solid fa-flag" title={t('admin.reports.empty')} />
      ) : (
        <ListSection>
          {rows.map((r) => (
            <SettingItem
              key={r.report.id}
              icon={r.report.target_type === 'space' ? 'layer-group' : 'user'}
              title={targetLabel(r)}
              titleAccessory={<ReasonChip reason={r.report.reason} />}
              description={`${t('admin.reports.by', { name: adminName(r.reporter) })} · ${adminWhen(r.report.created_at)}`}
              chevron
              onPress={() => goReport(r.report.id)}
            />
          ))}
        </ListSection>
      )}
    </View>
  );
}

export function ReasonChip({ reason }: { reason: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: withAlpha(theme.colors.destructive, 0.12) }}>
      <Icon name="flag" size={9} color={theme.colors.destructive} />
      <Text variant="caption" color={theme.colors.destructive} weight="semibold" maxFontSizeMultiplier={1.4}>
        {t(`report.reasons.${reason}`)}
      </Text>
    </View>
  );
}

// ---- bans --------------------------------------------------------------------------------

export function BansTab({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof listBans>> | null>(null);
  const [ips, setIps] = useState<Awaited<ReturnType<typeof listIPBans>> | null>(null);
  const [ipSheet, setIpSheet] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [cidr, setCidr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    listBans()
      .then((r) => live && setAccounts(r))
      .catch(() => live && setAccounts([]));
    listIPBans()
      .then((r) => live && setIps(r))
      .catch(() => live && setIps([]));
    return () => {
      live = false;
    };
  }, [reloadKey, tick]);

  async function liftAccount(userId: string, name: string) {
    const ok = await confirmDialog({ title: t('admin.users.unbanTitle', { name }), body: t('admin.users.unbanBody'), confirmLabel: t('admin.users.unban') });
    if (!ok) return;
    await unbanUser(userId).catch(() => setError(t('admin.actionFailed')));
    setTick((n) => n + 1);
    onChanged();
  }

  async function liftIp(c: string) {
    const ok = await confirmDialog({ title: t('admin.bans.ipLiftTitle', { cidr: c }), body: t('admin.bans.ipLiftBody'), confirmLabel: t('admin.bans.ipLift') });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await unbanIP(c);
      setTick((n) => n + 1);
      onChanged();
    } catch {
      setError(t('admin.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      {error ? <Banner tone="error" message={error} onDismiss={() => setError('')} style={{ marginHorizontal: 12, marginBottom: 12 }} /> : null}
      <ListSection title={t('admin.bans.accountsTitle')}>
        {accounts === null ? (
          <View style={{ padding: 16 }}>
            <Spinner />
          </View>
        ) : accounts.length === 0 ? (
          <SettingItem icon="ban" title={t('admin.bans.empty')} />
        ) : (
          accounts.map((row) => (
            <SettingItem
              key={row.ban.user_id}
              leading={<Avatar uri={row.user?.avatar} name={adminName(row.user)} size="lg" />}
              title={adminName(row.user)}
              description={`${adminTag(row.user)}\n${row.ban.reason || t('admin.users.noReason')} · ${row.ban.expires_at ? t('admin.users.bannedUntil', { when: adminWhen(row.ban.expires_at) }) : t('admin.users.bannedForever')}`}
              onPress={() => goUser(row.ban.user_id)}
              accessibilityActions={[{ name: 'unban', label: t('admin.users.unban') }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'unban') void liftAccount(row.ban.user_id, adminName(row.user));
              }}
              trailing={<Button title={t('admin.users.unban')} size="sm" variant="outline" onPress={() => void liftAccount(row.ban.user_id, adminName(row.user))} />}
            />
          ))
        )}
      </ListSection>

      <SectionTitle
        title={t('admin.bans.ipTitle')}
        right={<Button title={t('admin.bans.ipBan')} icon="plus" size="sm" variant="destructive" onPress={() => setIpSheet(true)} testID="admin-ip-ban" />}
      />
      <Note>{t('admin.bans.ipHint')}</Note>
      <ListSection>
        {ips === null ? (
          <View style={{ padding: 16 }}>
            <Spinner />
          </View>
        ) : ips.length === 0 ? (
          <SettingItem icon="network-wired" title={t('admin.bans.ipEmpty')} />
        ) : (
          ips.map((row) => (
            <SettingItem
              key={row.ban.cidr}
              icon="network-wired"
              destructive
              title={row.ban.cidr}
              description={`${row.ban.reason || t('admin.users.noReason')} · ${row.ban.expires_at ? t('admin.users.bannedUntil', { when: adminWhen(row.ban.expires_at) }) : t('admin.users.bannedForever')} · ${t('admin.bans.ipBy', { name: adminName(row.banned_by) })}`}
              trailing={<Button title={t('admin.bans.ipLift')} size="sm" variant="outline" disabled={busy} onPress={() => void liftIp(row.ban.cidr)} />}
            />
          ))
        )}
      </ListSection>

      <TextPromptSheet
        open={ipSheet}
        title={t('admin.bans.ipBan')}
        description={t('admin.bans.ipHint')}
        icon="network-wired"
        tone="danger"
        label={t('admin.users.banReason')}
        placeholder={t('admin.bans.ipReasonPlaceholder')}
        maxLength={500}
        allowEmpty
        confirmLabel={t('admin.bans.ipBan')}
        confirmVariant="destructive"
        onConfirm={async (reason) => {
          const c = cidr.trim();
          if (!c) throw new Error(t('admin.bans.ipCidr'));
          try {
            await banIP({ cidr: c, reason: reason.trim(), max_age_seconds: seconds });
          } catch (err) {
            throw new Error(translateCaughtApiError(err, t).join(' ') || t('admin.actionFailed'));
          }
          setCidr('');
          setSeconds(0);
          setIpSheet(false);
          setTick((n) => n + 1);
          onChanged();
        }}
        onClose={() => setIpSheet(false)}
      >
        <Input
          label={t('admin.bans.ipCidr')}
          placeholder="203.0.113.0/24"
          value={cidr}
          onChangeText={setCidr}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          testID="admin-ip-cidr"
        />
        <DurationPicker value={seconds} onChange={setSeconds} />
      </TextPromptSheet>
    </View>
  );
}

// ---- discover ----------------------------------------------------------------------------

const discoverName = (e: DiscoverEntry) => e.space?.name ?? e.bot?.name ?? e.id;
const discoverAvatar = (e: DiscoverEntry) => e.space?.icon ?? e.bot?.bot?.avatar ?? e.bot?.icon;

export function DiscoverTab({ reloadKey }: { reloadKey: number }) {
  const theme = useTheme();
  const [status, setStatus] = useState<DiscoverStatus>('pending');
  const [rows, setRows] = useState<DiscoverEntry[] | null>(null);
  const [declining, setDeclining] = useState<DiscoverEntry | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setRows(null);
    listDiscoverQueue(status)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [status, reloadKey, tick]);

  async function approve(e: DiscoverEntry) {
    const ok = await confirmDialog({ title: t('admin.discover.approveTitle', { name: discoverName(e) }), body: t('admin.discover.approveBody'), confirmLabel: t('admin.discover.approve') });
    if (!ok) return;
    setError('');
    try {
      await reviewDiscoverListing(e.kind, e.id, 'approve');
    } catch {
      setError(t('admin.actionFailed'));
    }
    setTick((n) => n + 1);
  }

  return (
    <View>
      <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        <SegmentedControl<DiscoverStatus>
          value={status}
          onChange={setStatus}
          accessibilityLabel={t('admin.tabs.discover')}
          items={[
            { id: 'pending', icon: 'hourglass-half', label: t('admin.discover.pending') },
            { id: 'approved', icon: 'circle-check', label: t('admin.discover.approved') },
            { id: 'denied', icon: 'circle-xmark', label: t('admin.discover.denied') },
          ]}
        />
      </View>
      {error ? <Note tone="danger">{error}</Note> : null}
      {rows === null ? (
        <Spinner fill />
      ) : rows.length === 0 ? (
        <EmptyState icon="fa-solid fa-compass" title={t('admin.discover.empty')} />
      ) : (
        <ListSection>
          {rows.map((e) => (
            <View key={`${e.kind}:${e.id}`} style={{ padding: 16, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar uri={discoverAvatar(e)} name={discoverName(e)} size="lg" shape="rounded" />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text
                      weight="semibold"
                      numberOfLines={1}
                      tone={e.kind === 'space' ? 'link' : 'default'}
                      onPress={e.kind === 'space' ? () => goSpace(e.id) : undefined}
                      accessibilityRole={e.kind === 'space' ? 'link' : undefined}
                    >
                      {discoverName(e)}
                    </Text>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: theme.colors.muted }}>
                      <Text variant="caption" weight="semibold">
                        {e.kind === 'space' ? t('admin.discover.kindSpace') : t('admin.discover.kindBot')}
                      </Text>
                    </View>
                    {e.space ? <Text variant="caption">{t('discover.members', { count: e.space.member_count })}</Text> : null}
                  </View>
                  {e.tagline ? <Text variant="caption" tone="default">{e.tagline}</Text> : null}
                  <Text variant="caption">
                    {e.requested_by_user ? (
                      <>
                        {t('admin.discover.requestedBy')}{' '}
                        <Text variant="caption" tone="link" onPress={() => goUser(e.requested_by_user!.id)} accessibilityRole="link">
                          @{e.requested_by_user.username}
                        </Text>
                        {' · '}
                      </>
                    ) : null}
                    {adminWhen(e.requested_at)}
                    {e.tags.length ? ` · ${e.tags.join(', ')}` : ''}
                    {e.status === 'denied' && e.note ? ` · ${e.note}` : ''}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {e.status !== 'approved' ? <Button title={t('admin.discover.approve')} size="sm" onPress={() => void approve(e)} /> : null}
                {e.status === 'pending' ? <Button title={t('admin.discover.deny')} size="sm" variant="outline" onPress={() => setDeclining(e)} /> : null}
                {e.status === 'approved' ? <Button title={t('admin.discover.remove')} size="sm" variant="outline" onPress={() => setDeclining(e)} /> : null}
              </View>
            </View>
          ))}
        </ListSection>
      )}
      <TextPromptSheet
        open={!!declining}
        title={declining ? (declining.status === 'approved' ? t('admin.discover.removeTitle', { name: discoverName(declining) }) : t('admin.discover.denyTitle', { name: discoverName(declining) })) : ''}
        icon="compass"
        label={t('admin.discover.noteLabel')}
        placeholder={t('admin.discover.notePlaceholder')}
        maxLength={500}
        multiline
        allowEmpty
        confirmLabel={declining?.status === 'approved' ? t('admin.discover.remove') : t('admin.discover.deny')}
        confirmVariant="destructive"
        onConfirm={async (note) => {
          if (!declining) return;
          try {
            await reviewDiscoverListing(declining.kind, declining.id, 'deny', note.trim());
          } catch {
            throw new Error(t('admin.actionFailed'));
          }
          setDeclining(null);
          setTick((n) => n + 1);
        }}
        onClose={() => setDeclining(null)}
      />
    </View>
  );
}

// ---- audit --------------------------------------------------------------------------------

const AUDIT_ICON: Record<string, string> = {
  user_ban: 'ban',
  user_unban: 'user-check',
  user_recovery_regen: 'key',
  space_takedown: 'trash',
  report_resolve: 'check',
  report_dismiss: 'xmark',
  invite_create: 'ticket',
  invite_revoke: 'ticket',
  discover_approve: 'compass',
  discover_deny: 'compass',
  discover_remove: 'compass',
};

export function AuditTab({ reloadKey }: { reloadKey: number }) {
  const theme = useTheme();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    let live = true;
    listAudit()
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [reloadKey]);
  if (rows === null) return <Spinner fill />;
  if (rows.length === 0) return <EmptyState icon="fa-solid fa-clock-rotate-left" title={t('admin.audit.empty')} />;
  return (
    <View style={{ paddingHorizontal: 12 }}>
      {rows.map((row, i) => {
        const e = row.entry;
        const isUser = e.target_type === 'user' && e.target_id !== '0';
        return (
          <View key={e.id} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 32, alignItems: 'center' }}>
              <View style={{ position: 'absolute', top: i === 0 ? 20 : 0, bottom: i === rows.length - 1 ? undefined : 0, height: i === rows.length - 1 ? 20 : undefined, width: 1, backgroundColor: theme.colors.border }} />
              <View style={{ marginTop: 10, width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={AUDIT_ICON[e.action] ?? 'circle-info'} size={12} tone="muted" />
              </View>
            </View>
            <View style={{ flex: 1, marginVertical: 5, padding: 12, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, gap: 2 }}>
              <Text>
                <Text weight="semibold" onPress={() => goUser(e.actor_id)} accessibilityRole="link">
                  {adminName(row.actor)}
                </Text>{' '}
                {t(`admin.audit.actions.${e.action}`, { defaultValue: e.action })}
                {isUser ? (
                  <>
                    {' '}
                    <Text tone="link" onPress={() => goUser(e.target_id)} accessibilityRole="link" style={{ fontVariant: ['tabular-nums'] }}>
                      {e.target_id}
                    </Text>
                  </>
                ) : null}
                {!isUser && e.reason ? ` · ${e.reason}` : ''}
              </Text>
              <Text variant="caption">
                {adminWhen(e.created_at)}
                {isUser && e.reason ? ` · ${e.reason}` : ''}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---- federation ---------------------------------------------------------------------------

function DomainList({
  kind,
  policy,
  busy,
  onAdd,
  onRemove,
}: {
  kind: 'allow' | 'block';
  policy: FederationPolicy;
  busy: boolean;
  onAdd: (domain: string) => Promise<boolean>;
  onRemove: (domain: string) => void;
}) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const entries = kind === 'allow' ? policy.allow : policy.block;
  const env = (kind === 'allow' ? policy.env_allow : policy.env_block) ?? [];
  const total = entries.length + env.length;
  const tone = kind === 'allow' ? theme.colors.primary : theme.colors.destructive;
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 16, borderRadius: theme.radii.xl, borderWidth: 1, borderColor: withAlpha(tone, 0.3), backgroundColor: theme.colors.card, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: withAlpha(tone, 0.1) }}>
        <Icon name={kind === 'allow' ? 'circle-check' : 'ban'} size={14} color={tone} />
        <Text weight="semibold" color={tone} style={{ flex: 1 }} accessibilityRole="header">
          {kind === 'allow' ? t('admin.federation.allowHeading') : t('admin.federation.blockHeading')}
        </Text>
        <Text variant="caption" weight="semibold">
          {total}
        </Text>
      </View>
      <View style={{ padding: 12, gap: 10 }}>
        <Text variant="caption">{kind === 'allow' ? t('admin.federation.allowHint') : t('admin.federation.blockHint')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Input
            containerStyle={{ flex: 1 }}
            value={value}
            onChangeText={setValue}
            placeholder={t('admin.federation.domainPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel={kind === 'allow' ? t('admin.federation.addAllow') : t('admin.federation.addBlock')}
            returnKeyType="done"
            onSubmitEditing={() => void onAdd(value.trim()).then((ok) => ok && setValue(''))}
          />
          <Button
            title={kind === 'allow' ? t('admin.federation.addAllow') : t('admin.federation.addBlock')}
            variant={kind === 'allow' ? 'primary' : 'destructive'}
            disabled={busy || !value.trim()}
            onPress={() => void onAdd(value.trim()).then((ok) => ok && setValue(''))}
          />
        </View>
        {entries.map((e) => (
          <View key={e.domain} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border }}>
            <Text style={{ flex: 1 }} numberOfLines={1}>
              {e.domain}
            </Text>
            <Button title={t('admin.federation.remove')} icon="xmark" size="sm" variant="ghost" disabled={busy} onPress={() => onRemove(e.domain)} />
          </View>
        ))}
        {env.map((d) => (
          <View key={`env:${d}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border }}>
            <Text style={{ flex: 1 }} numberOfLines={1}>
              {d}
            </Text>
            <Text variant="caption" weight="semibold">
              {t('admin.federation.fromConfig')}
            </Text>
          </View>
        ))}
        {total === 0 ? <Text variant="caption">{t('admin.federation.empty')}</Text> : null}
      </View>
    </View>
  );
}

export function FederationTab({ reloadKey }: { reloadKey: number }) {
  const theme = useTheme();
  const [policy, setPolicy] = useState<FederationPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    listFederationPolicy()
      .then((p) => live && setPolicy(p))
      .catch(() => live && setError(t('admin.federation.failed')));
    return () => {
      live = false;
    };
  }, [reloadKey, tick]);

  async function add(domain: string, kind: 'allow' | 'block'): Promise<boolean> {
    if (!domain) return false;
    setBusy(true);
    setError('');
    try {
      await setFederationPolicy(domain, kind);
      setTick((n) => n + 1);
      return true;
    } catch {
      setError(t('admin.federation.invalid'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(domain: string) {
    setBusy(true);
    setError('');
    try {
      await removeFederationPolicy(domain);
      setTick((n) => n + 1);
    } catch {
      setError(t('admin.federation.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!policy) return error ? <Note tone="danger">{error}</Note> : <Spinner fill />;
  if (!policy.enabled) {
    return (
      <FormCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="plug-circle-xmark" size={18} tone="muted" />
          <Text tone="muted" style={{ flex: 1 }}>
            {t('admin.federation.disabled')}
          </Text>
        </View>
      </FormCard>
    );
  }
  const allowlist = policy.allow.length > 0 || (policy.env_allow?.length ?? 0) > 0;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: theme.radii.lg, backgroundColor: withAlpha(theme.colors.primary, 0.15), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="globe" size={18} tone="primary" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="heading">{t('admin.federation.title')}</Text>
          <Text variant="caption">{t('admin.federation.self', { domain: policy.domain })}</Text>
        </View>
      </View>
      <Banner tone={allowlist ? 'warning' : 'info'} icon={allowlist ? 'lock' : 'lock-open'} message={allowlist ? t('admin.federation.allowlistMode') : t('admin.federation.openMode')} style={{ marginHorizontal: 12, marginBottom: 16 }} />
      {error ? <Note tone="danger">{error}</Note> : null}
      <DomainList kind="allow" policy={policy} busy={busy} onAdd={(d) => add(d, 'allow')} onRemove={(d) => void remove(d)} />
      <DomainList kind="block" policy={policy} busy={busy} onAdd={(d) => add(d, 'block')} onRemove={(d) => void remove(d)} />
      {(policy.env_allow?.length ?? 0) + (policy.env_block?.length ?? 0) > 0 ? <Note>{t('admin.federation.envHint')}</Note> : null}
    </View>
  );
}
