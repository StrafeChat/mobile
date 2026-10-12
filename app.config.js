/**
 * Dynamic app config: app.json plus the values that differ per build.
 *
 * - `extra.pushGateway`: the push gateway this build registers its APNs/FCM tokens with
 *   (equinox cmd/pushgateway, run by whoever publishes the build - it holds the build's
 *   Apple key and Firebase credentials). Override with EXPO_PUBLIC_PUSH_GATEWAY, e.g.
 *   http://127.0.0.1:4020 in development (with `adb reverse tcp:4020 tcp:4020`).
 * - `extra.fcm`: the Firebase project the Android build receives FCM pushes through, from
 *   STRAFE_FCM_PROJECT_ID / STRAFE_FCM_APP_ID / STRAFE_FCM_API_KEY / STRAFE_FCM_SENDER_ID.
 *   Left out, the build has no FCM and Android push uses UnifiedPush only - which is what a
 *   Google-free build wants anyway.
 *
 * Instances need none of this: they speak standard Web Push to whatever endpoint a device
 * registered. See docs/PUSH.md in StrafeChat/deploy.
 *
 * - `extra.defaultInstance`: what the instance field offers on a fresh install (any other
 *   instance is a tap on the field away). STRAFE_DEFAULT_INSTANCE overrides it for a build of
 *   your own; set it to an empty string for no default.
 */
const DEFAULT_PUSH_GATEWAY = 'https://push.strafe.chat';
const DEFAULT_INSTANCE = 'app.strafe.chat';

function fcmConfig() {
  const projectId = process.env.STRAFE_FCM_PROJECT_ID;
  const applicationId = process.env.STRAFE_FCM_APP_ID;
  const apiKey = process.env.STRAFE_FCM_API_KEY;
  const senderId = process.env.STRAFE_FCM_SENDER_ID;
  if (!projectId || !applicationId || !apiKey || !senderId) return undefined;
  return { projectId, applicationId, apiKey, senderId };
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    pushGateway: (process.env.EXPO_PUBLIC_PUSH_GATEWAY || DEFAULT_PUSH_GATEWAY).replace(/\/+$/, ''),
    defaultInstance: (process.env.STRAFE_DEFAULT_INSTANCE ?? DEFAULT_INSTANCE).trim(),
    ...(fcmConfig() ? { fcm: fcmConfig() } : {}),
  },
});
