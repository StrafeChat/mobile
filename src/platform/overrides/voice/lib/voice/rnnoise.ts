/**
 * Mobile replacement for web/src/lib/voice/rnnoise.ts.
 *
 * RNNoise runs as WebAssembly in an AudioWorklet; Hermes has neither. Calls on a phone use
 * WebRTC's own noise suppressor, on the device (src/platform/voice/micPipeline.ts), so this
 * module only answers "not here" to anything that asks - the settings page, say, deciding
 * whether to offer the RNNoise option.
 */

/** The only sample rate RNNoise's model is trained for. */
export const RNNOISE_SAMPLE_RATE = 48_000;

export function rnnoiseSupported(_ctx?: unknown): boolean {
  return false;
}

export async function createRnnoiseNode(_ctx?: unknown): Promise<never> {
  throw new Error('RNNoise is not available on React Native; WebRTC noise suppression is used');
}
