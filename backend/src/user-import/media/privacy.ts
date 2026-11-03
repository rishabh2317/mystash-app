import { AsyncLocalStorage } from 'node:async_hooks';
import type {SearchCandidateCache} from '../../product-intelligence/interfaces/CatalogRepository';
/** This scope never leaves the existing leased worker's async chain. */
export const privateImageContext = new AsyncLocalStorage<boolean>();
export function imageSafeSearchCache(cache:SearchCandidateCache):SearchCandidateCache{
  return{get:(query,provider)=>privateImageContext.getStore()?Promise.resolve(null):cache.get(query,provider),
    set:(query,provider,candidates,ttl)=>privateImageContext.getStore()?Promise.resolve():cache.set(query,provider,candidates,ttl)};
}
export function privateImageLogFields<T extends Record<string,unknown>>(fields:T):Record<string,unknown>{
  if(!privateImageContext.getStore())return fields;
  return Object.fromEntries(Object.entries(fields).filter(([key,value])=>
    ['svc','event','domain','contentSourceId','userImportId','jobId','traceId','ingestId','draftId','mediaKind','platform','processingStatus','retryable','cacheHit'].includes(key)
    || (typeof value==='number' && /Count$|Ms$|^kept$|^discarded$|^resolved$|^leads$/.test(key))));
}
