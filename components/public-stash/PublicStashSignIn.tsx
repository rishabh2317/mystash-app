import React,{useEffect,useState} from 'react';
import {View,TextInput,Pressable,ScrollView} from 'react-native';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {Text} from '@/components/ui/Text';
import {TopBar} from '@/components/chrome/TopBar';
import {useAuth} from '@/contexts/AuthContext';
import {useThemeMode} from '@/contexts/ThemeContext';
import {typeStyle} from '@/src/theme/typography';
import {publicStashRequest} from '@/src/services/publicStashApi';
import {ensureMe} from '@/src/services/userApi';
export default function PublicStashSignIn(){
 const p=useLocalSearchParams<{publicId:string;kind:string;namespace:string;itemId:string}>(),router=useRouter(),auth=useAuth(),{tokens}=useThemeMode();
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[username,setUsername]=useState(''),[signup,setSignup]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!auth.user||!auth.emailVerified)return;let current=true;setBusy(true);
  void (async()=>{try{await ensureMe();await publicStashRequest(`/public-stashes/${p.publicId}/items/save`,{method:'POST',body:JSON.stringify({kind:p.kind,namespace:p.namespace,itemId:p.itemId})},auth.user!.id);
   if(current)router.replace((p.kind==='place'?`/stash/${p.publicId}/places/${p.itemId}`:`/stash/${p.publicId}/products/${p.namespace}/${p.itemId}`) as Href);
  }catch(e){if(current)setError(e instanceof Error?e.message:'Couldn’t save this item.');}finally{if(current)setBusy(false);}})();return()=>{current=false;};
 },[auth.user?.id,auth.emailVerified,p.publicId,p.kind,p.namespace,p.itemId,router]);
 const submit=async()=>{setBusy(true);setError('');try{if(signup){const result=await auth.signUpWithEmail({email,password,fullName:name,username});if(result.error)setError(result.error);else if(result.needsEmailConfirmation)setError('Check your email to confirm your account, then return here and sign in.');}else{const result=await auth.signInWithEmail(email,password);if(result.error)setError(result.error);}}finally{setBusy(false);}};
 const field={color:tokens.color.text,borderColor:tokens.color.divider,borderWidth:1,padding:12,borderRadius:tokens.radius.md,minHeight:44};
 return <View style={{flex:1,backgroundColor:tokens.color.canvas}}><TopBar mode="page" title="Save to My Stash" showBack showBag={false}/><ScrollView contentContainerStyle={{padding:20,gap:16,maxWidth:500,width:'100%',alignSelf:'center'}}><Text style={typeStyle(tokens,'sectionTitle')}>{signup?'Create your account':'Sign in to save'}</Text>
  {signup?<><TextInput accessibilityLabel="Name" placeholder="Name" placeholderTextColor={tokens.color.textMuted} value={name} onChangeText={setName} style={field}/><TextInput accessibilityLabel="Username" placeholder="Username" placeholderTextColor={tokens.color.textMuted} value={username} onChangeText={setUsername} autoCapitalize="none" style={field}/></>:null}
  <TextInput accessibilityLabel="Email" placeholder="Email" placeholderTextColor={tokens.color.textMuted} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={field}/><TextInput accessibilityLabel="Password" placeholder="Password" placeholderTextColor={tokens.color.textMuted} value={password} onChangeText={setPassword} secureTextEntry style={field}/>
  {error?<Text accessibilityRole="alert" style={typeStyle(tokens,'bodyMuted')}>{error}</Text>:null}
  <Pressable disabled={busy} accessibilityRole="button" onPress={()=>void submit()} style={{minHeight:44}}><Text style={typeStyle(tokens,'link')}>{busy?'Please wait…':signup?'Create account':'Sign in'}</Text></Pressable>
  <Pressable accessibilityRole="button" onPress={()=>setSignup(!signup)} style={{minHeight:44}}><Text style={typeStyle(tokens,'link')}>{signup?'Already registered? Sign in':'Create an account'}</Text></Pressable>
 </ScrollView></View>;
}
