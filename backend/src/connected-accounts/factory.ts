import type { SupabaseClient } from '@supabase/supabase-js';
import { getNotificationEmitter } from '../notifications/producers';
import { ConnectedAccountService } from './ConnectedAccountService';
import { SupabaseConnectedAccountRepository } from './SupabaseConnectedAccountRepository';
import { InMemoryConnectedAccountRepository } from './InMemoryConnectedAccountRepository';
import type { ConnectedAccountRepository } from './ConnectedAccountRepository';
import type { ConnectedAccountProvider } from './domain/types';
import type { ConnectedAccountOAuthProvider } from './providers/types';
import { YouTubeOAuthProvider } from './providers/YouTubeOAuthProvider';
import { InstagramOAuthProvider } from './providers/InstagramOAuthProvider';

export function createDefaultProviders(): Map<
  ConnectedAccountProvider,
  ConnectedAccountOAuthProvider
> {
  return new Map<ConnectedAccountProvider, ConnectedAccountOAuthProvider>([
    ['youtube', new YouTubeOAuthProvider()],
    ['instagram', new InstagramOAuthProvider()],
  ]);
}

export function createConnectedAccountService(
  admin: SupabaseClient,
  providers = createDefaultProviders(),
): ConnectedAccountService {
  return new ConnectedAccountService(
    new SupabaseConnectedAccountRepository(admin),
    providers,
    getNotificationEmitter(),
  );
}

export function createInMemoryConnectedAccountService(
  repo: ConnectedAccountRepository = new InMemoryConnectedAccountRepository(),
  providers = createDefaultProviders(),
): ConnectedAccountService {
  return new ConnectedAccountService(repo, providers);
}

export { ConnectedAccountService, ConnectedAccountServiceError } from './ConnectedAccountService';
export type { ConnectedAccountPublic } from './domain/types';
