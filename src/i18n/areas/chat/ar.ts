/**
 * نصوص الجوال لمنطقة الدردشة (ar)، تُقرأ عبر t('mobile.chat.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  published: 'نُشرت في الغرف التي تتابع هذه الغرفة',
  listLabel: 'الرسائل',
  loadFailed: 'تعذّر تحميل الرسائل.',
  messageHint: 'اضغط مطولاً لعرض الإجراءات، واسحب لليسار للرد',
  openProfile: 'يفتح الملف الشخصي',
  openProfileOf: 'فتح الملف الشخصي: {{name}}',
  jumpToUnread: 'ينتقل إلى أول رسالة غير مقروءة',
  emojiUnavailable: 'هذا الرمز التعبيري لم يعد متاحًا',
  videoUnplayable: 'لا يمكن تشغيل هذا الفيديو على هذا الجهاز.',
  audioUnplayable: 'لا يمكن تشغيل هذا الملف على هذا الجهاز. شاركه لفتحه في تطبيق آخر.',
  fileOpenHint: 'يفتح قائمة المشاركة لفتح الملف أو حفظه',
  link: {
    open: 'فتح الرابط',
    copy: 'نسخ الرابط',
    openNamed: 'فتح الرابط: {{link}}',
    openImage: 'فتح الصورة: {{name}}',
  },
  copyCode: 'نسخ الشيفرة',
  // Math (LaTeX) in messages: shown as its source (src/features/chat/body).
  math: {
    label: 'معادلة',
    document: 'مستند LaTeX',
    inline: 'معادلة: {{tex}}',
    sourceHint: 'تظهر المعادلات في التطبيق بصيغة LaTeX المصدرية',
    copy: 'نسخ LaTeX',
  },
  reactions: {
    title: 'التفاعلات',
    none: 'لا يوجد أحد لعرضه.',
  },
};
