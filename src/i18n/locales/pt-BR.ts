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

    // Push notifications (src/platform/push): the native renderer's strings, then Settings -> Notifications.
    push: {
      appName: "Strafe",
      newMessage: "Nova mensagem",
      encryptedMessage: "Mensagem criptografada",
      attachment: "Enviou um anexo",
      spaceRoom: "#{{room}} · {{space}}",
      threadRoom: "{{thread}} · #{{room}}",
      incomingCall: "Chamada recebida",
      callFrom: "{{name}} está ligando",
      callFromIn: "{{name}} está ligando em {{room}}",
      markRead: "Marcar como lida",
      reply: "Responder",
      answer: "Atender",
      decline: "Recusar",
      testTitle: "As notificações push funcionam",
      testBody: "Isto veio da sua instância, criptografado até este dispositivo.",
      channelMessages: "Mensagens",
      channelMessagesSilent: "Mensagens (silenciosas)",
      channelCalls: "Chamadas recebidas",
      fallback: "Nova notificação",
      title: "Notificações push",
      toggle: "Notificar com o Strafe fechado",
      statusActive: "Ativas · {{transport}}",
      statusRegistering: "Configurando…",
      statusUnavailable: "Esta versão do app não pode receber notificações push.",
      statusDisabled: "Desativadas. Você só é notificado com o Strafe aberto.",
      statusSignedOut: "Entre para receber notificações push.",
      statusPermission: "O Strafe não tem permissão para mostrar notificações. Permita nas configurações do sistema.",
      noTransport: "Nenhum serviço push neste dispositivo: esta versão não tem Firebase e nenhum distribuidor UnifiedPush está instalado.",
      noTransportChoose: "Há vários distribuidores UnifiedPush instalados. Escolha um abaixo.",
      noTransportFcm: "O Firebase não está disponível nesta versão ou neste dispositivo.",
      noTransportMissing: "O distribuidor UnifiedPush que você escolheu não está mais instalado.",
      errorTransport: "{{transport}} não registrou este dispositivo ({{error}}).",
      errorGateway: "Não foi possível acessar o gateway push ({{error}}).",
      errorDistributor: "O UnifiedPush não registrou este dispositivo ({{error}}).",
      errorInstance: "Sua instância recusou este dispositivo ({{error}}).",
      errorUnsupported: "Sua instância não envia notificações push.",
      transportFcm: "Firebase Cloud Messaging",
      transportApns: "Apple Push Notification service",
      transportUnifiedPush: "UnifiedPush ({{distributor}})",
      transportDebug: "Gateway de desenvolvimento",
      transportTitle: "Serviço push",
      transportAuto: "Automático",
      transportAutoHint: "Firebase quando disponível; senão, seu distribuidor UnifiedPush.",
      transportFcmHint: "Entregues pelos serviços do Google Play.",
      transportFcmUnavailable: "Indisponível nesta versão ou neste dispositivo.",
      transportDistributorHint: "UnifiedPush: auto-hospedável, sem Google.",
      transportDebugHint: "Só em builds de desenvolvimento: o gateway local guarda os pushes para o adb reproduzir.",
      test: "Enviar uma notificação de teste",
      testHint: "Sua instância envia uma para este dispositivo.",
      testSent: "Notificação de teste enviada.",
      testFailed: "A notificação de teste não foi entregue ({{error}}).",
      testNotRegistered: "Sua instância ainda não conhecia este dispositivo. Registrando de novo.",
      privacyNote: "Sua instância criptografa as notificações para este dispositivo; Apple, Google, UnifiedPush e o gateway push só repassam texto cifrado. Em conversas criptografadas, a notificação diz quem escreveu e onde, nunca o quê.",
    },
  },
};
