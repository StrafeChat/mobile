/**
 * Mobile-only strings (es). Everything the web client already says comes from its own locale
 * files (web/src/i18n/locales); this file holds only what exists on mobile alone, under the
 * `mobile.` prefix. Keep all six files in step (npm run check:i18n).
 */
export default {
  mobile: {
    // Design system (src/ui).
    ui: {
      choose: 'Elegir…',
      dismiss: 'Descartar',
      showPassword: 'Mostrar contraseña',
      hidePassword: 'Ocultar contraseña',
      required: 'obligatorio',
      charactersLeft_one: 'Queda {{count}} carácter',
      charactersLeft_other: 'Quedan {{count}} caracteres',
      showActions: 'Mostrar acciones',
      moreOptions: 'Más opciones',
      opensSubmenu: 'Abre más opciones',
    },

    // Browser-bound web modules swapped on mobile (src/platform/overrides).
    webOverrides: {
      passkeyUnavailable: 'Las llaves de acceso aún no están disponibles en la app móvil. Usa tu app de autenticación o un código de recuperación.',
    },

    // Attachments, media and voice messages (src/platform/media).
    media: {
      unsupportedIos: "Este clip no se puede reproducir en iPhone ni iPad. Compártelo para abrirlo en otra app.",
      loadFailed: "No se pudo cargar este archivo adjunto.",
      retry: "Toca para reintentar",
      decryptFailed: "No se pudo descifrar este archivo adjunto.",
      tooLarge: "Este archivo cifrado es demasiado grande para abrirlo en este dispositivo.",
      save: "Guardar en el dispositivo",
      share: "Compartir",
      saved: "Guardado en Fotos.",
      saveDenied: "Permite que Strafe añada fotos en Ajustes para guardar esto.",
      shareUnavailable: "Compartir no está disponible en este dispositivo.",
      cameraDenied: "El acceso a la cámara está desactivado. Actívalo en Ajustes para hacer fotos y vídeos.",
      micDenied: "El acceso al micrófono está desactivado. Actívalo en Ajustes para grabar mensajes de voz.",
      pickFailed: "No se pudo añadir ese archivo.",
    },

    // Start-up and connection state (src/platform/boot.ts).
    boot: {
      startFailed: "Strafe no pudo iniciarse.",
      retry: "Reintentar",
      offlineNotice: "Estás sin conexión. Se muestra lo que hay en este dispositivo.",
    },


    // The end-to-end encryption engine (src/platform/crypto).
    crypto: {
      engineUnavailableTitle: "El cifrado no está disponible",
      engineUnavailableBody: "Strafe no pudo iniciar su motor de cifrado, así que las conversaciones cifradas no se pueden leer ni enviar desde este dispositivo. Reinicia la app para volver a intentarlo.",
    },

    // Push notifications (src/platform/push): the native renderer's strings, then Settings -> Notifications.
    push: {
      appName: "Strafe",
      newMessage: "Nuevo mensaje",
      encryptedMessage: "Mensaje cifrado",
      attachment: "Envió un archivo adjunto",
      spaceRoom: "#{{room}} · {{space}}",
      threadRoom: "{{thread}} · #{{room}}",
      incomingCall: "Llamada entrante",
      callFrom: "{{name}} te está llamando",
      callFromIn: "{{name}} está llamando en {{room}}",
      markRead: "Marcar como leído",
      reply: "Responder",
      answer: "Contestar",
      decline: "Rechazar",
      testTitle: "Las notificaciones push funcionan",
      testBody: "Esto vino de tu instancia, cifrado hasta este dispositivo.",
      channelMessages: "Mensajes",
      channelMessagesSilent: "Mensajes (silencio)",
      channelCalls: "Llamadas entrantes",
      fallback: "Nueva notificación",
      title: "Notificaciones push",
      toggle: "Notificarme con Strafe cerrado",
      statusActive: "Activas · {{transport}}",
      statusRegistering: "Configurando…",
      statusUnavailable: "Esta versión de la app no puede recibir notificaciones push.",
      statusDisabled: "Desactivadas. Solo recibes avisos mientras Strafe está abierto.",
      statusSignedOut: "Inicia sesión para recibir notificaciones push.",
      statusPermission: "Strafe no tiene permiso para mostrar notificaciones. Permítelas en los ajustes del sistema.",
      noTransport: "No hay servicio push en este dispositivo: esta versión no incluye Firebase y no hay ningún distribuidor de UnifiedPush instalado.",
      noTransportChoose: "Hay varios distribuidores de UnifiedPush instalados. Elige uno abajo.",
      noTransportFcm: "Firebase no está disponible en esta versión o en este dispositivo.",
      noTransportMissing: "El distribuidor de UnifiedPush que elegiste ya no está instalado.",
      errorTransport: "{{transport}} no registró este dispositivo ({{error}}).",
      errorGateway: "No se pudo contactar con la pasarela push ({{error}}).",
      errorDistributor: "UnifiedPush no registró este dispositivo ({{error}}).",
      errorInstance: "Tu instancia rechazó este dispositivo ({{error}}).",
      errorUnsupported: "Tu instancia no envía notificaciones push.",
      transportFcm: "Firebase Cloud Messaging",
      transportApns: "Apple Push Notification service",
      transportUnifiedPush: "UnifiedPush ({{distributor}})",
      transportDebug: "Pasarela de desarrollo",
      transportTitle: "Servicio push",
      transportAuto: "Automático",
      transportAutoHint: "Firebase si está disponible; si no, tu distribuidor de UnifiedPush.",
      transportFcmHint: "Entregadas a través de los servicios de Google Play.",
      transportFcmUnavailable: "No disponible en esta versión o en este dispositivo.",
      transportDistributorHint: "UnifiedPush: autoalojable, sin Google.",
      transportDebugHint: "Solo en compilaciones de desarrollo: la pasarela local guarda los push para reproducirlos con adb.",
      test: "Enviar una notificación de prueba",
      testHint: "Tu instancia enviará una a este dispositivo.",
      testSent: "Notificación de prueba enviada.",
      testFailed: "La notificación de prueba no se entregó ({{error}}).",
      testNotRegistered: "Tu instancia aún no conocía este dispositivo. Volviendo a registrarlo.",
      privacyNote: "Tu instancia cifra las notificaciones para este dispositivo; Apple, Google, UnifiedPush y la pasarela push solo transmiten texto cifrado. En las conversaciones cifradas, una notificación dice quién escribió y dónde, nunca qué.",
    },
  },
};
