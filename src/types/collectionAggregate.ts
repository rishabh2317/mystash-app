/** FE DTO mirrors for GET /collections/:id aggregate (backend domain JSON). */

export type CollectionAggregateTagDto = {
  id: string;
  collectionId: string;
  catalogProductId: string | null;
  sortOrder: number;
  tagStatus: string;
  visibility: string;
  includeInPublish: boolean;
  deletedAt: string | null;
  nameSnapshot: string | null;
  imageSnapshot: string | null;
  brandSnapshot: string | null;
  categorySnapshot: string | null;
  resolutionStatus: string | null;
  merchantUrl: string | null;
};

export type CollectionAggregateMediaDto = {
  id: string;
  isPrimary: boolean;
  sourceUrl: string | null;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  sourceProvider: string | null;
};

export type CollectionAggregateDto = {
  collection: {
    id: string;
    slug: string;
    title: string | null;
    caption: string | null;
    creatorId: string;
    creatorName: string | null;
    creatorUsername: string | null;
    creatorAvatar: string | null;
    heroThumbnailUrl: string | null;
    qualityScore: number | null;
    publishedAt: string | null;
    originPlatform: string | null;
    viewsCount: number;
    savesCount: number;
    sharesCount?: number;
  };
  media: CollectionAggregateMediaDto[];
  tags: CollectionAggregateTagDto[];
};
