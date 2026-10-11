/**
 * Expo config plugin: the Android foreground service that keeps a call's microphone and
 * camera running while the app is in the background.
 *
 * Android cuts a backgrounded app off from the microphone and camera unless a foreground
 * service of the matching type is running (enforced from Android 14), and no installed
 * library offers one for calls: react-native-webrtc's service is mediaProjection-only
 * (screen sharing), expo-audio's belongs to its own recorder. So this generates a minimal
 * one into the native project at prebuild (Continuous Native Generation - nothing is
 * committed under android/):
 *
 * - `<package>.callservice.StrafeCallService`: a Service that only shows the ongoing
 *   notification, declared with foregroundServiceType="microphone|camera";
 * - `StrafeCallServiceModule` (`NativeModules.StrafeCallService.start/stop`) and its
 *   package, registered in MainApplication;
 * - the FOREGROUND_SERVICE, FOREGROUND_SERVICE_MICROPHONE and FOREGROUND_SERVICE_CAMERA
 *   permissions.
 *
 * The Kotlin sources are templates in ./strafe-call-service/android; the JavaScript side is
 * src/platform/voice/callService.ts. iOS needs nothing: UIBackgroundModes audio + voip.
 *
 * Usage in app.json: "plugins": ["./plugins/withStrafeCallService"]
 */
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');

const TEMPLATE_DIR = path.join(__dirname, 'strafe-call-service', 'android');
const TEMPLATES = ['StrafeCallService.kt', 'StrafeCallServiceModule.kt', 'StrafeCallServicePackage.kt'];
const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
];

function androidPackage(config) {
  const pkg = config.android && config.android.package;
  if (!pkg) throw new Error('withStrafeCallService: expo.android.package must be set');
  return pkg;
}

/** Fill a Kotlin template with the app's package. */
function renderTemplate(source, pkg) {
  return source.split('__PACKAGE__').join(pkg);
}

/** Declare the service and its permissions (idempotent). */
function addCallServiceToManifest(manifest, pkg) {
  const root = manifest.manifest;
  root['uses-permission'] = root['uses-permission'] || [];
  for (const name of PERMISSIONS) {
    if (!root['uses-permission'].some((p) => p.$ && p.$['android:name'] === name)) {
      root['uses-permission'].push({ $: { 'android:name': name } });
    }
  }
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const serviceName = `${pkg}.callservice.StrafeCallService`;
  app.service = (app.service || []).filter((s) => !(s.$ && s.$['android:name'] === serviceName));
  app.service.push({
    $: {
      'android:name': serviceName,
      'android:exported': 'false',
      'android:foregroundServiceType': 'microphone|camera',
    },
  });
  return manifest;
}

/** Register the module's package in MainApplication.kt (idempotent). */
function addPackageToMainApplication(contents, pkg) {
  const line = `add(${pkg}.callservice.StrafeCallServicePackage())`;
  if (contents.includes(line)) return contents;
  const anchor = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!anchor.test(contents)) {
    throw new Error('withStrafeCallService: could not find `PackageList(this).packages.apply {` in MainApplication.kt');
  }
  return contents.replace(anchor, (m) => `${m}\n          ${line}`);
}

const withStrafeCallService = (config) => {
  config = withAndroidManifest(config, (cfg) => {
    addCallServiceToManifest(cfg.modResults, androidPackage(cfg));
    return cfg;
  });

  config = withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withStrafeCallService: MainApplication must be Kotlin');
    }
    cfg.modResults.contents = addPackageToMainApplication(cfg.modResults.contents, androidPackage(cfg));
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const pkg = androidPackage(cfg);
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...pkg.split('.'), 'callservice');
      await fs.promises.mkdir(dir, { recursive: true });
      for (const file of TEMPLATES) {
        const source = await fs.promises.readFile(path.join(TEMPLATE_DIR, file), 'utf8');
        await fs.promises.writeFile(path.join(dir, file), renderTemplate(source, pkg));
      }
      return cfg;
    },
  ]);

  return config;
};

module.exports = withStrafeCallService;
module.exports.addCallServiceToManifest = addCallServiceToManifest;
module.exports.addPackageToMainApplication = addPackageToMainApplication;
module.exports.renderTemplate = renderTemplate;
module.exports.TEMPLATES = TEMPLATES;
