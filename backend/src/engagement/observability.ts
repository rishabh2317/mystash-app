import { ingestLog } from '../pipeline/ingestLog';
import type { EngagementEventName, EngagementEventPayload } from './domain/events';

export function emitEngagementEvent(
  event: EngagementEventName,
  payload: EngagementEventPayload,
): void {
  const { actorUserId: _actor, anonymousId: _anonymous, ...safe } = payload;
  ingestLog('info', event, {
    svc: 'engagement',
    domain: 'engagement',
    ...safe,
    objectId: payload.objectType === 'user' ? undefined : payload.objectId,
  });
}
