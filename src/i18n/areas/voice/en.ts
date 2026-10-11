/**
 * Mobile strings for the voice area (en), read as t('mobile.voice.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  minimize: 'Minimize call',
  openCall: 'Open call',
  openCallHint: 'Opens the call screen',
  openChat: 'Open chat',
  speaking: 'Speaking',
  tileHint: 'Spotlights this person. Long press for more options.',
  flipCamera: 'Flip camera',
  audioOutput: 'Audio output',
  route: {
    auto: 'Automatic',
    autoHint: 'Bluetooth, then headphones, then the speaker',
    earpiece: 'Phone',
    headset: 'Headphones',
    bluetooth: 'Bluetooth',
  },
  holdToTalk: 'Hold to talk',
  holdToTalkHint: 'Push to talk is on. Hold the button while you speak.',
  talking: 'Talking…',
  sharingScreen: "You're sharing your screen",
  noiseOn: 'On, processed on this device',
  enableAudio: 'Call audio is paused.',
  enablePlayback: 'Call audio and video are paused.',
  enableAction: 'Resume',
  switchTitle: 'Switch calls?',
  switchBody: "You're connected to {{room}}. Joining here disconnects you from it.",
  switchConfirm: 'Switch',
  disconnectTitle: 'Disconnect {{name}}?',
  disconnectBody: 'They will be removed from this voice room. They can join again afterwards.',
  actionFailed: "That didn't work. Try again.",
  viewProfile: 'View profile',
  callInProgress: 'Call in progress',
  inThisCall: "You're in this call",
  micOffJoin: "Microphone access is off, so nobody will hear you. Turn it on in Settings to talk.",
  cameraOffJoin: "Camera access is off, so you'll join without video. Turn it on in Settings to share video.",
  errors: {
    e2eeUnsupported:
      "This device can't encrypt calls, so it can't join. Calls are end-to-end encrypted and are never sent unencrypted.",
    micDenied: 'Microphone access was denied. Turn it on in Settings to talk.',
    cameraDenied: 'Camera access was denied. Turn it on in Settings to share video.',
  },
};
