/**
 * The GIF picker: search ("Search GIPHY"), the GIPHY / Heypster switch (saved to
 * appearance.gifProvider), trending or results in a two-column masonry grid that keeps each
 * GIF's shape, paging as you scroll, and the provider's required attribution. Picking calls
 * onPick; the composer sends the GIF's URL as a message (the web's behaviour).
 *
 * With reduced motion on, the grid shows still frames.
 */
import { memo, useCallback, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useBottomSheetScrollableCreator } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { GIF_PROVIDERS, gifProviderInfo, type GifProviderId, type GifResult } from '@web/lib/gif/providers';
import { setGifProvider } from '@web/stores/appearance';
import { requestOpenExternalLink } from '@web/stores/externalLink';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Button, EmptyState, SearchInput, SegmentedControl, Spinner, Text, Touchable, useReduceMotion, withAlpha } from '@/ui';
import { useEmojiPrefs } from '@/data/settings';
import { useGifFeed } from '../hooks/useGifFeed';

export interface GifPickerProps {
  onPick: (gif: GifResult) => void;
  inSheet?: boolean;
  testID?: string;
}

export function GifPicker(props: GifPickerProps) {
  return props.inSheet ? <SheetGifPicker {...props} /> : <GifPickerBody {...props} />;
}

function SheetGifPicker(props: GifPickerProps) {
  const scrollable = useBottomSheetScrollableCreator();
  return <GifPickerBody {...props} renderScrollComponent={scrollable} />;
}

function GifPickerBody({
  onPick,
  renderScrollComponent,
  testID,
}: GifPickerProps & { renderScrollComponent?: (props: never) => ReactElement }) {
  const theme = useTheme();
  const { gifProvider } = useEmojiPrefs();
  const provider = gifProvider as GifProviderId;
  const info = gifProviderInfo(provider);
  const [query, setQuery] = useState('');
  const feed = useGifFeed(provider, query);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<GifResult>) => <GifTile gif={item} onPick={onPick} />,
    [onPick],
  );

  let body: ReactElement;
  if (feed.state === 'config') {
    body = (
      <EmptyState
        icon="film"
        title={t('gif.notConfiguredTitle', { provider: info.name })}
        body={t('gif.notConfiguredBody')}
      />
    );
  } else if (feed.state === 'error') {
    body = (
      <EmptyState
        icon="triangle-exclamation"
        body={t('gif.error')}
        action={<Button title={t('common.retry')} variant="secondary" size="sm" onPress={feed.retry} />}
      />
    );
  } else if (!feed.loading && feed.items.length === 0) {
    body = <EmptyState icon="film" body={t('gif.none')} />;
  } else {
    body = (
      <FlashList
        data={feed.items}
        masonry
        numColumns={2}
        renderItem={renderItem}
        keyExtractor={(g) => g.id}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 6, paddingTop: 6 }}
        ListFooterComponent={feed.loading ? <Spinner decorative style={{ paddingVertical: 12 }} /> : null}
        {...(renderScrollComponent ? { renderScrollComponent: renderScrollComponent as never } : {})}
      />
    );
  }

  return (
    <View style={{ flex: 1 }} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
        <SearchInput
          size="sm"
          value={query}
          onValueChange={setQuery}
          placeholder={t('gif.search', { provider: info.name })}
          containerStyle={{ flex: 1 }}
          testID="gif-search"
        />
        <SegmentedControl<GifProviderId>
          size="sm"
          value={provider}
          onChange={(id) => setGifProvider(id)}
          items={GIF_PROVIDERS.map((p) => ({ id: p.id, label: p.name }))}
          accessibilityLabel={t('gif.provider')}
          style={{ width: 172 }}
        />
      </View>
      <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: theme.colors.border }}>{body}</View>
      <Touchable
        feedback="opacity"
        accessibilityRole="link"
        accessibilityLabel={info.attribution}
        onPress={() => requestOpenExternalLink(info.homepage)}
        style={{ minHeight: 32, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: theme.colors.border }}
      >
        <Text variant="overline" style={{ fontSize: theme.font(10) }}>
          {info.attribution}
        </Text>
      </Touchable>
    </View>
  );
}

const GifTile = memo(function GifTile({ gif, onPick }: { gif: GifResult; onPick: (gif: GifResult) => void }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const ratio = gif.previewWidth > 0 && gif.previewHeight > 0 ? gif.previewWidth / gif.previewHeight : 1;
  const uri = reduceMotion && gif.stillUrl ? gif.stillUrl : gif.previewUrl;
  return (
    <Touchable
      feedback="opacity"
      onPress={() => onPick(gif)}
      accessibilityLabel={gif.title || t('gif.item')}
      style={{ margin: 3, borderRadius: theme.radii.md, overflow: 'hidden', backgroundColor: withAlpha(theme.colors.muted, 0.6), aspectRatio: ratio }}
    >
      <Image
        source={{ uri }}
        placeholder={gif.stillUrl && uri !== gif.stillUrl ? { uri: gif.stillUrl } : undefined}
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
        recyclingKey={gif.id}
        autoplay={!reduceMotion}
        accessible={false}
      />
    </Touchable>
  );
});
