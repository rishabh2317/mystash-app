import type {Preferences} from './privacy';
export type MeasurementReply={enabled:boolean;preferences:Preferences};
export type MeasurementChange={measurement_enabled:boolean;activity_enabled:boolean;expected_revision?:string|null;decrease_only?:boolean};
type Storage={getItem:(k:string)=>Promise<string|null>;setItem:(k:string,v:string)=>Promise<void>;removeItem:(k:string)=>Promise<void>};
export const measurementDeviceReceipt=(scope:string)=>`mystash.analytics.device-consent.${scope}`;
const control=(scope:string)=>`mystash.analytics.controls.${scope}`;
const pending=(scope:string)=>`mystash.analytics.withdrawal.${scope}`;
/** Recovery never depends on collection flags and never creates a session identifier. */
export class MeasurementPrivacy {
 private active=new Map<string,Promise<unknown>>();
 constructor(private storage:Storage,private request:(scope:string,change?:MeasurementChange)=>Promise<MeasurementReply>){}
 private async serial<T>(scope:string,work:()=>Promise<T>):Promise<T>{
  const previous=this.active.get(scope)??Promise.resolve();const next=previous.catch(()=>undefined).then(work);
  this.active.set(scope,next);try{return await next;}finally{if(this.active.get(scope)===next)this.active.delete(scope);}
 }
 async hasPending(scope:string){return !!await this.storage.getItem(pending(scope));}
 async recoverable(scope:string){return !!(await this.storage.getItem(control(scope))||await this.storage.getItem(measurementDeviceReceipt(scope))||await this.storage.getItem(pending(scope)));}
 private async receipt(scope:string,p:Preferences,device:boolean){
  if(p.measurement_enabled||p.activity_enabled)await this.storage.setItem(control(scope),'1');else await this.storage.removeItem(control(scope));
  if(device&&p.measurement_enabled&&p.revision)await this.storage.setItem(measurementDeviceReceipt(scope),p.revision);else await this.storage.removeItem(measurementDeviceReceipt(scope));
 }
 private async replay(scope:string){
  const raw=await this.storage.getItem(pending(scope));if(!raw)return;
  const p=JSON.parse(raw);
  if(typeof p.measurement_enabled!=='boolean'||typeof p.activity_enabled!=='boolean'||p.activity_enabled)throw new Error('Invalid withdrawal marker');
  const r=await this.request(scope,{measurement_enabled:p.measurement_enabled,activity_enabled:false,decrease_only:true});
  await this.receipt(scope,r.preferences,p.keep_device===true);await this.storage.removeItem(pending(scope));
 }
 async flush(scope:string):Promise<void>{if(!scope||scope==='guest')return;return this.serial(scope,()=>this.replay(scope));}
 private async current(scope:string){const result=await this.request(scope);
  if(result.preferences.measurement_enabled||result.preferences.activity_enabled)await this.storage.setItem(control(scope),'1');else await this.storage.removeItem(control(scope));return result;
 }
 async read(scope:string){return this.serial(scope,async()=>{await this.replay(scope);return this.current(scope);});}
 async change(scope:string,change:MeasurementChange,activateDevice:boolean){return this.serial(scope,async()=>{
  if(change.decrease_only){
   // Persist the decrease before network access. The server clamps replays to current permissions.
   await this.storage.setItem(pending(scope),JSON.stringify({...change,keep_device:activateDevice}));
   await this.storage.removeItem(measurementDeviceReceipt(scope));await this.replay(scope);return this.current(scope);
  }
  await this.replay(scope);const reply=await this.request(scope,change);await this.receipt(scope,reply.preferences,activateDevice);return reply;
 });}
}
