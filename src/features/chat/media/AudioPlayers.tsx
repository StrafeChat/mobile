/**
 * The two audio shapes of the web: the attached-file AudioPlayer card (name, speed, mute,
 * seek, time, size, download) and the compact VoiceMessagePlayer (play, seek, time, size -
 * no name, speed or volume: those belong to a file someone attached on purpose).
 *
 * The web draws a 72-bar waveform decoded in the browser (OfflineAudioContext); nothing on the
 * device decodes arbitrary audio offline, so both show the web's own fallback, a plain
 * progress track - still the seek surface.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { formatMediaTime, formatRate } from '@web/components/media/format';
import { formatFileSize } from '@web/lib/attachments/format';
import { useTheme } from '@/theme';
import { Icon, IconButton, Spinner, Text, Touchable, withAlpha } from '@/ui';
import { SeekBar } from './SeekBar';
import { useMessageAudio, type MessageAudio } from './useMessageAudio';

interface PlayerProps {
  /** null while resolving (decrypting / re-typing). */
  uri: string | null;
  size: number;
  filename: string;
  /** Share / save; hidden while uploading. */
  onShare?: () => void;
  /** Upload progress bar slot. */
  children?: ReactNode;
}

function PlayButton({ audio, size, disabled }: { audio: MessageAudio; size: number; disabled: boolean }) {
  const theme = useTheme();
  const busy = audio.status.playing && audio.status.isBuffering;
  const label = audio.status.playing ? t('attachments.player.pause') : t('attachments.player.play');
  return (
    <Touchable
      feedback="opacity"
      onPress={audio.toggle}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.play,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.primary, opacity: disabled ? 0.6 : 1 },
      ]}
    >
      {busy || disabled ? (
        <Spinner size="small" color={theme.colors.primaryForeground} decorative />
      ) : (
        <Icon
          name={audio.status.playing ? 'pause' : audio.ended ? 'rotate-left' : 'play'}
          color={theme.colors.primaryForeground}
          size={15}
          style={!audio.status.playing && !audio.ended ? styles.nudge : undefined}
        />
      )}
    </Touchable>
  );
}

function timeText(audio: MessageAudio): string {
  return `${formatMediaTime(audio.status.currentTime)} / ${formatMediaTime(audio.status.duration)}`;
}

function Seek({ audio, label }: { audio: MessageAudio; label: string }) {
  const d = audio.status.duration;
  return (
    <SeekBar
      value={d > 0 ? audio.status.currentTime / d : 0}
      onSeek={audio.seekFraction}
      onStep={audio.step}
      disabled={!(d > 0)}
      accessibilityLabel={label}
      accessibilityValueText={timeText(audio)}
    />
  );
}

/** An attached audio file. */
export function AudioPlayer({ uri, size, filename, onShare, children }: PlayerProps) {
  const theme = useTheme();
  const audio = useMessageAudio(uri);
  const failed = !!audio.status.error;
  return (
    <View style={[styles.card, { borderColor: withAlpha(theme.colors.border, 0.8), backgroundColor: withAlpha(theme.colors.card, 0.4), borderRadius: theme.radii.lg }]}>
      <View style={styles.row}>
        <PlayButton audio={audio} size={44} disabled={!uri || failed} />
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1}>
            {filename}
          </Text>
          <Text variant="caption">{formatFileSize(size)}</Text>
        </View>
        <Touchable
          onPress={audio.cycleRate}
          accessibilityRole="button"
          accessibilityLabel={`${t('attachments.player.speed')}: ${formatRate(audio.rate)}`}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          style={[styles.rate, { borderColor: theme.colors.border, borderRadius: theme.radii.sm }]}
        >
          <Text variant="caption" weight="semibold">
            {formatRate(audio.rate)}
          </Text>
        </Touchable>
        <IconButton
          icon={audio.muted ? 'volume-xmark' : 'volume-high'}
          label={audio.muted ? t('attachments.player.unmute') : t('attachments.player.mute')}
          size="sm"
          tone="subtle"
          onPress={audio.toggleMute}
        />
        {onShare ? <IconButton icon="download" label={t('attachments.downloadNamed', { name: filename })} size="sm" tone="subtle" onPress={onShare} /> : null}
      </View>
      {failed ? (
        <Text variant="caption" tone="danger" style={styles.error}>
          {t('mobile.chat.audioUnplayable')}
        </Text>
      ) : (
        <View style={styles.seekRow}>
          <Seek audio={audio} label={t('attachments.player.seek')} />
          <Text variant="caption" style={styles.time}>
            {timeText(audio)}
          </Text>
        </View>
      )}
      {children}
    </View>
  );
}

/** A recorded voice message. */
export function VoiceMessagePlayer({ uri, size, filename, onShare, children }: PlayerProps) {
  const theme = useTheme();
  const audio = useMessageAudio(uri);
  const failed = !!audio.status.error;
  return (
    <View
      style={[styles.card, styles.voice, { borderColor: withAlpha(theme.colors.border, 0.8), backgroundColor: withAlpha(theme.colors.card, 0.4), borderRadius: theme.radii.lg }]}
      accessibilityLabel={t('attachments.voice.label')}
    >
      <View style={styles.row}>
        <PlayButton audio={audio} size={40} disabled={!uri || failed} />
        <View style={styles.flex}>
          {failed ? (
            <Text variant="caption" tone="danger">
              {t('mobile.chat.audioUnplayable')}
            </Text>
          ) : (
            <Seek audio={audio} label={t('attachments.voice.seek')} />
          )}
          <View style={styles.meta}>
            <Text variant="caption" style={styles.mono}>
              {timeText(audio)}
            </Text>
            <Text variant="caption">{formatFileSize(size)}</Text>
          </View>
        </View>
        {onShare ? <IconButton icon="download" label={t('attachments.downloadNamed', { name: filename })} size="sm" tone="subtle" onPress={onShare} /> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 10, overflow: 'hidden', maxWidth: 448, width: '100%' },
  voice: { maxWidth: 384 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  play: { alignItems: 'center', justifyContent: 'center' },
  nudge: { marginStart: 2 },
  rate: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, paddingVertical: 2 },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  time: { fontVariant: ['tabular-nums'] },
  mono: { fontVariant: ['tabular-nums'] },
  meta: { flexDirection: 'row', justifyContent: 'space-between' },
  error: { marginTop: 6 },
});
