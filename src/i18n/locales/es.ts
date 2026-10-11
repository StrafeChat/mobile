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

    // Sign-in and accounts (src/features/auth).
    auth: {
      sessionExpiredNotice: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
    },

    // The end-to-end encryption engine (src/platform/crypto).
    crypto: {
      engineUnavailableTitle: "El cifrado no está disponible",
      engineUnavailableBody: "Strafe no pudo iniciar su motor de cifrado, así que las conversaciones cifradas no se pueden leer ni enviar desde este dispositivo. Reinicia la app para volver a intentarlo.",
    },
  },
};
