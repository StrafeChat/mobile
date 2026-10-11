/**
 * The inline video player (attachments, video links, link-preview videos).
 *
 * Click to load: until the play button is pressed it is a poster (or a dark frame) of the
 * clip's size - no native player, no request - so a screen of videos costs nothing and a long
 * history doesn't hold a decoder per row. Pressing play mounts expo-video with the platform's
 * own controls (scrubbing, fullscreen, picture in picture, AirPlay / Cast) and starts it,
 * pausing anything else playing (stores/mediaPlayback through @/platform/media) at the
 * remembered volume.
 *
 * Errors (a link that is really a web page, a codec the device lacks) show the web's
 * "can't be played" notice, and are reported to the caller (an inline link falls back to a
 * preview card or plain link).
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { t } from '@web/i18n/t';
import { preferredVolume, rememberVolume } from '@web/stores/mediaPlayback';
import { playExclusive, useExclusivePlayback } from '@/platform/media';
import { useTheme } from '@/theme';
import { Icon, onScrim, Text, Touchable } from '@/ui';
import { videoBox } from '../layout';

export interface VideoPlayerProps {
  /** null while the source is still resolving (an encrypted clip decrypting). */
  uri: string | null;
  filename: string;
  width?: number;
  height?: number;
  maxWidth: number;
  poster?: string;
  onReady?: () => void;
  onError?: () => void;
  /** Long-press on the frame (save / share). */
  onLongPress?: () => void;
}

export function VideoPlayer({ uri, filename, width, height, maxWidth, poster, onReady, onError, onLongPress }: VideoPlayerProps) {
  const theme = useTheme();
  const box = videoBox(width, height, maxWidth);
  const [armed, setArmed] = useState(false);
  const [failed, setFailed] = useState(false);

  // A different clip in a recycled row starts unloaded again.
  const last = useRef(uri);
  if (last.current !== uri) {
    last.current = uri;
    if (armed) setArmed(false);
    if (failed) setFailed(false);
  }

  const frame = [styles.frame, { width: box.width, height: box.height, borderRadius: theme.radii.md }];

  if (failed) {
    return (
      <View style={[frame, styles.center, { backgroundColor: theme.colors.muted }]}>
        <Icon name="triangle-exclamation" tone="muted" size={18} />
        <Text variant="caption" align="center" style={styles.errorText}>
          {t('mobile.chat.videoUnplayable')}
        </Text>
      </View>
    );
  }

  if (!armed || !uri) {
    return (
      <Touchable
        feedback="opacity"
        disabled={!uri}
        onPress={() => setArmed(true)}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={`${t('attachments.player.play')} · ${filename}`}
        style={[frame, styles.center, styles.dark]}
      >
        {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={poster} /> : null}
        <View style={styles.playBadge}>
          <Icon name={uri ? 'play' : 'circle-notch'} spin={!uri} size={22} color={onScrim(theme)} style={uri ? styles.playNudge : undefined} />
        </View>
      </Touchable>
    );
  }

  return (
    <View style={[frame, styles.dark]}>
      <ArmedVideo
        uri={uri}
        onReady={onReady}
        onError={() => {
          setFailed(true);
          onError?.();
        }}
      />
    </View>
  );
}

function ArmedVideo({ uri, onReady, onError }: { uri: string; onReady?: () => void; onError: () => void }) {
  const player = useVideoPlayer({ uri }, (p) => {
    const pref = preferredVolume();
    p.volume = pref.volume;
    p.muted = pref.muted;
    p.loop = false;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  useExclusivePlayback(player, isPlaying);

  const started = useRef(false);
  useEffect(() => {
    if (status === 'readyToPlay') {
      onReady?.();
      if (!started.current) {
        started.current = true;
        playExclusive(player).catch(() => undefined);
      }
    }
    if (status === 'error') onError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const sub = player.addListener('volumeChange', (e) => rememberVolume(e.volume, player.muted));
    const sub2 = player.addListener('mutedChange', (e) => rememberVolume(player.volume, e.muted));
    return () => {
      sub.remove();
      sub2.remove();
    };
  }, [player]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      nativeControls
      contentFit="contain"
      allowsPictureInPicture
      fullscreenOptions={{ enable: true }}
    />
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', maxWidth: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  dark: { backgroundColor: '#000' },
  playBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playNudge: { marginStart: 3 },
  errorText: { marginTop: 6, paddingHorizontal: 12 },
});
