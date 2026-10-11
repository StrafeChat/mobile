/**
 * Mobile-only strings (ar). Everything the web client already says comes from its own locale
 * files (web/src/i18n/locales); this file holds only what exists on mobile alone, under the
 * `mobile.` prefix. Keep all six files in step (npm run check:i18n).
 */
export default {
  mobile: {
    // Design system (src/ui).
    ui: {
      choose: 'اختر…',
      dismiss: 'تجاهل',
      showPassword: 'إظهار كلمة المرور',
      hidePassword: 'إخفاء كلمة المرور',
      required: 'مطلوب',
      charactersLeft_zero: 'لم يتبقَّ أي حرف',
      charactersLeft_one: 'تبقّى حرف واحد',
      charactersLeft_two: 'تبقّى حرفان',
      charactersLeft_few: 'تبقّت {{count}} أحرف',
      charactersLeft_many: 'تبقّى {{count}} حرفًا',
      charactersLeft_other: 'تبقّى {{count}} حرف',
      showActions: 'إظهار الإجراءات',
      moreOptions: 'مزيد من الخيارات',
      opensSubmenu: 'يفتح مزيدًا من الخيارات',
    },

    // Browser-bound web modules swapped on mobile (src/platform/overrides).
    webOverrides: {
      passkeyUnavailable: 'مفاتيح المرور غير متاحة بعد في تطبيق الهاتف. استخدم تطبيق المصادقة أو رمز استرداد.',
    },

    // Attachments, media and voice messages (src/platform/media).
    media: {
      unsupportedIos: "لا يمكن تشغيل هذا المقطع على iPhone أو iPad. شاركه لفتحه في تطبيق آخر.",
      loadFailed: "تعذّر تحميل هذا المرفق.",
      retry: "اضغط لإعادة المحاولة",
      decryptFailed: "تعذّر فك تشفير هذا المرفق.",
      tooLarge: "هذا الملف المشفّر أكبر من أن يُفتح على هذا الجهاز.",
      save: "حفظ على الجهاز",
      share: "مشاركة",
      saved: "تم الحفظ في الصور.",
      saveDenied: "اسمح لـ Strafe بإضافة الصور من الإعدادات لحفظ هذا.",
      shareUnavailable: "المشاركة غير متاحة على هذا الجهاز.",
      cameraDenied: "الوصول إلى الكاميرا متوقف. فعّله من الإعدادات لالتقاط الصور ومقاطع الفيديو.",
      micDenied: "الوصول إلى الميكروفون متوقف. فعّله من الإعدادات لتسجيل الرسائل الصوتية.",
      pickFailed: "تعذّرت إضافة هذا الملف.",
    },

    // Start-up and connection state (src/platform/boot.ts).
    boot: {
      startFailed: "تعذّر تشغيل Strafe.",
      retry: "أعد المحاولة",
      offlineNotice: "أنت غير متصل. يُعرض ما هو موجود على هذا الجهاز.",
    },

    // Sign-in and accounts (src/features/auth).
    auth: {
      sessionExpiredNotice: "انتهت صلاحية جلستك. سجّل الدخول مرة أخرى.",
    },

    // The end-to-end encryption engine (src/platform/crypto).
    crypto: {
      engineUnavailableTitle: "التشفير غير متاح",
      engineUnavailableBody: "تعذّر على Strafe تشغيل محرك التشفير، لذا لا يمكن قراءة المحادثات المشفّرة أو إرسالها من هذا الجهاز. أعد تشغيل التطبيق للمحاولة مرة أخرى.",
    },
  },
};
