import React,{useState} from 'react';
import {Modal,View,StyleSheet,type StyleProp,type ViewStyle} from 'react-native';
import {Image} from 'expo-image';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAuth} from '@/contexts/AuthContext';
import {useThemeMode} from '@/contexts/ThemeContext';
import {Text} from '@/components/ui/Text';
import {ActionButton} from '@/components/ui/ActionButton';
import {typeStyle} from '@/src/theme/typography';
import {privateFindImageUrl} from '@/src/services/captureTransport';
export function PrivateFindImage({id,variant='thumbnail',style}:{id:string;variant?:'original'|'thumbnail';style:StyleProp<ViewStyle>}){
  const {session}=useAuth(),{tokens}=useThemeMode();const [failed,setFailed]=useState<string|null>(null);
  const identity=`${session?.user.id}:${id}:${variant}`,base=process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL;
  const uri=privateFindImageUrl(base,id,variant);
  return <View style={[{backgroundColor:tokens.color.surfaceSubtle,justifyContent:'center',alignItems:'center'},style]}>
    {session&&uri&&failed!==identity?<Image key={identity} source={{uri,headers:{Authorization:`Bearer ${session.access_token}`}}} cachePolicy="none" recyclingKey={identity} transition={0} contentFit="contain" style={StyleSheet.absoluteFill} accessible accessibilityLabel={variant==='original'?'Your private captured image':'Private capture preview'} onError={()=>setFailed(identity)}/>
      :<Text style={typeStyle(tokens,'caption')}>Private image unavailable</Text>}
  </View>;
}
export function PrivateFindPreview({id,compact=false,children}:{id:string;compact?:boolean;children?:React.ReactNode}){
  const [open,setOpen]=useState(false),{user}=useAuth(),{tokens}=useThemeMode(),insets=useSafeAreaInsets();
  return <View style={{gap:tokens.space.sm, flexDirection:compact?'row':'column',alignItems:compact?'center':undefined}}><PrivateFindImage id={id} style={{width:compact?96:'100%',height:compact?96:undefined,aspectRatio:compact?undefined:1.5,borderRadius:tokens.radius.md,overflow:'hidden'}}/>
    <View style={{flex:compact?1:undefined,alignItems:compact?'flex-start':undefined}}>{children}<ActionButton wrapLabel label={compact?'View original':'View original image'} minTouchHeight={48} variant="quiet" onPress={()=>setOpen(true)}/></View>
    <Modal visible={open&&!!user} animationType="slide" onRequestClose={()=>setOpen(false)} presentationStyle="fullScreen">
      <View accessibilityViewIsModal style={{flex:1,paddingTop:insets.top,paddingBottom:insets.bottom,paddingLeft:insets.left+tokens.space.md,paddingRight:insets.right+tokens.space.md,backgroundColor:tokens.color.canvasSoft,gap:tokens.space.md}}>
        <ActionButton label="Close image" minTouchHeight={48} onPress={()=>setOpen(false)}/><PrivateFindImage id={id} variant="original" style={{flex:1}}/>
      </View>
    </Modal>
  </View>;
}
