import type { PageCapabilities, PageType, SourceType } from '../domain/types';

const NONE: PageCapabilities = {
  metadata: false,
  commerce: false,
  specifications: false,
  images: false,
  evidence: false,
};
const EVIDENCE_ONLY: PageCapabilities = {
  metadata: false,
  commerce: false,
  specifications: false,
  images: false,
  evidence: true,
};

function capabilities(
  metadata: boolean,
  commerce: boolean,
  specifications: boolean,
  images: boolean,
  evidence: boolean,
): PageCapabilities {
  return { metadata, commerce, specifications, images, evidence };
}

export const PAGE_CAPABILITY_REGISTRY: Partial<
  Record<SourceType, Partial<Record<PageType, PageCapabilities>>>
> = {
  OFFICIAL: {
    PRODUCT: capabilities(true, true, true, true, true),
    SPECIFICATIONS: capabilities(true, false, true, true, true),
    NEWS: capabilities(true, false, false, true, true),
    EDITORIAL: capabilities(true, false, false, true, true),
    BUYING_GUIDE: EVIDENCE_ONLY,
    CAMPAIGN: capabilities(true, false, false, true, true),
    SUPPORT: capabilities(true, false, true, false, true),
    MANUAL: capabilities(true, false, true, false, true),
    DOWNLOAD: NONE,
    FAQ: capabilities(true, false, false, false, true),
    HOMEPAGE: NONE,
  },
  MARKETPLACE: {
    PRODUCT: capabilities(true, true, true, true, true),
    SEARCH: NONE,
    SEARCH_RESULTS: NONE,
    CATEGORY: NONE,
    BUYING_GUIDE: EVIDENCE_ONLY,
    HOMEPAGE: NONE,
  },
  RETAILER: {
    PRODUCT: capabilities(true, true, true, true, true),
    SEARCH: NONE,
    SEARCH_RESULTS: NONE,
    CATEGORY: NONE,
    BUYING_GUIDE: EVIDENCE_ONLY,
    HOMEPAGE: NONE,
  },
  SPECIFICATION: {
    PRODUCT: capabilities(true, false, true, true, true),
    SPECIFICATIONS: capabilities(true, false, true, true, true),
    COMPARISON: capabilities(true, false, true, false, true),
    BUYING_GUIDE: EVIDENCE_ONLY,
  },
  REVIEW: {
    REVIEW: capabilities(true, false, true, true, true),
    COMPARISON: capabilities(true, false, true, false, true),
    BUYING_GUIDE: EVIDENCE_ONLY,
  },
  NEWS: {
    NEWS: capabilities(true, false, false, true, true),
    BUYING_GUIDE: EVIDENCE_ONLY,
  },
  EDITORIAL: {
    EDITORIAL: capabilities(true, false, false, true, true),
    BUYING_GUIDE: EVIDENCE_ONLY,
  },
  FORUM: {
    FORUM_THREAD: capabilities(false, false, false, false, true),
  },
  SOCIAL: {
    PROFILE: capabilities(false, false, false, false, true),
    VIDEO: capabilities(true, false, false, false, true),
  },
  VIDEO: {
    VIDEO: capabilities(true, false, false, false, true),
  },
  WIKI: {
    EDITORIAL: capabilities(true, false, true, false, true),
    BUYING_GUIDE: EVIDENCE_ONLY,
  },
  UNKNOWN: {
    BUYING_GUIDE: EVIDENCE_ONLY,
  },
};

export function capabilitiesFor(
  sourceType: SourceType,
  pageType: PageType,
): PageCapabilities {
  return { ...(PAGE_CAPABILITY_REGISTRY[sourceType]?.[pageType] ?? NONE) };
}
