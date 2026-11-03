import type { SupabaseClient } from '@supabase/supabase-js';
import { ShareError } from '../share/contracts';
import { PRIVATE_FIND_BUCKET, IMAGE_MAX_BYTES, imageDigest } from './contracts';
import { PrivateImageService, type MediaStore, type PrivateImageStorage } from './service';
export function createPrivateImageService(db: SupabaseClient) {
  const store: MediaStore = { async command<T>(user: string | null, action: string, id: string | null = null, input: Record<string,unknown> = {}): Promise<T> {
    const {data,error}=await db.rpc('find_media_command',{p_user:user,p_action:action,p_id:id,p_input:input}).abortSignal(AbortSignal.timeout(25000));
    const conflict=error?.code==='23514'||error?.code==='23505';
    if (error || data===null) throw new ShareError(error?.code==='P0002'?'image_not_found':conflict?'image_conflict':error?.code==='54000'?'image_quota':'image_unavailable',
      error?.code==='P0002'?404:conflict?409:error?.code==='54000'?429:503);
    return data as T;
  } };
  const bucket=db.storage.from(PRIVATE_FIND_BUCKET);
  const storage: PrivateImageStorage = {
    async signUpload(path) {
      const {data,error}=await bucket.createSignedUploadUrl(path,{upsert:false});
      if(error || !data) throw new ShareError('image_upload_unavailable',503);
      return {signedUrl:data.signedUrl,token:data.token};
    },
    async read(path) {
      const {data,error}=await bucket.download(path);
      if(error || !data) throw new ShareError('image_storage_unavailable',503);
      if(data.size>IMAGE_MAX_BYTES) throw new ShareError('image_too_large',422);
      return Buffer.from(await data.arrayBuffer());
    },
    async put(path,bytes) {
      const {error}=await bucket.upload(path,bytes,{contentType:'image/jpeg',upsert:false,cacheControl:'0'});
      if(error) {
        // Lost acknowledgement replay may reuse an identical immutable object only.
        const existing=await storage.read(path);
        if(imageDigest(existing)!==imageDigest(bytes)) throw new ShareError('image_object_conflict',409);
      }
    },
    async remove(paths) { const {error}=await bucket.remove(paths); if(error) throw new ShareError('image_deletion_deferred',503); },
  };
  return new PrivateImageService(store,storage);
}
