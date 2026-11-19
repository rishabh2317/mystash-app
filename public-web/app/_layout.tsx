import React,{useState} from 'react';
import {Modal,Pressable,ScrollView,View,useColorScheme} from 'react-native';
import {Text} from '@/components/ui/Text';
import {AnalyticsPrivacyControls} from '@/src/analytics/PrivacyControls';
import {useThemeMode, ThemeModeProvider} from '@/contexts/ThemeContext';
import {AnalyticsHost} from '@/src/analytics/AnalyticsHost';
import { Stack, usePathname } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import { AuthProvider } from '@/contexts/AuthContext';
function Privacy(){const editorial=/^\/stash\/[^/]+\/?$/.test(usePathname());const [open,setOpen]=useState(false),{tokens,toggleTheme,isLight}=useThemeMode();return <>{!editorial?<Pressable accessibilityRole="button" onPress={toggleTheme} style={{padding:12,backgroundColor:tokens.color.canvas}}><Text style={{color:tokens.color.textMuted}}>{isLight?'Dark appearance':'Light appearance'}</Text></Pressable>:null}<Pressable accessibilityRole="button" onPress={()=>setOpen(true)} style={{padding:12,backgroundColor:editorial?'#efeee7':tokens.color.canvas}}><Text style={{color:editorial?'#6f7468':tokens.color.textMuted,fontSize:12}}>Usage data preferences</Text></Pressable><Modal visible={open} onRequestClose={()=>setOpen(false)}><View style={{flex:1,backgroundColor:tokens.color.canvas,padding:20}}><ScrollView><AnalyticsPrivacyControls/></ScrollView><Pressable accessibilityRole="button" onPress={()=>setOpen(false)}><Text style={{color:tokens.color.text}}>Close</Text></Pressable></View></Modal></>;}
export default function Layout() {
  const scheme=useColorScheme();
  const [ready] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  if (!ready) return null;
  return <SafeAreaProvider><ThemeModeProvider initialMode={scheme==='dark'?'nebula':'titanium'}><AuthProvider>{process.env.EXPO_PUBLIC_PUBLIC_STASH_PROOF!=='true'?<AnalyticsHost/>:null}<Stack screenOptions={{ headerShown: false }} />{process.env.EXPO_PUBLIC_PUBLIC_STASH_PROOF!=='true'?<Privacy/>:null}</AuthProvider></ThemeModeProvider></SafeAreaProvider>;
}
