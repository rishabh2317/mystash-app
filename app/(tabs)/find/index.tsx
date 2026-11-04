import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { TopBar } from '@/components/chrome/TopBar';
import { NativePendingShares } from '@/components/search/NativePendingShares';
import { FindCaptureActions } from '@/components/find/FindCaptureActions';
import { FindDashboard } from '@/components/find/FindDashboard';
import { FindNotificationButton } from '@/components/find/FindNotificationButton';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useFindHistory } from '@/src/hooks/useFindHistory';
import { FIND_ROUTES, findDetailPath, type FindViewFilter } from '@/src/ui/find';
import {useFindImageCapture} from '@/src/hooks/useFindImageCapture';
import {PendingImageCaptures} from '@/components/find/PendingImageCaptures';
import {ImageCaptureFeedback} from '@/components/find/ImageCaptureFeedback';
import {FindPasteSheet} from '@/components/find/FindPasteSheet';
import {useFindCapture} from '@/src/hooks/useFindCapture';
import {observeFind} from '@/src/analytics/findMeasurement';
import {Text} from '@/components/ui/Text';
import {typeStyle} from '@/src/theme/typography';
import {findApi} from '@/src/services/findApi';
import type { FindSourceFilter } from '@/src/services/findClient';
export default function FindScreen() {
  const router = useRouter(), { tokens } = useThemeMode(), { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter?: string }>();
  const filter: FindViewFilter = params.filter === 'completed' || params.filter === 'processing' || params.filter === 'attention' ? params.filter : 'all';
  const [sourceSelection,setSourceSelection]=useState<{owner:string|null;source:FindSourceFilter}>({owner:null,source:'all'});
  const source=sourceSelection.owner===user?.id?sourceSelection.source:'all';
  const history = useFindHistory(filter,{source});
  const activeHistory=useFindHistory('processing',{supplemental:true});
  const attentionHistory=useFindHistory('attention',{supplemental:true});
  const completedHistory=useFindHistory('completed',{supplemental:true});
  const image=useFindImageCapture();
  const capture=useFindCapture(false);
  const {ack,clearAck,owner:captureOwner}=capture;
  const [pasteOpen,setPasteOpen]=useState(false);
  const [feedback,setFeedback]=useState<{owner:string;message:string}|null>(null);
  const [retryState,setRetryState]=useState<{owner:string;id:string;busy:boolean;error:string|null}|null>(null);
  const retryRef=useRef(false);
  const retryGeneration=useRef(0),ownerRef=useRef(user?.id);
  if(ownerRef.current!==user?.id){ownerRef.current=user?.id;retryGeneration.current++;retryRef.current=false;}
  useEffect(()=>{setFeedback(null);setRetryState(null);retryRef.current=false;},[user?.id]);
  useEffect(()=>{
    if(!pasteOpen || !ack || !user || captureOwner!==user.id) return;
    setPasteOpen(false);clearAck();
    setFeedback({owner:user.id,message:ack.local?'Saved on this device — waiting to send to Mystash.':ack.created?'Link received. Mystash will find results in the background.':'This link is already in your Finds.'});
    if(!ack.local) router.setParams({filter:'all'});
    void history.refresh();
  },[pasteOpen,ack,captureOwner,clearAck,user,router,history]);
  const openPaste=()=>{setFeedback(null);setPasteOpen(true);observeFind(user?.id??null,'find.capture_action_chosen',{origin:'url'});};
  const activity=activeHistory.items[0]??attentionHistory.items[0]??completedHistory.items[0]??null;
  const retryActivity=(kind:'extraction'|'saving')=>{if(!user||!activity||retryRef.current)return;retryRef.current=true;const owner=user.id,id=activity.id,generation=retryGeneration.current;const current=()=>ownerRef.current===owner&&retryGeneration.current===generation;setRetryState({owner,id,busy:true,error:null});void findApi.retry(id,kind).then(async()=>{if(!current())return;await Promise.all([history.refresh(),activeHistory.refresh(),attentionHistory.refresh(),completedHistory.refresh()]);if(current())setRetryState(null);}).catch(()=>{if(current())setRetryState({owner,id,busy:false,error:'Couldn’t retry this Find. Please try again.'});}).finally(()=>{if(current())retryRef.current=false;});};
  const captureImage=(origin:'camera'|'gallery')=>{if(!user)router.push(FIND_ROUTES.profile);else void image.capture(origin);};
  return <View style={{ flex: 1, backgroundColor: tokens.color.canvasSoft, paddingLeft: insets.left, paddingRight: insets.right }}>
    <TopBar mode="page" title="Your Finds" trailing={<FindNotificationButton />} />
    <FindDashboard state={history} activity={activity} activityOwner={user?.id??null} activityBusy={Boolean(retryState?.owner===user?.id && retryState?.busy && retryState.id===activity?.id)} activityError={retryState?.owner===user?.id && retryState?.id===activity?.id?retryState?.error??null:null} onRetryActivity={retryActivity} signedIn={Boolean(user)} authLoading={loading} onFilter={next => router.setParams({ filter: next })} onSource={next=>setSourceSelection({owner:user?.id??null,source:next})}
      onOpen={id => router.push(findDetailPath(id) as Href)} onCapture={openPaste}
      onSignIn={() => router.push(FIND_ROUTES.profile)} onRefresh={() => { void Promise.all([history.refresh(),activeHistory.refresh(),attentionHistory.refresh(),completedHistory.refresh()]); }} onLoadMore={() => { void history.loadMore(); }} pending={<>{feedback && feedback.owner===user?.id?<Text accessibilityLiveRegion="polite" style={typeStyle(tokens,'caption')}>{feedback.message}</Text>:null}<ImageCaptureFeedback result={image.result} openSettings={()=>void image.openSettings()}/><NativePendingShares /><PendingImageCaptures /></>} />
    <FindCaptureActions onPaste={openPaste} imagesAvailable={image.supported} busy={image.busy} onGallery={()=>captureImage('gallery')} onCamera={()=>captureImage('camera')}/>
    <FindPasteSheet visible={pasteOpen} owner={user?.id??null} authLoading={loading} capture={capture} onClose={()=>{if(capture.input.trim()&&!capture.busy)observeFind(user?.id??null,'find.capture_cancelled',{origin:'url'});setPasteOpen(false);}} onSignIn={()=>{setPasteOpen(false);router.push(FIND_ROUTES.profile);}}/>
  </View>;
}
