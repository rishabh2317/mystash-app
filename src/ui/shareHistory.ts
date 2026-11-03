import type { ImportShare } from '@/src/services/importShareMap';
/** Stable cursor history: head polling must not discard already loaded older pages. */
export function mergeShareHistory(existing: ImportShare[], incoming: ImportShare[], preferExisting = false): ImportShare[] {
  const rows = preferExisting ? [...incoming,...existing] : [...existing,...incoming];
  return [...new Map(rows.map(row=>[row.importId,row])).values()].sort((a,b)=>
    b.createdAt.localeCompare(a.createdAt) || b.importId.localeCompare(a.importId));
}
