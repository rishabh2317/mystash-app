import * as ExpoCrypto from 'expo-crypto';

/** Client UUID for Engagement idempotency (`event_id`). */
export function newEventId(): string {
  return ExpoCrypto.randomUUID();
}
