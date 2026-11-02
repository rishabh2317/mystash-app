import type { SupabaseClient } from '@supabase/supabase-js';
import { getPipelineConfig } from '../../config/pipelineConfig';
import { parseAcceptance, ShareError, type ShareIntent } from './contracts';

export type AcceptanceReply = { protocolVersion: 2; importId: string; created: boolean; replayed: boolean;
  delivery: 'accepted'; intent?: { state: 'saved' | 'conflict'; revision: number } };
export type ShareAcceptanceStore = {
  accept(userId: string, input: ReturnType<typeof parseAcceptance>): Promise<AcceptanceReply>;
  captureIntent(userId: string, input: ReturnType<typeof parseAcceptance>): Promise<{ state: 'saved' | 'conflict'; revision: number }>;
  updateIntent(userId: string, importId: string, intent: ShareIntent, revision: number): Promise<number>;
};
export function shareAcceptanceStore(db: SupabaseClient): ShareAcceptanceStore {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      if (error.message.includes('capture_conflict')) throw new ShareError('capture_conflict', 409);
      if (error.message.includes('revision_conflict')) throw new ShareError('revision_conflict', 409);
      if (error.message.includes('import_not_found')) throw new ShareError('import_not_found', 404);
      throw new ShareError('share_storage_unavailable', 503);
    }
    return data as T;
  }
  return {
    accept: (userId, input) => rpc('share_accept', { p_user: userId, p_capture: input.clientCaptureId,
      p_digest: input.digest, p_url: input.normalizedUrl, p_dedupe: input.dedupeKey,
      p_platform: input.identity.platform, p_external: input.identity.externalId,
      p_media_kind: input.identity.mediaKind, p_pipeline: getPipelineConfig().pipelineVersion }),
    captureIntent: (userId, input) => rpc('share_capture_intent', { p_user: userId, p_capture: input.clientCaptureId,
      p_kind: input.intent?.kind ?? null, p_note: input.intent?.note ?? null, p_revision: input.expectedIntentRevision }),
    updateIntent: (userId, importId, intent, revision) => rpc('share_update_intent', { p_user: userId,
      p_import: importId, p_kind: intent.kind, p_note: intent.note, p_revision: revision }),
  };
}
export class ShareAcceptanceService {
  constructor(private readonly store: ShareAcceptanceStore, private readonly admit: (userId: string) => Promise<boolean>,
    private readonly intentEnabled: () => boolean) {}
  async accept(userId: string, body: unknown): Promise<AcceptanceReply> {
    const input = parseAcceptance(body);
    if (input.intent && !this.intentEnabled()) throw new ShareError('intent_unavailable', 503);
    if (!await this.admit(userId)) throw new ShareError('share_capacity', 429);
    const reply = await this.store.accept(userId, input);
    if (input.intent) reply.intent = await this.store.captureIntent(userId, input);
    return { ...reply, protocolVersion: 2, delivery: 'accepted' };
  }
}
