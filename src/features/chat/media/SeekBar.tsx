/**
 * A seek track for the audio and voice players (the web's createScrubber): tap or drag to
 * scrub, mirrored in RTL, with the drag claiming the gesture so it never turns into a panel
 * swipe. Screen readers adjust it in 5-second steps.
 */
import { useMemo, useRef, useState } from 'react';
import { I18nManager, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useShellGesture } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { withAlpha } from '@/ui';
import { clamp01 } from '@web/components/media/format';

export interface SeekBarProps {
  /** Played fraction, 0..1. */
  value: number;
  /** Commit a seek (fraction). */
  onSeek: (fraction: number) => void;
  /** Step by seconds (accessibility increment / decrement). */
  onStep?: (seconds: number) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  /** "0:12 / 1:03" for screen readers. */
  accessibilityValueText?: string;
  height?: number;
}

export function SeekBar({ value, onSeek, onStep, disabled, accessibilityLabel, accessibilityValueText, height = 28 }: SeekBarProps) {
  const theme = useTheme();
  const { pan: shellPan } = useShellGesture();
  const width = useRef(0);
  const [drag, setDrag] = useState<number | null>(null);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;

  const fractionAt = (x: number) => {
    const w = width.current;
    if (w <= 0) return 0;
    const f = clamp01(x / w);
    return I18nManager.isRTL ? 1 - f : f;
  };

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .enabled(!disabled)
      .activeOffsetX([-4, 4])
      .failOffsetY([-14, 14])
      .onStart((e) => setDrag(fractionAt(e.x)))
      .onUpdate((e) => setDrag(fractionAt(e.x)))
      .onEnd((e) => onSeekRef.current(fractionAt(e.x)))
      .onFinalize(() => setDrag(null));
    if (shellPan) pan.blocksExternalGesture(shellPan);
    const tap = Gesture.Tap()
      .runOnJS(true)
      .enabled(!disabled)
      .onEnd((e, success) => {
        if (success) onSeekRef.current(fractionAt(e.x));
      });
    return Gesture.Exclusive(pan, tap);
     
  }, [disabled, shellPan]);

  const shown = drag ?? clamp01(value);
  const onLayout = (e: LayoutChangeEvent) => {
    width.current = e.nativeEvent.layout.width;
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={onLayout}
        style={[styles.hit, { height }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={accessibilityValueText ? { text: accessibilityValueText } : { min: 0, max: 100, now: Math.round(shown * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (!onStep) return;
          if (e.nativeEvent.actionName === 'increment') onStep(5);
          if (e.nativeEvent.actionName === 'decrement') onStep(-5);
        }}
      >
        <View style={[styles.track, { backgroundColor: withAlpha(theme.colors.mutedForeground, 0.25) }]}>
          <View style={[styles.fill, { width: `${shown * 100}%`, backgroundColor: theme.colors.primary }]} />
        </View>
        {drag !== null ? (
          <View
            pointerEvents="none"
            style={[styles.thumb, { start: `${shown * 100}%`, backgroundColor: theme.colors.primary, borderColor: theme.colors.background }]}
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: { justifyContent: 'center', flex: 1 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0, start: 0, borderRadius: 3 },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginStart: -7, borderWidth: 2 },
});
