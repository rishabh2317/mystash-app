import { ingestLog } from '../pipeline/ingestLog';
import type { EngagementEventName, EngagementEventPayload } from './domain/events';

export function emitEngagementEvent(
  event: EngagementEventName,
  payload: EngagementEventPayload,
): void {
  ingestLog('info', event, {
    svc: 'engagement',
    domain: 'engagement',
    ...payload,
  });
}
