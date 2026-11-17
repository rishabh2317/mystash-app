import React,{useEffect,useState} from 'react';
import {View} from 'react-native';
import {useLocalSearchParams} from 'expo-router';
import {Text} from '@/components/ui/Text';
import {useThemeMode} from '@/contexts/ThemeContext';
import {typeStyle} from '@/src/theme/typography';
import {completeAuthCallback} from '@/src/auth/authCallback';
import {supabaseAuthCallbackDeps} from '@/src/auth/supabaseAuthCallback';
export default function PublicAuthCallback(){
 const params=useLocalSearchParams<{code?:string;token_hash?:string;type?:string;error?:string;error_description?:string}>(),{tokens}=useThemeMode(),[message,setMessage]=useState('Confirming your account…');
 useEffect(()=>{let active=true;void completeAuthCallback(supabaseAuthCallbackDeps(),params).then(result=>{if(active)setMessage(result.status==='error'?'This confirmation link is unavailable. Return to your Stash and sign in again.':'Your account is confirmed. Return to the Stash tab to finish saving.');}).catch(()=>{if(active)setMessage('Couldn’t confirm this link. Return to your Stash and try signing in.');});return()=>{active=false;};},[params.code,params.token_hash,params.type,params.error,params.error_description]);
 return <View style={{flex:1,padding:24,backgroundColor:tokens.color.canvas}}><Text style={typeStyle(tokens,'body')}>{message}</Text></View>;
}
