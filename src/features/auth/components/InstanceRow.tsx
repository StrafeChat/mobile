/**
 * Which instance this form talks to, as one compact row: "Instance - strafe.chat - Change".
 * The full field lives on the instance screen; here it only has to be visible, because a
 * password is about to go to that server.
 */
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Icon, Text, Touchable } from '@/ui';

export function InstanceRow({ domain, onChange, disabled }: { domain: string; onChange: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Touchable
      onPress={onChange}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${t('desktop.instance.label')}: ${domain}`}
      accessibilityHint={t('mobile.auth.changeInstance')}
      testID="instance-row"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 52,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
      }}
    >
      <Icon name="globe" size={16} tone="muted" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="caption">{t('desktop.instance.label')}</Text>
        <Text variant="label" weight="semibold" numberOfLines={1} style={{ writingDirection: 'ltr' }} testID="instance-row-domain">
          {domain}
        </Text>
      </View>
      <Text variant="label" tone="link" accessible={false}>
        {t('mobile.auth.change')}
      </Text>
    </Touchable>
  );
}
