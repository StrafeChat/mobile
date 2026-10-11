/**
 * The design system's root pieces, mounted once by the app layout.
 *
 *   <GestureHandlerRootView>
 *     <SafeAreaProvider>
 *       <UiProvider>
 *         <Stack />            // the app
 *       </UiProvider>
 *     </SafeAreaProvider>
 *   </GestureHandlerRootView>
 *
 * `UiProvider` = the BottomSheetModalProvider every `<Sheet>` presents into, plus `<UiHosts/>`:
 * the action sheet host (`showActionSheet`), the dialog host (the web's `confirmDialog` and
 * `showDialog`/`alertDialog`) and the toast host (`toast`). The toast host sits after the
 * provider so a toast paints above an open sheet; dialogs are native modals and paint above
 * everything.
 */
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ActionSheetHost } from './ActionSheet';
import { DialogHost } from './Dialog';
import { ToastHost } from './Toast';

/**
 * All overlay hosts, for an app that mounts its own BottomSheetModalProvider (render this
 * inside it). Prefer `UiProvider`, which also keeps toasts above open sheets.
 */
export function UiHosts() {
  return (
    <>
      <ActionSheetHost />
      <DialogHost />
      <ToastHost />
    </>
  );
}

/** The sheet provider and every overlay host. Mount once, around the app's navigator. */
export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        {children}
        <ActionSheetHost />
        <DialogHost />
      </BottomSheetModalProvider>
      {/* After the provider: sheets render in its portal, which a toast must paint over. */}
      <ToastHost />
    </View>
  );
}
