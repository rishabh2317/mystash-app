export type FeedFailureKind = 'offline' | 'error';

export type FeedUserCopy = {
  title: string;
  message: string;
  actionLabel: string;
};

/** Human copy only — never interpolates backend/SQL/RLS strings. */
export const FEED_COPY = {
  loadingMessage: 'Loading your feed…',
  empty: {
    title: 'No reels yet',
    message: 'Publish from Create, then pull to refresh.',
    actionLabel: 'Retry',
  } satisfies FeedUserCopy,
  error: {
    title: 'Couldn’t load your feed',
    message: 'Something went wrong. Try again in a moment.',
    actionLabel: 'Retry',
  } satisfies FeedUserCopy,
  offline: {
    title: 'You’re offline',
    message: 'Connect to the internet and try again.',
    actionLabel: 'Retry',
  } satisfies FeedUserCopy,
} as const;

export function classifyFeedLoadFailure(error: unknown): FeedFailureKind {
  const raw =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
        ? error
        : '';
  if (
    /offline|network request failed|failed to fetch|networkerror|internet|econnrefused|enotfound|timed out|timeout|socket/i.test(
      raw,
    )
  ) {
    return 'offline';
  }
  return 'error';
}

export function feedFailureCopy(kind: FeedFailureKind): FeedUserCopy {
  return kind === 'offline' ? FEED_COPY.offline : FEED_COPY.error;
}
