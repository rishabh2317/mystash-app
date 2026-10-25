const MAX_KEY_LENGTH = 200;

function segment(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]/g, '_');
  if (!cleaned) throw new Error('idempotency key segment must not be empty');
  return cleaned;
}

function build(...parts: string[]): string {
  const key = parts.map(segment).join(':');
  if (key.length > MAX_KEY_LENGTH) throw new Error('idempotency key too long');
  return key;
}

/** Engagement facts already carry a unique client event id. */
export function engagementFactKey(factEventId: string): string {
  return build('fact', factEventId);
}

export function publishSucceededKey(collectionId: string, publishedAt: string): string {
  return build('collection', collectionId, 'published', publishedAt);
}

/** Keyed on the ingest: a publish can fail before its Collection exists. */
export function publishFailedKey(ingestId: string, failedAt: string): string {
  return build('ingest', ingestId, 'publish_failed', failedAt);
}

export function ingestTerminalKey(
  ingestId: string,
  state: 'ready_for_review' | 'failed',
  transitionAt: string,
): string {
  return build('ingest', ingestId, state, transitionAt);
}

export function librarySyncFailedKey(connectedAccountId: string, runStartedAt: string): string {
  return build('library_sync', connectedAccountId, runStartedAt);
}

export function needsReauthKey(connectedAccountId: string, transitionAt: string): string {
  return build('connected_account', connectedAccountId, 'needs_reauth', transitionAt);
}

export function creatorStatusKey(userId: string, status: string, changedAt: string): string {
  return build('creator_status', userId, status, changedAt);
}
