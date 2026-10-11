/**
 * The top of a profile: the banner (the person's image, or the brand tint the web draws when
 * there is none) with the action buttons over it, and the avatar with its presence dot
 * overlapping the banner's lower edge. Shared by the profile sheet and the full profile.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Touchable, UserAvatar, withAlpha } from '@/ui';

export interface ProfileArtProps {
  userId: string;
  displayName: string;
  avatar?: string;
  banner?: string;
  bannerHeight: number;
  avatarSize: number;
  /** Buttons over the banner's top end. */
  actions?: ReactNode;
  /** The avatar opens the full profile (the sheet). */
  onAvatarPress?: () => void;
  /** Rounded top corners (inside a sheet). */
  rounded?: boolean;
}

export function ProfileArt({ userId, displayName, avatar, banner, bannerHeight, avatarSize, actions, onAvatarPress, rounded }: ProfileArtProps) {
  const theme = useTheme();
  const c = theme.colors;
  const radius = rounded ? theme.radii.xl : 0;
  const avatarNode = (
    <UserAvatar
      userId={userId}
      uri={avatar}
      name={displayName}
      size={avatarSize}
      ringColor={c.card}
      accessibilityLabel={displayName}
    />
  );
  return (
    <View>
      <View
        style={{
          height: bannerHeight,
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
          overflow: 'hidden',
          backgroundColor: withAlpha(c.primary, 0.35),
        }}
      >
        {banner ? (
          <Image source={{ uri: banner }} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ flex: 1, backgroundColor: withAlpha(c.primary, 0.2) }} />
        )}
        {actions ? (
          <View style={{ position: 'absolute', top: 10, end: 10, flexDirection: 'row', gap: 8 }}>{actions}</View>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 16, marginTop: -avatarSize / 2, flexDirection: 'row' }}>
        <View style={{ borderRadius: avatarSize, borderWidth: 4, borderColor: c.card, backgroundColor: c.card }}>
          {onAvatarPress ? (
            <Touchable onPress={onAvatarPress} accessibilityRole="button" accessibilityLabel={t('profile.viewFull')} feedback="opacity">
              {avatarNode}
            </Touchable>
          ) : (
            avatarNode
          )}
        </View>
      </View>
    </View>
  );
}
