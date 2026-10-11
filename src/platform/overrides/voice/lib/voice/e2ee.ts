/**
 * Mobile replacement for web/src/lib/voice/e2ee.ts: call media is encrypted by the native
 * frame cryptor with HKDF-derived keys identical to the web's. See
 * src/platform/voice/keyProvider.ts (derivation parity) and e2eeManager.ts.
 */
export { CallKeyProvider, callEncryptionSupported, createE2EEWorker, createCallE2EEManager } from '@/platform/voice/e2ee';
