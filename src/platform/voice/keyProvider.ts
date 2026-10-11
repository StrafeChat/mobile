/**
 * Call media keys on the native frame cryptor, derived exactly as the web derives them.
 *
 * The web client (web/src/lib/voice/e2ee.ts) gives LiveKit's JS E2EE worker one random
 * 32-byte key per participant identity, at a slot of a 16-slot key ring. The worker turns
 * those bytes into the AES-GCM frame key with `createKeyMaterialFromBuffer` (an HKDF key)
 * and `deriveKeys`:
 *
 *   HKDF-SHA-256(ikm = the 32 raw bytes, salt = UTF-8 "LKFrameEncryptionKey",
 *                info = 128 zero bytes) -> 128-bit AES-GCM key
 *
 * On a phone the frames are encrypted by libwebrtc's FrameCryptor (LiveKit's webrtc-sdk
 * fork), which derives its key from the same raw bytes with whichever algorithm its key
 * provider was created with. @livekit/react-native's RNKeyProvider never passes one, so
 * the native default - PBKDF2, 100 000 iterations - would apply, and a web participant and
 * a mobile one would join the same call and hear nothing from each other. This provider
 * creates the native key provider itself, with HKDF and every other option taken from the
 * same KeyProviderOptions the web provider is built from. The native HKDF is (webrtc-sdk
 * m144, api/crypto/frame_crypto_transformer.cc, DeriveHkdfSha256FromSecret):
 *
 *   ::HKDF(out, 128/8, EVP_sha256(), secret, ratchet_salt, info = std::vector<uint8_t>(128, 0))
 *
 * - the same function with the same salt, info and length. keyProvider.test.ts checks the
 * two derivations against each other and against a fixed vector, and pins the options
 * handed to the native module.
 *
 * Frames themselves (12-byte IV, 2-byte trailer [iv length, key index], codec-dependent
 * clear header bytes, AES-GCM) are the same format in both implementations - that is what
 * lets LiveKit's JS and native SDKs share a call at all; only the derivation is selectable.
 */
import { BaseKeyProvider, type KeyProviderOptions } from 'livekit-client';
import {
  RTCFrameCryptorFactory,
  RTCKeyDerivationAlgorithm,
  type RTCKeyProvider,
  type RTCKeyProviderOptions,
} from '@livekit/react-native-webrtc';
import { MEDIA_KEY_BYTES, MEDIA_KEY_RING_SIZE } from '@web/lib/e2ee/callKeys';

/**
 * The options the web's CallKeyProvider passes to BaseKeyProvider. Everything else
 * (ratchet salt, window, failure tolerance, 128-bit key size) is LiveKit's default on both
 * sides, read back from BaseKeyProvider rather than restated here.
 */
export const WEB_KEY_PROVIDER_OPTIONS: Partial<KeyProviderOptions> = {
  sharedKey: false,
  keyringSize: MEDIA_KEY_RING_SIZE,
};

/** The only frame-key size the native FrameCryptor derives (SetKeyFromMaterial: 128). */
export const NATIVE_FRAME_KEY_BITS = 128;

/** Why a call is refused rather than connected with keys the other side cannot use. */
export class CallKeyConfigurationError extends Error {
  constructor(detail: string) {
    super(`call media keys cannot be configured to match the web client: ${detail}`);
    this.name = 'CallKeyConfigurationError';
  }
}

/**
 * Native key-provider options equivalent to a web KeyProviderOptions. Throws when the
 * native side cannot express them - better no call than one nobody can decrypt.
 */
export function nativeKeyProviderOptions(web: KeyProviderOptions): RTCKeyProviderOptions {
  if (web.keySize !== NATIVE_FRAME_KEY_BITS) {
    throw new CallKeyConfigurationError(`key size ${web.keySize} (native derives ${NATIVE_FRAME_KEY_BITS})`);
  }
  if (web.sharedKey) throw new CallKeyConfigurationError('shared-key mode');
  return {
    sharedKey: false,
    ratchetSalt: web.ratchetSalt,
    ratchetWindowSize: web.ratchetWindowSize,
    failureTolerance: web.failureTolerance,
    keyRingSize: web.keyringSize,
    // An empty frame with no key yet is dropped rather than forwarded as it is. (A frame
    // with content and no key is always dropped once the cryptor is enabled.)
    discardFrameWhenCryptorNotReady: true,
    keyDerivationAlgorithm: RTCKeyDerivationAlgorithm.HKDF,
    // No uncrypted magic bytes: RNKeyProvider defaults them to "LK-ROCKS", which would let
    // any frame ending in those bytes skip decryption. The web only lets through what the
    // SFU marks with the per-room trailer it announces at join, and so does this - the
    // trailer arrives through setSifTrailer.
  };
}

type KeySetListener = (identity: string, keyIndex: number) => void;

/**
 * Per-participant media keys for one call, installed on the native frame cryptor. Same
 * public surface as the web's CallKeyProvider (`setParticipantKey`), plus what the
 * native E2EE manager needs: the newest slot per identity (the native sender encrypts with
 * an explicit key index, where the JS worker follows the last key set) and a hook for when
 * that changes. Dispose it with the call.
 */
export class CallKeyProvider extends BaseKeyProvider {
  private readonly native: RTCKeyProvider;
  private readonly latest = new Map<string, number>();
  private readonly keySetListeners = new Set<KeySetListener>();
  private disposed = false;

  constructor() {
    super(WEB_KEY_PROVIDER_OPTIONS);
    this.native = RTCFrameCryptorFactory.createDefaultKeyProvider(nativeKeyProviderOptions(this.getOptions()));
  }

  /** Install a participant's media key at a key-ring slot. */
  async setParticipantKey(raw: Uint8Array, identity: string, keyIndex: number): Promise<void> {
    if (this.disposed) throw new Error('call key provider already disposed');
    if (raw.length !== MEDIA_KEY_BYTES) throw new Error(`media key must be ${MEDIA_KEY_BYTES} bytes`);
    if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= MEDIA_KEY_RING_SIZE) {
      throw new Error(`key index ${keyIndex} outside the ${MEDIA_KEY_RING_SIZE}-slot ring`);
    }
    // The raw bytes, not derived material: the native side runs the HKDF itself.
    const ok = await this.native.setKey(identity, raw.slice(), keyIndex);
    if (ok === false) throw new Error('native key provider refused the key');
    this.latest.set(identity, keyIndex);
    for (const l of [...this.keySetListeners]) l(identity, keyIndex);
  }

  /** The slot of the key last installed for `identity` (0 before any). */
  latestKeyIndex(identity: string): number {
    return this.latest.get(identity) ?? 0;
  }

  /** Called after every key installed. */
  onKeySet(fn: KeySetListener): () => void {
    this.keySetListeners.add(fn);
    return () => this.keySetListeners.delete(fn);
  }

  /** The server's marker for frames it injects itself (see nativeKeyProviderOptions). */
  async setSifTrailer(trailer: Uint8Array): Promise<void> {
    if (!this.disposed) await this.native.setSifTrailer(trailer);
  }

  /** @internal - the native handle the frame cryptors are created against. */
  get rtcKeyProvider(): RTCKeyProvider {
    return this.native;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.keySetListeners.clear();
    this.latest.clear();
    void this.native.dispose().catch(() => undefined);
  }
}
