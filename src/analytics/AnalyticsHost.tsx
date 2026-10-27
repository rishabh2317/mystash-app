import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { personalizationWithdrawals } from '@/src/services/personalizationApi';
import { analyticsQueue, initializeAnalytics, setAnalyticsForeground, pauseAnalytics } from './client';
export function AnalyticsHost(){
  const {user,emailVerified,loading}=useAuth();
  const userId=user?.id;
  useEffect(()=>{
    if(loading||!userId||!emailVerified)return;
    // Pending withdrawals sync even when measurement/personalization client flags are off.
    const sync=()=>{void personalizationWithdrawals.flush(userId).catch(()=>{});};sync();
    const sub=AppState.addEventListener('change',next=>{if(next==='active')sync();});return()=>sub.remove();
  },[userId,emailVerified,loading]);
  useEffect(()=>{
    if(loading){pauseAnalytics();return;}
    const scope=userId&&emailVerified?userId:'guest';
    void initializeAnalytics(scope);setAnalyticsForeground(AppState.currentState==='active');
    const sub=AppState.addEventListener('change',next=>{
      setAnalyticsForeground(next==='active');if(next==='active')void initializeAnalytics(scope);
    });
    const timer=setInterval(()=>void analyticsQueue.flush(),15000);
    return()=>{sub.remove();clearInterval(timer);pauseAnalytics();};
  },[userId,emailVerified,loading]);
  return null;
}
