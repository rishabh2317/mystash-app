/** No-op enrichment for Phase 1 — PDP enrichment plugs in later. */
export class NoopEnrichmentProvider {
  readonly name = 'noop';
  async enrich(): Promise<null> {
    return null;
  }
}
