/**
 * The media viewer's chrome in landscape. Its route is the one the main stack leaves unpadded
 * at the sides (the pages are the window's width), so the bar and the filmstrip keep clear of
 * the cutout and a side navigation bar themselves. And the conversation it was opened over
 * stays the one on screen while it is up, as the web's overlay viewer leaves it.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, expect, jest, test } from '@jest/globals';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { closeMediaViewer, openMediaViewer } from '@web/stores/mediaViewer';
import { closeView, openRoom, roomOnScreen, setShellFocused, setShellWide } from '@/shell/state';
import { MediaViewerScreen } from '../MediaViewerScreen';

jest.mock('expo-image', () => {
  const React = require('react');
  const RN = require('react-native');
  const Image = (p: { accessibilityLabel?: string }) => React.createElement(RN.View, { accessibilityLabel: p.accessibilityLabel });
  Image.prefetch = async () => true;
  return { Image };
});
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ addListener: () => ({ remove: () => undefined }) }), VideoView: () => null }));
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: () => undefined, pause: () => undefined, seekTo: async () => undefined, setPlaybackRate: () => undefined }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0, didJustFinish: false, isBuffering: false, mute: false, playbackRate: 1, error: null }),
}));
let mockFocused = true;
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, canDismiss: () => false },
  useIsFocused: () => mockFocused,
}));
jest.mock('@/platform/media', () => ({
  useAttachmentSource: () => ({ status: 'loading', progress: null }),
  attachmentSourceSync: () => null,
  saveAttachmentToDevice: jest.fn(),
  shareAttachment: jest.fn(),
  playExclusive: jest.fn(),
  useExclusivePlayback: () => undefined,
}));

// A phone on its side: the notch on the left, the navigation bar's buttons on the right.
const LANDSCAPE = { top: 0, bottom: 21, left: 47, right: 48 };

afterEach(() => {
  closeMediaViewer();
  mockFocused = true;
  setShellFocused(false);
  closeView();
});

test('the bar and the filmstrip are padded clear of the cutout and the navigation bar', async () => {
  openMediaViewer(
    [
      { url: 'https://cdn.example/a.png', filename: 'a.png', size: 2048 },
      { url: 'https://cdn.example/b.png', filename: 'b.png' },
    ],
    0,
  );
  const view = await render(
    <SafeAreaInsetsContext.Provider value={LANDSCAPE}>
      <MediaViewerScreen />
    </SafeAreaInsetsContext.Provider>,
  );
  const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) as Record<string, number>;
  // The bar keeps its own 8 pt on top of each inset.
  expect(style('media-viewer-bar')).toMatchObject({ paddingLeft: 8 + LANDSCAPE.left, paddingRight: 8 + LANDSCAPE.right });
  expect(style('media-viewer-footer')).toMatchObject({ paddingLeft: LANDSCAPE.left, paddingRight: LANDSCAPE.right });
  await act(async () => view.unmount());
});

test('the conversation it was opened over stays on screen until it closes', async () => {
  // A phone with a space channel open in the shell.
  setShellWide(false);
  setShellFocused(true);
  openRoom('300', '100');
  expect(roomOnScreen()).toEqual({ roomId: '300', spaceId: '100' });

  openMediaViewer([{ url: 'https://cdn.example/a.png', filename: 'a.png' }], 0);
  const view = await render(<MediaViewerScreen />);
  // The viewer's route covers the shell, which stops being the screen in front.
  await act(async () => setShellFocused(false));
  expect(roomOnScreen()).toEqual({ roomId: '300', spaceId: '100' });

  await act(async () => view.unmount());
  expect(roomOnScreen()).toBeNull();
});

test('opened with no conversation on screen (a profile, the pins list), it claims none', async () => {
  openMediaViewer([{ url: 'https://cdn.example/a.png', filename: 'a.png' }], 0);
  const view = await render(<MediaViewerScreen />);
  expect(roomOnScreen()).toBeNull();
  await act(async () => view.unmount());
});
