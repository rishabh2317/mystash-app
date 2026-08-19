import type { AccountStatus, CreatorStatus } from './types';

export type UserEventName =
  | 'UserCreated'
  | 'ProfileUpdated'
  | 'UsernameChanged'
  | 'CreatorStatusChanged'
  | 'AccountSuspended'
  | 'AccountReinstated'
  | 'AccountDeleted'
  | 'AccountRestored';

export type UserEventPayload = {
  userId: string;
  occurredAt: string;
  accountStatus?: AccountStatus;
  creatorStatus?: CreatorStatus;
  from?: string;
  to?: string;
  username?: string;
  oldUsername?: string;
  newUsername?: string;
};

export function buildUserEventPayload(
  partial: Omit<UserEventPayload, 'occurredAt'> & { occurredAt?: string },
): UserEventPayload {
  return {
    ...partial,
    occurredAt: partial.occurredAt ?? new Date().toISOString(),
  };
}
