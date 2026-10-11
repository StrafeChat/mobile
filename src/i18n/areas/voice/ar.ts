/**
 * Mobile strings for the voice area (ar), read as t('mobile.voice.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  minimize: 'تصغير المكالمة',
  openCall: 'فتح المكالمة',
  openCallHint: 'يفتح شاشة المكالمة',
  openChat: 'فتح المحادثة',
  speaking: 'يتحدث',
  tileHint: 'يُبرز هذا الشخص. اضغط مطولًا لمزيد من الخيارات.',
  flipCamera: 'تبديل الكاميرا',
  audioOutput: 'إخراج الصوت',
  route: {
    auto: 'تلقائي',
    autoHint: 'البلوتوث، ثم سماعات الرأس، ثم مكبّر الصوت',
    earpiece: 'الهاتف',
    headset: 'سماعات الرأس',
    bluetooth: 'بلوتوث',
  },
  holdToTalk: 'اضغط مطولًا للتحدث',
  holdToTalkHint: 'وضع الضغط للتحدث مفعّل. اضغط على الزر مطولًا أثناء حديثك.',
  talking: 'تتحدث الآن…',
  sharingScreen: 'أنت تشارك شاشتك',
  noiseOn: 'مفعّل، تتم المعالجة على هذا الجهاز',
  enableAudio: 'صوت المكالمة متوقف مؤقتًا.',
  enablePlayback: 'صوت المكالمة والفيديو متوقفان مؤقتًا.',
  enableAction: 'استئناف',
  switchTitle: 'تبديل المكالمة؟',
  switchBody: 'أنت متصل بـ {{room}}. الانضمام هنا سيفصلك عنها.',
  switchConfirm: 'تبديل',
  disconnectTitle: 'فصل {{name}}؟',
  disconnectBody: 'ستتم إزالته من غرفة الصوت هذه. يمكنه الانضمام مجددًا لاحقًا.',
  actionFailed: 'لم ينجح ذلك. حاول مرة أخرى.',
  viewProfile: 'عرض الملف الشخصي',
  callInProgress: 'مكالمة جارية',
  inThisCall: 'أنت في هذه المكالمة',
  micOffJoin: 'الوصول إلى الميكروفون متوقف، لذا لن يسمعك أحد. فعّله من الإعدادات لتتحدث.',
  cameraOffJoin: 'الوصول إلى الكاميرا متوقف، لذا ستنضم دون فيديو. فعّله من الإعدادات لمشاركة الفيديو.',
  errors: {
    e2eeUnsupported:
      'لا يستطيع هذا الجهاز تشفير المكالمات، لذا لا يمكنه الانضمام. المكالمات مشفّرة من طرف إلى طرف ولا تُرسل أبدًا دون تشفير.',
    micDenied: 'تم رفض الوصول إلى الميكروفون. فعّله من الإعدادات لتتحدث.',
    cameraDenied: 'تم رفض الوصول إلى الكاميرا. فعّله من الإعدادات لمشاركة الفيديو.',
  },
};
