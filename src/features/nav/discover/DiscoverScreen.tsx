/**
 * Discover (DiscoverPage): the spaces and bots this instance's administrators listed - and
 * listings shared by instances it federates with. Spaces join without an invite; a bot's card
 * opens its install consent screen. Search filters on the device; pull to refresh refetches.
 *
 * Joining a space listed elsewhere posts `id@origin_domain` and then opens the LOCAL id the
 * server answers with (the mirror here), never the origin's id.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { t } from '@web/i18n/t';
import { joinDiscoverSpace, listDiscoverBots, listDiscoverSpaces, type DiscoverEntry } from '@web/api/discover';
import { getSpace } from '@web/api/spaces';
import { addOrUpdateSpace } from '@web/stores/spaces';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { useSpaceIds } from '@/data';
import { useTheme } from '@/theme';
import { Avatar, Banner, Button, EmptyState, Header, Icon, SearchInput, SegmentedControl, Spinner, Text, withAlpha } from '@/ui';
import { goBack, goToSpace, openBotInstall } from '../navigation';
import { SpaceIcon } from '../SpaceIcon';
import { hasRemoteListings, isJoinedListing, visibleListings, type DiscoverScope, type DiscoverTab } from './model';

interface Loadable {
  loading: boolean;
  failed: boolean;
  data: DiscoverEntry[];
}

const INITIAL: Loadable = { loading: true, failed: false, data: [] };

function Tag({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: withAlpha(theme.colors.muted, 0.6), borderRadius: theme.radii.sm }]}>
      <Text variant="caption" weight="medium">
        {label}
      </Text>
    </View>
  );
}

const SpaceCard = memo(function SpaceCard({
  entry,
  joined,
  joining,
  onJoin,
}: {
  entry: DiscoverEntry;
  joined: boolean;
  joining: boolean;
  onJoin: (e: DiscoverEntry) => void;
}) {
  const theme = useTheme();
  const card = entry.space!;
  const name = card.name || t('space.unnamed');
  return (
    <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.card, borderRadius: theme.radii.xl }]}>
      <View style={[styles.banner, { backgroundColor: withAlpha(theme.colors.primary, 0.2) }]}>
        {card.banner ? <Image source={{ uri: card.banner }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={card.banner} /> : null}
      </View>
      <View style={styles.cardBody}>
        <SpaceIcon
          name={name}
          initials={(card.name?.[0] ?? '?').toUpperCase()}
          icon={card.icon}
          size={48}
          radius={14}
          style={[styles.cardIcon, { borderColor: theme.colors.card }]}
        />
        <Text variant="heading" numberOfLines={1}>
          {name}
        </Text>
        {card.origin_domain ? (
          <View style={styles.inline} accessibilityLabel={t('discover.hostedOn', { domain: card.origin_domain })} accessible>
            <Icon name="fa-globe" size={10} tone="primary" />
            <Text variant="caption" tone="primary" numberOfLines={1}>
              {card.origin_domain}
            </Text>
          </View>
        ) : null}
        <View style={styles.inline}>
          <View style={[styles.onlineDot, { backgroundColor: theme.colors.online }]} />
          <Text variant="caption">
            {t('discover.online', { count: card.online_count })} · {t('discover.members', { count: card.member_count })}
          </Text>
        </View>
        {entry.tagline || card.description ? (
          <Text tone="muted" numberOfLines={2}>
            {entry.tagline || card.description}
          </Text>
        ) : null}
        {entry.tags.length > 0 ? (
          <View style={styles.tags}>
            {entry.tags.map((tg) => (
              <Tag key={tg} label={tg} />
            ))}
          </View>
        ) : null}
        <Button
          title={joined ? t('discover.open') : t('discover.join')}
          variant={joined ? 'outline' : 'primary'}
          size="sm"
          fullWidth
          loading={joining}
          onPress={() => onJoin(entry)}
          accessibilityLabel={`${joined ? t('discover.open') : t('discover.join')} ${name}`}
          style={styles.cardButton}
        />
      </View>
    </View>
  );
});

const BotCard = memo(function BotCard({ entry }: { entry: DiscoverEntry }) {
  const theme = useTheme();
  const bot = entry.bot!;
  const name = bot.bot?.display_name || bot.name;
  return (
    <View style={[styles.card, styles.botCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.card, borderRadius: theme.radii.xl }]}>
      <View style={styles.botHead}>
        <Avatar name={name} uri={bot.bot?.avatar || bot.icon} size={48} shape="rounded" />
        <View style={styles.flex}>
          <Text variant="heading" numberOfLines={1}>
            {name}
          </Text>
          {bot.bot ? (
            <Text variant="caption" numberOfLines={1}>
              @{bot.bot.username}
            </Text>
          ) : null}
        </View>
      </View>
      {entry.tagline || bot.description ? (
        <Text tone="muted" numberOfLines={3}>
          {entry.tagline || bot.description}
        </Text>
      ) : null}
      {entry.tags.length > 0 ? (
        <View style={styles.tags}>
          {entry.tags.map((tg) => (
            <Tag key={tg} label={tg} />
          ))}
        </View>
      ) : null}
      <Button
        title={t('discover.addBot')}
        icon="fa-plus"
        size="sm"
        fullWidth
        onPress={() => openBotInstall(bot.application_id)}
        accessibilityLabel={`${t('discover.addBot')}: ${name}`}
      />
    </View>
  );
});

export function DiscoverScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<DiscoverTab>('spaces');
  const [scope, setScope] = useState<DiscoverScope>('all');
  const [query, setQuery] = useState('');
  const [spaceList, setSpaceList] = useState<Loadable>(INITIAL);
  const [botList, setBotList] = useState<Loadable>(INITIAL);
  const [joining, setJoining] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mySpaceIds = useSpaceIds();
  const mine = useMemo(() => new Set(mySpaceIds), [mySpaceIds]);

  const load = useCallback(async () => {
    const [s, b] = await Promise.allSettled([listDiscoverSpaces(), listDiscoverBots()]);
    setSpaceList(s.status === 'fulfilled' ? { loading: false, failed: false, data: s.value } : { loading: false, failed: true, data: [] });
    setBotList(b.status === 'fulfilled' ? { loading: false, failed: false, data: b.value } : { loading: false, failed: true, data: [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const current = tab === 'spaces' ? spaceList : botList;
  const anyRemote = hasRemoteListings(spaceList.data);
  const visible = useMemo(() => visibleListings(current.data, tab, scope, query), [current.data, tab, scope, query]);
  const columns = width >= 1000 ? 3 : width >= 640 ? 2 : 1;

  const join = useCallback(
    async (e: DiscoverEntry) => {
      const card = e.space;
      if (!card) return;
      if (isJoinedListing(e, mine)) {
        goToSpace(card.id, { fromScreen: true });
        return;
      }
      setJoining(card.id);
      setError('');
      try {
        const joined = await joinDiscoverSpace(card.id, card.origin_domain);
        addOrUpdateSpace(await getSpace(joined.id));
        goToSpace(joined.id, { fromScreen: true });
      } catch (err) {
        setError(translateCaughtApiError(err, t)[0] ?? t('discover.joinFailed'));
      } finally {
        setJoining('');
      }
    },
    [mine],
  );

  const renderItem = useCallback(
    ({ item }: { item: DiscoverEntry }) => (
      <View style={styles.cell}>
        {item.space ? (
          <SpaceCard entry={item} joined={isJoinedListing(item, mine)} joining={joining === item.space.id} onJoin={(e) => void join(e)} />
        ) : (
          <BotCard entry={item} />
        )}
      </View>
    ),
    [mine, joining, join],
  );

  const header = (
    <View style={styles.controls}>
      <Text tone="muted">{t('discover.subtitle')}</Text>
      {tab === 'spaces' && anyRemote ? (
        <SegmentedControl<DiscoverScope>
          value={scope}
          onChange={setScope}
          size="sm"
          items={[
            { id: 'all', label: t('discover.scope.all') },
            { id: 'local', label: t('discover.scope.local') },
          ]}
        />
      ) : null}
      <SearchInput value={query} onValueChange={setQuery} placeholder={t('discover.search')} accessibilityLabel={t('discover.search')} />
      {error ? <Banner tone="error" message={error} onDismiss={() => setError('')} /> : null}
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <Header title={t('discover.title')} leadingIcon="fa-compass" onBack={goBack} />
      <View style={[styles.tabs, { backgroundColor: theme.colors.card, borderBottomColor: theme.colors.border }]}>
        <SegmentedControl<DiscoverTab>
          value={tab}
          onChange={setTab}
          items={[
            { id: 'spaces', label: t('discover.tabs.spaces'), icon: 'fa-compass' },
            { id: 'bots', label: t('discover.tabs.bots'), icon: 'fa-robot' },
          ]}
        />
      </View>
      {current.loading ? (
        <Spinner fill />
      ) : (
        <FlashList
          key={`cols-${columns}`}
          data={current.failed ? [] : visible}
          numColumns={columns}
          renderItem={renderItem}
          keyExtractor={(e) => (e.space ? `s:${e.space.origin_domain ?? ''}:${e.space.id}` : `b:${e.bot?.application_id ?? e.id}`)}
          getItemType={(e) => (e.space ? 'space' : 'bot')}
          extraData={`${joining}:${mine.size}`}
          ListHeaderComponent={header}
          ListEmptyComponent={
            current.failed ? (
              <EmptyState icon="fa-triangle-exclamation" title={t('discover.loadFailed')} action={<Button title={t('common.retry')} variant="outline" size="sm" onPress={onRefresh} />} />
            ) : (
              <EmptyState
                icon="fa-compass"
                title={query.trim() ? t('discover.noResults') : tab === 'spaces' ? t('discover.emptySpaces') : t('discover.emptyBots')}
              />
            )
          }
          contentContainerStyle={styles.listContent}
          // The search field lives in the list header: a tap on a card's button works with the
          // keyboard up, and scrolling puts the keyboard away.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.mutedForeground}
              colors={[theme.colors.primary]}
              progressBackgroundColor={theme.colors.card}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  tabs: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  controls: { gap: 12, paddingHorizontal: 8, paddingTop: 12, paddingBottom: 8 },
  listContent: { paddingHorizontal: 8, paddingBottom: 32 },
  cell: { padding: 8 },
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  banner: { height: 80 },
  cardBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 6 },
  cardIcon: { marginTop: -24, borderWidth: 3 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tag: { paddingHorizontal: 6, paddingVertical: 2 },
  cardButton: { marginTop: 6 },
  botCard: { padding: 16, gap: 10 },
  botHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
