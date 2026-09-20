export type ImportShareState = 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';

export type ImportShare = {
  importId: string;
  state: ImportShareState;
  kind: 'instagram' | 'youtube' | 'web';
};

function asShareState(value: unknown): ImportShareState | null {
  if (
    value === 'looking' ||
    value === 'ready' ||
    value === 'nothing_yet' ||
    value === 'couldnt_finish'
  ) {
    return value;
  }
  return null;
}

function asShareKind(value: unknown): ImportShare['kind'] {
  if (value === 'instagram' || value === 'youtube' || value === 'web') return value;
  return 'web';
}

export function hydrateImportShares(raw: unknown): ImportShare[] {
  if (!Array.isArray(raw)) return [];
  const shares: ImportShare[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const importId = typeof row.importId === 'string' ? row.importId : null;
    const state = asShareState(row.state);
    if (!importId || !state) continue;
    shares.push({ importId, state, kind: asShareKind(row.kind) });
  }
  return shares;
}
