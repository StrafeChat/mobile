/**
 * Sheet: the app's bottom sheet - what the web's ResponsiveDialog is on a phone, and what
 * every popover becomes on mobile (profile cards, pickers, menus).
 *
 * Built on @gorhom/bottom-sheet's BottomSheetModal, so it needs the BottomSheetModalProvider
 * that `<UiProvider>` mounts at the root. Controlled: `open` presents and dismisses it, and
 * `onClose` fires once it has finished closing for any reason (swipe down, backdrop tap,
 * Android back, `open` going false) - set your state there.
 *
 * What it adds over the raw library:
 * - the theme: card background, the web's large top radius (by corner style), a faded handle
 *   and the black 60 % backdrop;
 * - sizing to content up to 92 % of the screen (or fixed `snapPoints`), clear of the status bar
 *   and the home indicator;
 * - `dismissible={false}` for sheets that must not close mid-request (no swipe, no backdrop,
 *   back is swallowed) - the web's dismissible;
 * - keyboard: an opening sheet puts away the keyboard of what is under it (the composer's,
 *   say - it would otherwise stay up and come back when the sheet goes) and a closing one its
 *   own, whatever closes it; the sheet rises with the keyboard of its own fields, and
 *   `Input`/`TextArea`/`SearchInput` inside a Sheet switch to the library's keyboard-aware
 *   TextInput automatically (SheetContext);
 * - Android back closes the top-most sheet first;
 * - reduced motion (app or OS) makes it appear without sliding;
 * - tablets get a centred floating card instead of an edge-to-edge sheet;
 * - screen readers: the content is a modal region with real, separately focusable children.
 */
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { BackHandler, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { withAlpha } from './color';
import { DialogHeader } from './DialogHeader';
import { IconButton } from './IconButton';
import { dismissKeyboard } from './keyboard';
import { useReduceMotion } from './motion';
import type { DialogTone } from './presenter';
import { physicalSides, useWindowInsets } from './safeArea';
import { SHEET_MAX_WIDTH, WIDE_BREAKPOINT, largeRadius } from './tokens';

const SheetContext = createContext(false);

/** True inside a Sheet's content (text inputs use the sheet-aware TextInput there). */
export function useInSheet(): boolean {
  return useContext(SheetContext);
}

export interface SheetProps {
  open: boolean;
  /** Fired once the sheet has finished closing, whatever closed it. */
  onClose: () => void;
  title?: string;
  description?: string;
  /** Icon chip beside the title (Font Awesome). */
  icon?: string;
  tone?: DialogTone;
  /** Centre the header (icon above title). */
  centered?: boolean;
  /** A custom header instead of title/description/icon. */
  header?: ReactNode;
  /** An X in the corner, for sheets with no Cancel of their own. */
  closeButton?: boolean;
  /** When false the sheet can't be swiped, tapped or backed away (a request in flight). */
  dismissible?: boolean;
  /** Fixed heights ('50%', 400...). Without them the sheet sizes to its content. */
  snapPoints?: (string | number)[];
  /** Body scrolls (long lists, forms). */
  scrollable?: boolean;
  /** Pad the body (default). Off for edge-to-edge content such as action lists. */
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  icon,
  tone,
  centered,
  header,
  closeButton,
  dismissible = true,
  snapPoints,
  scrollable,
  padded = true,
  contentStyle,
  children,
  testID,
}: SheetProps) {
  const theme = useTheme();
  // The window's: the sheet is portaled to the root, whatever part of the tree declared it.
  const insets = useWindowInsets();
  const { width, height } = useWindowDimensions();
  const reduce = useReduceMotion();
  const ref = useRef<BottomSheetModal>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const presented = useRef(false);
  const notified = useRef(true);

  // Close with the keyboard first: a sheet's text field unmounts with the sheet, and once it
  // is gone there is nothing left to blur - the Android keyboard then stays up over the app.
  // (keyboardBlurBehavior "restore" only moves the sheet back down when the keyboard goes; it
  // never brings the keyboard back, and neither does android_keyboardInputMode.)
  const dismissSheet = useCallback(() => {
    dismissKeyboard();
    ref.current?.dismiss();
  }, []);

  // The library closing the sheet itself (swipe down, backdrop tap) starts here: it blurs the
  // keyboard for a swipe only, and a backdrop tap not at all.
  const onAnimate = useCallback((_from: number, to: number) => {
    if (to === -1) dismissKeyboard();
  }, []);

  const notifyClosed = useCallback(() => {
    presented.current = false;
    if (notified.current) return;
    notified.current = true;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (open) {
      notified.current = false;
      presented.current = true;
      // Before presenting: a field inside the sheet that focuses itself does so as its content
      // mounts, after this.
      dismissKeyboard();
      ref.current?.present();
      return;
    }
    if (!presented.current) return;
    dismissSheet();
    // A dismissal that never reports back (provider gone, animation interrupted) must not
    // leave the caller - or a presenter's promise - waiting forever.
    const timer = setTimeout(notifyClosed, 900);
    return () => clearTimeout(timer);
  }, [open, notifyClosed, dismissSheet]);

  // Android back: closes this sheet (or is swallowed while it may not close). Listeners run
  // newest-first, so the top-most sheet answers before the shell behind it.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dismissible) dismissSheet();
      return true;
    });
    return () => sub.remove();
  }, [open, dismissible, dismissSheet]);

  const renderBackdrop = useCallback(
    (p: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...p}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.6}
        pressBehavior={dismissible ? 'close' : 'none'}
        accessible={dismissible}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        accessibilityHint={null}
      />
    ),
    [dismissible],
  );

  const wide = width >= WIDE_BREAKPOINT;
  const radius = largeRadius(theme.radii.xl);
  const sideMargin = wide ? Math.max(16, (width - SHEET_MAX_WIDTH) / 2) : 0;
  // Sheets are presented outside every screen's safe-area padding: in landscape, keep the sheet
  // itself clear of the cutout and a side navigation bar (insets are 0 in portrait).
  const sides = physicalSides(insets);
  const sheetMargins = { marginLeft: Math.max(sideMargin, sides.left), marginRight: Math.max(sideMargin, sides.right) };
  const bottomPad = padded ? Math.max(28, insets.bottom + 20) : insets.bottom + 8;

  const headerNode =
    header ??
    (title || description || icon ? (
      <DialogHeader title={title} description={description} icon={icon} tone={tone} centered={centered} endInset={closeButton ? 40 : 0} />
    ) : null);

  const body = (
    <SheetContext.Provider value={true}>
      {closeButton ? (
        <View style={{ position: 'absolute', top: padded ? 0 : 4, end: padded ? 12 : 8, zIndex: 1 }}>
          <IconButton icon="xmark" label={t('common.close')} onPress={() => (dismissible ? dismissSheet() : undefined)} disabled={!dismissible} />
        </View>
      ) : null}
      {headerNode ? <View style={padded ? { paddingTop: 4 } : { paddingHorizontal: 20, paddingTop: 4 }}>{headerNode}</View> : null}
      {children}
    </SheetContext.Provider>
  );

  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={notifyClosed}
      onAnimate={onAnimate}
      snapPoints={snapPoints}
      enableDynamicSizing={!snapPoints}
      maxDynamicContentSize={Math.round(height * 0.92) - insets.top}
      topInset={insets.top}
      detached={wide}
      bottomInset={wide ? insets.bottom + 24 : 0}
      style={sheetMargins}
      enablePanDownToClose={dismissible}
      enableContentPanningGesture={dismissible}
      enableHandlePanningGesture={dismissible}
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: theme.colors.card,
        borderTopLeftRadius: radius,
        borderTopRightRadius: radius,
        ...(wide ? { borderBottomLeftRadius: radius, borderBottomRightRadius: radius } : null),
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
      handleIndicatorStyle={{ backgroundColor: withAlpha(theme.colors.mutedForeground, 0.3), width: 40, height: 4 }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      // The app runs under react-native-keyboard-controller, which keeps Android from resizing
      // the window for the keyboard; 'adjustPan' tells the sheet to lift itself instead.
      android_keyboardInputMode="adjustPan"
      enableBlurKeyboardOnGesture
      overrideReduceMotion={reduce ? ReduceMotion.Always : ReduceMotion.System}
      accessible={false}
    >
      {scrollable ? (
        <BottomSheetScrollView
          testID={testID}
          keyboardShouldPersistTaps="handled"
          accessibilityViewIsModal
          contentContainerStyle={[padded ? { paddingHorizontal: 20 } : null, { paddingBottom: bottomPad }, contentStyle]}
        >
          {body}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView
          testID={testID}
          accessibilityViewIsModal
          style={[padded ? { paddingHorizontal: 20 } : null, { paddingBottom: bottomPad }, contentStyle]}
        >
          {body}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  );
}

/** The library's scrollables, for a custom-scrolling sheet body (`scrollable` covers most). */
export { BottomSheetFlatList as SheetFlatList, BottomSheetFlashList as SheetFlashList, BottomSheetScrollView as SheetScrollView } from '@gorhom/bottom-sheet';
