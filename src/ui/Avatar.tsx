/**
 * Avatar: a user's (or a space's) picture, or the first letter of their name when there is
 * none or it fails to load - the web's MessageAvatar, sized for touch.
 *
 * It takes a ready URL. Building one (CDN base, size hints, federated users' home instance)
 * is the web libs' job; don't rebuild it here. expo-image caches on disk and in memory and
 * recycles views in lists (`recyclingKey`), so a scrolled-away row doesn't flash the previous
 * face.
 *
 * Status: pass `status` for a presence dot in the corner (pure), or render
 * `<UserAvatar userId>` from UserPresence.tsx to follow the shared presence store.
 */
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { withAlpha } from './color';
import { PresenceDot, type PresenceStatus } from './PresenceDot';
import { Text } from './Text';
import { useReduceMotion } from './motion';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

export const AVATAR_SIZES: Record<AvatarSize, number> = {
  xs: 20,
  sm: 24,
  md: 32,
  lg: 40,
  xl: 64,
  xxl: 88,
};

export interface AvatarProps {
  /** Image URL, already built (by the web's avatar helpers). */
  uri?: string | null;
  /** Display name: the initial fallback and the default accessible label. */
  name: string;
  size?: AvatarSize | number;
  /** `circle` for people, `rounded` for spaces (the web's squircle). */
  shape?: 'circle' | 'rounded';
  /** Presence dot in the bottom corner. */
  status?: PresenceStatus | string | null;
  /** Surface behind the avatar, for the dot's ring. */
  ringColor?: string;
  /** Anything else for the corner (a custom dot, a voice icon); replaces `status`. */
  overlay?: ReactNode;
  /** Primary ring around the avatar (the selected "You" tab). */
  highlighted?: boolean;
  /** Announce as an image with this label; avatars are decorative by default (the name is beside them). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The letter shown when there is no picture: the first character of the name, uppercased,
 * taken by code point so an emoji or a surrogate-pair letter isn't split in half.
 */
export function avatarInitial(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim().replace(/^@/, '');
  const first = Array.from(trimmed)[0];
  return first ? first.toLocaleUpperCase() : '?';
}

export function avatarPixels(size: AvatarSize | number): number {
  return typeof size === 'number' ? size : AVATAR_SIZES[size];
}

export function Avatar({
  uri,
  name,
  size = 'lg',
  shape = 'circle',
  status,
  ringColor,
  overlay,
  highlighted,
  accessibilityLabel,
  style,
  testID,
}: AvatarProps) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const px = avatarPixels(size);
  const [failed, setFailed] = useState(false);
  // A new URL deserves a new attempt.
  useEffect(() => setFailed(false), [uri]);

  const radius = shape === 'circle' ? px / 2 : Math.round(px * 0.33);
  const showImage = !!uri && !failed;
  const dot = Math.max(8, Math.round(px * 0.3));
  const corner = overlay ?? (status ? <PresenceDot status={status} size={dot} ringColor={ringColor ?? theme.colors.background} /> : null);

  return (
    <View
      testID={testID}
      style={[{ width: px, height: px }, style]}
      {...(accessibilityLabel
        ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
        : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
    >
      <View
        style={{
          width: px,
          height: px,
          borderRadius: radius,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(theme.colors.primary, 0.2),
          borderWidth: highlighted ? 2 : 1,
          borderColor: highlighted ? theme.colors.primary : withAlpha(theme.colors.border, 0.5),
        }}
      >
        {showImage ? (
          <Image
            testID={testID ? `${testID}-image` : undefined}
            source={{ uri: uri! }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={uri!}
            transition={reduce ? 0 : 120}
            onError={() => setFailed(true)}
            accessible={false}
          />
        ) : (
          <Text
            testID={testID ? `${testID}-initial` : undefined}
            weight="semibold"
            allowFontScaling={false}
            style={{ fontSize: Math.max(9, Math.round(px * 0.4)), lineHeight: Math.max(11, Math.round(px * 0.5)) }}
          >
            {avatarInitial(name)}
          </Text>
        )}
      </View>
      {corner ? (
        <View pointerEvents="none" style={{ position: 'absolute', right: -2, bottom: -2 }}>
          {corner}
        </View>
      ) : null}
    </View>
  );
}
