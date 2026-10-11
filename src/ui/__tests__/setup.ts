/// <reference types="jest" />
/**
 * Shared environment for the design-system tests. Import it FIRST in a test file: its
 * jest.mock calls register before the components (and the web modules behind them) load.
 *
 * - Reanimated / worklets / gesture-handler / safe-area: their official jest mocks.
 * - @gorhom/bottom-sheet: a small stand-in whose modal really presents and dismisses (the
 *   library's own mock renders children always and never calls onDismiss, which would hide
 *   exactly the close-then-run behaviour the action sheet tests are about).
 * - The web i18n index re-exports Solid components; Metro swaps it for the mobile override,
 *   jest does not, so it is mapped here the same way.
 * - MMKV has no native module under jest: app storage is an in-memory map.
 * - i18next is initialised with the real English strings (web + mobile), so labels in
 *   assertions read as users would hear them.
 */
 
import i18next from 'i18next';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
require('react-native-gesture-handler/jestSetup');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('../../../web/src/i18n/index', () => jest.requireActual('../../platform/overrides/i18n/index'));

jest.mock('../../platform/storage', () => {
  const make = () => {
    const m = new Map<string, unknown>();
    return {
      getBoolean: (k: string) => m.get(k) as boolean | undefined,
      getString: (k: string) => m.get(k) as string | undefined,
      getNumber: (k: string) => m.get(k) as number | undefined,
      set: (k: string, v: unknown) => void m.set(k, v),
      remove: (k: string) => void m.delete(k),
      getAllKeys: () => [...m.keys()],
      clearAll: () => m.clear(),
    };
  };
  return { webStorage: make(), appStorage: make() };
});

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  AndroidHaptics: {
    Confirm: 'confirm',
    Reject: 'reject',
    Long_Press: 'long-press',
    Segment_Tick: 'segment-tick',
    Toggle_On: 'toggle-on',
    Toggle_Off: 'toggle-off',
  },
}));

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const RN = require('react-native');
  const base = require('@gorhom/bottom-sheet/mock');
  const BottomSheetModal = React.forwardRef(function BottomSheetModal(
    props: { children?: unknown; onDismiss?: () => void; testID?: string },
    ref: unknown,
  ) {
    const [open, setOpen] = React.useState(false);
    const onDismiss = React.useRef(props.onDismiss);
    onDismiss.current = props.onDismiss;
    const openRef = React.useRef(false);
    React.useImperativeHandle(ref, () => ({
      present: () => {
        openRef.current = true;
        setOpen(true);
      },
      dismiss: () => {
        if (!openRef.current) return;
        openRef.current = false;
        setOpen(false);
        onDismiss.current?.();
      },
      close: () => undefined,
      forceClose: () => undefined,
      snapToIndex: () => undefined,
      expand: () => undefined,
      collapse: () => undefined,
    }));
    return open ? React.createElement(RN.View, { testID: 'bottom-sheet-modal' }, props.children) : null;
  });
  const passthrough = (p: { children?: unknown }) => React.createElement(RN.View, p, p.children);
  return {
    ...base,
    __esModule: true,
    BottomSheetModal,
    BottomSheetView: passthrough,
    BottomSheetScrollView: RN.ScrollView,
    BottomSheetBackdrop: () => null,
    BottomSheetTextInput: RN.TextInput,
  };
});

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] =
      v && typeof v === 'object' && prev && typeof prev === 'object'
        ? deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

const webEn = require('../../../web/src/i18n/locales/en').default;
const mobileEn = require('../../i18n/locales/en').default;
const { bindI18nReactivity } = require('../../../web/src/i18n/t');
bindI18nReactivity();
void i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: deepMerge(webEn, mobileEn) } },
  interpolation: { escapeValue: false },
  initAsync: false,
  returnNull: false,
  showSupportNotice: false,
} as Parameters<typeof i18next.init>[0]);
