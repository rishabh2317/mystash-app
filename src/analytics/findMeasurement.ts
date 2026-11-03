import {analyticsSnapshot,enqueueObservation} from './client';
export type FindCaptureOrigin='url'|'camera'|'gallery';
/** No URLs, pixels, filenames, hashes, notes or result titles cross this boundary. */
export function observeFind(owner:string|null,name:'find.opened'|'find.results_opened'|'find.capture_action_chosen'|'find.capture_submitted'|'find.capture_cancelled',input:{findId?:string;origin?:FindCaptureOrigin}={}){
  if(process.env.EXPO_PUBLIC_FIND_MEASUREMENT_ENABLED!=='true')return;
  const state=analyticsSnapshot();if(!state.enabled||state.scope!==(owner??'guest'))return;
  enqueueObservation(name,name==='find.results_opened'?'find':'app',name==='find.results_opened'?input.findId:undefined,'find',input.origin?{capture_origin:input.origin}:{});
}
