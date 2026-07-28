import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FrameRef } from '../domain/types';
import { ingestLog } from '../pipeline/ingestLog';

export const INGEST_FRAMES_BUCKET = 'ingest-frames';

/** Signed URL TTL for review evidence (7 days). */
const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7;

export type UploadedFrames = {
  /** Frames with signed URLs in `storagePath`; `localPath` kept for MU. */
  frames: FrameRef[];
  /** Durable bucket object paths aligned by index with `frames`. */
  objectPaths: string[];
  sha256s: string[];
};

/**
 * Upload local JPEG frames to Supabase Storage.
 * `storagePath` on each FrameRef becomes a signed URL for evidence; `objectPaths` are durable keys for DB.
 */
export async function uploadFramesToStorage(
  admin: SupabaseClient,
  params: {
    ingestId: string;
    stage: string;
    frames: FrameRef[];
  },
): Promise<UploadedFrames> {
  const frames: FrameRef[] = [];
  const objectPaths: string[] = [];
  const sha256s: string[] = [];

  for (const frame of params.frames) {
    const local = frame.localPath;
    if (!local) {
      frames.push(frame);
      objectPaths.push(frame.storagePath);
      sha256s.push('');
      continue;
    }

    const buf = await fs.readFile(local);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const objectPath = `${params.ingestId}/${params.stage}/frame_${String(frame.index).padStart(3, '0')}_${frame.timestampMs}.jpg`;

    const { error: upErr } = await admin.storage.from(INGEST_FRAMES_BUCKET).upload(objectPath, buf, {
      contentType: 'image/jpeg',
      upsert: true,
    });

    if (upErr) {
      ingestLog('warn', 'frame_storage.upload_failed', {
        ingestId: params.ingestId,
        stage: params.stage,
        index: frame.index,
        message: upErr.message,
      });
      frames.push(frame);
      objectPaths.push(local);
      sha256s.push(sha256);
      continue;
    }

    const { data: signed } = await admin.storage
      .from(INGEST_FRAMES_BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SEC);

    objectPaths.push(objectPath);
    sha256s.push(sha256);
    frames.push({
      ...frame,
      storagePath: signed?.signedUrl ?? objectPath,
    });
  }

  return { frames, objectPaths, sha256s };
}
