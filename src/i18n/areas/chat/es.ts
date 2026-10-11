/**
 * Textos móviles del área de chat (es), leídos como t('mobile.chat.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  listLabel: 'Mensajes',
  messageHint: 'Mantén pulsado para ver acciones; desliza a la izquierda para responder',
  openProfile: 'Abre su perfil',
  jumpToUnread: 'Salta al primer mensaje sin leer',
  emojiUnavailable: 'Este emoji ya no está disponible',
  videoUnplayable: 'Este vídeo no se puede reproducir en este dispositivo.',
  audioUnplayable: 'Este archivo no se puede reproducir en este dispositivo. Compártelo para abrirlo en otra app.',
  fileOpenHint: 'Abre el menú de compartir para abrir o guardar el archivo',
  link: {
    open: 'Abrir enlace',
    copy: 'Copiar enlace',
  },
  reactions: {
    title: 'Reacciones',
    none: 'No hay nadie que mostrar.',
  },
};
