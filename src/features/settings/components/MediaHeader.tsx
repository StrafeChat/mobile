/**
 * Banner + avatar editor (the web's profile media card): the banner across the top (the
 * picture, or a brand gradient-like tint without one), the round avatar overlapping it, each a
 * button that opens the image picker. There is no hover on a phone, so the "change" affordance
 * is a small camera badge that is always visible, and uploads dim the target with a spinner.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Avatar, Icon, Spinner, Text, Touchable, onScrim, withAlpha } from '@/ui';

export interface MediaHeaderProps {
  name: string;
  avatarUri?: string | null;
  bannerUri?: string | null;
  onPickAvatar?: () => void;
  onPickBanner?: () => void;
  avatarBusy?: boolean;
  bannerBusy?: boolean;
  /** Corner node on the avatar (a presence dot). */
  avatarOverlay?: ReactNode;
  /** Square-ish avatar for a space icon. */
  avatarShape?: 'circle' | 'rounded';
  avatarSize?: number;
  bannerHeight?: number;
  /** Under the media: the size hint, or the upload error. */
  hint?: string;
  error?: string | null;
  /** Beside the avatar (the name and tags). */
  children?: ReactNode;
}

function CameraBadge() {
  const theme = useTheme();
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        end: 0,
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: theme.colors.primary,
        borderWidth: 2,
        borderColor: theme.colors.card,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="camera" size={11} color={theme.colors.primaryForeground} />
    </View>
  );
}

export function MediaHeader({
  name,
  avatarUri,
  bannerUri,
  onPickAvatar,
  onPickBanner,
  avatarBusy,
  bannerBusy,
  avatarOverlay,
  avatarShape = 'circle',
  avatarSize = 84,
  bannerHeight = 120,
  hint,
  error,
  children,
}: MediaHeaderProps) {
  const theme = useTheme();
  const c = theme.colors;
  const overlap = Math.round(avatarSize / 2);
  return (
    <View
      style={{
        marginHorizontal: 12,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.card,
        overflow: 'hidden',
      }}
    >
      <Touchable
        feedback="opacity"
        disabled={!onPickBanner || bannerBusy}
        onPress={onPickBanner}
        accessibilityRole="button"
        accessibilityLabel={t('settings.profile.changeBannerAria')}
        accessibilityState={{ busy: !!bannerBusy, disabled: !onPickBanner || !!bannerBusy }}
        style={{ height: bannerHeight, backgroundColor: withAlpha(c.primary, 0.25) }}
      >
        {bannerUri ? <Image source={{ uri: bannerUri }} style={{ flex: 1 }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors /> : null}
        {onPickBanner ? (
          <View
            style={{
              position: 'absolute',
              top: 8,
              end: 8,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
          >
            <Icon name="camera" size={11} color={onScrim(theme)} />
            <Text variant="caption" color={onScrim(theme)} maxFontSizeMultiplier={1.3}>
              {t('mobile.settings.changeBanner')}
            </Text>
          </View>
        ) : null}
        {bannerBusy ? (
          <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(c.background, 0.6) }}>
            <Spinner label={t('common.uploading')} />
          </View>
        ) : null}
      </Touchable>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 16, paddingBottom: 14 }}>
        <Touchable
          feedback="opacity"
          disabled={!onPickAvatar || avatarBusy}
          onPress={onPickAvatar}
          accessibilityRole="button"
          accessibilityLabel={t('settings.profile.changeAvatarAria')}
          accessibilityState={{ busy: !!avatarBusy, disabled: !onPickAvatar || !!avatarBusy }}
          style={{
            marginTop: -overlap,
            borderRadius: avatarShape === 'circle' ? avatarSize : theme.radii.xl,
            borderWidth: 4,
            borderColor: c.card,
            backgroundColor: c.card,
          }}
        >
          <Avatar uri={avatarUri} name={name} size={avatarSize} shape={avatarShape} overlay={avatarOverlay} />
          {onPickAvatar ? <CameraBadge /> : null}
          {avatarBusy ? (
            <View
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                start: 0,
                end: 0,
                borderRadius: avatarSize,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: withAlpha(c.background, 0.6),
              }}
            >
              <Spinner label={t('common.uploading')} />
            </View>
          ) : null}
        </Touchable>
        <View style={{ flex: 1, minWidth: 0, paddingBottom: 2, gap: 2 }}>{children}</View>
      </View>
      {hint || error ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 14, marginTop: -6 }}>
          {error ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : (
            <Text variant="caption">{hint}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
