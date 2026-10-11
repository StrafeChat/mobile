/**
 * Inline media for a bare image / GIF / video link (the web's MediaEmbed): the picture under
 * its link, capped and reserved from the size cached last time (lib/mediaDimensions, the same
 * localStorage key), a skeleton until it arrives, a tap for the viewer.
 *
 * Many hosts serve an HTML page at a media-looking URL. A load error (remembered ten minutes)
 * or five seconds without a picture (not remembered - a slow network must not demote a working
 * image) turn the embed into a preview card when the room allows previews, else the plain
 * link, so the message never renders as nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { Image } from 'expo-image';
import { getMediaDimensions, hasRecentMediaFailure, recordMediaDimensions, recordMediaFailure } from '@web/lib/mediaDimensions';
import type { MediaKind } from '@web/lib/gif/providers';
import { useTheme } from '@/theme';
import { Skeleton, Touchable, withAlpha } from '@/ui';
import { fitBox, LINK_MEDIA_MAX, useMediaMaxWidth } from '../layout';
import { openMedia } from '../mediaViewer';
import { showLinkActions } from '../navigation';
import { VideoPlayer } from '../media/VideoPlayer';
import { LinkText } from './inline';
import { LinkPreview } from './LinkPreview';
import { mediaFilename } from './bodyModel';

export const MEDIA_LOAD_TIMEOUT_MS = 5000;
const UNKNOWN_BOX = { width: 256, height: 176 };

export interface MediaEmbedProps {
  href: string;
  kind: MediaKind;
  allowLinkPreviews: boolean;
  /** A lone GIF hides its URL; if it fails, the link comes back. */
  showLinkOnFail?: boolean;
}

export function MediaEmbed({ href, kind, allowLinkPreviews, showLinkOnFail }: MediaEmbedProps) {
  const theme = useTheme();
  const maxW = useMediaMaxWidth(LINK_MEDIA_MAX.width);
  const [failed, setFailed] = useState(() => hasRecentMediaFailure(href));
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(() => getMediaDimensions(href) ?? null);
  const [shown, setShown] = useState(false);
  const ready = useRef(false);

  useEffect(() => {
    if (failed || kind === 'video') return undefined;
    const timer = setTimeout(() => {
      if (!ready.current) setFailed(true);
    }, MEDIA_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [failed, kind]);

  const onFail = () => {
    recordMediaFailure(href);
    setFailed(true);
  };

  if (failed) {
    if (allowLinkPreviews) return <LinkPreview url={href} />;
    if (showLinkOnFail) {
      return (
        <RNText>
          <LinkText href={href}>{href}</LinkText>
        </RNText>
      );
    }
    return null;
  }

  if (kind === 'video') {
    return (
      <View style={styles.wrap}>
        <VideoPlayer
          uri={href}
          filename={mediaFilename(href)}
          maxWidth={maxW}
          onReady={() => {
            ready.current = true;
          }}
          onError={onFail}
          onLongPress={() => showLinkActions(href)}
        />
      </View>
    );
  }

  const box = fitBox(natural?.width, natural?.height, maxW, LINK_MEDIA_MAX.height) ?? {
    width: Math.min(UNKNOWN_BOX.width, maxW),
    height: UNKNOWN_BOX.height,
  };
  return (
    <Touchable
      feedback="opacity"
      onPress={() =>
        openMedia([{ url: href, filename: mediaFilename(href), width: natural?.width, height: natural?.height }])
      }
      onLongPress={() => showLinkActions(href)}
      accessibilityRole="imagebutton"
      accessibilityLabel={kind === 'gif' ? 'GIF' : mediaFilename(href)}
      style={[
        styles.wrap,
        styles.frame,
        {
          width: box.width,
          height: box.height,
          borderRadius: theme.radii.md,
          borderColor: withAlpha(theme.colors.border, 0.5),
          backgroundColor: withAlpha(theme.colors.muted, 0.3),
        },
      ]}
    >
      {!shown ? <Skeleton width={box.width} height={box.height} radius={theme.radii.md} style={StyleSheet.absoluteFill} /> : null}
      <Image
        source={{ uri: href }}
        style={[StyleSheet.absoluteFill, { opacity: shown ? 1 : 0 }]}
        contentFit="contain"
        recyclingKey={href}
        transition={theme.reduceMotion ? 0 : 300}
        onLoad={(e) => {
          ready.current = true;
          setShown(true);
          const { width, height } = e.source;
          if (width > 0 && height > 0) {
            recordMediaDimensions(href, width, height);
            if (!natural || natural.width !== width || natural.height !== height) setNatural({ width, height });
          }
        }}
        onError={onFail}
      />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 6 },
  frame: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, maxWidth: '100%' },
});
