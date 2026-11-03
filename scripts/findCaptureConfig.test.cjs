const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const config=JSON.parse(fs.readFileSync('app.json','utf8')).expo;
test('capture config preserves application identifiers and exposes photo/camera descriptions without microphone permission',async()=>{
  assert.equal(config.ios.bundleIdentifier,'com.anonymous.Mystash');assert.equal(config.android.package,'com.anonymous.Mystash');assert.equal(config.scheme,'mystash');
  assert.equal(config.extra.eas.projectId,'2a341a10-5b80-419d-889b-44ab2f39a066');
  const options=config.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-image-picker')[1];assert.match(options.photosPermission,/screenshots/);assert.match(options.cameraPermission,/camera/);assert.equal(options.microphonePermission,false);
  // Evaluate the installed Expo plugin in memory. No native directories are generated.
  const loaded=require('expo-image-picker/app.plugin'),plugin=loaded.default??loaded;const transformed=plugin({...config},options);
  const ios=await transformed.mods.ios.infoPlist({...transformed,modResults:{...config.ios.infoPlist},modRequest:{platform:'ios',modName:'infoPlist',projectRoot:process.cwd(),introspect:true}});
  assert.equal(ios.modResults.NSCameraUsageDescription,options.cameraPermission);
  assert.equal(ios.modResults.NSPhotoLibraryUsageDescription,options.photosPermission);
  assert.ok(!ios.modResults.NSMicrophoneUsageDescription);
  const android=await transformed.mods.android.manifest({...transformed,modResults:{manifest:{$:{'xmlns:android':'http://schemas.android.com/apk/res/android'},application:[{}]}},modRequest:{platform:'android',modName:'manifest',projectRoot:process.cwd(),introspect:true}});
  assert.ok(android.modResults.manifest['uses-permission'].some(p=>p.$['android:name']==='android.permission.RECORD_AUDIO'&&p.$['tools:node']==='remove'));
});
test('native bridge preserves legacy share methods and adds the same versioned capture methods on both platforms',()=>{
  const android=fs.readFileSync('modules/mystash-share/android/src/main/java/expo/modules/mystashshare/MystashShareModule.kt','utf8'),ios=fs.readFileSync('modules/mystash-share/ios/MystashShareModule.swift','utf8');
  for(const method of ['syncSession','listPending','claim','discard','retry','captureCapabilities','enqueueUrl','enqueueImage','listImages','imageBytes','updateImage','removeImage']){
    assert.ok(android.includes(`AsyncFunction("${method}")`),method);assert.ok(ios.includes(`AsyncFunction("${method}")`),method);
  }
  const manifest=fs.readFileSync('modules/mystash-share/android/src/main/AndroidManifest.xml','utf8'),plugin=fs.readFileSync('plugins/withNativeShare.js','utf8');
  assert.ok(!manifest.includes('image/*')&&!plugin.includes('NSExtensionActivationSupportsImageWithMaxCount'));
});
