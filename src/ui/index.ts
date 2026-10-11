/**
 * The design system. Feature screens import from '@/ui' and build from these instead of
 * hand-rolling buttons, rows, sheets and menus - so every surface shares the theme, the touch
 * sizes, the accessibility wiring and the overlay plumbing.
 *
 * Root: mount `<UiProvider>` once around the navigator (UiHosts.tsx).
 */

// Root + overlays
export { UiHosts, UiProvider } from './UiHosts';
export { Sheet, SheetFlatList, SheetFlashList, SheetScrollView, useInSheet, type SheetProps } from './Sheet';
export { ActionSheet, ActionSheetHost, type ActionSheetProps } from './ActionSheet';
export { Dialog, DialogHost, type DialogButton, type DialogProps } from './Dialog';
export { DialogHeader, toneAccent, type DialogHeaderProps } from './DialogHeader';
export { ToastHost } from './Toast';
export { toast, dismissToast, toastStore, type ToastOptions, type ToastTone, type ToastAction, type ActiveToast } from './toast';
export {
  showActionSheet,
  closeActionSheet,
  settleActionSheet,
  actionSheetStore,
  showDialog,
  alertDialog,
  settleDialog,
  dialogStore,
  cleanEntries,
  isActionItem,
  isActionSection,
  runActionItem,
  type ActionItem,
  type ActionSection,
  type ActionSheetEntry,
  type ActionSheetOptions,
  type ActionSheetRequest,
  type DialogAction,
  type DialogOptions,
  type DialogRequest,
  type DialogTone,
  type DialogButtonVariant,
} from './presenter';

// Type + icons
export { Text, textStyle, toneColor, MONO_FONT, type TextProps, type TextVariant, type TextTone, type TextWeight } from './Text';
export { Icon, hasIcon, type IconProps } from './Icon';
export { parseIcon, type ParsedIcon, type IconStyle } from './icons';

// Controls
export { Touchable, type TouchableProps, type PressFeedback } from './Touchable';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { IconButton, type IconButtonProps, type IconButtonTone, type IconButtonSize } from './IconButton';
export { Input, TextArea, SearchInput, FieldError, FieldLabel, fieldBoxStyle, type InputProps, type TextAreaProps, type SearchInputProps } from './Input';
export { Toggle, Switch, ToggleVisual, type ToggleProps } from './Toggle';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { SegmentedControl, type SegmentedControlProps, type SegmentItem } from './SegmentedControl';
export { Select, type SelectProps, type SelectOption } from './Select';
export { Slider, snapToStep, type SliderProps } from './Slider';

// Lists + layout
export { ListRow, ListSection, ListHeader, ToggleRow, type ListRowProps, type ListSectionProps, type ListHeaderProps, type ToggleRowProps } from './List';
export { Divider, type DividerProps } from './Divider';
export { Header, Header as AppBar, type HeaderProps, type HeaderAction } from './Header';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Banner, type BannerProps, type BannerTone } from './Banner';
export { Spinner, type SpinnerProps } from './Spinner';
export { Skeleton, SkeletonText, SkeletonRow, type SkeletonProps } from './Skeleton';

// People
export { Avatar, avatarInitial, avatarPixels, AVATAR_SIZES, type AvatarProps, type AvatarSize } from './Avatar';
export { PresenceDot, presenceLabel, presenceColor, normalizePresence, type PresenceDotProps, type PresenceStatus } from './PresenceDot';
export { UserPresenceDot, UserAvatar, useUserStatus, useUserCustomStatus, type UserPresenceDotProps, type UserAvatarProps } from './UserPresence';
export { Badge, formatBadgeCount, type BadgeProps, type BadgeTone } from './Badge';
export { BotTag, OfficialTag, RolePill, type BotTagProps, type OfficialTagProps, type RolePillProps, type RolePillRole, type TagSize } from './Tags';
export { UserBadges, type UserBadgesProps } from './UserBadges';

// Behaviour
export { haptics, hapticsEnabled, setHapticsEnabled } from './haptics';
export { useLongPress, useLongPressActions, LONG_PRESS_DELAY, type LongPressProps, type LongPressOptions } from './useLongPress';
export { useReduceMotion, useOsReduceMotion } from './motion';

// Tokens + helpers
export { space, MIN_TOUCH, HEADER_HEIGHT, SHEET_MAX_WIDTH, DIALOG_MAX_WIDTH, WIDE_BREAKPOINT, hitSlopFor, largeRadius } from './tokens';
export { withAlpha, parseColor, luminance, onScrim } from './color';
export { createExternalStore, useExternalStore, type ExternalStore } from './externalStore';
