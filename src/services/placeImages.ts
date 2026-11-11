import { AppState } from 'react-native';
import { supabase } from './supabase';
import { createPlaceImageClient } from './placeImageClient';

export const placeImages=createPlaceImageClient({
  baseURL:()=>process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL,
  fetch:(...args)=>fetch(...args),
  // Explicit policy control; memory-only is still caching under Google's standard terms.
  allowSessionReuse:source=>source!=='google_places'||process.env.EXPO_PUBLIC_GOOGLE_PLACE_PHOTO_SESSION_REUSE!=='false',
  isOnline:()=>typeof navigator!=='undefined'&&'onLine' in navigator?Boolean(navigator.onLine):undefined,
  session:async()=>{const {data}=await supabase.auth.getSession();return data.session?{userId:data.session.user.id,accessToken:data.session.access_token}:null;},
});

// Account changes end the image session; token refreshes and tab navigation do not.
supabase.auth.onAuthStateChange((_event,session)=>placeImages.setOwner(session?.user.id??null));
// No disk restoration: process exit drops all bytes; memory pressure clears retained resources.
AppState.addEventListener('memoryWarning',()=>placeImages.clear());
