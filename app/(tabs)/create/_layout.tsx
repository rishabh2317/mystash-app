import { Stack } from 'expo-router';

export default function CreateStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: 'Back',
        headerTintColor: '#00AFC0',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Create' }} />
      <Stack.Screen name="manual" options={{ title: 'Manual products' }} />
      <Stack.Screen name="review" options={{ title: 'Review picks' }} />
    </Stack>
  );
}
