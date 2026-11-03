import { randomUUID } from 'node:crypto';
import { ShareError } from '../share/contracts';
import { imageUploadInput, imageRequestDigest, imageDigest, mediaId, assetStatus, type ImageAsset } from './contracts';
import { normalizeImage, type NormalizedImage } from './imageCodec';
export type MediaStore = { command<T>(user: string | null, action: string, id?: string | null, input?: Record<string,unknown>): Promise<T> };
export type PrivateImageStorage = { signUpload(path: string): Promise<{ signedUrl: string; token: string }>; read(path: string): Promise<Buffer>; put(path: string, bytes: Buffer): Promise<void>; remove(paths: string[]): Promise<void> };
export class PrivateImageService {
  constructor(readonly store: MediaStore, readonly storage: PrivateImageStorage, private readonly normalize: (bytes: Buffer,mime: string)=>Promise<NormalizedImage> = normalizeImage) {}
  async initialize(owner: string, body: unknown) {
    const input=imageUploadInput(body);
    let asset=await this.store.command<ImageAsset>(owner,'initialize',null,{...input,requestDigest:imageRequestDigest(input)});
    if (asset.state!=='open') return assetStatus(asset);
    const upload=await this.storage.signUpload(asset.staging_path);
    // Register the capability after minting and before exposing it. A delayed signer
    // cannot return a fresh token for a cancelled/deleted or rotated allocation.
    asset=await this.store.command<ImageAsset>(owner,'issued',asset.id,{path:asset.staging_path});
    return {...assetStatus(asset),upload:{...upload,path:asset.staging_path},maxBytes:5*1024*1024};
  }
  async status(owner: string,id: string) { return assetStatus(await this.store.command<ImageAsset>(owner,'status',mediaId(id))); }
  async complete(owner: string,id: string) {
    const lease=randomUUID(),asset=await this.store.command<ImageAsset>(owner,'claim',mediaId(id),{lease});
    if (asset.import_id) return {...assetStatus(asset),delivery:'accepted'};
    try {
      const bytes=await this.storage.read(asset.staging_path);
      if (bytes.length!==asset.expected_size || imageDigest(bytes)!==asset.expected_digest) throw new ShareError('image_digest_mismatch',422);
      const image=await this.normalize(bytes,asset.mime);
      await this.store.command(owner,'verifyLease',id,{lease});
      await this.storage.put(asset.original_path,image.original);
      await this.store.command(owner,'verifyLease',id,{lease});
      await this.storage.put(asset.thumbnail_path,image.thumbnail);
      const accepted=await this.store.command<ImageAsset>(owner,'accept',id,{lease,digest:image.digest,width:image.width,height:image.height,size:image.original.length});
      return {...assetStatus(accepted),delivery:'accepted'};
    } catch(error) {
      // No exception/provider text, object path or token is persisted or returned.
      await this.store.command(owner,'release',id,{lease}).catch(()=>{});
      if (error instanceof ShareError) throw error;
      throw new ShareError('image_completion_unavailable',503);
    }
  }
  async cancel(owner: string,id: string) { return assetStatus(await this.store.command<ImageAsset>(owner,'cancel',mediaId(id))); }
  async media(owner: string,importId: string,variant: string) {
    if (!['original','thumbnail'].includes(variant)) throw new ShareError('image_not_found',404);
    const asset=await this.store.command<ImageAsset>(owner,'media',mediaId(importId));
    const bytes=await this.storage.read(variant==='original'?asset.original_path:asset.thumbnail_path);
    // A deletion/account change that wins during Storage I/O blocks this response as well.
    await this.store.command(owner,'media',importId);
    return bytes;
  }
  async reconcile() {
    const lease=randomUUID(),rows=await this.store.command<ImageAsset[]>(null,'cleanupClaim',null,{lease});
    let cleaned=0;
    for(const asset of rows) {
      try {
        await this.storage.remove(asset.state==='accepted'?[asset.staging_path]:[asset.staging_path,asset.original_path,asset.thumbnail_path]);
        await this.store.command(null,'cleanupFinish',asset.id,{lease,state:asset.state});cleaned++;
      } catch { /* Durable claim expires and retries; no false permanent-deletion response. */ }
    }
    return cleaned;
  }
}
