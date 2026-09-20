# Discover Anywhere — Phase 7: Multi-merchant buying options

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).  
Phase 6: [`mystash-user-ingestion-phase-6-product-page.md`](./mystash-user-ingestion-phase-6-product-page.md).

Phase 7 presents stored shopping destinations on the Product Page. It does not add a
merchant service, a second ShoppingResolver, or catalogue promotion.

```
metadata.shopping_candidates + metadata.offer + catalog/discovered columns
  → listStoredShoppingDestinations
  → ProductPageView.offers[]
Buy → GET /products/:id/redirect?offerId=
  → ShoppingResolver.resolve(product, { offerId })   (catalogue)
  → stored merchantUrl / candidate URL               (share-imported)
```

---

## 1. Decision

Existing metadata already holds commerce destinations (`shopping_candidates`,
`metadata.offer`, `preferredShoppingUrl`, `merchantUrl`, optional
`shoppingSelection.configuredBuyingUrl`). Phase 7 **projects** that data.
No new tables. No parallel resolver.

Prices, availability, and currencies are shown only when they already sit on
that same stored row (or the primary offer/column whose URL matches). A primary
price is never copied onto another merchant.

---

## 2. Click authority

`ShoppingResolver` remains the only catalogue destination picker.

- No `offerId` (Collection / Search / Creator): existing precedence.
- With `offerId`: the id must match a stored destination. Unknown id → no URL.
  If the stored URL is the default winner, default precedence (including affiliate)
  still applies.

Share-imported products never go through ShoppingResolver. Their Buy CTA is
emitted only when a stored HTTP destination already exists. The client never
sends or builds a merchant URL.

---

## 3. What this phase does not do

- Reviews ingest
- Related Reel ranking
- Compare
- Search redesign
- Automatic catalogue promotion
- Freshness timestamps on the Product Page (`lastVerifiedAt` stays internal)
