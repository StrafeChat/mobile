/**
 * The engine's .wasm, read from the app's assets as base64 for the boot (host.ts slices it
 * into `host.wasmChunk` calls).
 *
 * It ships as a Metro asset (assets/crypto, written by crypto-host/build.mjs) rather than
 * inside the JS bundle: 7.8 MB of wasm would be 10 MB of string literal in every bundle and
 * every dev reload. expo-asset resolves it to a local file (bundled in release builds,
 * downloaded from Metro in development) and expo-file-system reads it.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

 
const ENGINE_WASM = require('../../../assets/crypto/matrix_sdk_crypto_wasm_bg.wasm') as number;

export async function loadEngineWasmBase64(): Promise<string> {
  const asset = Asset.fromModule(ENGINE_WASM);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error('the crypto engine asset has no local file');
  return new File(uri).base64();
}
