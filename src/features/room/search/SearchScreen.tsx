/**
 * Message search (the web's MessageSearchBox + RoomSearchPanel; the web has no phone layout
 * for it) as a full-screen search: a field, filter chips - From, In (a space's rooms), Has,
 * Mentions - that open pickers instead of typed tokens, and the results as message cards.
 *
 * The search itself is lib/messageSearch, unchanged: a PM or group is searched on the server,
 * or - when the server can't (an end-to-end encrypted room) - in the history this device has
 * decrypted, paging older history to find more; a space channel searches the whole space,
 * notes how many encrypted rooms the server skipped, and adds the open room's local hits when
 * it is encrypted. Space results are grouped under their room. A stale response never
 * overwrites a newer one. Tap a hit: the conversation, scrolled to it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  isEmptyQuery,
  parseSearchQuery,
  searchRoomMessages,
  searchSpaceMessages,
  type SearchFilterKey,
  type SearchMatch,
} from '@web/lib/messageSearch';
import { spaces } from '@web/stores/spaces';
import { spaceMembers } from '@web/stores/spaceMembers';
import { getMessageBodyText } from '@web/components/messageList/utils';
import { t } from '@web/i18n/t';
import {
  ROOM_TYPE_TEXT,
  deepEqual,
  findSpaceRoom,
  isPlaceholderBody,
  roomParticipantPool,
  useDerived,
  useRoomInfo,
  viewerCanSeeRoom,
} from '@/data';
import { useTheme } from '@/theme';
import {
  Button,
  Icon,
  IconButton,
  SearchInput,
  Spinner,
  Text,
  Touchable,
  showActionSheet,
  withAlpha,
} from '@/ui';
import { MessageCard } from '../shared/MessageCard';
import { goBack, goToMessage } from '../navigation';
import { copyText } from '../util';
import { PeoplePicker, personLabel, type PickablePerson } from './PeoplePicker';
import { HAS_VALUES, buildSearchQuery, filterKeysFor, searchRows, type SearchFilters, type SearchRow } from './searchModel';
import { ReadableWidth } from '../shared/ReadableWidth';

function usePeople(roomId: string, spaceId: string | null): PickablePerson[] {
  return useDerived(
    `room:searchPeople:${roomId}:${spaceId ?? ''}`,
    () =>
      (spaceId ? (spaceMembers.bySpaceId[spaceId] ?? []) : roomParticipantPool(roomId)).map((p) => ({
        id: p.id,
        username: p.username,
        ...(p.display_name ? { display_name: p.display_name } : {}),
        ...(p.avatar ? { avatar: p.avatar } : {}),
        ...(p.bot ? { bot: true } : {}),
      })),
    deepEqual,
  );
}

function useChannels(spaceId: string | null): { id: string; name: string }[] {
  return useDerived(
    `room:searchChannels:${spaceId ?? ''}`,
    () =>
      spaceId
        ? (spaces.spaceRoomsBySpaceId[spaceId] ?? [])
            .filter((r) => r.type === ROOM_TYPE_TEXT && viewerCanSeeRoom(spaceId, r))
            .map((r) => ({ id: r.id, name: r.name }))
        : [],
    deepEqual,
  );
}

const FILTER_ICON: Record<SearchFilterKey, string> = { from: 'user', in: 'hashtag', has: 'paperclip', mentions: 'at' };

function Chip({ label, icon, active, onPress, onClear }: { label: string; icon: string; active: boolean; onPress: () => void; onClear?: () => void }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? withAlpha(c.primary, 0.5) : c.border,
        backgroundColor: active ? withAlpha(c.primary, 0.15) : withAlpha(c.muted, 0.4),
      }}
    >
      <Touchable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        feedback="opacity"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 12, paddingEnd: onClear ? 4 : 12, minHeight: 36 }}
      >
        <Icon name={icon} size={12} tone={active ? 'primary' : 'muted'} />
        <Text variant="label" tone={active ? 'primary' : 'default'} numberOfLines={1} style={{ maxWidth: 180 }}>
          {label}
        </Text>
      </Touchable>
      {onClear ? <IconButton icon="xmark" size="sm" tone="subtle" label={t('common.clear')} onPress={onClear} /> : null}
    </View>
  );
}

export function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ roomId: string; spaceId?: string }>();
  const roomId = String(params.roomId ?? '');
  const info = useRoomInfo(roomId, typeof params.spaceId === 'string' ? params.spaceId : null);
  const spaceId = (typeof params.spaceId === 'string' && params.spaceId) || info?.spaceId || null;
  const isSpace = !!spaceId && (info?.kind === 'text' || info?.kind === 'thread' || !info);
  const people = usePeople(roomId, isSpace ? spaceId : null);
  const channels = useChannels(isSpace ? spaceId : null);

  const [text, setText] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [request, setRequest] = useState<{ raw: string; n: number } | null>(null);
  const [picker, setPicker] = useState<'from' | 'mentions' | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [encryptedRooms, setEncryptedRooms] = useState(0);
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState(false);
  const nextBefore = useRef<string | undefined>(undefined);
  const requestId = useRef(0);

  const catalog = useMemo(() => ({ people, channels }), [people, channels]);

  async function run(raw: string, before?: string) {
    const query = parseSearchQuery(raw, catalog);
    if (!raw || isEmptyQuery(query)) {
      requestId.current++;
      setResults([]);
      setHasMore(false);
      setSearched(false);
      setFailed(false);
      setLoading(false);
      return;
    }
    const mine = ++requestId.current;
    setLoading(true);
    setFailed(false);
    try {
      const outcome =
        isSpace && spaceId
          ? await searchSpaceMessages(spaceId, query, before, info?.e2ee ? roomId : undefined)
          : await searchRoomMessages(roomId, query, before);
      if (mine !== requestId.current) return;
      setResults((prev) => (before ? [...prev, ...outcome.matches] : outcome.matches));
      setHasMore(outcome.hasMore);
      setLocalOnly(outcome.localOnly);
      setEncryptedRooms(outcome.encryptedRooms ?? 0);
      nextBefore.current = outcome.nextBefore;
      setSearched(true);
    } catch (e) {
      console.warn('[search] failed', e);
      if (mine === requestId.current) {
        setFailed(true);
        setSearched(true);
        if (!before) setResults([]);
      }
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (request) void run(request.raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const submit = (nextText = text, nextFilters = filters) => {
    setRequest((r) => ({ raw: buildSearchQuery(nextText, nextFilters), n: (r?.n ?? 0) + 1 }));
  };

  const setFilter = (key: SearchFilterKey, value: SearchFilters[SearchFilterKey] | undefined) => {
    const next = { ...filters };
    if (value) next[key] = value;
    else delete next[key];
    setFilters(next);
    submit(text, next);
  };

  const pickHas = () => {
    void showActionSheet(
      HAS_VALUES.map((v) => ({
        key: v,
        label: t(`mobile.room.has.${v}`),
        selected: filters.has?.value === v,
        onSelect: () => setFilter('has', { value: v, label: t(`mobile.room.has.${v}`) }),
      })),
      { title: t('room.search.filters.has.title') },
    );
  };

  const pickRoom = () => {
    void showActionSheet(
      channels.map((c) => ({
        key: c.id,
        label: `#${c.name}`,
        selected: filters.in?.value === c.id,
        onSelect: () => setFilter('in', { value: c.id, label: `#${c.name}` }),
      })),
      { title: t('room.search.filters.in.title') },
    );
  };

  const chipLabel = (key: SearchFilterKey) => filters[key]?.label ?? t(`room.search.sections.${key}`);

  const notes: { icon: string; text: string; tone?: 'muted' | 'danger' }[] = [];
  if (searched && localOnly) notes.push({ icon: 'lock', text: t('room.search.e2eeNote') });
  if (searched && encryptedRooms > 0) notes.push({ icon: 'lock', text: t('room.search.encryptedRooms', { count: encryptedRooms }) });
  if (failed) notes.push({ icon: 'circle-exclamation', text: t('room.search.failed'), tone: 'danger' });
  if (searched && !loading && !failed && results.length === 0) notes.push({ icon: 'magnifying-glass', text: t('room.search.none') });
  const rows = searched ? searchRows({ matches: results, grouped: isSpace, notes, hasMore }) : [];

  const openHit = (m: SearchMatch) =>
    goToMessage({ roomId: m.roomId || roomId, messageId: m.message.id, spaceId, originRoomId: roomId });

  const renderRow = ({ item }: { item: SearchRow }) => {
    switch (item.kind) {
      case 'note':
        return (
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              marginHorizontal: 12,
              marginVertical: 4,
              padding: 10,
              borderRadius: theme.radii.md,
              backgroundColor: withAlpha(theme.colors.muted, 0.3),
            }}
          >
            <Icon name={item.icon} size={11} tone={item.tone === 'danger' ? 'danger' : 'muted'} style={{ marginTop: 3 }} />
            <Text variant="caption" tone={item.tone} style={{ flex: 1 }}>
              {item.text}
            </Text>
          </View>
        );
      case 'room':
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
            <Icon name="hashtag" size={11} tone="muted" />
            <Text variant="label" numberOfLines={1} accessibilityRole="header">
              {findSpaceRoom(item.roomId, spaceId)?.room.name || t('space.defaultRoom')}
            </Text>
          </View>
        );
      case 'hit': {
        const m = item.match;
        return (
          <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            <MessageCard
              message={m.message}
              roomId={m.roomId || roomId}
              spaceId={spaceId}
              onPress={() => openHit(m)}
              onLongPress={() =>
                void showActionSheet([
                  { label: t('room.search.jump'), icon: 'arrow-right', onSelect: () => openHit(m) },
                  !isPlaceholderBody(m.message) && m.message.plaintext
                    ? { label: t('messages.actions.copyText'), icon: 'copy', onSelect: () => void copyText(getMessageBodyText(m.message)) }
                    : null,
                ])
              }
            />
          </View>
        );
      }
      case 'more':
        return (
          <View style={{ padding: 12 }}>
            <Button
              title={loading ? t('common.loading') : t('room.search.loadMore')}
              variant="outline"
              fullWidth
              disabled={loading}
              onPress={() => request && void run(request.raw, nextBefore.current)}
            />
          </View>
        );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          paddingTop: insets.top,
          backgroundColor: theme.colors.card,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingStart: 4, paddingEnd: 12, minHeight: 56 }}>
          <IconButton icon="arrow-left" label={t('common.back')} onPress={goBack} size="lg" />
          <SearchInput
            value={text}
            onValueChange={setText}
            onSubmit={(v) => submit(v)}
            placeholder={info ? t('mobile.room.searchIn', { name: info.name }) : t('room.search.placeholder')}
            autoFocus
            size="sm"
            containerStyle={{ flex: 1 }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingBottom: 10 }} keyboardShouldPersistTaps="handled">
          {filterKeysFor(isSpace).map((key) => (
            <Chip
              key={key}
              icon={FILTER_ICON[key]}
              label={chipLabel(key)}
              active={!!filters[key]}
              onPress={() => (key === 'has' ? pickHas() : key === 'in' ? pickRoom() : setPicker(key))}
              onClear={filters[key] ? () => setFilter(key, undefined) : undefined}
            />
          ))}
        </ScrollView>
      </View>

      {searched ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="overline" style={{ flex: 1 }}>
            {hasMore ? t('room.search.resultsMore', { count: results.length }) : t('room.search.results', { count: results.length })}
          </Text>
          {loading ? <Spinner size="small" decorative /> : null}
        </View>
      ) : null}

      {!searched ? (
        loading ? (
          <Spinner fill label={t('common.loading')} />
        ) : (
          <View style={{ padding: 24, gap: 8 }}>
            <Text tone="muted">{t('room.search.hint')}</Text>
            <Text variant="caption">{t('room.search.operatorHint')}</Text>
          </View>
        )
      ) : (
        <ReadableWidth>
          <FlashList
            data={rows}
            keyExtractor={(r) => r.key}
            getItemType={(r) => r.kind}
            extraData={loading}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
            renderItem={renderRow}
          />
        </ReadableWidth>
      )}

      <PeoplePicker
        open={picker !== null}
        title={picker === 'mentions' ? t('room.search.filters.mentions.title') : t('room.search.filters.from.title')}
        people={people}
        selectedId={picker ? filters[picker]?.value : undefined}
        onClose={() => setPicker(null)}
        onPick={(p) => {
          const key = picker;
          setPicker(null);
          if (key) setFilter(key, { value: p.id, label: `${key === 'mentions' ? '@' : ''}${personLabel(p)}` });
        }}
      />
    </View>
  );
}
