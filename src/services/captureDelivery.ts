import type { PendingImage } from '../../modules/mystash-share';
export type ImageReceipt = {uploadId:string;state:string;importId:string|null;upload?:{signedUrl:string;path:string}};
export class CaptureDeliveryError extends Error {
  constructor(readonly status:number,readonly code:string,readonly retryAfter=0){super('Your capture is still securely stored on this device.');}
}
export type ImageOutbox = {
  list(owner:string):Promise<PendingImage[]>;
  bytes(id:string,owner:string):Promise<string>;
  update(id:string,owner:string,patch:Partial<PendingImage>):Promise<void>;
  remove(id:string,owner:string):Promise<void>;
};
export type ImageTransport = {initialize(row:PendingImage):Promise<ImageReceipt>;complete(id:string,owner:string):Promise<ImageReceipt>;
  upload(row:PendingImage,receipt:ImageReceipt,bytes:string):Promise<void>;exists(id:string,owner:string):Promise<boolean>};
/** One foreground drain, stable capture IDs, encrypted checkpoints, and identity fencing. */
export function createCaptureDelivery(store:ImageOutbox,api:ImageTransport,changed:()=>void,now=Date.now){
  let owner:string|null=null,epoch=0,running:Promise<void>|null=null;
  const current=(account:string,token:number)=>owner===account&&epoch===token;
  async function drain(account:string,token:number,force:boolean){
    const rows=await store.list(account);
    for(const row of rows){
      if(!current(account,token))return;
      if(row.owner!==account)continue;
      if(row.state==='accepted'){
        if(row.importId&&await api.exists(row.importId,account)&&current(account,token)){await store.remove(row.id,account);changed();}continue;
      }
      if(!force&&(row.state==='needs_review'||row.notBefore>now()))continue;
      let accepted=false;
      try{
        await store.update(row.id,account,{state:'uploading'});changed();
        let receipt=await api.initialize(row);
        if(!current(account,token))return;
        await store.update(row.id,account,{uploadId:receipt.uploadId});
        if(!receipt.importId){
          if(receipt.state!=='open')throw new CaptureDeliveryError(409,'image_busy');
          // Recover a successful upload whose completion acknowledgement was lost.
          if(row.uploadId===receipt.uploadId){
            try{receipt=await api.complete(receipt.uploadId,account);}
            catch(error){if(!(error instanceof CaptureDeliveryError)||error.code!=='image_storage_unavailable')throw error;}
          }
          if(!receipt.importId){
            const bytes=await store.bytes(row.id,account);
            if(!current(account,token))return;
            await api.upload(row,receipt,bytes);
            if(!current(account,token))return;
            receipt=await api.complete(receipt.uploadId,account);
          }
        }
        if(!current(account,token))return;
        if(!receipt.importId)throw new CaptureDeliveryError(503,'image_receipt_unavailable');
        // Purge encrypted pixels only after durable acceptance; retain reconciliation metadata.
        accepted=true;await store.update(row.id,account,{state:'accepted',importId:receipt.importId});changed();
        if(await api.exists(receipt.importId,account)&&current(account,token)){await store.remove(row.id,account);changed();}
      }catch(error){
        if(!current(account,token))return;
        if(accepted)continue; // History refresh failure cannot make acknowledged pixels upload again.
        const status=error instanceof CaptureDeliveryError?error.status:0,attempts=row.attempts+1;
        const state=status===401||status===403?'needs_auth':([400,410,422].includes(status)||attempts>=12)?'needs_review':'pending';
        const delay=Math.max(error instanceof CaptureDeliveryError?error.retryAfter:0,Math.min(900,15*2**Math.min(attempts,6)));
        // The native boundary checks identity again; a late callback cannot rewrite another account.
        await store.update(row.id,account,{state,attempts,notBefore:now()+delay*1000});changed();
      }
    }
  }
  return {configure(value:string|null){if(owner!==value){owner=value;epoch++;}},
    pump(force=false){if(running)return running;if(!owner)return Promise.resolve();const account=owner,token=epoch;
      running=drain(account,token,force).catch(()=>{/* Native storage/account errors never discard records. */}).finally(()=>{running=null;});return running;},
  };
}
