/// <reference types="jest" />
/**
 * Environment for the auth area's component tests. Import FIRST:
 *  - the design system's mocks (reanimated, gesture handler, bottom sheet, storage, i18n);
 *  - the router, the session module, the auth / instance API calls and the instance store,
 *    which the screens only call - each a jest.fn the tests drive;
 *  - native views with no jest build (WebView, the date picker, expo-image, the keyboard
 *    controller) as plain views that keep their props for assertions;
 *  - the auth area's own English strings, so assertions read as users hear them.
 */
 
import '../../../ui/__tests__/setup';
import '../../../data/testing/webMocks';
import i18next from 'i18next';

jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const RN = require('react-native');
  return { Image: (p: Record<string, unknown>) => React.createElement(RN.View, { testID: p.testID }) };
});

jest.mock('expo-router', () => {
  const React = require('react');
  const RN = require('react-native');
  const params: Record<string, string> = {};
  return {
    mockParams: params,
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      dismissTo: jest.fn(),
      canGoBack: jest.fn(() => false),
    },
    useLocalSearchParams: jest.fn(() => params),
    useNavigation: jest.fn(() => ({ setOptions: jest.fn() })),
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    Redirect: ({ href }: { href: string }) => React.createElement(RN.Text, { testID: 'redirect' }, `redirect:${href}`),
  };
});

jest.mock('react-native-webview', () => {
  const React = require('react');
  const RN = require('react-native');
  const last: { props: Record<string, unknown> | null; injected: string[] } = { props: null, injected: [] };
  const WebView = React.forwardRef(function WebView(props: Record<string, unknown>, ref: unknown) {
    last.props = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: (s: string) => last.injected.push(s) }));
    return React.createElement(RN.View, { testID: 'webview' });
  });
  return { WebView, mockWebView: last };
});

jest.mock('@expo/ui/community/datetime-picker', () => {
  const React = require('react');
  const RN = require('react-native');
  const last: { props: Record<string, unknown> | null } = { props: null };
  function DateTimePicker(props: Record<string, unknown>) {
    last.props = props;
    return React.createElement(RN.View, { testID: 'date-picker' });
  }
  return { DateTimePicker, mockDatePicker: last };
});


jest.mock('@web/stores/auth', () => {
  const { createStore } = require('solid-js/store');
  const [auth, setAuth] = createStore({ token: null as string | null, user: null });
  return { auth, mockSetAuth: setAuth };
});

function mockInstanceStore() {
  const { createStore } = require('solid-js/store');
  const [instance, setInstance] = createStore({
    loaded: true,
    version: '1.0.0',
    federationEnabled: true,
    domain: 'chat.example.org',
    captcha: { enabled: false, provider: '', siteKey: '', apiUrl: '' },
    voiceEnabled: true,
    inviteOnly: false,
    email: { enabled: true, verificationRequired: false },
    instanceAdmin: false,
  });
  return { instance, setInstance, loadInstanceInfo: jest.fn(async () => undefined), resetInstanceInfo: jest.fn() };
}
// '@web/stores/instance' resolves to this same override file (jest/resolver.js), so this one
// mock serves both import paths.
jest.mock('@/platform/overrides/runtime/instance', () => mockInstanceStore());

jest.mock('@web/api/auth', () => ({
  login: jest.fn(),
  verifyTotp: jest.fn(),
  verifyRecoveryCode: jest.fn(),
  register: jest.fn(),
  verifyEmail: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  isMFAChallenge: (r: { mfa_required?: boolean }) => r?.mfa_required === true,
}));

jest.mock('@web/api/instance', () => ({ checkInstanceInvite: jest.fn() }));

jest.mock('@/platform/reload', () => ({ reloadApp: jest.fn(async () => undefined) }));

jest.mock('@/platform/session', () => {
  const { createSignal } = require('solid-js');
  class InstanceResolveError extends Error {
    code: string;
    host: string;
    constructor(mockCode: string, mockHost: string) {
      super(`${mockCode}: ${mockHost}`);
      this.name = 'InstanceResolveError';
      this.code = mockCode;
      this.host = mockHost;
    }
  }
  const [accounts, setAccounts] = createSignal([] as unknown[]);
  const [activeId, setActiveId] = createSignal(null as string | null);
  return {
    InstanceResolveError,
    currentInstance: jest.fn(() => null),
    suggestedInstance: jest.fn(() => null),
    chooseInstance: jest.fn(),
    finishSignIn: jest.fn((r: { mfa_required?: boolean; mfa_token?: string; methods?: string[] }) =>
      r?.mfa_required
        ? { kind: 'second-factor', mfaToken: r.mfa_token, methods: (r.methods ?? []).filter((m) => m === 'totp') }
        : { kind: 'signed-in' },
    ),
    completeSignIn: jest.fn(),
    signOut: jest.fn(async () => undefined),
    verifySession: jest.fn(async () => ({ state: 'invalid', reason: 'revoked' })),
    switchAccount: jest.fn(async () => undefined),
    addAccount: jest.fn(async () => undefined),
    forgetAccount: jest.fn(async () => undefined),
    peekSignOutNotice: jest.fn(() => null),
    takeSignOutNotice: jest.fn(() => null),
    accounts,
    sortedAccounts: () => accounts(),
    activeAccountId: () => activeId(),
    mockSetAccounts: setAccounts,
    mockSetActiveId: setActiveId,
  };
});

const authEn = require('../../../i18n/areas/auth/en').default;
i18next.addResourceBundle('en', 'translation', { mobile: { auth: authEn } }, true, true);

export {};
