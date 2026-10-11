// ESLint flat config: Expo's recommended rules for React Native + TypeScript, applied to the
// app's own code. The web submodule has its own lint config and CI; generated files are skipped.
const { defineConfig } = require('eslint/config');
const globals = require('globals');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'web/**',
      'android/**',
      'ios/**',
      'node_modules/**',
      'assets/crypto/**',
      'src/features/auth/captcha/vendor/scripts.js',
      'dist/**',
      '.expo/**',
    ],
  },
  {
    rules: {
      // The React Compiler is off on purpose (app.json experiments.reactCompiler: false): state
      // lives in Solid store proxies, which mutate in place, and the compiler assumes immutable
      // props. These rules exist to keep code compiler-safe; without the compiler the patterns
      // they flag - the latest-value ref (`ref.current = x` in render), Reanimated shared values
      // assigned in handlers, resetting local state when a prop changes - are ordinary React.
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/use-memo': 'off',
      // Native modules and assets are loaded with require() where Metro needs a static path.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Overrides re-export the web module (`export * from '@web-original/...'`) and replace a few
    // of its exports with local ones; ES modules give the local export precedence, which is
    // exactly the point.
    files: ['src/platform/overrides/**'],
    rules: { 'import/export': 'off' },
  },
  {
    // expo-audio's AudioRecorder is a class on the native module object, not an ES export.
    files: ['src/platform/overrides/media/voiceRecorder.ts'],
    rules: { 'import/namespace': 'off' },
  },
  {
    // The crypto host page imports the wasm bindings through an esbuild alias (crypto-host/build.mjs).
    files: ['crypto-host/**'],
    rules: { 'import/no-unresolved': 'off' },
  },
  {
    // Node-side files: configs, build scripts, the Jest resolver, config plugins.
    files: ['*.js', '**/*.cjs', '**/*.mjs', 'babel/**', 'jest/**', 'plugins/**', 'scripts/**', 'src/platform/overrides/*.manifest.js', 'src/platform/overrides/manifest.js'],
    languageOptions: { globals: { ...globals.node } },
  },
]);
