import { createHash } from 'node:crypto';
import { normalizeSharedInput, userImportDedupeKey } from '../domain/sharedInput';
import { resolveContentSourceIdentity } from '../../content-source/domain/identity';

export class ShareError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ShareIntent = { kind: 'product' | 'place' | 'both' | null; note: string | null };
export function parseIntent(value: unknown): ShareIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ShareError('invalid_intent');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['kind', 'note'].includes(k))) throw new ShareError('invalid_intent');
  if (v.kind !== null && !['product', 'place', 'both'].includes(String(v.kind))) throw new ShareError('invalid_intent');
  if (v.note !== null && typeof v.note !== 'string') throw new ShareError('invalid_note');
  const note = typeof v.note === 'string' ? v.note.trim() : null;
  if (note && (Array.from(note).length > 280 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(note))) throw new ShareError('invalid_note');
  return { kind: v.kind as ShareIntent['kind'], note: note || null };
}
export function parseAcceptance(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ShareError('invalid_share');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['text', 'clientCaptureId', 'intent', 'expectedIntentRevision'].includes(k))) throw new ShareError('invalid_share');
  if (typeof v.clientCaptureId !== 'string' || !uuid.test(v.clientCaptureId)) throw new ShareError('invalid_capture_id');
  const parsed = normalizeSharedInput(typeof v.text === 'string' ? v.text : '');
  if (!parsed.ok) throw new ShareError('invalid_link');
  const intent = v.intent === undefined ? undefined : parseIntent(v.intent);
  const revision = v.expectedIntentRevision;
  if (revision !== undefined && revision !== null && (!Number.isSafeInteger(revision) || Number(revision) < 0)) throw new ShareError('invalid_revision');
  const identity = resolveContentSourceIdentity(parsed.value.normalizedUrl);
  const digest = createHash('sha256').update(JSON.stringify([parsed.value.normalizedUrl, intent ?? null, revision ?? null])).digest('hex');
  return { ...parsed.value, identity, clientCaptureId: v.clientCaptureId, intent,
    expectedIntentRevision: revision == null ? null : Number(revision), digest,
    dedupeKey: userImportDedupeKey(parsed.value.normalizedUrl) };
}
