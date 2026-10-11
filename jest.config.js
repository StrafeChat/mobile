/**
 * Unit tests (jest-expo). Tests run in Node with the RN preset; they exercise the platform
 * layer (overrides, the bridge, the crypto RPC) and components without a device. Path
 * aliases match tsconfig/Metro, and jest/resolver.js applies the same override manifest
 * Metro does, so a test that imports a store gets the mobile modules the app gets.
 * Component tests import src/ui/__tests__/setup.ts first (reanimated, gesture handler,
 * bottom sheet and storage mocks).
 */
module.exports = {
  preset: 'jest-expo',
  resolver: '<rootDir>/jest/resolver.js',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx', '<rootDir>/crypto-host/**/*.test.ts'],
  moduleNameMapper: {
    // @web-original/* is mapped to a marker path that jest/resolver.js turns into the real web
    // module WITHOUT applying overrides. It has to be listed (first) here: jest-expo also maps
    // tsconfig's paths, which would hand the resolver a plain web path - and the resolver would
    // send that straight back to the override that asked for the original.
    '^@web-original/(.*)$': '<rootDir>/jest/__web-original__/$1',
    '^@web/(.*)$': '<rootDir>/web/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@matrix-org/matrix-sdk-crypto-wasm$': '<rootDir>/src/platform/crypto/matrixSdkCrypto.ts',
    '^solid-js$': '<rootDir>/node_modules/solid-js/dist/solid.cjs',
    '^solid-js/store$': '<rootDir>/node_modules/solid-js/store/dist/store.cjs',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@livekit/.*|livekit-client|solid-js|@shopify/flash-list|@gorhom/.*|react-native-reanimated|react-native-worklets|react-native-gesture-handler|react-native-mmkv|react-native-nitro-modules|react-native-quick-crypto|react-native-quick-base64|emojibase-data|marked|i18next))',
  ],
};
