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


    // The end-to-end encryption engine (src/platform/crypto).
    crypto: {
      engineUnavailableTitle: "التشفير غير متاح",
      engineUnavailableBody: "تعذّر على Strafe تشغيل محرك التشفير، لذا لا يمكن قراءة المحادثات المشفّرة أو إرسالها من هذا الجهاز. أعد تشغيل التطبيق للمحاولة مرة أخرى.",
    },

    // Push notifications (src/platform/push): the native renderer's strings, then Settings -> Notifications.
    push: {
      appName: "Strafe",
      newMessage: "رسالة جديدة",
      encryptedMessage: "رسالة مشفّرة",
      attachment: "أرسل مرفقًا",
      spaceRoom: "#{{room}} · {{space}}",
      threadRoom: "{{thread}} · #{{room}}",
      incomingCall: "مكالمة واردة",
      callFrom: "{{name}} يتصل بك",
      callFromIn: "{{name}} يتصل في {{room}}",
      markRead: "تعليم كمقروء",
      reply: "رد",
      answer: "رد على المكالمة",
      decline: "رفض",
      testTitle: "الإشعارات الفورية تعمل",
      testBody: "جاء هذا من خادمك، مشفّرًا حتى وصوله إلى هذا الجهاز.",
      channelMessages: "الرسائل",
      channelMessagesSilent: "الرسائل (صامتة)",
      channelCalls: "المكالمات الواردة",
      fallback: "إشعار جديد",
      title: "الإشعارات الفورية",
      toggle: "أعلمني عندما يكون Strafe مغلقًا",
      statusActive: "مفعّلة · {{transport}}",
      statusRegistering: "جارٍ الإعداد…",
      statusUnavailable: "لا يمكن لهذا الإصدار من التطبيق استقبال الإشعارات الفورية.",
      statusDisabled: "متوقفة. لن تصلك الإشعارات إلا أثناء تشغيل Strafe.",
      statusSignedOut: "سجّل الدخول لتلقي الإشعارات الفورية.",
      statusPermission: "لا يُسمح لـ Strafe بعرض الإشعارات. اسمح بها من إعدادات النظام.",
      noTransport: "لا توجد خدمة إشعارات فورية على هذا الجهاز: هذا الإصدار لا يتضمن Firebase ولا يوجد موزّع UnifiedPush مثبّت.",
      noTransportChoose: "يوجد أكثر من موزّع UnifiedPush مثبّت. اختر واحدًا أدناه.",
      noTransportFcm: "Firebase غير متاح في هذا الإصدار أو على هذا الجهاز.",
      noTransportMissing: "لم يعد موزّع UnifiedPush الذي اخترته مثبّتًا.",
      errorTransport: "لم يسجّل {{transport}} هذا الجهاز ({{error}}).",
      errorGateway: "تعذّر الوصول إلى بوابة الإشعارات ({{error}}).",
      errorDistributor: "لم يسجّل UnifiedPush هذا الجهاز ({{error}}).",
      errorInstance: "رفض خادمك هذا الجهاز ({{error}}).",
      errorUnsupported: "خادمك لا يرسل إشعارات فورية.",
      transportFcm: "Firebase Cloud Messaging",
      transportApns: "Apple Push Notification service",
      transportUnifiedPush: "UnifiedPush ({{distributor}})",
      transportDebug: "بوابة التطوير",
      transportTitle: "خدمة الإشعارات الفورية",
      transportAuto: "تلقائي",
      transportAutoHint: "Firebase عند توفره، وإلا فموزّع UnifiedPush لديك.",
      transportFcmHint: "تُسلَّم عبر خدمات Google Play.",
      transportFcmUnavailable: "غير متاح في هذا الإصدار أو على هذا الجهاز.",
      transportDistributorHint: "UnifiedPush: قابل للاستضافة الذاتية، دون Google.",
      transportDebugHint: "لإصدارات التطوير فقط: تحتفظ البوابة المحلية بالإشعارات ليعيد adb تشغيلها.",
      test: "إرسال إشعار تجريبي",
      testHint: "يرسل خادمك إشعارًا إلى هذا الجهاز.",
      testSent: "تم إرسال الإشعار التجريبي.",
      testFailed: "لم يُسلَّم الإشعار التجريبي ({{error}}).",
      testNotRegistered: "لم يكن خادمك يعرف هذا الجهاز بعد. تجري إعادة تسجيله.",
      privacyNote: "يشفّر خادمك الإشعارات لهذا الجهاز؛ ولا تمرّر Apple وGoogle وUnifiedPush وبوابة الإشعارات سوى نص مشفّر. في المحادثات المشفّرة يذكر الإشعار من كتب وأين، ولا يذكر أبدًا ما كُتب.",
    },
  },
};
