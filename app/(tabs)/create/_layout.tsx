import { Stack } from 'expo-router';

import { TopBar } from '@/components/chrome/TopBar';

export default function CreateStackLayout() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, back, navigation }) => (
          <TopBar
            mode="page"
            title={typeof options.title === 'string' ? options.title : ''}
            showBack={Boolean(back)}
            onBack={() => navigation.goBack()}
          />
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Create' }} />
      <Stack.Screen name="manual" options={{ title: 'Manual products' }} />
      <Stack.Screen name="review" options={{ title: 'Review picks' }} />
    </Stack>
  );
}
