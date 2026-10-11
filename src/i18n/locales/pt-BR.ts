/**
 * Mobile-only strings (pt-BR). Everything the web client already says comes from its own locale
 * files (web/src/i18n/locales); this file holds only what exists on mobile alone, under the
 * `mobile.` prefix. Keep all six files in step (npm run check:i18n).
 */
export default {
  mobile: {
    // Design system (src/ui).
    ui: {
      choose: 'Escolher…',
      dismiss: 'Dispensar',
      showPassword: 'Mostrar senha',
      hidePassword: 'Ocultar senha',
      required: 'obrigatório',
      charactersLeft_one: '{{count}} caractere restante',
      charactersLeft_other: '{{count}} caracteres restantes',
      showActions: 'Mostrar ações',
      moreOptions: 'Mais opções',
      opensSubmenu: 'Abre mais opções',
    },

    // Browser-bound web modules swapped on mobile (src/platform/overrides).
    webOverrides: {
      passkeyUnavailable: 'Chaves de acesso ainda não estão disponíveis no app para celular. Use o seu app autenticador ou um código de recuperação.',
    },

    // Attachments, media and voice messages (src/platform/media).
    media: {
      unsupportedIos: "Este clipe não pode ser reproduzido no iPhone ou iPad. Compartilhe para abrir em outro app.",
      loadFailed: "Não foi possível carregar este anexo.",
      retry: "Toque para tentar de novo",
      decryptFailed: "Não foi possível descriptografar este anexo.",
      tooLarge: "Este arquivo criptografado é grande demais para abrir neste dispositivo.",
      save: "Salvar no dispositivo",
      share: "Compartilhar",
      saved: "Salvo em Fotos.",
      saveDenied: "Permita que o Strafe adicione fotos nos Ajustes para salvar isto.",
      shareUnavailable: "O compartilhamento não está disponível neste dispositivo.",
      cameraDenied: "O acesso à câmera está desativado. Ative-o nos Ajustes para tirar fotos e gravar vídeos.",
      micDenied: "O acesso ao microfone está desativado. Ative-o nos Ajustes para gravar mensagens de voz.",
      pickFailed: "Não foi possível adicionar esse arquivo.",
    },

    // Start-up and connection state (src/platform/boot.ts).
    boot: {
      startFailed: "Não foi possível iniciar o Strafe.",
      retry: "Tentar de novo",
      offlineNotice: "Você está offline. Mostrando o que está neste dispositivo.",
    },


    // The end-to-end encryption engine (src/platform/crypto).
    crypto: {
      engineUnavailableTitle: "A criptografia não está disponível",
      engineUnavailableBody: "O Strafe não conseguiu iniciar o mecanismo de criptografia, então conversas criptografadas não podem ser lidas nem enviadas deste dispositivo. Reinicie o app para tentar de novo.",
    },
  },
};
