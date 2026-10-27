export type PrivacyStorage={getItem:(key:string)=>Promise<string|null>;setItem:(key:string,value:string)=>Promise<void>;removeItem:(key:string)=>Promise<void>};
/** Only a withdrawal marker is durable. It contains no token, history or feature payload. */
export class PendingPersonalizationWithdrawals{
 private active=new Map<string,Promise<void>>();
 constructor(private storage:PrivacyStorage,private send:(scope:string)=>Promise<void>){}
 private key(scope:string){return `mystash.personalization.withdrawal.${scope}`;}
 async withdraw(scope:string){if(!scope||scope==='guest')throw new Error('Verified account required');await this.storage.setItem(this.key(scope),'1');await this.flush(scope);}
 async flush(scope:string):Promise<void>{
  if(!scope||scope==='guest')return;
  const existing=this.active.get(scope);if(existing)return existing;
  const run=(async()=>{if(await this.storage.getItem(this.key(scope))==='1'){await this.send(scope);await this.storage.removeItem(this.key(scope));}})();
  this.active.set(scope,run);try{await run;}finally{if(this.active.get(scope)===run)this.active.delete(scope);}
 }
}
