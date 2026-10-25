import { LIBRARY_SYNC_PAGES_PER_JOB, type YouTubeLibraryItem } from './youtubePlaylist';

export type LibraryPage = {
  uploadsPlaylistId: string;
  items: YouTubeLibraryItem[];
  nextPageToken: string | null;
};

/**
 * Pages a provider library without holding the HTTP request.
 * Stops after a fixed page budget and asks the caller to enqueue the rest.
 */
export async function runBoundedLibrarySync(params: {
  runStartedAt: string;
  pageToken: string | null;
  uploadsPlaylistId: string | null;
  pagesPerJob?: number;
  fetchPage: (input: {
    pageToken: string | null;
    uploadsPlaylistId: string | null;
  }) => Promise<LibraryPage>;
  applyItems: (items: YouTubeLibraryItem[], seenAt: string) => Promise<void>;
  onComplete: () => Promise<void>;
  onContinue: (next: { pageToken: string; uploadsPlaylistId: string }) => Promise<void>;
}): Promise<'complete' | 'continued'> {
  let pageToken = params.pageToken;
  let playlistId = params.uploadsPlaylistId;
  const budget = params.pagesPerJob ?? LIBRARY_SYNC_PAGES_PER_JOB;
  for (let pages = 0; pages < budget; pages += 1) {
    const page = await params.fetchPage({ pageToken, uploadsPlaylistId: playlistId });
    playlistId = page.uploadsPlaylistId;
    const seenAt = new Date().toISOString();
    await params.applyItems(page.items, seenAt < params.runStartedAt ? params.runStartedAt : seenAt);
    if (!page.nextPageToken) {
      await params.onComplete();
      return 'complete';
    }
    pageToken = page.nextPageToken;
    if (pages + 1 >= budget) {
      await params.onContinue({ pageToken, uploadsPlaylistId: playlistId });
      return 'continued';
    }
  }
  return 'continued';
}

export function librarySyncRejection(input: {
  provider: string | null;
  youtubeEnabled: boolean;
}): { statusCode: number; message: string } | null {
  if (!input.provider) return { statusCode: 404, message: 'Connected account not found' };
  if (input.provider !== 'youtube') {
    return {
      statusCode: 403,
      message:
        'Instagram library sync is not available. Meta policy does not allow import or native playback of connected media.',
    };
  }
  if (!input.youtubeEnabled) return { statusCode: 403, message: 'YouTube library sync is disabled' };
  return null;
}
