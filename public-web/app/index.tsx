import React from 'react';
import {View} from 'react-native';
import {Text} from '@/components/ui/Text';
import {useThemeMode} from '@/contexts/ThemeContext';
export default function Landing(){const {tokens}=useThemeMode();return <View style={{flex:1,justifyContent:'center',alignItems:'center',padding:32,backgroundColor:tokens.color.canvas}}><Text style={{fontSize:36,color:tokens.color.text}}>Mystash</Text><Text style={{marginTop:20,color:tokens.color.textMuted}}>Our website is on its way.</Text></View>;}
