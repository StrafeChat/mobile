/// <reference types="jest" />
/**
 * Environment for the room area's component tests. Import FIRST:
 *  - the design system's mocks and the data layer's web stand-ins;
 *  - FlashList as a FlatList that renders every row (no layout pass under jest);
 *  - the other feature areas the room area composes or calls (chat, voice, nav, settings,
 *    composer) as small stand-ins - their own tests cover them;
 *  - the router, clipboard, sharing and file system, and the API calls the hosts make;
 *  - the room area's own English strings, so assertions read as users hear them.
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

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    dismissAll: jest.fn(),
    canGoBack: () => true,
    canDismiss: () => false,
  },
  useLocalSearchParams: jest.fn(() => ({})),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
jest.mock('expo-file-system', () => {
  class File {
    uri = 'file:///cache/strafe-recovery-code.txt';
    exists = false;
    create() {
      this.exists = true;
    }
    write() {
      /* nothing */
    }
    delete() {
      this.exists = false;
    }
  }
  return { File, Paths: { cache: {} } };
});

jest.mock('expo-image', () => {
  const React = require('react');
  const RN = require('react-native');
  const Image = (p: { accessibilityLabel?: string; testID?: string }) =>
    React.createElement(RN.View, { testID: p.testID ?? 'image', accessibilityLabel: p.accessibilityLabel });
  return { Image };
});

jest.mock('@/features/chat', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    MessageBody: (p: { text: string }) => React.createElement(RN.Text, null, p.text),
    MessageAttachments: () => null,
    MessageList: () => React.createElement(RN.View, { testID: 'message-list' }),
    TypingIndicator: () => null,
    TYPING_ROW_HEIGHT: 24,
  };
});
jest.mock('@/features/composer', () => ({ Composer: () => null }));
jest.mock('@/features/voice', () => ({
  joinVoiceFromUi: jest.fn(async () => true),
  openCallScreen: jest.fn(),
  RoomCallBanner: () => null,
}));
jest.mock('@/features/nav', () => ({
  openAddPeopleSheet: jest.fn(),
  FriendsView: () => null,
  NotesView: () => null,
}));
jest.mock('@/features/settings', () => ({ openRoomSettings: jest.fn(), openSpaceProfile: jest.fn() }));

jest.mock('@/platform/crypto', () => ({ cryptoHost: { state: 'ready', onStateChange: () => () => undefined } }));
jest.mock('@web/lib/e2ee/keyBackup', () => ({ getBackupStatus: jest.fn(async () => ({ exists: false })), stopBackupSync: () => undefined }));
jest.mock('@web/api/reports', () => ({ createReport: jest.fn(async () => undefined) }));
jest.mock('@web/api/developers', () => ({ getPublicApplication: jest.fn(async () => null), authorizeUrl: () => 'https://x/oauth2/authorize' }));
// The real module (the profile keys, the types' runtime companions) with the calls these
// screens make stubbed - the space-profile ones included, which src/data re-exports.
jest.mock('@web/api/spaces', () => ({
  ...jest.requireActual<object>('@web/api/spaces'),
  setMemberSpaceRoles: jest.fn(async () => undefined),
  kickSpaceMember: jest.fn(),
  banSpaceMember: jest.fn(),
  getSpaceMember: jest.fn(),
  patchSpaceMember: jest.fn(),
  uploadSpaceMemberAvatar: jest.fn(),
  uploadSpaceMemberBanner: jest.fn(),
}));
jest.mock('@web/lib/openWindow', () => ({ openAppWindow: jest.fn() }));
jest.mock('@web/stores/pinnedMessages', () => {
  const { createStore } = require('solid-js/store');
  const [pinnedMessages, setPinnedMessages] = createStore({ byRoom: {}, loaded: {} });
  return {
    pinnedMessages,
    setPinnedMessages,
    ensureRoomPins: jest.fn(async () => undefined),
    refreshRoomPins: jest.fn(async () => undefined),
    isMessagePinned: () => false,
    pinMessage: jest.fn(async () => undefined),
    unpinMessage: jest.fn(async () => undefined),
  };
});
jest.mock('@web/lib/roomNotify', () => {
  const actual = jest.requireActual<Record<string, unknown>>('@web/lib/roomNotify');
  return { ...actual, setRoomNotifyMode: jest.fn(async () => undefined), muteRoom: jest.fn(async () => undefined), unmuteRoom: jest.fn(async () => undefined) };
});
jest.mock('@web/stores/externalLink', () => {
  const { createStore } = require('solid-js/store');
  const [externalLink, setExternalLink] = createStore({ pendingUrl: null as string | null, trustedDomains: [] as string[] });
  return {
    externalLink,
    setExternalLink,
    getDomainFromUrl: (u: string) => {
      try {
        return new URL(u).hostname;
      } catch {
        return '';
      }
    },
    isExternalLink: () => true,
    requestOpenExternalLink: (u: string) => setExternalLink('pendingUrl', u),
    closeExternalLinkModal: jest.fn(() => setExternalLink('pendingUrl', null)),
    confirmExternalLink: jest.fn(() => setExternalLink('pendingUrl', null)),
  };
});

const roomEn = require('../../../i18n/areas/room/en').default;
i18next.addResourceBundle('en', 'translation', { mobile: { room: roomEn } }, true, true);
