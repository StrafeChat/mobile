/**
 * The composer while a voice message records, in the text field's place (the web's
 * VoiceRecordingBar): a pulsing red dot, the elapsed time (with the time left in red during the
 * last 30 s of the 5 minute cap), and a live waveform that fills left to right and then slides
 * to the most recent input.
 *
 * Held (finger still on the microphone): a "slide to cancel" hint that fades as you slide.
 * Locked (slid up, or started from a screen reader): a discard button; the composer's send
 * button finishes the take.
 */
import { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Icon, IconButton, Text, useReduceMotion, withAlpha } from '@/ui';
import { VOICE_MESSAGE_MAX_MS } from '@/platform/media';
import { formatClock, CANCEL_DISTANCE } from '../logic/recordGesture';
import { WAVEFORM_SLOTS, type VoiceRecorderState } from '../hooks/useVoiceRecorder';

export interface RecordingBarProps {
  state: VoiceRecorderState;
  /** Horizontal drag of the held press (dp), for the slide-to-cancel hint. */
  dragX: SharedValue<number>;
  rtl: boolean;
  onCancel: () => void;
}

/** Bars drawn on a phone; the web draws 72 across a desktop composer. */
const BARS = 40;
/** The short live meter beside the slide-to-cancel hint while the microphone is held. */
const HELD_BARS = 12;

/** Slots that fill left to right with the latest levels, then slide (the web's waveform). */
function Waveform({ levels, bars, style }: { levels: readonly number[]; bars: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const shown = levels.slice(-bars);
  return (
    <View style={[{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 2 }, style]} accessible={false}>
      {Array.from({ length: bars }, (_, i) => {
        const level = shown[i];
        const on = level !== undefined;
        return (
          <View
            key={i}
            style={{
              flex: 1,
              borderRadius: 1,
              height: on ? `${Math.max(14, Math.round(level * 100))}%` : '20%',
              backgroundColor: on ? theme.colors.destructive : withAlpha(theme.colors.mutedForeground, 0.2),
            }}
          />
        );
      })}
    </View>
  );
}

export function RecordingBar({ state, dragX, rtl, onCancel }: RecordingBarProps) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 1;
      return undefined;
    }
    pulse.value = withRepeat(withTiming(0.25, { duration: 700 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const hintStyle = useAnimatedStyle(() => {
    const towards = rtl ? dragX.value : -dragX.value;
    const p = Math.max(0, Math.min(1, towards / CANCEL_DISTANCE));
    return { opacity: 1 - p * 0.8, transform: [{ translateX: rtl ? Math.max(0, dragX.value) * 0.5 : Math.min(0, dragX.value) * 0.5 }] };
  });

  const recent = state.levels.slice(-WAVEFORM_SLOTS);
  const remainingMs = Math.max(0, VOICE_MESSAGE_MAX_MS - state.elapsedMs);
  const nearCap = remainingMs <= 30_000;
  const starting = state.phase === 'starting';

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${t('attachments.voice.recording')} ${formatClock(state.elapsedMs)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 8 }}
      testID="composer-recording"
    >
      {state.locked ? (
        <IconButton icon="trash" tone="danger" label={t('attachments.voice.cancel')} onPress={onCancel} testID="recording-cancel" />
      ) : (
        <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.destructive, marginStart: 6 }, dotStyle]} />
      )}
      <Text variant="label" style={{ fontVariant: ['tabular-nums'], minWidth: 38 }}>
        {formatClock(state.elapsedMs)}
      </Text>
      {nearCap && !starting ? (
        <Text variant="caption" tone="danger" style={{ fontVariant: ['tabular-nums'] }}>
          ({formatClock(remainingMs)})
        </Text>
      ) : null}
      {state.locked ? (
        <Waveform levels={recent} bars={BARS} style={{ flex: 1 }} />
      ) : (
        <>
        <Waveform levels={recent} bars={HELD_BARS} style={{ width: HELD_BARS * 4 }} />
        <Animated.View style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, hintStyle]}>
          <Icon name={rtl ? 'chevron-right' : 'chevron-left'} size={12} tone="muted" />
          <Text variant="caption" numberOfLines={1}>
            {t('mobile.composer.slideToCancel')}
          </Text>
        </Animated.View>
        </>
      )}
    </View>
  );
}

/** The lock target that floats above a held microphone. */
export function LockHint({ dragY }: { dragY: SharedValue<number> }) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, dragY.value) * 0.4 }] }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLabel={t('mobile.composer.slideUpToLock')}
      style={[
        {
          position: 'absolute',
          bottom: 56,
          end: 6,
          width: 36,
          paddingVertical: 8,
          borderRadius: 18,
          alignItems: 'center',
          gap: 4,
          backgroundColor: theme.colors.popover,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      <Icon name="lock" size={13} tone="muted" />
      <Icon name="chevron-up" size={10} tone="muted" />
    </Animated.View>
  );
}
