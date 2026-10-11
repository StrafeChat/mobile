/**
 * The two pulses the web draws with Tailwind's animate-pulse / animate-ping: the dot beside
 * "Ringing …" and the rings behind a caller's avatar. Still under reduced motion.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from '@/ui';

function useLoop(duration: number, enabled: boolean): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) {
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(value, { toValue: 1, duration, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration, enabled]);
  return value;
}

export function PulseDot({ color, size = 8 }: { color: string; size?: number }) {
  const reduce = useReduceMotion();
  const v = useLoop(1400, !reduce);
  const opacity = reduce ? 1 : v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.35, 1] });
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }} />;
}

/** Expanding rings behind `children` (an avatar), the web's animate-ping. */
export function PulseRings({ color, size, children, style }: { color: string; size: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useLoop(1600, !reduce);
  const ring = (offset: number) => {
    if (reduce) return null;
    // Two rings half a cycle apart, so one is always on its way out.
    const p = offset ? Animated.modulo(Animated.add(v, offset), 1) : v;
    const scale = p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
    const opacity = p.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
    return (
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity, transform: [{ scale }] }}
      />
    );
  };
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {ring(0)}
      {ring(0.5)}
      {children}
    </View>
  );
}
