/**
 * Header (AppBar): the title row at the top of a screen - the web's appPageHeader, 56 pt on a
 * phone, on the card surface with a hairline under it.
 *
 * Safe-area aware: it pads itself below the status bar / notch (`safeTop`, default on), so a
 * screen puts it first and needs nothing else. `onBack` shows a back arrow (mirrored in RTL);
 * `leadingIcon` marks the kind of thing on show (the # of a room); `onTitlePress` makes the
 * title a button (room details). Actions are IconButtons on the end; more than two belong in
 * an overflow menu (`overflow` builds one with the shared action sheet).
 */
import type { ReactNode } from 'react';
import { I18nManager, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { showActionSheet, type ActionSheetEntry, type ActionSheetOptions } from './presenter';
import { Text } from './Text';
import { Touchable } from './Touchable';
import { HEADER_HEIGHT } from './tokens';

export interface HeaderAction {
  icon: string;
  label: string;
  onPress: () => void;
  active?: boolean;
  badge?: number;
  disabled?: boolean;
  testID?: string;
}

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  /** Back arrow at the start. */
  onBack?: () => void;
  backLabel?: string;
  /** Glyph before the title (`hashtag` for a room, `lock` for an encrypted one). */
  leadingIcon?: string;
  /** Custom start content (an avatar) instead of `leadingIcon`. */
  leading?: ReactNode;
  /** Slot right after the title text (BotTag, OfficialTag). */
  titleAccessory?: ReactNode;
  onTitlePress?: () => void;
  actions?: HeaderAction[];
  /** An overflow ("...") button opening these entries in an action sheet. */
  overflow?: { entries: () => readonly ActionSheetEntry[]; options?: ActionSheetOptions; label?: string };
  /** Anything else at the end. */
  right?: ReactNode;
  /** Pad below the status bar (default true). Off inside a sheet or a nested header. */
  safeTop?: boolean;
  /** Hairline under the bar (default true). */
  border?: boolean;
  /** No fill (over imagery or a screen of its own colour). */
  transparent?: boolean;
  /** Large title (a tab's root screen: "You", "Notifications"). */
  large?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Header({
  title,
  subtitle,
  onBack,
  backLabel,
  leadingIcon,
  leading,
  titleAccessory,
  onTitlePress,
  actions,
  overflow,
  right,
  safeTop = true,
  border = true,
  transparent,
  large,
  style,
  testID,
}: HeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const titleBlock = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 1 }}>
      {leading ?? (leadingIcon ? <Icon name={leadingIcon} size={16} tone="muted" /> : null)}
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
          {title ? (
            <Text variant={large ? 'title' : 'heading'} numberOfLines={1} accessibilityRole="header" style={{ flexShrink: 1 }}>
              {title}
            </Text>
          ) : null}
          {titleAccessory}
          {onTitlePress ? <Icon name={I18nManager.isRTL ? 'chevron-left' : 'chevron-right'} size={10} tone="muted" style={{ marginStart: 6 }} /> : null}
        </View>
        {subtitle ? (
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <View
      testID={testID}
      style={[
        {
          paddingTop: safeTop ? insets.top : 0,
          backgroundColor: transparent ? 'transparent' : theme.colors.card,
          borderBottomWidth: border && !transparent ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: theme.colors.border,
        },
        style,
      ]}
    >
      <View
        style={{
          height: large ? HEADER_HEIGHT + 4 : HEADER_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingStart: onBack ? 4 : 16,
          paddingEnd: 8,
        }}
      >
        {onBack ? (
          <IconButton
            icon={I18nManager.isRTL ? 'arrow-right' : 'arrow-left'}
            label={backLabel ?? t('common.back')}
            onPress={onBack}
            size="lg"
            tone="default"
            color={theme.colors.foreground}
          />
        ) : null}
        <View style={{ flex: 1, minWidth: 0, paddingStart: onBack ? 4 : 0 }}>
          {onTitlePress ? (
            <Touchable
              onPress={onTitlePress}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel={[title, subtitle].filter(Boolean).join(', ')}
              hitSlop={{ top: 8, bottom: 8 }}
              style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
            >
              {titleBlock}
            </Touchable>
          ) : (
            titleBlock
          )}
        </View>
        {actions?.map((a) => (
          <IconButton
            key={a.label}
            icon={a.icon}
            label={a.label}
            onPress={a.onPress}
            active={a.active}
            badge={a.badge}
            disabled={a.disabled}
            testID={a.testID}
            size="lg"
          />
        ))}
        {overflow ? (
          <IconButton
            icon="ellipsis-vertical"
            label={overflow.label ?? t('mobile.ui.moreOptions')}
            onPress={() => void showActionSheet(overflow.entries(), overflow.options)}
            size="lg"
          />
        ) : null}
        {right}
      </View>
    </View>
  );
}
