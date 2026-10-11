/**
 * Expo config plugin: the iOS side of push notifications.
 *
 * Every push is encrypted end to end from the user's instance to this device (RFC 8291), so iOS
 * can't display it as it arrives: a Notification Service Extension decrypts and renders it. This
 * generates that extension into the native project at prebuild (Continuous Native Generation -
 * nothing is committed under ios/):
 *
 * - a `StrafeNotificationService` app-extension target (bundle id `<app>.NotificationService`),
 *   embedded in the app, compiling ./strafe-push-ios/NotificationService/*.swift and - by
 *   reference, not by copy - modules/strafe-push/ios/Shared/*.swift, the same sources the
 *   StrafePush module's pod compiles (keys, decryption, payload, rendering rules);
 * - its Info.plist and entitlements, written to ios/StrafeNotificationService/;
 * - the shared App Group (`group.<app>`, where the module stores the display config) and keychain
 *   access group (`$(AppIdentifierPrefix)<app>.push`, where the module keeps the keys) on both
 *   targets, named in both Info.plists (`StrafePushAppGroup` / `StrafePushKeychainGroup`) so the
 *   Swift code never hard-codes the bundle id;
 * - the Time Sensitive Notifications entitlement on the app, so incoming calls break through a
 *   Focus that allows time-sensitive notifications;
 * - the extension declared in `extra.eas.build.experimental.ios.appExtensions`, so EAS Build
 *   provisions it.
 *
 * aps-environment comes from expo-notifications' plugin. The app's own keychain group is listed
 * first in keychain-access-groups so it stays the default group for every other keychain item
 * (expo-secure-store); only the push keys are put in the shared one.
 *
 * Usage in app.json: "plugins": ["./plugins/withStrafePushIos"], or with options
 * ["./plugins/withStrafePushIos", { "deploymentTarget": "16.4", "timeSensitive": true }].
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const TARGET_NAME = 'StrafeNotificationService';
const SERVICE_SOURCE_DIR = path.join(__dirname, 'strafe-push-ios', 'NotificationService');
const SHARED_SOURCE_DIR = path.join(__dirname, '..', 'modules', 'strafe-push', 'ios', 'Shared');
const DEFAULT_DEPLOYMENT_TARGET = '16.4';

const APP_GROUPS = 'com.apple.security.application-groups';
const KEYCHAIN_GROUPS = 'keychain-access-groups';
const TIME_SENSITIVE = 'com.apple.developer.usernotifications.time-sensitive';

function bundleIdentifier(config) {
  const id = config.ios && config.ios.bundleIdentifier;
  if (!id) throw new Error('withStrafePushIos: expo.ios.bundleIdentifier must be set');
  return id;
}

/** Every identifier the app and the extension share, derived from the app's bundle id. */
function pushIdentifiers(bundleId) {
  return {
    appGroup: `group.${bundleId}`,
    appKeychainGroup: `$(AppIdentifierPrefix)${bundleId}`,
    pushKeychainGroup: `$(AppIdentifierPrefix)${bundleId}.push`,
    extensionBundleId: `${bundleId}.NotificationService`,
  };
}

/** expo-build-properties' ios.deploymentTarget, which the app target gets too. */
function configuredDeploymentTarget(config) {
  for (const entry of config.plugins || []) {
    if (Array.isArray(entry) && entry[0] === 'expo-build-properties') {
      const target = entry[1] && entry[1].ios && entry[1].ios.deploymentTarget;
      if (target) return String(target);
    }
  }
  return undefined;
}

function addUnique(list, values) {
  const result = Array.isArray(list) ? [...list] : [];
  for (const value of values) if (!result.includes(value)) result.push(value);
  return result;
}

/** The app target's entitlements (idempotent; keeps whatever else is there). */
function addAppEntitlements(entitlements, ids, { timeSensitive = true } = {}) {
  entitlements[APP_GROUPS] = addUnique(entitlements[APP_GROUPS], [ids.appGroup]);
  // The app's own group first: the first entry is the default group for new keychain items.
  const groups = addUnique([ids.appKeychainGroup], entitlements[KEYCHAIN_GROUPS] || []);
  entitlements[KEYCHAIN_GROUPS] = addUnique(groups, [ids.pushKeychainGroup]);
  if (timeSensitive) entitlements[TIME_SENSITIVE] = true;
  return entitlements;
}

/**
 * EAS Build provisions an extension only when the config declares it (it generates the
 * credentials before prebuild creates the target), with the entitlements it needs.
 */
function addEasAppExtension(config, ids) {
  const extra = (config.extra = config.extra || {});
  const eas = (extra.eas = extra.eas || {});
  const build = (eas.build = eas.build || {});
  const experimental = (build.experimental = build.experimental || {});
  const ios = (experimental.ios = experimental.ios || {});
  ios.appExtensions = (ios.appExtensions || []).filter((ext) => ext.targetName !== TARGET_NAME);
  ios.appExtensions.push({
    targetName: TARGET_NAME,
    bundleIdentifier: ids.extensionBundleId,
    entitlements: extensionEntitlements(ids),
  });
  return config;
}

function addAppInfoPlist(infoPlist, ids) {
  infoPlist.StrafePushAppGroup = ids.appGroup;
  infoPlist.StrafePushKeychainGroup = ids.pushKeychainGroup;
  return infoPlist;
}

// ---- property lists ---------------------------------------------------------------------------

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plistValue(value, indent) {
  const pad = '\t'.repeat(indent);
  if (typeof value === 'boolean') return `${pad}<${value}/>`;
  if (Array.isArray(value)) {
    return [`${pad}<array>`, ...value.map((v) => plistValue(v, indent + 1)), `${pad}</array>`].join('\n');
  }
  if (value && typeof value === 'object') {
    const lines = [`${pad}<dict>`];
    for (const [key, v] of Object.entries(value)) {
      lines.push(`${pad}\t<key>${escapeXml(key)}</key>`, plistValue(v, indent + 1));
    }
    lines.push(`${pad}</dict>`);
    return lines.join('\n');
  }
  return `${pad}<string>${escapeXml(value)}</string>`;
}

function buildPlist(root) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    plistValue(root, 0),
    '</plist>',
    '',
  ].join('\n');
}

/** The extension's Info.plist. Its versions must equal the app's or App Store validation fails. */
function extensionInfoPlist(config, ids) {
  return {
    CFBundleDevelopmentRegion: '$(DEVELOPMENT_LANGUAGE)',
    CFBundleDisplayName: TARGET_NAME,
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: '$(PRODUCT_NAME)',
    CFBundlePackageType: 'XPC!',
    CFBundleShortVersionString: config.version || '1.0.0',
    CFBundleVersion: String((config.ios && config.ios.buildNumber) || '1'),
    NSExtension: {
      NSExtensionPointIdentifier: 'com.apple.usernotifications.service',
      NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).NotificationService',
    },
    StrafePushAppGroup: ids.appGroup,
    StrafePushKeychainGroup: ids.pushKeychainGroup,
  };
}

function extensionEntitlements(ids) {
  return {
    [APP_GROUPS]: [ids.appGroup],
    [KEYCHAIN_GROUPS]: [ids.pushKeychainGroup],
  };
}

// ---- Xcode project ------------------------------------------------------------------------------

/**
 * Object ids derived from a name, so applying the plugin to an already-prebuilt project
 * overwrites its own objects instead of adding a second extension (and a source file added to
 * Shared/ later just appears).
 */
function stableId(name) {
  return crypto.createHash('sha1').update(`strafe-push-ios:${name}`).digest('hex').slice(0, 24).toUpperCase();
}

/** pbxproj string literal: bare when the format allows it, quoted otherwise. */
function q(value) {
  const s = String(value);
  return /^[A-Za-z0-9_./]+$/.test(s) ? s : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function unq(value) {
  return typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value;
}

function section(project, isa) {
  const objects = project.hash.project.objects;
  objects[isa] = objects[isa] || {};
  return objects[isa];
}

function put(project, isa, id, object, comment) {
  const s = section(project, isa);
  s[id] = { isa, ...object };
  s[`${id}_comment`] = comment;
}

function addRef(list, id, comment) {
  if (!list.some((entry) => (entry.value || entry) === id)) list.push({ value: id, comment });
}

function findObject(project, id) {
  for (const [isa, s] of Object.entries(project.hash.project.objects)) {
    if (s[id]) return { isa, object: s[id] };
  }
  return undefined;
}

function applicationTarget(project) {
  const targets = project.pbxNativeTargetSection();
  for (const [id, target] of Object.entries(targets)) {
    if (typeof target === 'object' && unq(target.productType) === 'com.apple.product-type.application') {
      return { id, target };
    }
  }
  throw new Error('withStrafePushIos: no application target in the Xcode project');
}

function swiftFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.swift'))
    .sort();
}

/**
 * Adds (or refreshes) the Notification Service Extension target.
 *
 * `options`: platformProjectRoot (the ios/ directory), serviceSourceDir, sharedSourceDir,
 * bundleId (the extension's), deploymentTarget, developmentTeam (optional).
 */
function addNotificationServiceTarget(project, options) {
  const { platformProjectRoot, serviceSourceDir, sharedSourceDir, bundleId, deploymentTarget, developmentTeam } =
    options;
  const rootObject = project.hash.project.rootObject;
  const pbxProject = project.hash.project.objects.PBXProject[rootObject];
  const app = applicationTarget(project);
  const targetId = stableId('target');

  // Sources, in groups that point at where they live in the repository.
  const sourceGroups = [
    { key: 'service', name: 'NotificationService', dir: serviceSourceDir },
    { key: 'shared', name: 'StrafePushShared', dir: sharedSourceDir },
  ];
  const buildFiles = [];
  const groupChildren = [];
  for (const group of sourceGroups) {
    const children = [];
    for (const file of swiftFiles(group.dir)) {
      const refId = stableId(`${group.key}/${file}/ref`);
      const buildId = stableId(`${group.key}/${file}/build`);
      put(project, 'PBXFileReference', refId, { lastKnownFileType: 'sourcecode.swift', path: q(file), sourceTree: q('<group>') }, file);
      put(project, 'PBXBuildFile', buildId, { fileRef: refId, fileRef_comment: file }, `${file} in Sources`);
      children.push({ value: refId, comment: file });
      buildFiles.push({ value: buildId, comment: `${file} in Sources` });
    }
    const groupId = stableId(`${group.key}/group`);
    put(
      project,
      'PBXGroup',
      groupId,
      {
        children,
        name: q(group.name),
        path: q(path.relative(platformProjectRoot, group.dir).split(path.sep).join('/')),
        sourceTree: 'SOURCE_ROOT',
      },
      group.name,
    );
    groupChildren.push({ value: groupId, comment: group.name });
  }

  // The generated Info.plist and entitlements, and the group that holds everything.
  const infoPlistId = stableId('info-plist');
  const entitlementsId = stableId('entitlements');
  put(project, 'PBXFileReference', infoPlistId, { lastKnownFileType: 'text.plist.xml', path: 'Info.plist', sourceTree: q('<group>') }, 'Info.plist');
  put(
    project,
    'PBXFileReference',
    entitlementsId,
    { lastKnownFileType: 'text.plist.entitlements', path: q(`${TARGET_NAME}.entitlements`), sourceTree: q('<group>') },
    `${TARGET_NAME}.entitlements`,
  );
  const mainGroupId = stableId('group');
  put(
    project,
    'PBXGroup',
    mainGroupId,
    {
      children: [
        ...groupChildren,
        { value: infoPlistId, comment: 'Info.plist' },
        { value: entitlementsId, comment: `${TARGET_NAME}.entitlements` },
      ],
      path: q(TARGET_NAME),
      sourceTree: q('<group>'),
    },
    TARGET_NAME,
  );
  addRef(project.hash.project.objects.PBXGroup[pbxProject.mainGroup].children, mainGroupId, TARGET_NAME);

  // The product, listed under Products.
  const productId = stableId('product');
  const productName = `${TARGET_NAME}.appex`;
  put(
    project,
    'PBXFileReference',
    productId,
    { explicitFileType: q('wrapper.app-extension'), includeInIndex: 0, path: q(productName), sourceTree: 'BUILT_PRODUCTS_DIR' },
    productName,
  );
  addRef(project.hash.project.objects.PBXGroup[pbxProject.productRefGroup].children, productId, productName);

  // The extension's build phases. Nothing to link: Foundation, CryptoKit, Security and
  // UserNotifications are system frameworks Swift links on import.
  const phase = { buildActionMask: 2147483647, runOnlyForDeploymentPostprocessing: 0 };
  const sourcesId = stableId('phase/sources');
  const frameworksId = stableId('phase/frameworks');
  const resourcesId = stableId('phase/resources');
  put(project, 'PBXSourcesBuildPhase', sourcesId, { ...phase, files: buildFiles }, 'Sources');
  put(project, 'PBXFrameworksBuildPhase', frameworksId, { ...phase, files: [] }, 'Frameworks');
  put(project, 'PBXResourcesBuildPhase', resourcesId, { ...phase, files: [] }, 'Resources');

  // Build settings, one configuration per configuration the app has (Debug, Release).
  const appConfigList = project.hash.project.objects.XCConfigurationList[app.target.buildConfigurationList];
  const configurations = appConfigList.buildConfigurations.map((entry) => {
    const name = entry.comment || unq(project.hash.project.objects.XCBuildConfiguration[entry.value].name);
    const debug = /debug/i.test(name);
    const id = stableId(`configuration/${name}`);
    const buildSettings = {
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      CLANG_ENABLE_MODULES: 'YES',
      CODE_SIGN_ENTITLEMENTS: q(`${TARGET_NAME}/${TARGET_NAME}.entitlements`),
      CODE_SIGN_STYLE: 'Automatic',
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: q(`${TARGET_NAME}/Info.plist`),
      IPHONEOS_DEPLOYMENT_TARGET: q(deploymentTarget),
      LD_RUNPATH_SEARCH_PATHS: [q('$(inherited)'), q('@executable_path/Frameworks'), q('@executable_path/../../Frameworks')],
      PRODUCT_BUNDLE_IDENTIFIER: q(bundleId),
      PRODUCT_NAME: q('$(TARGET_NAME)'),
      SKIP_INSTALL: 'YES',
      SWIFT_OPTIMIZATION_LEVEL: q(debug ? '-Onone' : '-O'),
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: q('1,2'),
    };
    if (debug) buildSettings.SWIFT_ACTIVE_COMPILATION_CONDITIONS = 'DEBUG';
    if (developmentTeam) buildSettings.DEVELOPMENT_TEAM = q(developmentTeam);
    put(project, 'XCBuildConfiguration', id, { buildSettings, name: q(name) }, name);
    return { value: id, comment: name };
  });
  const configListId = stableId('configuration-list');
  put(
    project,
    'XCConfigurationList',
    configListId,
    {
      buildConfigurations: configurations,
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: appConfigList.defaultConfigurationName || 'Release',
    },
    `Build configuration list for PBXNativeTarget "${TARGET_NAME}"`,
  );

  put(
    project,
    'PBXNativeTarget',
    targetId,
    {
      buildConfigurationList: configListId,
      buildConfigurationList_comment: `Build configuration list for PBXNativeTarget "${TARGET_NAME}"`,
      buildPhases: [
        { value: sourcesId, comment: 'Sources' },
        { value: frameworksId, comment: 'Frameworks' },
        { value: resourcesId, comment: 'Resources' },
      ],
      buildRules: [],
      dependencies: [],
      name: q(TARGET_NAME),
      productName: q(TARGET_NAME),
      productReference: productId,
      productReference_comment: productName,
      productType: q('com.apple.product-type.app-extension'),
    },
    TARGET_NAME,
  );
  addRef(pbxProject.targets, targetId, TARGET_NAME);
  if (pbxProject.attributes && pbxProject.attributes.TargetAttributes) {
    pbxProject.attributes.TargetAttributes[targetId] = developmentTeam ? { DevelopmentTeam: q(developmentTeam) } : {};
  }

  // The app builds the extension first...
  const proxyId = stableId('container-proxy');
  const dependencyId = stableId('target-dependency');
  put(
    project,
    'PBXContainerItemProxy',
    proxyId,
    { containerPortal: rootObject, containerPortal_comment: 'Project object', proxyType: 1, remoteGlobalIDString: targetId, remoteInfo: q(TARGET_NAME) },
    'PBXContainerItemProxy',
  );
  put(
    project,
    'PBXTargetDependency',
    dependencyId,
    { target: targetId, target_comment: TARGET_NAME, targetProxy: proxyId, targetProxy_comment: 'PBXContainerItemProxy' },
    'PBXTargetDependency',
  );
  app.target.dependencies = app.target.dependencies || [];
  addRef(app.target.dependencies, dependencyId, 'PBXTargetDependency');

  // ...and embeds it in PlugIns/. The phase goes right after Resources, ahead of the script
  // phases: an embed phase behind a script phase without declared outputs makes Xcode report a
  // dependency cycle.
  const embedBuildFileId = stableId('embed/build');
  const embedPhaseId = stableId('phase/embed');
  put(
    project,
    'PBXBuildFile',
    embedBuildFileId,
    { fileRef: productId, fileRef_comment: productName, settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] } },
    `${productName} in Embed Foundation Extensions`,
  );
  put(
    project,
    'PBXCopyFilesBuildPhase',
    embedPhaseId,
    {
      ...phase,
      dstPath: q(''),
      dstSubfolderSpec: 13,
      files: [{ value: embedBuildFileId, comment: `${productName} in Embed Foundation Extensions` }],
      name: q('Embed Foundation Extensions'),
    },
    'Embed Foundation Extensions',
  );
  const phases = app.target.buildPhases;
  if (!phases.some((entry) => entry.value === embedPhaseId)) {
    const resources = phases.findIndex((entry) => {
      const found = findObject(project, entry.value);
      return found && found.isa === 'PBXResourcesBuildPhase';
    });
    phases.splice(resources >= 0 ? resources + 1 : phases.length, 0, {
      value: embedPhaseId,
      comment: 'Embed Foundation Extensions',
    });
  }

  return { targetId };
}

// ---- the plugin ---------------------------------------------------------------------------------

const withStrafePushIos = (config, props = {}) => {
  const ids = pushIdentifiers(bundleIdentifier(config));
  const deploymentTarget = String(props.deploymentTarget || configuredDeploymentTarget(config) || DEFAULT_DEPLOYMENT_TARGET);
  const timeSensitive = props.timeSensitive !== false;

  addEasAppExtension(config, ids);

  config = withEntitlementsPlist(config, (cfg) => {
    addAppEntitlements(cfg.modResults, ids, { timeSensitive });
    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    addAppInfoPlist(cfg.modResults, ids);
    return cfg;
  });

  config = withXcodeProject(config, (cfg) => {
    addNotificationServiceTarget(cfg.modResults, {
      platformProjectRoot: cfg.modRequest.platformProjectRoot,
      serviceSourceDir: SERVICE_SOURCE_DIR,
      sharedSourceDir: SHARED_SOURCE_DIR,
      bundleId: ids.extensionBundleId,
      deploymentTarget,
      developmentTeam: cfg.ios && cfg.ios.appleTeamId,
    });
    return cfg;
  });

  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, TARGET_NAME);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, 'Info.plist'), buildPlist(extensionInfoPlist(cfg, ids)));
      await fs.promises.writeFile(path.join(dir, `${TARGET_NAME}.entitlements`), buildPlist(extensionEntitlements(ids)));
      return cfg;
    },
  ]);

  return config;
};

module.exports = withStrafePushIos;
module.exports.TARGET_NAME = TARGET_NAME;
module.exports.SERVICE_SOURCE_DIR = SERVICE_SOURCE_DIR;
module.exports.SHARED_SOURCE_DIR = SHARED_SOURCE_DIR;
module.exports.pushIdentifiers = pushIdentifiers;
module.exports.addAppEntitlements = addAppEntitlements;
module.exports.addAppInfoPlist = addAppInfoPlist;
module.exports.addEasAppExtension = addEasAppExtension;
module.exports.addNotificationServiceTarget = addNotificationServiceTarget;
module.exports.extensionInfoPlist = extensionInfoPlist;
module.exports.extensionEntitlements = extensionEntitlements;
module.exports.buildPlist = buildPlist;
module.exports.configuredDeploymentTarget = configuredDeploymentTarget;
