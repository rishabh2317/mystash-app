import AdminAnalyticsScreen from '@/components/analytics/AdminAnalyticsScreen';
import {TopBar} from '@/components/chrome/TopBar';
import {Text} from '@/components/ui/Text';
import {useThemeMode} from '@/contexts/ThemeContext';
import {View} from 'react-native';
import {typeStyle} from '@/src/theme/typography';
import {Stack} from 'expo-router';

/** Separate internal route; never added to public navigation or the creator dashboard. */
export default function AdminAnalyticsRoute(){
 const {tokens}=useThemeMode();
 if(process.env.EXPO_PUBLIC_ADMIN_ANALYTICS_ENABLED==='true')return <><Stack.Screen options={{headerShown:false}}/><AdminAnalyticsScreen/></>;
 return <View style={{flex:1,backgroundColor:tokens.color.canvas}}><Stack.Screen options={{headerShown:false}}/><TopBar mode="page" title="Admin analytics" showBack/>
  <View style={{padding:tokens.space.lg}}><Text style={typeStyle(tokens,'bodyMuted')}>Admin reporting is not enabled.</Text></View></View>;
}
