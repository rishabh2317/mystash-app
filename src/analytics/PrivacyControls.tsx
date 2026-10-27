import React, { useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { ActionButton } from '@/components/ui/ActionButton';
import { ANALYTICS_CLIENT_ENABLED,analyticsSnapshot,subscribeAnalytics,updateMeasurementPreferences } from './client';
import { PersonalizationPrivacyControls } from './PersonalizationPrivacyControls';
export function AnalyticsPrivacyControls(){
  const state=useSyncExternalStore(subscribeAnalytics,analyticsSnapshot,analyticsSnapshot);
  const [busy,setBusy]=useState(false);
  const local=state.preferences,account=state.accountPreferences;
  const mayEnable=ANALYTICS_CLIENT_ENABLED&&state.ready&&state.available;
  const update=async(measurement:boolean,activity:boolean,decreaseOnly:boolean,activateDevice:boolean)=>{setBusy(true);
    try{await updateMeasurementPreferences(measurement,activity,{decreaseOnly,activateDevice});}
    catch{Alert.alert('Privacy controls','Your device has stopped measurement. Connect and try again to sync this change.');}finally{setBusy(false);}};
  return <>{ANALYTICS_CLIENT_ENABLED||state.recoverable?<SettingsSection title="Measurement privacy">
    <SettingsRow variant="toggle" title="Usage measurement" icon="shield-checkmark-outline"
      subtitle="Optional usage counts. No search text, merchant URLs, or precise location."
      toggleValue={local.measurement_enabled} disabled={busy||!state.scope||(!local.measurement_enabled&&!mayEnable)}
      onToggle={v=>void update(v,v&&!!account?.activity_enabled,!v,v)}/>
    {state.scope&&state.scope!=='guest'?<SettingsRow variant="toggle" title="Account activity measurement"
      subtitle="Optional account-linked visits and shopping actions. Personalization requires its own opt-in."
      toggleValue={account?.activity_enabled??false} disabled={busy||(!account?.activity_enabled&&(!mayEnable||!local.measurement_enabled))}
      onToggle={v=>void update(true,v,!v,local.measurement_enabled)}/>:null}
    {state.recoverable?<ActionButton variant="quiet" label="Stop all measurement" disabled={busy}
      onPress={()=>void update(false,false,true,false)}/>:null}
  </SettingsSection>:null}<PersonalizationPrivacyControls/></>;
}
