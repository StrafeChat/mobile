/**
 * Mobile counterpart of web/src/lib/voice/e2ee.ts: whether this device can encrypt call
 * media, and the per-call key provider. Same exports, so code written against the web
 * module works unchanged; `createE2EEWorker` has no meaning natively (frames are encrypted
 * by libwebrtc's FrameCryptor, not a worker) and is replaced by `createCallE2EEManager`.
 */
import { NativeModules } from 'react-native';
import { CallKeyProvider } from './keyProvider';
import { ensureLiveKitGlobals } from './runtime';

export { CallKeyProvider } from './keyProvider';
export { CallE2EEManager, createCallE2EEManager } from './e2eeManager';

let probed: boolean | null = null;

/**
 * Whether calls can be end-to-end encrypted here. Not a feature flag: a key provider is
 * actually created with the exact options calls use (HKDF, 16 slots, 128-bit keys) and
 * thrown away, so a native build that lacks frame encryption, or cannot be configured to
 * match the web client, answers false - and joinVoiceRoom then refuses the call
 * (CallEncryptionUnsupportedError) instead of connecting it in the clear.
 */
export function callEncryptionSupported(): boolean {
  if (probed !== null) return probed;
  try {
    ensureLiveKitGlobals();
    const mod = (NativeModules as { WebRTCModule?: Record<string, unknown> }).WebRTCModule;
    const needed = [
      'frameCryptorFactoryCreateKeyProvider',
      'frameCryptorFactoryCreateFrameCryptor',
      'frameCryptorSetKeyIndex',
      'frameCryptorSetEnabled',
      'keyProviderSetKey',
    ];
    if (!mod || needed.some((m) => typeof mod[m] !== 'function')) {
      probed = false;
      return probed;
    }
    new CallKeyProvider().dispose();
    probed = true;
  } catch (err) {
    console.warn('[voice-e2ee] call encryption unavailable', err);
    probed = false;
  }
  return probed;
}

/**
 * Kept for the web module's export list. Nothing on mobile calls it: a call's frames are
 * encrypted natively (createCallE2EEManager), and a Worker does not exist in Hermes.
 */
export function createE2EEWorker(): Worker {
  throw new Error('no E2EE worker on React Native; use createCallE2EEManager');
}
