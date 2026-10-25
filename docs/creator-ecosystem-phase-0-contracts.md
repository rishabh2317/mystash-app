# Creator Ecosystem — Phase 0 Architecture Contracts

**Status:** Frozen contracts (Phase 0)  
**Date:** 2026-09-25  
**Authority:** [`creator-ecosystem-architecture-audit.md`](./creator-ecosystem-architecture-audit.md)  
**Code mirror:** `backend/src/creator-ecosystem/contracts.ts`  
**Non-goals:** UI, Create flow, ingest/publish behavior, OAuth, sync, brand tables, campaign runtime

This document freezes identity and attachment boundaries so later phases cannot invent parallel product or content systems.

---

## 0. Normative principles

1. **One content identity** — `content_sources` keyed by `(platform, external_id)`.
2. **One product identity** — `catalog_products` is the only publishable Product SoT.
3. **Attachment ≠ identity** — Collections attach content and products; they do not redefine them.
4. **Provenance ≠ identity** — How a product was found/attached is not a second product table.
5. **Commercial source ≠ identity** — Campaign / affiliate / brand feed are commercial overlays.
6. **One user identity** — Creator capability is `users.creator_status`; no Curator user table.
7. **Account auth ≠ sync ≠ playback** — Separate concerns (Phases 2 / 3 / playback respectively).

**Forbidden tables (do not create):** `creator_media`, `curator_media`, `creator_products`, `curator_products`, `brand_products`.

---

## 1. ContentIdentity

**SoT:** `content_sources`  
**Identity key:** `(platform, external_id)`  
**Type mirror:** `ContentSourceIdentity` in `backend/src/content-source/domain/types.ts`

| Field (conceptual) | Meaning |
|--------------------|---------|
| `platform` | `youtube` \| `instagram` \| `web` (extensible only via deliberate version bump) |
| `external_id` | Platform-stable media / page id |
| `canonical_url` | Normalized URL for the identity |
| `media_kind` | `VIDEO` \| `WEB_PAGE` |

**Applies to both:**

| Behavior | Ingress (today / future) | Same identity? |
|----------|--------------------------|----------------|
| Creator-owned / synced | Future connected-account sync → library (Phase 3) | Yes → `content_sources` |
| Curator / public URL | Paste / share URL → import or Create paste | Yes → `content_sources` |

**Owns:** Global “this content exists / has been processed” identity and processing status.  
**Must not own:** Collection lifecycle, product catalog identity, OAuth tokens, hosted video bytes.

**Phase 0 note:** Create Studio still uses `ingest_requests` today. Convergence is documented in §7; **not** implemented here.

---

## 2. ContentAttachment

**SoT:** `collection_media` (Collection aggregate)  
**Type mirror:** `CollectionMedia` in `backend/src/collection/domain/types.ts`  
**Spec:** `backend/docs/COLLECTION_MEDIA_DOMAIN_SPEC.md`

| Responsibility | Meaning |
|----------------|---------|
| Collection-local reference | Points at external content for **this** Collection |
| Playback / display refs | `canonical_url`, `source_url`, `embed_url`, `thumbnail_url`, … |
| Processing cursors | Per-Collection processing status / job refs |

**Rules**

- `collection_media` is **not** a shared media library.
- Two Collections referencing the same Reel each get their **own** `collection_media` row.
- Shared extract/metadata reuse belongs on `content_sources` (+ cache keyed by provider/external id), not shared `collection_media` rows.
- V1 application assumes **one primary** media per Collection (schema may allow more later).

**Future link (not required in Phase 0):** optional explicit ref from `collection_media` → `content_sources.id` when Create converges.

---

## 3. ProductIdentity

| Concept | Table | Role |
|---------|-------|------|
| **Product SoT (publishable)** | `catalog_products` | Global commerce identity |
| **Staging / discovery** | `discovered_products` | Non-catalog candidates (e.g. user import miss) |
| **URL preview cache** | `canonical_products` | PDP preview by URL only — **not** Catalog |

**Specs:** `backend/docs/CATALOG_DOMAIN_SPEC.md`

**Rules**

- Collection publish surfaces **catalog** products only (`collection_product_tags.catalog_product_id`).
- Do not create `creator_products`, `curator_products`, or `brand_products`.
- Brand / campaign SKUs (Phase 7) **enter `catalog_products`** via the existing catalog / PI pipeline.
- Product identity must remain independent of: creator, platform, collection, campaign, affiliate relationship.

---

## 4. CollectionProductTag (product attachment)

**SoT:** `collection_product_tags`  
**Type mirror:** `CollectionProductTag`  
**Spec:** `backend/docs/COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md`

Answers: *In this Collection, which catalog product is recommended, how strongly, with what creator intent/presentation?*

| Invariant | Detail |
|-----------|--------|
| One content → many products | Multiple tags per Collection; content identity stays separate |
| Unique active catalog per Collection | `(collection_id, catalog_product_id)` for non-deleted rows |
| Attachment ≠ product | Deleting a tag never deletes `catalog_products` |
| Independent attach | Products may come from extract, URL, campaign, etc., without changing product id |

Products hang off the **Collection** (recommendation package). Optional future pin to a specific `collection_media` id does not change ProductIdentity.

---

## 5. ProductProvenance / CommercialSource

### 5.1 Live `selection_source` (writers today)

Runtime field on `collection_product_tags` — **do not change writers in Phase 0**.

| Value | Meaning |
|-------|---------|
| `AI_DETECTED` | Proposed by AI from media/context |
| `AI_RECOMMENDED` | AI suggestion beyond strict detection |
| `CREATOR_MANUAL` | Creator added (URL, search, picker) |
| `CREATOR_ACCEPTED_AI` | Creator accepted an AI proposal |
| `IMPORT` | Imported from external list / migration |
| `SYSTEM` | Ops / policy backfill |

DB CHECK and TypeScript `SelectionSource` remain as above until a later phase adds a first writer for reserved values.

### 5.2 Reserved provenance vocabulary (Phase 0 contract)

Full attachment provenance vocabulary for future Create / brand flows. Reserved values **must not be written** until Phase 4+ (type + additive DB CHECK + writer).

| Value | Status | Meaning |
|-------|--------|---------|
| `AI_DETECTED` | Active | Extract / AI detection |
| `AI_RECOMMENDED` | Active | AI related suggestion |
| `CREATOR_MANUAL` | Active | Manual product add |
| `CREATOR_ACCEPTED_AI` | Active | Creator accepted AI |
| `IMPORT` | Active | Import / migration |
| `SYSTEM` | Active | System / ops |
| `AFFILIATE_URL` | **Reserved** | Attached via affiliate / tracking URL path |
| `CAMPAIGN` | **Reserved** | Attached from a brand campaign offering |
| `BRAND_FEED` | **Reserved** | Attached from brand API / product feed |

Code: `ProductProvenanceSource` in `backend/src/creator-ecosystem/contracts.ts`.

### 5.3 CommercialSource (orthogonal overlay)

Commercial relationship is **not** product identity and is **not** required to equal provenance.

| Value | Meaning |
|-------|---------|
| `NONE` | No special commercial overlay (default today) |
| `AFFILIATE` | Affiliate / partner commercial path |
| `CAMPAIGN` | Brand campaign commercial relationship |
| `BRAND_FEED` | Sourced under a brand feed contract |

Phase 0: type contract only — **no** new columns, tables, or shopping behavior. Future writers may store this on the tag, a side table, or via `ShoppingConfiguration` campaign adapter.

---

## 6. Creator vs Curator

| Concept | Model |
|---------|--------|
| User identity | Single `users` row |
| Creator capability | `users.creator_status`: `NONE \| ONBOARDING \| ACTIVE \| SUSPENDED` |
| `isCreator` | `creatorStatus === 'ACTIVE'` only |
| Curator | **Behavior**, not a user table/role |

| Behavior | Meaning | Content path |
|----------|---------|--------------|
| **Creator** | Owned / synced content into Mystash | Connected account → library → select → Collection |
| **Curator** | Public content curated into a Collection | Public URL → `content_sources` → Collection |

Both ultimately use **`content_sources` + `collection_media`**.  
Legacy `videos.curator_id` / UI “curator credit” are naming only — not a separate identity system.

Do **not** introduce a Curator role/table unless a future capability requirement cannot be expressed as behavior + Collection ownership.

### Create entry modes (Phase 1)

In-app Create entry (ACTIVE creators only) uses `CreateMode` — `my_content` \| `curate_public` \| `products_only` — as IA only. Modes do not change content or product identity. See `src/ui/createMode.ts`.

### Connected Accounts (Phase 2)

`connected_accounts` + encrypted `connected_account_secrets` store Instagram/YouTube linking only (VERIFY-gated feature flags). No media sync. See `docs/creator-ecosystem-phase-2-verify.md`.

---

## 7. Create bridge (direction only)

**Today**

```text
Create Studio:  URL → ingest_requests → extract → Collection → videos
Share Import:   URL → user_imports → content_sources → Bag
```

**Target (later phases)**

```text
Create Studio:  URL or library select
                  → resolve/create content_sources   ← same identity as Share Import
                  → extract / attach products
                  → collection_media + collection_product_tags
                  → publish Collection
```

Phase 0 **documents** this convergence. It does **not** rewrite Create Studio, change ingest workers, or alter publish.

---

## 8. Brand future seam

```text
Brand
 └── Campaign
      └── Products  →  catalog_products   (existing catalog / PI pipeline)
             ↓
      CollectionProductTag  (provenance CAMPAIGN | BRAND_FEED when activated)
```

| Rule | Detail |
|------|--------|
| Brand products enter Catalog | Via feed/API/upload → `catalog_products` |
| Creators attach via tags | Same `collection_product_tags` as extract/manual |
| Buy URL injection | Future `ShoppingConfiguration` Campaign/Brand adapter (already commented in shopping code) |
| No brand product SoT | Do not create `brand_products` |

**Phase 0:** document only. No `brands` / `campaigns` tables.

---

## 9. Target attachment picture

```text
USER (users + creator_status)
 ├── Content Library (future membership of content_sources)
 └── Collection
       ├── ContentAttachment (collection_media) → ContentIdentity (content_sources)
       └── ProductAttachment (collection_product_tags)
              └── ProductIdentity (catalog_products)
                    ├── ProductProvenance (selection_source / reserved)
                    └── CommercialSource (future overlay)
```

---

## 10. Phase 0 validation checklist

| Check | Expected |
|-------|----------|
| Production Create / ingest / publish / Bag / Home | Unchanged |
| New product or content identity tables | None |
| `SelectionSource` writers | Unchanged |
| DB migrations | None in Phase 0 (reserved provenance not writable yet) |
| Contract types | Present and tested in `backend/src/creator-ecosystem/` |

---

## 11. Related documents

| Doc | Role |
|-----|------|
| `docs/creator-ecosystem-architecture-audit.md` | Full audit + phased plan |
| `backend/docs/COLLECTION_DOMAIN_SPEC.md` | Collection aggregate |
| `backend/docs/COLLECTION_MEDIA_DOMAIN_SPEC.md` | ContentAttachment rules |
| `backend/docs/COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md` | Tag + live `selection_source` |
| `backend/docs/CATALOG_DOMAIN_SPEC.md` | ProductIdentity |
| `docs/mystash-user-ingestion-phase-2-content-source.md` | ContentIdentity (share path) |

*End of Phase 0 contracts.*
