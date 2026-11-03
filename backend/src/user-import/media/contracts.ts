import { createHash } from 'node:crypto';
import { ShareError, uuid } from '../share/contracts';
export const PRIVATE_FIND_BUCKET = 'find-private-images';
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export type ImageUploadInput = { captureId: string; sha256: string; size: number; mime: 'image/jpeg' | 'image/png' | 'image/webp'; origin: 'camera' | 'gallery' | null };
export type ImageAsset = { id: string; user_id: string; capture_id: string; request_digest: string; expected_digest: string; expected_size: number; mime: string;
  state: 'open' | 'verifying' | 'accepted' | 'duplicate' | 'deleting' | 'deleted'; staging_path: string; original_path: string; thumbnail_path: string;
  source_id: string | null; import_id: string | null; upload_expires_at: string; verify_lease: string | null; cleanup_lease: string | null; normalized_digest: string | null };
export function mediaId(value: unknown): string { if (typeof value !== 'string' || !uuid.test(value)) throw new ShareError('image_not_found',404); return value; }
export function imageUploadInput(value: unknown): ImageUploadInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ShareError('invalid_image_upload');
  const input = value as Record<string,unknown>;
  if (Object.keys(input).some(key => !['captureId','sha256','size','mime','origin'].includes(key)) || typeof input.captureId !== 'string' || !uuid.test(input.captureId)
    || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256) || !Number.isSafeInteger(input.size) || (input.size as number)<1 || (input.size as number)>IMAGE_MAX_BYTES
    || !['image/jpeg','image/png','image/webp'].includes(String(input.mime)) || ![undefined,null,'camera','gallery'].includes(input.origin as string)) throw new ShareError('invalid_image_upload');
  return { captureId: input.captureId,sha256: input.sha256,size: input.size as number,mime: input.mime as ImageUploadInput['mime'],origin: input.origin as ImageUploadInput['origin'] ?? null };
}
export const imageRequestDigest = (input: ImageUploadInput) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export const imageDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function assetStatus(asset: ImageAsset) { return { uploadId: asset.id, state: asset.state, importId: asset.import_id,
  deletionPending: asset.state === 'deleting', uploadExpiresAt: new Date(Date.parse(asset.upload_expires_at)-3600000).toISOString() }; }
