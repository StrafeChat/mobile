/**
 * Mobile strings for the auth area (ar), read as t('mobile.auth.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  sessionExpiredNotice: "انتهت صلاحية جلستك. سجّل الدخول مرة أخرى.",

  // Welcome / instance
  welcomeTitle: "مرحبًا بك في Strafe",
  welcomeBody: "تحدّث مع أصدقائك ومجتمعاتك على الخادم الذي تختاره. أدخل عنوانه للبدء.",
  chooseInstanceTitle: "اختر خادمك",
  chooseInstanceBody: "عنوان خادم Strafe الذي يوجد عليه حسابك.",
  change: "تغيير",
  changeInstance: "اختيار خادم آخر",

  // Language
  restartTitle: "أعد التشغيل لتغيير اتجاه الواجهة",
  restartBody: "يحتاج Strafe إلى إعادة التشغيل للتبديل بين الواجهة من اليمين إلى اليسار ومن اليسار إلى اليمين. اللغة الجديدة مستخدمة بالفعل.",
  restartNow: "إعادة التشغيل الآن",
  restartLater: "لاحقًا",

  // Sign in / second factor
  paste: "لصق",

  // Registration
  stepOf: "الخطوة {{step}} من {{total}}",
  dobPlaceholder: "اختر تاريخ ميلادك",
  usernameRules: "من 2 إلى 32 حرفًا لاتينيًا أو رقمًا أو «_» أو «.» أو «-».",
  usernameInvalid: "يمكن أن يحتوي اسم المستخدم فقط على 2 إلى 32 حرفًا لاتينيًا أو رقمًا أو «_» أو «.» أو «-».",
  handlePreview: "يمكن للأشخاص على الخوادم الأخرى إضافتك باسم {{handle}}.",
  registered: "حسابك جاهز. سجّل الدخول للمتابعة.",
  haveLink: "لديّ الرابط من البريد الإلكتروني",

  // Email links
  linkLabel: "الرابط من البريد الإلكتروني",
  linkPlaceholder: "https://…",
  linkHint: "افتح البريد الإلكتروني، وانسخ الرابط، والصقه هنا.",
  linkInvalid: "لا يبدو هذا رابط البريد الإلكتروني. انسخ الرابط كاملًا وحاول مرة أخرى.",
  linkNoInstance: "اختر خادمك أولًا، ثم افتح الرابط مرة أخرى.",
  linkOtherInstance: "هذا الرابط خاص بـ {{host}}. سجّل الخروج لاستخدامه، أو افتحه في المتصفح.",
  verifyLinkTitle: "تأكيد بريدك الإلكتروني",
  verifyLinkBody: "الصق الرابط من رسالة التحقق لتأكيد عنوانك.",
  verifyAction: "تحقق",
  tryAnotherLink: "جرّب رابطًا آخر",
  resetLinkBody: "الصق الرابط من رسالة إعادة التعيين لاختيار كلمة مرور جديدة.",

  // Accounts on this device
  savedAccountsHint: "اضغط على حساب للمتابعة، أو سجّل الدخول إلى حساب آخر في الأعلى.",
  switcherHint: "الحسابات على هذا الجهاز. يؤدي التبديل إلى إعادة تشغيل التطبيق.",
  switchTo: "التبديل إلى هذا الحساب",
  activeAccount: "الحساب الحالي",
  signOutConfirm: "سيتم تسجيل خروجك من هذا الحساب على هذا الجهاز. تظل الحسابات الأخرى مسجّلة الدخول.",
};
