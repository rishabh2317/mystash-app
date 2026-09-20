# Discover Anywhere — Phase 10: Product comparison

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).  
Phase 9: [`mystash-user-ingestion-phase-9-reviews.md`](./mystash-user-ingestion-phase-9-reviews.md).

Phase 10 adds a facts-only comparison from the Product Page. It reuses
`GET /products/:id/page` and existing product search. It does not create a
second product store, score products, or invent missing values.

```
Product Page Compare
  → /compare?ids=
  → fetch each ProductPageView
  → union of stored price / merchant / specs / review overview
```

---

## 1. Decision

Comparison is a view over existing Product Page records. Catalogue and
share-imported identities use the same DTO. Search is only a picker
(`searchBlended` + `hydrateSearchProducts`); the Search tab is unchanged.

Attribute order is inferred from stored `category` / title and from
specification keys already in catalog metadata (`Color`, `Storage`, `RAM`,
`Chip`, `Display`, `Driver`, `Platform`, `Weight`, `Size`, …). Families such
as headphones, laptops, phones, and consoles are preference lists, not a
required taxonomy.

---

## 2. Missing data

A cell is omitted from invention: if the stored field is absent the UI shows
“Not available”. Review cells use a stored overview (and a stored rating only
when one exists). Multiple merchant prices are listed as stored; none is
marked cheaper or best.

Share-imported products participate with whatever structured fields they
already have. They are never promoted into `catalog_products`.

---

## 3. What this phase does not do

- Search redesign
- Recommendation / ranking / winner language
- Automatic catalogue promotion
- New review providers
- New media ranking
