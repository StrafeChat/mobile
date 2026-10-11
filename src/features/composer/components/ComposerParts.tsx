/**
 * Pieces of the composer: the notice that replaces it when you can't send, the reply / edit
 * strip on top of the field, the error line, and the send button.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Icon, IconButton, Text, Touchable, withAlpha } from '@/ui';

/** Why the composer is closed: no Send Messages, the official account's read-only PM, a
 * locked thread, a space verification rule, or no encryption engine on this device. */
export function ComposerNotice({ icon, text }: { icon: string; text: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
      testID="composer-locked"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        marginHorizontal: 12,
        marginTop: 8,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: withAlpha(theme.colors.muted, 0.4),
      }}
    >
      <Icon name={icon} size={13} tone="muted" />
      <Text variant="label" tone="muted" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export interface ContextStripProps {
  icon: string;
  /** "Replying to" / "Editing message". */
  lead: string;
  /** The replied-to author. */
  name?: string;
  preview?: string;
  /** Tap the strip (jump to the replied message). */
  onPress?: () => void;
  pressHint?: string;
  onCancel: () => void;
  cancelLabel: string;
  testID?: string;
}

export function ContextStrip({ icon, lead, name, preview, onPress, pressHint, onCancel, cancelLabel, testID }: ContextStripProps) {
  const theme = useTheme();
  const label = [lead, name, preview].filter(Boolean).join(' ');
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: withAlpha(theme.colors.border, 0.7),
      }}
    >
      <Touchable
        feedback={onPress ? 'highlight' : 'none'}
        disabled={!onPress}
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={label}
        accessibilityHint={onPress ? pressHint : undefined}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingStart: 12, paddingEnd: 4, paddingVertical: 6 }}
      >
        <Icon name={icon} size={12} tone="muted" />
        <View style={{ flex: 1 }}>
          <Text variant="caption" numberOfLines={1}>
            {lead}
            {name ? (
              <Text variant="caption" weight="semibold" tone="default">
                {` ${name}`}
              </Text>
            ) : null}
          </Text>
          {preview ? (
            <Text variant="caption" numberOfLines={1} style={{ marginTop: 1 }}>
              {preview}
            </Text>
          ) : null}
        </View>
      </Touchable>
      <IconButton icon="xmark" size="sm" label={cancelLabel} onPress={onCancel} testID={testID ? `${testID}-cancel` : undefined} />
    </View>
  );
}

export function ErrorLine({ message, action, onDismiss }: { message: string; action?: ReactNode; onDismiss?: () => void }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="assertive"
      testID="composer-error"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingBottom: 4 }}
    >
      <Icon name="circle-exclamation" size={12} color={theme.colors.destructive} />
      <Text variant="caption" tone="danger" style={{ flex: 1 }}>
        {message}
      </Text>
      {action}
      {onDismiss ? <IconButton icon="xmark" size="sm" label={t('common.close')} onPress={onDismiss} /> : null}
    </View>
  );
}

export function SendButton({
  onPress,
  disabled,
  busy,
  icon = 'paper-plane',
  label,
}: {
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: string;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      pressedColor={theme.colors.primaryHover}
      testID="composer-send"
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.primary,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={theme.colors.primaryForeground} /> : <Icon name={icon} size={17} color={theme.colors.primaryForeground} />}
    </Touchable>
  );
}
