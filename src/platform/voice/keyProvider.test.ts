/**
 * Call-key derivation parity between the web client and the native frame cryptor.
 *
 * Web path: livekit-client's own createKeyMaterialFromBuffer + deriveKeys, with the options
 * the web's CallKeyProvider builds (BaseKeyProvider({ sharedKey: false, keyringSize: 16 })).
 * Native path: what libwebrtc's FrameCryptor computes from the options this app hands the
 * native module - HKDF-SHA-256(raw, salt = options.ratchetSalt, info = 128 zero bytes,
 * 128 bits), per webrtc-sdk m144 api/crypto/frame_crypto_transformer.cc - recomputed here
 * with Node's crypto from the captured options. Both keys encrypt the same block; equal
 * ciphertext means equal keys. A fixed vector pins the result.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createCipheriv, hkdfSync, pbkdf2Sync, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

/** The enum values exactly as react-native-webrtc's TypeScript defines them. */
function mockEnumFromSource(name: string): Record<string, number> {
  // Plain requires: this runs inside a hoisted jest.mock factory, before the imports above.
  const fs = require('node:fs') as typeof import('node:fs');
  const p = require('node:path') as typeof import('node:path');
  const file = p.resolve(__dirname, '../../../node_modules/@livekit/react-native-webrtc/src/RTCFrameCryptorFactory.ts');
  const src = fs.readFileSync(file, 'utf8');
  const body = new RegExp(`export enum ${name} \\{([^}]*)\\}`).exec(src)?.[1] ?? '';
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/(\w+)\s*=\s*(\d+)/g)) out[m[1]!] = Number(m[2]);
  return out;
}

const mockCreated: Record<string, unknown>[] = [];
const mockSetKeyCalls: { participantId: string; key: Uint8Array; keyIndex: number }[] = [];

jest.mock('@livekit/react-native-webrtc', () => ({
  RTCKeyDerivationAlgorithm: mockEnumFromSource('RTCKeyDerivationAlgorithm'),
  RTCFrameCryptorAlgorithm: mockEnumFromSource('RTCFrameCryptorAlgorithm'),
  RTCFrameCryptorFactory: {
    createDefaultKeyProvider: (opts: Record<string, unknown>) => {
      mockCreated.push(opts);
      return {
        _id: `kp${mockCreated.length}`,
        setKey: async (participantId: string, key: Uint8Array, keyIndex: number) => {
          mockSetKeyCalls.push({ participantId, key, keyIndex });
          return true;
        },
        setSifTrailer: async () => undefined,
        dispose: async () => undefined,
      };
    },
  },
}));

// callKeys.ts pulls in the Olm engine; only its two constants matter here, and they are
// checked against the web source below.
jest.mock('@web/lib/e2ee/callKeys', () => ({ MEDIA_KEY_BYTES: 32, MEDIA_KEY_RING_SIZE: 16 }));

// livekit-client's E2EE helpers use the global WebCrypto.
const g = globalThis as { crypto?: unknown };
if (!(g.crypto as { subtle?: unknown } | undefined)?.subtle) g.crypto = webcrypto;

// eslint-disable-next-line import/first
import { BaseKeyProvider, createKeyMaterialFromBuffer, deriveKeys } from 'livekit-client';
// eslint-disable-next-line import/first
import { CallKeyProvider, nativeKeyProviderOptions, CallKeyConfigurationError, WEB_KEY_PROVIDER_OPTIONS } from './keyProvider';

/** The web's provider options, built the way web/src/lib/voice/e2ee.ts builds them. */
function webOptions() {
  return new BaseKeyProvider({ sharedKey: false, keyringSize: 16 }).getOptions();
}

/** libwebrtc's DeriveHkdfSha256FromSecret, as configured by the options we send. */
function nativeDerive(raw: Uint8Array, opts: { ratchetSalt: string | Uint8Array; keyDerivationAlgorithm?: number }): Buffer {
  expect(opts.keyDerivationAlgorithm).toBe(mockEnumFromSource('RTCKeyDerivationAlgorithm').HKDF);
  const salt = typeof opts.ratchetSalt === 'string' ? Buffer.from(opts.ratchetSalt, 'utf8') : Buffer.from(opts.ratchetSalt);
  return Buffer.from(hkdfSync('sha256', raw, salt, Buffer.alloc(128, 0), 128 / 8));
}

const IV = new Uint8Array(12).fill(7);
const BLOCK = new TextEncoder().encode('strafe call frame parity check');

async function encryptWithWebKey(raw: Uint8Array): Promise<Buffer> {
  const material = await createKeyMaterialFromBuffer(raw.slice().buffer as ArrayBuffer);
  const { encryptionKey } = await deriveKeys(material, webOptions());
  const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: IV }, encryptionKey as webcrypto.CryptoKey, BLOCK);
  return Buffer.from(ct);
}

function encryptWithKey(key: Buffer): Buffer {
  expect(key.length).toBe(16);
  const cipher = createCipheriv('aes-128-gcm', key, IV);
  return Buffer.concat([cipher.update(BLOCK), cipher.final(), cipher.getAuthTag()]);
}

const RAW = Uint8Array.from({ length: 32 }, (_, i) => i);
/** HKDF-SHA-256(00..1f, "LKFrameEncryptionKey", 128 x 00) -> 16 bytes. */
const EXPECTED_KEY_HEX = '6d0dd7b3d6f4efde47ab9a9e15abde76';

describe('call key derivation parity (web JS worker vs native FrameCryptor)', () => {
  beforeEach(() => {
    mockCreated.length = 0;
    mockSetKeyCalls.length = 0;
  });

  it('builds the same provider options the web does', () => {
    const provider = new CallKeyProvider();
    const web = webOptions();
    expect(provider.getOptions()).toEqual(web);
    expect(WEB_KEY_PROVIDER_OPTIONS).toEqual({ sharedKey: false, keyringSize: 16 });
    expect(web.keySize).toBe(128);
    expect(web.ratchetSalt).toBe('LKFrameEncryptionKey');
  });

  it('configures the native key provider for HKDF, a 16-slot ring and no plaintext pass-through', () => {
    new CallKeyProvider();
    expect(mockCreated).toHaveLength(1);
    const opts = mockCreated[0]!;
    expect(opts).toEqual({
      sharedKey: false,
      ratchetSalt: 'LKFrameEncryptionKey',
      ratchetWindowSize: webOptions().ratchetWindowSize,
      failureTolerance: webOptions().failureTolerance,
      keyRingSize: 16,
      discardFrameWhenCryptorNotReady: true,
      keyDerivationAlgorithm: mockEnumFromSource('RTCKeyDerivationAlgorithm').HKDF,
    });
    expect(opts).not.toHaveProperty('uncryptedMagicBytes');
  });

  it('derives the same frame key on both sides (fixed vector)', async () => {
    const opts = nativeKeyProviderOptions(webOptions()) as { ratchetSalt: string; keyDerivationAlgorithm?: number };
    const nativeKey = nativeDerive(RAW, opts);
    expect(nativeKey.toString('hex')).toBe(EXPECTED_KEY_HEX);
    expect((await encryptWithWebKey(RAW)).equals(encryptWithKey(nativeKey))).toBe(true);
  });

  it('derives the same frame key on both sides (random keys)', async () => {
    const opts = nativeKeyProviderOptions(webOptions()) as { ratchetSalt: string; keyDerivationAlgorithm?: number };
    for (let i = 0; i < 8; i++) {
      const raw = webcrypto.getRandomValues(new Uint8Array(32));
      expect((await encryptWithWebKey(raw)).equals(encryptWithKey(nativeDerive(raw, opts)))).toBe(true);
    }
  });

  it('would NOT match under the native default (PBKDF2) - the reason HKDF is set explicitly', async () => {
    const pbkdf2Key = pbkdf2Sync(Buffer.from(RAW), 'LKFrameEncryptionKey', 100_000, 16, 'sha256');
    expect((await encryptWithWebKey(RAW)).equals(encryptWithKey(pbkdf2Key))).toBe(false);
  });

  it('refuses option sets the native side cannot express', () => {
    expect(() => nativeKeyProviderOptions({ ...webOptions(), keySize: 256 })).toThrow(CallKeyConfigurationError);
    expect(() => nativeKeyProviderOptions({ ...webOptions(), sharedKey: true })).toThrow(CallKeyConfigurationError);
  });

  it('hands the raw key to the native provider per identity and slot, and tracks the newest slot', async () => {
    const provider = new CallKeyProvider();
    const seen: [string, number][] = [];
    provider.onKeySet((id, idx) => seen.push([id, idx]));
    await provider.setParticipantKey(RAW, 'u1.s1', 0);
    await provider.setParticipantKey(RAW, 'u1.s1', 5);
    expect(mockSetKeyCalls.map((c) => [c.participantId, c.keyIndex])).toEqual([
      ['u1.s1', 0],
      ['u1.s1', 5],
    ]);
    expect(Array.from(mockSetKeyCalls[0]!.key)).toEqual(Array.from(RAW));
    expect(provider.latestKeyIndex('u1.s1')).toBe(5);
    expect(provider.latestKeyIndex('other')).toBe(0);
    expect(seen).toEqual([
      ['u1.s1', 0],
      ['u1.s1', 5],
    ]);
  });

  it('rejects malformed keys and slots', async () => {
    const provider = new CallKeyProvider();
    await expect(provider.setParticipantKey(new Uint8Array(16), 'a', 0)).rejects.toThrow();
    await expect(provider.setParticipantKey(RAW, 'a', 16)).rejects.toThrow();
    await expect(provider.setParticipantKey(RAW, 'a', -1)).rejects.toThrow();
    provider.dispose();
    await expect(provider.setParticipantKey(RAW, 'a', 0)).rejects.toThrow();
  });

  it('matches the web constants it mocks', () => {
    const src = readFileSync(path.join(ROOT, 'web/src/lib/e2ee/callKeys.ts'), 'utf8');
    expect(src).toMatch(/export const MEDIA_KEY_BYTES = 32;/);
    expect(src).toMatch(/export const MEDIA_KEY_RING_SIZE = 16;/);
    // And the web provider is still the one these options mirror.
    const e2ee = readFileSync(path.join(ROOT, 'web/src/lib/voice/e2ee.ts'), 'utf8');
    expect(e2ee).toMatch(/super\(\{ sharedKey: false, keyringSize: MEDIA_KEY_RING_SIZE \}\)/);
    expect(e2ee).toMatch(/createKeyMaterialFromBuffer\(bytes\)/);
  });
});
