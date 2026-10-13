/**
 * Where the in-call bar sits in the shell route (src/app/(main)/index.tsx): at the bottom of
 * the screen with the system inset under it, the shell above it reserving none, and out of the
 * way while the keyboard is up.
 */
import '@/ui/__tests__/setup';
import './voiceMocks';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as voiceStore from '@web/stores/voice';
import { setVoice, voice } from '@web/stores/voice';
import { UiProvider } from '@/ui';
import Shell from '@/app/(main)/index';

jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));

// The shell itself only reports the bottom inset it is given, and the window's, which a sheet
// opened from inside it (portaled over the whole window) goes by.
jest.mock('@/shell/SwipeShell', () => {
  const React = require('react');
  const RN = require('react-native');
  const { useSafeAreaInsets } = require('react-native-safe-area-context');
  const { useWindowInsets } = require('@/ui/safeArea');
  function SwipeShell() {
    const insets = useSafeAreaInsets();
    const windowInsets = useWindowInsets();
    return React.createElement(
      RN.View,
      null,
      React.createElement(RN.Text, { testID: 'shell-bottom-inset' }, String(insets.bottom)),
      React.createElement(RN.Text, { testID: 'window-bottom-inset' }, String(windowInsets.bottom)),
    );
  }
  return { SwipeShell };
});
jest.mock('@/features/nav', () => ({ NavPanel: () => null }));
jest.mock('@/features/room', () => ({ ConversationPanel: () => null, MembersPanel: () => null }));

const store = voiceStore as unknown as { __idleSession: typeof voice.session };
const keyboardState = useKeyboardState as unknown as jest.Mock<(sel?: (s: { isVisible: boolean }) => unknown) => unknown>;
const METRICS = { frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 24, bottom: 48, left: 0, right: 0 } };

function setKeyboard(isVisible: boolean) {
  keyboardState.mockImplementation((sel) => (sel ? sel({ isVisible }) : { isVisible }));
}

function shellInset(): string {
  return String(screen.getByTestId('shell-bottom-inset').props.children);
}

function app() {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <UiProvider>
        <Shell />
      </UiProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  setKeyboard(false);
  setVoice('session', { ...store.__idleSession });
  setVoice('stageVisible', false);
});

describe('the in-call bar in the shell', () => {
  test('takes the system inset under itself while it shows; the shell then reserves none', async () => {
    const { rerender } = await render(app());
    expect(screen.queryByTestId('voice-dock')).toBeNull();
    expect(shellInset()).toBe('48');

    await act(async () => setVoice('session', { ...store.__idleSession, roomId: 'v1', spaceId: 's1', status: 'connected' }));
    expect(shellInset()).toBe('0');
    expect(screen.getByTestId('window-bottom-inset').props.children).toBe('48');
    expect(StyleSheet.flatten(screen.getByTestId('voice-dock').props.style)).toMatchObject({ marginBottom: 48 + 4 });

    // The call's own screen in front: no bar, and the shell has its inset back.
    await act(async () => setVoice('stageVisible', true));
    expect(screen.queryByTestId('voice-dock')).toBeNull();
    expect(shellInset()).toBe('48');

    // The keyboard up: the bar steps aside so the composer meets the keyboard.
    await act(async () => setVoice('stageVisible', false));
    setKeyboard(true);
    await rerender(app());
    expect(screen.queryByTestId('voice-dock')).toBeNull();
    expect(shellInset()).toBe('48');
  });
});
