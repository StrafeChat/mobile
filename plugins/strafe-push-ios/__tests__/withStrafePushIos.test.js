/**
 * plugins/withStrafePushIos.js: the entitlements and Info.plist keys it adds to the app, the files
 * it generates for the Notification Service Extension, and the extension target it adds to the
 * Xcode project - checked against the bare template of the installed Expo SDK, parsed and written
 * by the same `xcode` library prebuild uses.
 */
const { afterAll, beforeAll, describe, expect, it } = require('@jest/globals');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IOSConfig } = require('expo/config-plugins');

const plugin = require('../../withStrafePushIos');

const BUNDLE_ID = 'chat.strafe.mobile';
const ids = plugin.pushIdentifiers(BUNDLE_ID);

/** The template's project.pbxproj in a fresh `<root>/ios/HelloWorld.xcodeproj`. */
function templateProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strafe-push-ios-'));
  const xcodeproj = path.join(root, 'ios', 'HelloWorld.xcodeproj');
  fs.mkdirSync(xcodeproj, { recursive: true });
  const pbxproj = execFileSync('tar', [
    '-xzOf',
    require.resolve('expo/template.tgz'),
    'package/ios/HelloWorld.xcodeproj/project.pbxproj',
  ]);
  fs.writeFileSync(path.join(xcodeproj, 'project.pbxproj'), pbxproj);
  return { root, file: path.join(xcodeproj, 'project.pbxproj') };
}

function unq(value) {
  return typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value;
}

function objects(project, isa) {
  return Object.entries(project.hash.project.objects[isa] || {}).filter(([key]) => !key.endsWith('_comment'));
}

function nativeTarget(project, name) {
  return objects(project, 'PBXNativeTarget').find(([, t]) => unq(t.name) === name);
}

function phaseOf(project, target, isa) {
  for (const entry of target.buildPhases) {
    const phase = (project.hash.project.objects[isa] || {})[entry.value];
    if (phase) return { id: entry.value, phase };
  }
  return undefined;
}

function fileNames(project, phase) {
  return phase.files.map((entry) => {
    const buildFile = project.hash.project.objects.PBXBuildFile[entry.value];
    return unq(project.hash.project.objects.PBXFileReference[buildFile.fileRef].path);
  });
}

describe('withStrafePushIos identifiers and entitlements', () => {
  it('derives every shared identifier from the bundle id', () => {
    expect(ids).toEqual({
      appGroup: 'group.chat.strafe.mobile',
      appKeychainGroup: '$(AppIdentifierPrefix)chat.strafe.mobile',
      pushKeychainGroup: '$(AppIdentifierPrefix)chat.strafe.mobile.push',
      extensionBundleId: 'chat.strafe.mobile.NotificationService',
    });
  });

  it('adds the app group, both keychain groups (the app own first) and time-sensitive', () => {
    const entitlements = {
      'aps-environment': 'development',
      'keychain-access-groups': ['$(AppIdentifierPrefix)other.shared'],
    };
    plugin.addAppEntitlements(entitlements, ids);
    plugin.addAppEntitlements(entitlements, ids); // idempotent
    expect(entitlements).toEqual({
      'aps-environment': 'development',
      'com.apple.security.application-groups': ['group.chat.strafe.mobile'],
      'keychain-access-groups': [
        '$(AppIdentifierPrefix)chat.strafe.mobile',
        '$(AppIdentifierPrefix)other.shared',
        '$(AppIdentifierPrefix)chat.strafe.mobile.push',
      ],
      'com.apple.developer.usernotifications.time-sensitive': true,
    });
    expect(plugin.addAppEntitlements({}, ids, { timeSensitive: false })).not.toHaveProperty(
      'com.apple.developer.usernotifications.time-sensitive',
    );
  });

  it('names the groups in the app Info.plist for the Swift code', () => {
    expect(plugin.addAppInfoPlist({ CFBundleName: 'Strafe' }, ids)).toEqual({
      CFBundleName: 'Strafe',
      StrafePushAppGroup: 'group.chat.strafe.mobile',
      StrafePushKeychainGroup: '$(AppIdentifierPrefix)chat.strafe.mobile.push',
    });
  });

  it('declares the extension to EAS Build, replacing an older declaration', () => {
    const config = {
      extra: {
        pushGateway: 'https://push.example',
        eas: { build: { experimental: { ios: { appExtensions: [{ targetName: 'Other' }, { targetName: plugin.TARGET_NAME }] } } } },
      },
    };
    plugin.addEasAppExtension(config, ids);
    expect(config.extra.pushGateway).toBe('https://push.example');
    expect(config.extra.eas.build.experimental.ios.appExtensions).toEqual([
      { targetName: 'Other' },
      {
        targetName: 'StrafeNotificationService',
        bundleIdentifier: 'chat.strafe.mobile.NotificationService',
        entitlements: plugin.extensionEntitlements(ids),
      },
    ]);
    expect(plugin.addEasAppExtension({}, ids).extra.eas.build.experimental.ios.appExtensions).toHaveLength(1);
  });

  it('reads the deployment target from expo-build-properties', () => {
    expect(
      plugin.configuredDeploymentTarget({
        plugins: ['expo-router', ['expo-build-properties', { ios: { deploymentTarget: '17.0' } }]],
      }),
    ).toBe('17.0');
    expect(plugin.configuredDeploymentTarget({ plugins: ['expo-router'] })).toBeUndefined();
  });
});

describe('withStrafePushIos extension files', () => {
  it('writes an Info.plist that declares a notification service with the app version', () => {
    const plist = plugin.buildPlist(plugin.extensionInfoPlist({ version: '0.1.0', ios: { buildNumber: '7' } }, ids));
    expect(plist).toContain('<key>NSExtensionPointIdentifier</key>\n\t\t<string>com.apple.usernotifications.service</string>');
    expect(plist).toContain('<string>$(PRODUCT_MODULE_NAME).NotificationService</string>');
    expect(plist).toContain('<key>CFBundleShortVersionString</key>\n\t<string>0.1.0</string>');
    expect(plist).toContain('<key>CFBundleVersion</key>\n\t<string>7</string>');
    expect(plist).toContain('<key>StrafePushKeychainGroup</key>\n\t<string>$(AppIdentifierPrefix)chat.strafe.mobile.push</string>');
  });

  it('gives the extension the app group and only the push keychain group', () => {
    expect(plugin.extensionEntitlements(ids)).toEqual({
      'com.apple.security.application-groups': ['group.chat.strafe.mobile'],
      'keychain-access-groups': ['$(AppIdentifierPrefix)chat.strafe.mobile.push'],
    });
    expect(plugin.buildPlist({ a: [true, 'x&y'] })).toContain('<array>\n\t\t<true/>\n\t\t<string>x&amp;y</string>\n\t</array>');
  });
});

describe('withStrafePushIos Xcode target', () => {
  let fixture;
  let project;
  let firstWrite;

  beforeAll(() => {
    fixture = templateProject();
    const options = {
      // Where prebuild puts the project; the source groups are relative to it.
      platformProjectRoot: path.join(__dirname, '..', '..', '..', 'ios'),
      serviceSourceDir: plugin.SERVICE_SOURCE_DIR,
      sharedSourceDir: plugin.SHARED_SOURCE_DIR,
      bundleId: ids.extensionBundleId,
      deploymentTarget: '16.4',
    };
    const parsed = IOSConfig.XcodeUtils.getPbxproj(fixture.root);
    plugin.addNotificationServiceTarget(parsed, options);
    firstWrite = parsed.writeSync();
    // Applying it again (a prebuild without --clean) must change nothing.
    plugin.addNotificationServiceTarget(parsed, options);
    expect(parsed.writeSync()).toBe(firstWrite);
    // And what was written must parse back.
    fs.writeFileSync(fixture.file, firstWrite);
    project = IOSConfig.XcodeUtils.getPbxproj(fixture.root);
  });

  afterAll(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  it('adds one app-extension target with the extension and shared sources', () => {
    const matches = objects(project, 'PBXNativeTarget').filter(([, t]) => unq(t.name) === plugin.TARGET_NAME);
    expect(matches).toHaveLength(1);
    const [, target] = matches[0];
    expect(unq(target.productType)).toBe('com.apple.product-type.app-extension');

    const sources = phaseOf(project, target, 'PBXSourcesBuildPhase');
    const shared = fs.readdirSync(plugin.SHARED_SOURCE_DIR).filter((f) => f.endsWith('.swift'));
    expect(shared).toEqual(expect.arrayContaining(['WebPushDecryption.swift', 'PushKeyStore.swift', 'PushRenderer.swift']));
    expect(fileNames(project, sources.phase).sort()).toEqual(['NotificationService.swift', ...shared].sort());
  });

  it('references the sources where they live instead of copying them', () => {
    const groups = Object.fromEntries(objects(project, 'PBXGroup').map(([, g]) => [unq(g.name || g.path), g]));
    expect(unq(groups.StrafePushShared.path)).toBe('../modules/strafe-push/ios/Shared');
    expect(groups.StrafePushShared.sourceTree).toBe('SOURCE_ROOT');
    expect(unq(groups.NotificationService.path)).toBe('../plugins/strafe-push-ios/NotificationService');
    expect(unq(groups[plugin.TARGET_NAME].path)).toBe(plugin.TARGET_NAME);
  });

  it('configures bundle id, deployment target, Info.plist and entitlements', () => {
    const [, target] = nativeTarget(project, plugin.TARGET_NAME);
    const list = project.hash.project.objects.XCConfigurationList[target.buildConfigurationList];
    const names = list.buildConfigurations.map((c) => c.comment).sort();
    expect(names).toEqual(['Debug', 'Release']);
    for (const entry of list.buildConfigurations) {
      const settings = project.hash.project.objects.XCBuildConfiguration[entry.value].buildSettings;
      expect(unq(settings.PRODUCT_BUNDLE_IDENTIFIER)).toBe('chat.strafe.mobile.NotificationService');
      expect(unq(settings.IPHONEOS_DEPLOYMENT_TARGET)).toBe('16.4');
      expect(unq(settings.INFOPLIST_FILE)).toBe('StrafeNotificationService/Info.plist');
      expect(unq(settings.CODE_SIGN_ENTITLEMENTS)).toBe('StrafeNotificationService/StrafeNotificationService.entitlements');
      expect(settings.APPLICATION_EXTENSION_API_ONLY).toBe('YES');
      expect(settings.SKIP_INSTALL).toBe('YES');
    }
  });

  it('builds the extension before the app and embeds it in PlugIns, ahead of the script phases', () => {
    const [extensionId] = nativeTarget(project, plugin.TARGET_NAME);
    const [, app] = objects(project, 'PBXNativeTarget').find(
      ([, t]) => unq(t.productType) === 'com.apple.product-type.application',
    );

    const dependencies = app.dependencies.map((d) => project.hash.project.objects.PBXTargetDependency[d.value]);
    expect(dependencies.map((d) => d.target)).toContain(extensionId);

    const embed = phaseOf(project, app, 'PBXCopyFilesBuildPhase');
    expect(embed.phase.dstSubfolderSpec).toBe(13);
    expect(fileNames(project, embed.phase)).toEqual([`${plugin.TARGET_NAME}.appex`]);

    const order = app.buildPhases.map((p) => p.value);
    const resources = phaseOf(project, app, 'PBXResourcesBuildPhase');
    expect(order.indexOf(embed.id)).toBe(order.indexOf(resources.id) + 1);
    const scripts = Object.keys(project.hash.project.objects.PBXShellScriptBuildPhase || {});
    for (const id of order.filter((p) => scripts.includes(p) && unq(project.hash.project.objects.PBXShellScriptBuildPhase[p].name) !== '[CP] Check Pods Manifest.lock')) {
      expect(order.indexOf(id)).toBeGreaterThan(order.indexOf(embed.id));
    }

    const rootObject = project.hash.project.objects.PBXProject[project.hash.project.rootObject];
    expect(rootObject.targets.map((t) => t.value)).toContain(extensionId);
  });
});
