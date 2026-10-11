/**
 * The call engine's mobile surface, for the voice UI.
 *
 * State and the actions the web also has (join/leave, mute/deafen, camera, screen share,
 * incoming calls, moderation, volumes, stats) are the shared voice store: import them from
 * '@web/stores/voice' exactly as the web components do - on mobile that module is the
 * override in src/platform/overrides/voice/stores/voice.ts. What only a phone needs is
 * exported here.
 */
export {
  setPushToTalkHeld,
  switchCamera,
  cameraFacing,
  screenShareSupported,
  videoTrackRef,
  currentVoiceRoom,
  type CameraFacing,
  type VoiceTrackRef,
} from '@/platform/overrides/voice/stores/voice';
export {
  speakerphone,
  sessionActive as audioSessionActive,
  setSpeakerphone,
  toggleSpeakerphone,
  listAudioOutputs,
  selectAudioRoute,
  showAudioRoutePicker,
  type AudioRoute,
} from './audioSession';
export { callEncryptionSupported } from './e2ee';
export { VoiceVideo, type VoiceVideoProps } from './VoiceVideo';
