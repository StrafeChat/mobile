/**
 * The E2EE engine's overrides (merged by ./manifest.js).
 *
 * The engine package resolves to the facade over the crypto host WebView; machine.ts and
 * keyBackup.ts are the two lib/e2ee modules that cannot run as written (IndexedDB in the
 * app's JS context; BackupDecryptionKey's synchronous wasm methods). Every other lib/e2ee
 * module - service, transport, rooms, safety, callKeys, recoveryCode, legacyBackup, subtle -
 * runs unchanged against the facade. See src/platform/crypto/README.md.
 */
module.exports = {
  WEB_MODULE_OVERRIDES: {
    'lib/e2ee/machine': 'src/platform/overrides/e2ee/machine.ts',
    'lib/e2ee/keyBackup': 'src/platform/overrides/e2ee/keyBackup.ts',
  },
  PACKAGE_OVERRIDES: {
    '@matrix-org/matrix-sdk-crypto-wasm': 'src/platform/crypto/matrixSdkCrypto.ts',
  },
};
