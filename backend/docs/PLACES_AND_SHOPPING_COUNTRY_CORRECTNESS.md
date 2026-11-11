# Places and shopping-country correctness — local implementation

Implemented 11 November 2026. No production migration, deployment, historical
reprocessing or destructive cleanup has been performed.

## Places

`placeClassification.ts` combines structured reasoner entity kind, source location
fields, provider taxonomy and ICU country display names. It contains no list of
city or country names. Administrative geography is rejected before persistence;
provider administrative results cannot become canonical venues. Landmarks and
named natural destinations remain eligible. Geographic context stays in venue
fields and is never inferred from shopping country.

The existing reasoner call supplies entity kind and source-grounded aliases/branch
evidence; no extra AI call is added. An untyped single-name mention may use one
existing Places lookup to distinguish a venue from administrative geography.

Address normalization handles punctuation, accents, initials and common street
abbreviations. Numeric order is retained when multiple numbers occur. Explicit
branch conflicts, conflicting streets/numbers and incompatible locations block
matching. Full compatible addresses or provider identity support deduplication;
same-name/city-only records do not acquire a shared branch identity. Existing
presentation groups retain all save/source attribution and removal semantics.

Extraction parsing, resolution, fallback persistence, repository boundaries,
Stash projection and Find detail/source-result projection use the same policy.
Historical geographic cards are filtered reversibly where the stored evidence
establishes geography; their rows and memberships are preserved.

## Shopping country and offers

Country precedence is explicit selection, saved profile country (manual/location),
saved device locale, then the configured backend default. Manual selection remains
protected from automatic location changes. Device locale is synchronized through
an optional `shoppingLocale` field on the existing locale endpoint and stored in
`users.extensions`; it does not replace country or language preferences.

Create foreground/queued jobs, Find resolution, Product Pages, live pricing and
redirects use that policy. The client country cache is scoped to the current
account; generations reject late reads and stale permission responses. Product
Pages reload when country/account changes and reject stale page responses.

`countrySuitability.ts` ranks already identity-qualified offers: known local,
explicitly serves the country, unconfirmed international fallback, limited
shipping, explicit exclusions. Merchant-specific marketplace mappings and existing
Product JSON-LD shipping/eligible-region facts provide evidence. A ccTLD alone is
not proof of availability. Existing configured/affiliate precedence is retained.

Extraction, source identity, product identity and images stay shared. Regional
discovery reuses existing search-provider caches, never enriches images and never
calls AI/Tavily. Cached regional offers are revalidated against current product
name/model/specifications before exposure. Offers are saved before their IDs are
shown so redirects can always resolve them. Existing raw affiliate/tracking URLs
win equivalent cached duplicates. No country URL is manufactured or rewritten.

## Cache, latency and cost

The country cache is stored under `metadata.shopping_country_offers`. A service-only
atomic RPC provides a 60-second refresh lease and a six-hour cache for completed
lookups, including empty results. Country writes merge under a row lock. Triggers
preserve newer cache entries when ordinary enrichment replaces metadata; identity
changes invalidate the cache. Concurrent instances cannot both hold the same lease.

- Qualified local offer already present: zero discovery or cache-write calls.
- Missing local offer: one refresh pass, normally one preferred-marketplace query.
  If that yields no qualified local offer, at most one broad regional fallback.
  Existing optional identity-repair base queries retain their original purpose.
- Concurrent same-country requests share work. A negative cache hit adds no search
  request. Existing provider query caches may also avoid a paid network request.
- No additional AI, Tavily or image-enrichment calls in regional refresh.
- Product Page waits up to one second for refresh, then shows valid stored fallbacks
  and uses the existing `detailsUpdating` polling behavior while refresh continues.
- Device-locale synchronization is a settings write when locale changes, not an
  extraction/provider call. Historical Find presentation adds a batched DB read
  for place classification/grouping; it does not call a provider.

Offline measurements: local cached selection was below 1 ms in the focused
fixture; two concurrent missing-local requests shared one simulated discovery
pass. The recorded Create miss fixture increased from four to five search queries
because its regional marketplace returned no result and the bounded broad fallback
was exercised. Image-enrichment count remained unchanged. These are synthetic
measurements, not live-provider latency or billing estimates.

Runtime events `shopping.country_refresh` record duration, refresh passes and zero
AI/Tavily usage. Existing `search.provider.request` / `search.provider.cache_hit`
events distinguish actual search requests from provider-cache reuse.

## Deployment prerequisite — NOT APPLIED

Review and apply `supabase/migrations/20261111150000_shopping_country_offer_cache.sql`
before deploying the backend. It creates exactly:

1. Service-only `shopping_country_offer_cache(text,uuid,text,jsonb,uuid)` RPC.
2. `shopping_preserve_country_offer_cache()` trigger function.
3. `shopping_preserve_catalog_country_cache` and
   `shopping_preserve_discovered_country_cache` BEFORE UPDATE triggers.

No tables/columns are added, and there is no historical data update/delete or
reprocessing operation. Without the migration, refresh fails safely before paid
discovery; existing buying options remain available. Backend product intelligence
and the existing search provider must be configured to enable regional discovery.
Deploy backend/client together for locale synchronization and live country changes.

The SQL was exercised only in a disposable local PostgreSQL cluster by
`backend/scripts/checkShoppingCountryCache.sh`, including service-only permissions,
lease ownership, stale writer rejection, negative caching, country preservation,
ordinary metadata writes and identity invalidation.

## Remaining limitations

- Unknown historical geography without type/location/provider evidence cannot be
  reliably classified from its name alone. It is not guessed or broadly deleted.
- Typographical/alias ambiguity without provider identity or grounded branch
  evidence stays separate. Proper-name spelling corrections are not fuzzy merges.
- Unknown merchants without shipping/market evidence remain fallbacks; live stock
  or delivery eligibility is not guaranteed by an indexed PDP. Existing live-price
  and availability behavior remains in place.
- Historical Find aggregate counts are retained; filtering old cards does not
  rewrite source outcomes or trigger historical extraction.
- Actual provider latency/usage and Android country-switch behavior require live
  acceptance testing after the migration/deployment are separately approved.

## Final local verification

- 387 backend unit/integration/regression tests passed, covering Places, Create/Find
  resolution, country offers, Product Pages, redirect/affiliate selection, user
  preferences, pricing and the existing image-parity golden fixtures.
- 24 client country/Product Page/content-state tests passed.
- 100 existing Places/Create/profile/Watch render checks and 8 account/country-cache
  interaction checks passed. These are offline adapters, not native Android QA.
- Backend and client TypeScript checks passed; focused client lint passed.
- The disposable PostgreSQL integration passed. No production database was used.
