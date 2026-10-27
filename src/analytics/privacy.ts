import {UUID} from '../../backend/src/analytics/contracts';
export type Preferences={measurement_enabled:boolean;activity_enabled:boolean;revision:string|null;policy_version:number};
export const MEASUREMENT_OFF:Preferences={measurement_enabled:false,activity_enabled:false,revision:null,policy_version:1};
/** Account consent alone does not silently opt a new device in. Unknown policies fail closed. */
export function devicePreferences(raw:unknown,receipt:string|null):Preferences{
  if(!raw||typeof raw!=='object')return MEASUREMENT_OFF;
  const p=raw as Partial<Preferences>;
  if(p.policy_version!==1||typeof p.measurement_enabled!=='boolean'||typeof p.activity_enabled!=='boolean')return MEASUREMENT_OFF;
  const revision=typeof p.revision==='string'&&UUID.test(p.revision)?p.revision:null;
  const enabled=p.measurement_enabled&&revision!==null&&receipt===revision;
  return {measurement_enabled:enabled,activity_enabled:enabled&&p.activity_enabled,revision,policy_version:1};
}

/** Cold session restoration is verified against the cached scope by the queue, not a logout. */
export const analyticsIdentityChanged=(previous:string|null|undefined,next:string|null)=>previous!==undefined&&previous!==next;
