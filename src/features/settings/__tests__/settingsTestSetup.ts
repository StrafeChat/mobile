/// <reference types="jest" />
/**
 * Environment for the settings area's tests. Import FIRST (before any component or store):
 *  - the design system's mocks (reanimated, gesture handler, bottom sheet, storage, i18n with
 *    the real English strings) and the data layer's web stand-ins (gateway, voice, messages,
 *    notification prefs);
 *  - FlashList as a FlatList that renders every row, the keyboard controller's jest mock;
 *  - the router (and its navigation hooks), the clipboard, the session module and the media
 *    pickers - things the settings screens call but tests drive by hand;
 *  - the settings area's own English strings, so assertions read as users hear them.
 */
 
import '../../../ui/__tests__/setup';
import '../../../data/testing/webMocks';
import i18next from 'i18next';

jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const RN = require('react-native');
  function FlashList(props: Record<string, unknown>) {
    return React.createElement(RN.FlatList, { ...props, initialNumToRender: 1000, windowSize: 1000 });
  }
  return { FlashList };
});

jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      dismissTo: jest.fn(),
      canGoBack: jest.fn(() => true),
      canDismiss: jest.fn(() => false),
      dismissAll: jest.fn(),
    },
    useLocalSearchParams: jest.fn(() => ({})),
    useNavigation: jest.fn(() => ({ dispatch: jest.fn() })),
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
  };
});

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));

jest.mock('../../../platform/session', () => ({
  signOut: jest.fn(async () => undefined),
}));

jest.mock('../../../platform/media', () => ({
  pickFromLibrary: jest.fn(async () => ({ status: 'cancelled' })),
  takePhoto: jest.fn(async () => ({ status: 'cancelled' })),
  startVoiceRecording: jest.fn(async () => {
    throw new Error('no recorder under jest');
  }),
  VoiceRecorderError: class VoiceRecorderError extends Error {},
}));

jest.mock('../../../platform/voice', () => ({
  listAudioOutputs: jest.fn(async () => ['speaker', 'earpiece']),
  selectAudioRoute: jest.fn(async () => undefined),
  showAudioRoutePicker: jest.fn(async () => undefined),
  screenShareSupported: jest.fn(() => false),
}));

jest.mock('../../../platform/overrides/desktop/native', () => ({
  openExternalUrl: jest.fn(async () => undefined),
  nativeNotificationsGranted: jest.fn(async () => false),
  nativeNotificationsGrantedSync: jest.fn(() => false),
}));

// The data layer disposes its shared memos on a 2 s timer after a screen unmounts; those
// timers must not hold the test worker open once the tests are done.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const handle = realSetTimeout(fn, ms, ...args) as unknown as { unref?: () => void };
  handle?.unref?.();
  return handle;
}) as unknown as typeof setTimeout;

// The app's window.location shim (the instance's web origin), which links are built from.
const g = globalThis as unknown as { window?: { location?: unknown } };
g.window = g.window ?? (globalThis as never);
if (!g.window!.location) g.window!.location = { origin: 'https://chat.example', pathname: '/', search: '', href: 'https://chat.example/' };

const settingsEn = require('../../../i18n/areas/settings/en').default;
i18next.addResourceBundle('en', 'translation', { mobile: { settings: settingsEn } }, true, true);

export {};
