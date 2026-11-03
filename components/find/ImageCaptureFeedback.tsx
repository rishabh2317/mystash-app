import React from 'react';
import {View} from 'react-native';
import {Text} from '@/components/ui/Text';
import {ActionButton} from '@/components/ui/ActionButton';
import {useThemeMode} from '@/contexts/ThemeContext';
import {typeStyle} from '@/src/theme/typography';
export function ImageCaptureFeedback({result,openSettings}:{result:{queued:boolean;message:string;settings:boolean}|null;openSettings:()=>void}){
  const {tokens}=useThemeMode();if(!result)return null;
  return <View accessibilityLiveRegion="polite" style={{gap:tokens.space.sm}}><Text accessibilityRole={result.queued?'text':'alert'} style={[typeStyle(tokens,'bodyMuted'),result.queued?{}:{color:tokens.color.danger}]}>{result.message}</Text>
    {result.settings?<ActionButton label="Open Settings" minTouchHeight={48} variant="secondary" onPress={openSettings}/>:null}</View>;
}
