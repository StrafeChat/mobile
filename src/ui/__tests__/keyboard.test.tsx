/// <reference types="jest" />
/**
 * Putting the keyboard away: the helper reaches both React Native's JS-tracked blur and
 * keyboard-controller's native one, and the overlays call it - a sheet as it opens (the
 * composer's keyboard must not stay up under it and come back after) and as it closes, a
 * confirm prompt as it appears.
 */
import './setup';
import { Keyboard, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { confirmDialog, settleConfirmDialog } from '@web/stores/confirmDialog';
import { UiProvider } from '../UiHosts';
import { Sheet } from '../Sheet';
import { dismissKeyboard, resetKeyboardControllerForTests } from '../keyboard';

jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));

const { KeyboardController } = jest.requireMock<typeof import('react-native-keyboard-controller')>('react-native-keyboard-controller');
let blur: jest.SpiedFunction<typeof Keyboard.dismiss>;

beforeEach(() => {
  resetKeyboardControllerForTests();
  blur = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  (KeyboardController.dismiss as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('dismissKeyboard', () => {
  it('blurs through React Native and hides natively, clearing the focus', () => {
    dismissKeyboard();
    expect(blur).toHaveBeenCalledTimes(1);
    expect(KeyboardController.dismiss).toHaveBeenCalledWith({ keepFocus: false });
  });

  it('still blurs when the native module is missing or throws', () => {
    (KeyboardController.dismiss as jest.Mock).mockImplementationOnce(() => {
      throw new Error('not linked');
    });
    expect(() => dismissKeyboard()).not.toThrow();
    expect(blur).toHaveBeenCalledTimes(1);
  });
});

function Host({ open }: { open: boolean }) {
  return (
    <UiProvider>
      <Sheet open={open} onClose={() => undefined} title="Profile">
        <Text>body</Text>
      </Sheet>
    </UiProvider>
  );
}

describe('Sheet', () => {
  it('puts the keyboard away as it opens and again as it closes', async () => {
    const view = await render(<Host open={false} />);
    expect(blur).not.toHaveBeenCalled();
    await view.rerender(<Host open />);
    expect(blur).toHaveBeenCalledTimes(1);
    await view.rerender(<Host open={false} />);
    expect(blur.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('DialogHost', () => {
  it('puts the keyboard away when a confirm prompt appears', async () => {
    await render(<UiProvider>{null}</UiProvider>);
    expect(blur).not.toHaveBeenCalled();
    let answer: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      answer = confirmDialog({ title: 'Delete message?', tone: 'danger' });
    });
    expect(blur).toHaveBeenCalledTimes(1);
    await act(async () => settleConfirmDialog(false));
    await expect(answer).resolves.toBe(false);
  });
});
