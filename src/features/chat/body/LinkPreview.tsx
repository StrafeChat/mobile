/**
 * A link preview card, Discord-embed style (the web's LinkPreview): an accent edge in the
 * site's colour, provider line (favicon + site name), author, title (opens the link through
 * the external-link guard), description, and media - an inline video for a real video file,
 * a click-to-load provider player (YouTube, Vimeo...), a poster that opens the source for any
 * other declared video, a full-width image (opens the viewer) or a small thumbnail beside the
 * text. Metadata comes from stores/linkPreviews (GET /unfurl, cached); 'empty' hides the card.
 *
 * Only render this where previews are allowed: always in plaintext rooms, in encrypted ones
 * only with the reader's opt-in (settings.linkPreviewsInEncrypted).
 */
import { memo, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import type { LinkMetadata, UnfurlMedia } from '@web/api/unfurl';
import { videoEmbed } from '@web/lib/embeds/providers';
import { getMediaDimensions, recordMediaDimensions } from '@web/lib/mediaDimensions';
import { useLinkPreview } from '@/data';
import { useTheme } from '@/theme';
import { Icon, onScrim, Skeleton, Text, Touchable, withAlpha } from '@/ui';
import { useMediaMaxWidth } from '../layout';
import { openMedia } from '../mediaViewer';
import { openMessageLink, showLinkActions } from '../navigation';
import { VideoPlayer } from '../media/VideoPlayer';
import { IframeEmbed } from './IframeEmbed';
import { mediaFilename } from './bodyModel';

const CARD_MAX = 448;
const THUMB = 80;

export const LinkPreview = memo(function LinkPreview({ url }: { url: string }) {
  const entry = useLinkPreview(url, true);
  const data = entry?.status === 'ok' ? entry.data : undefined;
  const embed = useMemo(() => videoEmbed(url), [url]);
  // A card even without metadata for an embeddable provider (YouTube serves the unfurl bot nothing).
  if (!data && !embed) return null;
  return <Card d={data ?? {}} fallbackUrl={url} />;
});

function PreviewImage({ media, width }: { media: UnfurlMedia; width: number }) {
  const theme = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const cached = getMediaDimensions(media.url);
  const w = media.width || cached?.width;
  const h = media.height || cached?.height;
  const height = w && h ? Math.min(320, Math.round((width * h) / w)) : 176;
  // An image that 404s or is hotlink-blocked leaves no grey slab behind: the card goes text-only.
  if (failed) return null;
  return (
    <View style={[styles.image, { width, height, borderRadius: theme.radii.sm }]}>
      {!loaded ? <Skeleton width={width} height={height} style={StyleSheet.absoluteFill} /> : null}
      <Image
        source={{ uri: media.url }}
        style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
        contentFit="cover"
        recyclingKey={media.url}
        transition={theme.reduceMotion ? 0 : 180}
        onLoad={(e) => {
          setLoaded(true);
          recordMediaDimensions(media.url, e.source.width, e.source.height);
        }}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

function Card({ d, fallbackUrl }: { d: LinkMetadata; fallbackUrl: string }) {
  const theme = useTheme();
  const maxW = useMediaMaxWidth(CARD_MAX);
  const inner = maxW - 2 * 12 - 3;
  const href = d.url || fallbackUrl;
  const embed = useMemo(() => videoEmbed(d.url) || videoEmbed(fallbackUrl), [d.url, fallbackUrl]);
  const video = d.video;
  const image = d.image;
  const videoPlayable = !!video?.url && ((d.video_type ?? '').startsWith('video/') || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(video.url));
  const bigMedia = !!video || !!embed || (!!image && !!d.image_large);
  const thumbnail = !video && !embed && !!image && !d.image_large;
  const openImage = (img: UnfurlMedia) =>
    openMedia([{ url: img.url, filename: d.title || img.url, width: img.width, height: img.height }], 0, d.site_name || undefined);

  const text = (
    <View>
      {d.site_name || d.icon ? (
        <View style={styles.provider}>
          {d.icon ? <Image source={{ uri: d.icon }} style={styles.favicon} contentFit="contain" recyclingKey={d.icon} /> : null}
          {d.site_name ? (
            <Text variant="caption" numberOfLines={1} style={styles.flexShrink}>
              {d.site_name}
            </Text>
          ) : null}
        </View>
      ) : null}
      {d.author ? (
        <Text variant="caption" weight="medium" tone="default" numberOfLines={1} style={styles.author}>
          {d.author}
        </Text>
      ) : null}
      {d.title ? (
        <Text
          variant="label"
          weight="semibold"
          tone="primary"
          numberOfLines={2}
          onPress={() => openMessageLink(href)}
          onLongPress={() => showLinkActions(href)}
          accessibilityRole="link"
        >
          {d.title}
        </Text>
      ) : null}
      {d.description ? (
        <Text variant="caption" numberOfLines={4} style={styles.description}>
          {d.description}
        </Text>
      ) : null}
    </View>
  );

  let media: ReactNode = null;
  if (bigMedia) {
    if (videoPlayable && video) {
      media = (
        <View style={styles.mediaGap}>
          <VideoPlayer
            uri={video.url}
            filename={d.title || mediaFilename(video.url)}
            width={video.width}
            height={video.height}
            maxWidth={inner}
            poster={image?.url}
            onLongPress={() => showLinkActions(href)}
          />
        </View>
      );
    } else if (embed) {
      media = <IframeEmbed embed={embed} poster={image?.url ?? embed.poster} title={d.title} maxWidth={inner} />;
    } else if (video) {
      media = (
        <Touchable
          feedback="opacity"
          onPress={() => openMessageLink(href)}
          onLongPress={() => showLinkActions(href)}
          accessibilityRole="link"
          accessibilityLabel={d.title || href}
          style={[styles.mediaGap, styles.posterWrap, { borderRadius: theme.radii.sm }]}
        >
          {image?.url ? <PreviewImage media={image} width={inner} /> : <View style={{ width: inner, height: Math.round((inner * 9) / 16) }} />}
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <View style={styles.playBadge}>
              <Icon name="play" size={18} color={onScrim(theme)} style={styles.nudge} />
            </View>
          </View>
        </Touchable>
      );
    } else if (image) {
      media = (
        <Touchable feedback="opacity" onPress={() => openImage(image)} accessibilityRole="imagebutton" accessibilityLabel={d.title || image.url} style={styles.mediaGap}>
          <PreviewImage media={image} width={inner} />
        </Touchable>
      );
    }
  }

  return (
    <View
      style={[
        styles.card,
        {
          maxWidth: maxW,
          borderColor: withAlpha(theme.colors.border, 0.6),
          borderStartColor: d.color || theme.colors.primary,
          backgroundColor: withAlpha(theme.colors.card, 0.4),
          borderRadius: theme.radii.md,
        },
      ]}
    >
      {thumbnail && image ? (
        <View style={styles.row}>
          <View style={[styles.pad, styles.flex]}>{text}</View>
          <Touchable feedback="opacity" onPress={() => openImage(image)} accessibilityRole="imagebutton" accessibilityLabel={d.title || image.url}>
            <Image source={{ uri: image.url }} style={styles.thumb} contentFit="cover" recyclingKey={image.url} />
          </Touchable>
        </View>
      ) : (
        <View style={styles.pad}>
          {text}
          {media}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderStartWidth: 3, overflow: 'hidden', alignSelf: 'flex-start' },
  pad: { padding: 12 },
  row: { flexDirection: 'row' },
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  provider: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  favicon: { width: 14, height: 14, borderRadius: 2 },
  author: { marginBottom: 2 },
  description: { marginTop: 4 },
  mediaGap: { marginTop: 8 },
  image: { overflow: 'hidden' },
  posterWrap: { overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.3)' },
  center: { alignItems: 'center', justifyContent: 'center' },
  playBadge: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  nudge: { marginStart: 2 },
  thumb: { width: THUMB, height: '100%', minHeight: THUMB },
});
