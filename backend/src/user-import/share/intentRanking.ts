import type { ShareIntent } from './contracts';
/** Presentation only. Never feed private intent into shared extraction or identity. */
export function rankForIntent<T>(items: readonly T[], intent: ShareIntent, text: (item:T)=>string): T[] {
  const words=[...new Set((intent.note??'').toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])].slice(0,40);
  return items.map((item,index)=>({item,index,score:words.filter(w=>text(item).toLocaleLowerCase().includes(w)).length}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.item);
}
