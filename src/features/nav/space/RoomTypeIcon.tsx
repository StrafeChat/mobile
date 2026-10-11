/**
 * A room's type glyph (the web's roomTypeIcon): # for text, a speaker for voice, with a small
 * lock on the corner - in the brand colour for an end-to-end encrypted room, muted for a
 * private one (@everyone cannot view it). Encryption wins the colour when both apply.
 */
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from '@/ui';

export function RoomTypeIcon({
  voice,
  e2ee,
  isPrivate,
  color,
  size = 16,
}: {
  voice: boolean;
  e2ee: boolean;
  isPrivate: boolean;
  color?: string;
  size?: number;
}) {
  const theme = useTheme();
  const lock = e2ee || isPrivate;
  return (
    <View style={[styles.box, { width: size + 6, height: size + 4 }]}>
      <Icon name={voice ? 'fa-volume-high' : 'fa-hashtag'} size={size} color={color ?? theme.colors.mutedForeground} />
      {lock ? (
        <View style={[styles.lock, { backgroundColor: theme.colors.card, borderRadius: 6 }]}>
          <Icon name="fa-lock" size={Math.round(size * 0.55)} color={e2ee ? theme.colors.primary : theme.colors.mutedForeground} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  lock: { position: 'absolute', end: -2, bottom: -2, padding: 1 },
});
