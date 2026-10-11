/**
 * Mobile replacement for web/src/lib/voice/micPipeline.ts: WebRTC's on-device processing
 * instead of a Web Audio graph. See src/platform/voice/micPipeline.ts.
 */
export {
  createMicPipeline,
  createVadGate,
  createVoiceAudioContext,
  type MicPipeline,
  type MicPipelineOptions,
} from '@/platform/voice/micPipeline';
