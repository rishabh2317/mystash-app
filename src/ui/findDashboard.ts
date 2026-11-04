import type { FindItem, FindScreenDetail } from '@/src/services/findClient';

/** Prefer active work even when it is older than the current history page. */
export function selectFindActivity(activeItems:FindItem[],historyItems:FindItem[],completedItems:FindItem[],preferAttention=false):FindItem|null {
  const attention=historyItems.find(item=>item.outcome.category==='attention');
  if(preferAttention && attention)return attention;
  const active=[...activeItems,...historyItems].find(item=>item.outcome.extractionActive || item.outcome.stashSync==='pending');
  if(active)return active;
  const completed=completedItems[0] ?? historyItems.find(item=>item.outcome.category==='completed');
  return completed ?? attention ?? null;
}
export function findActivityExpanded(item:FindItem,choice:{id:string;expanded:boolean}|null):boolean {
  return choice?.id===item.id?choice.expanded:item.outcome.extractionActive||item.outcome.stashSync==='pending'||item.outcome.category==='attention';
}

export type FindActivityPreview = { key:string; kind:'product'|'place'; title:string; imageUrl:string|null; note:string };
/** Detail is owner-authorized by the API. Show distinct identified results, never guessed identities. */
export function findActivityPreviews(detail:FindScreenDetail):FindActivityPreview[] {
  const products:FindActivityPreview[]=[], places:FindActivityPreview[]=[], identities=new Set<string>();
  for(const row of detail.products){
    if(!row.identityKey||identities.has(row.identityKey))continue;
    identities.add(row.identityKey);
    products.push({key:`product:${row.id}`,kind:'product',title:row.title,imageUrl:row.imageUrl,
      note:row.saved?'In My Stash':row.removed?'Removed from My Stash':'Found product'});
    if(products.length>=3)break;
  }
  for(const row of detail.savedSuggestions){
    if(products.length>=3)break;
    if(identities.has(row.identityKey))continue;
    identities.add(row.identityKey);
    products.push({key:`selected:${row.sourceProductId}:${row.candidateKey}`,kind:'product',title:row.title,imageUrl:row.imageUrl,
      note:row.saved?'In My Stash':row.removed?'Removed from My Stash':'Found product'});
  }
  const placeKeys=new Set<string>();
  for(const row of detail.places){
    const key=row.placeId??row.id;
    if(placeKeys.has(key))continue;
    placeKeys.add(key);
    places.push({key:`place:${row.id}`,kind:'place',title:row.name,imageUrl:null,
      note:row.saved?'In My Stash':row.removed?'Removed from My Stash':row.resolution==='resolved'?'Place found':'Place to explore'});
    if(places.length>=3)break;
  }
  if(!products.length)return places.slice(0,3);
  if(!places.length)return products.slice(0,3);
  return [...products.slice(0,2),...places.slice(0,3-Math.min(products.length,2))];
}

export function findActivityRevision(item:FindItem):string {
  const o=item.outcome;
  return [o.foundProducts,o.foundPlaces,o.savedProducts,o.savedPlaces,o.result,o.stashSync,o.finishedAt].join(':');
}

export function findActivityProgress(item:FindItem):string[] {
  const label=(kind:'Products'|'Places',state:FindItem['outcome']['products'],count:number)=>
    state==='running'?`${kind}: ${count?`${count} found, still looking`:'looking'}`:state==='failed'?`${kind}: needs attention`:state==='unknown'?`${kind}: unavailable`:
      `${kind}: ${count?`${count} found`:'checked'}`;
  return [label('Products',item.outcome.products,item.outcome.foundProducts),
    label('Places',item.outcome.places,item.outcome.foundPlaces)];
}
