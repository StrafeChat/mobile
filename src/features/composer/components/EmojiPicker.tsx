/**
 * The emoji picker: search, the skin-tone swatch, a category bar (Frequently used, each
 * space's custom emoji - the conversation's own space first - then the Unicode groups) and one
 * virtualised grid that scrolls through every section with sticky titles; the bar jumps to a
 * section and follows the scroll. Long-press an emoji to see its name (there is no hover);
 * tap to pick.
 *
 * Two layouts of the same grid:
 * - 'sheet' (adding a reaction, <EmojiPickerSheet>): the bar along the top, the long-pressed
 *   emoji's name in a footer;
 * - 'panel' (the composer's expression panel, in the keyboard's place): Discord's layout - the
 *   bar along the bottom with a backspace key at its end, the name in a bubble over the grid.
 *
 * Behaviour is the web EmojiPicker's: the same recent list (key, format, cap), the same
 * search (custom names first, max 24, then Unicode, max 96), the skin tone saved to
 * appearance.emojiSkinTone, custom emoji limited to one space when the viewer lacks Use
 * External Emojis (other spaces' emoji are left out, as on the web).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { I18nManager, View, type LayoutChangeEvent } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { useBottomSheetScrollableCreator } from '@gorhom/bottom-sheet';
import { SKIN_TONES } from '@web/lib/emoji/data';
import { setEmojiSkinTone } from '@web/stores/appearance';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Avatar, Icon, SearchInput, Text, Touchable, haptics, showActionSheet, useReduceMotion, withAlpha } from '@/ui';
import { HorizontalGestureOwner } from '@/shell/SwipeShell';
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
  type EmojiSection,
  type GridRow,
  type PickerCustomEmoji,
} from '../logic/emojiGrid';
import { EmojiGlyph } from './EmojiGlyph';
import { safeScrollToIndex } from '@/features/chat/list/safeList';

export type EmojiPick = { unicode: string; custom?: undefined } | { unicode?: undefined; custom: PickerCustomEmoji };

export interface EmojiPickerProps {
  onPick: (pick: EmojiPick) => void;
  /** Offer only this space's custom emoji (no Use External Emojis in the room). */
  customEmojiSpaceId?: string;
  /** The conversation's space: its custom emoji are listed first. */
  currentSpaceId?: string | null;
  /** Inside a bottom sheet: scrolling hands off to the sheet's drag at the top. */
  inSheet?: boolean;
  /** 'panel': the composer's expression panel layout (bar at the bottom, backspace key). */
  variant?: 'sheet' | 'panel';
  /** The panel's backspace key (deletes before the composer's caret). */
  onBackspace?: () => void;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  testID?: string;
}

/** Touch target per emoji; the glyph inside is 32. Rows are this tall, always. */
const CELL = 44;
const GLYPH = 32;
const GRID_PAD = 8;
/** How long the panel's long-press bubble stays. */
const PREVIEW_MS = 2200;

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
  currentSpaceId,
  variant = 'sheet',
  onBackspace,
  onSearchFocus,
  onSearchBlur,
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
  const panel = variant === 'panel';

  const columns = Math.max(5, Math.floor((width - GRID_PAD * 2) / CELL));

  const sections = useMemo(
    () =>
      buildEmojiSections({
        catalog,
        recent,
        spaces: spaceData.sets,
        ...(customEmojiSpaceId !== undefined ? { onlySpaceId: customEmojiSpaceId } : {}),
        currentSpaceId: currentSpaceId ?? null,
        customById: (id) => spaceData.byId[id],
        tone: skinTone,
      }),
    [catalog, recent, spaceData, customEmojiSpaceId, currentSpaceId, skinTone],
  );

  const searching = query.trim().length > 0;
  const browseRows = useMemo(() => toGridRows(sections, columns), [sections, columns]);
  const rows = useMemo((): GridRow[] => {
    if (searching) {
      const cells = searchEmojiCells(query, {
        catalog,
        spaces: spaceData.sets,
        ...(customEmojiSpaceId !== undefined ? { onlySpaceId: customEmojiSpaceId } : {}),
        currentSpaceId: currentSpaceId ?? null,
        tone: skinTone,
      });
      if (cells.length === 0) return [{ kind: 'status', key: 'none', text: t('emoji.picker.none') }];
      return toGridRows([{ id: 'recent', title: t('emoji.picker.searchResults'), cells }], columns);
    }
    if (!catalog) return [...browseRows, { kind: 'status', key: 'loading', text: t('emoji.picker.loading') }];
    return browseRows;
  }, [searching, query, catalog, spaceData, customEmojiSpaceId, currentSpaceId, skinTone, browseRows, columns]);

  const stickyHeaders = useMemo(
    () => (searching ? [] : rows.flatMap((r, i) => (r.kind === 'header' ? [i] : []))),
    [rows, searching],
  );

  const pick = useCallback(
    (cell: EmojiCell) => {
      const key = recentKeyOf(cell);
      // The panel stays open for more picks; reshuffling "Frequently used" under the finger
      // would move the next target, so the panel only records it (shown next time it opens).
      if (key) {
        const next = pushRecentEmoji(key);
        if (!panel) setRecent(next);
      }
      haptics.selection();
      if (cell.custom) onPick({ custom: cell.custom });
      else if (cell.unicode) onPick({ unicode: cell.unicode });
    },
    [onPick, panel],
  );

  const showPreview = useCallback((cell: EmojiCell) => {
    haptics.longPress();
    setPreview(cell);
  }, []);

  // The panel's bubble goes by itself; the sheet's footer keeps the last one.
  useEffect(() => {
    if (!panel || !preview) return undefined;
    const timer = setTimeout(() => setPreview(null), PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [panel, preview]);

  // A jump holds the bar on the chosen section until the person scrolls: on the way there, and
  // once there, the row above (half under the sticky title) still counts as visible.
  const jumping = useRef(false);
  const jumpTo = (id: CategoryId) => {
    setQuery('');
    setActive(id);
    const index = headerIndex(browseRows, id);
    if (index < 0) return;
    jumping.current = true;
    // After the next frame: clearing a search swaps the grid's data in this same update, and
    // FlashList can't scroll to (or must not be asked about) a row it has not laid out yet.
    const searchingNow = searching;
    requestAnimationFrame(() => {
      void safeScrollToIndex(listRef.current, { index, animated: !reduceMotion && !searchingNow }, browseRows.length);
    });
  };

  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: GridRow | undefined }[] }) => {
    if (jumping.current) return;
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

  const headerBg = panel ? theme.colors.background : theme.colors.card;
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<GridRow>) => {
      if (item.kind === 'header') {
        return (
          <View style={{ backgroundColor: headerBg, paddingHorizontal: GRID_PAD + 4, paddingTop: 10, paddingBottom: 6 }}>
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
        <View style={{ flexDirection: 'row', height: CELL, paddingHorizontal: GRID_PAD }}>
          {item.cells.map((cell) => (
            <EmojiCellButton key={cell.key} cell={cell} onPick={pick} onPreview={showPreview} />
          ))}
        </View>
      );
    },
    [headerBg, pick, showPreview],
  );

  const activeId = searching ? null : (active ?? sections[0]?.id ?? null);
  const swatch = SKIN_TONES[skinTone]?.swatch ?? SKIN_TONES[0]!.swatch;
  const previewSpace = preview?.custom ? spaceData.sets.find((s) => s.spaceId === preview.custom!.space_id)?.name : undefined;

  const searchRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
      <SearchInput
        size="sm"
        value={query}
        onValueChange={setQuery}
        placeholder={panel ? t('mobile.composer.findEmoji') : t('emoji.picker.search')}
        containerStyle={{ flex: 1 }}
        onFocus={onSearchFocus}
        onBlur={onSearchBlur}
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
  );

  const bar = <CategoryBar sections={sections} activeId={activeId} onJump={jumpTo} />;

  const grid = (
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
          onScrollBeginDrag={() => {
            jumping.current = false;
          }}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode={panel ? 'none' : 'on-drag'}
          extraData={columns}
          {...(renderScrollComponent ? { renderScrollComponent: renderScrollComponent as never } : {})}
        />
      ) : null}
      {panel && preview ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            bottom: 8,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            maxWidth: '90%',
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: theme.radii.lg,
            backgroundColor: theme.colors.popover,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <PreviewContent preview={preview} spaceName={previewSpace} />
        </View>
      ) : null}
    </View>
  );

  if (panel) {
    return (
      <View style={{ flex: 1 }} testID={testID} accessibilityLabel={t('emoji.picker.title')}>
        {searchRow}
        {grid}
        <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: theme.colors.border, paddingStart: 4 }}>
          <View style={{ flex: 1 }}>{bar}</View>
          {onBackspace ? <BackspaceKey onPress={onBackspace} /> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} testID={testID} accessibilityLabel={t('emoji.picker.title')}>
      {searchRow}
      <View style={{ paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>{bar}</View>
      {grid}
      {/* What a long-press is showing (the web's hover footer). */}
      <View
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: theme.colors.border }}
      >
        {preview ? <PreviewContent preview={preview} spaceName={previewSpace} /> : <Text variant="caption">{t('mobile.composer.emojiHint')}</Text>}
      </View>
    </View>
  );
}

function PreviewContent({ preview, spaceName }: { preview: EmojiCell; spaceName: string | undefined }) {
  return (
    <>
      <EmojiGlyph unicode={preview.unicode} customUrl={preview.custom?.url} size={26} />
      <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
        {preview.label}
      </Text>
      {preview.custom ? (
        <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
          {spaceName || t('composer.customEmoji')}
        </Text>
      ) : null}
    </>
  );
}

/**
 * The category bar: one button per section (a clock, the spaces' icons, the Unicode groups'
 * glyphs). It scrolls sideways for people in many spaces with emoji, and owns that drag so it
 * doesn't swipe the shell.
 */
function CategoryBar({
  sections,
  activeId,
  onJump,
}: {
  sections: readonly EmojiSection[];
  activeId: CategoryId | null;
  onJump: (id: CategoryId) => void;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={t('emoji.picker.categories')}>
      <HorizontalGestureOwner>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 2, paddingVertical: 4 }}
          keyboardShouldPersistTaps="always"
        >
          {sections.map((s) => {
            const selected = s.id === activeId;
            return (
              <Touchable
                key={s.id}
                accessibilityRole="tab"
                accessibilityLabel={s.title}
                accessibilityState={{ selected }}
                onPress={() => onJump(s.id)}
                testID={`emoji-category-${s.id}`}
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
        </ScrollView>
      </HorizontalGestureOwner>
    </View>
  );
}

/** The keyboard's backspace, at the end of the panel's bar (it points the other way in RTL). */
function BackspaceKey({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Touchable
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      accessibilityLabel={t('mobile.composer.backspace')}
      testID="emoji-backspace"
      style={{
        width: 52,
        height: 40,
        marginHorizontal: 6,
        borderRadius: theme.radii.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: withAlpha(theme.colors.muted, 0.7),
      }}
    >
      <Icon name={I18nManager.isRTL ? 'delete-right' : 'delete-left'} size={17} tone="muted" />
    </Touchable>
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
