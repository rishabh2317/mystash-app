/**
 * Peer denorm ports — Collection/User own the denorm fields; Engagement writes via contract.
 */
export type EligibleReel = {
  reelId: string;
  collectionId: string;
  creatorId: string;
};

export type ReelEligibilityPort = {
  getEligiblePublicReel(reelId: string): Promise<EligibleReel | null>;
};

export type CollectionCounterDenormPort = {
  applyCollectionCounters(
    collectionId: string,
    counters: {
      viewsCount?: number;
      savesCount?: number;
      sharesCount?: number;
      productClicksCount?: number;
      purchasesCount?: number;
    },
  ): Promise<void>;
};

export type UserCounterDenormPort = {
  applyUserCounters(
    userId: string,
    counters: {
      followersCount?: number;
      followingCount?: number;
    },
  ): Promise<void>;
};

export const noopCollectionCounterDenorm: CollectionCounterDenormPort = {
  async applyCollectionCounters() {},
};

export const noopUserCounterDenorm: UserCounterDenormPort = {
  async applyUserCounters() {},
};

export const denyAllReelEligibility: ReelEligibilityPort = {
  async getEligiblePublicReel() {
    return null;
  },
};
