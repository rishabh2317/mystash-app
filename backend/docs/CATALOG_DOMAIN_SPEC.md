# Mystash Catalog Domain Specification

**Status:** Canonical domain specification (no SQL, no Prisma, no APIs, no code, no migrations)  
**Audience:** Platform architecture for Catalog, Product Intelligence, Shopping / Commerce, Collection, CollectionProductTag, Search, Feed, Recommendations, Analytics (5–10 year horizon)  
**Principle:** Catalog is the **global product source of truth**. It already exists in Mystash as `catalog_products` (+ aliases, match history, local search). This spec **evolves that implementation into a bounded context** — it does **not** redesign or replace tables.  
**Baseline:** [`CATALOG_DOMAIN_AUDIT.md`](./CATALOG_DOMAIN_AUDIT.md)  
**Peers:** [`COLLECTION_DOMAIN_SPEC.md`](./COLLECTION_DOMAIN_SPEC.md), [`COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md`](./COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md), [`USER_DOMAIN_SPEC.md`](./USER_DOMAIN_SPEC.md)

---

## 0. Definition

A **CatalogProduct** is the durable, shared identity of a real-world (or merchant-listed) product on Mystash. Many Collections may recommend the same product; each recommendation is a **CollectionProductTag**. Catalog answers identity and durable truth — not creator intent, not live commerce, not ranking.

```text
CatalogProduct (aggregate root)
  ├── Identity (UUID, canonical_slug, brand/name/model, normalized_name)
  ├── Aliases (*)
  ├── Lifecycle status (ACTIVE | HIDDEN | DISCONTINUED | MERGED)
  ├── Verification (VERIFIED | UNVERIFIED | UNRESOLVED + provenance)
  ├── Canonical metadata (description, category, specs bag, canonical media)
  ├── Catalog quality signals (future metadata; conceptual)
  └── Merge pointer (merged_into_id when MERGED)
```

**Catalog exists to answer:**

> “What *is* this product globally — its stable id, names, brand/model, durable metadata, verification state, and (if merged) where did it go?”

**Analogues (inspiration, not clones)**

| Platform pattern | Mystash analogue |
|------------------|------------------|
| Amazon ASIN / parent ASIN | Catalog UUID + merge target |
| Google Merchant Center product identity | Canonical slug + brand/model |
| Shopify Product (not Variant/Offer) | CatalogProduct vs Shopping offer |
| Spotify Track (not playlist membership) | CatalogProduct vs CollectionProductTag |

### What it is not

| Not this | Why | Owning context |
|----------|-----|----------------|
| **CollectionProductTag** | Recommendation membership / intent / presentation | **Collection** |
| **Merchant offer / inventory / live price** | Volatile commerce | **Shopping / Commerce** (+ Merchant Resolution) |
| **Discovery search candidate** | Ingest-time candidate URL | **Product Intelligence** (cache may live in `catalog_search_candidates`) |
| **Page preview cache** | URL-keyed scrape/AI cache (`canonical_products`) | **Ingest / productLinkPreview** — **not** Catalog |
| **SearchDocument / FeedCard / Recs embedding** | Query/serving projections | **Search / Feed / Recommendations** |
| **Click / purchase event** | Append-only facts | **Analytics** (+ Shopping redirect writes) |
| **Creator profile / Collection lifecycle** | Social / recommendation package | **User / Collection** |

### Evolution stance (normative)

| Preserve | Evolve (architecture only) |
|----------|----------------------------|
| Tables `catalog_products`, `catalog_aliases`, `product_match_history` | Introduce **CatalogService** as the sole write/read application boundary for Catalog aggregates |
| Local catalog search algorithm & thresholds | Other domains depend on CatalogService — not PI repository internals |
| `ProductResolver` as PI orchestrator | Resolver **calls** CatalogService (conceptually); does not become Catalog |
| Verification model & identity fields | Formalize lifecycle, merge, domain events, consumer contracts |
| Public ACTIVE read model | Clarify Shopping-owned fields co-located on the row (transitional) |
| CollectionProductTag → Catalog FK | Complete merge remapping contract (already required by Tag spec) |

**Do not:** invent a parallel product table, rename `catalog_products`, greenfield a new identity scheme, or move Collection/Shopping logic into Catalog.

### Specification phases

| Layer | Role |
|-------|------|
| **Canonical Domain Model** | This document — ownership, aggregates, events, contracts |
| **V1 (today + near-term)** | Existing tables & resolver path; CatalogService as boundary (may initially wrap current repos); merge may still be stubbed until implemented; primary image only |
| **Future** | Full merge ops, richer alias provenance, quality metadata, additive variants/families/media (§9 Future Extensibility), optional physical split of offer columns |

---

## 1. Aggregate ownership

### 1.1 Catalog owns

| Responsibility | Meaning |
|----------------|---------|
| **Global product identity** | Stable `id` (UUID), `canonical_slug`, brand / name / model / `normalized_name` / category |
| **Aliases** | Alternate name strings that resolve to this product |
| **Lifecycle** | `ACTIVE` \| `HIDDEN` \| `DISCONTINUED` \| `MERGED` |
| **Verification** | `VERIFIED` \| `UNVERIFIED` \| `UNRESOLVED` + provider / source / version / confidences / `last_verified_at` |
| **Canonical metadata** | Durable description, category, specs, enrichment bag, and **canonical media** (§1.5) that describe *the product*, not a transient offer |
| **Catalog quality** | Conceptual completeness / confidence metadata for consumers (§1.6) — future; not required for V1 behaviour |
| **Merge graph** | `merged_into_id` and historical id continuity after merge |
| **Match audit (Catalog-adjacent)** | `product_match_history` records draft↔product decisions for audit (written via Catalog/PI resolve finish; not a second product aggregate) |
| **Domain events** | ProductCreated, ProductVerified, ProductMerged, … |

### 1.2 Catalog does NOT own

| Must not own | Owning context |
|--------------|----------------|
| Creator recommendation intent / notes / strength | **CollectionProductTag** |
| Collection title, caption, publish state | **Collection** |
| Creator / User account state | **User** |
| Merchant inventory, stock, SKU catalogs | **Merchant / Commerce** |
| Live offer selection, affiliate minting, redirect 302, `product_clicks` | **Shopping / Commerce** |
| Discovery provider queries & candidate ranking | **Product Intelligence** |
| Search inverted index / query serving | **Search** |
| Feed ranking / card assembly | **Feed** |
| Recommendation models / embeddings | **Recommendations** |
| Engagement / purchase event streams as SoT | **Analytics** |
| Affiliate earnings / network credentials | **Commerce** |

### 1.3 Aggregate root

```text
CatalogProduct (root)
  └── CatalogAlias (*)   — owned child; no independent aggregate
```

- **Only CatalogService** (Catalog bounded context) may create, update identity/metadata, add aliases, change lifecycle, set verification on the Catalog aggregate, or execute merges.  
- Product Intelligence **proposes** identity and verification outcomes and **invokes** CatalogService.  
- Publish, Collection, Shopping, Search, Feed, Recs, Analytics **must not** write Catalog tables directly (except transitional Shopping denorm writes via an explicit Catalog port — §2.3).

### 1.4 Boundary map

```text
┌─────────────────────────────────────────────────────────────┐
│                     CATALOG DOMAIN                           │
│  identity · aliases · lifecycle · verification · metadata  │
│  merge · CatalogService · Catalog events                     │
└───────▲───────────────▲──────────────────▲──────────────────┘
        │ resolve/upsert│ read / redirect  │ FK / rematch
        │               │                  │
┌───────┴───────┐ ┌─────┴──────┐ ┌─────────┴──────────┐
│   PRODUCT     │ │  SHOPPING  │ │ COLLECTION / TAGS  │
│ INTELLIGENCE  │ │ / COMMERCE │ │ (references only)  │
└───────▲───────┘ └────────────┘ └────────────────────┘
        │
   Ingest / Merchant enrichment (inputs, not SoT)
```

### 1.5 Canonical media

Catalog owns **canonical media** for a CatalogProduct — durable product media that is part of product truth, not Collection presentation and not a separate media platform service.

Examples (architecture only; not a schema):

| Media kind | Role |
|------------|------|
| **Primary image** | Default hero / card image |
| **Additional images** | Gallery / alternate angles |
| **Manuals** | Spec sheets, PDFs, guides |
| **Rich media** | Other durable product assets (e.g. official video stills) when admitted as Catalog truth |

**V1:** Continues using a **single primary image** (today’s `image_url` / equivalent). That is sufficient and unchanged.

**Future:** Additional media assets remain **Catalog metadata** under the same CatalogProduct aggregate. No Media BC, CDN, or delivery architecture is defined here. Collection snapshots may copy a display image for offline/Feed latency; Catalog remains SoT for canonical product media.

### 1.6 Catalog quality

**Catalog Quality** is a conceptual layer of Catalog metadata representing the overall **confidence and completeness** of a CatalogProduct.

Contributing signals may eventually include (non-exhaustive, no formulas):

- Identity confidence  
- Verification confidence  
- Metadata completeness  
- Brand confidence  

**Purpose:** Give Search, Recommendations, Feed filters, and AI systems a stable product-quality signal without each consumer re-deriving ad hoc scores from raw fields.

**V1:** Does not require a dedicated quality field or scoring pipeline. Existing verification status and confidence numerics already contribute informally.

**Rules:** No scoring algorithms or weights in this spec. Quality remains **Catalog-owned metadata** when introduced; consumers read it — they do not redefine product identity.

---

## 2. Responsibilities (cross-domain)

### 2.1 Ownership matrix

| Concern | Catalog | Product Intelligence | Shopping | Merchant Resolution | CollectionProductTag | Publish | Search | Analytics |
|---------|---------|----------------------|----------|---------------------|----------------------|---------|--------|-----------|
| Product UUID / slug | **SoT** | calls CatalogService | read | — | FK only | must not invent parallel ids | join/read | dimension |
| Aliases / local match | **SoT** | uses LocalCatalogSearch via Catalog | — | — | — | — | optional | — |
| Verification status | **SoT** | decides & requests update | may read | informs | mirrors hint on tag | gate on resolved id | may filter | dimension |
| Durable name/brand/specs/image | **SoT** | enrichment input | — | extraction | snapshots for offline | denorm legacy video_products | via snapshots/joins | — |
| Discovery Serper/CSE | — | **owns** | — | — | — | — | — | — |
| PDP enrich / page cache | — | orchestrates | — | **extract** | — | — | — | — |
| Preferred shopping URL / affiliate / live price | denorm host (transitional) | may pass through | **logic SoT** | candidate URLs | never live price | — | — | — |
| Redirect + clicks | read by id | — | **owns** | — | attribution = **tag id** | — | — | consumes clicks |
| Tag membership / intent | — | proposes candidates | — | — | **SoT** (Collection) | enforces resolved tags | compile from snapshots | — |
| Collection publish state | — | — | — | — | child of Collection | **Collection / Publish** | — | — |
| Search index | — | — | — | — | search source on Collection | — | **owns index** | — |
| Ranking models | — | — | — | — | features | — | — | **Recs / Analytics** |

### 2.2 Product Intelligence

**Owns:** normalize → specificity → local catalog hit policy → external discovery → enrichment admission → merge-of-enrichment-fields → verification *decision* → request Catalog upsert; draft resolution fields; search-candidate cache; match-history write coordination.

**Does not own:** Catalog aggregate persistence semantics long-term (delegates to CatalogService); Collection tags; shopping redirects.

**`ProductResolver`:** Remains the **resolve orchestrator**. It is part of Product Intelligence. After this spec, its Catalog mutations are conceptually **CatalogService** write capabilities (create/update from resolve, alias add, verification update), even if the first packaging still lives under `product-intelligence/catalog/`.

### 2.3 Shopping / Commerce

**Owns:** Destination selection at resolve and click time; affiliate gate; `GET /products/:id/redirect`; `product_clicks`; live price/stock semantics.

**Transitional denorm:** Columns such as `preferred_shopping_url`, `shopping_provider`, `affiliate_url`, `price`, `currency` may remain on `catalog_products` for zero-disruption reads. **Semantic ownership** of those fields is Shopping. CatalogService exposes a **shopping-projection write capability** so Shopping does not raw-SQL Catalog rows. Catalog must not invent shopping ranking rules.

**Verification merchant URL** (`merchant_url` used as the PDP that verified the product) is **Catalog verification provenance**, not a live offer. Shopping must not overwrite verification provenance when selecting a preferred checkout URL.

### 2.4 Merchant Resolution

**Owns:** Mapping evidence → merchant/PDP identity; enrichment extractors.  
**Does not write** Catalog directly; results flow through PI → CatalogService.

### 2.5 CollectionProductTag

**Owns:** Membership, intent, strength, note, presentation, snapshots, Collection-local resolution mirrors.  
**References** `catalog_product_id`. On Catalog merge, Collection Service remaps FKs per §6. Publish requires non-null catalog id for included tags ([Tag spec](./COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md)).

### 2.6 Publish

**Owns:** Collection (and legacy video) publish gates and published projections (`video_products` denorm).  
**Must not** become a second Catalog identity authority. Placeholder catalog creation at publish is a **compatibility escape hatch** only: it must go through CatalogService’s **unresolved-placeholder** write capability, use `verification_status = UNRESOLVED`, and remain eligible for later PI resolve / merge. Prefer resolving via PI before publish whenever possible.

### 2.7 Search

**Owns:** Indexes and query serving. Consumes Collection search-source fields (often from tag snapshots) and may join Catalog for enrichment filters. Never writes Catalog or Tags.

### 2.8 Analytics

**Owns:** Event SoT and aggregates. Uses `catalog_product_id` (and after merge, **survivor id** + historical ids) as dimensions. Does not write Catalog.

### 2.9 Discovery cache vs Catalog

| Store | Role |
|-------|------|
| `catalog_products` | Catalog SoT |
| `catalog_aliases` | Catalog owned |
| `product_match_history` | Resolve audit (Catalog-adjacent) |
| `catalog_search_candidates` | **PI discovery cache** — not product SoT (name retained for compatibility) |
| `catalog_search_debug` | Optional PI debug; not Catalog aggregate |
| `canonical_products` | **Page preview cache** — not Catalog; do not conflate with Catalog identity |

---

## 3. CatalogService boundary & Catalog Lookup Port

**Status:** Architectural boundary. **No implementation in this document.** Method names are intentionally **not** frozen.

Other domains **must** depend on **CatalogService**, not on Product Intelligence repository classes, SQL tables, or `ProductResolver` internals.

### 3.1 Catalog Lookup Port (read capabilities)

Catalog exposes a **Lookup Port** — the stable read contract for identity and discovery-against-catalog. Capabilities (implementation-agnostic):

| Capability | Intent |
|------------|--------|
| **Identity lookup** | Load a product by durable id or `canonical_slug` |
| **Alias resolution** | Resolve alternate name strings to CatalogProduct(s) |
| **Active product resolution** | Follow merge tombstones (`merged_into_id`) to the survivor / terminal product |
| **Structured identity find** | Locate by normalized name, brand+model, or verification merchant URL (existing match keys) |
| **Local search** | Existing LocalCatalogSearch behaviour (URL → exact → alias → brand/model → fuzzy), behind the Catalog boundary |
| **Public reads** | Serve the public ACTIVE read model |

Callers (Shopping redirect, PI resolve, Feed joins via backend, ops tools) use these capabilities without coupling to repository method shapes.

### 3.2 Write capabilities (conceptual)

CatalogService is also the sole **write** authority. Capabilities (not a method list):

| Capability | Intent | Typical caller |
|------------|--------|----------------|
| **Create / update from resolve** | Persist identity + aliases from PI; in-place update when id known (no duplicate create) | Product Intelligence |
| **Alias maintenance** | Add aliases under uniqueness rules | PI / ops |
| **Verification updates** | Apply verification transitions decided by PI | Product Intelligence |
| **Lifecycle moderation** | Hide, unhide, discontinue, restore | Ops / trust |
| **Merge** | Duplicate consolidation (§6) | Ops / PI duplicate detection |
| **Unresolved placeholder ensure** | Publish escape hatch only | Publish via CatalogService |
| **Shopping projection apply** | Transitional denorm write for Shopping-owned fields | Shopping |

### 3.3 Forbidden

- Direct table writes from Collection, Feed, Search, Analytics, app clients (writes remain service-role / backend).  
- Using deprecated `products/catalogMatcher` / `NoopCatalogMatcher`.  
- Treating Serper/CSE hits as Catalog truth without resolve admission.

### 3.4 Packaging note

V1 may keep code under `product-intelligence/catalog/` **as an implementation location**. Canonically it is the **Catalog** BC. Future packaging may move to `backend/src/catalog/` without schema redesign.

---

## 4. Product lifecycle

Two orthogonal axes exist on the CatalogProduct aggregate. Do not collapse them.

### 4.1 Product status (`status`) — Catalog-owned lifecycle

| Status | Meaning | Public read? | Match reuse? |
|--------|---------|--------------|--------------|
| **ACTIVE** | Normal live product | Yes (RLS) | Yes |
| **HIDDEN** | Moderated / suppressed from public surfaces; retained | No | Prefer no (policy) |
| **DISCONTINUED** | Product no longer sold / supported; may still be referenced historically | Policy (default: no public browse; deep links may resolve) | Optional, lower preference |
| **MERGED** | Duplicate absorbed into another product | No | No — follow `merged_into_id` |

**Ownership:** Only CatalogService changes `status`.

### 4.2 Verification status (`verification_status`) — Catalog-owned quality

| Status | Meaning | Typical origin |
|--------|---------|----------------|
| **UNRESOLVED** | Identity stub / insufficient evidence; publish placeholders; failed search | Placeholder ensure; weak resolve |
| **UNVERIFIED** | Catalog row exists with metadata but no qualifying commerce/verification offer | Specificity gate; metadata-only path |
| **VERIFIED** | Passed verification policy (commerce-capable / authority PDP evidence per PI rules) | Successful enrich + verify |

**Ownership:** Catalog stores the status; **Product Intelligence** decides transitions and requests CatalogService updates. Collection tags may **mirror** a hint for publish UX; Catalog remains SoT.

### 4.3 Orthogonality

Examples:

- `ACTIVE` + `UNRESOLVED` — published placeholder awaiting background resolve.  
- `ACTIVE` + `VERIFIED` — normal commerce-ready product.  
- `HIDDEN` + `VERIFIED` — true product, suppressed from discovery.  
- `MERGED` + prior verification — verification of survivor is authoritative; source is tombstone.

### 4.4 Transitions (normative intent)

```text
create → ACTIVE + (UNRESOLVED | UNVERIFIED | VERIFIED)
UNRESOLVED → UNVERIFIED | VERIFIED   (resolve / enrich)
UNVERIFIED → VERIFIED                (verification succeeds)
VERIFIED → UNVERIFIED                (rare: evidence revoked — policy)
ACTIVE ↔ HIDDEN                      (moderation)
ACTIVE → DISCONTINUED                (end of life)
* → MERGED                           (only via merge; terminal for source)
MERGED → *                           (forbidden; unmerge is ops-exceptional, out of V1)
```

Exact automation thresholds remain PI/config implementation details.

---

## 5. Identity

Preserve the existing model. Formalize roles.

| Identifier | Role | Stability |
|------------|------|-----------|
| **`id` (UUID)** | Primary key; FK target for Tags, drafts, video_products, clicks | Immutable for the row’s lifetime |
| **`canonical_slug`** | Human/stable public product key (unique); collision → suffix `-2`, `-3`, … | Durable; may change only under explicit ops policy (prefer never after publish) |
| **`normalized_name`** | Match key for exact local search | Updated carefully with identity corrections |
| **Aliases** | Alternate strings → product | Additive; migrated on merge |
| **`merchant_url` (verification PDP)** | Strong local-match signal + verification provenance | Not a second primary key; URLs can change; matching uses current value |
| **Brand + model** | Structured identity when present | Soft keys; compatibility-checked in local search |
| **Historical ids** | Source UUIDs after merge | Retained as `MERGED` rows with `merged_into_id`; never recycled |

### 5.1 Matching (preserved behaviour)

Local catalog search order (existing):

1. Merchant URL exact  
2. Normalized name + brand/model/category compatibility  
3. Alias + compatibility  
4. Brand + model  
5. Fuzzy Dice over ACTIVE pool (prefer VERIFIED)

Resolver auto-reuse requires score ≥ configured hit threshold **and** `VERIFIED` (current behaviour). Thresholds are config, not domain redesign.

### 5.2 Duplicate prevention without merge

- Prefer local hit reuse.  
- If draft already has `catalog_product_id`, **update in place** — do not create a sibling.  
- Slug suffixing creates a **new** product only when create is intentional; it is not a merge.

### 5.3 What identity is not

- Ingest draft ids, tag ids, video_product ids are **not** Catalog identity.  
- `canonical_products.canonical_url` is a **page cache key**, not Catalog identity.

---

## 6. Merge model

Complete the architecture of the currently stubbed `ProductMergeService`. **Do not implement here.**

### 6.1 Purpose

Consolidate duplicate CatalogProducts so Tags, analytics, shopping redirects, and aliases converge on one **survivor** without creator action ([Tag spec §14.6](./COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md): auto-remap).

### 6.2 Rules

| Rule | Normative decision |
|------|--------------------|
| Direction | `merge(sourceId → targetId)`; **target** is survivor |
| Preconditions | Both exist; neither already `MERGED` (or source may be unmerged only via exceptional ops); target not `MERGED`; source ≠ target |
| Source after merge | `status = MERGED`, `merged_into_id = targetId` |
| Target after merge | Remains `ACTIVE` (or prior non-merged lifecycle); identity fields win by **survivorship policy** (below) |
| Idempotency | Re-merge of already-merged source → target is no-op / resolve to survivor |
| Chains | Active-product resolution follows `merged_into_id` until non-`MERGED` |
| No cycles | Reject merges that would cycle |

### 6.3 Survivorship (field policy)

Architectural defaults (implementation may refine scoring):

| Field class | Policy |
|-------------|--------|
| UUID / slug of survivor | **Keep target** |
| Source slug | Retained on tombstone; optional alias of target if unique and useful |
| Brand / name / model | Prefer VERIFIED + higher verification confidence; else target |
| Canonical metadata / image | Prefer richer / verified target; fill nulls from source |
| Verification | Prefer higher quality (`VERIFIED` > `UNVERIFIED` > `UNRESOLVED`); keep provenance of winning side |
| Shopping projection columns | Prefer target; fill nulls from source (Shopping may re-resolve later) |
| `metadata` jsonb | Deep-merge with explicit trust rules (PI field-trust may inform) |

### 6.4 Alias migration

- Move (or copy) source aliases onto target; skip duplicates of `(target, alias)`.  
- Add source `normalized_name`, `name`, and former `canonical_slug` as aliases on target when they do not collide.  
- Source alias rows may remain pointing at source for audit or be re-pointed — **canonical lookup must resolve via survivor** (Lookup Port identity / local search ignore `MERGED` or follow pointer).

### 6.5 Redirect behaviour

- Identity lookup / public deep links / `GET /products/:sourceId/redirect` **must resolve to survivor** (HTTP redirect or transparent resolve — implementation choice).  
- Shopping clicks recorded after merge use **survivor** `catalog_product_id` while optionally retaining `merged_from_id` in analytics payload (Analytics detail).

### 6.6 CollectionProductTag remapping

- Catalog emits `ProductMerged`.  
- **Collection Service** (only writer of Tags) remaps `catalog_product_id` from source → target.  
- If a Collection already has a Tag for target **and** a Tag for source, apply **collision policy**: keep the stronger/earlier Tag; soft-delete or archive the duplicate Tag; preserve `recommendation_strength` / note by policy (prefer PRIMARY / earlier `accepted_at`).  
- Emit Collection `ProductTagRematched` (or dedicated merge-remap event) — no silent FK change without event.  
- Recompile Collection search-source fields after remap.

### 6.7 Historical IDs & analytics continuity

- Source UUID **never deleted** in normal merge (tombstone row).  
- `product_match_history`, `product_clicks`, drafts, `video_products` may keep historical FKs; readers use **active-product resolution** for aggregation.  
- Analytics rollups **should** attribute to survivor for forward metrics; retain ability to query by historical id.  
- Affiliate / earnings ledgers (when present) key continuity to survivor + historical id map.

### 6.8 Who may merge

| Actor | Allowed |
|-------|---------|
| CatalogService merge capability | Yes (sole executor) |
| PI duplicate detection | May **request** merge |
| Ops / trust tools | May request merge |
| Collection / Publish / app clients | **No** |

---

## 7. Domain events

Catalog emits domain events (conceptual). Consumers subscribe asynchronously. **No implementation here.** Structured PI logs (`catalog.hit`, etc.) may continue as operational telemetry; they are **not** a substitute for these contracts long-term.

| Event | When | Key payload |
|-------|------|-------------|
| **ProductCreated** | New CatalogProduct | `catalogProductId`, slug, verificationStatus, source |
| **ProductVerified** | Transition to `VERIFIED` | `catalogProductId`, provider, version, confidence |
| **ProductUnverified** | Downgrade from VERIFIED / set UNVERIFIED | `catalogProductId`, reason |
| **CatalogUpdated** | Identity or canonical metadata change | `catalogProductId`, changedFields[] |
| **AliasAdded** | New alias | `catalogProductId`, alias |
| **LifecycleChanged** | `status` transition (hide/discontinue/restore/…) | `catalogProductId`, from, to |
| **ProductMerged** | Merge committed | `sourceId`, `targetId`, survivorId |
| **ShoppingProjectionUpdated** | Optional; when denorm shopping fields change | `catalogProductId` (Shopping may own emission) |

### Consumer expectations

| Consumer | Reacts to |
|----------|-----------|
| Collection / Tags | `ProductMerged` → remap; optional `CatalogUpdated` → snapshot refresh policy |
| Shopping | `ProductMerged` → resolve survivor on redirect; projection refresh |
| Search / Feed / Recs | Identity/lifecycle/merge → reindex or invalidate |
| Analytics | Merge map; dimensions |
| PI | May listen for merge to avoid re-creating sources |

---

## 8. Consumer contracts

### 8.1 CollectionProductTag

| Contract | Rule |
|----------|------|
| Reference | Nullable `catalog_product_id` while drafting; **required** for tags included in publish |
| Uniqueness | At most one Tag per `(collection_id, catalog_product_id)` when catalog id set |
| SoT | Catalog for global identity; Tag for intent/presentation/snapshots |
| Writes | Tags never write Catalog |
| Merge | Auto-remap via Collection Service on `ProductMerged` |
| Rematch (PI) | Allowed post-publish only with confidence threshold + Tag event — not a Catalog merge |

### 8.2 Shopping

| Contract | Rule |
|----------|------|
| Read | Load Catalog by id (follow merge) |
| Destination | Affiliate → preferred → merchant (existing ShoppingResolver order) |
| Writes | Shopping projections via CatalogService write capability; clicks to `product_clicks` |
| Attribution | Commerce attribution key remains **`collection_product_tag_id`** when from a Collection; Catalog id is a dimension |

### 8.3 Search

| Contract | Rule |
|----------|------|
| Primary text | Collection search-source fields (tag snapshots + caption/intent) |
| Catalog role | Optional join for brand/category/verification filters; not the index SoT |
| Updates | On Tag changes and on Catalog merge/identity events as needed |

### 8.4 Feed

| Contract | Rule |
|----------|------|
| Cards | May join `catalog_products` for ACTIVE verified display |
| Must not | Rank inside Catalog; write Catalog; treat `MERGED` as browsable |

### 8.5 Recommendations

| Contract | Rule |
|----------|------|
| Features | May use `catalog_product_id`, brand/category, co-occurrence across Collections |
| Must not | Store models inside Catalog; write Catalog |

### 8.6 Analytics

| Contract | Rule |
|----------|------|
| Dimensions | `catalog_product_id`, survivor id after merge, historical ids |
| Events | Clicks/purchases owned by Analytics/Shopping ledgers — not Catalog |
| Continuity | Merge map required for correct rollups |

### 8.7 Public read model

Preserve: clients may `SELECT` rows with `status = ACTIVE` (RLS). Writes remain backend/service-role. Public readers should treat Catalog as display SoT for product fields when joined; creator intent remains on Collection/Tag.

### 8.8 Legacy `video_products`

Denormalized name/price/image at publish are a **projection**. Catalog remains SoT; background resolve may refresh projections. New Collection path should prefer Tag + Catalog join over inventing a second product SoT.

---

## 9. Future Extensibility

**CatalogProduct remains the permanent aggregate root for product identity.**

Future capabilities must **extend** CatalogProduct — they must **never** replace it or force a redesign of Catalog identity (UUID, `canonical_slug`, aliases, verification, lifecycle, merge).

No schema, tables, or implementation details in this section. Architecture reservation only.

### 9.1 Additive capabilities (reserved)

| Future capability | Relationship to CatalogProduct |
|-------------------|--------------------------------|
| **ProductVariant** | Child of a CatalogProduct (or of a family grouping — see §9.3); does not become a second global identity root |
| **ProductFamily** | Groups related CatalogProducts; each member keeps independent identity |
| **ProductBundle** | Composition of CatalogProducts (and later variants) for sellable/set groupings |
| **Accessory relationships** | Directed links between CatalogProducts (e.g. compatible accessory) |

**Normative:** CatalogProduct is the **global identity root**. These capabilities are additive and must never require redesigning Catalog identity.

### 9.2 Product variants (reserved — not V1)

Future variants such as **storage**, **color**, **RAM**, **size**, and **regional editions** will eventually become **child entities of CatalogProduct** (architecture only).

| Phase | Behaviour |
|-------|-----------|
| **V1 (current)** | Continues treating each resolved product as an **independent CatalogProduct** |
| **Future** | ProductVariant support **extends — does not replace** — the Catalog aggregate |

Do **not** implement variants in V1. Do **not** introduce variant tables in this specification.

### 9.3 Product families (reserved — not designed)

**Product families are different from variants.**

| Concept | Meaning |
|---------|---------|
| **Variant** | Option dimensions of *one* product identity line (e.g. color/storage of the same model) |
| **Family** | A **group of related CatalogProducts** that remain independently addressable |

Examples of family-scale grouping (illustrative only): AirPods, Galaxy S Series, MacBook Pro.

Future **ProductFamily** capabilities should group related CatalogProducts while **preserving independent product identities**. This specification **reserves** the concept only — it does **not** design ProductFamily.

### 9.4 Reverse Collection relationship (read model — not Catalog-owned)

“**Collections featuring this product**” is a future **read model**, not a Catalog-owned relationship.

| Rule | Meaning |
|------|---------|
| Catalog | Remains the **identity** source |
| Collection / CollectionProductTag | Remains the **recommendation** source |
| Read model | May expose Collections featuring a product by **querying CollectionProductTags** (and related Collection projections) |

Catalog **does not own** Collection relationships, membership lists, or recommendation graphs. Building this read model must not add Collection FKs as Catalog aggregate children.

### 9.5 Canonical media & quality (forward links)

- Richer **canonical media** (§1.5) remains under CatalogProduct.  
- **Catalog Quality** (§1.6) remains Catalog metadata for Search / Recs / AI consumers.  

Neither requires a new identity root.

---

## 10. Open questions

### 10.1 Resolved (architectural)

| # | Question | Decision |
|---|----------|----------|
| 1 | Redesign vs evolve? | **Evolve** existing Catalog; no greenfield tables |
| 2 | Who is product SoT? | **`catalog_products` via Catalog BC** |
| 3 | Who writes Catalog? | **CatalogService only**; PI and Publish call it |
| 4 | Is ProductResolver Catalog? | **No** — PI orchestrator that uses Catalog |
| 5 | Do Tags own product truth? | **No** — FK + snapshots only |
| 6 | Merge behaviour for Tags? | **Auto-remap** by Collection Service ([Tag spec](./COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md)) |
| 7 | Are shopping columns Catalog SoT? | **No** — transitional denorm; Shopping owns semantics |
| 8 | Is `canonical_products` Catalog? | **No** — page preview cache |
| 9 | Is discovery candidate cache Catalog SoT? | **No** — PI cache (`catalog_search_candidates`) |
| 10 | Public read? | **Preserve** ACTIVE-only SELECT |
| 11 | Placeholder at publish? | Allowed only via CatalogService as `UNRESOLVED` |
| 12 | Verification vs lifecycle? | **Orthogonal** axes |
| 13 | Variants / families in V1? | **No** — reserved under §9; CatalogProduct stays the identity root |
| 14 | “Collections featuring product”? | **Future read model** over Tags (§9.4); Catalog does not own Collection edges |

### 10.2 Left open (implementation / later product)

| # | Topic | Notes |
|---|-------|-------|
| A | Physical split of offer columns into offers table | Optional future; not required to adopt CatalogService |
| B | Alias provenance (source, confidence, retirement) | Additive; V1 strings sufficient |
| C | Automatic duplicate detection → merge proposals | Policy/thresholds; human-in-loop vs auto |
| D | Unmerge / undo merge | Out of V1 |
| E | DISCONTINUED public deep-link behaviour | Product policy |
| F | Packaging move to `src/catalog/` | Mechanical; no schema change |
| G | Price history / offer time series | Commerce; not Catalog identity |
| H | Exact HTTP shape for merge redirects | 302 vs transparent resolve |
| I | When / how to introduce ProductVariant or ProductFamily | Product decision; must remain additive per §9 |

---

## 11. Explicit non-goals

Catalog **must never** own:

| Non-goal | Owner |
|----------|-------|
| Collection state / publish / caption / intent | **Collection** |
| Creator / User state | **User** |
| CollectionProductTag membership or creator notes | **Collection** |
| Collection↔product membership graphs as Catalog children | **Collection** (Tags); reverse views are read models (§9.4) |
| Merchant inventory / stock / warehouse SKUs | **Merchant / Commerce** |
| Search ranking or inverted index | **Search** |
| Recommendation ranking or embeddings | **Recommendations** |
| Feed ranking or card SoT | **Feed** |
| Shopping clicks (`product_clicks`) as Catalog aggregate | **Shopping / Analytics** |
| Affiliate earnings / network settlements | **Commerce** |
| Raw AI prompts, traces, token bills | **Ingest observability** |
| Discovery provider billing / quotas | **Product Intelligence** |
| Auth sessions | **Auth / User** |

---

## 12. Mystash principles (applied)

1. **Evolve, don’t reinvent** — tables and resolver behaviour are the baseline.  
2. **One product SoT** — Catalog; Tags recommend; Shopping sells.  
3. **Clear write authority** — CatalogService.  
4. **PI finds; Catalog remembers; Shopping routes; Collection recommends.**  
5. **Merge preserves history** — tombstones + remaps + analytics continuity.  
6. **Events over silent mutation** — especially merge and identity changes visible to Tags.  
7. **Public read of ACTIVE products** — writes stay server-side.  
8. **Minimize disruption** — transitional denorm and code location are allowed; boundaries are not optional long-term.  
9. **Extend, don’t replace** — variants, families, bundles, and media deepen CatalogProduct; they do not fork identity (§9).

---

## 13. Existing Mystash mapping (informational)

| Spec concept | Current artifact |
|--------------|------------------|
| CatalogProduct | `catalog_products` |
| CatalogAlias | `catalog_aliases` |
| Match audit | `product_match_history` |
| Local search | `LocalCatalogSearch` |
| Resolve orchestrator | `ProductResolver` |
| Persistence (today) | `SupabaseCatalogRepository` |
| Merge (stub) | `ProductMergeService` / `UnimplementedProductMergeService` |
| Public read | RLS `catalog_products_public_read` |
| Tag FK | `collection_product_tags.catalog_product_id` |
| Shopping redirect | `GET /products/:id/redirect` |
| Page cache (not Catalog) | `canonical_products` |
| Deprecated | `products/catalogMatcher.ts` |

---

## 14. Success criteria for “canonical Catalog”

This domain is considered successfully formalized when:

1. All Catalog writes go through CatalogService (even if thin wrappers).  
2. PI, Publish, and Shopping do not bypass Catalog boundaries.  
3. Lifecycle and verification axes are used consistently.  
4. Merge has a defined contract ready for implementation (this §6).  
5. CollectionProductTag, Shopping, Search, Feed, Recs, Analytics have explicit consume rules (this §8).  
6. No greenfield product table replaces `catalog_products`.  
7. Future variants/families/media/quality remain additive to CatalogProduct (§9).

---

*End of Catalog Domain Specification.*
