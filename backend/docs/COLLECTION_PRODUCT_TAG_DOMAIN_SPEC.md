# Mystash CollectionProductTag Domain Specification

**Status:** Canonical domain specification (no SQL, no Prisma, no APIs, no code, no migrations)  
**Audience:** Platform architecture for Collections, Catalog, Product Intelligence, Commerce, Search, Feed, Recommendations, Analytics (5–10 year horizon)  
**Principle:** A **CollectionProductTag** is one creator-selected product appearance inside one Collection. It is a **relationship + intent + presentation** object — not a global product.  
**Depends on (frozen):** [`COLLECTION_DOMAIN_SPEC.md`](./COLLECTION_DOMAIN_SPEC.md), [`COLLECTION_MEDIA_DOMAIN_SPEC.md`](./COLLECTION_MEDIA_DOMAIN_SPEC.md), [`USER_DOMAIN_SPEC.md`](./USER_DOMAIN_SPEC.md)  
**Peers (consume / reference, do not own this aggregate):** Product Intelligence, Catalog, Merchant Resolution, Shopping / Commerce, Search, Feed, Recommendations, Analytics  

---

## 0. Definition

```text
Collection (recommendation package — aggregate root)
      │
      ├── CollectionMedia (external evidence reference)
      │
      └── CollectionProductTag (*)  ──references──► CatalogProduct (required before publish)
                │
                ├── Creator intent & selection state
                ├── creator_note (Collection-local product opinion)
                ├── recommendation_strength (PRIMARY | SECONDARY | …)
                ├── Presentation (order, visibility)
                ├── Display snapshots (latency / offline)
                └── Eligibility hints for shopping / discovery
```

**CollectionProductTag exists to answer:**

> “In *this* Collection, which product is being recommended, how strongly, with what creator note, in what order, with what creator intent, and with what Collection-local presentation?”

**Analogues (inspiration, not clones):**

| Platform pattern | Mystash analogue |
|------------------|------------------|
| Pinterest product pin on a board | Tag on a Collection |
| Amazon Influencer / LTK / ShopMy product slot | Ordered tagged product with affiliate path |
| Instagram / TikTok Shop product sticker | Collection-local commerce attachment |
| Spotify playlist track | Ordered membership; track ≠ playlist |

**Scale assumptions**

- Hundreds of millions of ProductTags  
- Millions of Collections  
- Same Catalog product may appear in millions of Collections → **each appearance is a distinct Tag**  
- **Within one Collection:** at most one Tag per `catalog_product_id` (unique)  
- Thousands of concurrent creators editing; low-latency Feed/Search must not join full Catalog/Commerce on every hot path  

### What it is not

| Not this | Why |
|----------|-----|
| **CatalogProduct** | Global product identity & durable metadata |
| **MerchantProduct / Offer** | Merchant-specific SKU, price, stock, buy URL |
| **ShoppingDestination / Affiliate click** | Runtime commerce resolution & click ledger |
| **Product Intelligence candidate** | Pipeline proposal before/while becoming a Tag |
| **SearchDocument / FeedCard / Recs embedding** | Consumer projections |
| **Analytics event** | Append-only engagement / commerce facts |
| **Collection caption / intent** | Collection-level recommendation package text |

### Aggregate ownership (normative)

```text
Collection
  owns
    CollectionProductTag
```

- **Only the Collection bounded context** (Collection Service / Collection Repository) may **create, update, reorder, accept, reject, remove, or soft-delete** CollectionProductTag rows.  
- Product Intelligence, Catalog, Merchant Resolver, Shopping, Search, Feed, Recs, Analytics **must not** write this table directly.  
- Other BCs may **propose** candidates, **resolve** Catalog ids, or **emit** events that Collection **applies** via explicit contracts.

---

## 1. Responsibilities

### 1.1 What CollectionProductTag owns

| Responsibility | Meaning |
|----------------|---------|
| **Membership** | This product appearance belongs to exactly one Collection |
| **Stable identity** | Tag UUID independent of Catalog id |
| **Ordering & strength** | `sort_order`, `recommendation_strength` (replaces binary-only primary thinking) |
| **Creator note** | Per-product opinion / guidance text (`creator_note`) — not Collection caption |
| **Creator intent** | How the product entered, was accepted/rejected/removed (`selection_source` enum, confidence, evidence refs, reason) |
| **Lifecycle within Collection** | Proposed → accepted → included in publish → archived/removed — orthogonal to Catalog lifecycle |
| **Lifecycle timestamps** | `accepted_at`, `first_published_at`, plus reject/archive/delete stamps |
| **Display snapshots** | Lightweight denorm for Feed/cards/search compile without live Catalog |
| **Correlation** | Links to ingest draft / PI candidate / evidence artifact **by reference**, not payloads |
| **Collection-local commerce hints** | Eligibility / verification mirrors for publish gates — **never** live price |
| **Domain events** | ProductTagProposed, ProductTagAccepted, … |

### 1.2 What peer domains own (no duplication)

| Domain | Owns | Relationship to Tag |
|--------|------|---------------------|
| **Collection** (root) | Recommendation package, publish gate (≥1 resolved included Tag), search-source compile, primary denorm, product_tag_count | Parent aggregate; only writer of Tags |
| **Catalog** | Canonical product identity, brand/model/specs, durable images, category graph | Tag holds `catalog_product_id` (required before publish); Catalog is SoT for global truth |
| **Product Intelligence** | Discovery, matching, verification, candidates | Proposes; Collection admits. Rematch after publish only via confidence threshold + event |
| **Merchant Resolver** | Merchant identity / PDP mapping | Informs Shopping; does not write Tags |
| **Shopping / Commerce** | Destination at **click time**, affiliate minting, redirects, click logs, **live price/stock** | Attribution key = **`collection_product_tag_id`** |
| **Search / Feed / Recs / Analytics** | Indexes, cards, models, events | Consumers only |

### 1.3 Boundary map

```text
┌──────────────────────────────────────────────────────────┐
│                 COLLECTION AGGREGATE                      │
│  Collection ──owns── CollectionMedia                      │
│              ──owns── CollectionProductTag (*)              │
└───────────┬───────────────────────────┬──────────────────┘
            │ catalog_product_id        │ events / denorm
            ▼                           ▼
     ┌─────────────┐            Search / Feed / Recs / Analytics
     │   CATALOG   │
     └──────▲──────┘
            │ resolves / verifies
     ┌──────┴──────┐
     │  PRODUCT    │──proposes candidates──► Collection (admits Tags)
     │ INTELLIGENCE│
     └──────▲──────┘
            │
     Merchant Resolver
            │
            ▼
     Shopping / Commerce ──attribution──► collection_product_tag_id
```

---

## 2. Identity & core fields

Design fields for the **CollectionProductTag** entity. Persistence naming may use snake_case; domain names below are normative.

### 2.1 Identity & foreign keys

| Field | Purpose | Datatype | Nullable | Owner | Notes |
|-------|---------|----------|----------|-------|-------|
| `id` | Stable PK | UUID | no | Collection | Immutable |
| `collection_id` | Parent Collection | UUID FK | no | Collection | Immutable |
| `catalog_product_id` | Global product link | UUID FK → Catalog | yes while draft; **required to publish** | Collection Service only | Unique with `collection_id` (§14.1) |
| `created_at` / `updated_at` | Audit | timestamp | no | Collection | |

**Cross-Collection:** Many Tags → same `catalog_product_id` is required for scale.  
**Within Collection:** **Unique `(collection_id, catalog_product_id)`** where `catalog_product_id` is not null — no duplicate products on one Collection.

### 2.2 Ordering, recommendation strength, visibility

| Field | Purpose | Datatype | Nullable | Notes |
|-------|---------|----------|----------|-------|
| `sort_order` | Display order in product rail | int | no | Collection Service owns reorder |
| `recommendation_strength` | How strongly this product is recommended in *this* Collection | enum (§2.3) | no | **Reserved field**; V1 uses `PRIMARY` \| `SECONDARY` |
| `visibility` | Tag-level show/hide without deleting | enum: `visible` \| `hidden` | no | Hidden excluded from public surface |
| `include_in_publish` | Creator deselection at review | bool | no | **Deselect ≠ reject** (§14.11) |

**No separate `is_pinned`.** Primacy / pin merged into `recommendation_strength` (+ `sort_order`).  
**Derived convenience (not SoT):** `is_primary ≡ (recommendation_strength == PRIMARY)`. At most one `PRIMARY` Tag per Collection (enforced by Collection Service).

Parent Collection denorm (maintained when Tags change):

- `primary_product_tag_id` → Tag with `recommendation_strength = PRIMARY`  
- `product_tag_count` → count of **visible + included-in-publish** Tags only (§14.9)  
- `primary_product_name_snapshot`  

### 2.3 `recommendation_strength` (frozen enum; extensible by versioned add)

| Value | Phase | Meaning |
|-------|-------|---------|
| `PRIMARY` | **V1** | Best / hero product for this Collection (card anchor) |
| `SECONDARY` | **V1** | Included recommendation; not the hero |
| `BEST_OVERALL` | Future | Explicit “best overall” slot |
| `RUNNER_UP` | Future | Second choice |
| `BUDGET_PICK` | Future | Value / budget pick |
| `ALTERNATIVE` | Future | Alternative option |
| `AVOID` | Future | Explicit negative recommendation |

V1 writers may only set `PRIMARY` | `SECONDARY`. Future values are reserved so Search/Feed/Recs/AI can rely on a stable field without retrofit.

### 2.4 Creator note (Tag-owned, not Collection)

| Field | Purpose | Datatype | Nullable | Notes |
|-------|---------|----------|----------|-------|
| `creator_note` | Creator’s product-specific guidance | short plain text or markdown | **yes** | Owned by **ProductTag**, never Collection caption |

Examples: “I've personally used this for 6 months.” / “Best value under ₹10k.” / “Don't buy the older version.”

- Length-capped (implementation detail; keep short).  
- Public on Collection page / product dock when Tag is visible+included.  
- Valuable for commerce trust; Search may optionally index later — **not** a substitute for Catalog description.

### 2.5 Lifecycle & review (tag-local)

| `tag_status` | Meaning |
|--------------|---------|
| `proposed` | Detected / suggested; not yet creator-accepted |
| `accepted` | Creator accepted for this Collection |
| `rejected` | Creator or policy rejected; retained; **creator-visible only** (§14.13) |
| `published` | Included on a published Collection surface |
| `archived` | Soft-retired from active surface |
| `deleted` | Soft-deleted; hidden from all product surfaces |

```text
PI / manual / import
        │
        ▼
    proposed ──accept──► accepted ──Collection publish──► published
        │                   │                              │
        └──reject──► rejected   └──deselect (include=false)│
                                └──remove──► archived|deleted
```

| Field | Purpose | Immutable once set? |
|-------|---------|---------------------|
| `tag_status` | Lifecycle above | no |
| `review_status` | `unreviewed` \| `approved` \| `needs_review` \| `blocked` | no |
| `accepted_at` | When creator accepted (or manual add as accepted) | **yes** (first accept only) |
| `first_published_at` | First time this Tag was included in a Collection publish | **yes** |
| `rejected_at` / `archived_at` / `deleted_at` | Lifecycle stamps | set on transition |
| `published_revision` | Collection `content_revision` at last include | no |

**Publish gate (normative):** A Collection **must not** publish with zero Tags. Every Tag included in publish **must** have a non-null `catalog_product_id` (resolved). Shopping becomes dramatically simpler.

---

## 3. Creator intent (critical)

Separate **detection**, **selection**, **rejection**, and **provenance**. Do not collapse into a single boolean.

### 3.1 Selection & provenance fields

| Field | Purpose | Notes |
|-------|---------|-------|
| `selection_source` | How this Tag entered / was chosen | **Frozen enum** (§3.2) |
| `detection_source` | What system first detected the product | e.g. vision, transcript, description_url, manual_url — operational, not `selection_source` |
| `creator_action` | Last explicit creator action | `none` \| `accepted` \| `rejected` \| `removed` \| `reordered` \| `edited` \| `added_manual` \| `note_edited` |
| `include_in_publish` | Creator publish deselection | Distinct from `rejected` |
| `confidence` | Match / detection confidence | Set by PI; used for rematch threshold |
| `evidence_refs` | Pointers to artifacts | **Keep refs; delete payloads** (§14.12) |
| `reason` | Short human/system reason | Accept/reject/recommend why |
| `recommended_by` | Who recommended | `ai` \| `creator` \| `system` |
| `matched_query` / `matched_url` | Debug match inputs | Not public Feed |
| `ingest_draft_id` / `pi_candidate_id` | Upstream correlation | Nullable |

### 3.2 `selection_source` — **frozen enum**

Do **not** treat as open vocabulary. New values require a deliberate domain version bump.

| Value | Meaning |
|-------|---------|
| `AI_DETECTED` | Proposed by AI from media/context |
| `AI_RECOMMENDED` | AI suggestion beyond strict detection (related / upsell) |
| `CREATOR_MANUAL` | Creator added (URL, search, picker) |
| `CREATOR_ACCEPTED_AI` | Creator accepted an AI proposal |
| `IMPORT` | Imported from external list / migration |
| `SYSTEM` | Ops / policy backfill |

**Legacy map:** early `tag_source` `ai` → `AI_DETECTED` (or `CREATOR_ACCEPTED_AI` after accept); `manual` → `CREATOR_MANUAL`; `import` → `IMPORT`.

### 3.3 Intent invariants

1. AI may **propose**; creator (or policy) **accepts**.  
2. Rejected Tags remain for audit / PI feedback; **visible only to creator** (and Admin).  
3. Removing a Tag must not delete CatalogProduct.  
4. Reordering / strength change does not change Catalog identity.  
5. Post-publish rematch requires **confidence threshold + `ProductTagRematched` event** — never silent (§14.7).  
6. Catalog product merges **auto-remap** Tag FKs; creator should not care (§14.6).

---

## 4. Display snapshot vs live Catalog

### 4.1 Snapshot on the Tag (owned by Collection)

| Snapshot field | Typical source at write |
|----------------|-------------------------|
| `name_snapshot` | Catalog title or PI/draft name |
| `image_snapshot` | Catalog primary image URL or draft image |
| `brand_snapshot` | Catalog brand or draft brand |
| `category_snapshot` | Catalog category leaf/path label |
| `snapshot_updated_at` | When snapshots last refreshed |

### 4.2 Snapshot refresh policy (**resolved**)

Update snapshots **only** on:

1. **Accept**  
2. **Publish** (included Tags)  
3. **Explicit refresh** (creator/ops/Collection Service)

**Do not** auto-refresh on every Catalog change event.

### 4.3 Always live from Catalog (when linked)

Canonical id, specs, variants, canonical title corrections, full image set, category graph — Catalog SoT.

### 4.4 Never duplicate on the Tag

| Never store as SoT on Tag | Owner |
|---------------------------|--------|
| **Price / currency / stock** | **Commerce — always live. No `price_snapshot`. Ever.** |
| Full product description / HTML | Catalog |
| Affiliate credentials | Commerce |
| Embeddings / vectors | Recs / Search |
| OCR / frame bitmaps | Media Processing (payloads deleted; refs kept) |
| Merchant PDP HTML | Merchant / fetch cache |
| Creator profile fields | User |
| Collection title / caption / intent | Collection |
| `creator_note` | **Exception:** this *is* Tag-owned creator text, not Catalog |

---

## 5. Commerce & shopping (relationship only)

### 5.1 Hints on Tag (not live offers)

| Concern | Tag role |
|---------|----------|
| Affiliate / shopping eligibility mirrors | Optional publish-gate hints |
| `resolution_status` | `UNRESOLVED` \| `UNVERIFIED` \| `VERIFIED` — must be resolved (non-null catalog + policy) before publish |
| Merchant availability / OOS / broken links | **Live at click time**; Tag membership unchanged |
| Merchant replacement | Resolve at click time; keep same `catalog_product_id` unless rematch |

### 5.2 Attribution key (**resolved**)

**Always** attribute commerce using **`collection_product_tag_id`**.

Also carry `collection_id`, `catalog_product_id` (when known), `creator_id` as dimensions — but the **stable click/attribution identity is the Tag id**.

### 5.3 Merchant override (**resolved**)

**No per-Tag preferred merchant override in V1.** Destination is resolved **at click time** by Shopping / Merchant Resolver.

### 5.4 Out-of-stock / broken-link behaviour

Tag remains; CTA degrades; Analytics still attributes to Tag id; merchant replacement does not require deleting the Tag.

---

## 6. Search signals (consume only — do not implement Search)

### 6.1 Compile inputs (via Collection `search_*`)

| Input | How used |
|-------|----------|
| Snapshots + Catalog title/brand/category | Keywords / facets |
| `recommendation_strength` (esp. `PRIMARY`) | Bias title / ranking features |
| `creator_note` | Optional future lexical signal (policy); not required V1 |
| `catalog_product_id` | Exact-product features |
| `resolution_status` | Verified boosts |

### 6.2 Never searchable from Tag

Evidence refs, match debug strings, raw merchant URLs, affiliate params, rejected Tag content (public index), confidence-as-text.

### 6.3 Consumption

Collection recompiles `search_*` on Tag membership/accept/rematch/strength/note changes → events → Search async. Search never writes Tags.

**Dual-write:** Remove `video_products` dual-write once Search is migrated to Collection/Tag SoT (§14.14–15).

---

## 7. Feed signals (consume only — do not implement Feed)

| Field | Feed use |
|-------|----------|
| `PRIMARY` Tag snapshots + `creator_note` (teaser) | Product dock |
| `product_tag_count` | “N products” |
| `recommendation_strength` | Badge / ordering hints |
| Live price | Commerce edge join only |

---

## 8. Recommendation signals (consume only — do not implement Recs)

| Signal | Use |
|--------|-----|
| `catalog_product_id` set | Co-occurrence |
| Brands / categories | Features |
| `recommendation_strength` | Weighting (PRIMARY vs SECONDARY vs future slots) |
| `accepted_at` / `first_published_at` | Freshness |
| `selection_source` / accept rates | Trust features |
| `creator_note` presence / length | Soft quality signal |

No embeddings on the Tag row.

---

## 9. Analytics (ownership — do not implement)

Events keyed by **`collection_product_tag_id`** (+ Collection, Catalog, Creator).  
Optional Tag denorm counters via async contract.  
`accepted_at` / `first_published_at` support freshness, creator history, and debugging **without event replay**.

---

## 10. Domain events

| Event | When |
|-------|------|
| `ProductTagProposed` | Proposed |
| `ProductTagAccepted` | Accept; sets `accepted_at` if first |
| `ProductTagRejected` | Reject |
| `ProductTagAddedManual` | Manual add |
| `ProductTagNoteUpdated` | `creator_note` changed |
| `ProductTagStrengthChanged` | `recommendation_strength` changed |
| `ProductTagUpdated` | Snapshot/other fields |
| `ProductTagRematched` | `catalog_product_id` changed (threshold + explicit) |
| `ProductTagReordered` | `sort_order` changed |
| `ProductTagVisibilityChanged` | visibility / include_in_publish |
| `ProductTagRemoved` | Archive/delete from surface |
| `ProductTagPublished` | First/later include; sets `first_published_at` if first |
| `ProductTagUnpublished` | Dropped from published surface |
| `ProductTagCommerceHintUpdated` | Eligibility denorm |

**Payload minimum:** `collectionProductTagId`, `collectionId`, `catalogProductId?`, `occurredAt`, relevant `from`/`to`.

---

## 11. Lifecycle summary (coupled to Collection)

| Collection status | Tag behaviour |
|-------------------|---------------|
| Draft / review | Propose/accept; set strength, note, include_in_publish; resolve Catalog before publish |
| Publish | ≥1 included+resolved Tag required; Tags → `published`; set `first_published_at` once |
| Unpublish / archive | Tags retained; discovery gated by Collection |
| Soft-delete Collection | Tags hidden/retained per Collection policy; **no Catalog delete** |

---

## 12. Write model (conceptual)

**Only Collection Service** mutates Tags.

| Operation | Effect |
|-----------|--------|
| Propose from PI/ingest | `proposed` + `AI_DETECTED` / `AI_RECOMMENDED` + evidence refs |
| Accept / reject | Status; `accepted_at` on first accept; `CREATOR_ACCEPTED_AI` when accepting AI |
| Add manual | `accepted` + `CREATOR_MANUAL` + `accepted_at` |
| Update `creator_note` | Patch + `ProductTagNoteUpdated` |
| Set `recommendation_strength` | Enforce single `PRIMARY` |
| Rematch Catalog | Confidence threshold + event; refresh snapshots |
| Reorder / visibility / include_in_publish | Surface membership |
| Publish inclusion | Require resolved Catalog; set `first_published_at` once |
| Catalog merge remap | Auto FK update via Collection Service contract |
| Apply counter / commerce hint contracts | Denorm only |

**Forbidden writers:** PI (except via Collection contract), Catalog, Shopping, Search, frontend SQL.  
**Collaborators:** not V1 — only owning creator (§14.17).

---

## 13. Indexing (recommendations for future scale)

| Index | Purpose |
|-------|---------|
| `(collection_id, sort_order)` | Product rail |
| `(collection_id)` where `recommendation_strength = PRIMARY` | Primary lookup |
| **Unique `(collection_id, catalog_product_id)` where catalog not null** | No duplicates |
| `(catalog_product_id)` where not null | Reverse lookup |
| `(collection_id, tag_status)` | Review queues |
| `(collection_id, include_in_publish, visibility)` | Publish surface / counts |
| `(selection_source, created_at)` | Ops / PI analytics (optional) |
| `(first_published_at)` | Freshness queries (optional) |

---

## 14. Architectural decisions (resolved)

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Unique `(collection_id, catalog_product_id)` | **YES.** No duplicate products on one Collection. |
| 2 | Must resolve Catalog before publish | **YES.** Shopping simplifies; unresolved Tags cannot be included in publish. |
| 3 | Pinned vs primary | **Merged.** Use `recommendation_strength` (+ sort). No `is_pinned`. |
| 4 | Snapshot refresh | **Only** on accept, publish, explicit refresh — not automatic Catalog churn. |
| 5 | Price snapshot | **NO. Never.** Always live Commerce. |
| 6 | Catalog merge | **Auto-remap** Tag FKs. Creator should not care. |
| 7 | PI rematch after publish | **Allowed only** with confidence threshold + `ProductTagRematched` event. No silent change. |
| 8 | Commerce attribution | **Always `collection_product_tag_id`.** |
| 9 | `product_tag_count` | Count **visible + included-in-publish** Tags only. |
| 10 | Publish with zero Tags | **Absolutely not.** |
| 11 | Deselect vs reject | **Deselect ≠ reject.** `include_in_publish=false` keeps accepted Tag off publish surface; `rejected` is a distinct lifecycle. |
| 12 | Evidence retention | **Keep references; delete payloads.** |
| 13 | Rejected Tags visibility | **Creator (and Admin) only** — not public Feed/Search. |
| 14 | Dual-write `video_products` | **Remove once Search is migrated** to Collection/Tag SoT. |
| 15 | Backfill | **Tag is SoT**; legacy tables become projections during transition. |
| 16 | Merchant override | **Resolve at click time.** No V1 per-Tag merchant override. |
| 17 | Collaborators | **Not V1.** Owning creator only. |

---

## 15. Explicit non-goals

CollectionProductTag must **never** own:

- Global product identity / merge authority → **Catalog**  
- Live price/stock/affiliate minting SoT → **Commerce**  
- PI matching engine → **Product Intelligence**  
- Merchant resolution engine → **Merchant Resolver**  
- Search indexes / Feed materialization / Recs embeddings → those BCs  
- Event streams as SoT → **Analytics / Commerce**  
- Media payloads (keep refs only)  
- Collection title/caption/intent (Collection core) — **except** per-product `creator_note` on the Tag  
- Collaborator ACL (future CollectionCollaborator)  
- Direct writes from non-Collection services  

---

## 16. V1 vs future (phases)

| Layer | Role |
|-------|------|
| **Canonical model** | This document |
| **V1** | Membership; unique catalog per Collection; resolve-before-publish; `selection_source` enum; `recommendation_strength` PRIMARY\|SECONDARY; `creator_note`; `accepted_at` / `first_published_at`; snapshots on accept/publish/explicit refresh; Tag-id commerce attribution; creator-only rejected visibility; no price snapshot; no collaborators; no pin field |
| **Future** | Richer strength values (BEST_OVERALL, RUNNER_UP, …); per-Tag counters; drop video_products dual-write; optional Search indexing of `creator_note` |

---

## 17. Mystash principles (applied)

1. **Collection owns Tags** — sole write SoT.  
2. **Tag ≠ Product** — Catalog is global SoT.  
3. **Intent is first-class** — frozen `selection_source`; detection ≠ acceptance ≠ publish inclusion.  
4. **Per-product creator voice** — `creator_note` on Tag, not Collection.  
5. **Strength is ordinal, not only binary** — field reserved; V1 PRIMARY/SECONDARY.  
6. **Snapshot at latency edge; price always live.**  
7. **Attribution sticks to Tag id.**  
8. **Async consumers** — Search/Feed/Recs/Analytics.  
9. **Same Catalog product, many Tags across Collections; one Tag per product within a Collection.**

---

## 18. Existing Mystash mapping (informational)

| Today | Target |
|-------|--------|
| `collection_product_tags` | Evolve to this model |
| `tag_source` ai/manual/import | Map → frozen `selection_source` |
| `is_primary` bool | Derive from `recommendation_strength = PRIMARY` |
| `ingest_draft_products` | Proposals → `ProductTagProposed` |
| `video_products` | Dual-write until Search migrated; Tag is SoT |
| `product_clicks` | Attribute via **`collection_product_tag_id`** |
| CollectionService tag APIs | Sole mutator |

---

## Appendix A — Non-goals of this document

- SQL / Prisma / migrations / executable DDL  
- API routes / UI wireframes  
- PI algorithms / affiliate network design  
- Search/Feed/Recs ranking design  

---

## Appendix B — Relationship cheat sheet

```text
CatalogProduct  (1)  ←──referenced by──  (*) CollectionProductTag
Collection      (1)  ──owns──            (*) CollectionProductTag
                     unique (collection_id, catalog_product_id)
Shopping click  (*)  ──attributes to──►  collection_product_tag_id
```

---

*End of CollectionProductTag Domain Specification.*
