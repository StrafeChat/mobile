const { describe, expect, it } = require('@jest/globals');
const { applySigning } = require('../withReleaseSigning');

// The shape of the app/build.gradle that `expo prebuild` generates (SDK 57).
const GENERATED = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('withReleaseSigning', () => {
  it('adds an env-driven release config and uses it only for release builds', () => {
    const out = applySigning(GENERATED);
    expect(out).toContain("def ks = System.getenv('STRAFE_ANDROID_KEYSTORE')");
    expect(out).toContain("signingConfig System.getenv('STRAFE_ANDROID_KEYSTORE') ? signingConfigs.release : signingConfigs.debug");
    // The debug build type keeps the debug key.
    expect(out).toMatch(/debug \{\s*signingConfig signingConfigs\.debug\s*\}/);
    // No secret values end up in the generated file.
    expect(out).not.toMatch(/storePassword '(?!android)/);
  });

  it('is idempotent', () => {
    const once = applySigning(GENERATED);
    expect(applySigning(once)).toBe(once);
  });

  it('refuses a build.gradle it does not recognise', () => {
    expect(() => applySigning('android { }')).toThrow(/signingConfigs\.debug/);
  });
});
