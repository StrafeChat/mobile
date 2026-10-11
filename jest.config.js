/**
 * Unit tests (jest-expo). Tests run in Node with the RN preset; they exercise the platform
 * layer (overrides, the bridge, the crypto RPC) without a device. Path aliases match
 * tsconfig/Metro. Metro's override redirects do not apply here - a test that needs one
 * maps it explicitly with jest.mock or moduleNameMapper.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx', '<rootDir>/crypto-host/**/*.test.ts'],
  moduleNameMapper: {
    '^@web-original/(.*)$': '<rootDir>/web/src/$1',
    '^@web/(.*)$': '<rootDir>/web/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^solid-js$': '<rootDir>/node_modules/solid-js/dist/solid.cjs',
    '^solid-js/store$': '<rootDir>/node_modules/solid-js/store/dist/store.cjs',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@livekit/.*|livekit-client|solid-js|@shopify/flash-list|@gorhom/.*|react-native-reanimated|react-native-worklets|react-native-gesture-handler|react-native-mmkv|react-native-nitro-modules|react-native-quick-crypto|react-native-quick-base64|emojibase-data|marked|i18next))',
  ],
};
