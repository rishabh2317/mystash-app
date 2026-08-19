export type PublishVideoResolution = {
  videoId: string;
  shouldInsertVideo: boolean;
};

/** Resolve the Home Feed video row for a publish dual-write. Reuses existing video id on re-publish. */
export function resolvePublishVideoId(params: {
  existingVideoId: string | null | undefined;
  newVideoId: string;
}): PublishVideoResolution {
  const existing = params.existingVideoId?.trim() || null;
  if (existing) {
    return { videoId: existing, shouldInsertVideo: false };
  }
  return { videoId: params.newVideoId, shouldInsertVideo: true };
}

/** Publish pipeline invariant: Video.id and Collection.id are independent. */
export function assertIndependentVideoAndCollectionIds(
  videoId: string,
  collectionId: string,
): void {
  if (videoId === collectionId) {
    throw new Error('Publish invariant violated: video id must not equal collection id');
  }
}

export type VideoProductInsertDraft = {
  name: string;
  price: string;
  image: string;
  merchant_url: string | null;
  affiliate_url: string | null;
  provider: string;
  sort_order: number;
  catalog_product_id: string;
  resolution_status: string;
};

export type VideoProductInsertRow = VideoProductInsertDraft & { video_id: string };

/** Attach resolved Video.id to every video_products row before insert. */
export function buildVideoProductInserts(
  videoId: string,
  drafts: VideoProductInsertDraft[],
): VideoProductInsertRow[] {
  return drafts.map((draft) => ({
    ...draft,
    video_id: videoId,
  }));
}
