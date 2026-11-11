import { foldPlace, isGeographyOnly } from './placeClassification';
import type { ExtractedPlaceMention } from './parseReasonerPayload';

/** Address normalization is deliberately conservative; never fuzzy-match venue names. */
export function normalizedPlaceAddress(value: string | null | undefined): string {
  const words: Record<string,string> = { rd:'road',st:'street',ave:'avenue',av:'avenue',blvd:'boulevard',apt:'apartment',no:'number' };
  const tokens=foldPlace(value?.replace(/(?:\b[A-Za-z]\.){2,}/g,s=>s.replace(/\./g,''))).split(' ').filter(Boolean).map(w => words[w] ?? w);
  const numbers=tokens.filter(w=>/\d/.test(w));
  return [...new Set(tokens)].sort().join(' ')+(numbers.length>1?` | ${numbers.join(' ')}`:'');
}
export type PlaceMentionIdentity = { name: string; category?:string|null; locality?:string|null;city?:string|null;region?:string|null;country?:string|null;mentionedAddress?:string|null;evidence?:Record<string,unknown> };
function names(row: PlaceMentionIdentity): string[] {
  const aliases = Array.isArray(row.evidence?.aliases) ? row.evidence.aliases.filter((s):s is string=>typeof s==='string') : [];
  return [row.name,...aliases].map(foldPlace);
}
export function samePlaceMention(a: PlaceMentionIdentity,b: PlaceMentionIdentity): boolean {
  if (!names(a).some(n=>names(b).includes(n))) return false;
  if(a.category&&b.category&&foldPlace(a.category)!==foldPlace(b.category))return false;
  const branchA=typeof a.evidence?.branch==='string'?foldPlace(a.evidence.branch):'';
  const branchB=typeof b.evidence?.branch==='string'?foldPlace(b.evidence.branch):'';
  if(branchA&&branchB&&branchA!==branchB)return false;
  for (const key of ['locality','city','region','country'] as const) {
    const alias=(row:PlaceMentionIdentity,value:string)=>{
      const map=row.evidence?.locationAliases as Record<string,unknown>|undefined;
      return map && Array.isArray(map[key]) && (map[key] as unknown[]).some(v=>typeof v==='string'&&foldPlace(v)===foldPlace(value));
    };
    if (a[key] && b[key] && foldPlace(a[key])!==foldPlace(b[key]) && !alias(a,b[key]!) && !alias(b,a[key]!)) return false;
  }
  const left=normalizedPlaceAddress(a.mentionedAddress),right=normalizedPlaceAddress(b.mentionedAddress);
  // A matching name/city alone cannot identify a branch. A full compatible address can.
  if (left && right) return left===right && /\b\d{1,4}[a-z]?\b/.test(left) && /[\p{L}]/u.test(left);
  const exact = ['name','locality','city','region','country','mentionedAddress'].every(key=>foldPlace(a[key as keyof PlaceMentionIdentity] as string)===foldPlace(b[key as keyof PlaceMentionIdentity] as string));
  const anchor=a.evidence?.summary;
  return exact && !!a.locality && typeof anchor==='string' && anchor.length>10 && anchor===b.evidence?.summary;
}
export function dedupePlaceMentions(rows: ExtractedPlaceMention[]): ExtractedPlaceMention[] {
  const out:ExtractedPlaceMention[]=[];
  for(const row of rows) {
    if(isGeographyOnly(row))continue;
    const exactKey=(r:ExtractedPlaceMention)=>JSON.stringify([r.name,r.locality,r.city,r.region,r.country,r.mentionedAddress,r.category,r.evidence.summary,r.evidence.branch].map(v=>typeof v==='string'?foldPlace(v):v));
    const existing=out.find(old=>samePlaceMention(old,row)||exactKey(old)===exactKey(row));
    if(existing) {existing.sources=[...new Set([...existing.sources,...row.sources])];continue;}
    out.push({...row,sources:[...row.sources]});
  }
  return out;
}
