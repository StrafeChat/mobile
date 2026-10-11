/**
 * A message's attachments (the web's MessageAttachments): images inline (tap: the viewer over
 * all of the message's images), video in the click-to-load player, audio in the audio card,
 * voice messages in the compact voice player, anything else as a file card. Each kind shows a
 * thin progress bar while it uploads.
 *
 * The bytes come through @/platform/media's useAttachmentSource: the local copy while sending,
 * the decrypted file for an E2EE attachment, the CDN otherwise; and 'unsupported' for a clip
 * this device cannot play (WebM / Ogg on iOS), which is offered to share or save instead.
 * Long-press any attachment for Save / Share (the web's download button).
 */
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { t } from '@web/i18n/t';
import type { AttachmentView } from '@web/lib/attachments/types';
import { attachmentKind, fileIcon, formatFileSize, isVoiceMessage } from '@web/lib/attachments/format';
import { getMediaDimensions, recordMediaDimensions } from '@web/lib/mediaDimensions';
import type { MediaViewerItem } from '@web/stores/mediaViewer';
import {
  attachmentSourceSync,
  saveAttachmentToDevice,
  shareAttachment,
  useAttachmentSource,
  type ExportResult,
  type MediaSourceState,
} from '@/platform/media';
import { useTheme } from '@/theme';
import { haptics, Icon, IconButton, showActionSheet, Skeleton, Spinner, Text, toast, Touchable, withAlpha } from '@/ui';
import { fitBox, IMAGE_MAX, useMediaMaxWidth } from '../layout';
import { openMedia } from '../mediaViewer';
import { VideoPlayer } from '../media/VideoPlayer';
import { AudioPlayer, VoiceMessagePlayer } from '../media/AudioPlayers';

const UNKNOWN_IMAGE = { width: 224, height: 160 };

// ---- getting a file out ------------------------------------------------------------------------------

export function reportExport(result: ExportResult): void {
  switch (result.status) {
    case 'saved':
      haptics.success();
      toast.success(t('mobile.media.saved'));
      return;
    case 'denied':
      toast.warning(t('mobile.media.saveDenied'));
      return;
    case 'unavailable':
      toast(t('mobile.media.shareUnavailable'));
      return;
    case 'failed':
      toast.error(result.reason === 'tooLarge' ? t('mobile.media.tooLarge') : t('mobile.media.loadFailed'));
      return;
    default:
      return;
  }
}

export function saveAttachment(att: AttachmentView): void {
  void saveAttachmentToDevice(att).then(reportExport);
}

export function shareAttachmentFile(att: AttachmentView): void {
  void shareAttachment(att).then(reportExport);
}

/** Long-press on an attachment: Save to device / Share. Nothing while it is still uploading. */
export function showAttachmentActions(att: AttachmentView): void {
  if (att.uploading) return;
  void showActionSheet(
    [
      { key: 'save', label: t('mobile.media.save'), icon: 'download', onSelect: () => saveAttachment(att) },
      { key: 'share', label: t('mobile.media.share'), icon: 'share-nodes', onSelect: () => shareAttachmentFile(att) },
    ],
    { title: att.filename, subtitle: formatFileSize(att.size) },
  );
}

// ---- shared pieces -------------------------------------------------------------------------------------

function UploadProgress({ att }: { att: AttachmentView }) {
  const theme = useTheme();
  if (!att.uploading) return null;
  return (
    <View style={styles.progressTrack} pointerEvents="none" accessibilityLabel={t('common.uploading')}>
      <View style={[styles.progressFill, { width: `${Math.round((att.progress ?? 0) * 100)}%`, backgroundColor: theme.colors.primary }]} />
    </View>
  );
}

/** A tile for a failed download / decrypt, with retry. */
function ErrorTile({ state, width, height }: { state: Extract<MediaSourceState, { status: 'error' }>; width: number; height: number }) {
  const theme = useTheme();
  const message =
    state.reason === 'notEncrypted' || state.reason === 'corrupt'
      ? t('mobile.media.decryptFailed')
      : state.reason === 'tooLarge'
        ? t('mobile.media.tooLarge')
        : t('mobile.media.loadFailed');
  return (
    <Touchable
      feedback="opacity"
      onPress={state.retry}
      accessibilityRole="button"
      accessibilityLabel={message}
      accessibilityHint={t('mobile.media.retry')}
      style={[styles.center, { width, height, borderRadius: theme.radii.md, backgroundColor: withAlpha(theme.colors.muted, 0.6) }]}
    >
      <Icon name="triangle-exclamation" tone="muted" size={18} />
      <Text variant="caption" align="center" style={styles.tileText}>
        {message}
      </Text>
      <Text variant="caption" tone="primary">
        {t('mobile.media.retry')}
      </Text>
    </Touchable>
  );
}

/** A clip this device can't play: say so, and offer it to another app. */
function UnsupportedCard({ att }: { att: AttachmentView }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { borderColor: withAlpha(theme.colors.border, 0.8), backgroundColor: withAlpha(theme.colors.card, 0.4), borderRadius: theme.radii.lg }]}>
      <View style={styles.row}>
        <View style={[styles.fileIcon, { backgroundColor: withAlpha(theme.colors.muted, 0.6), borderRadius: theme.radii.md }]}>
          <Icon name="circle-exclamation" tone="muted" size={18} />
        </View>
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1}>
            {att.filename}
          </Text>
          <Text variant="caption">{t('mobile.media.unsupportedIos')}</Text>
        </View>
        <IconButton icon="share-nodes" label={t('mobile.media.share')} tone="subtle" onPress={() => shareAttachmentFile(att)} />
      </View>
    </View>
  );
}

// ---- kinds -----------------------------------------------------------------------------------------------

function ImageAttachment({ att, onOpen }: { att: AttachmentView; onOpen: () => void }) {
  const theme = useTheme();
  const maxW = useMediaMaxWidth(IMAGE_MAX.width);
  const source = useAttachmentSource(att);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const cached = getMediaDimensions(att.url);
  const box =
    fitBox(att.width ?? natural?.width ?? cached?.width, att.height ?? natural?.height ?? cached?.height, maxW, IMAGE_MAX.height) ?? {
      width: Math.min(UNKNOWN_IMAGE.width, maxW),
      height: UNKNOWN_IMAGE.height,
    };
  if (source.status === 'error') return <ErrorTile state={source} width={box.width} height={box.height} />;
  const uri = source.status === 'ready' || source.status === 'unsupported' ? source.uri : null;
  return (
    <Touchable
      feedback="opacity"
      disabled={!!att.uploading || !uri}
      onPress={onOpen}
      onLongPress={() => {
        haptics.longPress();
        showAttachmentActions(att);
      }}
      accessibilityRole="imagebutton"
      accessibilityLabel={att.filename}
      style={[styles.media, { width: box.width, height: box.height, borderRadius: theme.radii.md }]}
    >
      {!loaded ? <Skeleton width={box.width} height={box.height} radius={theme.radii.md} style={StyleSheet.absoluteFill} /> : null}
      {uri ? (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { opacity: loaded ? (att.uploading ? 0.7 : 1) : 0 }]}
          contentFit="cover"
          recyclingKey={`${att.id}:${uri}`}
          transition={theme.reduceMotion ? 0 : 300}
          onLoad={(e) => {
            setLoaded(true);
            const { width, height } = e.source;
            if (width > 0 && height > 0) {
              recordMediaDimensions(att.url, width, height);
              if (!att.width && (!natural || natural.width !== width)) setNatural({ width, height });
            }
          }}
        />
      ) : null}
      {source.status === 'loading' && source.progress != null ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Spinner size="small" decorative />
        </View>
      ) : null}
      <UploadProgress att={att} />
    </Touchable>
  );
}

function VideoAttachment({ att }: { att: AttachmentView }) {
  const maxW = useMediaMaxWidth(400);
  const source = useAttachmentSource(att);
  if (source.status === 'unsupported') return <UnsupportedCard att={att} />;
  if (source.status === 'error') return <ErrorTile state={source} width={Math.min(400, maxW)} height={Math.round((Math.min(400, maxW) * 9) / 16)} />;
  return (
    <View>
      <VideoPlayer
        uri={source.status === 'ready' ? source.uri : null}
        filename={att.filename}
        width={att.width}
        height={att.height}
        maxWidth={maxW}
        onLongPress={() => showAttachmentActions(att)}
      />
      <UploadProgress att={att} />
    </View>
  );
}

function AudioAttachment({ att, voice }: { att: AttachmentView; voice: boolean }) {
  const source = useAttachmentSource(att);
  if (source.status === 'unsupported') return <UnsupportedCard att={att} />;
  if (source.status === 'error') return <ErrorTile state={source} width={320} height={64} />;
  const uri = source.status === 'ready' ? source.uri : null;
  const onShare = att.uploading ? undefined : () => showAttachmentActions(att);
  const Player = voice ? VoiceMessagePlayer : AudioPlayer;
  return (
    <Player uri={uri} size={att.size} filename={att.filename} onShare={onShare}>
      <UploadProgress att={att} />
    </Player>
  );
}

function FileCard({ att }: { att: AttachmentView }) {
  const theme = useTheme();
  const icon = fileIcon(att.contentType, att.filename);
  return (
    <Touchable
      feedback="highlight"
      disabled={!!att.uploading}
      onPress={() => shareAttachmentFile(att)}
      onLongPress={() => {
        haptics.longPress();
        showAttachmentActions(att);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${att.filename}, ${formatFileSize(att.size)}`}
      accessibilityHint={t('mobile.chat.fileOpenHint')}
      style={[styles.card, { borderColor: withAlpha(theme.colors.border, 0.8), backgroundColor: withAlpha(theme.colors.card, 0.4), borderRadius: theme.radii.lg }]}
    >
      <View style={styles.row}>
        <View style={[styles.fileIcon, { backgroundColor: withAlpha(theme.colors.muted, 0.6), borderRadius: theme.radii.md }]}>
          <Icon name={icon} tone="muted" size={18} />
        </View>
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1} ellipsizeMode="middle">
            {att.filename}
          </Text>
          <Text variant="caption">
            {formatFileSize(att.size)}
            {att.encryption ? '  ' : ''}
            {att.encryption ? <Icon name="lock" size={10} tone="muted" accessibilityLabel={t('room.e2eeBadge')} /> : null}
          </Text>
        </View>
        {!att.uploading ? (
          <IconButton icon="download" label={t('attachments.downloadNamed', { name: att.filename })} tone="subtle" onPress={() => saveAttachment(att)} />
        ) : null}
      </View>
      <UploadProgress att={att} />
    </Touchable>
  );
}

// ---- the list -----------------------------------------------------------------------------------------

/** The viewer items for a message's images that can be shown right now (web: displayUrlFor). */
export function viewerItems(attachments: readonly AttachmentView[]): { items: MediaViewerItem[]; ids: string[] } {
  const items: MediaViewerItem[] = [];
  const ids: string[] = [];
  for (const a of attachments) {
    if (a.uploading || attachmentKind(a.contentType, a.filename) !== 'image') continue;
    const src = attachmentSourceSync(a);
    if (!src?.uri) continue;
    items.push({ url: src.uri, filename: a.filename, contentType: a.contentType, size: a.size, width: a.width, height: a.height });
    ids.push(a.id);
  }
  return { items, ids };
}

export const MessageAttachments = memo(function MessageAttachments({ attachments }: { attachments: readonly AttachmentView[] }) {
  return (
    <View style={styles.list}>
      {attachments.map((att) => {
        const voice = isVoiceMessage(att.contentType, att.filename);
        const kind = voice ? 'audio' : attachmentKind(att.contentType, att.filename);
        if (kind === 'image') {
          return (
            <ImageAttachment
              key={att.id}
              att={att}
              onOpen={() => {
                const { items, ids } = viewerItems(attachments);
                const i = ids.indexOf(att.id);
                if (i >= 0) openMedia(items, i);
              }}
            />
          );
        }
        if (kind === 'video') return <VideoAttachment key={att.id} att={att} />;
        if (kind === 'audio') return <AudioAttachment key={att.id} att={att} voice={voice} />;
        return <FileCard key={att.id} att={att} />;
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  list: { marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  media: { overflow: 'hidden', maxWidth: '100%' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 8, gap: 4 },
  tileText: { paddingHorizontal: 8 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 12, overflow: 'hidden', width: '100%', maxWidth: 448 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  fileIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.4)' },
  progressFill: { height: '100%' },
});
