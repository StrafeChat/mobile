/**
 * Space settings -> Bans (SpaceBansPage): who is banned, why, by whom and when, searchable by
 * name, username or reason, newest first, with Revoke (confirmed) for members who can ban.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { formatDate, t } from '@web/i18n/t';
import { listSpaceBans, unbanSpaceMember, type SpaceBan } from '@web/api/spaces';
import { confirmDialog } from '@web/stores/confirmDialog';
import { Avatar, BotTag, Button, EmptyState, SearchInput, Spinner, Text } from '@/ui';
import { useLoad } from '../hooks/useLoad';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

export const banName = (b: SpaceBan) => b.user?.display_name || b.user?.username || b.user_id;

/** SpaceBansPage's search: name, username or reason. */
export function filterBans(bans: readonly SpaceBan[], query: string): SpaceBan[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...bans];
  return bans.filter((b) => banName(b).toLowerCase().includes(q) || (b.user?.username ?? '').toLowerCase().includes(q) || (b.reason ?? '').toLowerCase().includes(q));
}

function Bans({ data, setError }: { data: SpaceSettingsData; setError: (m: string) => void }) {
  const bans = useLoad(async () => [...(await listSpaceBans(data.spaceId))].sort((a, b) => b.created_at.localeCompare(a.created_at)), [data.spaceId]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const all = useMemo(() => bans.data ?? [], [bans.data]);
  const list = useMemo(() => filterBans(all, query), [all, query]);

  async function revoke(b: SpaceBan) {
    const ok = await confirmDialog({
      title: t('spaceSettings.bans.revokeTitle'),
      body: t('spaceSettings.bans.revokeBody', { name: banName(b) }),
      confirmLabel: t('spaceSettings.bans.revoke'),
      icon: 'fa-solid fa-user-check',
    });
    if (!ok) return;
    setBusyId(b.user_id);
    setError('');
    try {
      await unbanSpaceMember(data.spaceId, b.user_id);
      bans.setData((prev) => (prev ?? []).filter((x) => x.user_id !== b.user_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spaceSettings.bans.revokeFailed'));
    } finally {
      setBusyId('');
    }
  }

  if (bans.error && !bans.data) {
    return <EmptyState icon="fa-solid fa-triangle-exclamation" title={t('spaceSettings.bans.loadFailed')} action={<Button title={t('common.retry')} variant="outline" onPress={() => void bans.reload()} />} />;
  }

  return (
    <FlashList
      data={list}
      keyExtractor={(b) => b.user_id}
      keyboardShouldPersistTaps="handled"
      refreshing={bans.refreshing}
      onRefresh={() => void bans.reload()}
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}>
          <SearchInput value={query} onValueChange={setQuery} placeholder={t('spaceSettings.bans.search')} />
          <Text variant="caption">{t('spaceSettings.bans.count', { count: all.length })}</Text>
        </View>
      }
      ListEmptyComponent={
        bans.loading ? <Spinner fill /> : <EmptyState icon="fa-solid fa-ban" body={all.length ? t('spaceSettings.bans.noMatch') : t('spaceSettings.bans.none')} />
      }
      renderItem={({ item: b }) => {
        const by = b.banned_by_user?.display_name || b.banned_by_user?.username || t('common.someone');
        return (
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' }}>
            <Avatar uri={b.user?.avatar} name={banName(b)} size="lg" />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {banName(b)}
                </Text>
                {b.user?.bot ? <BotTag bot /> : null}
              </View>
              <Text variant="caption" tone={b.reason ? 'default' : 'muted'}>
                {b.reason || t('spaceSettings.bans.noReason')}
              </Text>
              <Text variant="caption">
                {t('spaceSettings.bans.colBy')}: {by} · {formatDate(b.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
              </Text>
            </View>
            {data.gates.canBan ? (
              <Button title={t('spaceSettings.bans.revoke')} size="sm" variant="outline" loading={busyId === b.user_id} onPress={() => void revoke(b)} />
            ) : null}
          </View>
        );
      }}
    />
  );
}

export function SpaceBansScreen() {
  return (
    <SpacePage page="bans" scroll={false}>
      {(data, { setError }) => <Bans data={data} setError={setError} />}
    </SpacePage>
  );
}
