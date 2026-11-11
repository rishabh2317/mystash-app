import {useFailureNotice} from '@/src/ui/useFailureNotice';
import React, { useState, useSyncExternalStore } from 'react';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { ActionButton } from '@/components/ui/ActionButton';
import { ANALYTICS_CLIENT_ENABLED,analyticsSnapshot,subscribeAnalytics,updateMeasurementPreferences } from './client';
import { PersonalizationPrivacyControls } from './PersonalizationPrivacyControls';
export function AnalyticsPrivacyControls(){
  const state=useSyncExternalStore(subscribeAnalytics,analyticsSnapshot,analyticsSnapshot);
  const {showFailure,notice:failureNotice}=useFailureNotice(state.scope);
  const [busy,setBusy]=useState(false);
  const local=state.preferences,account=state.accountPreferences;
  const mayEnable=ANALYTICS_CLIENT_ENABLED&&state.ready&&state.available;
  const update=async(measurement:boolean,activity:boolean,decreaseOnly:boolean,activateDevice:boolean)=>{setBusy(true);
    try{await updateMeasurementPreferences(measurement,activity,{decreaseOnly,activateDevice});}
    catch{showFailure('Your device has stopped measurement. Connect and try again to sync this change.');}finally{setBusy(false);}};
  return <>{failureNotice}{ANALYTICS_CLIENT_ENABLED||state.recoverable?<SettingsSection title="Data & privacy">
    <SettingsRow variant="toggle" title="Usage data" icon="shield-checkmark-outline"
      subtitle="Share basic app usage counts."
      toggleValue={local.measurement_enabled} disabled={busy||!state.scope||(!local.measurement_enabled&&!mayEnable)}
      onToggle={v=>void update(v,v&&!!account?.activity_enabled,!v,v)}/>
    {state.scope&&state.scope!=='guest'?<SettingsRow variant="toggle" title="Account activity"
      subtitle="Include visits and shopping actions linked to your account."
      toggleValue={account?.activity_enabled??false} disabled={busy||(!account?.activity_enabled&&(!mayEnable||!local.measurement_enabled))}
      onToggle={v=>void update(true,v,!v,local.measurement_enabled)}/>:null}
    {state.recoverable?<ActionButton variant="quiet" label="Stop all measurement" disabled={busy}
      onPress={()=>void update(false,false,true,false)}/>:null}
  </SettingsSection>:null}<PersonalizationPrivacyControls/></>;
}
