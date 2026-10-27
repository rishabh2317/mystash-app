import React, {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Alert,AppState} from 'react-native';
import {SettingsSection} from '@/components/settings/SettingsSection';
import {SettingsRow} from '@/components/settings/SettingsRow';
import {ActionButton} from '@/components/ui/ActionButton';
import {Text} from '@/components/ui/Text';
import {useAuth} from '@/contexts/AuthContext';
import {useThemeMode} from '@/contexts/ThemeContext';
import {typeStyle} from '@/src/theme/typography';
import {enablePersonalization,getPersonalizationSettings,hasPersonalizationControlReceipt,personalizationWithdrawals,resetInterests,type PersonalizationSettings} from '@/src/services/personalizationApi';
import {analyticsSnapshot,subscribeAnalytics} from './client';
const VISIBLE=process.env.EXPO_PUBLIC_PERSONALIZATION_ENABLED==='true';
export function PersonalizationPrivacyControls(){
 const {user,emailVerified}=useAuth(),{tokens}=useThemeMode();
 const measurement=useSyncExternalStore(subscribeAnalytics,analyticsSnapshot,analyticsSnapshot);
 const [result,setResult]=useState<{scope:string;settings:PersonalizationSettings}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [receiptScope,setReceiptScope]=useState<string|null>(null);
 const generation=useRef(0),scope=user?.id;
 const visible=VISIBLE||!!scope&&receiptScope===scope;
 useEffect(()=>{let alive=true;if(scope&&!VISIBLE)void hasPersonalizationControlReceipt(scope).then(yes=>{if(alive)setReceiptScope(yes?scope:null);}).catch(()=>{});return()=>{alive=false;};},[scope]);
 const invalidate=useCallback(()=>{generation.current++;},[]);
 const refresh=useCallback(async()=>{
  if(!visible||!scope||!emailVerified)return;const n=++generation.current;setError(false);
  try{const settings=await getPersonalizationSettings(scope);if(n===generation.current)setResult({scope,settings});}catch{if(n===generation.current)setError(true);}
 },[scope,emailVerified,visible]);
 useEffect(()=>{setResult(null);void refresh();const sub=AppState.addEventListener('change',s=>{if(s==='active')void refresh();});return()=>{invalidate();sub.remove();};},[refresh,invalidate]);
 if(!visible||!scope||!emailVerified)return null;
 const settings=result?.scope===scope?result.settings:null;
 const enableAllowed=VISIBLE&&settings?.available&&settings.preferences.policy_version===1&&measurement.ready&&measurement.scope===scope&&measurement.preferences.activity_enabled&&measurement.preferences.revision;
 const change=async(enabled:boolean,reset=false)=>{
  setBusy(true);const n=++generation.current;
  if(!enabled&&!reset)setResult(settings?{scope,settings:{...settings,preferences:{...settings.preferences,enabled:false}}}:null);
  try{
   if(reset)await resetInterests(scope);
   else if(enabled){if(!enableAllowed)throw new Error('Enable account activity measurement first');await enablePersonalization(scope,measurement.preferences.revision!);}
   else await personalizationWithdrawals.withdraw(scope);
   if(n===generation.current)await refresh();
  }catch{if(n===generation.current){setError(true);Alert.alert('Personalization privacy','This change has not been confirmed by the server. Reconnect and try again.');}}
  finally{setBusy(false);}
 };
 return <SettingsSection title="Personalization privacy">
  <SettingsRow variant="toggle" title="Build my interest profile" icon="sparkles-outline"
   subtitle="Separate opt-in: current saves/follows and future shared product/collection actions. No playback, search text or place/location profiling. Recommendations stay unchanged."
   toggleValue={settings?.preferences.enabled===true} disabled={busy||!settings||(!settings.preferences.enabled&&!enableAllowed)}
   onToggle={v=>void change(v)}/>
  <Text style={typeStyle(tokens,'bodyMuted')}>Current saves and follows are direct intent signals. Categories and repeated visits are inferred interests. Profiles expire after 24 hours without refresh; activity is limited to seven days.</Text>
  {settings?.preferences.enabled?<ActionButton label="Reset inferred interests" variant="secondary" disabled={busy} onPress={()=>Alert.alert('Reset inferred interests','Past measured activity will no longer seed your profile. Your saved items and follows stay intact and remain eligible as current intent signals.',[{text:'Cancel',style:'cancel'},{text:'Reset',onPress:()=>void change(false,true)}])}/>:null}
  {error?<ActionButton label="Retry privacy sync" variant="quiet" disabled={busy} onPress={()=>void refresh()}/>:null}
 </SettingsSection>;
}
