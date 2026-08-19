# Catalog Domain Implementation Plan

**Spec:** [`CATALOG_DOMAIN_SPEC.md`](./CATALOG_DOMAIN_SPEC.md) (canonical)  
**Status:** Implement V1 boundary — no commit until requested  
**Stance:** Evolve in place. **No new tables. No schema redesign.** Wrap existing `catalog_products` / aliases / local search / ProductResolver.

---

## Spec decisions locked (V1)

| Topic | Decision |
|-------|----------|
| SoT | Existing `catalog_products` (+ aliases, match history) |
| Write authority | **CatalogService** only |
| Read contract | **Catalog Lookup Port** (capabilities, not frozen method names) |
| PI | `ProductResolver` remains orchestrator; calls CatalogService for Catalog writes/lookups |
| Publish placeholders | Via CatalogService unresolved-placeholder capability |
| Shopping denorm | Via CatalogService shopping-projection capability; Shopping owns semantics |
| Redirect | Lookup Port + **active-product resolution** (follow `merged_into_id`) |
| Lifecycle | ACTIVE / HIDDEN / DISCONTINUED / MERGED + orthogonal verification |
| Events | Structured domain events (User/Collection pattern) |
| Merge | Implement CatalogService.merge + InMemory path; Collection remap via port |
| Media / quality / variants / families | Spec-reserved only — **not built** |

**Out of V1 build:** New migrations, offer table split, ProductVariant/Family, Catalog Quality scores, reverse Collection index UI, packaging move-only without wiring, HTTP Catalog CRUD admin API.

---

## Architecture

```text
backend/src/catalog/          ← Catalog BC application boundary
  CatalogService              ← Lookup Port + write capabilities + merge
  CatalogRepository port      ← wraps Supabase / InMemory
  LocalCatalogSearch          ← reused from PI (or thin re-export)
       ▲
       │ used by
ProductResolver | publish | productRedirect | Collection remap port
```

Persistence stays on existing tables via `SupabaseCatalogRepository` (may live under PI path as implementation detail; CatalogService is the public boundary).

---

## Implementation steps

### 1. Plan + package scaffold

- This document  
- `backend/src/catalog/`: types re-exports, lifecycle, events, ports, CatalogService, factory, InMemory repo, tests

### 2. Domain

- Lifecycle transitions (status)  
- Domain events: ProductCreated, ProductVerified, ProductUnverified, CatalogUpdated, AliasAdded, LifecycleChanged, ProductMerged  
- Extend repo update patch with `status` / `mergedIntoId` for merge + lifecycle (no migration — columns already exist)

### 3. CatalogService

| Capability | Behavior |
|------------|----------|
| Identity / slug / alias / structured find | Delegate to repo |
| Active product resolution | Follow `merged_into_id` while MERGED |
| Local search | Existing LocalCatalogSearch |
| Public read filter | Prefer ACTIVE |
| Create/update from resolve | Existing create/update + events |
| Alias add | Repo + AliasAdded |
| Verification / lifecycle | Status transitions + events |
| Unresolved placeholder | Publish escape hatch |
| Shopping projection | Patch preferred/affiliate/price without touching verification merchant provenance unless explicitly set |
| Merge | Survivorship defaults; mark source MERGED; migrate aliases; emit ProductMerged; invoke CollectionTagRemapPort |

### 4. Wire callers

- `createProductIntelligence` → CatalogService → ProductResolver  
- ProductResolver: CatalogService for upsert + local search (via service)  
- `productRedirect`: resolve active product via CatalogService  
- `publish.ts`: placeholder via CatalogService (no raw insert)

### 5. Collection remap port

- `CollectionTagRemapPort.remapCatalogProduct(sourceId, targetId)`  
- CollectionService implements collision policy (keep stronger/earlier; soft-delete duplicate)  
- No-op port when Collection module not wired

### 6. Verify

- Lifecycle + CatalogService (create, lookup, merge, active resolve) tests  
- Existing PI / Collection tests still green  
- `npm run build` + `npm test`  
- No commit  

---

## Explicit non-goals

Variants, families, quality formulas, media gallery schema, new SQL, redesign of ProductResolver enrichment pipeline, frontend changes.
