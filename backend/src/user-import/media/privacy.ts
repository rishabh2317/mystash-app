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
    || (typeof value==='number' && /Count$|Ms$|^kept$|^discarded$|^resolved$|^leads$/.test(key))
    || (fields.event==='openai.usage' && fields.svc==='ingest-pipeline' && (
      (['promptTokens','completionTokens','totalTokens','reasoningTokens','cachedTokens'].includes(key) && typeof value==='number' && Number.isFinite(value) && value>=0)
      || (['model','requestedModel'].includes(key) && typeof value==='string' && /^gpt-[a-zA-Z0-9._-]{1,90}$/.test(value))
      || (key==='integration' && ['vision','scene','reasoner','merchant'].includes(String(value)))
      || (key==='reasoningEffort' && value==='low')
      || (key==='finishReason' && ['stop','length','content_filter','tool_calls','function_call'].includes(String(value)))
    ))));
}
