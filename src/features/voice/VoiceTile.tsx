/**
 * One tile on the call stage (the web's VoiceTile): the participant's camera or shared screen
 * through the platform's VoiceVideo, or their avatar until a track exists; the name chip; the
 * priority / streaming / muted / deafened badges (red when a moderator imposed them); a
 * spinner until LiveKit confirms them; and the speaking ring.
 *
 * Tap spotlights the tile (tap again to return to the grid); long-press opens the per-user
 * voice sheet. Your own screen share is not drawn back to you - a phone sharing its screen
 * would show an endless mirror - but a "you are sharing" card with Stop.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { setScreenShareEnabled } from '@web/stores/voice';
import { useIsSpeaking } from '@/data/voice';
import { switchCamera, VoiceVideo } from '@/platform/voice';
import { useTheme } from '@/theme';
import { Avatar, Button, Icon, IconButton, Spinner, Text, Touchable, onScrim, useLongPress, withAlpha } from '@/ui';
import { useCallSettings, useMediaSid } from './hooks';
import type { CallTile } from './model';
import { openVoiceUserSheet } from './sheets';

/** Video and empty tiles sit on a dark scrim whatever the theme (the web's bg-black/55). */
const TILE_SCRIM = 'rgba(0,0,0,0.55)';
const CHIP_SCRIM = 'rgba(0,0,0,0.6)';

export interface VoiceTileProps {
  tile: CallTile;
  roomId: string;
  spaceId?: string | null;
  width: number;
  height: number;
  /** Spotlighted (fills the stage). */
  focused?: boolean;
  /** In the strip under a spotlight. */
  compact?: boolean;
  onPress?: () => void;
}

function avatarSize(width: number, height: number, compact?: boolean, focused?: boolean): number {
  const want = compact ? 44 : focused ? 128 : 80;
  return Math.max(24, Math.min(want, Math.floor(Math.min(width, height) * 0.5)));
}

export const VoiceTile = memo(function VoiceTile({ tile, roomId, spaceId, width, height, focused, compact, onPress }: VoiceTileProps) {
  const theme = useTheme();
  const settings = useCallSettings();
  const speakingNow = useIsSpeaking(tile.userId);
  const speaking = tile.kind === 'user' && speakingNow;
  const sid = useMediaSid(tile.userId, tile.kind);
  const ownScreen = tile.kind === 'screen' && tile.isLocal;
  const showVideo = !!sid && !ownScreen;
  const mirrored = tile.kind === 'user' && tile.isLocal && settings.mirrorCamera && settings.facing === 'user';
  const muted = tile.selfMute || tile.serverMute;
  const deafened = tile.selfDeaf || tile.serverDeaf;
  const chipText = onScrim(theme);
  const longPress = useLongPress(() => openVoiceUserSheet({ userId: tile.userId, roomId, spaceId: spaceId ?? null }));

  const statusParts = [
    tile.isLocal ? t('voice.you') : null,
    speaking ? t('mobile.voice.speaking') : null,
    tile.priority ? t('voice.status.priority') : null,
    tile.streaming && tile.kind === 'user' ? t('voice.status.streaming') : null,
    muted && tile.kind === 'user' ? t(tile.serverMute ? 'voice.status.serverMuted' : 'voice.status.muted') : null,
    deafened && tile.kind === 'user' ? t(tile.serverDeaf ? 'voice.status.serverDeafened' : 'voice.status.deafened') : null,
    !tile.connected ? t('voice.connecting') : null,
  ].filter(Boolean);
  const title = tile.kind === 'screen' ? t('voice.screenOf', { name: tile.name }) : tile.name;
  const label = [title, ...statusParts].join(', ');

  const ringColor = speaking ? theme.colors.success : focused ? withAlpha(theme.colors.primary, 0.6) : 'transparent';
  const avatarPx = avatarSize(width, height, compact, focused);
  const badgeBox = compact ? 20 : 24;

  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      {...longPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={onPress ? t('mobile.voice.tileHint') : undefined}
      accessibilityState={{ selected: !!focused }}
      testID={`voice-tile-${tile.key}`}
      style={{
        width,
        height,
        borderRadius: theme.radii.lg,
        overflow: 'hidden',
        backgroundColor: TILE_SCRIM,
        borderWidth: 2,
        borderColor: ringColor,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {ownScreen ? (
        <View style={{ alignItems: 'center', gap: 8, padding: 12 }}>
          <Icon name="display" size={compact ? 18 : 28} color={chipText} />
          {!compact ? (
            <>
              <Text variant="label" color={chipText} align="center">
                {t('mobile.voice.sharingScreen')}
              </Text>
              <Button title={t('voice.stopSharing')} variant="danger" size="sm" icon="display" onPress={() => void setScreenShareEnabled(false)} />
            </>
          ) : null}
        </View>
      ) : tile.kind === 'screen' && !sid ? (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="display" size={compact ? 18 : 26} color={withAlpha(chipText, 0.7)} />
          {!compact ? (
            <Text variant="caption" color={withAlpha(chipText, 0.8)}>
              {t('voice.streamLoading')}
            </Text>
          ) : null}
        </View>
      ) : (
        <Avatar uri={tile.avatar} name={tile.name} size={avatarPx} />
      )}

      {showVideo ? (
        <VoiceVideo
          sid={sid}
          mirror={mirrored}
          objectFit={tile.kind === 'screen' ? 'contain' : 'cover'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {/* Name chip */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          start: 6,
          bottom: 6,
          maxWidth: Math.max(40, width - (compact ? 12 : 120)),
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          borderRadius: theme.radii.sm,
          backgroundColor: CHIP_SCRIM,
          paddingHorizontal: 6,
          paddingVertical: 3,
        }}
      >
        {tile.kind === 'screen' ? <Icon name="display" size={10} color={chipText} /> : null}
        <Text variant="caption" color={chipText} weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
          {title}
        </Text>
        {tile.isLocal && tile.kind === 'user' && !compact ? (
          <Text variant="caption" color={withAlpha(chipText, 0.6)}>
            · {t('voice.you')}
          </Text>
        ) : null}
      </View>

      {/* Status badges */}
      {tile.kind === 'user' && (muted || deafened || tile.streaming || tile.priority) ? (
        <View pointerEvents="none" style={{ position: 'absolute', end: 6, bottom: 6, flexDirection: 'row', gap: 4 }}>
          {tile.priority ? <Badge box={badgeBox} icon="bullhorn" color={theme.colors.warning} /> : null}
          {tile.streaming ? <Badge box={badgeBox} icon="display" color={chipText} /> : null}
          {muted ? <Badge box={badgeBox} icon="microphone-slash" color={tile.serverMute ? theme.colors.dnd : chipText} /> : null}
          {deafened ? <Badge box={badgeBox} icon="volume-xmark" color={tile.serverDeaf ? theme.colors.dnd : chipText} /> : null}
        </View>
      ) : null}

      {tile.kind === 'user' && !tile.connected ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            end: 6,
            top: 6,
            width: badgeBox,
            height: badgeBox,
            borderRadius: theme.radii.sm,
            backgroundColor: CHIP_SCRIM,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spinner decorative color={chipText} />
        </View>
      ) : null}

      {/* Your own camera: flip it where you are looking at it. */}
      {tile.kind === 'user' && tile.isLocal && showVideo && !compact ? (
        <IconButton
          icon="camera-rotate"
          label={t('mobile.voice.flipCamera')}
          tone="overlay"
          size="md"
          onPress={() => void switchCamera()}
          style={{ position: 'absolute', end: 8, top: 8 }}
        />
      ) : null}
    </Touchable>
  );
});

function Badge({ box, icon, color }: { box: number; icon: string; color: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: box,
        height: box,
        borderRadius: theme.radii.sm,
        backgroundColor: CHIP_SCRIM,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={Math.round(box * 0.46)} color={color} />
    </View>
  );
}
