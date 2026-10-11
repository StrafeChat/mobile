/**
 * Mobile strings for the voice area (es), read as t('mobile.voice.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  minimize: 'Minimizar llamada',
  openCall: 'Abrir llamada',
  openCallHint: 'Abre la pantalla de la llamada',
  openChat: 'Abrir chat',
  speaking: 'Hablando',
  tileHint: 'Destaca a esta persona. Mantén pulsado para más opciones.',
  flipCamera: 'Cambiar cámara',
  audioOutput: 'Salida de audio',
  route: {
    auto: 'Automática',
    autoHint: 'Bluetooth, luego auriculares, luego el altavoz',
    earpiece: 'Teléfono',
    headset: 'Auriculares',
    bluetooth: 'Bluetooth',
  },
  holdToTalk: 'Mantén pulsado para hablar',
  holdToTalkHint: 'Pulsar para hablar está activado. Mantén pulsado el botón mientras hablas.',
  talking: 'Hablando…',
  sharingScreen: 'Estás compartiendo tu pantalla',
  noiseOn: 'Activada, procesada en este dispositivo',
  enableAudio: 'El audio de la llamada está en pausa.',
  enablePlayback: 'El audio y el vídeo de la llamada están en pausa.',
  enableAction: 'Reanudar',
  switchTitle: '¿Cambiar de llamada?',
  switchBody: 'Estás conectado a {{room}}. Si te unes aquí, te desconectarás de allí.',
  switchConfirm: 'Cambiar',
  disconnectTitle: '¿Desconectar a {{name}}?',
  disconnectBody: 'Se le sacará de esta sala de voz. Podrá volver a unirse después.',
  actionFailed: 'No ha funcionado. Inténtalo de nuevo.',
  viewProfile: 'Ver perfil',
  callInProgress: 'Llamada en curso',
  inThisCall: 'Estás en esta llamada',
  micOffJoin: 'El acceso al micrófono está desactivado, así que nadie te oirá. Actívalo en Ajustes para hablar.',
  cameraOffJoin: 'El acceso a la cámara está desactivado, así que te unirás sin vídeo. Actívalo en Ajustes para compartir vídeo.',
  errors: {
    e2eeUnsupported:
      'Este dispositivo no puede cifrar llamadas, así que no puede unirse. Las llamadas tienen cifrado de extremo a extremo y nunca se envían sin cifrar.',
    micDenied: 'Se denegó el acceso al micrófono. Actívalo en Ajustes para hablar.',
    cameraDenied: 'Se denegó el acceso a la cámara. Actívalo en Ajustes para compartir vídeo.',
  },
};
