/**
 * Mobile strings for the auth area (es), read as t('mobile.auth.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  sessionExpiredNotice: "Tu sesión ha caducado. Vuelve a iniciar sesión.",

  // Welcome / instance
  welcomeTitle: "Te damos la bienvenida a Strafe",
  welcomeBody: "Chatea con amistades y comunidades en la instancia que elijas. Escribe su dirección para empezar.",
  chooseInstanceTitle: "Elige tu instancia",
  chooseInstanceBody: "La dirección de la instancia de Strafe donde está tu cuenta.",
  change: "Cambiar",
  changeInstance: "Elegir otra instancia",

  // Language
  restartTitle: "Reinicia para cambiar el diseño",
  restartBody: "Strafe tiene que reiniciarse para cambiar entre el diseño de derecha a izquierda y el de izquierda a derecha. El nuevo idioma ya está activo.",
  restartNow: "Reiniciar ahora",
  restartLater: "Más tarde",

  // Sign in / second factor
  paste: "Pegar",

  // Registration
  stepOf: "Paso {{step}} de {{total}}",
  dobPlaceholder: "Selecciona tu fecha de nacimiento",
  usernameRules: "De 2 a 32 letras, números, «_», «.» o «-».",
  usernameInvalid: "Los nombres de usuario solo pueden tener de 2 a 32 letras, números, «_», «.» o «-».",
  handlePreview: "Desde otras instancias pueden añadirte como {{handle}}.",
  registered: "Tu cuenta está lista. Inicia sesión para continuar.",
  haveLink: "Tengo el enlace del correo",

  // Email links
  linkLabel: "Enlace del correo",
  linkPlaceholder: "https://…",
  linkHint: "Abre el correo, copia el enlace y pégalo aquí.",
  linkInvalid: "Eso no parece el enlace del correo. Copia el enlace completo e inténtalo de nuevo.",
  linkNoInstance: "Primero elige tu instancia y luego vuelve a abrir el enlace.",
  linkOtherInstance: "Este enlace es de {{host}}. Cierra sesión para usarlo o ábrelo en el navegador.",
  verifyLinkTitle: "Verifica tu correo",
  verifyLinkBody: "Pega el enlace del correo de verificación para confirmar tu dirección.",
  verifyAction: "Verificar",
  tryAnotherLink: "Probar otro enlace",
  resetLinkBody: "Pega el enlace del correo de restablecimiento para elegir una contraseña nueva.",

  // Accounts on this device
  savedAccountsHint: "Toca una para continuar o inicia sesión con otra cuenta arriba.",
  switcherHint: "Cuentas en este dispositivo. Al cambiar, la app se reinicia.",
  switchTo: "Cambiar a esta cuenta",
  activeAccount: "Cuenta actual",
  signOutConfirm: "Se cerrará la sesión de esta cuenta en este dispositivo. Las demás cuentas seguirán con la sesión iniciada.",
};
