import React,{useCallback,useRef,useState} from 'react';
import {Alert,View} from 'react-native';
import {useFocusEffect,useRouter,type Href} from 'expo-router';
import {useAuth} from '@/contexts/AuthContext';
import {useThemeMode} from '@/contexts/ThemeContext';
import {Text} from '@/components/ui/Text';
import {ActionButton} from '@/components/ui/ActionButton';
import {typeStyle} from '@/src/theme/typography';
import {imageOutbox,retryImageCaptures} from '@/src/services/captureRuntime';
import {notifyPendingShares,subscribePendingShares} from '@/src/services/nativeShare';
import type {PendingImage} from '@/modules/mystash-share';
import {findDetailPath} from '@/src/ui/find';
export function PendingImageCaptures(){
  const {user}=useAuth(),owner=user?.id??null,latest=useRef(owner);latest.current=owner;
  const {tokens}=useThemeMode(),router=useRouter();
  const [snapshot,setSnapshot]=useState<{owner:string;rows:PendingImage[]}|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[limit,setLimit]=useState(5);
  const refresh=useCallback(async()=>{if(!owner)return;try{const rows=await imageOutbox.list(owner);if(latest.current===owner){setSnapshot({owner,rows});setError(null);}}catch{if(latest.current===owner)setError('Pending images could not be read. They have not been removed.');}},[owner]);
  useFocusEffect(useCallback(()=>{void refresh();return subscribePendingShares(()=>void refresh());},[refresh]));
  const rows=snapshot?.owner===owner?snapshot.rows:[];
  if(!owner||!rows.length&&!error)return null;
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);try{await action();notifyPendingShares();await refresh();}catch{if(latest.current===owner)setError('Couldn’t confirm the change. Your capture is still stored securely.');}finally{setBusy(false);}};
  return <View style={{gap:tokens.space.sm}}><Text accessibilityRole="header" style={typeStyle(tokens,'sectionTitle')}>Images on this device</Text>
    <Text style={typeStyle(tokens,'caption')}>Waiting to send. They’ll appear in your Finds once received.</Text>
    {error?<Text accessibilityRole="alert" style={typeStyle(tokens,'bodyMuted')}>{error}</Text>:null}
    {rows.slice(0,limit).map(row=><View key={row.id} style={{gap:tokens.space.sm,padding:tokens.space.md,borderWidth:tokens.stroke.thin,borderColor:tokens.color.border,borderRadius:tokens.radius.xl}}>
      <Text style={typeStyle(tokens,'body')}>{row.origin==='camera'?'Camera photo':'Screenshot / Gallery'}</Text>
      <Text accessibilityLiveRegion="polite" style={typeStyle(tokens,'caption')}>{row.state==='accepted'?'Received by Mystash — processing. Refreshing your history…':row.state==='uploading'?'Sending securely…':row.state==='needs_auth'?'Sign in to this account again to send.':row.state==='needs_review'?'Couldn’t send this image. Try again or remove the local copy.':'Securely queued — we’ll retry when connected. Keep Mystash open to send images.'}</Text>
      {row.importId?<ActionButton label="Open Find" minTouchHeight={48} onPress={()=>router.push(findDetailPath(row.importId!) as Href)}/>:null}
      {row.state!=='accepted'?<ActionButton wrapLabel label="Remove from device" variant="quiet" disabled={busy||row.state==='uploading'} minTouchHeight={48} onPress={()=>Alert.alert('Remove this pending image?','This removes the encrypted local copy. Any upload already received by Mystash stays in Find history.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>{if(latest.current===owner)void run(()=>imageOutbox.remove(row.id,owner));}}])}/>:null}
    </View>)}
    {rows.length>limit?<ActionButton label="Show more pending images" variant="quiet" onPress={()=>setLimit(n=>n+10)}/>:null}
    <ActionButton wrapLabel label="Try sending pending images" disabled={busy||rows.some(r=>r.state==='uploading')} minTouchHeight={48} onPress={()=>void run(()=>retryImageCaptures(owner))}/>
  </View>;
}
