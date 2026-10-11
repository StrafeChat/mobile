/**
 * Expo config plugin: the Android half of push notifications (modules/strafe-push).
 *
 * The module's own manifest declares its FCM service, UnifiedPush receiver and action
 * receiver; this does what only the app manifest can:
 *
 * - removes the other `com.google.firebase.MESSAGING_EVENT` receivers - expo-notifications'
 *   ExpoFirebaseMessagingService and firebase-messaging's base FirebaseMessagingService - so
 *   our StrafeFirebaseMessagingService is the only one (we don't use Expo's remote push: every
 *   push is a Web Push encrypted to this device, decrypted and drawn natively);
 * - removes the UnifiedPush connector's own MessagingReceiverImpl. It already stands down
 *   for our StrafeUnifiedPushReceiver, but it would decrypt with the connector's default key
 *   manager; with it gone, only our slot keys can ever be used;
 * - writes the build's Firebase config (`extra.fcm`, from STRAFE_FCM_* in app.config.js) as
 *   the `chat.strafe.push.fcm` meta-data, a JSON string the module initialises Firebase from
 *   when a push wakes the process (no google-services.json, no Google Gradle plugin). Without
 *   `extra.fcm` the meta-data is left out and the build has no FCM - UnifiedPush only.
 *
 * One JSON string rather than one meta-data per value: aapt turns numeric-looking values
 * (the sender id) into integers, which Bundle.getString() then can't read.
 *
 * The debug-only DEBUG_PUSH receiver lives in the module's src/debug manifest, so release
 * builds never contain it.
 *
 * Usage in app.json: "plugins": ["./plugins/withStrafePushAndroid"]
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const FCM_META_DATA = 'chat.strafe.push.fcm';
const REMOVED_SERVICES = [
  'expo.modules.notifications.service.ExpoFirebaseMessagingService',
  'com.google.firebase.messaging.FirebaseMessagingService',
];
const REMOVED_RECEIVERS = ['org.unifiedpush.android.connector.internal.MessagingReceiverImpl'];

/** `extra.fcm` as the module reads it, or null when the build has no (complete) Firebase config. */
function fcmMetaDataValue(config) {
  const fcm = config.extra && config.extra.fcm;
  if (!fcm) return null;
  const { projectId, applicationId, apiKey, senderId } = fcm;
  if (![projectId, applicationId, apiKey, senderId].every((v) => typeof v === 'string' && v.length > 0)) {
    throw new Error('withStrafePushAndroid: extra.fcm needs projectId, applicationId, apiKey and senderId');
  }
  return JSON.stringify({ projectId, applicationId, apiKey, senderId });
}

/** Mark the other push receivers for removal in the merged manifest (idempotent). */
function removeOtherPushReceivers(manifest) {
  AndroidConfig.Manifest.ensureToolsAvailable(manifest);
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  for (const [kind, names] of [['service', REMOVED_SERVICES], ['receiver', REMOVED_RECEIVERS]]) {
    app[kind] = (app[kind] || []).filter((e) => !(e.$ && names.includes(e.$['android:name'])));
    for (const name of names) {
      app[kind].push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
  }
  return manifest;
}

/** Set or clear the FCM config meta-data (idempotent). */
function setFcmMetaData(manifest, value) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  if (value) {
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, FCM_META_DATA, value);
  } else {
    AndroidConfig.Manifest.removeMetaDataItemFromMainApplication(app, FCM_META_DATA);
  }
  return manifest;
}

const withStrafePushAndroid = (config) =>
  withAndroidManifest(config, (cfg) => {
    removeOtherPushReceivers(cfg.modResults);
    setFcmMetaData(cfg.modResults, fcmMetaDataValue(cfg));
    return cfg;
  });

module.exports = withStrafePushAndroid;
module.exports.fcmMetaDataValue = fcmMetaDataValue;
module.exports.removeOtherPushReceivers = removeOtherPushReceivers;
module.exports.setFcmMetaData = setFcmMetaData;
module.exports.REMOVED_SERVICES = REMOVED_SERVICES;
module.exports.REMOVED_RECEIVERS = REMOVED_RECEIVERS;
