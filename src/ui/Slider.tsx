/**
 * Slider: a range control on react-native-gesture-handler + Reanimated, so the thumb follows
 * the finger on the UI thread - the web's RangeField (label, value text beside it).
 *
 * - Drag the thumb or tap anywhere on the track. `onValueChange` fires as the stepped value
 *   changes (with a selection tick per step when `step` is coarse); `onSlidingComplete` once
 *   on release - persist there (volume, font size) rather than on every step.
 * - Horizontal drags are claimed from the shell's swipe and vertical ones are left to the
 *   scroll view or sheet around it.
 * - Screen readers get an adjustable control: swipe up/down steps it, the value is read out
 *   (as `valueLabel` when given, "80%").
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type AccessibilityActionEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useShellGesture } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { FieldLabel } from './Input';
import { haptics } from './haptics';
import { Text } from './Text';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
  disabled?: boolean;
  label?: string;
  /** Shown at the end of the label row and read by screen readers ("80%"). */
  valueLabel?: string;
  /** Accessible name when there is no visible label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const THUMB = 22;
const TRACK = 6;

/** Snap `v` to `step` within [min, max]. */
export function snapToStep(v: number, min: number, max: number, step: number): number {
  if (max <= min) return min;
  const clamped = Math.min(max, Math.max(min, v));
  if (!(step > 0)) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  // Round off float noise (0.1 + 0.2) to the step's precision.
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(decimals))));
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  onSlidingComplete,
  disabled,
  label,
  valueLabel,
  accessibilityLabel,
  style,
  testID,
}: SliderProps) {
  const theme = useTheme();
  const { pan: shellPan } = useShellGesture();
  const [width, setWidth] = useState(0);
  const range = Math.max(1e-9, max - min);
  const progress = useSharedValue((Math.min(max, Math.max(min, value)) - min) / range);
  const dragging = useSharedValue(0);
  const last = useRef(value);
  const cb = useRef({ onValueChange, onSlidingComplete });
  cb.current = { onValueChange, onSlidingComplete };
  // Coarse steps (a 5-position scale) tick; fine ones (0-200 %) would buzz continuously.
  const tick = range / step <= 20;

  // Outside a drag, follow the prop.
  useEffect(() => {
    last.current = value;
    if (!dragging.value) progress.value = (Math.min(max, Math.max(min, value)) - min) / range;
  }, [value, min, max, range, progress, dragging]);

  const commitFromJS = useMemo(
    () => ({
      change(p: number) {
        const v = snapToStep(min + p * range, min, max, step);
        if (v === last.current) return;
        last.current = v;
        if (tick) haptics.selection();
        cb.current.onValueChange(v);
      },
      end(p: number) {
        const v = snapToStep(min + p * range, min, max, step);
        cb.current.onSlidingComplete?.(v);
      },
    }),
    [min, max, range, step, tick],
  );

  const usable = Math.max(1, width - THUMB);
  const gesture = useMemo(() => {
    // Plain function references for runOnJS (not methods reached through a captured object).
    const change = commitFromJS.change;
    const end = commitFromJS.end;
    const toProgress = (x: number) => {
      'worklet';
      return Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
    };
    // onStart, not onBegin: a touch that turns into a vertical scroll must not move the value.
    const pan = Gesture.Pan()
      .enabled(!disabled)
      .activeOffsetX([-4, 4])
      .failOffsetY([-12, 12])
      .onStart((e) => {
        dragging.value = 1;
        progress.value = toProgress(e.x);
        runOnJS(change)(progress.value);
      })
      .onUpdate((e) => {
        progress.value = toProgress(e.x);
        runOnJS(change)(progress.value);
      })
      .onFinalize((_e, success) => {
        dragging.value = 0;
        if (success) runOnJS(end)(progress.value);
      });
    const tap = Gesture.Tap()
      .enabled(!disabled)
      .onEnd((e, success) => {
        if (!success) return;
        progress.value = toProgress(e.x);
        runOnJS(change)(progress.value);
        runOnJS(end)(progress.value);
      });
    if (shellPan) pan.blocksExternalGesture(shellPan);
    return Gesture.Exclusive(pan, tap);
  }, [disabled, usable, commitFromJS, shellPan, dragging, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: THUMB / 2 + progress.value * usable }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * usable }] }));

  const onA11yAction = (e: AccessibilityActionEvent) => {
    const dir = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
    if (!dir || disabled) return;
    const next = snapToStep(value + dir * step, min, max, step);
    if (next === value) return;
    onValueChange(next);
    onSlidingComplete?.(next);
  };

  return (
    <View style={[{ gap: 6, alignSelf: 'stretch', opacity: disabled ? 0.5 : 1 }, style]}>
      {label || valueLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {label ? <FieldLabel label={label} /> : <View />}
          {valueLabel ? (
            <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }} accessibilityElementsHidden importantForAccessibility="no">
              {valueLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <View
          testID={testID}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityValue={{ min, max, now: value, ...(valueLabel ? { text: valueLabel } : null) }}
          accessibilityState={{ disabled: !!disabled }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onA11yAction}
          // Left-to-right in every locale: the gesture maths and the fill are measured from the left.
          style={{ height: 44, justifyContent: 'center', direction: 'ltr' }}
        >
          <View style={{ height: TRACK, borderRadius: TRACK / 2, backgroundColor: theme.colors.muted, marginHorizontal: THUMB / 2 - TRACK / 2 }} />
          <Animated.View
            style={[{ position: 'absolute', left: THUMB / 2 - TRACK / 2, height: TRACK, borderRadius: TRACK / 2, backgroundColor: theme.colors.primary }, fillStyle]}
          />
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: 0,
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB / 2,
                backgroundColor: theme.colors.primary,
                borderWidth: 3,
                borderColor: theme.dark ? theme.colors.foreground : theme.colors.card,
                shadowColor: '#000',
                shadowOpacity: 0.25,
                shadowRadius: 3,
                shadowOffset: { width: 0, height: 1 },
                elevation: 3,
              },
              thumbStyle,
            ]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}
