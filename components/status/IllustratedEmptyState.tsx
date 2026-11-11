import React, { useState } from 'react';
import { Image, type ImageSourcePropType, View, useWindowDimensions } from 'react-native';
import { artLayout, type ArtworkBounds } from '@/src/ui/artwork';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';

type Props = {
  artwork: ImageSourcePropType;
  artworkBounds: ArtworkBounds;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
  variant?: 'page' | 'card';
};

/** Shared welcoming state: decorative art, readable copy and one clear next step. */
export function IllustratedEmptyState({artwork,artworkBounds,title,body,action,onAction,secondaryAction,onSecondaryAction,variant='page'}: Props) {
  const {tokens}=useThemeMode();
  const card=variant==='card';
  const {width,height,fontScale}=useWindowDimensions();
  const [measuredWidth,setMeasuredWidth]=useState<number|null>(null);
  const contentWidth=Math.max(1,Math.min(measuredWidth??width-tokens.space.md*4,width-tokens.space.md*2,480-tokens.space.md*2));
  const heroWidth=Math.min(contentWidth,card?228:300);
  const heroHeight=Math.min(heroWidth*artworkBounds.visHeight/artworkBounds.visWidth,height*(fontScale>1.3?0.2:0.28),card?164:240);
  const imageLayout=artLayout(artworkBounds,{width:heroWidth,height:heroHeight});
  return <View onLayout={event=>setMeasuredWidth(Math.max(1,event.nativeEvent.layout.width-tokens.space.md*2))} style={{width:'100%',maxWidth:480,alignSelf:'center',alignItems:'center',paddingHorizontal:tokens.space.md,paddingVertical:tokens.space.md,gap:tokens.space.md,
    ...(card?{backgroundColor:tokens.color.surfaceSubtle,borderRadius:tokens.radius.xl,borderWidth:tokens.stroke.thin,borderColor:tokens.color.border}: {})}}>
    <View pointerEvents="none" style={{width:heroWidth,height:heroHeight,flexShrink:0,overflow:'hidden'}}>
      <Image source={artwork} resizeMode="contain" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={imageLayout} />
    </View>
    <View style={{gap:tokens.space.sm,width:'100%'}}>
      <Text accessibilityRole="header" style={[typeStyle(tokens,'emptyTitle'),{...(card?{fontSize:tokens.fontSize.headline,lineHeight:tokens.lineHeight.headline}:{}),textAlign:'center'}]}>{title}</Text>
      <Text style={[typeStyle(tokens,'bodyMuted'),{textAlign:'center'}]}>{body}</Text>
    </View>
    <View style={{width:'100%',gap:tokens.space.xxs,marginTop:tokens.space.xs}}>
      <ActionButton label={action} onPress={onAction} variant="filled" wrapLabel minTouchHeight={48} />
      {secondaryAction&&onSecondaryAction?<ActionButton label={secondaryAction} onPress={onSecondaryAction} variant="quiet" wrapLabel minTouchHeight={48}/>:null}
    </View>
  </View>;
}
