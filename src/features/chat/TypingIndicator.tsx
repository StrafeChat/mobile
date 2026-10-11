/**
 * The "X is typing…" row (the web's TypingIndicator): up to three overlapping faces (the
 * first on top) and a "+N" chip, three bouncing dots, and the sentence ("X and Y are
 * typing…", "Several people are typing…" from four). Its height is always reserved, so the
 * composer does not jump each time someone starts or stops. Announced politely.
 */
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { TYPING_MAX_FACES, TYPING_MAX_NAMED, typingLabel, useTypingPeople } from '@/data';
import { useTheme } from '@/theme';
import { Avatar, Text } from '@/ui';

const FACE = 18;
export const TYPING_ROW_HEIGHT = 24;

function Dot({ delay }: { delay: number }) {
  const theme = useTheme();
  const y = useSharedValue(0);
  useEffect(() => {
    if (theme.reduceMotion) {
      cancelAnimation(y);
      y.value = 0;
      return undefined;
    }
    y.value = withDelay(delay, withRepeat(withSequence(withTiming(-3, { duration: 300 }), withTiming(0, { duration: 300 })), -1, false));
    return () => cancelAnimation(y);
  }, [delay, theme.reduceMotion, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[styles.dot, { backgroundColor: theme.colors.mutedForeground }, style]} />;
}

export const TypingIndicator = memo(function TypingIndicator({ roomId }: { roomId: string }) {
  const theme = useTheme();
  const people = useTypingPeople(roomId);
  const faces = people.slice(0, TYPING_MAX_FACES);
  const overflow = Math.max(0, people.length - TYPING_MAX_FACES);
  const label = typingLabel(people.slice(0, TYPING_MAX_NAMED + 1));
  return (
    <View style={styles.row} accessibilityLiveRegion="polite" accessible={people.length > 0} accessibilityLabel={label || undefined}>
      {people.length > 0 ? (
        <>
          <View style={styles.faces} importantForAccessibility="no-hide-descendants">
            {faces.map((p, i) => (
              <View
                key={p.id}
                style={[
                  styles.face,
                  { zIndex: TYPING_MAX_FACES + 1 - i, borderColor: theme.colors.background, marginStart: i > 0 ? -6 : 0 },
                ]}
              >
                <Avatar uri={p.avatar ?? null} name={p.name} size={FACE} />
              </View>
            ))}
            {overflow > 0 ? (
              <View style={[styles.face, styles.more, { zIndex: 0, borderColor: theme.colors.background, backgroundColor: theme.colors.muted }]}>
                <Text variant="caption" weight="semibold" style={styles.moreText} maxFontSizeMultiplier={1.2}>
                  +{overflow}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.dots} importantForAccessibility="no-hide-descendants">
            <Dot delay={0} />
            <Dot delay={150} />
            <Dot delay={300} />
          </View>
          <Text variant="caption" numberOfLines={1} style={styles.text}>
            {label}
          </Text>
        </>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { height: TYPING_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 8 },
  faces: { flexDirection: 'row', alignItems: 'center' },
  face: { borderWidth: 2, borderRadius: (FACE + 4) / 2 },
  more: { width: FACE + 4, height: FACE + 4, marginStart: -6, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 8, lineHeight: 10 },
  dots: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2 },
  text: { flexShrink: 1 },
});
