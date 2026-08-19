import { ingestLog } from '../pipeline/ingestLog';
import type { UserEventName, UserEventPayload } from './domain/events';

export function emitUserEvent(event: UserEventName, payload: UserEventPayload): void {
  ingestLog('info', event, {
    svc: 'user',
    userId: payload.userId,
    occurredAt: payload.occurredAt,
    accountStatus: payload.accountStatus ?? null,
    creatorStatus: payload.creatorStatus ?? null,
    from: payload.from ?? null,
    to: payload.to ?? null,
    username: payload.username ?? null,
    oldUsername: payload.oldUsername ?? null,
    newUsername: payload.newUsername ?? null,
  });
}
