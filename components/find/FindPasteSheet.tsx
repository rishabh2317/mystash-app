import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { extractSharedLink } from '@/src/ui/shareImport';
import type { FindCaptureState } from '@/src/state/findCaptureController';

// Older installed binaries may not contain the new clipboard module. The native
// input's standard paste menu remains available without crashing those clients.
const clipboard = requireOptionalNativeModule<{getStringAsync(options: Record<string, never>):Promise<string>}>('ExpoClipboard');

type Props = {
  visible: boolean; owner: string | null; authLoading: boolean;
  capture: FindCaptureState & { setInput(value:string):void; submit():Promise<void> };
  onClose():void; onSignIn():void;
};
export function FindPasteSheet({visible,owner,authLoading,capture,onClose,onSignIn}:Props) {
  const {tokens}=useThemeMode(), insets=useSafeAreaInsets();
  const inputRef=useRef<TextInput>(null), current=useRef({visible,owner,input:capture.input});
  current.current={visible,owner,input:capture.input};
  const [pasteError,setPasteError]=useState<string|null>(null);
  const [androidKeyboardVisible,setAndroidKeyboardVisible]=useState(false);
  useEffect(()=>{setPasteError(null);},[owner,visible]);
  useEffect(()=>{
    if(Platform.OS!=='android'||!visible){setAndroidKeyboardVisible(false);return;}
    setAndroidKeyboardVisible(Keyboard.isVisible());
    const shown=Keyboard.addListener('keyboardDidShow',()=>setAndroidKeyboardVisible(true));
    const hidden=Keyboard.addListener('keyboardDidHide',()=>setAndroidKeyboardVisible(false));
    return ()=>{shown.remove();hidden.remove();};
  },[visible]);
  const valid=extractSharedLink(capture.input).ok;
  const paste=async()=>{
    const account=owner, original=capture.input;
    try {
      if(!clipboard) return;
      const text=await clipboard.getStringAsync({});
      if(!current.current.visible || current.current.owner!==account || current.current.input!==original) return;
      if(!text.trim()){setPasteError('Clipboard is empty.');return;}
      setPasteError(null);capture.setInput(text);inputRef.current?.focus();
    } catch { if(current.current.visible && current.current.owner===account) setPasteError('Couldn’t paste. Try using the keyboard’s paste action.'); }
  };
  const close=()=>{if(!capture.busy){Keyboard.dismiss();onClose();}};
  return <Modal visible={visible} transparent animationType="slide" statusBarTranslucent={Platform.OS==='android'} navigationBarTranslucent={Platform.OS==='android'} onRequestClose={close} onShow={()=>inputRef.current?.focus()}>
    {/* Explicitly disable the Android adjustment on hide so stale keyboard
        measurements cannot leave the sheet above the bottom edge. */}
    <KeyboardAvoidingView behavior="padding" enabled={Platform.OS==='ios'||androidKeyboardVisible} style={{flex:1,justifyContent:'flex-end',backgroundColor:tokens.overlay.scrim}}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Dismiss paste link sheet" disabled={capture.busy}/>
      <View pointerEvents="none" style={{position:'absolute',bottom:0,left:0,right:0,height:Math.max(insets.bottom,tokens.space.md),backgroundColor:tokens.color.canvas}}><View style={{flex:1,backgroundColor:tokens.color.surface}}/></View>
      <View accessibilityViewIsModal style={{maxHeight:'100%',backgroundColor:tokens.color.canvas, borderTopLeftRadius:tokens.radius.xxl,borderTopRightRadius:tokens.radius.xxl,overflow:'hidden',paddingHorizontal:tokens.space.md,paddingTop:tokens.space.sm,paddingBottom:Math.max(insets.bottom,tokens.space.md)}}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:tokens.color.surface}]}/>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{width:40,height:4,borderRadius:tokens.radius.pill,alignSelf:'center',backgroundColor:tokens.color.textMuted,opacity:0.4,marginBottom:tokens.space.md}}/>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{gap:tokens.space.md}}>
          <View style={{gap:tokens.space.xxs}}><Text accessibilityRole="header" style={[typeStyle(tokens,'sectionTitle'),{fontSize:tokens.fontSize.display,lineHeight:tokens.lineHeight.display,fontFamily:tokens.fontFamily.bold}]}>Find something amazing</Text><Text style={typeStyle(tokens,'bodyMuted')}>Drop a Reel, Short, or web link.</Text></View>
          {authLoading ? <Text style={typeStyle(tokens,'caption')}>Checking your account…</Text> : !owner ? <><Text style={typeStyle(tokens,'bodyMuted')}>Sign in to capture a link.</Text><ActionButton label="Sign in" minTouchHeight={48} variant="filled" onPress={onSignIn}/></> : <>
            <View>
            <View style={{minHeight:52,flexDirection:'row',alignItems:'center',borderWidth:tokens.stroke.thin,borderColor:capture.error||pasteError?tokens.color.danger:tokens.color.border,borderRadius:tokens.radius.md,backgroundColor:tokens.color.surface,paddingLeft:tokens.space.sm}}>
              <Ionicons name="link-outline" size={20} color={tokens.color.textMuted}/>
              <TextInput ref={inputRef} autoFocus={visible&&!!owner} accessibilityLabel="Link to capture" placeholder="Paste a URL or shared text" placeholderTextColor={tokens.color.textMuted} value={capture.input} editable={!capture.busy} onChangeText={value=>{setPasteError(null);capture.setInput(value);}} autoCorrect={false} autoCapitalize="none" autoComplete="off" keyboardType="url" returnKeyType="go" maxLength={4000} onSubmitEditing={()=>{if(valid&&!capture.busy)void capture.submit();}} style={{flex:1,minWidth:0,minHeight:52,paddingHorizontal:tokens.space.xs,color:tokens.color.text,fontFamily:tokens.fontFamily.regular,fontSize:tokens.fontSize.body}} />
            </View>
            {clipboard ? <Pressable accessibilityRole="button" accessibilityLabel="Paste link from clipboard" accessibilityState={{disabled:capture.busy}} disabled={capture.busy} onPress={()=>void paste()} style={{minHeight:44,alignSelf:'flex-start',justifyContent:'center'}}><View style={{flexDirection:'row',alignItems:'center',gap:tokens.space.xxs,paddingHorizontal:tokens.space.xs,paddingVertical:tokens.space.xxs,backgroundColor:tokens.color.surfaceSubtle,borderRadius:tokens.radius.pill}}><Ionicons name="clipboard-outline" size={15} color={tokens.color.primary}/><Text style={[typeStyle(tokens,'tileTitle'),{color:tokens.color.primary}]}>Paste link</Text></View></Pressable> : null}
            </View>
            {capture.error||pasteError?<Text accessibilityRole="alert" style={[typeStyle(tokens,'caption'),{color:tokens.color.danger}]}>{capture.error??pasteError}</Text>:null}
            <ActionButton label="Find it ✨" minTouchHeight={52} variant="filled" disabled={!valid} pending={capture.busy} onPress={()=>{void capture.submit();}}/>
            <View style={{flexDirection:'row',alignItems:'center',gap:tokens.space.xs}}><Ionicons name="checkmark-circle-outline" size={16} color={tokens.color.textMuted}/><Text style={typeStyle(tokens,'caption')}>Automatically saved to your Stash</Text></View>
          </>}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
