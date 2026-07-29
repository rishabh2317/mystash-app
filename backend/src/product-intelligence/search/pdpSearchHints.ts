import { AsyncLocalStorage } from 'node:async_hooks';
import type { PdpRankHints } from './PdpRanker';

/** Per-draft AI hints for PDP ranking (set around ProductResolver.resolveIngest). */
export const pdpSearchHintsAls = new AsyncLocalStorage<PdpRankHints>();

export function getPdpSearchHints(): PdpRankHints {
  return pdpSearchHintsAls.getStore() ?? {};
}
