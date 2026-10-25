import { Stack } from 'expo-router';

import { TopBar } from '@/components/chrome/TopBar';
import { AUTH_COPY } from '@/src/auth/authErrors';

export default function AuthStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="callback" options={{ headerShown: false }} />
      <Stack.Screen
        name="forgot-password"
        options={{
          title: AUTH_COPY.forgotTitle,
          header: ({ navigation }) => (
            <TopBar
              mode="page"
              title={AUTH_COPY.forgotTitle}
              showBack
              showBag={false}
              onBack={() => navigation.goBack()}
            />
          ),
        }}
      />
      <Stack.Screen
        name="reset-password"
        options={{
          title: AUTH_COPY.resetTitle,
          header: () => (
            <TopBar mode="page" title={AUTH_COPY.resetTitle} showBag={false} />
          ),
        }}
      />
    </Stack>
  );
}
