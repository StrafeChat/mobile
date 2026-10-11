/**
 * plugins/withStrafeCallService.js: the manifest entries, the MainApplication registration
 * and the Kotlin templates it generates. (The templates were also compiled against
 * react-android 0.86.3 and android-36 when written; see the voice-engine report.)
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../../plugins/withStrafeCallService') as {
  addCallServiceToManifest: (m: unknown, pkg: string) => unknown;
  addPackageToMainApplication: (contents: string, pkg: string) => string;
  renderTemplate: (src: string, pkg: string) => string;
  TEMPLATES: string[];
};

const PKG = 'chat.strafe.mobile';

/** Expo SDK 57's MainApplication.kt, as prebuild generates it. */
const MAIN_APPLICATION = `class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }
}`;

function manifest() {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': [{ $: { 'android:name': 'android.permission.FOREGROUND_SERVICE' } }],
      application: [{ $: { 'android:name': '.MainApplication' }, service: [{ $: { 'android:name': 'other.Service' } }] }],
    },
  };
}

describe('withStrafeCallService', () => {
  it('declares the service with microphone and camera types and the permissions it needs', () => {
    const m = manifest();
    plugin.addCallServiceToManifest(m, PKG);
    plugin.addCallServiceToManifest(m, PKG); // idempotent
    const perms = m.manifest['uses-permission'].map((p) => p.$['android:name']);
    expect(perms.sort()).toEqual(
      [
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_CAMERA',
        'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      ].sort(),
    );
    const services = m.manifest.application[0]!.service;
    expect(services).toHaveLength(2);
    expect(services[1]).toEqual({
      $: {
        'android:name': 'chat.strafe.mobile.callservice.StrafeCallService',
        'android:exported': 'false',
        'android:foregroundServiceType': 'microphone|camera',
      },
    });
  });

  it('registers the module package in MainApplication once', () => {
    const once = plugin.addPackageToMainApplication(MAIN_APPLICATION, PKG);
    expect(once).toContain('PackageList(this).packages.apply {\n          add(chat.strafe.mobile.callservice.StrafeCallServicePackage())');
    expect(plugin.addPackageToMainApplication(once, PKG)).toBe(once);
    expect(() => plugin.addPackageToMainApplication('class X', PKG)).toThrow();
  });

  it('renders every template into the app package', () => {
    const dir = path.resolve(__dirname, '../../../plugins/strafe-call-service/android');
    for (const file of plugin.TEMPLATES) {
      const out = plugin.renderTemplate(readFileSync(path.join(dir, file), 'utf8'), PKG);
      expect(out).not.toContain('__PACKAGE__');
      expect(out.startsWith('package chat.strafe.mobile.callservice')).toBe(true);
    }
  });

  it('exposes the module under the name callService.ts reads', () => {
    const module = readFileSync(path.resolve(__dirname, '../../../plugins/strafe-call-service/android/StrafeCallServiceModule.kt'), 'utf8');
    expect(module).toContain('const val NAME = "StrafeCallService"');
    const js = readFileSync(path.join(__dirname, 'callService.ts'), 'utf8');
    expect(js).toContain('StrafeCallService?: CallServiceModule');
  });
});
