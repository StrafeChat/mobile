/// <reference types="jest" />
/**
 * Landscape: the left / right safe-area insets (a notch, a side navigation bar) reach what is
 * drawn outside every screen's padding - here the toast host - on the correct physical side,
 * in a right-to-left layout too.
 */
import './setup';
// The theme reads stores/appearance, which reaches the web store graph (lib/gif/providers ->
// stores/instance -> auth -> voice, notification prefs); those need their jest stand-ins.
import '@/data/testing/webMocks';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { physicalSides } from '../safeArea';
import { ToastHost } from '../Toast';
import { dismissToast, toast } from '../toast';

describe('horizontal safe area', () => {
  it('keeps physical sides physical, swapping them back where React Native swaps left and right', () => {
    expect(physicalSides({ left: 47, right: 0 }, false)).toEqual({ left: 47, right: 0 });
    expect(physicalSides({ left: 47, right: 0 }, true)).toEqual({ left: 0, right: 47 });
  });

  it('keeps a toast clear of the cutout and the navigation bar', async () => {
    const metrics = { frame: { x: 0, y: 0, width: 800, height: 400 }, insets: { top: 0, bottom: 21, left: 47, right: 48 } };
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <ToastHost />
      </SafeAreaProvider>,
    );
    await act(async () => {
      toast('Copied');
    });
    expect(StyleSheet.flatten(screen.getByTestId('toast-host').props.style)).toMatchObject({ paddingLeft: 47 + 12, paddingRight: 48 + 12 });
    await act(async () => dismissToast());
  });
});
