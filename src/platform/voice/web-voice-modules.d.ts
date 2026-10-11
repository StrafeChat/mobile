/**
 * Type declarations for the Vite-only imports inside the web's voice modules.
 *
 * TypeScript follows `@web/stores/voice` to the web's own files (it does not know about
 * Metro's overrides), and those import an RNNoise package and `?worker` / `?url` assets
 * that only Vite understands. Nothing on mobile runs them - Metro swaps every such module
 * for src/platform/overrides/voice/** - but without these shapes the type check of the
 * shared sources fails. Types only; no runtime effect.
 */
declare module 'livekit-client/e2ee-worker?worker' {
  const E2EEWorker: new () => Worker;
  export default E2EEWorker;
}

declare module '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url' {
  const url: string;
  export default url;
}

declare module '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url' {
  const url: string;
  export default url;
}

declare module '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url' {
  const url: string;
  export default url;
}

declare module '@sapphi-red/web-noise-suppressor' {
  export function loadRnnoise(opts: { url: string; simdUrl: string }): Promise<ArrayBuffer>;
  export class RnnoiseWorkletNode extends AudioWorkletNode {
    constructor(context: BaseAudioContext, options: { maxChannels: number; wasmBinary: ArrayBuffer });
    destroy(): void;
  }
}
