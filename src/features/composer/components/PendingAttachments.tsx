/**
 * The files waiting to go with the next message, above the input: a thumbnail (images), a
 * kind icon (video, documents) or - for a recorded voice message - a small player, so you
 * can check the take before sending (the web's pending strip). Each has a remove button.
 * The strip scrolls sideways and owns that gesture, so it never swipes the shell.
 */
import { memo, useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { attachmentKind, fileIcon, formatFileSize, isVoiceMessage } from '@web/lib/attachments/format';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { HorizontalGestureOwner } from '@/shell/SwipeShell';
import { Icon, IconButton, Text, withAlpha } from '@/ui';
import { playExclusive, useExclusivePlayback, type PendingAttachment } from '@/platform/media';
import { formatClock } from '../logic/recordGesture';

export interface PendingAttachmentsProps {
  items: readonly PendingAttachment[];
  onRemove: (localId: string) => void;
}

const TILE = 76;

export function PendingAttachments({ items, onRemove }: PendingAttachmentsProps) {
  if (items.length === 0) return null;
  return (
    <HorizontalGestureOwner>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4 }}
        testID="composer-pending"
      >
        {items.map((att) =>
          isVoiceMessage(att.file.type, att.file.name) && att.previewUrl ? (
            <QueuedVoiceClip key={att.localId} att={att} onRemove={onRemove} />
          ) : (
            <FileTile key={att.localId} att={att} onRemove={onRemove} />
          ),
        )}
      </ScrollView>
    </HorizontalGestureOwner>
  );
}

const RemoveButton = ({ att, onRemove }: { att: PendingAttachment; onRemove: (id: string) => void }) => (
  <View style={{ position: 'absolute', top: 2, end: 2 }}>
    <IconButton
      icon="xmark"
      size="sm"
      tone="overlay"
      label={t('composer.removeAttachment', { name: att.file.name })}
      onPress={() => onRemove(att.localId)}
      testID={`remove-${att.localId}`}
    />
  </View>
);

const FileTile = memo(function FileTile({ att, onRemove }: { att: PendingAttachment; onRemove: (id: string) => void }) {
  const theme = useTheme();
  const kind = attachmentKind(att.file.type, att.file.name);
  const label = `${att.file.name} (${formatFileSize(att.file.size)})`;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        width: TILE,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.background,
        overflow: 'hidden',
      }}
    >
      <View style={{ height: TILE - 18, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(theme.colors.muted, 0.5) }}>
        {kind === 'image' && att.previewUrl ? (
          <Image source={{ uri: att.previewUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" accessible={false} />
        ) : (
          <Icon name={kind === 'video' ? 'film' : fileIcon(att.file.type, att.file.name)} size={22} tone="muted" />
        )}
      </View>
      <Text variant="caption" numberOfLines={1} style={{ paddingHorizontal: 4, paddingVertical: 1, fontSize: theme.font(10) }}>
        {att.file.name}
      </Text>
      <RemoveButton att={att} onRemove={onRemove} />
    </View>
  );
});

/** A queued voice message: play it back before sending. */
const QueuedVoiceClip = memo(function QueuedVoiceClip({ att, onRemove }: { att: PendingAttachment; onRemove: (id: string) => void }) {
  const theme = useTheme();
  const player = useAudioPlayer(att.previewUrl ?? null);
  const status = useAudioPlayerStatus(player);
  useExclusivePlayback(player, status.playing);
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);
  const duration = status.duration > 0 ? status.duration : 0;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;
  const toggle = () => {
    if (status.playing) player.pause();
    else void playExclusive(player);
  };
  return (
    <View
      style={{
        width: 220,
        height: TILE,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingStart: 8,
        paddingEnd: 36,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.background,
      }}
    >
      <IconButton
        icon={status.playing ? 'pause' : 'play'}
        tone="primary"
        size="md"
        label={status.playing ? t('attachments.player.pause') : t('attachments.player.play')}
        onPress={toggle}
      />
      <View style={{ flex: 1, gap: 6 }} accessible accessibilityLabel={t('attachments.voice.label')}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: withAlpha(theme.colors.mutedForeground, 0.25), overflow: 'hidden' }}>
          <View style={{ width: `${progress * 100}%`, height: 4, backgroundColor: theme.colors.primary }} />
        </View>
        <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
          {formatClock((status.playing || status.currentTime > 0 ? status.currentTime : duration) * 1000)}
        </Text>
      </View>
      <RemoveButton att={att} onRemove={onRemove} />
    </View>
  );
});
