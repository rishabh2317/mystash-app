import React from 'react';
import { ScrollView, View } from 'react-native';
import { IllustratedEmptyState } from '@/components/status/IllustratedEmptyState';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { EMPTY_STATES } from '@/src/ui/emptyStates';

export function SignedOutSettings({onSignIn,onPrivacy,onTerms,children}:{onSignIn:()=>void;onPrivacy:()=>void;onTerms:()=>void;children?:React.ReactNode}) {
  const {tokens}=useThemeMode();
  return <ScrollView contentContainerStyle={{flexGrow:1,padding:tokens.space.md,paddingBottom:tokens.space.xxl,gap:tokens.space.xl}}>
    <IllustratedEmptyState {...EMPTY_STATES.settings} onAction={onSignIn}/>
    <View style={{width:'100%',maxWidth:480,alignSelf:'center',gap:tokens.space.sm}}>
      <Text style={[typeStyle(tokens,'caption'),{textTransform:'uppercase',fontFamily:tokens.fontFamily.semibold,letterSpacing:0.4}]}>Legal &amp; privacy</Text>
      <SettingsSection><SettingsRow variant="navigation" icon="shield-checkmark-outline" title="Privacy policy" onPress={onPrivacy}/></SettingsSection>
      <SettingsSection><SettingsRow variant="navigation" icon="document-text-outline" title="Terms of service" onPress={onTerms}/></SettingsSection>
    </View>
    {children}
  </ScrollView>;
}
