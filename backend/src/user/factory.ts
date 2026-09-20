import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCollectionRepository } from '../collection/SupabaseCollectionRepository';
import type { CollectionDiscoveryPort } from './ports';
import { sumCreatorPublicReelLikes } from '../engagement/reelEligibility';
import { SupabaseUserRepository } from './SupabaseUserRepository';
import { UserService } from './UserService';

export function createCollectionDiscoveryPort(admin: SupabaseClient): CollectionDiscoveryPort {
  const repo = new SupabaseCollectionRepository(admin);
  return {
    hideCreatorCollectionsFromDiscovery: (creatorId) =>
      repo.hideCreatorFromDiscovery(creatorId),
    restoreCreatorCollectionsDiscovery: (creatorId) =>
      repo.restoreCreatorDiscovery(creatorId),
    sumPublishedCollectionSaves: (creatorId) =>
      repo.sumPublishedCollectionSaves(creatorId),
    countPublishedPublicCollections: (creatorId) =>
      repo.countPublishedPublicCollections(creatorId),
  };
}

export function createUserService(admin: SupabaseClient): UserService {
  return new UserService(
    new SupabaseUserRepository(admin),
    createCollectionDiscoveryPort(admin),
    {
      sumPublicReelLikesReceived: (creatorId) =>
        sumCreatorPublicReelLikes(admin, creatorId),
    },
  );
}

export { UserService, UserServiceError } from './UserService';
export type { UserRepository } from './UserRepository';
export type {
  UserCreatorPort,
  CollectionDiscoveryPort,
  ReelLikeSummaryPort,
} from './ports';
