export type CaptureOrigin='camera'|'gallery';
export type CapturePermission={granted:boolean;canAskAgain:boolean;accessPrivileges?:string};
export type CaptureSelection={uri:string;width:number;height:number};
export class ImageCaptureError extends Error{constructor(readonly kind:'permission'|'settings'|'unsupported'|'capture',message:string){super(message);}}
/** Injectable permission/picker boundary keeps cancellations and account switches testable. */
export async function selectCapture(origin:CaptureOrigin,ports:{supported:()=>Promise<boolean>;permission:(request:boolean)=>Promise<CapturePermission>;pick:()=>Promise<CaptureSelection|null>;queue:(asset:CaptureSelection)=>Promise<{id:string}>;sameOwner:()=>boolean}){
  if(!await ports.supported())throw new ImageCaptureError('unsupported','Image capture needs an updated Mystash installation on Android or iOS.');
  if(!ports.sameOwner())throw new ImageCaptureError('capture','Sign in to your original account to capture.');
  let permission=await ports.permission(false);
  if(!permission.granted&&permission.canAskAgain)permission=await ports.permission(true);
  if(!permission.granted)throw new ImageCaptureError(permission.canAskAgain?'permission':'settings',origin==='camera'?'Allow camera access to take a photo.':'Allow access to selected photos to choose a screenshot or image.');
  if(!ports.sameOwner())return null;
  const asset=await ports.pick();if(!asset)return null;
  if(!ports.sameOwner())return null;
  return ports.queue(asset);
}
