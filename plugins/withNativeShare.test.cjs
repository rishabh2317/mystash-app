/* global __dirname */
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const plugin=require('./withNativeShare');
const root=path.resolve(__dirname,'..');
test('native sharing and extension entitlements default disabled',()=>{
 const previous=process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED;
 delete process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED;
 try{const config=plugin({name:'Mystash',slug:'Mystash',ios:{bundleIdentifier:'com.anonymous.Mystash'}});
 assert.equal(config.extra?.eas?.build?.experimental?.ios?.appExtensions,undefined);
 }finally{if(previous===undefined)delete process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED;else process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED=previous;}
});
test('extension metadata is idempotent and preserves both application identifiers',()=>{
 const previous=process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED;process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED='true';
 try{let config={name:'Mystash',slug:'Mystash',ios:{bundleIdentifier:'com.anonymous.Mystash'},android:{package:'com.anonymous.Mystash'}};
 config=plugin(config);config=plugin(config);
 assert.equal(config.extra.eas.build.experimental.ios.appExtensions.length,1);
 assert.equal(config.ios.bundleIdentifier,'com.anonymous.Mystash');assert.equal(config.android.package,'com.anonymous.Mystash');
 assert.equal(config.extra.eas.build.experimental.ios.appExtensions[0].bundleIdentifier,'com.anonymous.Mystash.ShareExtension');
 }finally{if(previous===undefined)delete process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED;else process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED=previous;}
});
test('native resources use actual Mystash tokens and the existing Inter font assets',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mystash-share-resources-'));
 try{plugin.copyResources(root,directory);const theme=JSON.parse(fs.readFileSync(path.join(directory,'share-theme.json')));
 assert.equal(theme.titanium.fontSize.body,15);assert.ok(theme.nebula.color.canvas);assert.ok(fs.statSync(path.join(directory,'Inter-Regular.ttf')).size>1000);
 assert.equal(theme.defaultMode,'titanium');assert.equal(theme.titanium.fontSize.headline,22);
 assert.equal(theme.titanium.stroke.thin,1);assert.ok(theme.icons['cube-outline']);assert.ok(theme.icons['layers-outline']);
 for(const file of ['Inter-Bold.ttf','Ionicons.ttf'])assert.ok(fs.statSync(path.join(directory,file)).size>1000);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('native sheet uses tokenized reference layout and preserves durable Save before feedback',()=>{
 const kotlin=fs.readFileSync(path.join(root,'modules/mystash-share/android/src/main/java/expo/modules/mystashshare/ShareActivity.kt'),'utf8');
 const swift=fs.readFileSync(path.join(root,'modules/mystash-share/ios/ShareViewController.swift'),'utf8');
 const manifest=fs.readFileSync(path.join(root,'modules/mystash-share/android/src/main/AndroidManifest.xml'),'utf8');
 assert.ok(!/RadioGroup|RadioButton|UI_MODE_NIGHT/.test(kotlin));
 assert.match(manifest,/Theme.Translucent.NoTitleBar/);
 assert.ok(kotlin.includes('themes.getString("defaultMode")'));assert.ok(swift.includes('themes["defaultMode"]'));
 for(const source of [kotlin,swift]){
  for(const text of ['Add context (optional)','0/280','layers-outline','information-circle-outline','Saving…'])assert.ok(source.includes(text),text);
 }
 assert.ok(kotlin.indexOf('ShareStore.capture(')<kotlin.indexOf('ShareDelivery.schedule('));
 assert.ok(kotlin.indexOf('ShareDelivery.schedule(')<kotlin.indexOf('Toast.makeText('));
 assert.ok(swift.indexOf('ShareCore.shared.capture(')<swift.indexOf('ShareCore.shared.deliver('));
 assert.ok(swift.indexOf('ShareCore.shared.deliver(')<swift.indexOf('self.extensionContext?.completeRequest'));
});
test('native entrypoints avoid React Native startup and keep URL/intent payloads off WorkManager inputs',()=>{
 const kotlin=fs.readFileSync(path.join(root,'modules/mystash-share/android/src/main/java/expo/modules/mystashshare/ShareActivity.kt'),'utf8');
 const swift=fs.readFileSync(path.join(root,'modules/mystash-share/ios/ShareViewController.swift'),'utf8');
 const delivery=fs.readFileSync(path.join(root,'modules/mystash-share/android/src/main/java/expo/modules/mystashshare/ShareDelivery.kt'),'utf8');
 assert.ok(!/MainActivity|ReactActivity|ReactRootView/.test(kotlin));assert.ok(!/openURL|UIApplication\.shared|React/.test(swift));
 assert.ok(!/setInputData|workDataOf/.test(delivery));assert.ok(delivery.includes('instanceFollowRedirects = false'));
});
test('Android has one external share target and native routing returns before legacy app launch',()=>{
 const legacy=require('./withAndroidShareIntent');
 let manifest={manifest:{application:[{$:{'android:name':'.MainApplication'},activity:[]}]}};
 manifest=legacy.addShareIntentActivity(manifest);manifest=legacy.addShareIntentActivity(manifest);
 const external=manifest.manifest.application[0].activity.filter(a=>a['intent-filter']?.some(f=>f.action?.some(a=>a.$['android:name']==='android.intent.action.SEND')));
 assert.equal(external.length,1);
 const source=legacy.shareIntentActivityKotlin('com.anonymous.Mystash');
 assert.match(source,/if \(enabledId != 0[\s\S]*ShareActivity::class\.java[\s\S]*finish\(\)\s+return\s+}\s+startActivity\(importIntent/);
 const nativeManifest=fs.readFileSync(path.join(root,'modules/mystash-share/android/src/main/AndroidManifest.xml'),'utf8');
 assert.match(nativeManifest,/android:exported="false"/);assert.ok(!nativeManifest.includes('intent-filter'));
});
test('iOS auth is rechecked under the outbox lock and delayed tasks retain their lease',()=>{
 const source=fs.readFileSync(path.join(root,'modules/mystash-share/ios/ShareCore.swift'),'utf8');
 assert.match(source,/for \(record, auth\) in work[\s\S]*try locked[\s\S]*current\["accessToken"\][\s\S]*task.resume\(\)/);
 assert.ok(source.includes('max(now, record["notBefore"] as? Double ?? 0) + 300'));
 assert.ok(source.includes('Self.retryAfter('));
});
test('real Xcode project target generation round-trips and is idempotent',t=>{
 const fixture=process.env.MYSTASH_SHARE_PBX_FIXTURE;
 if(!fixture){t.skip('Requires a read-only Xcode project fixture; does not run a build');return;}
 const xcode=require('xcode'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'mystash-share-pbx-'));
 try{
  const p=xcode.project(fixture);p.parseSync();plugin.configureXcode(p,'com.anonymous.Mystash');
  const first=p.writeSync();plugin.configureXcode(p,'com.anonymous.Mystash');assert.equal(p.writeSync(),first);
  const file=path.join(directory,'project.pbxproj');fs.writeFileSync(file,first);const parsed=xcode.project(file);parsed.parseSync();
  assert.equal(Object.values(parsed.pbxNativeTargetSection()).filter(t=>typeof t==='object'&&String(t.name).replace(/"/g,'')==='MystashShareExtension').length,1);
  assert.ok(first.includes('ShareCore.swift'));assert.ok(first.includes('com.anonymous.Mystash.ShareExtension'));
  const extension=Object.values(parsed.pbxNativeTargetSection()).find(t=>typeof t==='object'&&String(t.name).replace(/"/g,'')==='MystashShareExtension');
  assert.ok(extension);
  const main=parsed.getFirstTarget().firstTarget;
  assert.ok(main.dependencies.length>0,'Containing app depends on extension');
  assert.ok(Object.values(parsed.hash.project.objects.PBXCopyFilesBuildPhase).some(p=>typeof p==='object'&&String(p.dstSubfolderSpec)==='13'&&p.files.length>0),'Extension is embedded in PlugIns');
  // Repair projects generated by the earlier plugin without duplicating targets.
  main.dependencies=[];
  plugin.configureXcode(parsed,'com.anonymous.Mystash');
  assert.equal(main.dependencies.length,1);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
