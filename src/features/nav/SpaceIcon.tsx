/**
 * A space's picture: its icon in a squircle, or two letters of its acronym/name on the brand
 * tint (SpaceBar's SpaceIcon, the header's chip, the invite and Discover cards). Spaces are
 * squircles everywhere - never circles, which mean people.
 */
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { Text, withAlpha } from '@/ui';

export interface SpaceIconProps {
  name: string;
  /** Two-letter fallback (spaceInitials). */
  initials: string;
  icon?: string | null;
  size?: number;
  /** Corner radius; defaults to a third of the size (the rail animates 24 -> 16 when active). */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function SpaceIcon({ name, initials, icon, size = 48, radius, style }: SpaceIconProps) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  const showImage = !!icon && !failed;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius ?? Math.round(size / 3),
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(theme.colors.primary, 0.3),
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: icon! }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          recyclingKey={icon!}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text
          weight="semibold"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontSize: theme.font(Math.max(11, Math.round(size * 0.3))), maxWidth: size - 6 }}
          accessibilityLabel={name}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}
