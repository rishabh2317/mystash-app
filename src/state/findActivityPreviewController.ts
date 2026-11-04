import type { FindScreenDetail } from '@/src/services/findClient';
import { findActivityPreviews, type FindActivityPreview } from '@/src/ui/findDashboard';

export type FindActivityPreviewState={owner:string|null;id:string|null;revision:string|null;items:FindActivityPreview[];loading:boolean;loaded:boolean;error:boolean};
const empty=(owner:string|null,id:string|null):FindActivityPreviewState=>({owner,id,revision:null,items:[],loading:false,loaded:false,error:false});

/** One Activity detail reader. List filters never configure or invalidate it. */
export function createFindActivityPreviewController(api:{detail(id:string,owner:string):Promise<FindScreenDetail>}){
  let state=empty(null,null),epoch=0;
  const listeners=new Set<()=>void>();
  const publish=(patch:Partial<FindActivityPreviewState>)=>{state={...state,...patch};listeners.forEach(fn=>fn());};
  return {
    getState:()=>state,
    subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
    configure(owner:string|null,id:string|null,revision:string,expanded:boolean,hasResults:boolean){
      if(state.owner!==owner||state.id!==id){epoch++;state=empty(owner,id);publish({});}
      if(!hasResults){if(state.items.length||state.loading){epoch++;publish({revision:null,items:[],loading:false,loaded:false,error:false});}return;}
      if(!owner||!id||!expanded||!hasResults||state.revision===revision)return;
      const token=++epoch;
      publish({revision,items:[],loading:true,loaded:false,error:false});
      void api.detail(id,owner).then(detail=>{
        if(token!==epoch||state.owner!==owner||state.id!==id)return;
        publish({items:findActivityPreviews(detail),loading:false,loaded:true,error:false});
      }).catch(()=>{
        if(token!==epoch||state.owner!==owner||state.id!==id)return;
        publish({loading:false,loaded:true,error:true});
      });
    },
    clear(){epoch++;state=empty(null,null);publish({});},
  };
}
