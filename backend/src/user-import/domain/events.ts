import type { SharedInputRejection } from './sharedInput';
import type { UserImportStatus } from './types';

export type UserImportEventName = 'UserImportReceived' | 'UserImportRejected';

export type UserImportEventPayload = {
  userId: string;
  importId: string | null;
  platform: string | null;
  /** Global content identity this submission resolved to. */
  contentSourceId?: string | null;
  status: UserImportStatus | null;
  created?: boolean;
  /** Internal rejection reason — never returned verbatim to the client. */
  reason?: SharedInputRejection;
};

export function buildUserImportEventPayload(
  partial: UserImportEventPayload,
): UserImportEventPayload {
  return {
    userId: partial.userId,
    importId: partial.importId,
    platform: partial.platform ?? null,
    contentSourceId: partial.contentSourceId ?? null,
    status: partial.status ?? null,
    created: partial.created,
    reason: partial.reason,
  };
}
