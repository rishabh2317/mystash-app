import React from 'react';
import { Image, type ImageSourcePropType, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';

type Props = {
  artwork: ImageSourcePropType;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
  variant?: 'page' | 'card';
};

/** Shared welcoming state: decorative art, readable copy and one clear next step. */
export function IllustratedEmptyState({artwork,title,body,action,onAction,secondaryAction,onSecondaryAction,variant='page'}: Props) {
  const {tokens}=useThemeMode();
  const card=variant==='card';
  return <View style={{width:'100%',maxWidth:480,alignSelf:'center',alignItems:'center',paddingHorizontal:tokens.space.md,paddingVertical:tokens.space.lg,gap:tokens.space.md,
    ...(card?{backgroundColor:tokens.color.surfaceSubtle,borderRadius:tokens.radius.xl,borderWidth:tokens.stroke.thin,borderColor:tokens.color.border}: {})}}>
    <Image source={artwork} resizeMode="contain" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{width:card?'72%':'88%',maxWidth:card?228:300,aspectRatio:card?1.45:1.2}} />
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
