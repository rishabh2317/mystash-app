# Discover Anywhere — Phase 9: Product Page reviews

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).  
Phase 8: [`mystash-user-ingestion-phase-8-product-media.md`](./mystash-user-ingestion-phase-8-product-media.md).

Phase 9 makes reviews a first-class Product Page section. It reuses
`product_ai_reviews` and does not add a second generator, scrape new
providers, or invent ratings.

```
READY product_ai_reviews row
  → ProductPageView.reviews { overview, likes, concerns, sources }
generating / failed / empty → omit the section
```

---

## 1. Decision

The existing AI Review record already has a decision-oriented summary, likes
(pros), concerns (cons), and source URLs. It does **not** store a star rating
or review count — Gemini is forbidden from fabricating those — so the Product
Page omits stars and counts rather than inventing them.

`GET /products/:id/page` is read-only: it projects a READY row and never
enqueues generation. Collection / Creator still call `GET /products/:id/ai-review`.

---

## 2. Catalogue vs share-imported

| | Catalogue | Share-imported |
| --- | --- | --- |
| Lookup | READY review for the catalogue id | only if an existing `catalogProductId` link already has a READY review |
| Missing | omit section | omit section |
| Fake catalogue id | never | never |

---

## 3. What this phase does not do

- Compare
- New review providers / scraping
- Recommendation/ranking
- Search redesign
- Automatic catalogue promotion
- Merchant offer or media changes
