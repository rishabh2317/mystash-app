import { ingestLog } from '../pipeline/ingestLog';
import type { UserImportEventName, UserImportEventPayload } from './domain/events';

export function emitUserImportEvent(
  event: UserImportEventName,
  payload: UserImportEventPayload,
): void {
  ingestLog('info', event, {
    svc: 'user-import',
    domain: 'user-import',
    userId: payload.userId,
    importId: payload.importId,
    platform: payload.platform,
    contentSourceId: payload.contentSourceId ?? null,
    status: payload.status,
    created: payload.created ?? null,
    reason: payload.reason ?? null,
  });
}
