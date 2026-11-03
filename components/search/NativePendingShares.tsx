import React, { useCallback, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { typeStyle } from '@/src/theme/typography';
import { claimNativeShare, discardNativeShare, pendingNativeShares, retryNativeShares, subscribePendingShares } from '@/src/services/nativeShare';
import type { NativePendingShare } from '@/modules/mystash-share';
import { fetchShareIntent,updateShareIntent } from '@/src/services/shareReviewApi';
export function NativePendingShares() {
  const { user } = useAuth(), { tokens } = useThemeMode();
  const ownerRef=useRef(user?.id);ownerRef.current=user?.id;
  const [data, setData] = useState<{ owner: string | null; rows: NativePendingShare[] } | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [limit,setLimit]=useState(5);
  const refresh = useCallback(async () => {
    const account=user?.id;
    try { const rows=await pendingNativeShares(account ?? null);if(ownerRef.current===account){setData({ owner: account ?? null, rows });setError(null);} } catch { if(ownerRef.current===account)setError('Pending shares could not be read. They have not been removed.'); }
  },[user?.id]);
  useFocusEffect(useCallback(() => { void refresh();return subscribePendingShares(()=>void refresh()); },[refresh]));
  const rows = data?.owner === (user?.id ?? null) ? data?.rows ?? [] : [];
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(null);
    try { await action(); await refresh(); } catch { setError('Could not confirm this change. Your share is still on this device.'); } finally { setBusy(false); } };
  if (!rows.length && !error) return null;
  return <View style={{ padding:tokens.space.md,gap:tokens.space.sm }}>
    <Text style={typeStyle(tokens,'sectionTitle')}>On this device</Text>
    {error ? <Text accessibilityLiveRegion="polite" style={typeStyle(tokens,'bodyMuted')}>{error}</Text>:null}
    {rows.slice(0,limit).map(row=><View key={row.id} style={{gap:tokens.space.xs,padding:tokens.space.sm,borderWidth:tokens.stroke.thin,borderColor:tokens.color.border,borderRadius:tokens.radius.md}}>
      <Text numberOfLines={1} style={typeStyle(tokens,'body')}>{row.url}</Text>
      {row.intent?.note?<Text style={typeStyle(tokens,'caption')}>{row.intent.note}</Text>:null}
      <Text style={typeStyle(tokens,'caption')}>{row.owner ? row.state==='intent_conflict'?'Link accepted. Review your interest note before updating it.':'Saved here — waiting to send to Mystash.' : 'Saved here — sign in and choose the account to save it to.'}</Text>
      {!row.owner && user ? <ActionButton label="Save to this account" disabled={busy} onPress={()=>Alert.alert('Save this share?',`Save to ${user.email ?? 'your current account'}?`,[{text:'Cancel',style:'cancel'},{text:'Save',onPress:()=>void run(()=>claimNativeShare(row.id,user!.id))}])}/>:null}
      {row.state==='intent_conflict'&&row.importId&&row.intent&&row.owner===user?.id?<ActionButton label="Review interest" disabled={busy} variant="secondary" onPress={()=>void run(async()=>{
        const account=user?.id,current=await fetchShareIntent(row.importId!);
        if(ownerRef.current!==account)return;
        Alert.alert('Replace saved interest?',`Current note: ${current.note??'None'}\nPending note: ${row.intent?.note??'None'}`,[{text:'Cancel',style:'cancel'},
          {text:'Replace',onPress:()=>{if(ownerRef.current===account)void run(async()=>{await updateShareIntent(row.importId!,{...row.intent!,revision:current.revision});await discardNativeShare(row.id,user?.id??null);});}}]);
      })}/>:null}
      <ActionButton label="Remove from device" variant="quiet" disabled={busy} onPress={()=>Alert.alert('Remove this pending share?','This removes the local copy only.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void run(()=>discardNativeShare(row.id,user?.id??null))}])}/>
    </View>)}
    {rows.length>limit?<ActionButton label="Show more" variant="quiet" onPress={()=>setLimit(n=>n+20)}/>:null}
    {user ? <ActionButton label="Try sending pending shares" variant="secondary" disabled={busy} onPress={()=>void run(()=>retryNativeShares(user!.id))}/>:null}
    <ActionButton label="Refresh pending shares" variant="quiet" disabled={busy} onPress={()=>void refresh()}/>
  </View>;
}
