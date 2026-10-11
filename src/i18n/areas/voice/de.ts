/**
 * Mobile strings for the voice area (de), read as t('mobile.voice.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  minimize: 'Anruf minimieren',
  openCall: 'Anruf öffnen',
  openCallHint: 'Öffnet den Anrufbildschirm',
  openChat: 'Chat öffnen',
  speaking: 'Spricht',
  tileHint: 'Hebt diese Person hervor. Lange drücken für weitere Optionen.',
  flipCamera: 'Kamera wechseln',
  audioOutput: 'Audioausgabe',
  route: {
    auto: 'Automatisch',
    autoHint: 'Bluetooth, dann Kopfhörer, dann Lautsprecher',
    earpiece: 'Telefon',
    headset: 'Kopfhörer',
    bluetooth: 'Bluetooth',
  },
  holdToTalk: 'Zum Sprechen halten',
  holdToTalkHint: 'Push-to-Talk ist an. Halte die Taste gedrückt, während du sprichst.',
  talking: 'Du sprichst…',
  sharingScreen: 'Du teilst deinen Bildschirm',
  noiseOn: 'An, auf diesem Gerät verarbeitet',
  enableAudio: 'Der Ton des Anrufs ist pausiert.',
  enablePlayback: 'Ton und Video des Anrufs sind pausiert.',
  enableAction: 'Fortsetzen',
  switchTitle: 'Anruf wechseln?',
  switchBody: 'Du bist mit {{room}} verbunden. Wenn du hier beitrittst, wirst du dort getrennt.',
  switchConfirm: 'Wechseln',
  disconnectTitle: '{{name}} trennen?',
  disconnectBody: 'Die Person wird aus diesem Sprachraum entfernt. Sie kann danach wieder beitreten.',
  actionFailed: 'Das hat nicht geklappt. Versuch es noch einmal.',
  viewProfile: 'Profil ansehen',
  callInProgress: 'Anruf läuft',
  inThisCall: 'Du bist in diesem Anruf',
  micOffJoin: 'Der Mikrofonzugriff ist aus, niemand wird dich hören. Schalte ihn in den Einstellungen ein, um zu sprechen.',
  cameraOffJoin: 'Der Kamerazugriff ist aus, du trittst ohne Video bei. Schalte ihn in den Einstellungen ein, um Video zu teilen.',
  errors: {
    e2eeUnsupported:
      'Dieses Gerät kann Anrufe nicht verschlüsseln und daher nicht beitreten. Anrufe sind Ende-zu-Ende-verschlüsselt und werden nie unverschlüsselt gesendet.',
    micDenied: 'Der Mikrofonzugriff wurde verweigert. Schalte ihn in den Einstellungen ein, um zu sprechen.',
    cameraDenied: 'Der Kamerazugriff wurde verweigert. Schalte ihn in den Einstellungen ein, um Video zu teilen.',
  },
};
