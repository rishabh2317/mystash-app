# Legacy extraction path (isolated)

These modules belonged to the pre–multimodal progressive pipeline
(`buildDegradedPlaceholder`, Gemini/unified executor, Google CSE verify).

**They are not imported by production code.** Production ingest is only:

- `POST /ingest` → BullMQ `ingest-pipeline` → `runProgressiveIngestPipeline`

Kept for historical reference. Excluded from TypeScript compile via `tsconfig.json`.
Do not wire these back into `/ingest` or the worker.
