import type { FindSourceSummary } from '@/src/services/findClient';

export type SourceCollageSlot = { image: string | null; position: number; more: number };
/** Counts are authoritative distinct saved memberships, including missing images. */
export function sourceCollageSlots(source: FindSourceSummary): SourceCollageSlot[] {
  const count = source.savedProducts + source.savedPlaces;
  const visible = Math.min(4,count);
  return Array.from({length:visible},(_,position)=>({
    image: source.images[position] ?? null,
    position,
    more: count>4 && position===3 ? count-3 : 0,
  }));
}
