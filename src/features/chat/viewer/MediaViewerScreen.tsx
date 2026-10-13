/**
 * The full-screen media viewer (the web's MediaViewer), driven by the web's stores/mediaViewer:
 * the items one surface opened (a message's images, a preview image, an image link) and the
 * current index.
 *
 * - swipe sideways between images (wrapping arrows on the web; a pager here), neighbours
 *   prefetched;
 * - pinch, double-tap or the bar's buttons to zoom (1, 1.5, 2, 3, 4 steps, % readout), reset
 *   per image; drag down to close; tap to hide or show the chrome;
 * - the bar: close, filename, "n / total", zoom, save to Photos, share (the web's download);
 * - a filmstrip of thumbnails when there is more than one; 'size · W×H' when known;
 * - a per-image failure notice (zoom hidden).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlatList, ScrollView } from 'react-native-gesture-handler';
import { t } from '@web/i18n/t';
import { closeMediaViewer, goToMedia, mediaViewer, type MediaViewerItem } from '@web/stores/mediaViewer';
import { formatFileSize } from '@web/lib/attachments/format';
import type { AttachmentView } from '@web/lib/attachments/types';
import { useSolid } from '@/bridge/solid';
import { saveAttachmentToDevice, shareAttachment } from '@/platform/media';
import { roomOnScreen } from '@/shell/state';
import { ScreenRoomClaim } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { IconButton, onScrim, physicalSides, Text, Touchable, withAlpha } from '@/ui';
import { reportExport } from '../attachments/Attachments';
import { setMediaScreenMounted } from '../mediaViewer';
import { ZoomableImage, type ZoomRequest } from './ZoomableImage';
import { stepZoom } from './zoom';

function guessType(item: MediaViewerItem): string {
  if (item.contentType) return item.contentType;
  const ext = item.filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/** A short stable hash of a URL (FNV-1a), so two images never share an id. */
function urlHash(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** A viewer item as an attachment for the platform's save/share (a local file is its own preview). */
export function viewerItemAsAttachment(item: MediaViewerItem): AttachmentView {
  const local = /^(file|content):/i.test(item.url);
  return {
    // Keyed by the whole URL: CDN paths of one length ending in the same "image.png" collided.
    id: `viewer-${urlHash(item.url)}-${item.url.length}`,
    url: item.url,
    filename: item.filename || 'image',
    contentType: guessType(item),
    size: item.size ?? 0,
    ...(item.width ? { width: item.width } : {}),
    ...(item.height ? { height: item.height } : {}),
    ...(local ? { previewUrl: item.url } : {}),
  };
}

export function MediaViewerScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // This route is the one screen the main stack does not pad left and right (its pages are the
  // window's width), so the chrome keeps itself clear of the cutout and a side navigation bar
  // in landscape. Its backgrounds still run to the edges.
  const sides = physicalSides(insets);
  const { width, height } = useWindowDimensions();
  const state = useSolid(() => ({ open: mediaViewer.open, items: mediaViewer.items, index: mediaViewer.index, label: mediaViewer.sourceLabel }));
  const items = state.items;
  const index = Math.min(state.index, Math.max(0, items.length - 1));
  const current = items[index];
  const many = items.length > 1;
  const [chrome, setChrome] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [zoomRequest, setZoomRequest] = useState<ZoomRequest | null>(null);
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set());
  const dismissY = useSharedValue(0);
  const pager = useRef<FlatList<MediaViewerItem>>(null);
  const closing = useRef(false);
  const fg = onScrim(theme);
  // The conversation this was opened over stays the one on screen while the viewer is up
  // (shell/state.ts roomOnScreen): on the web the viewer is an overlay on the room. Read in the
  // first render, because the screen beneath only reacts to being covered in its effects after
  // it - from then on it would say none.
  const [overRoom] = useState(roomOnScreen);

  // Register / clear: the store is closed when the screen goes, however it goes.
  useEffect(() => {
    setMediaScreenMounted(true);
    return () => {
      setMediaScreenMounted(false);
      if (mediaViewer.open) closeMediaViewer();
    };
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    closeMediaViewer();
    if (router.canGoBack()) router.back();
  }, []);

  // Closed from elsewhere (sign-out, another surface): leave.
  useEffect(() => {
    if (!state.open && !closing.current) {
      closing.current = true;
      if (router.canGoBack()) router.back();
    }
  }, [state.open]);

  // Neighbours load before you swipe to them.
  useEffect(() => {
    if (items.length < 2) return;
    const urls = [-1, 1].map((d) => items[(index + d + items.length) % items.length]?.url).filter((u): u is string => !!u);
    void Image.prefetch(urls).catch(() => undefined);
  }, [index, items]);

  // Zoom resets per image.
  useEffect(() => {
    setZoom(1);
  }, [index]);

  // Index moved from the filmstrip: follow with the pager.
  const pagerIndex = useRef(index);
  useEffect(() => {
    if (pagerIndex.current === index || index >= items.length) return;
    pagerIndex.current = index;
    pager.current?.scrollToIndex({ index, animated: !theme.reduceMotion });
  }, [index, items.length, theme.reduceMotion]);

  // Rotation (or a fold) changes the page width: keep the same image in view.
  const lastWidth = useRef(width);
  useEffect(() => {
    if (lastWidth.current === width) return;
    lastWidth.current = width;
    if (index < items.length) pager.current?.scrollToIndex({ index, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const onPageEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== pagerIndex.current && i >= 0 && i < items.length) {
      pagerIndex.current = i;
      goToMedia(i);
    }
  };

  const requestZoom = (dir: 1 | -1) => {
    const next = stepZoom(zoom, dir);
    setZoomRequest((r) => ({ scale: next, nonce: (r?.nonce ?? 0) + 1 }));
  };

  const save = () => current && void saveAttachmentToDevice(viewerItemAsAttachment(current)).then(reportExport);
  const share = () => current && void shareAttachment(viewerItemAsAttachment(current)).then(reportExport);

  const backdrop = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(dismissY.value), [0, 300], [1, 0.25], 'clamp') }));
  const failed = !!current && failedUrls.has(current.url);
  const facts = useMemo(() => {
    if (!current) return '';
    const parts: string[] = [];
    if (current.size) parts.push(formatFileSize(current.size));
    if ((current.width ?? 0) > 0 && (current.height ?? 0) > 0) parts.push(`${current.width}×${current.height}`);
    return parts.join(' · ');
  }, [current]);

  return (
    <View style={styles.root} accessibilityViewIsModal accessibilityLabel={t('attachments.viewer.label')}>
      {overRoom ? <ScreenRoomClaim roomId={overRoom.roomId} spaceId={overRoom.spaceId} /> : null}
      <StatusBar style="light" hidden={!chrome} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.black, backdrop]} />
      <FlatList
        ref={pager}
        data={items}
        horizontal
        pagingEnabled
        scrollEnabled={zoom <= 1.01 && many}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(it, i) => `${i}:${it.url}`}
        onMomentumScrollEnd={onPageEnd}
        windowSize={3}
        renderItem={({ item, index: i }) => (
          <ZoomableImage
            uri={item.url}
            label={item.filename}
            width={width}
            height={height}
            active={i === index}
            reduceMotion={theme.reduceMotion}
            mutedColor={withAlpha(fg, 0.6)}
            dismissY={dismissY}
            zoomRequest={i === index ? zoomRequest : null}
            onZoomChange={setZoom}
            onDismiss={close}
            onFailed={() => setFailedUrls((prev) => new Set(prev).add(item.url))}
            onToggleChrome={() => setChrome((c) => !c)}
          />
        )}
      />

      {chrome ? (
        <View
          testID="media-viewer-bar"
          style={[styles.bar, { paddingTop: insets.top + 6, paddingLeft: BAR_PAD + sides.left, paddingRight: BAR_PAD + sides.right }]}
        >
          <IconButton icon="xmark" label={t('common.close')} tone="overlay" onPress={close} />
          <View style={styles.title}>
            <Text variant="label" color={fg} numberOfLines={1}>
              {current?.filename ?? ''}
            </Text>
            {many ? (
              <Text variant="caption" color={withAlpha(fg, 0.6)} style={styles.tabular}>
                {t('attachments.viewer.position', { current: index + 1, total: items.length })}
              </Text>
            ) : state.label ? (
              <Text variant="caption" color={withAlpha(fg, 0.6)} numberOfLines={1}>
                {state.label}
              </Text>
            ) : null}
          </View>
          {failed ? (
            <Text variant="caption" color={withAlpha(fg, 0.7)}>
              {t('attachments.viewer.failed')}
            </Text>
          ) : (
            <>
              <IconButton icon="magnifying-glass-minus" label={t('attachments.viewer.zoomOut')} tone="overlay" disabled={zoom <= 1.01} onPress={() => requestZoom(-1)} />
              {zoom > 1.01 ? (
                <Text variant="caption" color={withAlpha(fg, 0.75)} style={styles.zoom}>
                  {Math.round(zoom * 100)}%
                </Text>
              ) : null}
              <IconButton icon="magnifying-glass-plus" label={t('attachments.viewer.zoomIn')} tone="overlay" disabled={zoom >= 3.99} onPress={() => requestZoom(1)} />
            </>
          )}
          <IconButton icon="download" label={t('mobile.media.save')} tone="overlay" onPress={save} disabled={!current} />
          <IconButton icon="share-nodes" label={t('mobile.media.share')} tone="overlay" onPress={share} disabled={!current} />
        </View>
      ) : null}

      {chrome && (many || facts) ? (
        <View
          testID="media-viewer-footer"
          style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12), paddingLeft: sides.left, paddingRight: sides.right }]}
        >
          {many ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {items.map((it, i) => (
                <Touchable
                  key={`${i}:${it.url}`}
                  feedback="opacity"
                  onPress={() => goToMedia(i)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: i === index }}
                  accessibilityLabel={it.filename}
                  style={[
                    styles.thumb,
                    { borderColor: i === index ? withAlpha(fg, 0.9) : withAlpha(fg, 0.2), opacity: i === index ? 1 : 0.55, borderRadius: theme.radii.sm },
                  ]}
                >
                  <Image source={{ uri: it.url }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={it.url} />
                </Touchable>
              ))}
            </ScrollView>
          ) : null}
          {facts ? (
            <Text variant="caption" color={withAlpha(fg, 0.45)} style={styles.facts}>
              {facts}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const BAR_PAD = 8;

const styles = StyleSheet.create({
  root: { flex: 1 },
  black: { backgroundColor: '#000' },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingBottom: BAR_PAD,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  title: { flex: 1, minWidth: 0, paddingHorizontal: 4 },
  tabular: { fontVariant: ['tabular-nums'] },
  zoom: { minWidth: 40, textAlign: 'center', fontVariant: ['tabular-nums'] },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 8, backgroundColor: 'rgba(0,0,0,0.45)' },
  strip: { paddingHorizontal: 12, gap: 6 },
  thumb: { width: 48, height: 48, overflow: 'hidden', borderWidth: 1 },
  facts: { paddingHorizontal: 12, paddingTop: 6 },
});
