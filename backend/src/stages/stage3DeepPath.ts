/**
 * Stage 3 — incremental frames (max 10 total), reuse prior MU, review_required if empty.
 * Implemented inside `orchestrator.ts` when Stage 2 gate fails.
 */
export { stagePass as stage3Gate } from './gate';
