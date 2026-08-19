import type { CreatorSnapshot } from '../collection/domain/types';

/** Collection → User: gate create/publish and source creator snapshot. */
export type UserCreatorPort = {
  assertCanCreateCollections(userId: string): Promise<void>;
  getCreatorSnapshot(userId: string): Promise<CreatorSnapshot | null>;
};

/** User → Collection: hide/restore discovery on account delete/restore. */
export type CollectionDiscoveryPort = {
  hideCreatorCollectionsFromDiscovery(creatorId: string): Promise<void>;
  restoreCreatorCollectionsDiscovery(creatorId: string): Promise<void>;
};
