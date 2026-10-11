/**
 * Mobile strings for the auth area (pt-BR), read as t('mobile.auth.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  sessionExpiredNotice: "Sua sessão expirou. Entre novamente.",

  // Welcome / instance
  welcomeTitle: "Boas-vindas ao Strafe",
  welcomeBody: "Converse com amigos e comunidades na instância que você escolher. Digite o endereço dela para começar.",
  chooseInstanceTitle: "Escolha sua instância",
  chooseInstanceBody: "O endereço da instância do Strafe onde fica a sua conta.",
  change: "Alterar",
  changeInstance: "Escolher outra instância",

  // Language
  restartTitle: "Reinicie para mudar o layout",
  restartBody: "O Strafe precisa reiniciar para alternar entre o layout da direita para a esquerda e da esquerda para a direita. O novo idioma já está em uso.",
  restartNow: "Reiniciar agora",
  restartLater: "Depois",

  // Sign in / second factor
  paste: "Colar",

  // Registration
  stepOf: "Etapa {{step}} de {{total}}",
  dobPlaceholder: "Selecione sua data de nascimento",
  usernameRules: "De 2 a 32 letras, números, “_”, “.” ou “-”.",
  usernameInvalid: "Nomes de usuário só podem ter de 2 a 32 letras, números, “_”, “.” ou “-”.",
  handlePreview: "Pessoas de outras instâncias podem adicionar você como {{handle}}.",
  registered: "Sua conta está pronta. Entre para continuar.",
  haveLink: "Tenho o link do e-mail",

  // Email links
  linkLabel: "Link do e-mail",
  linkPlaceholder: "https://…",
  linkHint: "Abra o e-mail, copie o link e cole aqui.",
  linkInvalid: "Isso não parece o link do e-mail. Copie o link inteiro e tente de novo.",
  linkNoInstance: "Escolha sua instância primeiro e depois abra o link novamente.",
  linkOtherInstance: "Este link é de {{host}}. Saia da conta para usá-lo ou abra-o no navegador.",
  verifyLinkTitle: "Verifique seu e-mail",
  verifyLinkBody: "Cole o link do e-mail de verificação para confirmar seu endereço.",
  verifyAction: "Verificar",
  tryAnotherLink: "Tentar outro link",
  resetLinkBody: "Cole o link do e-mail de redefinição para escolher uma nova senha.",

  // Accounts on this device
  savedAccountsHint: "Toque em uma para continuar ou entre em outra conta acima.",
  switcherHint: "Contas neste dispositivo. Trocar de conta reinicia o app.",
  switchTo: "Trocar para esta conta",
  activeAccount: "Conta atual",
  signOutConfirm: "Você vai sair desta conta neste dispositivo. As outras contas continuam conectadas.",
};
