/**
 * Textos móveis da área de chat (pt-BR), lidos como t('mobile.chat.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  listLabel: 'Mensagens',
  loadFailed: 'Não foi possível carregar as mensagens.',
  messageHint: 'Toque e segure para ver ações; deslize para a esquerda para responder',
  openProfile: 'Abre o perfil',
  openProfileOf: 'Abrir perfil: {{name}}',
  jumpToUnread: 'Vai para a primeira mensagem não lida',
  emojiUnavailable: 'Este emoji não está mais disponível',
  videoUnplayable: 'Este vídeo não pode ser reproduzido neste dispositivo.',
  audioUnplayable: 'Este arquivo não pode ser reproduzido neste dispositivo. Compartilhe para abri-lo em outro app.',
  fileOpenHint: 'Abre o menu de compartilhamento para abrir ou salvar o arquivo',
  link: {
    open: 'Abrir link',
    copy: 'Copiar link',
    openNamed: 'Abrir link: {{link}}',
    openImage: 'Abrir imagem: {{name}}',
  },
  copyCode: 'Copiar código',
  reactions: {
    title: 'Reações',
    none: 'Ninguém para mostrar.',
  },
};
