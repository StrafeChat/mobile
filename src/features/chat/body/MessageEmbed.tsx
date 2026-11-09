/**
 * A bot's rich embeds (the web's MessageEmbed), one card each under the message's text and its
 * attachments, Discord's order and shape: an edge in the embed's colour (a neutral one without),
 * the author line (icon, name - a link when it has a url), the title (styling only; opens `url`
 * through the external-link guard), the description (full markdown), the fields (an inline run
 * shares rows, three to a row - two beside a thumbnail), the big picture, an 80 pt thumbnail top
 * right, and the footer (icon, text, the timestamp in the reader's own time).
 *
 * Pictures load only from this instance: its CDN, or the image proxy the server names in
 * `proxy_url` / `proxy_icon_url` (embedImageSrc, lib/embeds/messageEmbeds). A picture the
 * instance has no copy of is a placeholder naming the site, which loads the original only when
 * the reader taps it, having been told that this shows their IP address to that site; an icon
 * without a copy is left out. For a reader who asked for reduced motion every picture and icon
 * is held on its first frame (the viewer, a tap away, plays it): any of them may animate, since
 * the proxy serves whatever bytes it finds, an extensionless URL or an APNG named .png included.
 *
 * Mentions in the text render as pills, as in a message, and never notify: the server and the
 * stores leave embed text out of mentions.
 *
 * The caller decides whether embeds show at all: a plain room, and "Show embeds from bots" on.
 */
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import type { Embed, EmbedField, EmbedImage } from '@web/api/messages';
import {
  embedColorHex,
  embedHasContent,
  embedImageSrc,
  maybeAnimated,
  placeFields,
  safeHttpUrl,
  urlHost,
} from '@web/lib/embeds/messageEmbeds';
import { getMediaDimensions, recordMediaDimensions } from '@web/lib/mediaDimensions';
import { formatMessageTimestamp } from '@web/lib/utils/datetime';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Button, Icon, onScrim, Skeleton, Text, Touchable, withAlpha } from '@/ui';
import { fitBox, useMediaMaxWidth } from '../layout';
import { openMedia } from '../mediaViewer';
import { openMessageLink, showLinkActions } from '../navigation';
import { linkUnderline, useUnderlineLinks } from './inline';
import { EmbedShell } from './LinkPreview';
import { InlineStyledText, MessageBody } from './MessageBody';

/** The web's sizes: the card is at most 520 wide, the picture fits 400 x 300, the thumbnail 80. */
const CARD_MAX = 520;
const IMAGE_MAX_W = 400;
const IMAGE_MAX_H = 300;
const THUMB = 80;
/** The card's padding (start, end) and its coloured edge. */
const PAD_START = 12;
const PAD_END = 16;
const EDGE = 3;
const UNKNOWN_IMAGE = { width: 256, height: 176 };

/**
 * The web's field grid (placeFields: twelve columns) as rows for a flex layout: a row starts
 * wherever a field starts at column one, and the fields of one row share it equally (a short
 * last row of an inline run spreads over the width, as on the web).
 */
export function fieldRows<T extends { inline?: boolean }>(fields: readonly T[], hasThumbnail: boolean): T[][] {
  const placements = placeFields(fields, hasThumbnail);
  const rows: T[][] = [];
  fields.forEach((field, i) => {
    const start = Number.parseInt(placements[i]?.column ?? '1', 10);
    const row = rows[rows.length - 1];
    if (start === 1 || !row) rows.push([field]);
    else row.push(field);
  });
  return rows;
}

export interface MessageEmbedsProps {
  embeds: readonly Embed[];
  roomId: string;
  spaceId: string | null;
}

export const MessageEmbeds = memo(function MessageEmbeds({ embeds, roomId, spaceId }: MessageEmbedsProps) {
  const shown = embeds.filter(embedHasContent);
  if (shown.length === 0) return null;
  return (
    <View style={styles.list}>
      {shown.map((embed, i) => (
        <EmbedCard key={i} embed={embed} roomId={roomId} spaceId={spaceId} />
      ))}
    </View>
  );
});

function EmbedCard({ embed: e, roomId, spaceId }: { embed: Embed; roomId: string; spaceId: string | null }) {
  const theme = useTheme();
  const underline = useUnderlineLinks();
  const maxW = useMediaMaxWidth(CARD_MAX);
  const inner = maxW - PAD_START - PAD_END - EDGE;
  const textColor = withAlpha(theme.colors.foreground, 0.9);
  const titleHref = safeHttpUrl(e.url);
  const authorHref = safeHttpUrl(e.author?.url);
  const authorIcon = embedImageSrc(e.author?.icon_url, e.author?.proxy_icon_url);
  const footerIcon = embedImageSrc(e.footer?.icon_url, e.footer?.proxy_icon_url);
  const image = e.image?.url ? e.image : undefined;
  const thumbnail = e.thumbnail?.url ? e.thumbnail : undefined;
  const rows = fieldRows((e.fields ?? []).filter((f): f is EmbedField => !!f && !!(f.name || f.value)), !!thumbnail);
  const stamp = e.timestamp ? new Date(e.timestamp) : null;
  const time = stamp && !Number.isNaN(stamp.getTime()) ? formatMessageTimestamp(stamp) : '';

  /** A picture opens the app's viewer, labelled with what the embed calls itself. */
  const openPicture = (src: string, width?: number, height?: number) =>
    openMedia([{ url: src, filename: e.title || urlHost(src) || t('messages.embed.image'), width, height }], 0, e.author?.name || undefined);
  const linkProps = (href: string) => ({
    onPress: () => openMessageLink(href),
    onLongPress: () => showLinkActions(href),
    accessibilityRole: 'link' as const,
  });

  return (
    <EmbedShell color={embedColorHex(e.color) ?? theme.colors.border} maxWidth={maxW}>
      <View style={styles.pad}>
        <View style={styles.top}>
          <View style={styles.flex}>
            {e.author?.name ? (
              <View style={styles.author}>
                {authorIcon ? (
                  <Image
                    source={{ uri: authorIcon }}
                    style={styles.authorIcon}
                    contentFit="cover"
                    recyclingKey={authorIcon}
                    autoplay={!theme.reduceMotion}
                    accessible={false}
                  />
                ) : null}
                <Text
                  variant="label"
                  weight="semibold"
                  tone="default"
                  numberOfLines={1}
                  style={[styles.shrink, authorHref ? linkUnderline(underline) : null]}
                  {...(authorHref ? linkProps(authorHref) : {})}
                >
                  {e.author.name}
                </Text>
              </View>
            ) : null}
            {e.title ? (
              <InlineStyledText
                text={e.title}
                roomId={roomId}
                spaceId={spaceId}
                style={[
                  styles.title,
                  { fontSize: theme.font(15), lineHeight: Math.round(theme.font(20)), color: titleHref ? theme.colors.primary : theme.colors.foreground },
                  titleHref ? linkUnderline(underline) : null,
                ]}
                {...(titleHref ? linkProps(titleHref) : { accessibilityRole: 'header' as const })}
              />
            ) : null}
            {e.description ? <MessageBody text={e.description} roomId={roomId} spaceId={spaceId} allowLinkPreviews={false} embedded small color={textColor} /> : null}
            {rows.length > 0 ? (
              <View style={styles.fields}>
                {rows.map((row, r) => (
                  <View key={r} style={styles.fieldRow}>
                    {row.map((field, i) => (
                      <View key={i} style={styles.flex}>
                        {field.name ? (
                          <InlineStyledText
                            text={field.name}
                            roomId={roomId}
                            spaceId={spaceId}
                            style={[styles.fieldName, { fontSize: theme.font(14), lineHeight: Math.round(theme.font(19)), color: theme.colors.foreground }]}
                          />
                        ) : null}
                        {field.value ? (
                          <MessageBody text={field.value} roomId={roomId} spaceId={spaceId} allowLinkPreviews={false} embedded small color={textColor} />
                        ) : null}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          {thumbnail ? <EmbedPicture image={thumbnail} thumb maxWidth={THUMB} onOpen={openPicture} /> : null}
        </View>
        {image ? (
          <View style={styles.image}>
            <EmbedPicture image={image} maxWidth={Math.min(IMAGE_MAX_W, inner)} onOpen={openPicture} />
          </View>
        ) : null}
        {e.footer?.text || time ? (
          <View style={styles.footer}>
            {e.footer?.text && footerIcon ? (
              <Image
                source={{ uri: footerIcon }}
                style={styles.footerIcon}
                contentFit="cover"
                recyclingKey={footerIcon}
                autoplay={!theme.reduceMotion}
                accessible={false}
              />
            ) : null}
            <Text variant="caption" style={styles.shrink}>
              {e.footer?.text ?? ''}
              {e.footer?.text && time ? ' • ' : ''}
              {time}
            </Text>
          </View>
        ) : null}
      </View>
    </EmbedShell>
  );
}

/**
 * An embed's picture: the instance's copy when there is one, otherwise a placeholder that loads
 * the original only when the reader asks.
 */
function EmbedPicture({
  image,
  thumb,
  maxWidth,
  onOpen,
}: {
  image: EmbedImage;
  thumb?: boolean;
  maxWidth: number;
  onOpen: (src: string, width?: number, height?: number) => void;
}) {
  const [optedIn, setOptedIn] = useState(false);
  const src = embedImageSrc(image.url, image.proxy_url) ?? (optedIn ? safeHttpUrl(image.url) : undefined);
  if (!src) return <ExternalImageGate url={image.url} thumb={thumb} onLoad={() => setOptedIn(true)} />;
  return (
    <PictureFrame
      key={src}
      src={src}
      source={image.url}
      width={image.width}
      height={image.height}
      thumb={thumb}
      maxWidth={maxWidth}
      onOpen={(w, h) => onOpen(src, w, h)}
    />
  );
}

/**
 * The picture itself: its box reserved from the size the server learned (or one cached from an
 * earlier load) so the row does not jump, a skeleton until the bytes come, gone if they never do.
 * Held still under reduced motion whatever it is; the GIF badge only on one whose URL names an
 * animated format.
 */
function PictureFrame({
  src,
  source,
  width,
  height,
  thumb,
  maxWidth,
  onOpen,
}: {
  src: string;
  /** The bot's original URL: whether it names an animated format decides the GIF badge. */
  source: string;
  width?: number;
  height?: number;
  thumb?: boolean;
  maxWidth: number;
  onOpen: (width?: number, height?: number) => void;
}) {
  const theme = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(() => getMediaDimensions(src) ?? null);
  const w = width || natural?.width;
  const h = height || natural?.height;
  const box =
    fitBox(w, h, maxWidth, thumb ? THUMB : IMAGE_MAX_H) ??
    (thumb ? { width: THUMB, height: THUMB } : { width: Math.min(UNKNOWN_IMAGE.width, maxWidth), height: UNKNOWN_IMAGE.height });
  const still = theme.reduceMotion;
  if (failed) return null;
  return (
    <Touchable
      feedback="opacity"
      onPress={() => onOpen(w, h)}
      accessibilityRole="imagebutton"
      accessibilityLabel={t('messages.embed.openImage')}
      style={[styles.picture, { width: box.width, height: box.height, borderRadius: theme.radii.sm }]}
    >
      {!loaded ? <Skeleton width={box.width} height={box.height} radius={theme.radii.sm} style={StyleSheet.absoluteFill} /> : null}
      <Image
        source={{ uri: src }}
        style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
        contentFit="contain"
        recyclingKey={src}
        autoplay={!still}
        transition={theme.reduceMotion ? 0 : 180}
        onLoad={(ev) => {
          setLoaded(true);
          const { width: nw, height: nh } = ev.source;
          if (nw > 0 && nh > 0) {
            recordMediaDimensions(src, nw, nh);
            if (!natural || natural.width !== nw || natural.height !== nh) setNatural({ width: nw, height: nh });
          }
        }}
        onError={() => setFailed(true)}
      />
      {still && loaded && !thumb && maybeAnimated(source) ? (
        <View pointerEvents="none" style={styles.gifBadge}>
          <Text style={[styles.gifText, { color: onScrim(theme) }]}>{t('gif.item')}</Text>
        </View>
      ) : null}
    </Touchable>
  );
}

/**
 * In place of a picture the instance has no copy of (its image proxy is off): the site's name,
 * and what loading it would tell that site. Nothing is fetched until the reader says so.
 */
function ExternalImageGate({ url, thumb, onLoad }: { url: string; thumb?: boolean; onLoad: () => void }) {
  const theme = useTheme();
  const host = urlHost(url);
  if (!safeHttpUrl(url) || !host) return null;
  const label = t('messages.embed.externalImage', { host });
  const warning = t('messages.embed.externalImageWarning');
  const frame = { borderColor: theme.colors.border, backgroundColor: withAlpha(theme.colors.muted, 0.3), borderRadius: theme.radii.sm };
  if (thumb) {
    return (
      <Touchable
        feedback="opacity"
        onPress={onLoad}
        accessibilityRole="button"
        accessibilityLabel={`${t('messages.embed.loadImage')}: ${label}. ${warning}`}
        style={[styles.gateThumb, frame]}
      >
        <Icon name="image" size={18} tone="muted" />
        <Text variant="caption" numberOfLines={1} style={styles.gateHost}>
          {host}
        </Text>
      </Touchable>
    );
  }
  return (
    <View style={[styles.gate, frame]}>
      <View style={styles.gateText}>
        <Icon name="image" size={18} tone="muted" />
        <View style={styles.flex}>
          <Text variant="label" tone="default">
            {label}
          </Text>
          <Text variant="caption">{warning}</Text>
        </View>
      </View>
      <Button size="sm" variant="secondary" title={t('messages.embed.loadImage')} accessibilityHint={warning} onPress={onLoad} style={styles.gateButton} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 4 },
  pad: { paddingTop: 12, paddingBottom: 12, paddingStart: PAD_START, paddingEnd: PAD_END },
  top: { flexDirection: 'row', gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  authorIcon: { width: 24, height: 24, borderRadius: 12 },
  title: { fontWeight: '600', marginBottom: 4 },
  fields: { marginTop: 8, gap: 8 },
  fieldRow: { flexDirection: 'row', gap: 16 },
  fieldName: { fontWeight: '600', marginBottom: 2 },
  image: { marginTop: 12 },
  picture: { overflow: 'hidden', maxWidth: '100%' },
  gifBadge: { position: 'absolute', bottom: 6, start: 6, paddingHorizontal: 4, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.65)' },
  gifText: { fontSize: 10, fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  footerIcon: { width: 20, height: 20, borderRadius: 10 },
  gate: { borderWidth: 1, borderStyle: 'dashed', padding: 12, gap: 10, maxWidth: 384 },
  gateText: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gateButton: { alignSelf: 'flex-start' },
  gateThumb: { width: THUMB, height: THUMB, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  gateHost: { fontSize: 10, maxWidth: THUMB - 8 },
});
