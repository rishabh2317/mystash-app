import type { SupabaseClient } from '@supabase/supabase-js';
import { isConnectedAccountProviderEnabled } from '../connected-accounts/config';
import { ConnectedAccountServiceError } from '../connected-accounts/ConnectedAccountService';
import { createConnectedAccountService } from '../connected-accounts/factory';
import { createContentSourceService } from '../content-source/factory';
import { logger } from '../logger';
import { applyLibraryPage } from './applyLibraryPage';
import type { CreatorLibraryRepository, LibraryListItem, LibrarySyncState } from './CreatorLibraryRepository';
import { SupabaseCreatorLibraryRepository } from './SupabaseCreatorLibraryRepository';
import { enqueueCreatorLibrarySync } from './jobs/librarySyncQueue';
import { librarySyncRejection, runBoundedLibrarySync } from './runBoundedLibrarySync';
import { fetchYouTubeUploadsPage } from './youtubeLibraryClient';

export class CreatorLibraryServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CreatorLibraryServiceError';
  }
}

export class CreatorLibraryService {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly library: CreatorLibraryRepository,
  ) {}

  async list(userId: string, limit = 30): Promise<{ items: LibraryListItem[]; sync: LibrarySyncState | null }> {
    const bounded = Math.min(Math.max(limit, 1), 50);
    const accounts = await createConnectedAccountService(this.admin).listForUser(userId);
    const youtube = accounts.find((row) => row.provider === 'youtube' && row.status !== 'disconnected');
    const items = await this.library.listForUser(userId, bounded);
    const sync = youtube ? await this.library.getSyncState(youtube.id) : null;
    return { items, sync };
  }

  async requestSync(userId: string, connectedAccountId: string): Promise<{ queued: boolean }> {
    const accounts = createConnectedAccountService(this.admin);
    const account = await accounts.listForUser(userId).then((rows) =>
      rows.find((row) => row.id === connectedAccountId),
    );
    const rejection = librarySyncRejection({
      provider: account?.provider ?? null,
      youtubeEnabled: isConnectedAccountProviderEnabled('youtube'),
    });
    if (rejection) throw new CreatorLibraryServiceError(rejection.message, rejection.statusCode);
    if (!account) throw new CreatorLibraryServiceError('Connected account not found', 404);
    if (account.status !== 'active' && account.status !== 'needs_reauth') {
      throw new CreatorLibraryServiceError('Reconnect YouTube before syncing', 400);
    }
    const state = await this.library.getSyncState(connectedAccountId);
    if (state.status === 'running') return { queued: true };
    const runStartedAt = new Date().toISOString();
    await this.library.setSyncState(connectedAccountId, { status: 'running', error: null });
    try {
      await enqueueCreatorLibrarySync({
        userId,
        connectedAccountId,
        runStartedAt,
        pageToken: null,
        uploadsPlaylistId: null,
      });
    } catch (e) {
      await this.library.setSyncState(connectedAccountId, {
        status: 'failed',
        error: 'Sync queue is unavailable',
      });
      throw new CreatorLibraryServiceError(
        e instanceof Error ? e.message : 'Sync queue is unavailable',
        503,
      );
    }
    return { queued: true };
  }

  /**
   * Worker entry. Refreshes the YouTube token, pages uploads, upserts identities.
   * Continuation jobs keep the same runStartedAt so the final page can mark unseen rows.
   */
  async runSyncJob(input: {
    userId: string;
    connectedAccountId: string;
    runStartedAt: string;
    pageToken: string | null;
    uploadsPlaylistId: string | null;
  }): Promise<void> {
    if (!isConnectedAccountProviderEnabled('youtube')) {
      await this.library.setSyncState(input.connectedAccountId, {
        status: 'failed',
        error: 'YouTube library sync is disabled',
      });
      return;
    }
    const accounts = createConnectedAccountService(this.admin);
    const owned = (await accounts.listForUser(input.userId)).find(
      (row) => row.id === input.connectedAccountId,
    );
    if (!owned || owned.provider !== 'youtube') {
      await this.library.setSyncState(input.connectedAccountId, {
        status: 'failed',
        error: 'Connected account not found',
      });
      return;
    }
    let accessToken: string;
    try {
      accessToken = await accounts.ensureFreshAccessToken(input.connectedAccountId);
    } catch (e) {
      const message = e instanceof ConnectedAccountServiceError ? e.message : 'Token refresh failed';
      await this.library.setSyncState(input.connectedAccountId, { status: 'failed', error: message });
      return;
    }

    const contentSources = createContentSourceService(this.admin);
    const outcome = await runBoundedLibrarySync({
      runStartedAt: input.runStartedAt,
      pageToken: input.pageToken,
      uploadsPlaylistId: input.uploadsPlaylistId,
      fetchPage: (page) =>
        fetchYouTubeUploadsPage({
          accessToken,
          uploadsPlaylistId: page.uploadsPlaylistId,
          pageToken: page.pageToken,
        }),
      applyItems: (items, seenAt) =>
        applyLibraryPage({
          contentSources,
          library: this.library,
          userId: input.userId,
          connectedAccountId: input.connectedAccountId,
          items,
          seenAt,
        }).then(() => undefined),
      onComplete: async () => {
        await this.library.markUnseenUnavailable(input.connectedAccountId, input.runStartedAt);
        await this.library.setSyncState(input.connectedAccountId, {
          status: 'idle',
          error: null,
          lastSyncAt: new Date().toISOString(),
        });
      },
      onContinue: async (next) => {
        await enqueueCreatorLibrarySync({
          userId: input.userId,
          connectedAccountId: input.connectedAccountId,
          runStartedAt: input.runStartedAt,
          pageToken: next.pageToken,
          uploadsPlaylistId: next.uploadsPlaylistId,
        });
        logger.info(
          { connectedAccountId: input.connectedAccountId },
          'creator library sync continuation queued',
        );
      },
    });
    if (outcome === 'continued') return;
  }
}

export function createCreatorLibraryService(admin: SupabaseClient): CreatorLibraryService {
  return new CreatorLibraryService(admin, new SupabaseCreatorLibraryRepository(admin));
}
