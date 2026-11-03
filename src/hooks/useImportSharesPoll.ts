import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { fetchShareHistory } from '@/src/services/shareReviewApi';
import { mergeShareHistory } from '@/src/ui/shareHistory';

import { useAuth } from '@/contexts/AuthContext';
import { createImportSharePoller, importResultsChanged, IMPORT_SHARE_POLL_MS } from '@/src/hooks/importSharePoll';
import type { ImportShare } from '@/src/services/importShareMap';
import { fetchImportShares } from '@/src/services/userImportApi';
import { bagHasInFlightShares } from '@/src/ui/bag';

export { IMPORT_SHARE_POLL_MS } from '@/src/hooks/importSharePoll';

export function sharesBecameReady(previous: ImportShare[], next: ImportShare[]): boolean {
  const prevById = new Map(previous.map((share) => [share.importId, share.state]));
  return next.some((share) => prevById.get(share.importId) === 'looking' && share.state === 'ready');
}

type Options = {
  history?: boolean;
  /** Called when a share transitions looking → ready (e.g. refresh Bag). */
  onBecameReady?: () => void;
  enabled?: boolean;
};

/**
 * Polls GET /imports while focused and any share is looking.
 * A refresh that discovers a new looking share arms the same timer, so a
 * submit on an already-open Search screen keeps updating until the share ends.
 */
export function useImportSharesPoll(options: Options = {}) {
  const { user } = useAuth();
  const enabled = options.enabled !== false;
  const onBecameReady = options.onBecameReady;
  const history = options.history === true;
  const [cursor,setCursor] = useState<string|null>(null);
  const [loadingMore,setLoadingMore] = useState(false);
  const [loadMoreError,setLoadMoreError]=useState<string|null>(null);
  const historyExpanded=useRef(false),cursorRef=useRef<string|null>(null);
  cursorRef.current=cursor;
  const focused = useRef(false), moreBusy = useRef(false);
  const stableTicks=useRef(0);
  const onBecameReadyRef = useRef(onBecameReady);
  onBecameReadyRef.current = onBecameReady;
  const [shares, setShares] = useState<ImportShare[]>([]);
  const [loaded, setLoaded] = useState(false);
  const ownerRef = useRef(user?.id);
  const [dataOwner, setDataOwner] = useState(user?.id);
  const focusedAccountRef = useRef<string | undefined>(undefined);
  ownerRef.current = user?.id;
  const sharesRef = useRef<ImportShare[]>([]);
  const pollerRef = useRef<ReturnType<typeof createImportSharePoller> | null>(null);
  if (!pollerRef.current) {
    pollerRef.current = createImportSharePoller({
      intervalMs: IMPORT_SHARE_POLL_MS,
      schedule: (callback, ms) => setTimeout(callback, ms),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
  }
  const poller = pollerRef.current;

  const refresh = useCallback(async (resetHistory=false): Promise<boolean> => {
    if (!user || !enabled) {
      poller.blur();
      sharesRef.current = [];
      setShares([]);
      setLoaded(false);
      return false;
    }
    const accountId = user.id;
    const gen = poller.beginFetch();
    try {
      const page = history ? await fetchShareHistory() : null;
      const head = page ? page.shares : await fetchImportShares();
      const next = page && historyExpanded.current && !resetHistory ? mergeShareHistory(sharesRef.current,head) : head;
      if (ownerRef.current !== accountId) return false;
      const inFlight = bagHasInFlightShares(next);
      if (poller.finishFetch(gen, inFlight) === 'ignore') {
        return bagHasInFlightShares(sharesRef.current);
      }
      if (sharesBecameReady(sharesRef.current, next) || importResultsChanged(sharesRef.current, next)) {
        onBecameReadyRef.current?.();
      }
      setDataOwner(accountId);
      if(page && (!historyExpanded.current || resetHistory)){setCursor(page.nextCursor);cursorRef.current=page.nextCursor;historyExpanded.current=false;}
      if(resetHistory)setLoadMoreError(null);
      if(history){
        stableTicks.current=importResultsChanged(sharesRef.current,next)?0:stableTicks.current+1;
        poller.setIntervalMs([1500,3000,5000,10000][Math.min(3,stableTicks.current)]);
      }
      sharesRef.current = next;
      setShares(next);
      setLoaded(true);
      return inFlight;
    } catch {
      const inFlight = bagHasInFlightShares(sharesRef.current);
      if (poller.finishFetch(gen, inFlight) === 'ignore') return inFlight;
      setLoaded(true);
      return inFlight;
    }
  }, [enabled, poller, user, history]);

  const loadMore=useCallback(async()=>{
    if(!history||!cursor||!user||moreBusy.current)return;
    moreBusy.current=true;setLoadingMore(true);const owner=user.id;
    setLoadMoreError(null);
    try{
      const page=await fetchShareHistory(cursor);
      if(ownerRef.current!==owner||cursorRef.current!==cursor)return;
      const next=mergeShareHistory(sharesRef.current,page.shares,true);
      historyExpanded.current=true;sharesRef.current=next;setShares(next);setCursor(page.nextCursor);cursorRef.current=page.nextCursor;
    }catch{if(ownerRef.current===owner)setLoadMoreError('Could not load more shares. Please try again.');}
    finally{moreBusy.current=false;setLoadingMore(false);}
  },[cursor,history,user]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  poller.setOnTick(() => {
    void refreshRef.current();
  });

  useFocusEffect(
    useCallback(() => {
      if (!user || !enabled) {
        poller.blur();
        sharesRef.current = [];
        setShares([]);
        setLoaded(false);
        setCursor(null);cursorRef.current=null;historyExpanded.current=false;setLoadMoreError(null);
        return undefined;
      }
      if (focusedAccountRef.current !== user.id) {
        poller.blur();
        focusedAccountRef.current = user.id;
        sharesRef.current = [];
        setShares([]);
        setDataOwner(user.id);
        setLoaded(false);
        setCursor(null);cursorRef.current=null;historyExpanded.current=false;setLoadMoreError(null);
      }
      focused.current=true;
      const subscription=AppState.addEventListener('change',state=>{
        if(state!=='active')poller.blur();
        else if(focused.current){poller.focus();void refresh();}
      });
      if(AppState.currentState==='active'){poller.focus();void refresh();}
      else poller.blur();
      return () => {
        focused.current=false;subscription.remove();
        poller.blur();
      };
    }, [enabled, poller, refresh, user]),
  );

  return { shares: dataOwner === user?.id ? shares : [], loaded: dataOwner === user?.id && loaded, refresh, loadMore,
    hasMore: dataOwner === user?.id && cursor!==null,loadingMore,loadMoreError };
}
