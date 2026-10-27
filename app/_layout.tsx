import { AnalyticsHost } from '@/src/analytics/AnalyticsHost';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { FeedbackHost } from '@/components/chrome/FeedbackAnchor';
import { AuthProvider } from '@/contexts/AuthContext';
import { AuthRecoveryGate } from '@/src/auth/AuthRecoveryGate';
import { CartProvider } from '@/contexts/CartContext';
import { CommerceCountryProvider } from '@/contexts/CommerceCountryContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { ThemeModeProvider } from '@/contexts/ThemeContext';
import { PushNotificationsHost } from '@/src/notifications/PushNotificationsHost';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    if (!fontsLoaded) return;
    void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ThemeModeProvider>
      <AuthProvider>
        <AuthRecoveryGate />
        <AnalyticsHost />
        <NotificationsProvider>
          <CommerceCountryProvider>
            <CartProvider>
              <FeedbackHost>
                <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                  <Stack>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="auth" options={{ headerShown: false }} />
                    <Stack.Screen name="connected-accounts/callback" options={{ headerShown: false }} />
                    <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
                    <Stack.Screen name="product-list/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="product/[productId]" options={{ headerShown: false }} />
                    <Stack.Screen name="merchant-browser" options={{ headerShown: false }} />
                    <Stack.Screen name="compare" options={{ headerShown: false }} />
                    <Stack.Screen name="reel" options={{ headerShown: false }} />
                    <Stack.Screen name="cart" options={{ headerShown: false }} />
                    <Stack.Screen name="shares" options={{ headerShown: false }} />
                    <Stack.Screen name="import" options={{ headerShown: false }} />
                    <Stack.Screen name="analytics" options={{ headerShown: false }} />
                    <Stack.Screen name="notifications" options={{ headerShown: false }} />
                    <Stack.Screen name="settings" options={{ headerShown: false }} />
                    <Stack.Screen name="profile" options={{ headerShown: false }} />
                    <Stack.Screen name="creator/[username]" options={{ headerShown: false }} />
                  </Stack>
                  <PushNotificationsHost />
                  <StatusBar style="auto" />
                </ThemeProvider>
              </FeedbackHost>
            </CartProvider>
          </CommerceCountryProvider>
        </NotificationsProvider>
      </AuthProvider>
    </ThemeModeProvider>
  );
}
