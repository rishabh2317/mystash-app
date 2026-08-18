/** Whether ProductResolver still needs to run for an ingest draft row. */
export function ingestDraftNeedsProductResolve(row: {
  catalogProductId?: string | null;
  resolutionStatus?: string | null;
}): boolean {
  const status = row.resolutionStatus ?? null;
  if (
    (status === 'VERIFIED' || status === 'UNVERIFIED') &&
    typeof row.catalogProductId === 'string' &&
    row.catalogProductId.length > 0
  ) {
    return false;
  }
  return true;
}
