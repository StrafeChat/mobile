/**
 * Putting the keyboard away, the one way every overlay and the shell do it.
 *
 * `Keyboard.dismiss()` alone blurs the input React Native's JS side *believes* is focused
 * (TextInputState). That record and the native focus can disagree: an input that unmounted or
 * was hidden while focused, focus the system restored on its own (a screen coming back, a
 * native dialog closing), an input in a panel the user has swiped away. Then the call blurs
 * nothing and the Android keyboard stays up over a screen with nothing to type into.
 * react-native-keyboard-controller tracks the focused EditText natively and hides the
 * keyboard from there, clearing that focus too, so nothing is left for Android to bring the
 * keyboard back for when the window regains focus. Both run: the first covers iOS and the
 * common case at once, the second whatever the first could not see.
 *
 * Call it synchronously from the action that changes the screen (before any focus a later
 * render asks for - a reply, an edit - so that focus wins), never from a cleanup after it.
 */
import { Keyboard } from 'react-native';

type KeyboardControllerModule = typeof import('react-native-keyboard-controller').KeyboardController;

let controller: KeyboardControllerModule | null | undefined;

/**
 * Required lazily: the shell's store calls this, and a static import would load the native
 * module into everything (and every test) that touches the shell.
 */
function nativeController(): KeyboardControllerModule | null {
  if (controller !== undefined) return controller;
  try {
    controller = (require('react-native-keyboard-controller') as typeof import('react-native-keyboard-controller')).KeyboardController;
  } catch {
    controller = null;
  }
  return controller;
}

export function dismissKeyboard(): void {
  Keyboard.dismiss();
  const native = nativeController();
  if (!native) return;
  try {
    // Resolves once hidden (or at once when already down); nothing waits on it.
    void native.dismiss({ keepFocus: false }).catch(() => undefined);
  } catch {
    // No native module (a test, an unlinked build): Keyboard.dismiss() above is all there is.
  }
}

/** For tests: forget the resolved native module so a test's mock is picked up. */
export function resetKeyboardControllerForTests(): void {
  controller = undefined;
}
