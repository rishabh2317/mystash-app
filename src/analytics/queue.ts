import { UUID,validateEvent,type AnalyticsEvent } from '../../backend/src/analytics/contracts';
export type Ack={accepted?:string[];rejected_ids?:string[];reset?:boolean;discard?:boolean;pause?:boolean};
type Storage={getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;removeItem(key:string):Promise<void>};
const KEY='mystash.analytics.queue.v1';
const priority=(e:AnalyticsEvent)=>e.event_name.endsWith('.impression')?0:1;
export class AnalyticsQueue {
  private events:AnalyticsEvent[]=[]; private enabled=false;private scope='';private revision='';private generation=0;
  private sending=false;private nextAttempt=0;private failures=0;private writes=Promise.resolve();private savePending=false;
  dropped=0;
  constructor(private storage:Storage,private send:(events:AnalyticsEvent[],scope:string,revision:string)=>Promise<Ack>,private now=Date.now){}
  private save() {
    if(this.savePending)return;this.savePending=true;
    this.writes=this.writes.catch(()=>undefined).then(async()=>{
      this.savePending=false;
      if(this.enabled)await this.storage.setItem(KEY,JSON.stringify({scope:this.scope,revision:this.revision,events:this.events}));
      else await this.storage.removeItem(KEY);
    }).catch(()=>undefined);
  }

  pause(){
    const wasEnabled=this.enabled,value=JSON.stringify({scope:this.scope,revision:this.revision,events:this.events});
    this.enabled=false;this.generation++;
    if(wasEnabled)this.writes=this.writes.catch(()=>undefined).then(()=>this.storage.setItem(KEY,value)).catch(()=>undefined);
    return this.writes;
  }
  /** Hold only an already consented scope/revision. No collection or uploads while verification is unavailable. */
  async hold(scope:string,revision:string|null){
    const gen=++this.generation;this.enabled=false;this.events=[];this.scope=scope;this.revision=revision??'';
    await this.writes;
    const valid=scope==='guest'?revision==='':!!revision&&UUID.test(revision);
    const raw=valid?await this.storage.getItem(KEY).catch(()=>null):null;
    if(gen!==this.generation)return;
    if(raw&&raw.length<=524288)try{const saved=JSON.parse(raw);
      if(saved.scope===scope&&saved.revision===revision&&Array.isArray(saved.events))this.events=saved.events.filter((e:AnalyticsEvent)=>{
        try{validateEvent(e,'client',this.now());return this.now()-Date.parse(e.occurred_at)<86400000;}catch{return false;}
      }).slice(-500);
    }catch{/* Invalid caches cannot establish permission. */}
    while(JSON.stringify(this.events).length>500000)this.events.shift();
    const value=this.events.length?JSON.stringify({scope,revision,events:this.events}):null;
    this.writes=this.writes.catch(()=>undefined).then(async()=>{
      if(gen!==this.generation)return;
      if(value)await this.storage.setItem(KEY,value);else await this.storage.removeItem(KEY);
    }).catch(()=>undefined);await this.writes;
  }
  async configure(scope:string,revision:string,enabled:boolean) {
    const gen=++this.generation;this.enabled=false;this.scope=scope;this.revision=revision;this.events=[];this.nextAttempt=0;
    await this.writes;
    const raw=enabled?await this.storage.getItem(KEY).catch(()=>null):null;
    if(gen!==this.generation)return;
    if(raw&&raw.length<=524288)try {const saved=JSON.parse(raw);
      if(saved.scope===scope&&saved.revision===revision&&Array.isArray(saved.events))this.events=saved.events.filter((e:AnalyticsEvent)=>
        e&&(()=>{try{validateEvent(e,'client',this.now());return true;}catch{return false;}})()).slice(-500);
    }catch{/* Corrupt cache is discarded. */}
    this.enabled=enabled;this.save();await this.writes;
  }
  add(event:AnalyticsEvent) {
    if(!this.enabled)return;
    try{validateEvent(event,'client',this.now());}catch{this.dropped++;return;}
    this.events=this.events.filter(e=>this.now()-Date.parse(e.occurred_at)<86400000);
    const old=this.events.findIndex(e=>e.event_id===event.event_id);
    if(old<0)this.events.push(event);
    while(this.events.length>500||JSON.stringify(this.events).length>500000){
      const low=this.events.findIndex(e=>priority(e)===0);this.events.splice(low>=0?low:0,1);this.dropped++;
    }
    this.save();
  }
  async flush() {
    if(!this.enabled||this.sending||this.now()<this.nextAttempt)return;
    const previousCount=this.events.length;
    this.events=this.events.filter(e=>this.now()-Date.parse(e.occurred_at)<86400000);
    if(this.events.length!==previousCount)this.save();
    const first=this.events[0];if(!first)return;
    const batch=this.events.filter(e=>e.session_id===first.session_id).slice(0,25);
    const generation=this.generation;this.sending=true;
    try {const result=await this.send(batch,this.scope,this.revision);
      if(generation!==this.generation)return;
      if(result.pause){await this.pause();return;}
      if(result.reset){await this.configure(this.scope,this.revision,false);return;}
      const ack=new Set(result.accepted??[]);
      const rejected=new Set(result.rejected_ids??[]);
      if(result.discard)for(const e of batch)rejected.add(e.event_id);
      this.events=this.events.filter(e=>!rejected.has(e.event_id)&&
        !ack.has(e.event_id));
      this.dropped+=rejected.size;this.failures=0;this.nextAttempt=0;this.save();
    }catch{if(generation===this.generation){this.failures++;this.nextAttempt=this.now()+Math.min(300000,1000*2**Math.min(this.failures,8));}}
    finally{this.sending=false;}
  }
  count(){return this.events.length;}
  persisted(){return this.writes;}
}
