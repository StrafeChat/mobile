/**
 * Mobile strings for the voice area (pt-BR), read as t('mobile.voice.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  minimize: 'Minimizar chamada',
  openCall: 'Abrir chamada',
  openCallHint: 'Abre a tela da chamada',
  openChat: 'Abrir conversa',
  speaking: 'Falando',
  tileHint: 'Destaca esta pessoa. Toque e segure para mais opções.',
  flipCamera: 'Virar câmera',
  audioOutput: 'Saída de áudio',
  route: {
    auto: 'Automática',
    autoHint: 'Bluetooth, depois fones de ouvido, depois o alto-falante',
    earpiece: 'Telefone',
    headset: 'Fones de ouvido',
    bluetooth: 'Bluetooth',
  },
  holdToTalk: 'Segure para falar',
  holdToTalkHint: 'Apertar para falar está ativado. Segure o botão enquanto fala.',
  talking: 'Falando…',
  sharingScreen: 'Você está compartilhando sua tela',
  noiseOn: 'Ativada, processada neste dispositivo',
  enableAudio: 'O áudio da chamada está pausado.',
  enablePlayback: 'O áudio e o vídeo da chamada estão pausados.',
  enableAction: 'Retomar',
  switchTitle: 'Trocar de chamada?',
  switchBody: 'Você está conectado a {{room}}. Entrar aqui desconecta você de lá.',
  switchConfirm: 'Trocar',
  disconnectTitle: 'Desconectar {{name}}?',
  disconnectBody: 'A pessoa será removida desta sala de voz. Ela poderá entrar de novo depois.',
  actionFailed: 'Não deu certo. Tente de novo.',
  viewProfile: 'Ver perfil',
  callInProgress: 'Chamada em andamento',
  inThisCall: 'Você está nesta chamada',
  micOffJoin: 'O acesso ao microfone está desativado, então ninguém vai ouvir você. Ative-o nos Ajustes para falar.',
  cameraOffJoin: 'O acesso à câmera está desativado, então você vai entrar sem vídeo. Ative-o nos Ajustes para compartilhar vídeo.',
  errors: {
    e2eeUnsupported:
      'Este dispositivo não consegue criptografar chamadas, então não pode entrar. As chamadas têm criptografia de ponta a ponta e nunca são enviadas sem criptografia.',
    micDenied: 'O acesso ao microfone foi negado. Ative-o nos Ajustes para falar.',
    cameraDenied: 'O acesso à câmera foi negado. Ative-o nos Ajustes para compartilhar vídeo.',
  },
};
