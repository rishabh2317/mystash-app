# GPT-6 Luna local experiment

Implemented 12 November 2026. Local source only; no Render changes, APK build,
database migration, agent, new provider call or extraction stage.

## Configuration

The four active workloads use `gpt-6-luna` with `reasoning_effort: low`:

- Object detection: `OPENAI_VISION_MODEL`.
- Scene/activity classification: `OPENAI_VISION_MODEL`.
- Product/place reasoning: `OPENAI_REASONER_MODEL`.
- Merchant-page parsing after the existing Tavily fallback: `OPENAI_MERCHANT_MODEL`.

Reasoner and merchant defaults are independently `gpt-6-luna`; vision defaults to
the resolved reasoner model. Explicit per-workload overrides still win.
`OPENAI_MODEL` no longer overrides these active workloads: it remains unchanged
for excluded legacy code. This prevents an existing `OPENAI_MODEL=gpt-4o-mini`
local environment from silently disabling the requested experiment.

The existing `backend/.env` does not need a secret or credential change. Restart
the local API/workers to load configuration. Do not change Render yet.

For a baseline comparison, start the same local command with these environment
overrides (no prompt/validation changes):

```sh
OPENAI_REASONER_MODEL=gpt-4o-mini OPENAI_VISION_MODEL=gpt-4o-mini OPENAI_MERCHANT_MODEL=gpt-4o-mini npm run dev
```

Run from `backend/`. Apply the same overrides to the local worker command when
workers run separately. Embeddings remain controlled by their unchanged factory;
this upgrade does not enable the disabled OpenAI embedding provider.

## API compatibility

Chat Completions and `response_format: {type: 'json_object'}` are preserved.
All system/user prompts, image detail/frame caps, validation, resolution,
timeouts and retry policies remain unchanged.

For Luna only, requests use `reasoning_effort: low`, omit unsupported temperature,
and use `max_completion_tokens`. Explicit `gpt-4o-mini` overrides retain the old
temperature and `max_tokens` behavior. Other arbitrary model overrides have not
been certified by this change; the helper is not a general model router.

Existing numeric limits are preserved: vision 2000, scene 800, reasoner 4096,
merchant 600. Luna's limit includes reasoning **and** visible output. A small
budget can finish with `length`, empty output or incomplete JSON. Those results
follow the existing parse/degradation behavior; there is no new repair call or
automatic model fallback. Inspect `finishReason` during the initial experiment
before separately deciding whether any budget needs adjustment.

References verified for this change:

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create

## Usage comparison

Each completed active model call emits an `openai.usage` structured log event:
`integration`, `requestedModel`, actual returned `model`, `reasoningEffort`,
`promptTokens`, `completionTokens`, `reasoningTokens`, `cachedTokens`,
`totalTokens`, `finishReason`, `durationMs` and opaque source/trace IDs.
Missing usage stays absent rather than being reported as zero.

Reasoning tokens are already included in completion/output tokens; do not add
them again. Vision, scene and reasoner provider metadata carry the same usage.
The existing creator reasoner-stage artifact stores the additional token fields
inside its existing JSON column. The structured log also captures the calls whose
usage was previously discarded by composite media or the image/merchant adapters.
No prompts, image data, merchant text, completion text or URLs are included in
the new telemetry. Private-image filtering permits only bounded operational
model fields and numeric token counts for this event.

The old blended `gpt-4o-mini` estimate is not used for Luna (cost is null).
This experiment records actual token counts, not a complete dollar-cost ledger.
Usage from failed requests is unavailable when the API does not return it.

## Cache and testing limits

The automatic extraction provider version now includes reasoner/vision models
and Luna effort so default cache namespaces differ between Luna and mini. A
manually pinned `PROVIDER_VERSION` still takes precedence; remove an old fixed
override locally for comparisons. Existing source-result and merchant caches
still bypass model calls on hits. Use fresh uncached inputs for model comparison;
no historical sources are reprocessed or deleted by this change.

Offline regression tests mock SDK transport, including all four existing call
sites, original prompts/JSON contracts, mini overrides, usage/model reporting,
private-image redaction, empty frames and truncated output. They do not measure
Luna accuracy, actual latency, account access or live provider availability.
No paid generation requests are needed for those tests.
