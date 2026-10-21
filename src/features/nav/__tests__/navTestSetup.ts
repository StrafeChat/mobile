/// <reference types="jest" />
/**
 * Environment for the nav area's tests. Import FIRST (before any component or store):
 *  - the design system's mocks (reanimated, gesture handler, bottom sheet, storage, i18n with
 *    the real English strings) and the data layer's web stand-ins (gateway, voice, messages);
 *  - FlashList as a FlatList that renders every row (no layout pass under jest);
 *  - the other feature areas (links.ts), the router, expo-notifications / expo-clipboard and
 *    the session module, which the nav only calls;
 *  - the nav area's own English strings, so assertions read as users hear them.
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

jest.mock('expo-notifications', () => ({
  setBadgeCountAsync: jest.fn(async () => true),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    canDismiss: jest.fn(() => false),
    dismissAll: jest.fn(),
  },
  useLocalSearchParams: jest.fn(() => ({})),
}));

jest.mock('../../../platform/session', () => ({
  signOut: jest.fn(async () => undefined),
}));

jest.mock('../links', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    openSettings: jest.fn(),
    openAdminDashboard: jest.fn(),
    openSpaceSettings: jest.fn(),
    openSpaceProfile: jest.fn(),
    openRoomSettings: jest.fn(),
    joinVoiceFromUi: jest.fn(async () => true),
    openAccountSwitcher: jest.fn(),
    VoiceOccupantRow: (p: { userId: string }) => React.createElement(RN.Text, null, `voice-user:${p.userId}`),
  };
});

const navEn = require('../../../i18n/areas/nav/en').default;
i18next.addResourceBundle('en', 'translation', { mobile: { nav: navEn } }, true, true);

export {};
