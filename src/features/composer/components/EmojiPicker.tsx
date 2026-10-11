/**
 * The emoji picker: search, the skin-tone swatch, a category rail (Frequently used, each
 * space's custom emoji, the Unicode groups) and one virtualised grid that scrolls through
 * every section with sticky titles - the rail jumps to a section and follows the scroll.
 * Long-press an emoji to see its name (there is no hover); tap to pick.
 *
 * Behaviour is the web EmojiPicker's: the same recent list (key, format, cap), the same
 * search (custom names first, max 24, then Unicode, max 96), the skin tone saved to
 * appearance.emojiSkinTone, custom emoji limited to one space when the viewer lacks Use
 * External Emojis. Used by the composer's expression sheet; reusable for reactions through
 * <EmojiPickerSheet>.
 */
import { memo, useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { useBottomSheetScrollableCreator } from '@gorhom/bottom-sheet';
import { SKIN_TONES } from '@web/lib/emoji/data';
import { setEmojiSkinTone } from '@web/stores/appearance';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Avatar, Icon, SearchInput, Text, Touchable, haptics, showActionSheet, useReduceMotion, withAlpha } from '@/ui';
import { useEmojiPrefs } from '@/data/settings';
import { useEmojiCatalog } from '../hooks/useEmojiCatalog';
import { useSpaceEmojiData } from '../hooks/useSpaceEmojiSets';
import { loadRecentEmoji, pushRecentEmoji } from '../logic/emojiRecent';
import {
  buildEmojiSections,
  headerIndex,
  recentKeyOf,
  searchEmojiCells,
  toGridRows,
  type CategoryId,
  type EmojiCell,
  type GridRow,
  type PickerCustomEmoji,
} from '../logic/emojiGrid';
import { EmojiGlyph } from './EmojiGlyph';

export type EmojiPick = { unicode: string; custom?: undefined } | { unicode?: undefined; custom: PickerCustomEmoji };

export interface EmojiPickerProps {
  onPick: (pick: EmojiPick) => void;
  /** Offer only this space's custom emoji (no Use External Emojis in the room). */
  customEmojiSpaceId?: string;
  /** Inside a bottom sheet: scrolling hands off to the sheet's drag at the top. */
  inSheet?: boolean;
  testID?: string;
}

/** Touch target per emoji; the glyph inside is 32. */
const CELL = 44;
const GLYPH = 32;
const GRID_PAD = 8;

export function EmojiPicker(props: EmojiPickerProps) {
  return props.inSheet ? <SheetEmojiPicker {...props} /> : <EmojiPickerBody {...props} />;
}

function SheetEmojiPicker(props: EmojiPickerProps) {
  const scrollable = useBottomSheetScrollableCreator();
  return <EmojiPickerBody {...props} renderScrollComponent={scrollable} />;
}

function EmojiPickerBody({
  onPick,
  customEmojiSpaceId,
  renderScrollComponent,
  testID,
}: EmojiPickerProps & { renderScrollComponent?: (props: never) => ReactElement }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const catalog = useEmojiCatalog();
  const { skinTone } = useEmojiPrefs();
  const spaceData = useSpaceEmojiData();
  const [recent, setRecent] = useState<string[]>(loadRecentEmoji);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<EmojiCell | null>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<CategoryId | null>(null);
  const listRef = useRef<FlashListRef<GridRow>>(null);

  const columns = Math.max(5, Math.floor((width - GRID_PAD * 2) / CELL));

  const sections = useMemo(
    () =>
      buildEmojiSections({
        catalog,
        recent,
        spaces: spaceData.sets,
        ...(customEmojiSpaceId !== undefined ? { onlySpaceId: customEmojiSpaceId } : {}),
        customById: (id) => spaceData.byId[id],
        tone: skinTone,
      }),
    [catalog, recent, spaceData, customEmojiSpaceId, skinTone],
  );

  const searching = query.trim().length > 0;
  const rows = useMemo((): GridRow[] => {
    if (searching) {
      const cells = searchEmojiCells(query, {
        catalog,
        spaces: spaceData.sets,
        ...(customEmojiSpaceId !== undefined ? { onlySpaceId: customEmojiSpaceId } : {}),
        tone: skinTone,
      });
      if (cells.length === 0) return [{ kind: 'status', key: 'none', text: t('emoji.picker.none') }];
      return toGridRows([{ id: 'recent', title: t('emoji.picker.searchResults'), cells }], columns);
    }
    const grid = toGridRows(sections, columns);
    if (!catalog) grid.push({ kind: 'status', key: 'loading', text: t('emoji.picker.loading') });
    return grid;
  }, [searching, query, catalog, spaceData, customEmojiSpaceId, skinTone, sections, columns]);

  const stickyHeaders = useMemo(
    () => (searching ? [] : rows.flatMap((r, i) => (r.kind === 'header' ? [i] : []))),
    [rows, searching],
  );

  const pick = useCallback(
    (cell: EmojiCell) => {
      const key = recentKeyOf(cell);
      if (key) setRecent(pushRecentEmoji(key));
      haptics.selection();
      if (cell.custom) onPick({ custom: cell.custom });
      else if (cell.unicode) onPick({ unicode: cell.unicode });
    },
    [onPick],
  );

  const showPreview = useCallback((cell: EmojiCell) => {
    haptics.longPress();
    setPreview(cell);
  }, []);

  const jumpTo = (id: CategoryId) => {
    setQuery('');
    setActive(id);
    const index = headerIndex(toGridRows(sections, columns), id);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: !reduceMotion });
  };

  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: GridRow | undefined }[] }) => {
    const first = viewableItems.find((v) => v.item && v.item.kind !== 'status')?.item;
    if (first && first.kind !== 'status') setActive(first.sectionId);
  }).current;

  const chooseTone = () => {
    void showActionSheet(
      SKIN_TONES.map((st) => ({
        key: `tone-${st.tone}`,
        label: t(`emoji.skinTones.${st.tone}`),
        selected: st.tone === skinTone,
        leading: <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: st.swatch }} />,
        onSelect: () => setEmojiSkinTone(st.tone),
      })),
      { title: t('emoji.picker.chooseSkinTone') },
    );
  };

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<GridRow>) => {
      if (item.kind === 'header') {
        return (
          <View style={{ backgroundColor: theme.colors.card, paddingHorizontal: GRID_PAD + 4, paddingTop: 10, paddingBottom: 6 }}>
            <Text variant="overline" numberOfLines={1} accessibilityRole="header">
              {item.title}
            </Text>
          </View>
        );
      }
      if (item.kind === 'status') {
        return (
          <Text variant="caption" style={{ paddingHorizontal: GRID_PAD + 4, paddingVertical: 16 }}>
            {item.text}
          </Text>
        );
      }
      return (
        <View style={{ flexDirection: 'row', paddingHorizontal: GRID_PAD }}>
          {item.cells.map((cell) => (
            <EmojiCellButton key={cell.key} cell={cell} onPick={pick} onPreview={showPreview} />
          ))}
        </View>
      );
    },
    [theme.colors.card, pick, showPreview],
  );

  const activeId = searching ? null : (active ?? sections[0]?.id ?? null);
  const swatch = SKIN_TONES[skinTone]?.swatch ?? SKIN_TONES[0]!.swatch;
  const previewSpace = preview?.custom ? spaceData.sets.find((s) => s.spaceId === preview.custom!.space_id)?.name : undefined;

  return (
    <View style={{ flex: 1 }} testID={testID} accessibilityLabel={t('emoji.picker.title')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
        <SearchInput
          size="sm"
          value={query}
          onValueChange={setQuery}
          placeholder={t('emoji.picker.search')}
          containerStyle={{ flex: 1 }}
          testID="emoji-search"
        />
        <Touchable
          feedback="opacity"
          onPress={chooseTone}
          accessibilityLabel={t('emoji.picker.chooseSkinTone')}
          accessibilityValue={{ text: t(`emoji.skinTones.${skinTone}`) }}
          hitSlop={8}
          style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: swatch, borderWidth: 2, borderColor: withAlpha(theme.colors.border, 0.9) }}
        />
      </View>

      {/* Category rail. */}
      <View
        accessibilityRole="tablist"
        accessibilityLabel={t('emoji.picker.categories')}
        style={{ flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
      >
        <RailScroller>
          {sections.map((s) => {
            const selected = s.id === activeId;
            return (
              <Touchable
                key={s.id}
                accessibilityRole="tab"
                accessibilityLabel={s.title}
                accessibilityState={{ selected }}
                onPress={() => jumpTo(s.id)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radii.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? withAlpha(theme.colors.primary, 0.18) : 'transparent',
                }}
              >
                {s.icon ? (
                  <Icon name={s.icon} size={17} color={selected ? theme.colors.primary : theme.colors.mutedForeground} />
                ) : (
                  <Avatar uri={s.spaceIcon ?? null} name={s.acronym ?? s.title} size={26} shape="rounded" />
                )}
              </Touchable>
            );
          })}
        </RailScroller>
      </View>

      <View style={{ flex: 1 }} testID="emoji-grid" onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <FlashList
            ref={listRef}
            data={rows}
            renderItem={renderItem}
            keyExtractor={(r) => r.key}
            getItemType={(r) => r.kind}
            stickyHeaderIndices={stickyHeaders}
            onViewableItemsChanged={onViewable}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            extraData={columns}
            {...(renderScrollComponent ? { renderScrollComponent: renderScrollComponent as never } : {})}
          />
        ) : null}
      </View>

      {/* What a long-press is showing (the web's hover footer). */}
      <View
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: theme.colors.border }}
      >
        {preview ? (
          <>
            <EmojiGlyph unicode={preview.unicode} customUrl={preview.custom?.url} size={26} />
            <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
              {preview.label}
            </Text>
            {preview.custom ? (
              <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                {previewSpace || t('composer.customEmoji')}
              </Text>
            ) : null}
          </>
        ) : (
          <Text variant="caption">{t('mobile.composer.emojiHint')}</Text>
        )}
      </View>
    </View>
  );
}

/** The rail scrolls sideways when a person is in many spaces with emoji. */
function RailScroller({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

const EmojiCellButton = memo(function EmojiCellButton({
  cell,
  onPick,
  onPreview,
}: {
  cell: EmojiCell;
  onPick: (cell: EmojiCell) => void;
  onPreview: (cell: EmojiCell) => void;
}) {
  const theme = useTheme();
  return (
    <Touchable
      onPress={() => onPick(cell)}
      onLongPress={() => onPreview(cell)}
      delayLongPress={350}
      accessibilityLabel={cell.label}
      testID={`emoji-${cell.key}`}
      style={{ width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radii.md }}
    >
      <EmojiGlyph unicode={cell.unicode} customUrl={cell.custom?.url} size={GLYPH} />
    </Touchable>
  );
});
