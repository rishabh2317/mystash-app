import {withRequestTimeout} from './requestTimeout';
import {CaptureDeliveryError,type ImageReceipt,type ImageTransport} from './captureDelivery';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function privateFindImageUrl(base:string|undefined,id:string,variant:'original'|'thumbnail'):string|null{
  try{const url=new URL(base??'');if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!uuid.test(id))return null;
    return `${url.href.replace(/\/$/,'')}/finds/${id}/media/${variant}`;
  }catch{return null;}
}
export function decodeCaptureBytes(value:string):ArrayBuffer{
  // A repeated-group regexp exhausts the JS regexp stack at camera-image sizes.
  // Validate and decode linearly, with a bounded output allocation.
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,equals=value.indexOf('=');
  if(!value.length||value.length>6990508||value.length%4!==0||equals!==-1&&equals!==value.length-padding)throw new CaptureDeliveryError(422,'invalid_local_image');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',table=new Int16Array(128).fill(-1),size=value.length/4*3-padding,out=new Uint8Array(size);
  for(let i=0;i<alphabet.length;i++)table[alphabet.charCodeAt(i)]=i;
  for(let i=0,j=0;i<value.length;i+=4){let n=0;for(let k=0;k<4;k++){const code=value.charCodeAt(i+k),number=code===61&&i+k>=value.length-padding?0:table[code];if(number===undefined||number<0)throw new CaptureDeliveryError(422,'invalid_local_image');n=(n<<6)|number;}
    if(j<size)out[j++]=(n>>16)&255;if(j<size)out[j++]=(n>>8)&255;if(j<size)out[j++]=n&255;}
  return out.buffer;
}
export function createCaptureTransport(deps:{session:()=>Promise<{userId:string;accessToken:string}|null>;base:()=>string|undefined;storage:()=>string|undefined;fetch:typeof fetch}):ImageTransport{
  const checkedURL=(value:string|undefined)=>{try{const url=new URL(value??'');if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error();return url;}catch{throw new CaptureDeliveryError(503,'capture_not_configured');}};
  async function owner(expected:string){const s=await deps.session();if(!s||s.userId!==expected)throw new CaptureDeliveryError(401,'account_changed');return s;}
  async function request(path:string,account:string,body?:unknown){
    const session=await owner(account),base=checkedURL(deps.base()).href.replace(/\/$/,'');
    const response=await withRequestTimeout(60000,signal=>deps.fetch(`${base}/finds${path}`,{method:body===undefined?'GET':'POST',signal,redirect:'error',cache:'no-store',headers:{Authorization:`Bearer ${session.accessToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
    await owner(account);let result;try{result=await response.json();}catch{throw new CaptureDeliveryError(503,'invalid_receipt');}
    await owner(account);
    if(!response.ok){const retry=response.headers.get('Retry-After'),seconds=retry?(Number.isFinite(Number(retry))?Number(retry):(Date.parse(retry)-Date.now())/1000):0;
      throw new CaptureDeliveryError(response.status,typeof result.error==='string'?result.error:'capture_unavailable',Math.min(86400,Math.max(0,seconds||0)));}
    return result;
  }
  function receipt(value:ImageReceipt){if(!value||!uuid.test(value.uploadId)||!['open','verifying','accepted','duplicate','deleting','deleted'].includes(value.state)||value.importId!==null&&!uuid.test(value.importId))throw new CaptureDeliveryError(503,'invalid_receipt');return value;}
  return{
    initialize:async row=>receipt(await request('/media/uploads',row.owner,{captureId:row.id,sha256:row.sha256,size:row.size,mime:row.mime,origin:row.origin})),
    complete:async(id,account)=>receipt(await request(`/media/uploads/${encodeURIComponent(id)}/complete`,account,{})),
    exists:async(id,account)=>{const r=await request('/batch',account,{ids:[id]});return Array.isArray(r.items)&&r.items.some((item:{id:string})=>item.id===id)
      ||Array.isArray(r.unavailableIds)&&r.unavailableIds.includes(id);},
    async upload(row,r,base64){
      await owner(row.owner);const expected=checkedURL(deps.storage()),url=new URL(r.upload?.signedUrl??'https://invalid.invalid');
      const path=r.upload?.path;
      if(url.protocol!=='https:'||url.origin!==expected.origin||url.username||url.password||url.hash||!path||!new RegExp(`^${row.owner}/[a-f0-9-]{36}/input$`).test(path)
        ||decodeURIComponent(url.pathname)!==`${expected.pathname.replace(/\/$/,'')}/storage/v1/object/upload/sign/find-private-images/${path}`||!url.searchParams.get('token'))throw new CaptureDeliveryError(503,'invalid_upload_capability');
      const bytes=decodeCaptureBytes(base64);if(bytes.byteLength!==row.size)throw new CaptureDeliveryError(422,'invalid_local_image');
      await owner(row.owner);
      const response=await withRequestTimeout(90000,signal=>deps.fetch(url.href,{method:'PUT',redirect:'error',signal,headers:{'Content-Type':row.mime,'x-upsert':'false','Cache-Control':'max-age=0'},body:bytes}));
      await owner(row.owner);
      // An immutable object may exist after a lost acknowledgement. Completion still
      // verifies its digest; never overwrite it or treat this response as acceptance.
      if(!response.ok&&![400,409].includes(response.status))throw new CaptureDeliveryError(response.status,'image_upload_unavailable');
    },
  };
}
