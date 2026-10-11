/**
 * The instance field (the web's InstancePicker, mobile-shaped): a globe, the address, a live
 * status icon at the end, and the status line under it - "Looking up...", "Connected to
 * strafe.chat - Strafe 1.4.0", or a translated error read out as an alert.
 */
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { FieldError, Icon, Input, Spinner, Text } from '@/ui';
import { instanceStatusMessage } from '../logic/instanceStatus';
import type { InstancePicker } from '../useInstancePicker';

export function InstanceField({
  picker,
  disabled,
  onSubmit,
  autoFocus,
}: {
  picker: InstancePicker;
  disabled?: boolean;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const { status } = picker;
  const message = instanceStatusMessage(status);
  const statusIcon =
    status.kind === 'resolving' ? (
      <Spinner size="small" decorative />
    ) : status.kind === 'ok' ? (
      <Icon name="circle-check" size={16} tone="primary" />
    ) : status.kind === 'error' ? (
      <Icon name="circle-exclamation" size={16} tone="danger" />
    ) : null;

  return (
    <View style={{ gap: 6 }}>
      <Input
        label={t('desktop.instance.label')}
        placeholder={t('desktop.instance.placeholder')}
        value={picker.value}
        onChangeText={picker.setValue}
        onBlur={picker.onBlur}
        onSubmitEditing={() => {
          void picker.resolveNow().then((ok) => {
            if (ok) onSubmit?.();
          });
        }}
        leftIcon="globe"
        right={statusIcon}
        disabled={disabled}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="url"
        keyboardType="url"
        textContentType="URL"
        returnKeyType="go"
        inputStyle={{ writingDirection: 'ltr' }}
        accessibilityHint={message}
        testID="instance-input"
      />
      {status.kind === 'error' ? (
        <FieldError message={message} />
      ) : (
        <Text
          variant="caption"
          tone={status.kind === 'ok' ? 'default' : 'muted'}
          accessibilityLiveRegion="polite"
          testID="instance-status"
          style={{ color: status.kind === 'ok' ? theme.colors.mutedForeground : undefined }}
        >
          {message}
        </Text>
      )}
    </View>
  );
}
