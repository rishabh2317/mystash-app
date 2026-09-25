/**
 * Derive Product Page "details still updating" from discovered metadata only.
 * Does not expose enrichmentStatus to clients.
 */
export function detailsUpdatingFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return metadata.enrichmentStatus === 'pending';
}
