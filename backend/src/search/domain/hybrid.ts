import type { HybridCandidate, LexicalCandidate, VectorCandidate } from '../ports';

/**
 * Reciprocal Rank Fusion over lexical + vector candidate lists.
 * Score-scale agnostic; Mystash may still re-rank afterward.
 */
export function fuseHybridCandidates(
  lexical: LexicalCandidate[],
  vector: VectorCandidate[],
  opts?: { k?: number; lexicalWeight?: number; vectorWeight?: number },
): HybridCandidate[] {
  const k = opts?.k ?? 60;
  const lw = opts?.lexicalWeight ?? 1;
  const vw = opts?.vectorWeight ?? 1;
  const map = new Map<string, HybridCandidate>();

  lexical.forEach((c, i) => {
    const key = `${c.entityType}:${c.id}`;
    const rrf = lw / (k + i + 1);
    const existing = map.get(key);
    if (existing) {
      existing.lexicalScore = Math.max(existing.lexicalScore, c.score);
      existing.fusionScore += rrf;
    } else {
      map.set(key, {
        entityType: c.entityType,
        id: c.id,
        lexicalScore: c.score,
        vectorScore: 0,
        fusionScore: rrf,
        document: c.document,
      });
    }
  });

  vector.forEach((c, i) => {
    const key = `${c.entityType}:${c.id}`;
    const rrf = vw / (k + i + 1);
    const existing = map.get(key);
    if (existing) {
      existing.vectorScore = Math.max(existing.vectorScore, c.score);
      existing.fusionScore += rrf;
      // prefer fresher doc snapshot if present
      existing.document = c.document;
    } else {
      map.set(key, {
        entityType: c.entityType,
        id: c.id,
        lexicalScore: 0,
        vectorScore: c.score,
        fusionScore: rrf,
        document: c.document,
      });
    }
  });

  return [...map.values()].sort((a, b) => b.fusionScore - a.fusionScore);
}
