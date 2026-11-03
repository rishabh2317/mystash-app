import {Platform} from 'react-native';
import * as Picker from 'expo-image-picker';
import {ImageManipulator,SaveFormat} from 'expo-image-manipulator';
import {File,Paths} from 'expo-file-system';
import {captureCapabilities,enqueueFindImage} from './captureRuntime';
import {selectCapture,type CaptureOrigin,type CaptureSelection} from './imageCapture';
async function clean(uri:string){if(uri.startsWith(Paths.cache.uri)){try{const file=new File(uri);if(file.exists)file.delete();}catch{/* OS cache cleanup remains available. */}}}
export async function captureDeviceImage(origin:CaptureOrigin,owner:string,sameOwner:()=>boolean){
  let picked:string|undefined;
  try{return await selectCapture(origin,{
    supported:async()=>Platform.OS!=='web'&&(await captureCapabilities()).images,
    sameOwner,
    // Android's system photo picker grants only the selected URI; no broad library grant.
    permission:async request=>origin==='camera'?(request?Picker.requestCameraPermissionsAsync():Picker.getCameraPermissionsAsync())
      :Platform.OS==='android'?{granted:true,canAskAgain:true}:(request?Picker.requestMediaLibraryPermissionsAsync(false):Picker.getMediaLibraryPermissionsAsync(false)),
    pick:async()=>{const options:Picker.ImagePickerOptions={mediaTypes:['images'],allowsEditing:false,quality:1,exif:false,base64:false,allowsMultipleSelection:false};
      const result=origin==='camera'?await Picker.launchCameraAsync(options):await Picker.launchImageLibraryAsync(options);
      if(result.canceled)return null;const asset=result.assets[0];picked=asset.uri;return asset;},
    queue:async(asset:CaptureSelection)=>{
      let normalized:string|undefined;const context=ImageManipulator.manipulate(asset.uri);
      try{
        if(!Number.isFinite(asset.width)||!Number.isFinite(asset.height)||asset.width<1||asset.height<1)throw Error('This image could not be opened. Try another photo.');
        const edge=2048;if(Math.max(asset.width,asset.height)>edge)context.resize(asset.width>=asset.height?{width:edge}:{height:edge});
        const rendered=await context.renderAsync();
        try{const saved=await rendered.saveAsync({format:SaveFormat.JPEG,compress:0.8,base64:false});normalized=saved.uri;
          if(!sameOwner())throw Error('Account changed. Please capture again in your original account.');
          if(new File(saved.uri).size>5*1024*1024)throw Error('This image is too large. Try a smaller screenshot.');
          return await enqueueFindImage(saved.uri,origin,owner);
        }finally{rendered.release();}
      }finally{context.release();if(normalized)await clean(normalized);}
    },
  });}finally{if(picked)await clean(picked);}
}
