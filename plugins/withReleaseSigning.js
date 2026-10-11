/**
 * Expo config plugin: sign Android release builds with the publisher's upload key when one
 * is provided, at build time, through the environment:
 *
 *   STRAFE_ANDROID_KEYSTORE           path to the keystore (.jks / .keystore)
 *   STRAFE_ANDROID_KEYSTORE_PASSWORD  its password
 *   STRAFE_ANDROID_KEY_ALIAS          the key's alias
 *   STRAFE_ANDROID_KEY_PASSWORD       the key's password (defaults to the keystore password)
 *
 * Without them a release build is signed with the debug key, as the generated project does:
 * fine to sideload and test, not for a store. The variables are read by Gradle when it runs,
 * not at prebuild, so no secret is ever written into the generated android/ project.
 *
 * Usage in app.json: "plugins": ["./plugins/withReleaseSigning"]
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// strafe: release signing';

const SIGNING_CONFIG = `
        release { ${MARKER}
            def ks = System.getenv('STRAFE_ANDROID_KEYSTORE')
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv('STRAFE_ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('STRAFE_ANDROID_KEY_ALIAS')
                keyPassword System.getenv('STRAFE_ANDROID_KEY_PASSWORD') ?: System.getenv('STRAFE_ANDROID_KEYSTORE_PASSWORD')
            }
        }`;

function applySigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  // A release signing config beside the generated debug one.
  const withConfig = gradle.replace(/(signingConfigs\s*\{\s*\n\s*debug\s*\{[^}]*\})/, `$1${SIGNING_CONFIG}`);
  if (withConfig === gradle) throw new Error('withReleaseSigning: could not find signingConfigs.debug in app/build.gradle');
  // The release build type uses it when a keystore is configured, the debug key otherwise.
  const releaseType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  const withType = withConfig.replace(
    releaseType,
    "$1signingConfig System.getenv('STRAFE_ANDROID_KEYSTORE') ? signingConfigs.release : signingConfigs.debug",
  );
  if (withType === withConfig) throw new Error('withReleaseSigning: could not find the release build type in app/build.gradle');
  return withType;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') throw new Error('withReleaseSigning: expected a Groovy app/build.gradle');
    cfg.modResults.contents = applySigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.applySigning = applySigning;
