# Product Intelligence & Catalog

Commerce backbone for Mystash. Runs **after** progressive multimodal extraction (Stage 1–3 unchanged).

## Flow

AI drafts → `ProductResolver` → local catalog (prefer VERIFIED) → discovery search (Serper) → PDP rank → **`MerchantEnrichmentService`** (Tavily via `previewProductLink`) → VERIFIED catalog → affiliate → Review → Publish.

## Merchant Enrichment

```
backend/src/product-intelligence/enrichment/
  MerchantEnrichmentService.ts
  MerchantExtractor.ts          # interface (swap Firecrawl/Browserbase later)
  TavilyMerchantExtractor.ts    # reuses manual `previewProductLink`
  MerchantMetadataNormalizer.ts
  MerchantMetadataValidator.ts
```

Manual URL ingest and automatic Serper→PDP both use the same enrichment service / Tavily path.

Serper never populates title/thumbnail/description/price as catalog truth — enrichment does.

Catalog is the **single source of truth** for UI. Serper/Tavily run only during ingest / background enrichment. Review, feed, product list, and search join `catalog_products`. Background jobs update existing catalog rows in place (`CatalogRepository.update`) — they do not create duplicates when `catalog_product_id` is already set.

## Config

See `backend/.env.example` (`SERPER_API_KEY`, `TAVILY_API_KEY`, `PRODUCT_SEARCH_PROVIDER`, `CATALOG_*`).
