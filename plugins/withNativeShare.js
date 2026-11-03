/* global __dirname */
const { withInfoPlist, withEntitlementsPlist, withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;
const shareTheme = require('./shareTheme');
const NAME = 'MystashShareExtension';
const nativeEnabled = () => process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED === 'true';

function copyResources(root, destination) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'share-theme.json'), JSON.stringify(shareTheme(root)));
  for (const [weight, name] of [['400Regular', 'Regular'], ['600SemiBold', 'SemiBold'], ['700Bold', 'Bold']]) {
    fs.copyFileSync(require.resolve(`@expo-google-fonts/inter/${weight}/Inter_${weight}.ttf`), path.join(destination, `Inter-${name}.ttf`));
  }
  fs.copyFileSync(require.resolve('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'), path.join(destination, 'Ionicons.ttf'));
}
function configureXcode(project, bundle) {
    const targets = project.pbxNativeTargetSection();
    // xcode.addTarget silently omits the dependency when these sections do not
    // already exist in a single-target Expo project.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};
    const existing = Object.entries(targets).find(([, t]) => typeof t === 'object' && String(t.name).replace(/"/g, '') === NAME);
    if (existing) {
      const main = project.getFirstTarget();
      if (!main.firstTarget.dependencies.some(ref => objects.PBXTargetDependency[ref.value]?.target === existing[0])) {
        project.addTargetDependency(main.uuid, [existing[0]]);
      }
      const group = project.findPBXGroupKey({ name: NAME });
      const phase = project.pbxResourcesBuildPhaseObj(existing[0]);
      for (const file of ['Inter-Bold.ttf', 'Ionicons.ttf']) {
        if (!phase.files.some(ref => ref.comment?.replace(/"/g, '') === `${file} in Resources`)) {
          project.addResourceFile(`${NAME}/${file}`, { target: existing[0] }, group);
        }
      }
      return;
    }
    const target = project.addTarget(NAME, 'app_extension', NAME, `${bundle}.ShareExtension`);
    const groupEntry = project.addPbxGroup([], NAME);
    project.addToPbxGroup(groupEntry.uuid, project.getFirstProject().firstProject.mainGroup);
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    for (const file of ['ShareCore.swift', 'ShareViewController.swift']) project.addSourceFile(`${NAME}/${file}`, { target: target.uuid }, groupEntry.uuid);
    for (const file of ['share-theme.json', 'Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf', 'Ionicons.ttf']) project.addResourceFile(`${NAME}/${file}`, { target: target.uuid }, groupEntry.uuid);
    const configs = project.pbxXCBuildConfigurationSection();
    const targetConfig = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    const team = project.getFirstTarget().firstTarget.buildConfigurationList;
    const mainSettings = configs[project.pbxXCConfigurationList()[team].buildConfigurations[0].value].buildSettings;
    for (const ref of targetConfig.buildConfigurations) Object.assign(configs[ref.value].buildSettings, {
      INFOPLIST_FILE: `${NAME}/${NAME}-Info.plist`, CODE_SIGN_ENTITLEMENTS: `${NAME}/${NAME}.entitlements`,
      SWIFT_VERSION: '5.9', IPHONEOS_DEPLOYMENT_TARGET: '15.1', APPLICATION_EXTENSION_API_ONLY: 'YES',
      SKIP_INSTALL: 'YES',
      TARGETED_DEVICE_FAMILY: '"1,2"', CURRENT_PROJECT_VERSION: mainSettings.CURRENT_PROJECT_VERSION || '1',
      MARKETING_VERSION: mainSettings.MARKETING_VERSION || '1.0.0', GENERATE_INFOPLIST_FILE: 'NO',
      ...(mainSettings.DEVELOPMENT_TEAM ? { DEVELOPMENT_TEAM: mainSettings.DEVELOPMENT_TEAM } : {}),
    });
}
function withNativeShare(config) {
  const bundle = config.ios?.bundleIdentifier;
  if (!bundle) throw new Error('Native share requires the existing iOS identifier');
  const group = `group.${bundle}.share`;
  const keychain = `$(AppIdentifierPrefix)${bundle}.share`;
  const enabled = nativeEnabled();
  if (enabled) {
    config.extra = config.extra || {}; config.extra.eas = config.extra.eas || {};
    const build = config.extra.eas.build = config.extra.eas.build || {};
    const experimental = build.experimental = build.experimental || {};
    const ios = experimental.ios = experimental.ios || {};
    ios.appExtensions = [...(ios.appExtensions || []).filter(e => e.targetName !== NAME), {
      targetName: NAME, bundleIdentifier: `${bundle}.ShareExtension`,
      entitlements: { 'com.apple.security.application-groups': [group], 'keychain-access-groups': [keychain] },
    }];
  }
  config = withInfoPlist(config, mod => {
    if (enabled) Object.assign(mod.modResults, { MystashShareAppGroup: group, MystashShareKeychainGroup: keychain });
    return mod;
  });
  config = withEntitlementsPlist(config, mod => {
    if (enabled) for (const [key, value] of [['com.apple.security.application-groups', group], ['keychain-access-groups', keychain]]) {
      mod.modResults[key] = [...new Set([...(mod.modResults[key] || []), value])];
    }
    return mod;
  });
  config = withDangerousMod(config, ['android', mod => {
    const root = mod.modRequest.projectRoot;
    const base = path.join(mod.modRequest.platformProjectRoot, 'app/src/main');
    copyResources(root, path.join(base, 'assets/mystash-share'));
    const theme = shareTheme(root).titanium;
    fs.mkdirSync(path.join(base, 'res/values'), { recursive: true });
    fs.writeFileSync(path.join(base, 'res/values/mystash-share.xml'),
      `<resources><string name="mystash_share_enabled">${enabled}</string><string name="mystash_share_intent_enabled">${process.env.EXPO_PUBLIC_SHARE_INTENT_ENABLED === 'true'}</string><string name="mystash_share_canvas">${theme.color.canvas}</string></resources>`);
    return mod;
  }]);
  config = withXcodeProject(config, mod => {
    if (!enabled) return mod;
    const project = mod.modResults;
    configureXcode(project, bundle);
    return mod;
  });
  return withDangerousMod(config, ['ios', mod => {
    if (!enabled) return mod;
    const dir = path.join(mod.modRequest.platformProjectRoot, NAME);
    copyResources(mod.modRequest.projectRoot, dir);
    for (const file of ['ShareCore.swift', 'ShareViewController.swift']) fs.copyFileSync(path.join(__dirname, '../modules/mystash-share/ios', file), path.join(dir, file));
    fs.writeFileSync(path.join(dir, `${NAME}.entitlements`), plist.build({ 'com.apple.security.application-groups': [group], 'keychain-access-groups': [keychain] }));
    fs.writeFileSync(path.join(dir, `${NAME}-Info.plist`), plist.build({
      CFBundleDisplayName: 'Mystash', CFBundleName: NAME, CFBundleExecutable: '$(EXECUTABLE_NAME)',
      CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)', CFBundlePackageType: 'XPC!',
      CFBundleShortVersionString: '$(MARKETING_VERSION)', CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
      MystashShareAppGroup: group, MystashShareKeychainGroup: keychain,
      MystashShareIntentEnabled: process.env.EXPO_PUBLIC_SHARE_INTENT_ENABLED === 'true',
      UIAppFonts: ['Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf', 'Ionicons.ttf'],
      NSExtension: { NSExtensionPointIdentifier: 'com.apple.share-services', NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).ShareViewController',
        NSExtensionAttributes: { NSExtensionActivationRule: { NSExtensionActivationSupportsText: true, NSExtensionActivationSupportsWebURLWithMaxCount: 1 } } },
    }));
    return mod;
  }]);
}
module.exports = withNativeShare;
module.exports.copyResources = copyResources;

module.exports.configureXcode = configureXcode;
