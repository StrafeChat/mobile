/**
 * Long-press, the mobile stand-in for right-click.
 *
 * `useLongPress(handler)` returns props to spread on any Pressable/Touchable: the long-press
 * itself with the app's haptic, a delay matched to the platform, and - the part that is easy to
 * forget - an accessibility action, so a screen-reader user (who cannot long-press the way a
 * sighted user does) gets the same menu from the actions rotor / "Actions available".
 *
 * `useLongPressActions(build, options)` is the common case: long-press opens an action sheet
 * of `build()`'s entries (built at press time, so they reflect current permissions).
 *
 *   const menu = useLongPressActions(() => buildUserMenuItems(user), { title: user.name });
 *   <ListRow title={user.name} onPress={openProfile} {...menu} />
 */
import { useCallback, useMemo, useRef } from 'react';
import type { AccessibilityActionEvent, AccessibilityActionInfo, GestureResponderEvent } from 'react-native';
import { t } from '@web/i18n/t';
import { haptics } from './haptics';
import { showActionSheet, type ActionSheetEntry, type ActionSheetOptions } from './presenter';

/** Long enough to be deliberate, short enough not to feel stuck (iOS uses ~0.5 s). */
export const LONG_PRESS_DELAY = 380;

export interface LongPressProps {
  onLongPress?: (e: GestureResponderEvent) => void;
  delayLongPress?: number;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
}

export interface LongPressOptions {
  delay?: number;
  /** Haptic on trigger (default on). */
  haptic?: boolean;
  disabled?: boolean;
  /** Name of the screen-reader action (defaults to "Show actions"). */
  accessibilityActionLabel?: string;
}

export function useLongPress(handler: (() => void) | null | undefined, options: LongPressOptions = {}): LongPressProps {
  const ref = useRef(handler);
  ref.current = handler;
  const { delay = LONG_PRESS_DELAY, haptic = true, disabled = false, accessibilityActionLabel } = options;
  const enabled = !!handler && !disabled;

  const fire = useCallback(() => {
    if (!ref.current) return;
    if (haptic) haptics.longPress();
    ref.current();
  }, [haptic]);

  return useMemo<LongPressProps>(() => {
    if (!enabled) return {};
    return {
      onLongPress: () => fire(),
      delayLongPress: delay,
      accessibilityActions: [{ name: 'longpress', label: accessibilityActionLabel ?? t('mobile.ui.showActions') }],
      onAccessibilityAction: (e) => {
        if (e.nativeEvent.actionName === 'longpress') fire();
      },
    };
  }, [enabled, fire, delay, accessibilityActionLabel]);
}

/** Long-press opens an action sheet of `build()` (evaluated at press time). */
export function useLongPressActions(
  build: (() => readonly ActionSheetEntry[]) | null | undefined,
  options: ActionSheetOptions & LongPressOptions = {},
): LongPressProps {
  const buildRef = useRef(build);
  buildRef.current = build;
  const optsRef = useRef(options);
  optsRef.current = options;
  const open = useCallback(() => {
    void showActionSheet(buildRef.current?.() ?? [], optsRef.current);
  }, []);
  return useLongPress(build ? open : null, options);
}
