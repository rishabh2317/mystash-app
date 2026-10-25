import { Stack } from 'expo-router';

import { TopBar } from '@/components/chrome/TopBar';
import { SETTINGS_COPY } from '@/src/ui/settingsHub';
import { NOTIFICATIONS_COPY } from '@/src/ui/notificationsInbox';

export default function SettingsStackLayout() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, back, navigation }) => (
          <TopBar
            mode="page"
            title={typeof options.title === 'string' ? options.title : ''}
            showBack
            showBag={false}
            onBack={() => navigation.goBack()}
          />
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: SETTINGS_COPY.title }} />
      <Stack.Screen name="edit-profile" options={{ title: SETTINGS_COPY.editProfile }} />
      <Stack.Screen name="creator-onboarding" options={{ title: SETTINGS_COPY.becomeCreator }} />
      <Stack.Screen name="notifications" options={{ title: NOTIFICATIONS_COPY.prefsTitle }} />
    </Stack>
  );
}
