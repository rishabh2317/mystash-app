import type { ContentSourcePlaceRecord, UserPlaceSaveRecord } from './domain/types';

const LOCATION_FIELDS = ['locality', 'city', 'region', 'country', 'mentionedAddress'] as const;
function fold(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
function evidenceAnchors(row: ContentSourcePlaceRecord): Set<string> {
  const summary = typeof row.evidence.summary === 'string' ? row.evidence.summary : '';
  const name = fold(row.extractedName);
  const anchors = [...summary.matchAll(/['"“]([^'"”]{6,200})['"”]/g)].map(m => fold(m[1]));
  // Identical grounded summaries also support providers that omit quotation marks.
  if (fold(summary).includes(name)) anchors.push(fold(summary));
  return new Set(anchors.filter(anchor => anchor.includes(name)));
}

/** Reversible presentation only. Never changes hypotheses, saves, or canonical identity.
 * Require the same source, exact name/category, grounded shared evidence, and one
 * unambiguous location refinement. Sparse mentions cannot bridge two branches. */
export function placePresentationGroups(
  saves: UserPlaceSaveRecord[], hypotheses: ContentSourcePlaceRecord[],
): Map<string, string> {
  const byId = new Map(hypotheses.map(h => [h.id, h]));
  const clusters = new Map<string, { save: UserPlaceSaveRecord; hypothesis: ContentSourcePlaceRecord }[]>();
  for (const save of saves) {
    const hypothesis = byId.get(save.contentSourcePlaceId);
    if (save.placeId || !hypothesis || hypothesis.resolutionState !== 'unresolved') continue;
    if (!fold(hypothesis.city) || !fold(hypothesis.country)) continue;
    const key = JSON.stringify([save.userId, save.contentSourceId, fold(hypothesis.extractedName), fold(hypothesis.category)]);
    const cluster = clusters.get(key) ?? [];
    cluster.push({ save, hypothesis }); clusters.set(key, cluster);
  }
  const groups = new Map<string, string>();
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    let compatible = true;
    for (let i = 0; i < cluster.length && compatible; i++) for (let j = i + 1; j < cluster.length; j++) {
      const a = cluster[i].hypothesis, b = cluster[j].hypothesis;
      if (LOCATION_FIELDS.some(field => fold(a[field]) && fold(b[field]) && fold(a[field]) !== fold(b[field]))) {
        compatible = false; break;
      }
      const anchors = evidenceAnchors(a);
      if (![...evidenceAnchors(b)].some(anchor => anchors.has(anchor))) { compatible = false; break; }
    }
    if (!compatible) continue;
    const specificity = (row: ContentSourcePlaceRecord) => LOCATION_FIELDS.filter(field => fold(row[field])).length;
    if (new Set(cluster.map(row => specificity(row.hypothesis))).size < 2) continue;
    const stable = [...cluster].sort((a, b) => a.save.createdAt.localeCompare(b.save.createdAt) || a.save.id.localeCompare(b.save.id))[0];
    for (const { save } of cluster) groups.set(save.id, stable.save.id);
  }
  return groups;
}
