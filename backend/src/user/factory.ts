import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCollectionRepository } from '../collection/SupabaseCollectionRepository';
import type { CollectionDiscoveryPort } from './ports';
import { sumCreatorPublicReelLikes } from '../engagement/reelEligibility';
import { createNotificationService } from '../notifications/factory';
import { creatorStatusEvent, getNotificationEmitter } from '../notifications/producers';
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
    {
      purgeUser: async (userId) => {
        await createNotificationService(admin).purgeUser(userId);
      },
      creatorStatusChanged: async (input) => {
        await getNotificationEmitter().emitSafely(creatorStatusEvent(input));
      },
    },
  );
}

export { UserService, UserServiceError } from './UserService';
export type { UserRepository } from './UserRepository';
export type {
  UserCreatorPort,
  CollectionDiscoveryPort,
  UserNotificationPort,
  ReelLikeSummaryPort,
} from './ports';
