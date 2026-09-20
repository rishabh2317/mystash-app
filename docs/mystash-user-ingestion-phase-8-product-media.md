# Discover Anywhere — Phase 8: Product Page media

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).  
Phase 7: [`mystash-user-ingestion-phase-7-merchant-offers.md`](./mystash-user-ingestion-phase-7-merchant-offers.md).

Phase 8 makes media first-class on the Product Page. It does not add a second
media store, a recommender, or catalogue promotion.

```
explicit contentSourceId → bound content_source → omit
collection_product_tags + collection_media + other bound content_sources
  → relatedMedia[] (original excluded, identities deduped)
```

---

## 1. Original source

Resolution order:

1. `contentSourceId` from navigation (Bag attribution)
2. First bound `content_source` for this catalogue or share-imported product
3. Omit the section

The explicit source stays identifiable when the same product is bound to more
than one Reel/Short. Invalid URLs are skipped; processing status is never shown.

---

## 2. Related media

Existing relationships only, insertion/primary order, no ranker:

- published `collection_media` on collections tagged to the catalogue id
- `collection_media` whose URL matches another bound content source
- leftover bound content sources (so share-imported products can still show
  other Reels that extracted the same product)

Excluded: the original source (URL identity or content source id), duplicate
YouTube/Instagram identities, unsafe/missing URLs.

---

## 3. What this phase does not do

- Review ingest / review redesign
- Compare
- Search redesign
- Media recommendation/ranking engine
- Automatic catalogue promotion
- Merchant offer changes from Phase 7
