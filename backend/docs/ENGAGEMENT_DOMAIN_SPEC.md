# Mystash Engagement Domain Specification

**Status:** Canonical domain specification — architectural decisions in §16 are **frozen** (no SQL, no Prisma, no APIs, no code, no migrations)  
**Audience:** Platform architecture for behavioral graph, Feed, Search, Recommendations, Analytics, Notifications, Commerce attribution (5–10 year horizon)  
**Principle:** Engagement owns the **behavioral graph** of Mystash — immutable interaction facts, relationship state (including Follow), affinities, and engagement-derived aggregates. Peer domains **consume** Engagement; they do not own interaction history.  
**Depends on (identity references only):** [`USER_DOMAIN_SPEC.md`](./USER_DOMAIN_SPEC.md), [`COLLECTION_DOMAIN_SPEC.md`](./COLLECTION_DOMAIN_SPEC.md), [`COLLECTION_MEDIA_DOMAIN_SPEC.md`](./COLLECTION_MEDIA_DOMAIN_SPEC.md), [`COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md`](./COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md), [`CATALOG_DOMAIN_SPEC.md`](./CATALOG_DOMAIN_SPEC.md)  
**Peers (consume / never own Engagement SoT):** Search, Feed, Recommendations, Analytics, Notifications, Shopping / Commerce, Catalog, Collection, CollectionMedia, Product Intelligence, Safety  

---

## 0. Definition

**Engagement** is the bounded context for **how Users interact** with Creators (Users with creator capability), Collections, Catalog products (via Tags), and commerce destinations.

```text
Engagement (bounded context)
  ├── InteractionFact (*)          immutable append-only events
  ├── RelationshipEdge (*)         durable user↔entity state (follow, save, …)
  ├── AffinityAggregate (*)        derived creator / collection / product affinity
  ├── EngagementMetric (*)         derived rates & scores (ownership, not formulas)
  ├── CounterProjection (*)        async totals → denorm contracts to User / Collection / …
  ├── engagement_revision          reserved cache-invalidation token (future; not V1)
  └── SessionAggregate (*)         reserved future session spine (funnels / attribution / AI) — not V1
```

**Engagement exists to answer:**

> “What did this User do with this Creator / Collection / Product / commerce surface — and what durable relationships and aggregates follow from those facts?”

**Analogues (inspiration, not clones)**

| Platform pattern | Mystash analogue |
|------------------|------------------|
| TikTok / Instagram watch + follow graph | Collection view/save + Creator follow |
| Pinterest pin save / board affinity | Collection save + product save |
| Spotify listen history + follow | Completion / rewatch + Creator follow |
| YouTube watch + subscribe | View / completion + Creator follow |
| Amazon click / ATC / purchase signals | Product click / merchant click / purchase attributed |

**V1 social action:** **Save** only (commerce intent). **No Like** in V1 (§16.17).

### What it is not

| Not this | Why | Owning context |
|----------|-----|----------------|
| **Collection** content, lifecycle, tags, search source | Recommendation package | **Collection** |
| **Catalog** identity / verification | Product SoT | **Catalog** |
| **Shopping** destination choice / redirect / affiliate mint | Commerce runtime | **Shopping / Commerce** |
| **Search** inverted index / query serving | Serving projection | **Search** |
| **Feed** ranking / card assembly | Serving projection | **Feed** |
| **Recommendations** models / embeddings / candidate gen | ML / ranking BC | **Recommendations** |
| **Analytics** warehouse, BI funnels, long-horizon reporting cubes | Reporting / data platform | **Analytics** |
| **Notifications** delivery, templates, device tokens | Delivery BC | **Notifications** |
| **User** profile / account / creator_status | Identity | **User** |
| **Block / mute / trust & safety graphs** | Safety policy | **Safety** (not a Social BC for follow — §16.2–16.3) |

### Scale assumptions

- Billions of interaction events  
- Hundreds of millions of Users  
- Millions of Creators  
- Thousands of concurrent writes  
- Event-driven; CQRS-friendly  
- Counters and affinities **eventually consistent**  
- No synchronous fan-out to Search / Feed / Recs / Notifications on every event  

### Specification phases

| Layer | Role |
|-------|------|
| **Canonical Domain Model** | This document — ownership, interaction taxonomy, graph, consumption contracts |
| **V1 (near-term)** | High-value facts (view/save, follow, product/merchant click); client UUID idempotency; async counters; dual-write `product_clicks`; Save-only (no Like) |
| **Future** | SessionAggregate, affinity batch maturity, comments/reactions, purchase attribution at scale, trending, ML exports, `engagement_revision` invalidation |

V1 must not invent alternate aggregates that contradict this model. Existing transitional stores (e.g. `product_clicks`) are **ingestion/compatibility paths** until Engagement is the write SoT for those facts.

---

## 1. Aggregate ownership

### 1.1 What Engagement owns

| Responsibility | Meaning |
|----------------|---------|
| **Interaction facts** | Immutable records of User (or anonymous) behavior against entities |
| **Relationship state** | Durable edges: follow, save, hide, wishlist (when introduced), etc. |
| **Behavior history** | Queryable interaction history (user- and entity-centric) within retention policy |
| **Creator affinity** | Derived strength of User↔Creator behavioral bond |
| **Collection affinity** | Derived strength of User↔Collection bond |
| **Product affinity** | Derived strength of User↔CatalogProduct (via Tag context when relevant) |
| **Engagement aggregates / metrics** | Derived rates and popularity signals **as Engagement-owned projections** (not ranking algorithms) |
| **Canonical engagement counters** | Event-derived totals that peer aggregates **mirror** asynchronously |
| **Creator Authority / Trending / popularity metrics** | Engagement-produced signals; Search/Feed/Recs consume (§16.18) |
| **Domain events** | CollectionViewed, CreatorFollowed, ProductClicked, MerchantClicked, … (§13) |
| **Privacy classification of interactions** | Public / private / anonymous handling rules (§12) |
| **SessionAggregate (reserved)** | Future session spine for funnels / commerce / AI — not owned as V1 aggregate (§1.5) |
| **engagement_revision (reserved)** | Future cache-invalidation token — not V1 (§1.5) |

### 1.2 What Engagement must NEVER own

| Must not own | Owning context |
|--------------|----------------|
| Collection metadata, publish state, tags, search source fields | **Collection** |
| Catalog identity, aliases, verification, merge | **Catalog** |
| Merchant inventory, destination selection, affiliate credentials | **Shopping / Commerce** |
| Search indexes, query DSL, postings | **Search** |
| Feed timelines, ranking code, card SoT | **Feed** |
| Recommendation models, embeddings, candidate sets | **Recommendations** |
| BI warehouse schemas, executive dashboards as SoT | **Analytics** |
| Notification send pipeline | **Notifications** |
| User profile / auth / creator_status | **User** |
| Trust & safety block/mute policy graph | **Safety** |
| Social BC for follow edges | **None** — Follow is Engagement (§16.2); do not create a Social BC |
| Session funnels as V1 requirement | Reserved only (§1.5) |

### 1.3 Conceptual aggregates (not tables)

```text
InteractionFact (immutable)
  event_id (client UUID — idempotency)
  actor_user_id? | anonymous_id?
  object_type + object_id
  interaction_type
  context (collection_id, tag_id, creator_id, session_id?, surface, …)
  occurred_at
  privacy_class
  attribution keys (primary: collection_product_tag_id when commerce)

RelationshipEdge (mutable state derived from facts + explicit actions)
  user_id → creator_id | collection_id | catalog_product_id
  edge_type (FOLLOW, SAVE, HIDE, …)   — no LIKE in V1
  state (ACTIVE | REMOVED)
  updated_at

AffinityAggregate (derived — batch)
  user_id × (creator | collection | product)
  strength / recency / volume features (opaque to this spec’s formulas)

CounterProjection (derived — realtime / near-realtime from facts)
  object_type + object_id + counter_name → value, updated_at
  → async denorm to Collection / User / Catalog read slots

SessionAggregate (RESERVED — future only)
  session_id
  actor_user_id? | anonymous_id?
  started_at / ended_at
  ordered interaction spine (AppOpen → Collection → Product → Merchant → Close)
  — no schema, no V1 implementation

engagement_revision (RESERVED — future only)
  monotonic/cache token for invalidating engagement-derived read caches
  — no V1 implementation
```

**Normative:** InteractionFact is the **source of truth**. Relationships, affinities, counters, and peer denorms are **projections**. SessionAggregate and `engagement_revision` are **reserved** and must not force redesign of Fact / Relationship / Affinity.

### 1.4 Boundary map

```text
        User / Collection / Catalog / Tag / Shopping
                         │ emit events / invoke ingest
                         ▼
┌────────────────────────────────────────────────────────────┐
│                    ENGAGEMENT DOMAIN                        │
│  facts · relationships · affinities · counters · events   │
│  (future: SessionAggregate · engagement_revision)           │
└───────┬──────────┬──────────┬──────────┬──────────┬────────┘
        │          │          │          │          │
        ▼          ▼          ▼          ▼          ▼
     Search      Feed       Recs     Analytics  Notifications
   (signals)  (signals)  (features)  (mirror)   (triggers)

Event SoT path (frozen):
  Engagement ──► Event Stream ──► Analytics Mirror

Peer denorm (async only):
  Engagement ──► Collection.materialized_counters
  Engagement ──► User.followers_count / following_count / …
```

### 1.5 Future Extensibility — SessionAggregate & engagement_revision

**Reserved only. No schema. No implementation.**

#### SessionAggregate

Catalogues a future aggregate that groups ordered interactions within one app/session continuity:

```text
User (or anonymous)
  → App Open
  → Collection (impression / view / open / save …)
  → Product (expand / click …)
  → Merchant (MerchantClick …)
  → Close
```

**Why reserve now:** funnels, commerce attribution enrichment, AI context, and Search personalization all benefit from a session spine — without changing InteractionFact as the atomic SoT.

**Rules:**

- SessionAggregate **extends** Engagement; it does **not** replace InteractionFact.  
- Facts may later carry optional `session_id`; V1 may omit sessions entirely.  
- Session must never become a second event SoT.

#### engagement_revision

Reserved future token for cache / projection invalidation when engagement-derived read models need cheap staleness detection (similar in spirit to Collection `content_revision`). **Not required for V1.**

---

## 2. Interaction types

Taxonomy of interactions Mystash **may** support. Phases mark intent; **no implementation**.

### 2.1 Collection interactions

| Type | Meaning | Typical privacy | Phase |
|------|---------|-----------------|-------|
| **Impression** | Collection card **entered viewport** | Private / anonymizable | V1+ |
| **View** | **Meaningful interaction** (e.g. ≥2s or ≥30% visibility — exact thresholds are implementation) | Private | V1 |
| **Open** | Explicit open of Collection detail / player | Private | V1 |
| **Save** | User bookmarks Collection (“I may buy / revisit”) | Aggregate save **count** may be public; edge/history private per §12 | V1 |
| **Unsave** | Remove save | Private | V1 |
| **Share** | Share intent / completed share | Aggregate share **count** may be public | V1 |
| **Hide** | User hides from personal Feed | Private | Future |
| **Report** | Trust & safety report signal | Private; Safety consumes | Future |
| **Completion** | Outcome: completed = true (threshold defined by **CollectionMedia**, not Engagement) | Private | V1+ |
| **Rewatch** | Repeat meaningful view | Private | Future |
| **Comment** | User comment on Collection | Public (moderation) | Future |

**No Like in V1 (frozen).** Mystash is commerce-oriented; Save expresses purchase/revisit intent. Reaction/Like remains a reserved future type only if product policy later revisits §16.17.

### 2.2 Creator interactions

| Type | Meaning | Phase |
|------|---------|-------|
| **Follow** | User follows Creator (User with creator capability) | V1 |
| **Unfollow** | Remove follow | V1 |
| **ProfileView** | View Creator profile | V1+ |
| **ProfileShare** | Share Creator profile | Future |

Follow is an Engagement **relationship edge** plus Follow/Unfollow **facts**. **Do not create a Social BC for follow.** Creator profile content remains **User**.

### 2.3 Product interactions (Catalog via Collection context)

| Type | Meaning | Attribution | Phase |
|------|---------|-------------|-------|
| **ProductImpression** | Product dock / tag shown | **Primary:** `collection_product_tag_id`; also Catalog/Collection/Creator | V1+ |
| **ProductExpand** | Expand product details in UI | Same | V1+ |
| **ProductClick** | Click toward product / shopping CTA (pre-redirect) | Same | V1 |
| **ProductSave** | Save product (wishlist-like) | Same | Future |
| **ProductShare** | Share product | Same | Future |
| **ProductCompare** | Add to compare set | Same | Future |

**Normative (frozen):** Primary commerce attribution key = **`collection_product_tag_id`**. Always also record secondary dimensions when known: `catalog_product_id`, `collection_id`, `creator_id`.

### 2.4 Commerce interactions

| Type | Meaning | Writer of runtime | Engagement role | Phase |
|------|---------|-------------------|-----------------|-------|
| **MerchantClick** | Outbound redirect to merchant / preferred / affiliate destination | **Shopping** performs redirect and **emits** `MerchantClicked` | Engagement **records** the fact | V1 |
| **BuyIntent** | Strong pre-purchase signal (ATC analogue) | Client / Commerce emits | Fact | Future |
| **PurchaseConfirmed** | Attributed purchase (last-touch Tag until scale) | Commerce settlement; emits attribution | Engagement stores `PurchaseAttributed` **only** | Future |

Shopping owns **where** the user goes and **never writes Engagement tables**. Engagement owns the behavioral fact. Transitional path: dual-write `product_clicks` + `MerchantClicked` → backfill → retire legacy (§16.16).

### 2.5 Future / reserved

Comment, Reaction (not V1 Like), Wishlist, Compare, Tip, Remix, Collaborative save, **SessionAggregate** — reserved. Adding a type must not redesign the InteractionFact model.

### 2.6 Interaction type rules

1. Every interaction has a **type**, **object**, **time**, **privacy class**, and client **`event_id` (UUID)**.  
2. Server enforces **uniqueness** on `event_id` (idempotent retries / offline / mobile).  
3. Destructive relationship changes (Unfollow, Unsave) are facts **and** edge updates.  
4. Moderation **Report** facts may be dual-consumed by Safety without Safety owning the Engagement log.  
5. **Impression ≠ View** (frozen).  
6. **Completion** stores boolean outcome; **CollectionMedia** owns completion thresholds.  
7. **No Like** in V1 — use **Save**.

---

## 3. Ownership

### 3.1 Ownership matrix

| Concern | Engagement | Elsewhere |
|---------|------------|-----------|
| Raw interaction events | **SoT** | Analytics **mirrors** stream only — never a write path |
| Follow / save / hide **edges** | **SoT** | User/Collection never store edge lists as SoT; **no Social BC** |
| Affinity aggregates | **SoT** (batch) | Recs **read**; do not redefine |
| Creator Authority / Trending / Popularity | **SoT** (Engagement computes) | Search/Feed/Recs consume |
| Canonical counters (views, saves, follows, clicks, …) | **SoT projections** (realtime from facts) | Collection/User hold **denorm copies** only |
| Collection `views_count` / `saves_count` / … slots | Written **async by contract** | **Owned as fields** by Collection aggregate for read locality |
| User `followers_count` / `following_count` | Written **async by contract** | **Owned as fields** by User for profile cards |
| Catalog popularity denorm (optional) | Async contract | Catalog may host read slot; Catalog does not own events |
| Tag-level counters (optional) | Async contract | CollectionProductTag denorm only |
| `product_clicks` (legacy) | Dual-write then migrate (§16.16) | Shopping redirect runtime stays Shopping |
| Search index | — | **Search** |
| Feed ranking | — | **Feed** |
| Recs models | — | **Recommendations** |
| BI funnels / cohort reports | Consume mirrored stream | **Analytics** |
| Block / mute | May consume suppression projections | **Safety** owns |
| Collection caption / intent | — | **Collection** |
| Completion thresholds | Stores outcome only | **CollectionMedia** |
| Product identity | — | **Catalog** |
| Purchase settlement | Stores `PurchaseAttributed` | **Commerce** |

### 3.2 Counter ownership clarified

| Layer | Owner |
|-------|-------|
| Event that caused +1 view | **Engagement** InteractionFact |
| Canonical `collection_views` projection | **Engagement** CounterProjection |
| `Collection.views_count` denorm | **Collection** field, **Engagement-updated** async |
| Dashboard “views by country last 90d” | **Analytics** (from mirrored stream) |

Never treat Collection/User denorm counters as audit or billing SoT.

### 3.3 Relationship tables vs peer graphs

| Graph | Owner |
|-------|-------|
| User → Creator (FOLLOW) | **Engagement** |
| User → Collection (SAVE, HIDE, …) | **Engagement** |
| User → CatalogProduct (SAVE / WISHLIST, …) | **Engagement** |
| User → User (BLOCK / MUTE) | **Safety** |
| Creator → Collection (ownership) | **Collection** (`creator_id`) |

---

## 4. Interaction facts (layers)

Strict separation — CQRS-friendly.

```text
Raw immutable InteractionFact          ← realtime ingest (client UUID event_id)
        ↓  (near-realtime processors)
Materialized CounterProjection         ← realtime / near-realtime
        ↓  (async denorm contracts)
Peer read models (Collection / User / optional Catalog slots)
        ↓
Derived AffinityAggregate              ← batch
        ↓
Future ranking / ML feature signals (exported; not owned algorithms)
        ↓
(future) SessionAggregate spanning facts for funnels / AI
```

### 4.1 Raw immutable events

- Append-only  
- **Never mutated** — corrections via **compensating events** only (e.g. `CollectionViewInvalidated`)  
- Client-generated **`event_id` (UUID)**; server uniqueness  
- Carry actor, object, type, context, privacy, occurred_at, attribution keys  
- Optimized for write throughput and time-ordered partition  

### 4.2 Derived aggregates

- Affinity scores computed **in batch** (frozen hybrid model §16.15)  
- Rolling windows, unique-actor sketches OK at scale  
- Recomputable from facts (within retention)  
- Not serving indexes for Search/Feed  

### 4.3 Materialized counters

- Scalar totals / unique estimates per object  
- Updated from facts in **realtime / near-realtime**  
- Eventually consistent denorm to peers  
- **Never** incremented synchronously inside the Collection/User write path on each interaction  
- `CounterUpdated` domain events emit on **batch / significant delta only** — never per increment  

### 4.4 Future ranking signals

- Feature vectors / trending / **Creator Authority** **exported** to Recommendations / Feed / Search  
- Engagement **owns production**; consumers own **how** they rank  

---

## 5. Relationship graph

Behavioral edges that power personalization. **No recommendation algorithms here.**

```text
User ──FOLLOW──► Creator (User)
User ──SAVE────► Collection
User ──HIDE────► Collection
User ──SAVE────► CatalogProduct   (future wishlist)
User ──…───────► CollectionProductTag  (optional fine-grained; prefer Collection/Product)
```

### 5.1 Edge properties (conceptual)

| Property | Role |
|----------|------|
| `edge_type` | FOLLOW, SAVE, HIDE, WISHLIST, … (**no LIKE in V1**) |
| `state` | ACTIVE \| REMOVED |
| `created_at` / `updated_at` | Lifecycle |
| `source_interaction_id` | Provenance to fact |
| `privacy_class` | Edge visibility |

### 5.2 Graph uses (consumers)

| Consumer | Use |
|----------|-----|
| Recommendations | Candidate generation features (follow set, save set) |
| Feed | Following Feed, saved shelf |
| Search | Personalization boosts / filters (optional) |
| Notifications | “X followed you”, “Y saved your Collection” |
| Analytics | Graph growth funnels |

### 5.3 Non-edges

- Collection ownership is not an Engagement edge.  
- Catalog merge remaps do not rewrite history blindly — facts keep historical ids; projections may resolve survivors (Catalog contract).  

---

## 6. Aggregated metrics

Engagement **owns** these metric projections as behavioral truth. **No formulas** in this spec.

### 6.1 Volume & rates (examples)

| Metric | About |
|--------|-------|
| Views / Unique Views | Collection (and optionally Creator rollup) |
| CTR | Impression → Open / ProductClick |
| Save Rate | Views → Saves |
| Share Rate | Views → Shares |
| Completion Rate | Views → Completions |
| Follow Rate | ProfileView / CollectionView → Follow |
| Merchant Click Rate | Product surfaces → MerchantClick |
| Purchase Rate | MerchantClick / View → PurchaseConfirmed |

### 6.2 Authority & quality signals (examples)

| Metric | About | Producer |
|--------|-------|----------|
| Creator Authority | Cross-collection engagement quality for a Creator | **Engagement** |
| Collection Quality | Engagement health signal (may feed Collection `quality_score` **by contract**) | **Engagement** produces signal; Collection owns the field |
| Product Popularity | Catalog-scoped engagement popularity | **Engagement** |
| Trending Score | Time-decayed engagement velocity | **Engagement** |

Search / Feed / Recommendations **consume** these; they do not redefine Engagement ownership.

---

## 7. Search consumption

**Search owns** indexes and query serving. Engagement does **not** build SearchDocuments.

| Engagement provides | Search may do |
|---------------------|---------------|
| Counter snapshots / quality / trending / Creator Authority (async) | Boost, filter, or re-rank documents |
| Relationship features (follow / save) at query time via feature join | Personalization |
| Domain events (`EngagementAggregated`, `TrendingUpdated`, batch `CounterUpdated`) | Invalidate or refresh engagement fields on documents |
| (Future) Session features | Session-aware personalization |

**Search must not:** write InteractionFacts, own follow edges, or treat Collection denorm counters as event SoT.

---

## 8. Feed consumption

**Feed owns** timeline assembly and ranking code.

| Engagement provides | Feed may do |
|---------------------|-------------|
| Following edge set | Following Feed candidate pool |
| Save / Hide edges | Saved shelf; suppress hidden |
| Fresh interaction signals / counters | Rank and diversity inputs |
| Events (View, Complete, …) | Session-aware ranking updates (async) |

**Feed must not:** persist canonical interaction history, or synchronously update Collection counters.

---

## 9. Recommendation consumption

**Recommendations owns** models, embeddings, candidate generation, and ranking policies.

| Engagement provides | Recs may do |
|---------------------|-------------|
| Affinity aggregates (creator / collection / product) — batch | Features / candidate recall |
| Relationship graph snapshots (follow / save) | Graph-based recall |
| Metric projections (CTR, save rate, trending, Creator Authority, …) | Training labels / features |
| Event stream (sampled or full via contract) | Offline training |

**Recommendations must not:** become the SoT for follows/saves/clicks, or write Collection/User counters except through Engagement contracts.

---

## 10. Analytics consumption

**Analytics owns** warehouse modeling, BI, experimentation reports, and long-horizon compliance exports **as a data platform**.

| Engagement provides | Analytics may do |
|---------------------|------------------|
| Canonical InteractionFact stream (or CDC) | Mirror into warehouse |
| Counter / metric projections | Reconcile dashboards |
| Privacy class + deletion signals | Respect GDPR pipelines |

**Frozen path:**

```text
Engagement (SoT)
  → Event Stream
  → Analytics Mirror
```

Analytics is for **reporting**. Engagement is for **product behavior**. Analytics must **never** become a write path for follows, saves, views, or clicks.

**Analytics must not:** drive Feed ranking directly, own relationship edges, or accept product writes that bypass Engagement.

---

## 11. Notifications consumption

**Notifications owns** delivery, templates, preferences, and device tokens.

| Engagement provides | Notifications may do |
|---------------------|----------------------|
| Domain events (CreatorFollowed, CollectionSaved, …) | Trigger fan-out |
| Privacy / mute / block checks (with Safety) | Suppress sends |
| Aggregation hooks (“10 people saved…”) | Digest bundling |

**Notifications must not:** store canonical engagement history, or invent follow state.

---

## 12. Privacy

### 12.1 Classes

| Class | Meaning | Examples (frozen) |
|-------|---------|-------------------|
| **Public (aggregate social proof)** | Visible counts on profiles / cards | Followers count, Saves count, Views count, Shares count |
| **Private** | Actor-visible / system need-to-know | Watch history, Merchant clicks, Product clicks, Completion, Hide, Reports |
| **Anonymous** | No durable user_id; session/device scoped | Logged-out impressions/views |

### 12.2 Rules (frozen)

1. Watch/view **history** is **private**; aggregate **views_count** may be public.  
2. Follow **edges** may appear on public profiles; follow **lists** privacy may tighten later — counts are public social proof.  
3. Anonymous → authenticated stitching: **consent-based merge window only**. **Never** silently stitch.  
4. **Soft delete:** relationship REMOVED + compensating invalidation facts as needed; counters adjust async.  
5. **GDPR-style deletion:** anonymize actor on facts/edges; emit `EngagementActorErased`.  
6. **Creator visibility:** aggregate metrics + public social proof — not private viewer identity by default.  
7. **Block/mute (Safety):** consumers honor Safety projections; Engagement may consume suppression hints; **does not own** block graph.  
8. **Report** interactions are private and Safety-visible.  
9. **Retention (recommended):** Anonymous → **90 days**; Authenticated interactions → **retained until erasure request**; Commerce attribution → **retained per legal requirements**; GDPR → **anonymize actor**.

---

## 13. Domain events

Conceptual events. Consumers subscribe asynchronously. **No implementation.**

### 13.1 Collection

| Event | When |
|-------|------|
| `CollectionImpressed` | Impression recorded |
| `CollectionViewed` | View recorded |
| `CollectionOpened` | Open recorded |
| `CollectionSaved` / `CollectionUnsaved` | Save edge changed |
| `CollectionShared` | Share recorded |
| `CollectionHidden` | Hide edge set |
| `CollectionCompleted` | Completion outcome true (threshold from CollectionMedia) |
| `CollectionRewatched` | Rewatch recorded |
| `CollectionReported` | Report filed |
| `CollectionViewInvalidated` | Compensating event — undoes/marks prior view without mutating history |

### 13.2 Creator

| Event | When |
|-------|------|
| `CreatorFollowed` / `CreatorUnfollowed` | Follow edge changed |
| `CreatorProfileViewed` | Profile view |

### 13.3 Product / commerce

| Event | When |
|-------|------|
| `ProductImpressed` / `ProductExpanded` | Product UI signals |
| `ProductClicked` | In-app product CTA |
| `ProductSaved` / `ProductShared` | Future |
| `MerchantClicked` | Emitted by Shopping; recorded by Engagement |
| `BuyIntentRecorded` | Future |
| `PurchaseAttributed` | Last-touch `collection_product_tag_id` until commerce scale; settlement remains Commerce |

### 13.4 System / projection

| Event | When |
|-------|------|
| `EngagementAggregated` | Batch/stream aggregation advanced for an object |
| `CounterUpdated` | **Batch / significant delta only** — never per increment |
| `TrendingUpdated` | Trending projection refresh |
| `AffinityUpdated` | Batch affinity projection refresh |
| `EngagementActorErased` | Privacy erasure / anonymization completed |

Payloads should carry object ids, actor (if allowed), interaction type, timestamps, and privacy class — exact schemas are implementation concerns.

---

## 14. Counters

### 14.1 Principles

1. **Never** update Collection/User counters synchronously inside the hot interaction path.  
2. Counters are **derived from events** (or from edge state for follow/save totals).  
3. **Eventually consistent** denorm to peer aggregates via contractual writers.  
4. Avoid synchronous fan-out to Search/Feed/Recs/Notifications.  
5. Unique counters may use sketches/HLL at scale (implementation detail).

### 14.2 Example counters (ownership = Engagement projection → denorm target)

| Counter | Denorm target (read slot) |
|---------|---------------------------|
| Collection views / unique views | `Collection.views_count` (and optional unique slot) |
| Collection saves / shares | Collection denorm fields (**no likes_count in V1**) |
| Collection product / merchant clicks | `Collection.product_clicks_count` |
| Collection attributed purchases | `Collection.purchases_count` |
| Creator followers | `User.followers_count` |
| User following | `User.following_count` |
| Catalog product clicks / saves | Optional Catalog or separate popularity read model |
| Tag-level clicks | Optional CollectionProductTag denorm |

`counters_updated_at` on Collection remains a Collection field updated by the denorm contract.

### 14.3 Failure & reconciliation

- At-least-once event processing ⇒ idempotent counter application  
- Periodic reconciliation from facts/edges allowed  
- Peer denorm lag is expected and acceptable for Feed cards  

---

## 15. Indexing (recommendations for scale)

Architecture guidance only — not a schema.

### 15.1 Interaction history

| Access pattern | Index direction |
|----------------|-----------------|
| User timeline | `(actor_user_id, occurred_at DESC)` |
| Entity timeline | `(object_type, object_id, occurred_at DESC)` |
| Type filters | Include `interaction_type` in composite keys |
| Idempotency | Unique `(event_id)` client UUID |
| Partitioning | Time + hash(object or actor) for billions of rows |
| (Future) Session | `(session_id, occurred_at)` when SessionAggregate exists |

### 15.2 Relationship tables

| Edge | Suggested keys |
|------|----------------|
| Follow | Unique `(user_id, creator_id)` WHERE ACTIVE; reverse `(creator_id, user_id)` |
| Save Collection | Unique `(user_id, collection_id)`; reverse for “savers” |
| Hide | Unique `(user_id, collection_id)` |
| Product wishlist | Unique `(user_id, catalog_product_id)` |

### 15.3 Counter tables

| Pattern | Guidance |
|---------|----------|
| Hot counters | Key-value / wide row by `object_type+id`; sharded |
| Avoid | Updating huge parent rows on every event |
| Snapshots | Periodic rollups for Analytics |

### 15.4 Time-series access

| Need | Guidance |
|------|----------|
| Trending windows | Pre-aggregated time buckets (e.g. 5m/1h/1d) per object |
| Affinity decay | Rolling stores or TTLd feature rows |
| Cold history | Tier to cheaper storage; keep hot recent partition |

---

## 16. Architectural decisions (frozen)

Former open questions — **resolved**. Do not reopen without an explicit architecture change.

| # | Decision |
|---|----------|
| **1** | **Engagement is the single Event SoT.** Analytics mirrors the event stream. Analytics never becomes a write path. Path: `Engagement → Event Stream → Analytics Mirror`. |
| **2** | **Follow belongs to Engagement.** Do **not** create a Social bounded context for follow. Follow powers Feed, Search, Recs, Creator Authority, Notifications. |
| **3** | **Safety owns Block/Mute.** Engagement may consume suppression projections. Do not mix behavioral graph with moderation graph. |
| **4** | **Client-generated UUID `event_id`.** Server enforces uniqueness. Supports retries, offline, mobile. |
| **5** | **Anonymous → authenticated stitching: consent-based merge window only.** Never silently stitch. |
| **6** | **Impression ≠ View.** Impression = entered viewport. View = meaningful interaction (e.g. ≥2s or ≥30% visibility — exact thresholds are implementation). |
| **7** | **CollectionMedia owns completion thresholds.** Engagement stores **outcome** (`Completion = true`), not raw percent watched. |
| **8** | **Public social proof (aggregates only):** followers count, saves count, views count, shares count. **Private:** watch history, merchant clicks, product clicks, completion, hide, reports. |
| **9** | **Shopping emits `MerchantClicked`; Engagement records the fact.** Shopping never writes Engagement tables. |
| **10** | **Purchase attribution: last-touch `collection_product_tag_id`** until real commerce scale. Settlement belongs to Commerce. Engagement stores `PurchaseAttributed` only. |
| **11** | **`CounterUpdated` is batch-only** (e.g. every minute or significant delta). Never emit per increment. |
| **12** | **Facts are immutable.** Corrections via **compensating events** only (e.g. `CollectionViewed` → `CollectionViewInvalidated`). Never mutate history. |
| **13** | **Retention (recommended):** Anonymous → 90 days; Authenticated → retained until deletion request; Commerce attribution → per legal requirements; GDPR → anonymize actor. |
| **14** | **Record both Tag and Product attribution.** Primary = `collection_product_tag_id`. Secondary = `catalog_product_id`, `collection_id`, `creator_id`. |
| **15** | **Hybrid processing:** Realtime → facts + counters. Batch → affinity. |
| **16** | **`product_clicks` migration:** Dual-write (`product_clicks` + `MerchantClicked`) → backfill → delete legacy. No downtime. |
| **17** | **Save only in V1 — no Like.** Save = commerce/revisit intent; Like is deferred. |
| **18** | **Engagement owns Creator Authority** (and Trending / Popularity / CTR-class metrics). Search / Feed / Recommendations consume. |

### Additional freezes

| ID | Decision |
|----|----------|
| **A** | **Reserve future `SessionAggregate`** (App Open → Collection → Product → Merchant → Close). No schema/implementation now. Enables future funnels, Search, commerce, AI. |
| **B** | **Reserve `engagement_revision`** for future cache invalidation. No implementation now. |

### Supersedes prior wording

- User-domain references to a **Social BC for follow edges** are superseded: Follow is Engagement.  
- Safety remains for **block/mute** only.  
- Older “Analytics owns event streams” wording means **Analytics mirrors**; Engagement is product SoT.

---

## 17. Explicit non-goals

Engagement **must never** own:

| Non-goal | Owner |
|----------|-------|
| Ranking algorithms | **Feed / Recommendations** |
| Search indexes / query serving | **Search** |
| Feed generation / timelines as SoT | **Feed** |
| Recommendation models / embeddings | **Recommendations** |
| Shopping destination decisions / affiliate minting | **Shopping** |
| Catalog identity / verification / merge | **Catalog** |
| Collection metadata / publish / tags / intent | **Collection** |
| Completion threshold rules | **CollectionMedia** |
| Creator profiles / account status | **User** |
| Notification delivery / device tokens | **Notifications** |
| BI warehouse as product SoT / event write path | **Analytics** (mirror only) |
| Block/mute policy graph | **Safety** |
| A separate Social BC for Follow | **N/A — Follow is Engagement** |
| Media binary storage | **CollectionMedia / storage** |
| Purchase settlement / earnings | **Commerce** |
| V1 SessionAggregate or engagement_revision implementation | Reserved only |

---

## 18. Architecture principles (normative)

1. **Event-driven** — facts first; everything else derives.  
2. **Immutable interaction history** — compensating events only.  
3. **Async aggregation** — no hot-path fan-out.  
4. **Read models consume Engagement** — Search, Feed, Recs, Notifications, Analytics.  
5. **CQRS friendly** — write fact log ≠ read projections.  
6. **Counters are eventually consistent**; updated near-realtime from facts.  
7. **Affinity is batch**; facts/counters are realtime.  
8. **Avoid synchronous fan-out.**  
9. **Optimize for billions of interaction events.**  
10. **Client UUID idempotency.**  
11. **Future-ready for ML ranking** — export features, don’t embed models.  
12. **Future-ready for recommendation systems** — graph + affinities as inputs.  
13. **Future-ready for commerce attribution** — Tag-primary dimensions; Commerce settlement separate.  
14. **Peer denorm is contractual** — Collection/User counters are mirrors, not SoT.  
15. **Privacy by class** — public aggregates vs private history.  
16. **Safety is orthogonal** — block/mute constrain consumers.  
17. **SessionAggregate reserved** — extend later without redesigning facts.  
18. **One producer for Creator Authority / Trending / Popularity** — Engagement.

---

## 19. Mystash principles (applied)

1. **One behavioral SoT** — Engagement for interactions and engagement relationships (including Follow).  
2. **Foundational domains stay pure** — User, Collection, Catalog remain content/identity.  
3. **Shopping emits; Engagement records** — runtime vs fact.  
4. **Analytics mirrors; never writes product behavior.**  
5. **Save, don’t Like (V1)** — commerce intent.  
6. **Evolve transitional tables** — dual-write then retire `product_clicks`.  
7. **Frozen decisions stay frozen** unless an explicit architecture revision says otherwise.  

---

## 20. Existing Mystash mapping (informational)

| Spec concept | Current / transitional artifact |
|--------------|----------------------------------|
| MerchantClick fact | Dual-write: `product_clicks` + `MerchantClicked` → migrate |
| Collection counter slots | `Collection` materialized counters (`views_count`, `saves_count`, …); treat `likes_count` as unused/legacy for V1 Save-only |
| User follower denorm slots | `User` materialized counts (Engagement Follow edges) |
| Tag attribution | CollectionProductTag id (primary commerce attribution key) |
| Catalog | Identity only; popularity denorm optional later |
| Analytics | Mirror of Engagement event stream |
| SessionAggregate / engagement_revision | Reserved — not present |

---

## 21. Success criteria for “canonical Engagement”

This domain is successfully formalized when:

1. Interaction facts and engagement relationships (including Follow) have a single write authority (Engagement).  
2. Analytics only mirrors; never writes product behavior.  
3. Collection/User counters are denorm mirrors updated asynchronously.  
4. Shopping emits `MerchantClicked`; Engagement stores the fact.  
5. Search / Feed / Recs / Notifications have clear consume-only contracts.  
6. Privacy classes, retention, and compensating-event correction are defined.  
7. No ranking/search/feed/recs algorithms live inside Engagement.  
8. SessionAggregate and `engagement_revision` remain reserved without blocking V1.  
9. Frozen decisions in §16 are treated as normative.

---

*End of Engagement Domain Specification.*
