# Universal Find video evidence improvements — local implementation report

Implemented 11 November 2026 on `codex/share-v2-pilot`, starting HEAD `517618b`.
No commit, deployment, feature activation, migration application, application-data write, historical reprocessing or APK build was performed. No dependencies or native changes were added.

## Implementation

Merchant-only identity comparison recognizes UNIQLO's E484402-000 route as SKU 484402 and Levi's/Levis as Levi on the exact manufacturer domain. Manufacturer locale/category routing and eBay's numeric item route do not become foreign brands. Actual shopping URLs are never rewritten. Known different manufacturer SKUs remain conflicts. The image/enrichment identity gate is unchanged; regression tests explicitly assert its old comparison outputs.

The original image query remains byte-for-byte unchanged. A separate shopping query reserves brand/model tokens before descriptive tokens. Only a query that lost identity tokens can add a bounded manufacturer lookup plus the existing regional Amazon lookup; other existing discovery budgets remain unchanged. The two observed manufacturers use explicit, bounded official-domain lookup hints.

Find videos use an enhanced GPT-4o-mini visual prompt and a Find-specific reasoning appendix. Create and private-image prompts retain their existing paths. Model/provider selection, sampling, frame limits, image detail, image processing, image enrichment and hero/gallery selection are unchanged. The visual schema separates observed type/colour/apparent material/fit/style/literal identifiers from uncertainty. Unknown values and invented frame references are not promoted into facts. People are not treated as product attribute observations.

Find-only preparation preserves literal source-text claims and observed frame facts separately, normalizes field labels such as ID 484402 only when the identifier is explicitly present, corrects unsupported jeans classifications using linked jacket evidence, and keeps ambiguous clothing generic. A brand-only title cannot establish an unseen garment type. A merely generic Stage 1 hypothesis does not suppress the existing frame stage; once visual evidence is acquired, existing stage limits/gates apply. This can increase calls for generic titles that previously stopped after text; no latency/cost saving is asserted.

Progressive stages retain prior supported hypotheses and merge attribute/stage provenance for the same identity. Different model/variant hypotheses stay separate. Existing candidate caps remain. Explicit same-line venue locality is copied from source text, without guessing geography or using shopping country. Rejection counters, evidence version, actual reasoning model and token usage are logged without new source text, URLs, account identifiers or credentials.

Generic visual/fashion leads are marked possible and blocked from both product binding and automatic fan-out. Named model hypotheses remain useful when merchant confirmation fails. Existing eligible confirmed products continue to bind and automatically save. Possible/style candidates use the existing owner-scoped, leased, atomic Save/Dismiss flow. No new ingestion, review queue, persistence table or mandatory review was introduced. Existing suggestion feature gating and private-image exclusion are retained.

Possible-style discovery reuses independently established catalogue/page candidates; raw discovery rank is not verification. For generic garments, a type filter precedes the existing 20-row catalogue limit. Type/colour contradictions, unsafe URLs and duplicate candidate identities are excluded. Up to three choices are labeled Possible match or Similar styles; non-garment suggestions retain their existing stricter behavior.

Find detail labels Exact match, Possible match, and Similar styles. Alternatives state that they are not confirmed in the video. Unbound hypotheses have no automatic membership or fabricated product-detail/Buy identity. Confirmed, possible, saved-suggestion and available-style counts are separate. In particular the existing outcome.foundProducts contract includes accepted suggestions, so it is NOT relabeled as a confirmed count: confirmed counts come from the complete detail's exact identity projection. Existing global counts, completion/progress/notification semantics, retries and recovery contracts are unchanged.

## Evidence and measurements

Historical case A is whiDdYRALIU; case B is ypyRj59jp9o. Sanitized recordings contain public source facts/final hypotheses, not account identifiers, private creator details, signed URLs or media bytes. Historical intermediate vision output was not retained. Human-observation fixture inputs are explicitly distinguished from recorded model output.

Case A originally took 18.945 seconds end to end and retained Levi's Jeans without a usable product binding. A bounded fresh replay of its existing five frames produced a Denim Jacket hypothesis, no model, and possible status. The final structured vision call additionally returned blue colour and denim appearance, without brand/fit confirmation. Deterministic ambiguity/negative cases prohibit inferring unseen jeans.

Case B originally took 22.369 seconds and extracted 484402/A57820104, but both recorded official merchant candidates failed qualification. They now qualify as DISCOVERY_VERIFIED, never PAGE_VERIFIED. Full in-memory service tests bind and automatically save each through the existing resolution and Stash service, without introducing a product image. Fresh model output retained both identities; its ID prefixes are removed by a recorded-response regression test.

Fresh query measurements: UNIQLO general SKU query 1.801 s, Levi general SKU query 4.148 s, exact Levi manufacturer lookup 2.389 s. The UNIQLO query yielded four independently discovery-qualified official hits. The general Levi query yielded no qualified exact offer; its official-domain lookup yielded nine qualified locale hits for the exact SKU. These are URLs/results, not nine distinct products or merchants. No merchant page was fetched and no stock, price or checkout claim is made.

OpenAI sample durations: initial visual call 5.779 s; case A reasoning 3.336 s; case B reasoning 4.596 s; final explicit-schema visual call 6.464 s. All returned model gpt-4o-mini-2024-07-18. Verification used FOUR OpenAI calls and THREE Serper requests, with SDK retries disabled. Total recorded usage was 31,514 input / 1,319 output tokens, approximately USD 0.00552 at published USD 0.15/M input and USD 0.60/M output rates, excluding Serper/account-specific billing. Pricing source: https://developers.openai.com/api/docs/models/gpt-4o-mini .

These samples are NOT a full before/after pipeline benchmark. Stored frames were reused; historical OCR/scene facts were unavailable; case B text was reduced to its explicit product facts. Download, FFmpeg, Google Vision, live persistence and device behavior were not replayed against production. There is no measured aggregate precision/recall, p50/p95 or production cost-per-capture claim. Deterministic staged replays preserve the two historical paths' logical reasoning/media counts (2/1 for A; 1/0 for B).

## Verification

Client and backend TypeScript pass. Focused lint has 0 errors and 2 existing array-style warnings. Across 90 backend test files: 632/633 tests pass, with the sole baseline failure described below and no skips. Client tests: 29/29 pass. Find render/interaction checks: 1,609 pass across two themes, two platform adapters and 320/360/390/414/430 px widths, including large-font adaptation. Places/Create/Profile/Watch render checks: 76 pass. Share render checks: 64 pass. Render adapters do not establish native-device acceptance. Tracked-diff whitespace checks pass. The absolute 32-case hero/gallery/image-call golden remains unchanged and passes. Focused service tests cover automatic exact saving, possible-lead non-saving, explicit suggestion saving, lease receipt replay, mismatched identities, unsafe destinations, retained evidence, locality, frame provenance and ambiguity.

The previously documented ContentSourceService boundary assertion remains a baseline failure: it rejects catalog/discovered-table references used by the existing repository image projection. Its test and implementation were not modified. The separate stale prompt source-text assertion was corrected to recognize the existing injected provider argument and run independently of cwd; its behavior assertions remain.

## Review / QA limitations and remaining work

No service restart or new native/device test was performed. The existing local API plist has SHARE_SUGGESTIONS_ENABLED=true and SHARE_INTENT_ENABLED=true; these settings were read, not changed. Standalone .env does not supply them, so other environments still need the existing feature configuration.

No historical empty capture is automatically refreshed. Existing terminal empty captures retain their current retry contract; a separately approved scoped replay is needed to change their persisted outcomes. New video extraction cache entries use a Find-only context revision; Creator cache keys remain unchanged.

Catalogue alternatives remain bounded and may be unavailable if no independently established candidate exists. A generic hypothesis without an eligible candidate remains visible without a fabricated shopping link. No new public-web alternative search, guessed brand/SKU, arbitrary stock image, place-photo provider integration or relaxed merchant verification was added.

Pending P1: broader evaluated alternative coverage, improved structured place-photo provenance/attribution and correctly licensed venue imagery. Pending P2: larger held-out fashion/place evaluation and confidence calibration, full pipeline latency/cost measurement, optional audio/targeted crop/model comparisons and prompt lifecycle evaluation. The configured model worked during verification; official documentation labels it deprecated, so lifecycle planning should precede a later model change. None of that changes the selected model in this patch.

## Exact task files

The following 34 implementation/test files were created or changed by this task; this report is the 35th. Other existing dirty work remains outside this task.

- `backend/src/config/pipelineConfig.ts`
- `backend/src/domain/types.ts`
- `backend/src/prompts/productReasoner.ts`
- `backend/src/prompts/productReasoner.test.ts`
- `backend/src/providers/reasoner/OpenAiReasonerProvider.ts`
- `backend/src/providers/vision/OpenAiVisionProvider.ts`
- `backend/src/products/ProductValidator.ts`
- `backend/src/stages/progressiveExtract.ts`
- `backend/src/stages/findEvidence.ts`
- `backend/src/stages/findEvidence.test.ts`
- `backend/src/stages/testing/denimRecordings.json`
- `backend/src/stages/testing/denimFreshResponses.json`
- `backend/src/product-intelligence/interfaces/ProductSearchProvider.ts`
- `backend/src/product-intelligence/resolver/ProductResolver.ts`
- `backend/src/product-intelligence/search/ProductSearchQueryBuilder.ts`
- `backend/src/product-intelligence/search/TavilyEnrichedPdpSearchStrategy.ts`
- `backend/src/product-intelligence/verification/merchantIdentity.ts`
- `backend/src/product-intelligence/verification/merchantEvidence.ts`
- `backend/src/product-intelligence/verification/denimIdentity.test.ts`
- `backend/src/content-source/processing/userAttachPolicy.ts`
- `backend/src/content-source/processing/ContentSourceResolutionService.ts`
- `backend/src/content-source/processing/ContentSourceResolutionService.test.ts`
- `backend/src/user-import/find/contract.ts`
- `backend/src/user-import/share/similarity.ts`
- `backend/src/user-import/share/assessment.ts`
- `backend/src/user-import/share/findMatches.ts`
- `backend/src/user-import/share/findMatches.test.ts`
- `backend/src/user-import/share/reviewService.ts`
- `backend/src/user-import/share/reviewService.test.ts`
- `src/services/shareReviewApi.ts`
- `src/ui/findDetail.ts`
- `src/ui/findDetailPresentation.test.ts`
- `components/find/FindDetailView.tsx`
- `scripts/check-find-ui.cjs`
